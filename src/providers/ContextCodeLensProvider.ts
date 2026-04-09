import * as vscode from 'vscode';
import * as path from 'path';
import { BlueprintManager } from '../models/BlueprintManager';

export class ContextCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	constructor(private manager: BlueprintManager) {
		manager.onDidChange(() => this._onDidChangeCodeLenses.fire());
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const bp = this.manager.active;
		if (!bp) { return []; }

		const filePath = this.getRelativePath(document.uri);
		if (!filePath) { return []; }

		const lenses: vscode.CodeLens[] = [];
		const fileEntries = bp.entries.filter(e => e.type === 'file' && e.path === filePath);

		for (const entry of fileEntries) {
			if (entry.ranges) {
				for (const [start, end] of entry.ranges) {
					const range = new vscode.Range(start - 1, 0, start - 1, 0);

					lenses.push(new vscode.CodeLens(range, {
						title: `$(check) In Context: ${bp.name}${entry.pinned ? ' $(pin)' : ''}`,
						command: '',
						arguments: [],
					}));

					lenses.push(new vscode.CodeLens(range, {
						title: '$(close) Remove',
						command: 'aiContextManager.removeFromContext',
						arguments: [entry.path, entry.ranges],
					}));

					if (!entry.pinned) {
						lenses.push(new vscode.CodeLens(range, {
							title: '$(pin) Pin',
							command: 'aiContextManager.pinEntry',
							arguments: [entry.path, entry.ranges],
						}));
					} else {
						lenses.push(new vscode.CodeLens(range, {
							title: '$(pinned) Unpin',
							command: 'aiContextManager.pinEntry',
							arguments: [entry.path, entry.ranges],
						}));
					}
				}
			} else {
				// Whole file — show at top
				const range = new vscode.Range(0, 0, 0, 0);
				lenses.push(new vscode.CodeLens(range, {
					title: `$(check) Entire file in context: ${bp.name}`,
					command: '',
					arguments: [],
				}));
				lenses.push(new vscode.CodeLens(range, {
					title: '$(close) Remove',
					command: 'aiContextManager.removeFromContext',
					arguments: [entry.path, undefined],
				}));
			}
		}

		// Check folder coverage
		const folderEntries = bp.entries.filter(e => e.type === 'folder');
		for (const entry of folderEntries) {
			const folderPrefix = entry.path + '/';
			if (filePath.startsWith(folderPrefix) || filePath.startsWith(entry.path + path.sep)) {
				lenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
					title: `$(folder) In context via ${entry.path}/`,
					command: '',
					arguments: [],
				}));
			}
		}

		return lenses;
	}

	private getRelativePath(uri: vscode.Uri): string | undefined {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) { return undefined; }
		return path.relative(folder.uri.fsPath, uri.fsPath);
	}
}
