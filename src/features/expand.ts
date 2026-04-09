import * as vscode from 'vscode';
import * as path from 'path';
import { BlueprintManager } from '../models/BlueprintManager';
import { StagedEntry } from '../types';
import { getWorkspaceFileTree } from '../utils/fileTree';

export function registerExpandCommands(manager: BlueprintManager): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	disposables.push(vscode.commands.registerCommand('aiContextManager.expandFromHere', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage('Open a file first');
			return;
		}

		if (!manager.active) {
			vscode.window.showWarningMessage('No active context blueprint');
			return;
		}

		const scope = await vscode.window.showQuickPick([
			{ label: '$(symbol-method) Immediate Dependencies', description: 'Direct definitions & type references', value: 'shallow' },
			{ label: '$(symbol-class) Full Feature Vertical', description: 'Definitions + references (2 levels deep)', value: 'deep' },
			{ label: '$(files) Sibling Files', description: 'All files in the same directory', value: 'siblings' },
		], {
			title: 'Expand Scope',
			placeHolder: 'How should we trace the code?'
		});

		if (!scope) { return; }

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Tracing dependencies...',
			cancellable: true,
		}, async (progress, token) => {
			let entries: StagedEntry[] = [];

			switch (scope.value) {
				case 'shallow':
					entries = await traceShallow(editor, token);
					break;
				case 'deep':
					entries = await traceDeep(editor, token);
					break;
				case 'siblings':
					entries = await traceSiblings(editor);
					break;
			}

			// Filter out entries already in the active blueprint
			const bp = manager.active!;
			const existingPaths = new Set(bp.entries.map(e => e.path));
			entries = entries.filter(e => !existingPaths.has(e.path));

			// Filter out node_modules, .git, etc.
			entries = entries.filter(e =>
				!e.path.includes('node_modules') &&
				!e.path.startsWith('.git') &&
				!e.path.endsWith('.aicontext')
			);

			if (entries.length === 0) {
				vscode.window.showInformationMessage('No new dependencies found outside current context');
				return;
			}

			manager.setStagedEntries(entries);
			vscode.window.showInformationMessage(`Found ${entries.length} related files — review in the sidebar`);
		});
	}));

	disposables.push(vscode.commands.registerCommand('aiContextManager.mergeStaged', async () => {
		const staged = manager.stagedEntries;
		if (staged.length === 0) { return; }
		await manager.mergeStaged(staged);
		vscode.window.setStatusBarMessage(`$(check) Merged ${staged.length} items into context`, 2000);
	}));

	disposables.push(vscode.commands.registerCommand('aiContextManager.mergeStagedEntry', async (entryPath: string) => {
		const entry = manager.stagedEntries.find(e => e.path === entryPath);
		if (!entry) { return; }
		await manager.mergeStaged([entry]);
	}));

	disposables.push(vscode.commands.registerCommand('aiContextManager.discardStaged', () => {
		manager.clearStaged();
	}));

	disposables.push(vscode.commands.registerCommand('aiContextManager.discardStagedEntry', (entryPath: string) => {
		const remaining = manager.stagedEntries.filter(e => e.path !== entryPath);
		manager.setStagedEntries(remaining);
	}));

	disposables.push(vscode.commands.registerCommand('aiContextManager.semanticExpand', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) { return; }

		const selection = editor.selection.isEmpty
			? editor.document.lineAt(editor.selection.active.line).text
			: editor.document.getText(editor.selection);

		const relativePath = getRelativePath(editor.document.uri);
		const fileTree = await getWorkspaceFileTree();

		const prompt = `I need to expand my context window for the following code located in \`${relativePath}\`:

\`\`\`${editor.document.languageId}
${selection}
\`\`\`

Here is the file structure of my project:
\`\`\`
${fileTree}
\`\`\`

Based on the file structure and this code snippet, which 3 to 8 files are conceptually most important to understand or modify this specific code? Consider:
- Type definitions and interfaces used
- Services or modules this code depends on
- Configuration files that affect behavior
- Test files related to this code

Please return your answer as a simple checklist with file paths so I can manually add them to my context map.`;

		await vscode.env.clipboard.writeText(prompt);
		vscode.window.showInformationMessage('Semantic expand prompt copied to clipboard — paste it into your AI chat');
	}));

	return disposables;
}

async function traceShallow(
	editor: vscode.TextEditor,
	token: vscode.CancellationToken
): Promise<StagedEntry[]> {
	const doc = editor.document;
	const pos = editor.selection.active;
	const entries: Map<string, StagedEntry> = new Map();

	// Find definitions at cursor
	const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
		'vscode.executeDefinitionProvider', doc.uri, pos
	);

	if (definitions) {
		for (const loc of definitions) {
			if (token.isCancellationRequested) { break; }
			addLocation(entries, loc, 'Definition');
		}
	}

	// Find type definitions
	const typeDefinitions = await vscode.commands.executeCommand<vscode.Location[]>(
		'vscode.executeTypeDefinitionProvider', doc.uri, pos
	);

	if (typeDefinitions) {
		for (const loc of typeDefinitions) {
			if (token.isCancellationRequested) { break; }
			addLocation(entries, loc, 'Type Definition');
		}
	}

	// If we're on a selection, try to trace each symbol in it
	if (!editor.selection.isEmpty) {
		const text = doc.getText(editor.selection);
		const wordPattern = /\b[A-Z]\w+\b/g;
		let match;
		while ((match = wordPattern.exec(text)) !== null) {
			if (token.isCancellationRequested) { break; }
			const offset = doc.offsetAt(editor.selection.start) + match.index;
			const symbolPos = doc.positionAt(offset);
			const defs = await vscode.commands.executeCommand<vscode.Location[]>(
				'vscode.executeDefinitionProvider', doc.uri, symbolPos
			);
			if (defs) {
				for (const loc of defs) {
					addLocation(entries, loc, 'Definition');
				}
			}
		}
	}

	return Array.from(entries.values());
}

async function traceDeep(
	editor: vscode.TextEditor,
	token: vscode.CancellationToken
): Promise<StagedEntry[]> {
	// First pass: shallow trace
	const shallowEntries = await traceShallow(editor, token);
	if (token.isCancellationRequested) { return shallowEntries; }

	const entries: Map<string, StagedEntry> = new Map();
	for (const e of shallowEntries) {
		entries.set(e.path, e);
	}

	// Second pass: find references to each discovered file
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) { return shallowEntries; }

	for (const entry of shallowEntries) {
		if (token.isCancellationRequested) { break; }
		try {
			const uri = vscode.Uri.joinPath(folder.uri, entry.path);
			const doc = await vscode.workspace.openTextDocument(uri);
			// Check references at a few key positions (line 0 for imports, first function, etc.)
			for (const line of [0, Math.min(5, doc.lineCount - 1)]) {
				const refs = await vscode.commands.executeCommand<vscode.Location[]>(
					'vscode.executeReferenceProvider', uri, new vscode.Position(line, 0)
				);
				if (refs) {
					for (const loc of refs) {
						addLocation(entries, loc, 'Reference');
					}
				}
			}
		} catch { /* skip */ }
	}

	return Array.from(entries.values());
}

async function traceSiblings(editor: vscode.TextEditor): Promise<StagedEntry[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) { return []; }

	const dir = path.dirname(editor.document.uri.fsPath);
	const relDir = path.relative(folder.uri.fsPath, dir);
	const glob = `${relDir}/*`;

	const files = await vscode.workspace.findFiles(glob, '**/node_modules/**', 100);
	const currentPath = path.relative(folder.uri.fsPath, editor.document.uri.fsPath);

	return files
		.filter(f => {
			const rel = path.relative(folder.uri.fsPath, f.fsPath);
			return rel !== currentPath;
		})
		.map(f => ({
			path: path.relative(folder.uri.fsPath, f.fsPath),
			type: 'file' as const,
			reason: 'Sibling file',
		}));
}

function addLocation(entries: Map<string, StagedEntry>, loc: vscode.Location, reason: string): void {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) { return; }

	const rel = path.relative(folder.uri.fsPath, loc.uri.fsPath);
	if (rel.startsWith('..') || rel.includes('node_modules')) { return; }

	if (!entries.has(rel)) {
		entries.set(rel, {
			path: rel,
			type: 'file',
			reason,
		});
	}
}

function getRelativePath(uri: vscode.Uri): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) { return uri.fsPath; }
	return path.relative(folder.uri.fsPath, uri.fsPath);
}
