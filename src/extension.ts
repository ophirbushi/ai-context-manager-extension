import * as vscode from 'vscode';
import { BlueprintManager } from './models/BlueprintManager';
import { StatusBar } from './ui/statusBar';
import { DecorationManager } from './features/decorations';
import { ContextCodeLensProvider } from './providers/ContextCodeLensProvider';
import { ContextTreeProvider } from './providers/ContextTreeProvider';
import { ControlPanelProvider } from './providers/ControlPanelProvider';
import { registerMarkingCommands } from './features/marking';
import { registerExpandCommands } from './features/expand';
import { registerCompressCommands } from './features/compress';
import { exportToClipboard, setupGhostFile } from './features/export';

export async function activate(context: vscode.ExtensionContext) {
	const manager = new BlueprintManager();
	await manager.loadAll();

	// --- Status Bar ---
	const statusBar = new StatusBar(manager);
	context.subscriptions.push({ dispose: () => statusBar.dispose() });

	// --- Decorations ---
	const decorations = new DecorationManager(manager);
	context.subscriptions.push({ dispose: () => decorations.dispose() });

	// --- CodeLens ---
	const codeLensProvider = new ContextCodeLensProvider(manager);
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
	);

	// --- Tree View ---
	const treeProvider = new ContextTreeProvider(manager);
	const treeView = vscode.window.createTreeView('aiContextManager.contextTree', {
		treeDataProvider: treeProvider,
		showCollapseAll: true,
	});
	context.subscriptions.push(treeView);

	// --- Control Panel (Webview) ---
	const controlPanel = new ControlPanelProvider(manager);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(ControlPanelProvider.viewType, controlPanel)
	);

	// --- Ghost File ---
	context.subscriptions.push(setupGhostFile(manager));

	// --- Blueprint CRUD Commands ---
	context.subscriptions.push(
		vscode.commands.registerCommand('aiContextManager.createBlueprint', async () => {
			const name = await vscode.window.showInputBox({
				title: 'New Context Blueprint',
				prompt: 'Enter a name for this context (e.g., "auth-feature", "fix-checkout-bug")',
				placeHolder: 'my-feature',
				validateInput: (value) => {
					if (!value.trim()) { return 'Name is required'; }
					if (manager.blueprints.some(b => b.name === value.trim())) {
						return 'A blueprint with this name already exists';
					}
					return undefined;
				}
			});
			if (!name) { return; }

			const bp = await manager.create(name.trim());
			await manager.activate(bp.name);
			vscode.window.setStatusBarMessage(`$(check) Created and activated "${bp.name}"`, 3000);
		}),

		vscode.commands.registerCommand('aiContextManager.switchBlueprint', async () => {
			const items: vscode.QuickPickItem[] = [];

			if (manager.active) {
				items.push({
					label: '$(close) Deactivate Current',
					description: `Stop using "${manager.active.name}"`,
				});
			}

			for (const bp of manager.blueprints) {
				const isActive = bp.name === manager.active?.name;
				items.push({
					label: `${isActive ? '$(check) ' : '$(brain) '}${bp.name}`,
					description: `${bp.entries.length} entries${isActive ? ' (active)' : ''}`,
				});
			}

			items.push({
				label: '$(add) Create New Blueprint...',
				description: '',
			});

			const picked = await vscode.window.showQuickPick(items, {
				title: 'Context Blueprints',
				placeHolder: 'Select a blueprint to activate',
			});

			if (!picked) { return; }

			if (picked.label.includes('Create New')) {
				await vscode.commands.executeCommand('aiContextManager.createBlueprint');
			} else if (picked.label.includes('Deactivate')) {
				manager.deactivate();
				vscode.window.setStatusBarMessage('$(check) Context deactivated', 2000);
			} else {
				const name = picked.label.replace(/\$\([^)]+\)\s*/, '');
				await manager.activate(name);
				vscode.window.setStatusBarMessage(`$(check) Switched to "${name}"`, 2000);
			}
		}),

		vscode.commands.registerCommand('aiContextManager.deleteBlueprint', async () => {
			const items = manager.blueprints.map(bp => ({
				label: bp.name,
				description: `${bp.entries.length} entries`,
			}));

			if (items.length === 0) {
				vscode.window.showInformationMessage('No blueprints to delete');
				return;
			}

			const picked = await vscode.window.showQuickPick(items, {
				title: 'Delete Context Blueprint',
				placeHolder: 'Select a blueprint to delete',
			});

			if (!picked) { return; }

			const confirm = await vscode.window.showWarningMessage(
				`Delete blueprint "${picked.label}"? This cannot be undone.`,
				{ modal: true },
				'Delete'
			);

			if (confirm === 'Delete') {
				await manager.deleteBlueprint(picked.label);
				vscode.window.setStatusBarMessage(`$(check) Deleted "${picked.label}"`, 2000);
			}
		}),

		vscode.commands.registerCommand('aiContextManager.exportClipboard', () =>
			exportToClipboard(manager)
		),
	);

	// --- Marking Commands ---
	context.subscriptions.push(...registerMarkingCommands(manager));

	// --- Expand Commands ---
	context.subscriptions.push(...registerExpandCommands(manager));

	// --- Compress Commands ---
	context.subscriptions.push(...registerCompressCommands(manager));
}

export function deactivate() {}
