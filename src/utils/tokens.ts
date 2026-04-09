export function estimateTokens(text: string): number {
	// ~4 characters per token is a reasonable heuristic for code
	return Math.ceil(text.length / 4);
}

export function formatTokenCount(tokens: number): string {
	if (tokens >= 1000) {
		return `${(tokens / 1000).toFixed(1)}k`;
	}
	return `${tokens}`;
}
