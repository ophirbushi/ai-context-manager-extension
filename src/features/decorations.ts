import * as vscode from 'vscode';
import * as path from 'path';
import { BlueprintManager } from '../models/BlueprintManager';
import { ContextEntry } from '../types';

const TEAL = 'rgba(0, 180, 180, 0.08)';
const TEAL_BORDER = 'rgba(0, 180, 180, 0.5)';
const TEAL_GUTTER = 'rgba(0, 180, 180, 0.7)';

export class DecorationManager {
	private decorationType: vscode.TextEditorDecorationType;
	private wholeFileDecorationType: vscode.TextEditorDecorationType;

	constructor(private manager: BlueprintManager) {
		this.decorationType = vscode.window.createTextEditorDecorationType({
			backgroundColor: TEAL,
			borderWidth: '0 0 0 2px',
			borderStyle: 'solid',
			borderColor: TEAL_BORDER,
			isWholeLine: true,
			overviewRulerColor: TEAL_GUTTER,
			overviewRulerLane: vscode.OverviewRulerLane.Left,
		});

		this.wholeFileDecorationType = vscode.window.createTextEditorDecorationType({
			backgroundColor: TEAL,
			borderWidth: '0 0 0 2px',
			borderStyle: 'solid',
			borderColor: TEAL_BORDER,
			isWholeLine: true,
			overviewRulerColor: TEAL_GUTTER,
			overviewRulerLane: vscode.OverviewRulerLane.Left,
		});

		manager.onDidChange(() => this.updateAll());

		vscode.window.onDidChangeActiveTextEditor(() => this.updateAll());
		vscode.window.onDidChangeVisibleTextEditors(() => this.updateAll());
	}

	updateAll(): void {
		for (const editor of vscode.window.visibleTextEditors) {
			this.updateEditor(editor);
		}
	}

	private updateEditor(editor: vscode.TextEditor): void {
		const bp = this.manager.active;
		if (!bp) {
			editor.setDecorations(this.decorationType, []);
			editor.setDecorations(this.wholeFileDecorationType, []);
			return;
		}

		const filePath = this.getRelativePath(editor.document.uri);
		if (!filePath) {
			editor.setDecorations(this.decorationType, []);
			editor.setDecorations(this.wholeFileDecorationType, []);
			return;
		}

		const fileEntries = bp.entries.filter(e =>
			e.type === 'file' && e.path === filePath
		);

		const rangeDecorations: vscode.DecorationOptions[] = [];
		const wholeFileDecorations: vscode.DecorationOptions[] = [];

		for (const entry of fileEntries) {
			if (entry.ranges) {
				for (const [start, end] of entry.ranges) {
					rangeDecorations.push({
						range: new vscode.Range(start - 1, 0, end - 1, Number.MAX_SAFE_INTEGER),
						hoverMessage: new vscode.MarkdownString(
							`$(brain) **In Context:** ${bp.name}${entry.pinned ? ' $(pin) Pinned' : ''}`
						),
					});
				}
			} else {
				// Whole file
				const lastLine = editor.document.lineCount - 1;
				wholeFileDecorations.push({
					range: new vscode.Range(0, 0, lastLine, Number.MAX_SAFE_INTEGER),
					hoverMessage: new vscode.MarkdownString(
						`$(brain) **In Context:** ${bp.name} (whole file)${entry.pinned ? ' $(pin) Pinned' : ''}`
					),
				});
			}
		}

		// Also check if file is covered by a folder glob
		const folderEntries = bp.entries.filter(e => e.type === 'folder');
		for (const entry of folderEntries) {
			const folderPrefix = entry.path + '/';
			if (filePath.startsWith(folderPrefix) || filePath.startsWith(entry.path + path.sep)) {
				const lastLine = editor.document.lineCount - 1;
				wholeFileDecorations.push({
					range: new vscode.Range(0, 0, lastLine, Number.MAX_SAFE_INTEGER),
					hoverMessage: new vscode.MarkdownString(
						`$(brain) **In Context:** ${bp.name} (via ${entry.path}/)`
					),
				});
			}
		}

		editor.setDecorations(this.decorationType, rangeDecorations);
		editor.setDecorations(this.wholeFileDecorationType, wholeFileDecorations);
	}

	private getRelativePath(uri: vscode.Uri): string | undefined {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) { return undefined; }
		return path.relative(folder.uri.fsPath, uri.fsPath);
	}

	dispose(): void {
		this.decorationType.dispose();
		this.wholeFileDecorationType.dispose();
	}
}
