import { BlueprintData, ContextEntry, Directive, Fidelity } from '../types';
import { estimateTokens } from '../utils/tokens';

export class Blueprint {
	name: string;
	description: string;
	fidelity: Fidelity;
	directive: Directive;
	entries: ContextEntry[];
	excludes: string[];

	constructor(data?: Partial<BlueprintData>) {
		this.name = data?.name ?? 'untitled';
		this.description = data?.description ?? '';
		this.fidelity = data?.fidelity ?? 'deep_dive';
		this.directive = data?.directive ?? { preset: 'none' };
		this.entries = data?.entries ?? [];
		this.excludes = data?.excludes ?? [];
	}

	toJSON(): BlueprintData {
		return {
			name: this.name,
			description: this.description,
			fidelity: this.fidelity,
			directive: this.directive,
			entries: this.entries,
			excludes: this.excludes,
		};
	}

	static fromJSON(data: BlueprintData): Blueprint {
		return new Blueprint(data);
	}

	addEntry(entry: ContextEntry): boolean {
		// Check for duplicates — same path+ranges means duplicate
		const existing = this.entries.find(e =>
			e.path === entry.path &&
			e.type === entry.type &&
			JSON.stringify(e.ranges) === JSON.stringify(entry.ranges)
		);
		if (existing) { return false; }
		this.entries.push(entry);
		return true;
	}

	removeEntry(path: string, ranges?: [number, number][]): boolean {
		const idx = this.entries.findIndex(e =>
			e.path === path &&
			JSON.stringify(e.ranges) === JSON.stringify(ranges)
		);
		if (idx === -1) { return false; }
		this.entries.splice(idx, 1);
		return true;
	}

	removeEntriesByPath(path: string): number {
		const before = this.entries.length;
		this.entries = this.entries.filter(e => e.path !== path);
		return before - this.entries.length;
	}

	togglePin(path: string, ranges?: [number, number][]): void {
		const entry = this.entries.find(e =>
			e.path === path &&
			JSON.stringify(e.ranges) === JSON.stringify(ranges)
		);
		if (entry) {
			entry.pinned = !entry.pinned;
		}
	}

	getEntriesForFile(filePath: string): ContextEntry[] {
		return this.entries.filter(e =>
			e.type === 'file' && e.path === filePath
		);
	}

	estimateTokensForText(text: string): number {
		return estimateTokens(text);
	}
}
