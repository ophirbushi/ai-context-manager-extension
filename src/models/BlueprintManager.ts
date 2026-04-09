import * as vscode from 'vscode';
import * as path from 'path';
import { Blueprint } from './Blueprint';
import { BlueprintData, ContextEntry, StagedEntry } from '../types';

const CONTEXTS_DIR = '.vscode/contexts';

export class BlueprintManager {
	private _blueprints: Map<string, Blueprint> = new Map();
	private _active: Blueprint | undefined;
	private _stagedEntries: StagedEntry[] = [];

	private _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private _onDidChangeStaged = new vscode.EventEmitter<void>();
	readonly onDidChangeStaged = this._onDidChangeStaged.event;

	get active(): Blueprint | undefined { return this._active; }
	get blueprints(): Blueprint[] { return Array.from(this._blueprints.values()); }
	get stagedEntries(): StagedEntry[] { return this._stagedEntries; }

	private getContextsUri(): vscode.Uri | undefined {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) { return undefined; }
		return vscode.Uri.joinPath(folder.uri, CONTEXTS_DIR);
	}

	async loadAll(): Promise<void> {
		const dir = this.getContextsUri();
		if (!dir) { return; }

		try {
			const entries = await vscode.workspace.fs.readDirectory(dir);
			for (const [name, type] of entries) {
				if (type === vscode.FileType.File && name.endsWith('.aicontext')) {
					const uri = vscode.Uri.joinPath(dir, name);
					try {
						const raw = await vscode.workspace.fs.readFile(uri);
						const data: BlueprintData = JSON.parse(Buffer.from(raw).toString('utf-8'));
						const bp = Blueprint.fromJSON(data);
						this._blueprints.set(bp.name, bp);
					} catch { /* skip corrupt files */ }
				}
			}
		} catch {
			// Directory doesn't exist yet — that's fine
		}
	}

	async create(name: string, description?: string): Promise<Blueprint> {
		const sanitized = name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim();
		if (!sanitized) { throw new Error('Invalid blueprint name'); }
		if (this._blueprints.has(sanitized)) { throw new Error(`Blueprint "${sanitized}" already exists`); }

		const bp = new Blueprint({ name: sanitized, description });
		this._blueprints.set(sanitized, bp);
		await this.save(bp);
		return bp;
	}

	async activate(name: string): Promise<void> {
		const bp = this._blueprints.get(name);
		if (!bp) { throw new Error(`Blueprint "${name}" not found`); }
		this._active = bp;
		this._stagedEntries = [];
		this._onDidChange.fire();
		this._onDidChangeStaged.fire();
	}

	deactivate(): void {
		this._active = undefined;
		this._stagedEntries = [];
		this._onDidChange.fire();
		this._onDidChangeStaged.fire();
	}

	async deleteBlueprint(name: string): Promise<void> {
		const dir = this.getContextsUri();
		if (!dir) { return; }

		if (this._active?.name === name) {
			this.deactivate();
		}
		this._blueprints.delete(name);

		const fileUri = vscode.Uri.joinPath(dir, `${this.toFilename(name)}.aicontext`);
		try { await vscode.workspace.fs.delete(fileUri); } catch { /* ok if missing */ }
		this._onDidChange.fire();
	}

	async save(bp?: Blueprint): Promise<void> {
		const target = bp ?? this._active;
		if (!target) { return; }

		const dir = this.getContextsUri();
		if (!dir) { return; }

		await vscode.workspace.fs.createDirectory(dir);
		const fileUri = vscode.Uri.joinPath(dir, `${this.toFilename(target.name)}.aicontext`);
		const content = JSON.stringify(target.toJSON(), null, 2);
		await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
	}

	async mutateActive(fn: (bp: Blueprint) => void): Promise<void> {
		if (!this._active) { return; }
		fn(this._active);
		await this.save();
		this._onDidChange.fire();
	}

	// --- Staging area (for Expand feature) ---

	setStagedEntries(entries: StagedEntry[]): void {
		this._stagedEntries = entries;
		this._onDidChangeStaged.fire();
	}

	clearStaged(): void {
		this._stagedEntries = [];
		this._onDidChangeStaged.fire();
	}

	async mergeStaged(selected: StagedEntry[]): Promise<void> {
		if (!this._active) { return; }
		for (const entry of selected) {
			this._active.addEntry({
				path: entry.path,
				type: entry.type,
				ranges: entry.ranges,
			});
		}
		this._stagedEntries = [];
		await this.save();
		this._onDidChange.fire();
		this._onDidChangeStaged.fire();
	}

	// --- Helpers ---

	private toFilename(name: string): string {
		return name.toLowerCase().replace(/\s+/g, '-');
	}
}
