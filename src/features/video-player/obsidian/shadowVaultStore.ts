import type { App } from "obsidian";
import type { ShadowSubtitleDocument } from "../domain/shadowSubtitles";
import type { ShadowSubtitleCheckpoint, ShadowSubtitleStore } from "../domain/shadowSubtitlesJobs";
import {
	validShadowVaultFolder,
	type ShadowPracticeRecord,
	type ShadowPracticeRecordsPort,
	type ShadowingTake,
} from "../domain/types";

const CHECKPOINT_KEY = "study-studio.shadow-subtitles.checkpoints.v1";
const FOLDER_KEY = "study-studio.shadowing.source-folders.v1";
const DEFAULT_VAULT_FOLDER = "Study Studio/影子跟读";
const VALID_RECORD_ID = /^[A-Za-z0-9_-]{1,100}$/;

export interface ShadowVaultAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, text: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	readBinary(path: string): Promise<ArrayBuffer>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	remove(path: string): Promise<void>;
}

export type ShadowVaultApp = Pick<App, "loadLocalStorage" | "saveLocalStorage"> & {
	vault: { adapter: ShadowVaultAdapter };
};

/**
 * Deep vault persistence adapter for video shadowing.
 * Pins each source's vault folder on first use and manages subtitle documents/history,
 * job checkpoints, and serialized practice records + binary takes under that directory.
 */
export class ObsidianShadowVaultStore implements ShadowSubtitleStore, ShadowPracticeRecordsPort {
	private readonly preferredRoot: () => string;
	private readonly roots: Record<string, string>;
	private readonly observedSubtitles = new Map<string, string | null>();
	private readonly historyNeedsVerification = new Set<string>();
	private readonly observedRecords = new Map<string, string | null>();
	private readonly recordWrites = new Map<string, Promise<unknown>>();

	constructor(
		private readonly app: ShadowVaultApp,
		preferredRoot: string | (() => string) = DEFAULT_VAULT_FOLDER,
	) {
		this.preferredRoot =
			typeof preferredRoot === "string" ? () => preferredRoot : preferredRoot;
		const saved: unknown = app.loadLocalStorage(FOLDER_KEY);
		this.roots =
			saved && typeof saved === "object" && !Array.isArray(saved)
				? Object.fromEntries(
						Object.entries(saved).filter(
							(entry): entry is [string, string] => typeof entry[1] === "string",
						),
					)
				: {};
	}

	private get adapter(): ShadowVaultAdapter {
		return this.app.vault.adapter;
	}

	private rootFor(sourceId: string): string {
		const existing = this.roots[sourceId];
		if (existing) {
			if (!validShadowVaultFolder(existing)) {
				throw new Error("保存的练习目录无效，请检查本机设置。");
			}
			return existing;
		}
		const root = this.preferredRoot();
		if (!validShadowVaultFolder(root)) {
			throw new Error("练习资料目录必须位于资料库内。");
		}
		this.roots[sourceId] = root;
		this.app.saveLocalStorage(FOLDER_KEY, this.roots);
		return root;
	}

	private directory(sourceId: string): string {
		return `${this.rootFor(sourceId)}/${encodeURIComponent(sourceId).replaceAll(".", "%2E")}`;
	}

	private async ensureDirectory(path: string): Promise<void> {
		let current = "";
		for (const part of path.split("/")) {
			current = current ? `${current}/${part}` : part;
			if (await this.adapter.exists(current)) continue;
			try {
				await this.adapter.mkdir(current);
			} catch (error) {
				if (!(await this.adapter.exists(current))) throw error;
			}
		}
	}

	async load(id: string): Promise<ShadowSubtitleDocument | null> {
		const directory = this.directory(id);
		const path = `${directory}/subtitles.json`;
		const text = (await this.adapter.exists(path)) ? await this.adapter.read(path) : null;
		const changed = this.observedSubtitles.get(id) !== text;
		this.observedSubtitles.set(id, text);
		if (text !== null) {
			try {
				const document = this.parseSubtitleDocument(text, id);
				if (changed) this.historyNeedsVerification.add(id);
				return document;
			} catch {
				/* Recover the active index from immutable versions. */
			}
		}
		if (!(await this.adapter.exists(directory))) return null;
		const versions: ShadowSubtitleDocument[] = [];
		const files = (await this.adapter.list(directory)).files;
		const recoveryPath = `${directory}/recovery.json`;
		// When revisions tie, prefer the copy of the last known active document.
		const history = files.filter((file) => file.startsWith(`${directory}/revision-`));
		if (files.includes(recoveryPath)) history.unshift(recoveryPath);
		for (const file of history) {
			try {
				versions.push(this.parseSubtitleDocument(await this.adapter.read(file), id));
			} catch {
				/* A partial version does not invalidate other revisions. */
			}
		}
		versions.sort((a, b) => b.revision - a.revision);
		if (versions[0]) return versions[0];
		if (text !== null) throw new Error("字幕资料格式无效，且没有可恢复的版本。");
		return null;
	}

	async save(document: ShadowSubtitleDocument): Promise<void> {
		const id = document.sourceId;
		const directory = this.directory(id);
		await this.ensureDirectory(directory);
		const path = `${directory}/subtitles.json`;
		const current = (await this.adapter.exists(path)) ? await this.adapter.read(path) : null;
		const preserveConflict = async (): Promise<never> => {
			await this.adapter.write(
				`${directory}/conflict-${crypto.randomUUID()}.json`,
				JSON.stringify(document, null, 2),
			);
			throw new Error("字幕资料已被外部修改；已保留冲突副本，请重新载入后选择。");
		};
		if (this.observedSubtitles.has(id) && this.observedSubtitles.get(id) !== current) {
			return preserveConflict();
		}
		if (!this.observedSubtitles.has(id) && current !== null) {
			throw new Error("请先载入字幕资料再保存。");
		}
		const text = JSON.stringify(document, null, 2);
		let previous: ShadowSubtitleDocument | null = null;
		if (current !== null) {
			try {
				previous = this.parseSubtitleDocument(current, id);
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
			const latest = (await this.adapter.exists(path)) ? await this.adapter.read(path) : null;
			if (latest !== current) return preserveConflict();
		}
		await this.adapter.write(path, text);
		this.observedSubtitles.set(id, text);
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

	async list(sourceId: string): Promise<ShadowPracticeRecord[]> {
		const path = this.recordIndexPath(sourceId);
		if (!(await this.adapter.exists(path))) {
			if (this.observedRecords.has(sourceId) && this.observedRecords.get(sourceId) !== null) {
				throw new Error("练习记录已被外部删除，请重新载入。");
			}
			this.observedRecords.set(sourceId, null);
			return [];
		}
		const raw = await this.adapter.read(path);
		if (this.observedRecords.has(sourceId) && this.observedRecords.get(sourceId) !== raw) {
			throw new Error("练习记录已被外部修改，请重新载入。");
		}
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) throw new Error("练习记录格式无效。");
		this.observedRecords.set(sourceId, raw);
		const records = parsed as ShadowPracticeRecord[];
		if (
			records.some(
				(entry) =>
					!entry ||
					typeof entry !== "object" ||
					!VALID_RECORD_ID.test(entry.id) ||
					entry.sourceId !== sourceId ||
					!Number.isFinite(entry.start) ||
					entry.start < 0 ||
					!Number.isFinite(entry.end) ||
					entry.end <= entry.start ||
					typeof entry.text !== "string" ||
					!Number.isFinite(entry.createdAt) ||
					(entry.kind !== "difficult" && entry.kind !== "recording") ||
					(entry.kind === "recording" && !this.validTakePath(entry)) ||
					(entry.kind === "difficult" && !!entry.audioPath),
			)
		) {
			throw new Error("练习记录格式无效，请检查资料库中的记录文件。");
		}
		return records;
	}

	reload(sourceId: string): Promise<ShadowPracticeRecord[]> {
		this.observedRecords.delete(sourceId);
		return this.list(sourceId);
	}

	async markDifficult(
		sourceId: string,
		start: number,
		end: number,
		text: string,
	): Promise<ShadowPracticeRecord> {
		const record: ShadowPracticeRecord = {
			id: crypto.randomUUID(),
			sourceId,
			kind: "difficult",
			start,
			end,
			text,
			createdAt: Date.now(),
		};
		await this.appendRecord(record);
		return record;
	}

	async saveTake(take: ShadowingTake): Promise<ShadowPracticeRecord> {
		const { sourceId, start, end, text = "" } = take.range;
		if (!VALID_RECORD_ID.test(take.id)) throw new Error("录音 ID 无效。");
		const directory = this.directory(sourceId);
		await this.ensureDirectory(directory);
		const extension = take.mimeType.includes("webm")
			? "webm"
			: take.mimeType.includes("mp4")
				? "m4a"
				: "audio";
		const audioPath = `${directory}/take-${take.id}.${extension}`;
		const data = await take.blob.arrayBuffer();
		// A successful binary write is never removed if the index update fails.
		if (!(await this.adapter.exists(audioPath))) {
			await this.adapter.writeBinary(audioPath, data);
		}
		const record: ShadowPracticeRecord = {
			id: take.id,
			sourceId,
			kind: "recording",
			start,
			end,
			text,
			createdAt: take.createdAt,
			playbackRate: take.playbackRate,
			mimeType: take.mimeType,
			audioPath,
		};
		await this.appendRecord(record);
		return record;
	}

	async remove(sourceId: string, recordId: string): Promise<void> {
		await this.serializeRecordWrite(sourceId, async () => {
			const records = await this.list(sourceId);
			const removed = records.find((entry) => entry.id === recordId);
			if (!removed) return;
			await this.writeRecordIndex(
				sourceId,
				records.filter((entry) => entry.id !== recordId),
			);
			if (
				removed.kind === "recording" &&
				this.validTakePath(removed) &&
				(await this.adapter.exists(removed.audioPath!))
			) {
				await this.adapter.remove(removed.audioPath!);
			}
		});
	}

	async readTake(record: ShadowPracticeRecord): Promise<ArrayBuffer> {
		if (record.kind !== "recording" || !this.validTakePath(record)) {
			throw new Error("此记录没有有效的录音文件。");
		}
		return this.adapter.readBinary(record.audioPath!);
	}

	private parseSubtitleDocument(text: string, id: string): ShadowSubtitleDocument {
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
		) {
			throw new Error("字幕资料格式无效。");
		}
		return parsed;
	}

	private async ensurePreviousHistory(
		directory: string,
		revision: number,
		text: string,
	): Promise<void> {
		const prefix = `${directory}/revision-${revision}-`;
		const recoveryPath = `${directory}/recovery.json`;
		const files = (await this.adapter.list(directory)).files;
		const versions = files.filter((file) => file.startsWith(prefix));
		if (files.includes(recoveryPath)) versions.unshift(recoveryPath);
		// An existing recovery copy wins ties. Otherwise a sole matching revision suffices.
		const candidate =
			versions[0] === recoveryPath || versions.length === 1 ? versions[0] : undefined;
		if (candidate) {
			try {
				if ((await this.adapter.read(candidate)) === text) return;
			} catch {
				// An incomplete history file cannot protect the current document.
			}
		}
		await this.adapter.write(recoveryPath, text);
	}

	private writeHistory(directory: string, revision: number, text: string): Promise<void> {
		return this.adapter.write(
			`${directory}/revision-${revision}-${crypto.randomUUID()}.json`,
			text,
		);
	}

	private recordIndexPath(sourceId: string): string {
		return `${this.directory(sourceId)}/practice-records.json`;
	}

	private validTakePath(record: ShadowPracticeRecord): boolean {
		if (!VALID_RECORD_ID.test(record.id) || !record.audioPath) return false;
		const directory = this.directory(record.sourceId);
		return ["webm", "m4a", "audio"].some(
			(extension) => record.audioPath === `${directory}/take-${record.id}.${extension}`,
		);
	}

	private async appendRecord(record: ShadowPracticeRecord): Promise<void> {
		await this.serializeRecordWrite(record.sourceId, async () => {
			const records = await this.list(record.sourceId);
			if (records.some((entry) => entry.id === record.id)) return;
			await this.writeRecordIndex(record.sourceId, [...records, record]);
		});
	}

	private serializeRecordWrite<T>(sourceId: string, work: () => Promise<T>): Promise<T> {
		const next = (this.recordWrites.get(sourceId) ?? Promise.resolve())
			.catch(() => {})
			.then(work);
		this.recordWrites.set(sourceId, next);
		return next;
	}

	private async writeRecordIndex(
		sourceId: string,
		records: readonly ShadowPracticeRecord[],
	): Promise<void> {
		await this.ensureDirectory(this.directory(sourceId));
		const path = this.recordIndexPath(sourceId);
		const current = (await this.adapter.exists(path)) ? await this.adapter.read(path) : null;
		if (this.observedRecords.get(sourceId) !== current) {
			throw new Error("练习记录已被其他窗口或同步修改，请重新载入后重试。");
		}
		const next = JSON.stringify(records, null, 2);
		await this.adapter.write(path, next);
		this.observedRecords.set(sourceId, next);
	}
}
