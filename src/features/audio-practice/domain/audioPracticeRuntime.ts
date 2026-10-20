import { audioFailure, type AudioFailure, toAudioFailure } from "./failures";
import { emptyProgress, normalizeAudioPracticeData } from "./repository";
import { parseSubtitles, serializeSrt, validateCues } from "./subtitles";
import type { AudioPracticeSettings } from "../settings/slice";
import type {
	AudioSourceFiles,
	DraftCue,
	GenerationInput,
	TranscriptionConfig,
} from "../generation/types";
import type { SubtitleGeneration } from "../generation/subtitleGeneration";
import { validateTranscriptionConfig } from "../generation/transcriptionConfig";
import { MAX_AUDIO_BYTES } from "../generation/limits";
import { alignTimedWords } from "../generation/wordAlignment";
import {
	AUDIO_PLAYBACK_RATES,
	type AudioMaterial,
	type AudioMediaPort,
	type AudioPracticeData,
	type AudioPracticeDraftSnapshot,
	type AudioPracticeDraftStatus,
	type AudioPracticeFiles,
	type AudioPracticeMode,
	type AudioPracticeProgress,
	type AudioPracticeRepository,
	type AudioPracticeSnapshot,
	type MaterialOperationKind,
	type MaterialOperationSnapshot,
	type AudioPlaybackRate,
	type AudioFileChange,
	type SubtitleCue,
	type TimedTextWord,
} from "./types";

export interface AudioPracticeSettingsReader {
	read(): AudioPracticeSettings;
	readSecret(id: string): string | null;
}

export interface AudioPracticeRuntimeOptions {
	readonly repository: AudioPracticeRepository;
	readonly files: AudioPracticeFiles;
	readonly source?: AudioSourceFiles;
	readonly settings?: AudioPracticeSettingsReader;
	readonly generation?: SubtitleGeneration;
}

interface MaterialEdit {
	readonly id: string;
	readonly epoch: number;
	readonly previous: AudioMaterial;
	readonly watchedPaths: readonly string[];
	invalidated: boolean;
}

/** Owns playback, synchronized learning metadata, and subtitle draft workflows. */
export class AudioPracticeRuntime {
	private readonly repository: AudioPracticeRepository;
	private readonly files: AudioPracticeFiles;
	private readonly source?: AudioSourceFiles;
	private readonly settings?: AudioPracticeSettingsReader;
	private readonly generationService?: SubtitleGeneration;

	private data: AudioPracticeData;
	private cues: readonly SubtitleCue[] = [];
	private media: AudioMediaPort | null = null;
	private snapshot!: AudioPracticeSnapshot;
	private listeners = new Set<() => void>();
	private releases: (() => void)[] = [];
	private error: AudioFailure | null = null;
	private draftError: AudioFailure | null = null;
	private savingDraft = false;
	private revealed = false;
	private loading = false;
	private loadingMedia = false;
	private disposed = false;
	private generation = 0;
	private invalidatedMarks = 0;
	private previewEnd: number | null = null;
	private lastSave = 0;
	private persistenceTail: Promise<void> = Promise.resolve();
	private epoch = 0;
	private boundaryTimer: ReturnType<typeof setTimeout> | null = null;
	private boundaryToken = 0;
	private wordBoundaryTimer: ReturnType<typeof setTimeout> | null = null;
	private wordBoundaryToken = 0;
	private mediaBuffering = false;
	private mediaBufferingAt = 0;
	private mediaLease = 0;
	private subtitleOperation = new Map<string, number>();
	private materialEdit: MaterialEdit | null = null;
	private draftSourceValidated = true;
	private draftValidationToken = 0;
	private materialOperation: MaterialOperationSnapshot = {
		id: 0,
		kind: null,
		materialId: null,
		status: "idle",
		failure: null,
	};

	constructor(
		repositoryOrOptions: AudioPracticeRepository | AudioPracticeRuntimeOptions,
		files?: AudioPracticeFiles,
		extra?: {
			source?: AudioSourceFiles;
			settings?: AudioPracticeSettingsReader;
			generation?: SubtitleGeneration;
		},
	) {
		if ("repository" in repositoryOrOptions) {
			this.repository = repositoryOrOptions.repository;
			this.files = repositoryOrOptions.files;
			this.source = repositoryOrOptions.source;
			this.settings = repositoryOrOptions.settings;
			this.generationService = repositoryOrOptions.generation;
		} else {
			this.repository = repositoryOrOptions;
			this.files = files!;
			this.source = extra?.source;
			this.settings = extra?.settings;
			this.generationService = extra?.generation;
		}

		this.data = normalizeAudioPracticeData(this.repository.load());
		this.releases.push(
			this.repository.subscribeExternal(() => {
				const previous = this.currentMaterial();
				this.epoch++;
				this.loadingMedia = true;
				this.media?.pause();
				this.loadingMedia = false;
				this.data = normalizeAudioPracticeData(this.repository.load());
				const current = this.currentMaterial();
				if (
					previous?.id === current?.id &&
					(previous?.audioPath !== current?.audioPath ||
						previous?.originalText !== current?.originalText)
				) {
					this.draftValidationToken++;
					this.draftSourceValidated = false;
				}
				void this.loadMaterial();
			}),
		);
		if (this.files.subscribe) this.releases.push(this.files.subscribe(this.handleFileChange));
		if (this.generationService) {
			this.releases.push(this.generationService.subscribe(() => this.publish()));
		}
		this.publish();
		void this.loadMaterial();
	}
	getSnapshot = (): AudioPracticeSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	bindMedia(media: AudioMediaPort): () => void {
		this.unbindMedia();
		if (this.disposed) return () => {};
		this.media = media;
		const lease = ++this.mediaLease;
		for (const [event, listener] of Object.entries(this.mediaEvents))
			media.addEventListener(event, listener);
		this.loadMedia();
		return () => {
			if (this.media === media && this.mediaLease === lease) this.unbindMedia();
		};
	}
	async addMaterial(input: {
		title: string;
		audioPath: string;
		subtitlePath?: string | null;
		originalText?: string;
	}): Promise<string> {
		const material: AudioMaterial = {
			id: globalThis.crypto.randomUUID(),
			title: input.title.trim() || input.audioPath.split("/").slice(-1)[0] || "音频",
			audioPath: input.audioPath,
			subtitlePath: input.subtitlePath ?? null,
			originalText: input.originalText ?? "",
		};
		return this.runMaterialOperation("add", material.id, async () => {
			const epoch = this.epoch;
			const staged = await this.stageMaterial(material);
			const committed = await this.commitMaterialChange(
				epoch,
				() => staged.assertUnchanged(),
				(data) => ({
					...data,
					materials: [...data.materials, material],
					currentMaterialId: material.id,
					progress: {
						...data.progress,
						[material.id]: {
							...emptyProgress(),
							cueId: staged.cues[0]?.id ?? null,
						},
					},
				}),
			);
			if (committed) this.installMaterial(staged.cues, 0);
			return material.id;
		});
	}
	async editMaterial(
		id: string,
		input: {
			readonly title: string;
			readonly audioPath: string;
			readonly subtitlePath: string | null;
			readonly originalText: string;
		},
		expected?: AudioMaterial,
	): Promise<void> {
		return this.runMaterialOperation("edit", id, () =>
			this.performEditMaterial(id, input, expected),
		);
	}
	private async performEditMaterial(
		id: string,
		input: {
			readonly title: string;
			readonly audioPath: string;
			readonly subtitlePath: string | null;
			readonly originalText: string;
		},
		expected?: AudioMaterial,
	): Promise<void> {
		const previous = this.data.materials.find((item) => item.id === id);
		if (
			!previous ||
			this.disposed ||
			this.materialEdit ||
			this.data.currentMaterialId !== id ||
			(expected && !sameMaterial(previous, expected))
		)
			throw audioFailure({ kind: "stale-material" });
		const next: AudioMaterial = {
			...previous,
			title: input.title.trim() || previous.title,
			audioPath: input.audioPath,
			subtitlePath: input.subtitlePath,
			originalText: input.originalText,
			wordTimings:
				input.audioPath === previous.audioPath &&
				input.subtitlePath === previous.subtitlePath
					? previous.wordTimings
					: undefined,
		};
		const audioChanged = next.audioPath !== previous.audioPath;
		const subtitleChanged = next.subtitlePath !== previous.subtitlePath;
		const draftSourceChanged = audioChanged || next.originalText !== previous.originalText;
		const edit: MaterialEdit = {
			id,
			epoch: this.epoch,
			previous,
			watchedPaths: [
				previous.audioPath,
				previous.subtitlePath,
				next.audioPath,
				next.subtitlePath,
			].filter((path): path is string => path !== null),
			invalidated: false,
		};
		this.materialEdit = edit;
		try {
			let nextCues: readonly SubtitleCue[] | null = null;
			let audioStat: ReturnType<AudioPracticeFiles["stat"]> = null;
			let subtitleStat: ReturnType<AudioPracticeFiles["stat"]> = null;
			if (audioChanged || subtitleChanged) {
				audioStat = this.files.stat(next.audioPath);
				if (!audioStat) throw audioFailure({ kind: "missing-file" });
				subtitleStat = next.subtitlePath ? this.files.stat(next.subtitlePath) : null;
				if (next.subtitlePath && !subtitleStat)
					throw audioFailure({ kind: "missing-file" });
				nextCues = next.subtitlePath
					? parseSubtitles(await this.files.readText(next.subtitlePath))
					: [];
				this.assertMaterialEdit(edit);
				if (
					!sameFileStat(audioStat, this.files.stat(next.audioPath)) ||
					(next.subtitlePath &&
						!sameFileStat(subtitleStat, this.files.stat(next.subtitlePath)))
				)
					throw audioFailure({ kind: "stale-material" });
			}
			const commit = this.persistenceTail.then(async () => {
				this.assertMaterialEdit(edit);
				if (
					(audioStat && !sameFileStat(audioStat, this.files.stat(next.audioPath))) ||
					(subtitleStat &&
						!sameFileStat(subtitleStat, this.files.stat(next.subtitlePath!)))
				)
					throw audioFailure({ kind: "stale-material" });
				const dataBeforeSave = this.data;
				const prepare = (data: AudioPracticeData) => {
					const progress = data.progress[id] ?? emptyProgress();
					const remapped =
						!audioChanged && subtitleChanged
							? remapCueProgress(this.cues, nextCues!, progress)
							: null;
					const prepared: AudioPracticeData = {
						...data,
						materials: data.materials.map((item) => (item.id === id ? next : item)),
						progress:
							audioChanged || remapped
								? {
										...data.progress,
										[id]: audioChanged ? emptyProgress() : remapped!.progress,
									}
								: data.progress,
					};
					return { prepared, remapped };
				};
				try {
					await this.repository.save(prepare(dataBeforeSave).prepared);
				} catch {
					if (edit.epoch !== this.epoch) throw audioFailure({ kind: "stale-material" });
					throw audioFailure({ kind: "persist-failed" });
				}
				if (this.disposed || edit.epoch !== this.epoch)
					throw audioFailure({ kind: "stale-material" });
				try {
					this.assertMaterialEdit(edit);
					if (
						(audioStat && !sameFileStat(audioStat, this.files.stat(next.audioPath))) ||
						(subtitleStat &&
							!sameFileStat(subtitleStat, this.files.stat(next.subtitlePath!)))
					)
						throw audioFailure({ kind: "stale-material" });
				} catch {
					// A file event can arrive while the save is pending. Restore the live state
					// before the queued file-event persistence runs.
					try {
						await this.repository.save(this.data);
					} catch {
						if (edit.epoch !== this.epoch)
							throw audioFailure({ kind: "stale-material" });
						// The first save committed. If rollback cannot be persisted, adopt
						// the authoritative document so callers never see a false failure.
						this.data = normalizeAudioPracticeData(this.repository.load());
						await this.loadMaterial(true);
						return;
					}
					throw audioFailure({ kind: "stale-material" });
				}
				const changedDuringSave = this.data !== dataBeforeSave;
				const { prepared, remapped } = prepare(this.data);
				this.data = prepared;
				if (changedDuringSave) void this.persist();
				if (nextCues) {
					this.cues = nextCues;
					this.invalidatedMarks = remapped?.invalidatedMarks ?? 0;
					this.revealed = false;
					if (audioChanged) {
						this.previewEnd = null;
						this.loadMedia();
					} else this.scheduleBoundary();
				}
				if (draftSourceChanged) {
					this.draftValidationToken++;
					this.draftSourceValidated = false;
					if (this.generationService?.getSnapshot().taskKey === id)
						this.generationService.cancel();
				}
				this.publish();
			});
			this.persistenceTail = commit.catch(() => {});
			await commit;
		} finally {
			if (this.materialEdit === edit) this.materialEdit = null;
		}
	}
	private assertMaterialEdit(edit: MaterialEdit): void {
		const current = this.data.materials.find((item) => item.id === edit.id);
		if (
			this.disposed ||
			this.materialEdit !== edit ||
			edit.invalidated ||
			edit.epoch !== this.epoch ||
			this.data.currentMaterialId !== edit.id ||
			!current ||
			current.title !== edit.previous.title ||
			current.audioPath !== edit.previous.audioPath ||
			current.subtitlePath !== edit.previous.subtitlePath ||
			current.originalText !== edit.previous.originalText
		)
			throw audioFailure({ kind: "stale-material" });
	}
	async selectMaterial(id: string): Promise<void> {
		return this.runMaterialOperation("select", id, async () => {
			const material = this.data.materials.find((item) => item.id === id);
			if (!material) throw audioFailure({ kind: "stale-material" });
			const epoch = this.epoch;
			const staged = await this.stageMaterial(material);
			const prepare = (data: AudioPracticeData) => {
				const progress = data.progress[id] ?? emptyProgress();
				const retained = progress.difficultCueIds.filter((cueId) =>
					staged.cues.some((cue) => cue.id === cueId),
				);
				const cueId = staged.cues.some((cue) => cue.id === progress.cueId)
					? progress.cueId
					: (staged.cues.find(
							(cue) => progress.time >= cue.start && progress.time < cue.end,
						)?.id ??
						staged.cues[0]?.id ??
						null);
				return {
					...data,
					currentMaterialId: id,
					progress: {
						...data.progress,
						[id]: { ...progress, cueId, difficultCueIds: retained },
					},
				};
			};
			const oldMarkCount = (this.data.progress[id] ?? emptyProgress()).difficultCueIds.length;
			const committed = await this.commitMaterialChange(
				epoch,
				() => {
					staged.assertUnchanged();
					const current = this.data.materials.find((item) => item.id === id);
					if (!current || !sameMaterial(current, material))
						throw audioFailure({ kind: "stale-material" });
				},
				prepare,
			);
			if (committed)
				this.installMaterial(
					staged.cues,
					oldMarkCount - this.progress().difficultCueIds.length,
				);
		});
	}
	async removeMaterial(id: string): Promise<void> {
		return this.runMaterialOperation("remove", id, async () => {
			if (!this.data.materials.some((item) => item.id === id))
				throw audioFailure({ kind: "stale-material" });
			const epoch = this.epoch;
			const wasCurrent = this.data.currentMaterialId === id;
			await this.commitMaterialChange(
				epoch,
				() => {
					if (!this.data.materials.some((item) => item.id === id))
						throw audioFailure({ kind: "stale-material" });
				},
				(data) => {
					const { [id]: _removed, ...progress } = data.progress;
					const materials = data.materials.filter((item) => item.id !== id);
					return {
						...data,
						materials,
						progress,
						currentMaterialId:
							data.currentMaterialId === id
								? (materials[0]?.id ?? null)
								: data.currentMaterialId,
					};
				},
			);
			try {
				await this.generationService?.discard(id);
			} catch {
				this.draftError = { kind: "draft-save-failed" };
			}
			if (wasCurrent) await this.loadMaterial();
			else this.publish();
			if (epoch !== this.epoch) throw audioFailure({ kind: "stale-material" });
		});
	}
	private async runMaterialOperation<T>(
		kind: MaterialOperationKind,
		materialId: string,
		action: () => Promise<T>,
	): Promise<T> {
		if (this.disposed) throw audioFailure({ kind: "cancelled" });
		if (this.materialOperation.status === "pending") throw audioFailure({ kind: "busy" });
		if (
			kind === "edit" &&
			this.generationService?.getSnapshot().taskKey === materialId &&
			["preparing", "transcribing", "aligning"].includes(
				this.generationService.getSnapshot().status,
			)
		)
			throw audioFailure({ kind: "busy" });
		const id = this.materialOperation.id + 1;
		this.materialOperation = {
			id,
			kind,
			materialId,
			status: "pending",
			failure: null,
		};
		this.publish();
		try {
			const result = await action();
			this.materialOperation = { id, kind, materialId, status: "succeeded", failure: null };
			this.publish();
			return result;
		} catch (error) {
			this.materialOperation = {
				id,
				kind,
				materialId,
				status: "failed",
				failure: toAudioFailure(error),
			};
			this.publish();
			throw error;
		}
	}
	dismissMaterialOperationFailure(): void {
		if (this.materialOperation.status !== "failed") return;
		this.materialOperation = {
			...this.materialOperation,
			status: "idle",
			failure: null,
		};
		this.publish();
	}
	private async stageMaterial(material: AudioMaterial): Promise<{
		cues: readonly SubtitleCue[];
		assertUnchanged: () => void;
	}> {
		const audioStat = this.files.stat(material.audioPath);
		if (!audioStat) throw audioFailure({ kind: "missing-file" });
		const subtitleStat = material.subtitlePath ? this.files.stat(material.subtitlePath) : null;
		if (material.subtitlePath && !subtitleStat) throw audioFailure({ kind: "missing-file" });
		const cues = material.subtitlePath
			? parseSubtitles(await this.files.readText(material.subtitlePath))
			: [];
		const assertUnchanged = () => {
			if (
				!sameFileStat(audioStat, this.files.stat(material.audioPath)) ||
				(subtitleStat &&
					!sameFileStat(subtitleStat, this.files.stat(material.subtitlePath!)))
			)
				throw audioFailure({ kind: "stale-material" });
		};
		assertUnchanged();
		return { cues, assertUnchanged };
	}
	private async commitMaterialChange(
		epoch: number,
		check: () => void,
		prepare: (data: AudioPracticeData) => AudioPracticeData,
	): Promise<boolean> {
		const commit = this.persistenceTail.then(async () => {
			if (this.disposed || epoch !== this.epoch)
				throw audioFailure({ kind: "stale-material" });
			check();
			const before = this.data;
			try {
				await this.repository.save(prepare(before));
			} catch {
				if (epoch !== this.epoch) throw audioFailure({ kind: "stale-material" });
				throw audioFailure({ kind: "persist-failed" });
			}
			if (this.disposed || epoch !== this.epoch)
				throw audioFailure({ kind: "stale-material" });
			try {
				check();
			} catch {
				try {
					await this.repository.save(this.data);
				} catch {
					if (epoch !== this.epoch) throw audioFailure({ kind: "stale-material" });
					this.data = normalizeAudioPracticeData(this.repository.load());
					await this.loadMaterial(true);
					return false;
				}
				throw audioFailure({ kind: "stale-material" });
			}
			const changedDuringSave = this.data !== before;
			this.data = prepare(this.data);
			if (changedDuringSave) void this.persist();
			return true;
		});
		this.persistenceTail = commit.then(
			() => undefined,
			() => undefined,
		);
		return commit;
	}
	private installMaterial(cues: readonly SubtitleCue[], invalidatedMarks: number): void {
		this.generation++;
		this.cancelBoundary();
		this.loadingMedia = true;
		this.media?.pause();
		this.loadingMedia = false;
		this.loading = false;
		this.error = null;
		this.previewEnd = null;
		this.revealed = false;
		this.cues = cues;
		this.invalidatedMarks = invalidatedMarks;
		this.loadMedia();
		this.publish();
		this.reconcileRestore();
	}
	private beginSubtitleOperation(id: string): {
		token: number;
		epoch: number;
		audioPath: string;
	} {
		const material = this.data.materials.find((item) => item.id === id);
		if (!material || this.disposed) throw audioFailure({ kind: "stale-material" });
		const token = (this.subtitleOperation.get(id) ?? 0) + 1;
		this.subtitleOperation.set(id, token);
		return { token, epoch: this.epoch, audioPath: material.audioPath };
	}
	private assertSubtitleOperation(
		id: string,
		operation: { token: number; epoch: number; audioPath: string },
	): void {
		if (
			this.disposed ||
			operation.epoch !== this.epoch ||
			this.subtitleOperation.get(id) !== operation.token ||
			this.data.materials.find((item) => item.id === id)?.audioPath !== operation.audioPath
		)
			throw audioFailure({ kind: "stale-material" });
	}
	private async bindSubtitle(
		id: string,
		path: string | null,
		operation: { token: number; epoch: number; audioPath: string },
		wordTimings?: Readonly<Record<string, readonly TimedTextWord[]>>,
	): Promise<void> {
		const cues = path ? parseSubtitles(await this.files.readText(path)) : [];
		this.assertSubtitleOperation(id, operation);
		if (id === this.data.currentMaterialId) this.reconcileCues(cues, false);
		this.data = {
			...this.data,
			materials: this.data.materials.map((item) =>
				item.id === id ? { ...item, subtitlePath: path, wordTimings } : item,
			),
		};
		await this.persist(true);
		this.assertSubtitleOperation(id, operation);
		if (id === this.data.currentMaterialId) await this.loadMaterial();
		else this.publish();
	}
	async saveSubtitles(
		id: string,
		cues: readonly SubtitleCue[],
		timingsByDraftId?: ReadonlyMap<string, readonly TimedTextWord[]>,
	): Promise<string> {
		const operation = this.beginSubtitleOperation(id);
		const errors = validateCues(
			cues,
			id === this.data.currentMaterialId ? (this.snapshot.duration ?? undefined) : undefined,
		);
		if (errors.length) throw audioFailure({ kind: "subtitle-invalid", problems: errors });
		const contents = serializeSrt(cues);
		const savedCues = parseSubtitles(contents);
		const sortedCues = [...cues].sort((left, right) => left.start - right.start);
		const wordTimings: Record<string, readonly TimedTextWord[]> = {};
		for (const [index, cue] of sortedCues.entries()) {
			const words = timingsByDraftId?.get(cue.id);
			if (words?.length && savedCues[index]) wordTimings[savedCues[index]!.id] = words;
		}
		const path = await this.files.writeSubtitle(operation.audioPath, contents);
		this.assertSubtitleOperation(id, operation);
		await this.bindSubtitle(
			id,
			path,
			operation,
			Object.keys(wordTimings).length ? wordTimings : undefined,
		);
		return path;
	}
	async refreshSubtitles(): Promise<void> {
		await this.loadMaterial(true);
	}
	togglePlayback(): void {
		if (
			!this.media ||
			!this.currentMaterial() ||
			this.loading ||
			!this.files.exists(this.currentMaterial()!.audioPath)
		)
			return;
		if (!this.media.paused) {
			this.pause();
			return;
		}
		let cue = this.currentCue();
		if (this.data.difficultOnly && cue && !this.progress().difficultCueIds.includes(cue.id))
			cue = undefined;
		if (
			this.data.difficultOnly &&
			!this.cues.some((item) => this.progress().difficultCueIds.includes(item.id))
		)
			return;
		if (this.data.mode === "sentence" && !cue && this.cues.length) {
			const available = this.data.difficultOnly
				? this.cues.filter((item) => this.progress().difficultCueIds.includes(item.id))
				: this.cues;
			cue =
				available.find(
					(item) => item.start + this.progress().offset >= this.media!.currentTime,
				) ?? available[available.length - 1];
			if (!cue) return;
			this.media.currentTime = Math.max(0, cue.start + this.progress().offset);
			this.patchProgress({ cueId: cue.id });
			this.revealed = false;
		}
		if (
			this.data.mode === "sentence" &&
			cue &&
			this.media.currentTime >= cue.end + this.progress().offset
		)
			this.media.currentTime = Math.max(0, cue.start + this.progress().offset);
		void this.media.play().catch(() => this.fail({ kind: "unreadable-media" }));
	}
	pause(): void {
		this.cancelBoundary();
		this.cancelWordBoundary();
		this.media?.pause();
		this.saveProgress();
		this.publish();
	}
	seekTo(time: number): void {
		if (!Number.isFinite(time)) return;
		this.previewEnd = null;
		const duration =
			this.media && Number.isFinite(this.media.duration) ? this.media.duration : Infinity;
		const next = Math.max(0, Math.min(duration, time));
		if (this.media) this.media.currentTime = next;
		const cue = this.cues.find(
			(item) =>
				next >= item.start + this.progress().offset &&
				next < item.end + this.progress().offset,
		);
		this.patchProgress({ time: next, cueId: cue?.id ?? null });
		this.revealed = false;
		this.scheduleBoundary();
		this.scheduleWordBoundary();
		void this.persist();
		this.publish();
	}
	selectCue(id: string, play = false): void {
		const cue = this.cues.find((item) => item.id === id);
		if (!cue || (this.data.difficultOnly && !this.progress().difficultCueIds.includes(id)))
			return;
		this.pause();
		this.seekTo(cue.start + this.progress().offset);
		this.patchProgress({ cueId: id });
		void this.persist();
		this.publish();
		if (play) this.togglePlayback();
	}
	previous(): void {
		this.move(-1);
	}
	next(): void {
		this.move(1);
	}
	repeat(): void {
		const cue = this.currentCue();
		if (cue) this.selectCue(cue.id, true);
	}
	preview(start: number, end: number): void {
		if (
			!this.media ||
			!Number.isFinite(start) ||
			!Number.isFinite(end) ||
			start < 0 ||
			end <= start
		)
			return;
		this.pause();
		this.media.currentTime = start;
		this.previewEnd = end;
		void this.media.play().catch(() => this.fail({ kind: "unreadable-media" }));
	}
	setPlaybackRate(rate: AudioPlaybackRate): void {
		if (!AUDIO_PLAYBACK_RATES.includes(rate)) return;
		this.data = { ...this.data, playbackRate: rate };
		if (this.media) this.media.playbackRate = rate;
		this.scheduleBoundary();
		this.scheduleWordBoundary();
		void this.persist();
		this.publish();
	}
	setMode(mode: AudioPracticeMode): void {
		this.pause();
		this.data = { ...this.data, mode: this.data.difficultOnly ? "sentence" : mode };
		this.previewEnd = null;
		void this.persist();
		this.publish();
	}
	setBlind(blind: boolean): void {
		this.data = { ...this.data, blind };
		this.revealed = false;
		void this.persist();
		this.publish();
	}
	reveal(): void {
		this.revealed = true;
		this.publish();
	}
	setDifficultOnly(difficultOnly: boolean): void {
		this.pause();
		this.data = {
			...this.data,
			difficultOnly,
			mode: difficultOnly ? "sentence" : this.data.mode,
		};
		if (difficultOnly) {
			const cues = this.cues.filter((cue) =>
				this.progress().difficultCueIds.includes(cue.id),
			);
			if (!cues.some((cue) => cue.id === this.progress().cueId)) {
				if (cues[0]) this.selectCue(cues[0].id);
				else this.patchProgress({ cueId: null });
			}
		}
		void this.persist();
		this.publish();
	}
	toggleDifficult(id: string): void {
		if (!this.cues.some((cue) => cue.id === id)) return;
		const ids = this.progress().difficultCueIds;
		this.patchProgress({
			difficultCueIds: ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
		});
		if (this.data.difficultOnly) this.setDifficultOnly(true);
		void this.persist();
		this.publish();
	}
	setOffset(offset: number): void {
		if (!Number.isFinite(offset)) return;
		this.pause();
		this.patchProgress({ offset });
		void this.persist();
		this.publish();
	}
	dispose(): void {
		if (this.disposed) return;
		this.pause();
		this.disposed = true;
		this.generation++;
		this.generationService?.cancel();
		this.unbindMedia();
		this.releases.forEach((release) => release());
		this.listeners.clear();
	}
	private currentMaterial(): AudioMaterial | null {
		return this.data.materials.find((item) => item.id === this.data.currentMaterialId) ?? null;
	}
	private progress(): AudioPracticeProgress {
		return this.data.currentMaterialId
			? (this.data.progress[this.data.currentMaterialId] ?? emptyProgress())
			: emptyProgress();
	}
	private patchProgress(patch: Partial<AudioPracticeProgress>): void {
		if (this.data.currentMaterialId)
			this.data = {
				...this.data,
				progress: {
					...this.data.progress,
					[this.data.currentMaterialId]: { ...this.progress(), ...patch },
				},
			};
	}
	private currentCue(): SubtitleCue | undefined {
		return this.cues.find((cue) => cue.id === this.progress().cueId);
	}
	private move(direction: number): void {
		const cues = this.data.difficultOnly
			? this.cues.filter((cue) => this.progress().difficultCueIds.includes(cue.id))
			: this.cues;
		const index = cues.findIndex((cue) => cue.id === this.progress().cueId);
		const next = cues[index < 0 ? (direction > 0 ? 0 : cues.length - 1) : index + direction];
		if (next) this.selectCue(next.id, true);
	}
	private async loadMaterial(reconcile = false): Promise<void> {
		this.cancelBoundary();
		this.cancelWordBoundary();
		const token = ++this.generation;
		this.loadingMedia = true;
		this.media?.pause();
		this.loadingMedia = false;
		const material = this.currentMaterial();
		this.loading = true;
		this.error = null;
		this.previewEnd = null;
		this.revealed = false;
		if (!reconcile) this.cues = [];
		this.publish();
		try {
			if (material && !this.files.exists(material.audioPath))
				throw audioFailure({ kind: "missing-file" });
			const cues = material?.subtitlePath
				? parseSubtitles(await this.files.readText(material.subtitlePath))
				: [];
			if (token !== this.generation || this.disposed) return;
			if (reconcile) this.reconcileCues(cues);
			else {
				this.cues = cues;
				const retained = this.progress().difficultCueIds.filter((id) =>
					cues.some((cue) => cue.id === id),
				);
				this.invalidatedMarks = this.progress().difficultCueIds.length - retained.length;
				if (this.invalidatedMarks) {
					this.patchProgress({ difficultCueIds: retained });
					void this.persist();
				}
			}
			if (!this.currentCue() && cues.length)
				this.patchProgress({
					cueId:
						cues.find(
							(cue) =>
								this.progress().time >= cue.start && this.progress().time < cue.end,
						)?.id ?? cues[0]!.id,
				});
		} catch (error) {
			if (token === this.generation) this.error = toAudioFailure(error);
		}
		if (token !== this.generation || this.disposed) return;
		this.loading = false;
		this.loadMedia();
		this.publish();
		this.reconcileRestore();
	}
	private reconcileCues(next: readonly SubtitleCue[], persist = true): void {
		const remapped = remapCueProgress(this.cues, next, this.progress());
		this.invalidatedMarks = remapped.invalidatedMarks;
		this.patchProgress(remapped.progress);
		this.cues = next;
		if (persist) void this.persist();
	}
	private loadMedia(): void {
		this.cancelBoundary();
		this.cancelWordBoundary();
		if (!this.media) return;
		this.loadingMedia = true;
		try {
			this.media.pause();
			const material = this.currentMaterial();
			this.media.src =
				material && this.files.exists(material.audioPath)
					? this.files.mediaUrl(material.audioPath)
					: "";
			this.media.playbackRate = this.data.playbackRate;
			this.media.load();
			this.media.currentTime = this.progress().time;
		} catch {
			this.error = { kind: "unreadable-media" };
		} finally {
			this.loadingMedia = false;
		}
	}
	private saveProgress(): void {
		if (
			this.loadingMedia ||
			this.loading ||
			!this.media ||
			!Number.isFinite(this.media.currentTime)
		)
			return;
		this.patchProgress({ time: this.media.currentTime });
		void this.persist();
	}
	private tick = (): void => {
		if (this.loadingMedia || this.loading || !this.media) return;
		const offset = this.progress().offset;
		const cue = this.currentCue();
		const end =
			this.previewEnd ?? (this.data.mode === "sentence" && cue ? cue.end + offset : null);
		if (end !== null && this.media.currentTime >= end && !this.media.paused) {
			this.media.pause();
			this.media.currentTime = Math.max(0, end);
			this.previewEnd = null;
			this.saveProgress();
		}
		if (this.data.mode === "continuous" && this.previewEnd === null) {
			const current = this.cues.find(
				(item) =>
					this.media!.currentTime >= item.start + offset &&
					this.media!.currentTime < item.end + offset,
			);
			if (current && current.id !== this.progress().cueId) {
				this.patchProgress({ cueId: current.id });
				this.revealed = false;
			}
		}
		if (Date.now() - this.lastSave >= 10000) {
			this.lastSave = Date.now();
			this.saveProgress();
		}
		this.scheduleBoundary();
		this.scheduleWordBoundary();
		this.publish();
	};
	private paused = (): void => {
		this.cancelBoundary();
		this.cancelWordBoundary();
		if (!this.loadingMedia) {
			this.saveProgress();
			this.publish();
		}
	};
	private metadata = (): void => {
		if (!this.media || !Number.isFinite(this.media.duration)) return;
		this.media.currentTime = Math.min(this.progress().time, this.media.duration);
		this.publish();
	};
	private mediaEvents = {
		timeupdate: () => {
			if (this.mediaBuffering && this.media && this.media.currentTime > this.mediaBufferingAt)
				this.mediaBuffering = false;
			this.tick();
		},
		play: () => {
			this.mediaBuffering = false;
			this.tick();
		},
		playing: () => {
			this.mediaBuffering = false;
			this.tick();
		},
		seeked: this.tick,
		seeking: () => {
			this.cancelBoundary();
			this.cancelWordBoundary();
		},
		ratechange: () => {
			this.scheduleBoundary();
			this.scheduleWordBoundary();
		},
		waiting: () => {
			this.markMediaBuffering();
		},
		stalled: () => {
			this.markMediaBuffering();
		},
		pause: this.paused,
		ended: this.paused,
		loadedmetadata: this.metadata,
		error: () => {
			if (this.media?.src) this.fail({ kind: "unreadable-media" });
		},
	};
	private markMediaBuffering(): void {
		this.mediaBuffering = true;
		this.mediaBufferingAt = this.media?.currentTime ?? 0;
		this.cancelBoundary();
		this.cancelWordBoundary();
	}
	private cancelBoundary(): void {
		this.boundaryToken++;
		if (this.boundaryTimer !== null) clearTimeout(this.boundaryTimer);
		this.boundaryTimer = null;
	}
	private scheduleBoundary(): void {
		this.cancelBoundary();
		const media = this.media;
		if (
			!media ||
			media.paused ||
			this.mediaBuffering ||
			this.loading ||
			this.loadingMedia ||
			this.disposed
		)
			return;
		const cue = this.currentCue();
		const end =
			this.previewEnd ??
			(this.data.mode === "sentence" && cue ? cue.end + this.progress().offset : null);
		if (
			end === null ||
			!Number.isFinite(end) ||
			!Number.isFinite(media.currentTime) ||
			media.playbackRate <= 0
		)
			return;
		const token = this.boundaryToken;
		const generation = this.generation;
		// Recheck media time at the deadline: buffering can stop media without stopping wall time.
		this.boundaryTimer = setTimeout(
			() => {
				this.boundaryTimer = null;
				if (
					token !== this.boundaryToken ||
					generation !== this.generation ||
					media !== this.media ||
					this.disposed
				)
					return;
				this.tick();
			},
			Math.max(10, ((end - media.currentTime) / media.playbackRate) * 1000),
		);
	}
	private cancelWordBoundary(): void {
		this.wordBoundaryToken++;
		if (this.wordBoundaryTimer !== null) clearTimeout(this.wordBoundaryTimer);
		this.wordBoundaryTimer = null;
	}
	private scheduleWordBoundary(): void {
		this.cancelWordBoundary();
		const media = this.media;
		const cue = this.currentCue();
		const words = cue && this.currentMaterial()?.wordTimings?.[cue.id];
		if (
			!media ||
			media.paused ||
			this.mediaBuffering ||
			this.loading ||
			this.loadingMedia ||
			this.disposed ||
			!words?.length ||
			!Number.isFinite(media.currentTime) ||
			media.playbackRate <= 0
		)
			return;
		const next = words.find((word) => word.start + this.progress().offset > media.currentTime);
		if (!next) return;
		const token = this.wordBoundaryToken;
		const generation = this.generation;
		this.wordBoundaryTimer = setTimeout(
			() => {
				this.wordBoundaryTimer = null;
				if (
					token !== this.wordBoundaryToken ||
					generation !== this.generation ||
					media !== this.media ||
					this.disposed
				)
					return;
				this.tick();
			},
			Math.max(
				10,
				((next.start + this.progress().offset - media.currentTime) / media.playbackRate) *
					1000,
			),
		);
	}
	private unbindMedia(): void {
		this.mediaLease++;
		this.cancelBoundary();
		this.cancelWordBoundary();
		this.mediaBuffering = false;
		if (!this.media) return;
		this.pause();
		for (const [event, listener] of Object.entries(this.mediaEvents))
			this.media.removeEventListener(event, listener);
		this.media = null;
		this.publish();
	}
	private persist(required = false): Promise<void> {
		if (this.disposed)
			return required
				? Promise.reject(audioFailure({ kind: "cancelled" }))
				: Promise.resolve();
		const epoch = this.epoch;
		const pending = this.persistenceTail.then(async () => {
			if (epoch !== this.epoch) {
				if (required) throw audioFailure({ kind: "stale-material" });
				return;
			}
			await this.repository.save(this.data);
		});
		this.persistenceTail = pending.catch(() => this.fail({ kind: "persist-failed" }));
		return pending;
	}
	private fail(failure: AudioFailure): void {
		if (this.disposed) return;
		this.error = failure;
		this.publish();
	}
	async generateSubtitles(force = false): Promise<boolean> {
		if (this.disposed || this.savingDraft) return false;
		if (!this.generationService || !this.settings || !this.source) return false;
		const genStatus = this.generationService.getSnapshot().status;
		if (["preparing", "transcribing", "aligning"].includes(genStatus)) return false;
		const material = this.currentMaterial();
		if (!material) {
			this.draftError = { kind: "missing-file" };
			this.publish();
			return false;
		}
		this.draftError = null;
		const settings = this.settings.read();
		const config = transcriptionConfig(settings);
		try {
			validateTranscriptionConfig(config);
		} catch (error) {
			this.draftError = toAudioFailure(error);
			this.publish();
			return false;
		}
		const secret = this.settings.readSecret(config.secretId);
		if (!secret) {
			this.draftError = { kind: "config-invalid", field: "secret" };
			this.publish();
			return false;
		}
		const stat = this.source.stat(material.audioPath);
		if (!stat) {
			this.draftError = { kind: "missing-file" };
			this.publish();
			return false;
		}
		if (stat.size > MAX_AUDIO_BYTES) {
			this.draftError = { kind: "audio-too-large", maxBytes: MAX_AUDIO_BYTES };
			this.publish();
			return false;
		}
		try {
			const audio = await this.source.readBinary(material.audioPath);
			const current = this.currentMaterial();
			if (!current || current.id !== material.id) {
				this.draftError = { kind: "stale-material" };
				this.publish();
				return false;
			}
			const input: GenerationInput = {
				audio,
				name: fileName(current.audioPath),
				taskKey: current.id,
				referenceText: current.originalText,
				config,
			};
			const validationToken = ++this.draftValidationToken;
			const epoch = this.epoch;
			this.draftSourceValidated = false;
			await this.generationService.generate(input, { force });
			if (
				validationToken === this.draftValidationToken &&
				epoch === this.epoch &&
				this.currentMaterial()?.id === current.id &&
				this.currentMaterial()?.audioPath === current.audioPath &&
				this.currentMaterial()?.originalText === current.originalText &&
				sameFileStat(stat, this.source.stat(current.audioPath))
			) {
				this.draftSourceValidated = true;
				this.publish();
			}
			return true;
		} catch (error) {
			this.draftError = toAudioFailure(error);
			this.publish();
			return false;
		}
	}

	cancelSubtitleGeneration(): void {
		this.generationService?.cancel();
	}

	dismissFailure(): void {
		this.error = null;
		this.draftError = null;
		this.publish();
	}

	async saveSubtitleDraft(): Promise<boolean> {
		if (this.disposed || this.savingDraft) return false;
		if (!this.generationService || !this.source) return false;
		const genStatus = this.generationService.getSnapshot().status;
		if (["preparing", "transcribing", "aligning"].includes(genStatus)) return false;
		const material = this.currentMaterial();
		if (!material) return false;
		if (this.generationService.getSnapshot().taskKey !== material.id) {
			this.draftError = { kind: "stale-material" };
			this.publish();
			return false;
		}
		if (!this.draftSourceValidated) {
			this.draftError = { kind: "source-changed" };
			this.publish();
			return false;
		}
		this.savingDraft = true;
		this.draftError = null;
		this.publish();
		try {
			const stat = this.source.stat(material.audioPath);
			if (!stat) throw audioFailure({ kind: "missing-file" });
			const mtime = stat.mtime;
			const audio = await this.source.readBinary(material.audioPath);
			const matches = await this.generationService.matchesSource(
				audio,
				material.originalText,
			);
			const current = this.currentMaterial();
			const afterStat = current ? this.source.stat(current.audioPath) : null;
			if (
				!matches ||
				this.generationService.getSnapshot().taskKey !== material.id ||
				current?.audioPath !== material.audioPath ||
				current?.originalText !== material.originalText ||
				afterStat?.mtime !== mtime
			) {
				throw audioFailure({ kind: "source-changed" });
			}
			const cues = this.generationService.validatedCues();
			const recognizedWords = this.generationService.getTimedWords();
			const timings = new Map<string, readonly TimedTextWord[]>();
			for (const cue of cues) {
				const matched = alignTimedWords(
					cue.text.trim(),
					cue.start,
					cue.end,
					recognizedWords,
				);
				if (matched) timings.set(cue.id, matched);
			}
			await this.saveSubtitles(material.id, cues, timings);
			return true;
		} catch (error) {
			this.draftError = toAudioFailure(error);
			return false;
		} finally {
			this.savingDraft = false;
			this.publish();
		}
	}

	editSubtitleDraftCue(id: string, patch: Partial<DraftCue>): void {
		this.generationService?.editCue(id, patch);
	}

	addSubtitleDraftCue(): void {
		this.generationService?.addCue();
	}

	removeSubtitleDraftCue(id: string): void {
		this.generationService?.removeCue(id);
	}

	confirmAllSubtitleDraftCues(): void {
		this.generationService?.confirmAllCues();
	}
	hasReviewWordTimings(): boolean {
		return (this.generationService?.getTimedWords().length ?? 0) > 0;
	}
	canHighlightDraftCue(cue: DraftCue): boolean {
		return (
			cue.start !== null &&
			cue.end !== null &&
			alignTimedWords(
				cue.text.trim(),
				cue.start,
				cue.end,
				this.generationService?.getTimedWords() ?? [],
			) !== null
		);
	}

	private reconcileRestore(): void {
		if (this.disposed || this.savingDraft || !this.generationService) return;
		const gen = this.generationService.getSnapshot();
		if (["preparing", "transcribing", "aligning"].includes(gen.status)) return;
		const currentMaterialId = this.data.currentMaterialId;
		if (!currentMaterialId || (gen.taskKey === currentMaterialId && this.draftSourceValidated))
			return;
		const token = ++this.draftValidationToken;
		const epoch = this.epoch;
		this.draftSourceValidated = false;
		this.publish();
		void (async () => {
			const restored =
				gen.taskKey === currentMaterialId ||
				(await this.generationService!.restore(currentMaterialId));
			if (token !== this.draftValidationToken) return;
			const restoredSnapshot = this.generationService!.getSnapshot();
			if (
				!restored ||
				!this.source ||
				restoredSnapshot.taskKey !== currentMaterialId ||
				restoredSnapshot.status !== "review"
			) {
				this.draftSourceValidated = true;
				this.publish();
				return;
			}
			const material = this.currentMaterial();
			if (!material || material.id !== currentMaterialId || epoch !== this.epoch) return;
			const before = this.source.stat(material.audioPath);
			if (!before) return;
			const audio = await this.source.readBinary(material.audioPath);
			const matches = await this.generationService!.matchesSource(
				audio,
				material.originalText,
			);
			if (
				token === this.draftValidationToken &&
				epoch === this.epoch &&
				this.currentMaterial()?.id === material.id &&
				this.currentMaterial()?.audioPath === material.audioPath &&
				this.currentMaterial()?.originalText === material.originalText &&
				sameFileStat(before, this.source.stat(material.audioPath))
			) {
				this.draftSourceValidated = matches;
				this.publish();
			}
		})().catch(() => {});
	}

	private getDraftSnapshot(): AudioPracticeDraftSnapshot {
		if (!this.generationService || !this.data.currentMaterialId) {
			return {
				status: this.savingDraft ? "saving" : "idle",
				cues: [],
				completedChunks: 0,
				totalChunks: 0,
				failure: null,
				error: this.draftError,
				notice: null,
			};
		}
		const gen = this.generationService.getSnapshot();
		const isCurrent = gen.taskKey === this.data.currentMaterialId;
		const sourceValid = this.draftSourceValidated;
		const status: AudioPracticeDraftStatus = this.savingDraft
			? "saving"
			: !isCurrent ||
				  (!sourceValid && !["preparing", "transcribing", "aligning"].includes(gen.status))
				? "idle"
				: gen.status;
		return {
			status,
			cues: isCurrent && sourceValid ? gen.cues : [],
			completedChunks: isCurrent ? gen.completedChunks : 0,
			totalChunks: isCurrent ? gen.totalChunks : 0,
			failure: isCurrent && sourceValid ? gen.failure : null,
			error: this.draftError,
			notice: isCurrent && sourceValid ? gen.notice : null,
		};
	}

	private publish(): void {
		this.snapshot = {
			...this.data,
			materialOperation: this.materialOperation,
			currentMaterial: this.currentMaterial(),
			cues: this.cues,
			currentCueId: this.progress().cueId,
			currentTime: this.media?.currentTime ?? this.progress().time,
			duration:
				this.media && Number.isFinite(this.media.duration) ? this.media.duration : null,
			playing: !!this.media && !this.media.paused,
			revealed: this.revealed,
			loading: this.loading,
			failure: this.error,
			invalidatedMarks: this.invalidatedMarks,
			draft: this.getDraftSnapshot(),
		};
		for (const listener of this.listeners) listener();
	}
	private handleFileChange = (change: AudioFileChange): void => {
		const contains = (path: string | null, parent: string) =>
			path !== null && (path === parent || path.startsWith(`${parent}/`));
		if (
			this.materialEdit?.watchedPaths.some(
				(path) =>
					contains(path, change.path) ||
					(change.kind === "rename" && contains(path, change.nextPath)),
			)
		)
			this.materialEdit.invalidated = true;
		if (change.kind === "change" || change.kind === "delete") {
			let changedTimings = false;
			const materials = this.data.materials.map((item) => {
				if (
					!item.wordTimings ||
					(!contains(item.audioPath, change.path) &&
						!contains(item.subtitlePath, change.path))
				)
					return item;
				changedTimings = true;
				return { ...item, wordTimings: undefined };
			});
			if (changedTimings) {
				this.data = { ...this.data, materials };
				void this.persist();
				this.publish();
			}
		}
		if (change.kind === "rename") {
			const renamed = (path: string) =>
				contains(path, change.path)
					? change.nextPath + path.slice(change.path.length)
					: path;
			this.data = {
				...this.data,
				materials: this.data.materials.map((item) => ({
					...item,
					audioPath: renamed(item.audioPath),
					subtitlePath: item.subtitlePath === null ? null : renamed(item.subtitlePath),
				})),
			};
			void this.persist();
			this.publish();
		}
		const material = this.currentMaterial();
		if (
			material &&
			(contains(material.audioPath, change.path) ||
				(change.kind === "rename" && contains(material.audioPath, change.nextPath)))
		) {
			this.draftValidationToken++;
			this.draftSourceValidated = false;
		}
		if (
			material &&
			(contains(material.audioPath, change.path) ||
				contains(material.subtitlePath, change.path) ||
				(change.kind === "rename" &&
					(contains(material.audioPath, change.nextPath) ||
						contains(material.subtitlePath, change.nextPath))))
		)
			void this.loadMaterial(true);
	};
}

function fileName(path: string): string {
	return path.split("/").pop() ?? path;
}

function sameFileStat(
	left: ReturnType<AudioPracticeFiles["stat"]>,
	right: ReturnType<AudioPracticeFiles["stat"]>,
): boolean {
	return (
		left !== null && right !== null && left.size === right.size && left.mtime === right.mtime
	);
}

function sameMaterial(left: AudioMaterial, right: AudioMaterial): boolean {
	return (
		left.id === right.id &&
		left.title === right.title &&
		left.audioPath === right.audioPath &&
		left.subtitlePath === right.subtitlePath &&
		left.originalText === right.originalText
	);
}

function remapCueProgress(
	previous: readonly SubtitleCue[],
	next: readonly SubtitleCue[],
	progress: AudioPracticeProgress,
): { progress: AudioPracticeProgress; invalidatedMarks: number } {
	const identity = (cue: SubtitleCue) => JSON.stringify([cue.text, cue.start, cue.end]);
	const byIdentity = new Map<string, SubtitleCue[]>();
	for (const cue of next) {
		const key = identity(cue);
		byIdentity.set(key, [...(byIdentity.get(key) ?? []), cue]);
	}
	const match = (id: string): string | null => {
		const old = previous.find((cue) => cue.id === id);
		if (!old) return null;
		const candidates = byIdentity.get(identity(old));
		return candidates?.length === 1 ? candidates[0]!.id : null;
	};
	const marks = progress.difficultCueIds.map(match).filter((id): id is string => id !== null);
	return {
		progress: {
			...progress,
			difficultCueIds: marks,
			cueId: progress.cueId ? match(progress.cueId) : null,
		},
		invalidatedMarks: progress.difficultCueIds.length - marks.length,
	};
}

function transcriptionConfig(settings: AudioPracticeSettings): TranscriptionConfig {
	return settings.provider === "bailian"
		? {
				provider: "bailian",
				workspaceId: settings.bailianWorkspaceId.trim(),
				secretId: settings.bailianSecretId,
				model: settings.bailianModel.trim(),
			}
		: {
				provider: "openai-compatible",
				baseUrl: settings.openaiBaseUrl.trim(),
				secretId: settings.openaiSecretId,
				model: settings.openaiModel.trim(),
			};
}
