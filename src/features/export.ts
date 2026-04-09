import * as vscode from 'vscode';
import * as path from 'path';
import { BlueprintManager } from '../models/BlueprintManager';
import { Blueprint } from '../models/Blueprint';
import { ContextEntry, Fidelity } from '../types';
import { estimateTokens, formatTokenCount } from '../utils/tokens';
import { extractSkeletonForFile } from '../utils/skeleton';

const DIRECTIVE_TEXTS: Record<string, string> = {
	surgical_fix: 'You are restricted to modifying ONLY the files and line ranges provided below. Do not suggest architectural changes, refactors, or modifications outside the immediate scope. If a fix requires changes to files not listed here, describe what needs to change but do not write the code.',
	discovery: 'Analyze the provided file paths and code signatures to help locate where a specific feature or behavior is implemented. Do not write new implementation code unless explicitly asked. Focus on explaining the codebase structure and flow.',
	feature_expansion: 'Use the provided context as a strict architectural and stylistic guide. When writing new code, adhere to the existing patterns, naming conventions, and module structure shown. Do not deviate from the established architecture.',
};

export async function compileBlueprint(bp: Blueprint): Promise<string> {
	const parts: string[] = [];

	// System directives
	if (bp.directive.preset !== 'none' || bp.directive.custom) {
		parts.push('<system_directives>');
		if (bp.directive.preset !== 'none') {
			parts.push(`  <preset_rules>`);
			parts.push(`    ${DIRECTIVE_TEXTS[bp.directive.preset]}`);
			parts.push(`  </preset_rules>`);
		}
		if (bp.directive.custom) {
			parts.push(`  <custom_overrides>`);
			parts.push(`    ${bp.directive.custom}`);
			parts.push(`  </custom_overrides>`);
		}
		parts.push('</system_directives>');
		parts.push('');
	}

	// Context blueprint
	parts.push(`<context_blueprint name="${bp.name}" fidelity="${bp.fidelity}">`);
	if (bp.description) {
		parts.push(`  <description>${bp.description}</description>`);
	}

	for (const entry of bp.entries) {
		const effectiveFidelity = entry.pinned ? 'deep_dive' : bp.fidelity;

		if (entry.type === 'folder') {
			await appendFolderEntry(parts, entry, effectiveFidelity);
		} else {
			await appendFileEntry(parts, entry, effectiveFidelity);
		}
	}

	if (bp.excludes.length > 0) {
		parts.push(`  <excluded_patterns>`);
		for (const exc of bp.excludes) {
			parts.push(`    ${exc}`);
		}
		parts.push(`  </excluded_patterns>`);
	}

	parts.push('</context_blueprint>');

	return parts.join('\n');
}

async function appendFileEntry(parts: string[], entry: ContextEntry, fidelity: Fidelity): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) { return; }

	const uri = vscode.Uri.joinPath(folder.uri, entry.path);
	const mode = entry.compressed ? 'compressed_summary' : fidelity;

	if (mode === 'map') {
		parts.push(`  <file path="${entry.path}" mode="map" />`);
		return;
	}

	if (entry.compressed && entry.summary) {
		parts.push(`  <file path="${entry.path}" mode="compressed_summary">`);
		parts.push(`    <ai_summary>`);
		parts.push(`      ${entry.summary}`);
		parts.push(`    </ai_summary>`);
		parts.push(`  </file>`);
		return;
	}

	try {
		const doc = await vscode.workspace.openTextDocument(uri);
		const langId = doc.languageId;

		if (mode === 'skeleton') {
			const skeleton = await extractSkeletonForFile(uri);
			parts.push(`  <file path="${entry.path}" mode="skeleton" language="${langId}">`);
			parts.push('    ```' + langId);
			parts.push(skeleton);
			parts.push('    ```');
			parts.push('  </file>');
			return;
		}

		// deep_dive
		if (entry.ranges) {
			for (const [start, end] of entry.ranges) {
				const lines: string[] = [];
				for (let i = start - 1; i < Math.min(end, doc.lineCount); i++) {
					lines.push(doc.lineAt(i).text);
				}
				parts.push(`  <file path="${entry.path}" lines="${start}-${end}" mode="deep_dive" language="${langId}">`);
				parts.push('    ```' + langId);
				parts.push(lines.join('\n'));
				parts.push('    ```');
				parts.push('  </file>');
			}
		} else {
			parts.push(`  <file path="${entry.path}" mode="deep_dive" language="${langId}">`);
			parts.push('    ```' + langId);
			parts.push(doc.getText());
			parts.push('    ```');
			parts.push('  </file>');
		}
	} catch {
		parts.push(`  <file path="${entry.path}" mode="error">Could not read file</file>`);
	}
}

async function appendFolderEntry(parts: string[], entry: ContextEntry, fidelity: Fidelity): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) { return; }

	const glob = entry.glob ?? `${entry.path}/**/*`;

	if (fidelity === 'map') {
		const files = await vscode.workspace.findFiles(glob, undefined, 500);
		parts.push(`  <folder path="${entry.path}" mode="map">`);
		for (const f of files) {
			const rel = path.relative(folder.uri.fsPath, f.fsPath);
			parts.push(`    ${rel}`);
		}
		parts.push('  </folder>');
		return;
	}

	if (entry.compressed && entry.summary) {
		parts.push(`  <folder path="${entry.path}" mode="compressed_summary">`);
		parts.push(`    <ai_summary>`);
		parts.push(`      ${entry.summary}`);
		parts.push(`    </ai_summary>`);
		parts.push(`  </folder>`);
		return;
	}

	const files = await vscode.workspace.findFiles(glob, undefined, 200);
	parts.push(`  <folder path="${entry.path}" mode="${fidelity}">`);

	for (const f of files) {
		const rel = path.relative(folder.uri.fsPath, f.fsPath);
		try {
			const doc = await vscode.workspace.openTextDocument(f);
			if (fidelity === 'skeleton') {
				const skeleton = await extractSkeletonForFile(f);
				parts.push(`    <file path="${rel}" language="${doc.languageId}">`);
				parts.push('      ```' + doc.languageId);
				parts.push(skeleton);
				parts.push('      ```');
				parts.push('    </file>');
			} else {
				parts.push(`    <file path="${rel}" language="${doc.languageId}">`);
				parts.push('      ```' + doc.languageId);
				parts.push(doc.getText());
				parts.push('      ```');
				parts.push('    </file>');
			}
		} catch { /* skip unreadable files */ }
	}

	parts.push('  </folder>');
}

export async function exportToClipboard(manager: BlueprintManager): Promise<void> {
	const bp = manager.active;
	if (!bp) {
		vscode.window.showWarningMessage('No active context blueprint');
		return;
	}

	const compiled = await compileBlueprint(bp);
	await vscode.env.clipboard.writeText(compiled);

	const tokens = estimateTokens(compiled);
	vscode.window.showInformationMessage(`Copied to clipboard (~${formatTokenCount(tokens)} tokens)`);
}

let ghostFileDebounce: ReturnType<typeof setTimeout> | undefined;

export function setupGhostFile(manager: BlueprintManager): vscode.Disposable {
	const listener = manager.onDidChange(() => {
		if (ghostFileDebounce) { clearTimeout(ghostFileDebounce); }
		ghostFileDebounce = setTimeout(() => updateGhostFile(manager), 500);
	});
	return listener;
}

async function updateGhostFile(manager: BlueprintManager): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) { return; }

	const ghostUri = vscode.Uri.joinPath(folder.uri, '.aicontext.md');

	if (!manager.active) {
		try { await vscode.workspace.fs.delete(ghostUri); } catch { /* ok */ }
		return;
	}

	const compiled = await compileBlueprint(manager.active);
	const content = `<!-- Auto-generated by AI Context Manager — do not edit manually -->\n<!-- Blueprint: ${manager.active.name} -->\n\n${compiled}\n`;
	await vscode.workspace.fs.writeFile(ghostUri, Buffer.from(content, 'utf-8'));
}
