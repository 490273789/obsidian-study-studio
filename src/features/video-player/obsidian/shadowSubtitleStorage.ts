import type { App } from "obsidian";
import type { ShadowSubtitleDocument } from "../domain/shadowSubtitles";
import type { ShadowSubtitleCheckpoint, ShadowSubtitleStore } from "../domain/shadowSubtitlesJobs";
import { validShadowVaultFolder } from "../domain/shadowVaultFolder";

const CHECKPOINT_KEY = "study-studio.shadow-subtitles.checkpoints.v1";
interface ShadowVault {
	adapter: {
		exists(path: string): Promise<boolean>;
		read(path: string): Promise<string>;
		write(path: string, text: string): Promise<void>;
		mkdir(path: string): Promise<void>;
		list(path: string): Promise<{ files: string[]; folders: string[] }>;
	};
}
/** Subtitles are vault files; absolute video paths and checkpoints remain device-local. */
export class ObsidianShadowSubtitleStore implements ShadowSubtitleStore {
	private observed = new Map<string, string | null>();
	private historyNeedsVerification = new Set<string>();
	constructor(
		private readonly app: Pick<App, "loadLocalStorage" | "saveLocalStorage"> & {
			vault: ShadowVault;
		},
		private readonly root = "Study Studio/影子跟读",
	) {
		if (!validShadowVaultFolder(root)) throw new Error("练习资料目录必须位于资料库内。");
	}
	private directory(id: string): string {
		return `${this.root}/${encodeURIComponent(id).replaceAll(".", "%2E")}`;
	}
	private async ensureDirectory(path: string): Promise<void> {
		let current = "";
		for (const part of path.split("/")) {
			current = current ? `${current}/${part}` : part;
			if (!(await this.app.vault.adapter.exists(current))) {
				try {
					await this.app.vault.adapter.mkdir(current);
				} catch (error) {
					if (!(await this.app.vault.adapter.exists(current))) throw error;
				}
			}
		}
	}
	async load(id: string): Promise<ShadowSubtitleDocument | null> {
		const directory = this.directory(id);
		const path = `${directory}/subtitles.json`;
		const adapter = this.app.vault.adapter;
		const text = (await adapter.exists(path)) ? await adapter.read(path) : null;
		const changed = this.observed.get(id) !== text;
		this.observed.set(id, text);
		if (text !== null) {
			try {
				const document = this.parse(text, id);
				if (changed) this.historyNeedsVerification.add(id);
				return document;
			} catch {
				/* Recover the active index from immutable versions. */
			}
		}
		if (!(await adapter.exists(directory))) return null;
		const versions: ShadowSubtitleDocument[] = [];
		const files = (await adapter.list(directory)).files;
		const recoveryPath = `${directory}/recovery.json`;
		// When revisions tie, prefer the copy of the last known active document.
		const history = files.filter((file) => file.startsWith(`${directory}/revision-`));
		if (files.includes(recoveryPath)) history.unshift(recoveryPath);
		for (const file of history) {
			try {
				versions.push(this.parse(await adapter.read(file), id));
			} catch {
				/* A partial version does not invalidate other revisions. */
			}
		}
		versions.sort((a, b) => b.revision - a.revision);
		if (versions[0]) return versions[0];
		if (text !== null) throw new Error("字幕资料格式无效，且没有可恢复的版本。");
		return null;
	}
	private parse(text: string, id: string): ShadowSubtitleDocument {
		const parsed = JSON.parse(text) as ShadowSubtitleDocument;
		const validCues = (value: unknown): boolean =>
			Array.isArray(value) &&
			value.every(
				(cue) =>
					cue &&
					typeof cue.id === "string" &&
					typeof cue.text === "string" &&
					typeof cue.translation === "string" &&
					Number.isFinite(cue.start) &&
					Number.isFinite(cue.end) &&
					cue.start >= 0 &&
					cue.end > cue.start &&
					Number.isFinite(cue.revision),
			);
		if (
			!parsed ||
			parsed.sourceId !== id ||
			!validCues(parsed.cues) ||
			!Number.isInteger(parsed.revision) ||
			parsed.revision < 0 ||
			(parsed.previous !== null && !validCues(parsed.previous)) ||
			(parsed.candidate !== null && !validCues(parsed.candidate))
		)
			throw new Error("字幕资料格式无效。");
		return parsed;
	}
	private async ensurePreviousHistory(
		directory: string,
		revision: number,
		text: string,
	): Promise<void> {
		const adapter = this.app.vault.adapter;
		const prefix = `${directory}/revision-${revision}-`;
		const recoveryPath = `${directory}/recovery.json`;
		const files = (await adapter.list(directory)).files;
		const versions = files.filter((file) => file.startsWith(prefix));
		if (files.includes(recoveryPath)) versions.unshift(recoveryPath);
		// An existing recovery copy wins ties. Otherwise a sole matching revision suffices.
		const candidate =
			versions[0] === recoveryPath || versions.length === 1 ? versions[0] : undefined;
		if (candidate) {
			try {
				if ((await adapter.read(candidate)) === text) return;
			} catch {
				// An incomplete history file cannot protect the current document.
			}
		}
		await adapter.write(recoveryPath, text);
	}
	private writeHistory(directory: string, revision: number, text: string): Promise<void> {
		return this.app.vault.adapter.write(
			`${directory}/revision-${revision}-${crypto.randomUUID()}.json`,
			text,
		);
	}
	async save(document: ShadowSubtitleDocument): Promise<void> {
		const id = document.sourceId;
		const directory = this.directory(id);
		await this.ensureDirectory(directory);
		const path = `${directory}/subtitles.json`;
		const adapter = this.app.vault.adapter;
		const current = (await adapter.exists(path)) ? await adapter.read(path) : null;
		const preserveConflict = async (): Promise<never> => {
			await adapter.write(
				`${directory}/conflict-${crypto.randomUUID()}.json`,
				JSON.stringify(document, null, 2),
			);
			throw new Error("字幕资料已被外部修改；已保留冲突副本，请重新载入后选择。");
		};
		if (this.observed.has(id) && this.observed.get(id) !== current) return preserveConflict();
		if (!this.observed.has(id) && current !== null) throw new Error("请先载入字幕资料再保存。");
		const text = JSON.stringify(document, null, 2);
		let previous: ShadowSubtitleDocument | null = null;
		if (current !== null) {
			try {
				previous = this.parse(current, id);
			} catch {
				/* Snapshot before repairing an invalid index. */
			}
		}
		const manualEdit = document.cues.some((cue) => {
			const old = previous?.cues.find((item) => item.id === cue.id);
			return (
				old &&
				((cue.textEdited && cue.text !== old.text) ||
					(cue.translationEdited && cue.translation !== old.translation))
			);
		});
		const versioned =
			!previous ||
			document.revision <= 2 ||
			document.revision % 25 === 0 ||
			manualEdit ||
			!!document.previous !== !!previous.previous ||
			!!document.candidate !== !!previous.candidate;
		if (previous && current !== null && this.historyNeedsVerification.has(id)) {
			// Protect the accepted document before overwriting an uncertain history entry.
			await this.ensurePreviousHistory(directory, previous.revision, current);
			const latest = (await adapter.exists(path)) ? await adapter.read(path) : null;
			if (latest !== current) return preserveConflict();
		}
		await adapter.write(path, text);
		this.observed.set(id, text);
		this.historyNeedsVerification.delete(id);
		if (versioned) {
			try {
				await this.writeHistory(directory, document.revision, text);
			} catch (error) {
				// The active document has committed. Missing history must not report a failed save.
				this.historyNeedsVerification.add(id);
				console.warn("Unable to create a Study Studio subtitle revision", error);
			}
		}
	}
	loadCheckpoints(): ShadowSubtitleCheckpoint[] {
		const raw: unknown = this.app.loadLocalStorage(CHECKPOINT_KEY);
		if (!Array.isArray(raw)) return [];
		return raw.filter(
			(item): item is ShadowSubtitleCheckpoint =>
				!!item &&
				typeof item === "object" &&
				typeof item.source?.id === "string" &&
				typeof item.source?.path === "string" &&
				typeof item.config?.serviceSignature === "string" &&
				typeof item.config?.sourceSignature === "string" &&
				Number.isFinite(item.nextOffset) &&
				item.nextOffset >= 0,
		);
	}
	saveCheckpoints(checkpoints: ShadowSubtitleCheckpoint[]): void {
		this.app.saveLocalStorage(CHECKPOINT_KEY, checkpoints);
	}
	async listSourceIds(): Promise<string[]> {
		if (!(await this.app.vault.adapter.exists(this.root))) return [];
		return (await this.app.vault.adapter.list(this.root)).folders.flatMap((folder) => {
			try {
				return [decodeURIComponent(folder.slice(folder.lastIndexOf("/") + 1))];
			} catch {
				return [];
			}
		});
	}
}
