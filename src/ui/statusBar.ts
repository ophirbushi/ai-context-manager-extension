import * as vscode from 'vscode';
import { BlueprintManager } from '../models/BlueprintManager';
import { estimateTokens, formatTokenCount } from '../utils/tokens';

export class StatusBar {
	private item: vscode.StatusBarItem;

	constructor(private manager: BlueprintManager) {
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.item.command = 'aiContextManager.switchBlueprint';
		this.item.name = 'AI Context Manager';
		this.update();
		this.item.show();

		manager.onDidChange(() => this.update());
	}

	private update(): void {
		const bp = this.manager.active;
		if (!bp) {
			this.item.text = '$(brain) No Context';
			this.item.tooltip = 'Click to create or switch context blueprint';
			this.item.color = undefined;
		} else {
			const count = bp.entries.length;
			this.item.text = `$(brain) ${bp.name} (${count} ${count === 1 ? 'item' : 'items'})`;
			this.item.tooltip = new vscode.MarkdownString(
				`**AI Context:** ${bp.name}\n\n` +
				`Entries: ${count}\n\n` +
				`Fidelity: ${bp.fidelity}\n\n` +
				`Click to switch or manage blueprints`
			);
			this.item.color = undefined;
		}
	}

	dispose(): void {
		this.item.dispose();
	}
}
