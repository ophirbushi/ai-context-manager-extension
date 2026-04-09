import * as vscode from 'vscode';
import * as path from 'path';

export async function getWorkspaceFileTree(excludePatterns: string[] = []): Promise<string> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) { return '(no workspace open)'; }

	const defaultExcludes = [
		'**/node_modules/**', '**/.git/**', '**/out/**', '**/dist/**',
		'**/.vscode/contexts/**', '**/*.aicontext', '**/.aicontext.md'
	];
	const allExcludes = [...defaultExcludes, ...excludePatterns].join(',');
	const files = await vscode.workspace.findFiles('**/*', `{${allExcludes}}`, 2000);

	const root = workspaceFolder.uri.fsPath;
	const relativePaths = files
		.map(f => path.relative(root, f.fsPath))
		.sort();

	return buildTreeString(relativePaths);
}

function buildTreeString(paths: string[]): string {
	const tree: Record<string, any> = {};
	for (const p of paths) {
		const parts = p.split(path.sep);
		let node = tree;
		for (const part of parts) {
			if (!node[part]) { node[part] = {}; }
			node = node[part];
		}
	}
	return renderTree(tree, '');
}

function renderTree(node: Record<string, any>, indent: string): string {
	const entries = Object.keys(node).sort((a, b) => {
		const aIsDir = Object.keys(node[a]).length > 0;
		const bIsDir = Object.keys(node[b]).length > 0;
		if (aIsDir !== bIsDir) { return aIsDir ? -1 : 1; }
		return a.localeCompare(b);
	});

	let result = '';
	for (let i = 0; i < entries.length; i++) {
		const name = entries[i];
		const isLast = i === entries.length - 1;
		const children = node[name];
		const hasChildren = Object.keys(children).length > 0;
		const prefix = isLast ? '└── ' : '├── ';
		const childIndent = indent + (isLast ? '    ' : '│   ');

		result += `${indent}${prefix}${name}${hasChildren ? '/' : ''}\n`;
		if (hasChildren) {
			result += renderTree(children, childIndent);
		}
	}
	return result;
}
