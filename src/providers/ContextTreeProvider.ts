import * as vscode from 'vscode';
import * as path from 'path';
import { BlueprintManager } from '../models/BlueprintManager';
import { ContextEntry, StagedEntry } from '../types';

type TreeElement =
	| { kind: 'section'; label: string; section: 'active' | 'staged' }
	| { kind: 'file'; entry: ContextEntry }
	| { kind: 'range'; entry: ContextEntry; range: [number, number] }
	| { kind: 'staged'; entry: StagedEntry }
	| { kind: 'empty'; label: string };

export class ContextTreeProvider implements vscode.TreeDataProvider<TreeElement> {
	private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private manager: BlueprintManager) {
		manager.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
		manager.onDidChangeStaged(() => this._onDidChangeTreeData.fire(undefined));
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: TreeElement): vscode.TreeItem {
		switch (element.kind) {
			case 'section': return this.getSectionItem(element);
			case 'file': return this.getFileItem(element.entry);
			case 'range': return this.getRangeItem(element.entry, element.range);
			case 'staged': return this.getStagedItem(element.entry);
			case 'empty': return this.getEmptyItem(element.label);
		}
	}

	getChildren(element?: TreeElement): TreeElement[] {
		if (!this.manager.active) {
			return [{ kind: 'empty', label: 'No active blueprint — create one to start' }];
		}

		// Root level
		if (!element) {
			const sections: TreeElement[] = [];

			sections.push({ kind: 'section', label: 'Context Map', section: 'active' });

			if (this.manager.stagedEntries.length > 0) {
				sections.push({ kind: 'section', label: '🪄 Suggested Additions', section: 'staged' });
			}

			return sections;
		}

		// Section children
		if (element.kind === 'section') {
			if (element.section === 'active') {
				return this.getActiveChildren();
			} else {
				return this.getStagedChildren();
			}
		}

		// File children (ranges)
		if (element.kind === 'file') {
			const entry = element.entry;
			if (entry.ranges && entry.ranges.length > 0) {
				return entry.ranges.map(r => ({ kind: 'range' as const, entry, range: r }));
			}
		}

		return [];
	}

	getParent(element: TreeElement): TreeElement | undefined {
		if (element.kind === 'range') {
			return { kind: 'file', entry: element.entry };
		}
		if (element.kind === 'file') {
			return { kind: 'section', label: 'Context Map', section: 'active' };
		}
		if (element.kind === 'staged') {
			return { kind: 'section', label: '🪄 Suggested Additions', section: 'staged' };
		}
		return undefined;
	}

	private getActiveChildren(): TreeElement[] {
		const bp = this.manager.active;
		if (!bp || bp.entries.length === 0) {
			return [{ kind: 'empty', label: 'Use Ctrl+Shift+M to mark code, or right-click files/folders' }];
		}
		return bp.entries.map(entry => ({ kind: 'file' as const, entry }));
	}

	private getStagedChildren(): TreeElement[] {
		return this.manager.stagedEntries.map(entry => ({ kind: 'staged' as const, entry }));
	}

	private getSectionItem(element: { label: string; section: 'active' | 'staged' }): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
		item.contextValue = element.section === 'staged' ? 'stagedSection' : 'activeSection';

		if (element.section === 'active') {
			item.iconPath = new vscode.ThemeIcon('brain');
			const bp = this.manager.active;
			if (bp) {
				item.description = `${bp.entries.length} ${bp.entries.length === 1 ? 'entry' : 'entries'}`;
			}
		} else {
			item.iconPath = new vscode.ThemeIcon('sparkle');
			item.description = `${this.manager.stagedEntries.length} found`;
		}

		return item;
	}

	private getFileItem(entry: ContextEntry): vscode.TreeItem {
		const basename = path.basename(entry.path);
		const hasRanges = entry.ranges && entry.ranges.length > 0;
		const collapsible = hasRanges
			? vscode.TreeItemCollapsibleState.Expanded
			: vscode.TreeItemCollapsibleState.None;

		const item = new vscode.TreeItem(basename, collapsible);
		item.description = entry.path;
		item.tooltip = this.getEntryTooltip(entry);

		if (entry.type === 'folder') {
			item.iconPath = new vscode.ThemeIcon('folder');
			item.description = entry.glob ?? entry.path + '/';
			item.contextValue = 'contextFolder';
		} else {
			item.iconPath = entry.pinned
				? new vscode.ThemeIcon('pinned', new vscode.ThemeColor('charts.green'))
				: entry.compressed
					? new vscode.ThemeIcon('archive', new vscode.ThemeColor('charts.purple'))
					: new vscode.ThemeIcon('file');

			if (!hasRanges) {
				item.contextValue = entry.pinned ? 'contextFilePinned' : 'contextFile';
				item.command = {
					command: 'vscode.open',
					title: 'Open File',
					arguments: [this.toUri(entry.path)],
				};
			} else {
				item.contextValue = entry.pinned ? 'contextFileWithRangesPinned' : 'contextFileWithRanges';
			}
		}

		return item;
	}

	private getRangeItem(entry: ContextEntry, range: [number, number]): vscode.TreeItem {
		const item = new vscode.TreeItem(
			`lines ${range[0]}–${range[1]}`,
			vscode.TreeItemCollapsibleState.None
		);
		item.iconPath = new vscode.ThemeIcon('symbol-snippet');
		item.contextValue = 'contextRange';
		item.command = {
			command: 'vscode.open',
			title: 'Go to Range',
			arguments: [
				this.toUri(entry.path),
				{ selection: new vscode.Range(range[0] - 1, 0, range[1] - 1, 0) } as vscode.TextDocumentShowOptions,
			],
		};
		// Store data for commands operating on this range
		(item as any).entryPath = entry.path;
		(item as any).entryRanges = entry.ranges;
		return item;
	}

	private getStagedItem(entry: StagedEntry): vscode.TreeItem {
		const basename = path.basename(entry.path);
		const item = new vscode.TreeItem(basename, vscode.TreeItemCollapsibleState.None);
		item.description = entry.reason ? `${entry.path} — ${entry.reason}` : entry.path;
		item.iconPath = new vscode.ThemeIcon('diff-added');
		item.contextValue = 'stagedEntry';
		item.command = {
			command: 'vscode.open',
			title: 'Preview',
			arguments: [this.toUri(entry.path)],
		};
		return item;
	}

	private getEmptyItem(label: string): vscode.TreeItem {
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon('info');
		return item;
	}

	private getEntryTooltip(entry: ContextEntry): vscode.MarkdownString {
		const md = new vscode.MarkdownString();
		md.appendMarkdown(`**${entry.path}**\n\n`);
		if (entry.type === 'folder') {
			md.appendMarkdown(`Folder: \`${entry.glob ?? entry.path + '/**/*'}\`\n\n`);
		}
		if (entry.ranges) {
			md.appendMarkdown(`Ranges: ${entry.ranges.map(r => `${r[0]}–${r[1]}`).join(', ')}\n\n`);
		} else {
			md.appendMarkdown(`Entire file\n\n`);
		}
		if (entry.pinned) { md.appendMarkdown(`📌 **Pinned** (always Deep Dive)\n\n`); }
		if (entry.compressed) { md.appendMarkdown(`🗜️ **Compressed**\n\n`); }
		return md;
	}

	private toUri(relativePath: string): vscode.Uri {
		const folder = vscode.workspace.workspaceFolders?.[0];
		return folder
			? vscode.Uri.joinPath(folder.uri, relativePath)
			: vscode.Uri.file(relativePath);
	}
}
