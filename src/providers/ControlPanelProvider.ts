import * as vscode from 'vscode';
import { BlueprintManager } from '../models/BlueprintManager';
import { DirectivePreset, Fidelity } from '../types';

export class ControlPanelProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'aiContextManager.controlPanel';
	private _view?: vscode.WebviewView;

	constructor(private manager: BlueprintManager) {
		manager.onDidChange(() => this.updateView());
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this._view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
		this.updateView();
	}

	private updateView(): void {
		if (!this._view) { return; }
		this._view.webview.html = this.getHtml();
	}

	private async handleMessage(msg: any): Promise<void> {
		switch (msg.type) {
			case 'switchBlueprint':
				await vscode.commands.executeCommand('aiContextManager.switchBlueprint');
				break;
			case 'createBlueprint':
				await vscode.commands.executeCommand('aiContextManager.createBlueprint');
				break;
			case 'setFidelity':
				if (this.manager.active) {
					await this.manager.mutateActive(bp => { bp.fidelity = msg.value as Fidelity; });
				}
				break;
			case 'setDirectivePreset':
				if (this.manager.active) {
					await this.manager.mutateActive(bp => { bp.directive.preset = msg.value as DirectivePreset; });
				}
				break;
			case 'setDirectiveCustom':
				if (this.manager.active) {
					await this.manager.mutateActive(bp => { bp.directive.custom = msg.value || undefined; });
				}
				break;
			case 'export':
				await vscode.commands.executeCommand('aiContextManager.exportClipboard');
				break;
		}
	}

	private getHtml(): string {
		const bp = this.manager.active;
		const blueprintNames = this.manager.blueprints.map(b => b.name);
		const nonce = getNonce();

		if (!bp) {
			return /* html */`<!DOCTYPE html>
			<html><head><meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
			<style nonce="${nonce}">${this.getBaseStyles()}</style></head>
			<body>
				<div class="empty-state">
					<p>No active context blueprint</p>
					<button class="primary" onclick="post({type:'createBlueprint'})">Create Blueprint</button>
					${blueprintNames.length > 0 ? `<button onclick="post({type:'switchBlueprint'})">Switch Blueprint</button>` : ''}
				</div>
				<script nonce="${nonce}">const vscode=acquireVsCodeApi();function post(m){vscode.postMessage(m);}</script>
			</body></html>`;
		}

		const fidelityOptions: { value: Fidelity; label: string; icon: string }[] = [
			{ value: 'map', label: 'Map', icon: '🗺️' },
			{ value: 'skeleton', label: 'Skeleton', icon: '🦴' },
			{ value: 'deep_dive', label: 'Deep Dive', icon: '🔬' },
		];

		const presets: { value: DirectivePreset; label: string; icon: string }[] = [
			{ value: 'none', label: 'None', icon: '—' },
			{ value: 'surgical_fix', label: 'Surgical Fix', icon: '🎯' },
			{ value: 'discovery', label: 'Discovery', icon: '🗺️' },
			{ value: 'feature_expansion', label: 'Feature Build', icon: '🏗️' },
		];

		const entryCount = bp.entries.length;
		const tokenEstimate = this.estimateTokens(bp);

		return /* html */`<!DOCTYPE html>
		<html><head><meta charset="UTF-8">
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
		<style nonce="${nonce}">${this.getBaseStyles()}</style></head>
		<body>
			<div class="header">
				<div class="blueprint-row">
					<span class="blueprint-name" title="Click to switch" onclick="post({type:'switchBlueprint'})">${escapeHtml(bp.name)}</span>
					<span class="badge">${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}</span>
				</div>
				<div class="token-bar ${tokenEstimate > 16000 ? 'red' : tokenEstimate > 4000 ? 'yellow' : 'green'}">
					~${this.formatTokens(tokenEstimate)} tokens
				</div>
			</div>

			<div class="section">
				<label>Fidelity</label>
				<div class="segmented">
					${fidelityOptions.map(f => `
						<button class="seg ${bp.fidelity === f.value ? 'active' : ''}"
							onclick="post({type:'setFidelity',value:'${f.value}'})">
							${f.icon} ${f.label}
						</button>
					`).join('')}
				</div>
			</div>

			<div class="section">
				<label>AI Directive</label>
				<select onchange="post({type:'setDirectivePreset',value:this.value})">
					${presets.map(p => `
						<option value="${p.value}" ${bp.directive.preset === p.value ? 'selected' : ''}>
							${p.icon} ${p.label}
						</option>
					`).join('')}
				</select>
			</div>

			<div class="section collapsible">
				<details ${bp.directive.custom ? 'open' : ''}>
					<summary>+ Custom Instructions</summary>
					<textarea rows="3" placeholder="e.g. Ensure backward compatibility with v1 API..."
						onchange="post({type:'setDirectiveCustom',value:this.value})">${escapeHtml(bp.directive.custom ?? '')}</textarea>
				</details>
			</div>

			<div class="actions">
				<button class="primary export" onclick="post({type:'export'})">
					📋 Export to Clipboard
				</button>
			</div>

			<script nonce="${nonce}">const vscode=acquireVsCodeApi();function post(m){vscode.postMessage(m);}</script>
		</body></html>`;
	}

	private estimateTokens(bp: typeof this.manager.active): number {
		if (!bp) { return 0; }
		// Rough estimate: each entry contributes some baseline
		let chars = 0;
		for (const entry of bp.entries) {
			if (entry.type === 'folder') {
				chars += 500; // rough estimate per folder
			} else if (entry.ranges) {
				for (const [start, end] of entry.ranges) {
					chars += (end - start + 1) * 80; // ~80 chars per line
				}
			} else {
				chars += 2000; // rough estimate per whole file
			}
		}
		return Math.ceil(chars / 4);
	}

	private formatTokens(tokens: number): string {
		if (tokens >= 1000) { return `${(tokens / 1000).toFixed(1)}k`; }
		return `${tokens}`;
	}

	private getBaseStyles(): string {
		return `
			* { box-sizing: border-box; margin: 0; padding: 0; }
			body {
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				color: var(--vscode-foreground);
				padding: 8px 12px;
			}
			.empty-state {
				text-align: center;
				padding: 20px 0;
			}
			.empty-state p {
				margin-bottom: 12px;
				opacity: 0.7;
			}
			button {
				background: var(--vscode-button-secondaryBackground);
				color: var(--vscode-button-secondaryForeground);
				border: none;
				padding: 6px 12px;
				border-radius: 4px;
				cursor: pointer;
				font-size: var(--vscode-font-size);
				margin: 2px;
			}
			button:hover {
				background: var(--vscode-button-secondaryHoverBackground);
			}
			button.primary {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
			}
			button.primary:hover {
				background: var(--vscode-button-hoverBackground);
			}
			.header {
				margin-bottom: 12px;
				padding-bottom: 8px;
				border-bottom: 1px solid var(--vscode-widget-border);
			}
			.blueprint-row {
				display: flex;
				align-items: center;
				gap: 8px;
				margin-bottom: 4px;
			}
			.blueprint-name {
				font-weight: bold;
				font-size: 1.1em;
				cursor: pointer;
				text-decoration: underline;
				text-decoration-style: dotted;
			}
			.blueprint-name:hover {
				color: var(--vscode-textLink-foreground);
			}
			.badge {
				background: var(--vscode-badge-background);
				color: var(--vscode-badge-foreground);
				padding: 1px 6px;
				border-radius: 10px;
				font-size: 0.85em;
			}
			.token-bar {
				font-size: 0.9em;
				padding: 2px 6px;
				border-radius: 3px;
				display: inline-block;
			}
			.token-bar.green { color: var(--vscode-charts-green, #4caf50); }
			.token-bar.yellow { color: var(--vscode-charts-yellow, #ffb300); }
			.token-bar.red { color: var(--vscode-charts-red, #f44336); }
			.section {
				margin-bottom: 10px;
			}
			label {
				display: block;
				font-size: 0.85em;
				text-transform: uppercase;
				letter-spacing: 0.5px;
				opacity: 0.7;
				margin-bottom: 4px;
			}
			.segmented {
				display: flex;
				gap: 2px;
				border-radius: 4px;
				overflow: hidden;
			}
			.seg {
				flex: 1;
				text-align: center;
				border-radius: 0;
				padding: 5px 4px;
				font-size: 0.9em;
				opacity: 0.6;
				transition: all 0.15s;
			}
			.seg.active {
				background: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				opacity: 1;
			}
			.seg:first-child { border-radius: 4px 0 0 4px; }
			.seg:last-child { border-radius: 0 4px 4px 0; }
			select {
				width: 100%;
				padding: 5px 8px;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				font-size: var(--vscode-font-size);
			}
			details summary {
				cursor: pointer;
				font-size: 0.9em;
				opacity: 0.8;
				margin-bottom: 4px;
			}
			textarea {
				width: 100%;
				background: var(--vscode-input-background);
				color: var(--vscode-input-foreground);
				border: 1px solid var(--vscode-input-border);
				border-radius: 4px;
				padding: 6px 8px;
				font-family: var(--vscode-font-family);
				font-size: var(--vscode-font-size);
				resize: vertical;
			}
			.actions {
				margin-top: 12px;
				padding-top: 8px;
				border-top: 1px solid var(--vscode-widget-border);
			}
			.export {
				width: 100%;
				padding: 8px;
				font-size: 1em;
			}
		`;
	}
}

function getNonce(): string {
	let text = '';
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
