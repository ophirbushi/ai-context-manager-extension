import * as vscode from 'vscode';
import * as path from 'path';
import { BlueprintManager } from '../models/BlueprintManager';
import { ContextEntry } from '../types';

export function registerMarkingCommands(manager: BlueprintManager): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	disposables.push(vscode.commands.registerCommand('aiContextManager.markSelection', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.selection.isEmpty) {
			vscode.window.showWarningMessage('Select some code first');
			return;
		}

		if (!manager.active) {
			const action = await vscode.window.showWarningMessage(
				'No active context blueprint. Create one?',
				'Create'
			);
			if (action === 'Create') {
				await vscode.commands.executeCommand('aiContextManager.createBlueprint');
			}
			if (!manager.active) { return; }
		}

		const filePath = getRelativePath(editor.document.uri);
		if (!filePath) { return; }

		const sel = editor.selection;
		const range: [number, number] = [sel.start.line + 1, sel.end.line + 1];

		await manager.mutateActive(bp => {
			// Merge into existing file entry if possible
			const existing = bp.entries.find(e => e.path === filePath && e.type === 'file');
			if (existing && existing.ranges) {
				existing.ranges.push(range);
				existing.ranges = mergeRanges(existing.ranges);
			} else if (existing && !existing.ranges) {
				// File already marked as "all" — no need to add a range
			} else {
				bp.addEntry({ path: filePath, type: 'file', ranges: [range] });
			}
		});

		vscode.window.setStatusBarMessage(`$(check) Marked lines ${range[0]}-${range[1]}`, 2000);
	}));

	disposables.push(vscode.commands.registerCommand('aiContextManager.markFile', async (uri?: vscode.Uri) => {
		if (!manager.active) {
			const action = await vscode.window.showWarningMessage(
				'No active context blueprint. Create one?', 'Create'
			);
			if (action === 'Create') {
				await vscode.commands.executeCommand('aiContextManager.createBlueprint');
			}
			if (!manager.active) { return; }
		}

		const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
		if (!targetUri) { return; }

		const filePath = getRelativePath(targetUri);
		if (!filePath) { return; }

		await manager.mutateActive(bp => {
			// Remove any partial ranges and add as whole file
			bp.removeEntriesByPath(filePath);
			bp.addEntry({ path: filePath, type: 'file' });
		});

		vscode.window.setStatusBarMessage(`$(check) Added ${path.basename(filePath)} to context`, 2000);
	}));

	disposables.push(vscode.commands.registerCommand('aiContextManager.markFolder', async (uri?: vscode.Uri) => {
		if (!manager.active) {
			const action = await vscode.window.showWarningMessage(
				'No active context blueprint. Create one?', 'Create'
			);
			if (action === 'Create') {
				await vscode.commands.executeCommand('aiContextManager.createBlueprint');
			}
			if (!manager.active) { return; }
		}

		let targetUri = uri;
		if (!targetUri) {
			const picked = await vscode.window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: 'Add Folder to Context'
			});
			targetUri = picked?.[0];
		}
		if (!targetUri) { return; }

		const folderPath = getRelativePath(targetUri);
		if (!folderPath) { return; }

		const glob = `${folderPath}/**/*`;

		await manager.mutateActive(bp => {
			bp.addEntry({ path: folderPath, type: 'folder', glob });
		});

		vscode.window.setStatusBarMessage(`$(check) Added ${folderPath}/ to context`, 2000);
	}));

	disposables.push(vscode.commands.registerCommand('aiContextManager.removeFromContext',
		async (entryPath?: string, ranges?: [number, number][]) => {
			if (!manager.active) { return; }

			if (entryPath) {
				await manager.mutateActive(bp => {
					bp.removeEntry(entryPath, ranges);
				});
			}
		}
	));

	disposables.push(vscode.commands.registerCommand('aiContextManager.pinEntry',
		async (entryPath?: string, ranges?: [number, number][]) => {
			if (!manager.active || !entryPath) { return; }
			await manager.mutateActive(bp => {
				bp.togglePin(entryPath, ranges);
			});
		}
	));

	return disposables;
}

function getRelativePath(uri: vscode.Uri): string | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) { return undefined; }
	return path.relative(folder.uri.fsPath, uri.fsPath);
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
	if (ranges.length <= 1) { return ranges; }
	const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [sorted[0]];

	for (let i = 1; i < sorted.length; i++) {
		const last = merged[merged.length - 1];
		const curr = sorted[i];
		if (curr[0] <= last[1] + 1) {
			last[1] = Math.max(last[1], curr[1]);
		} else {
			merged.push(curr);
		}
	}
	return merged;
}
