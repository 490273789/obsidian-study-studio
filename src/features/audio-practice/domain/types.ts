import type { AudioFailure } from "./failures";
import type { TimedTextWord } from "./transcriptionTypes";
export type MaterialOperationKind = "add" | "edit" | "select" | "remove";
export interface MaterialOperationSnapshot {
	readonly id: number;
	readonly kind: MaterialOperationKind | null;
	readonly materialId: string | null;
	readonly status: "idle" | "pending" | "succeeded" | "failed";
	readonly failure: AudioFailure | null;
}
export interface SubtitleCue {
	readonly id: string;
	readonly text: string;
	readonly start: number;
	readonly end: number;
	readonly needsReview?: boolean;
}
export const AUDIO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5] as const;
export type AudioPlaybackRate = (typeof AUDIO_PLAYBACK_RATES)[number];
export type AudioPracticeMode = "sentence" | "continuous";
export interface AudioMaterial {
	readonly id: string;
	readonly title: string;
	readonly audioPath: string;
	readonly subtitlePath: string | null;
	readonly originalText: string;
	/** Generated word timings keyed by the parsed SRT cue ID. Imported subtitles have none. */
	readonly wordTimings?: Readonly<Record<string, readonly TimedTextWord[]>>;
}
export type { TimedTextWord } from "./transcriptionTypes";
export interface AudioPracticeProgress {
	readonly time: number;
	readonly cueId: string | null;
	readonly difficultCueIds: readonly string[];
	readonly offset: number;
}
export interface AudioPracticeData {
	readonly schemaVersion: 1;
	readonly materials: readonly AudioMaterial[];
	readonly currentMaterialId: string | null;
	readonly progress: Readonly<Record<string, AudioPracticeProgress>>;
	readonly playbackRate: AudioPlaybackRate;
	readonly mode: AudioPracticeMode;
	readonly blind: boolean;
	readonly difficultOnly: boolean;
}
export interface AudioPracticeRepository {
	load(): AudioPracticeData;
	save(data: AudioPracticeData): Promise<void>;
	subscribeExternal(listener: () => void): () => void;
}
export type AudioFileChange =
	| { kind: "rename"; path: string; nextPath: string }
	| { kind: "create" | "change" | "delete"; path: string };
export interface AudioPracticeFiles {
	readText(path: string): Promise<string>;
	stat(path: string): { readonly size: number; readonly mtime: number } | null;
	mediaUrl(path: string): string;
	exists(path: string): boolean;
	/** Creates a new SRT file without replacing an existing source. */
	writeSubtitle(audioPath: string, contents: string): Promise<string>;
	subscribe?(listener: (change: AudioFileChange) => void): () => void;
}
/** Paths offered by the listening-material file picker. */
export interface AudioPracticeFileCatalog {
	readonly audioPaths: readonly string[];
	readonly subtitlePaths: readonly string[];
	readonly textPaths: readonly string[];
}

/** The vault file world an edit session lists and refreshes; separate from single-file reads. */
export interface AudioPracticeCatalog {
	list(): AudioPracticeFileCatalog;
	subscribe(listener: () => void): () => void;
}

export interface AudioMediaPort {
	src: string;
	currentTime: number;
	readonly duration: number;
	playbackRate: number;
	readonly paused: boolean;
	play(): Promise<void>;
	pause(): void;
	load(): void;
	addEventListener(event: string, listener: () => void): void;
	removeEventListener(event: string, listener: () => void): void;
}
import type { GenerationNotice } from "./transcriptionTypes";
import type { SubtitleDraftCue } from "./subtitleDraftEngine";

export type AudioPracticeDraftStatus =
	| "idle"
	| "preparing"
	| "transcribing"
	| "aligning"
	| "review"
	| "saving"
	| "error"
	| "cancelled";

export interface AudioPracticeDraftSnapshot {
	readonly status: AudioPracticeDraftStatus;
	readonly cues: readonly SubtitleDraftCue[];
	readonly completedChunks: number;
	readonly totalChunks: number;
	readonly failure: AudioFailure | null;
	readonly error: AudioFailure | null;
	readonly notice: GenerationNotice | null;
	readonly hasReviewWordTimings: boolean;
}

export interface AudioPracticeSnapshot extends AudioPracticeData {
	readonly materialOperation: MaterialOperationSnapshot;
	readonly currentMaterial: AudioMaterial | null;
	readonly cues: readonly SubtitleCue[];
	readonly currentCueId: string | null;
	readonly currentTime: number;
	readonly duration: number | null;
	readonly playing: boolean;
	readonly revealed: boolean;
	readonly loading: boolean;
	readonly failure: AudioFailure | null;
	readonly invalidatedMarks: number;
	readonly draft: AudioPracticeDraftSnapshot;
}
