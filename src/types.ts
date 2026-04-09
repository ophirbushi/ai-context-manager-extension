export type Fidelity = 'map' | 'skeleton' | 'deep_dive';

export type DirectivePreset = 'surgical_fix' | 'discovery' | 'feature_expansion' | 'none';

export interface Directive {
	preset: DirectivePreset;
	custom?: string;
}

export interface ContextEntry {
	path: string; // workspace-relative
	type: 'file' | 'folder';
	ranges?: [number, number][]; // [startLine, endLine] pairs (1-based inclusive)
	pinned?: boolean;
	compressed?: boolean;
	summary?: string; // cached AI compression summary
	glob?: string; // for folders, e.g. "src/auth/**/*"
}

export interface BlueprintData {
	name: string;
	description?: string;
	fidelity: Fidelity;
	directive: Directive;
	entries: ContextEntry[];
	excludes: string[];
}

export interface StagedEntry extends ContextEntry {
	reason?: string; // why expansion suggested this (e.g. "Definition", "Reference")
}
