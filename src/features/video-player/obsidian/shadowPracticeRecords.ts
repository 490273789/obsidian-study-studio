import type { App } from "obsidian";
import type { ShadowingTake } from "../domain/shadowingSession";
import { validShadowVaultFolder } from "../domain/shadowVaultFolder";

export interface ShadowPracticeRecord {
	id: string;
	sourceId: string;
	kind: "difficult" | "recording";
	start: number;
	end: number;
	text: string;
	createdAt: number;
	playbackRate?: number;
	mimeType?: string;
	audioPath?: string;
}

type VaultAdapter = App["vault"]["adapter"];

/** Immutable recordings plus a rebuildable per-video index in the vault. */
export class ShadowPracticeRecords {
	private observed = new Map<string, string | null>();
	private writes = new Map<string, Promise<unknown>>();
	constructor(
		private readonly adapter: VaultAdapter,
		private readonly root: string | ((sourceId: string) => string) = "Study Studio/影子跟读",
	) {}

	private directory(sourceId: string): string {
		const root = typeof this.root === "string" ? this.root : this.root(sourceId);
		if (!validShadowVaultFolder(root)) throw new Error("练习资料目录必须位于资料库内。");
		return `${root}/${encodeURIComponent(sourceId).replaceAll(".", "%2E")}`;
	}

	private indexPath(sourceId: string): string {
		return `${this.directory(sourceId)}/practice-records.json`;
	}

	private validTakePath(record: ShadowPracticeRecord): boolean {
		if (!/^[A-Za-z0-9_-]{1,100}$/.test(record.id) || !record.audioPath) return false;
		return ["webm", "m4a", "audio"].some(
			(extension) =>
				record.audioPath ===
				`${this.directory(record.sourceId)}/take-${record.id}.${extension}`,
		);
	}

	private async ensureDirectory(sourceId: string): Promise<void> {
		let current = "";
		for (const part of this.directory(sourceId).split("/")) {
			current = current ? `${current}/${part}` : part;
			if (await this.adapter.exists(current)) continue;
			try {
				await this.adapter.mkdir(current);
			} catch (error) {
				if (!(await this.adapter.exists(current))) throw error;
			}
		}
	}

	async list(sourceId: string): Promise<ShadowPracticeRecord[]> {
		const path = this.indexPath(sourceId);
		if (!(await this.adapter.exists(path))) {
			if (this.observed.has(sourceId) && this.observed.get(sourceId) !== null)
				throw new Error("练习记录已被外部删除，请重新载入。");
			this.observed.set(sourceId, null);
			return [];
		}
		const raw = await this.adapter.read(path);
		if (this.observed.has(sourceId) && this.observed.get(sourceId) !== raw)
			throw new Error("练习记录已被外部修改，请重新载入。");
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) throw new Error("练习记录格式无效。");
		this.observed.set(sourceId, raw);
		const records = parsed as ShadowPracticeRecord[];
		if (
			records.some(
				(entry) =>
					!entry ||
					typeof entry !== "object" ||
					!/^[A-Za-z0-9_-]{1,100}$/.test(entry.id) ||
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
		)
			throw new Error("练习记录格式无效，请检查资料库中的记录文件。");
		return records;
	}

	reload(sourceId: string): Promise<ShadowPracticeRecord[]> {
		this.observed.delete(sourceId);
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
		await this.append(record);
		return record;
	}

	async saveTake(take: ShadowingTake): Promise<ShadowPracticeRecord> {
		const { sourceId, start, end, text = "" } = take.range;
		if (!/^[A-Za-z0-9_-]{1,100}$/.test(take.id)) throw new Error("录音 ID 无效。");
		await this.ensureDirectory(sourceId);
		const extension = take.mimeType.includes("webm")
			? "webm"
			: take.mimeType.includes("mp4")
				? "m4a"
				: "audio";
		const audioPath = `${this.directory(sourceId)}/take-${take.id}.${extension}`;
		const data = await take.blob.arrayBuffer();
		// A successful binary write is never removed if the index update fails.
		if (!(await this.adapter.exists(audioPath)))
			await this.adapter.writeBinary(audioPath, data);
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
		await this.append(record);
		return record;
	}

	async remove(sourceId: string, recordId: string): Promise<void> {
		await this.serialize(sourceId, async () => {
			const records = await this.list(sourceId);
			const removed = records.find((entry) => entry.id === recordId);
			if (!removed) return;
			await this.writeIndex(
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
		if (record.kind !== "recording" || !this.validTakePath(record))
			throw new Error("此记录没有有效的录音文件。");
		return this.adapter.readBinary(record.audioPath!);
	}

	private async append(record: ShadowPracticeRecord): Promise<void> {
		await this.serialize(record.sourceId, async () => {
			const records = await this.list(record.sourceId);
			if (records.some((entry) => entry.id === record.id)) return;
			await this.writeIndex(record.sourceId, [...records, record]);
		});
	}

	private serialize<T>(sourceId: string, work: () => Promise<T>): Promise<T> {
		const next = (this.writes.get(sourceId) ?? Promise.resolve()).catch(() => {}).then(work);
		this.writes.set(sourceId, next);
		return next;
	}

	private async writeIndex(
		sourceId: string,
		records: readonly ShadowPracticeRecord[],
	): Promise<void> {
		await this.ensureDirectory(sourceId);
		const path = this.indexPath(sourceId);
		const current = (await this.adapter.exists(path)) ? await this.adapter.read(path) : null;
		if (this.observed.get(sourceId) !== current) {
			throw new Error("练习记录已被其他窗口或同步修改，请重新载入后重试。");
		}
		const next = JSON.stringify(records, null, 2);
		await this.adapter.write(path, next);
		this.observed.set(sourceId, next);
	}
}
