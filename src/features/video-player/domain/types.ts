import type { ShadowingMode } from "./shadowingSession";

export const VIDEO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type VideoPlaybackRate = (typeof VIDEO_PLAYBACK_RATES)[number];

export interface LocalVideoSource {
	readonly id: string;
	readonly path: string;
	readonly name: string;
}

export interface FloatingRect {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface DeviceVideoPlayerStateV1 {
	readonly schemaVersion: 1;
	readonly sources: readonly LocalVideoSource[];
	readonly currentSourceId: string | null;
	readonly progressBySource: Readonly<Record<string, number>>;
	readonly completedSourceIds: readonly string[];
	readonly playbackRate: VideoPlaybackRate;
	readonly floatingRect: FloatingRect | null;
	readonly queueExpanded: boolean;
}

export interface VideoPlayerSnapshot {
	readonly sources: readonly LocalVideoSource[];
	readonly completedSourceIds: readonly string[];
	readonly progressBySource: Readonly<Record<string, number>>;
	readonly currentSourceId: string | null;
	readonly currentTime: number;
	readonly duration: number | null;
	readonly playbackRate: VideoPlaybackRate;
	readonly playing: boolean;
	readonly error: "media" | "playback" | null;
	readonly queueExpanded: boolean;
	readonly floatingRect: FloatingRect | null;
}

/** Narrow boundary over the single media element owned by the runtime. */
export interface VideoMediaPort {
	currentTime: number;
	readonly duration: number;
	readonly seeking?: boolean;
	paused: boolean;
	playbackRate: number;
	src: string;
	play(): Promise<void>;
	pause(): void;
	load(): void;
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
}

export interface VideoPlayerDocumentStore {
	load(): DeviceVideoPlayerStateV1;
	save(state: DeviceVideoPlayerStateV1): void;
	clear(): void;
}

/** Narrow boundary over playing saved shadowing takes. */
export interface TakeAudioPlayerPort {
	play(data: ArrayBuffer, mimeType: string): Promise<void>;
	stop(): void;
	dispose(): void;
}

export interface ShadowingCueRow {
	readonly id: string;
	readonly start: number;
	readonly end: number;
	readonly text: string;
	readonly translation?: string | null;
	readonly needsReview?: boolean;
	readonly revision?: number;
}

export interface ShadowingRecordRow {
	readonly id: string;
	readonly start: number;
	readonly end: number;
	readonly text: string;
	readonly kind: "recording" | "difficult";
	readonly createdAt?: number;
	readonly playbackRate?: number;
}

export interface ShadowingWorkspaceState {
	readonly enabled: boolean;
	readonly status:
		| "idle"
		| "queued"
		| "transcribing"
		| "translating"
		| "paused"
		| "error"
		| "complete";
	readonly processedSeconds: number;
	readonly totalSeconds: number | null;
	readonly taskError: string | null;
	readonly translationFailed: boolean;
	readonly cues: readonly ShadowingCueRow[];
	readonly records: readonly ShadowingRecordRow[];
	readonly hasCandidate: boolean;
	readonly hasPrevious: boolean;
	readonly practicePhase:
		| "idle"
		| "playing"
		| "resting"
		| "countdown"
		| "recording"
		| "review"
		| "paused";
	readonly practiceMode: ShadowingMode;
	readonly practiceStart: number | null;
	readonly practiceEnd: number | null;
	readonly countdown: number;
	readonly restSeconds: number;
	readonly responseMultiplier: number;
	readonly hasTemporaryTake: boolean;
	readonly savingTake: boolean;
	readonly practiceError: string | null;
	readonly failedSaves: readonly {
		readonly id: string;
		readonly sourceId: string;
		readonly start: number;
		readonly end: number;
		readonly text: string;
	}[];
}

export type ShadowingWorkspaceAction =
	| { readonly type: "set-enabled"; readonly enabled: boolean }
	| { readonly type: "generate" }
	| { readonly type: "translate-imported" }
	| { readonly type: "retry-translation" }
	| { readonly type: "reload-subtitles" }
	| { readonly type: "pause-generation" }
	| { readonly type: "resume-generation" }
	| {
			readonly type: "import-file";
			readonly file: { readonly name: string; text(): Promise<string> };
			readonly role: "bilingual" | "original" | "translation";
	  }
	| { readonly type: "adopt-candidate" }
	| { readonly type: "restore-previous" }
	| {
			readonly type: "edit-cue";
			readonly cueId: string;
			readonly text?: string;
			readonly translation?: string;
	  }
	| {
			readonly type: "select-range";
			readonly start: number;
			readonly end: number;
			readonly text?: string;
	  }
	| { readonly type: "seek-to"; readonly seconds: number }
	| { readonly type: "set-mode"; readonly mode: ShadowingMode }
	| { readonly type: "set-rest-seconds"; readonly seconds: number }
	| { readonly type: "set-response-multiplier"; readonly multiplier: number }
	| { readonly type: "continue-early" }
	| { readonly type: "start-loop" }
	| { readonly type: "stop-practice" }
	| { readonly type: "record-once" }
	| { readonly type: "replay-take" }
	| { readonly type: "replay-original" }
	| { readonly type: "save-take" }
	| { readonly type: "retry-save"; readonly takeId: string }
	| { readonly type: "continue-watching" }
	| { readonly type: "mark-difficult" }
	| { readonly type: "open-record"; readonly record: ShadowingRecordRow }
	| { readonly type: "delete-record"; readonly record: ShadowingRecordRow }
	| { readonly type: "relinquish-presenter" };
