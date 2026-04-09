import * as vscode from 'vscode';

/**
 * Extract function/class/interface signatures from source code.
 * Uses regex heuristics — works across JS/TS/Python/Go without needing a parser.
 */
export function extractSkeleton(text: string, languageId: string): string {
	switch (languageId) {
		case 'typescript':
		case 'typescriptreact':
		case 'javascript':
		case 'javascriptreact':
			return extractJsTsSkeleton(text);
		case 'python':
			return extractPythonSkeleton(text);
		case 'go':
			return extractGoSkeleton(text);
		default:
			return extractJsTsSkeleton(text); // fallback
	}
}

export async function extractSkeletonForFile(uri: vscode.Uri): Promise<string> {
	const doc = await vscode.workspace.openTextDocument(uri);
	return extractSkeleton(doc.getText(), doc.languageId);
}

function extractJsTsSkeleton(text: string): string {
	const lines = text.split('\n');
	const result: string[] = [];
	let braceDepth = 0;
	let capturing = false;
	let captureUntilBrace = false;

	const signaturePattern = /^(\s*)(export\s+)?(default\s+)?(async\s+)?(function\s+\w+|class\s+\w+|interface\s+\w+|type\s+\w+|enum\s+\w+|const\s+\w+\s*[:=]|let\s+\w+\s*[:=]|var\s+\w+\s*[:=])/;
	const importPattern = /^\s*(import|export)\s/;

	for (const line of lines) {
		if (importPattern.test(line)) {
			result.push(line);
			continue;
		}

		if (signaturePattern.test(line)) {
			capturing = true;
			captureUntilBrace = true;
			braceDepth = 0;
		}

		if (capturing) {
			if (captureUntilBrace) {
				result.push(line);
				for (const ch of line) {
					if (ch === '{') { braceDepth++; }
					if (ch === '}') { braceDepth--; }
				}
				if (braceDepth > 0) {
					// Found opening brace, emit signature + close, stop capturing body
					result.push(line.match(/^\s*/)?.[0] + '  // ...');
					capturing = false;
					captureUntilBrace = false;
				} else if (line.includes(';') || line.includes('=>')) {
					// Single-line declaration
					capturing = false;
					captureUntilBrace = false;
				}
			}
		}
	}

	return result.length > 0 ? result.join('\n') : text.substring(0, 500) + '\n// ... (truncated)';
}

function extractPythonSkeleton(text: string): string {
	const lines = text.split('\n');
	const result: string[] = [];
	const pattern = /^(\s*)(class\s+\w+|def\s+\w+|async\s+def\s+\w+|import\s|from\s)/;

	for (const line of lines) {
		if (pattern.test(line) || line.startsWith('#') || line.trim() === '') {
			result.push(line);
			if (/^(\s*)(class|def|async\s+def)/.test(line)) {
				const indent = line.match(/^\s*/)?.[0] ?? '';
				result.push(indent + '    ...');
			}
		}
	}
	return result.join('\n');
}

function extractGoSkeleton(text: string): string {
	const lines = text.split('\n');
	const result: string[] = [];
	const pattern = /^(package\s|import\s|func\s|type\s|var\s|const\s|\/\/)/;

	for (const line of lines) {
		if (pattern.test(line.trim())) {
			result.push(line);
			if (/^(func|type)\s/.test(line.trim()) && line.includes('{')) {
				result.push('  // ...');
			}
		}
	}
	return result.join('\n');
}
