import * as vscode from 'vscode';
import { BlueprintManager } from '../models/BlueprintManager';

export function registerCompressCommands(manager: BlueprintManager): vscode.Disposable[] {
	const disposables: vscode.Disposable[] = [];

	disposables.push(vscode.commands.registerCommand('aiContextManager.compressEntry',
		async (entryPath?: string) => {
			if (!manager.active || !entryPath) { return; }

			const entry = manager.active.entries.find(e => e.path === entryPath);
			if (!entry) { return; }

			if (entry.compressed && entry.summary) {
				// Already compressed — decompress
				await manager.mutateActive(bp => {
					const e = bp.entries.find(e => e.path === entryPath);
					if (e) {
						e.compressed = false;
						e.summary = undefined;
					}
				});
				vscode.window.setStatusBarMessage(`$(check) Decompressed ${entryPath}`, 2000);
				return;
			}

			// Try to use vscode.lm API
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Compressing ${entryPath}...`,
				cancellable: true,
			}, async (progress, token) => {
				try {
					const models = await vscode.lm.selectChatModels({
						vendor: 'copilot',
					});

					if (models.length === 0) {
						vscode.window.showWarningMessage(
							'No language model available. Install GitHub Copilot to use compression, or the entry will use skeleton mode as fallback.'
						);
						return;
					}

					const model = models[0];
					const folder = vscode.workspace.workspaceFolders?.[0];
					if (!folder) { return; }

					const uri = vscode.Uri.joinPath(folder.uri, entryPath);
					let content: string;

					try {
						const doc = await vscode.workspace.openTextDocument(uri);
						content = doc.getText();
					} catch {
						// For folders, gather all files
						const glob = entry.glob ?? `${entry.path}/**/*`;
						const files = await vscode.workspace.findFiles(glob, undefined, 50);
						const parts: string[] = [];
						for (const f of files) {
							try {
								const doc = await vscode.workspace.openTextDocument(f);
								parts.push(`--- ${f.fsPath} ---\n${doc.getText()}`);
							} catch { /* skip */ }
						}
						content = parts.join('\n\n');
					}

					const messages = [
						vscode.LanguageModelChatMessage.User(
							`Summarize this code for another AI agent. Provide a dense, 3-4 sentence overview of its core responsibility, list its public exports/interfaces with their signatures, and note any important side-effects or external dependencies. Do not output raw code blocks.\n\n${content}`
						),
					];

					const response = await model.sendRequest(messages, {}, token);
					let summary = '';
					for await (const chunk of response.text) {
						summary += chunk;
					}

					await manager.mutateActive(bp => {
						const e = bp.entries.find(e => e.path === entryPath);
						if (e) {
							e.compressed = true;
							e.summary = summary.trim();
						}
					});

					vscode.window.setStatusBarMessage(`$(check) Compressed ${entryPath}`, 2000);
				} catch (err) {
					if (err instanceof vscode.LanguageModelError) {
						vscode.window.showErrorMessage(`Compression failed: ${err.message}`);
					} else {
						throw err;
					}
				}
			});
		}
	));

	return disposables;
}
