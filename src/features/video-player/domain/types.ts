export const VIDEO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type VideoPlaybackRate = (typeof VIDEO_PLAYBACK_RATES)[number];

export interface LocalVideoSource {
	readonly id: string;
	readonly path: string;
	readonly name: string;
}

export interface PickedVideoFile {
	readonly path: string;
	readonly name: string;
}

export interface VideoFilePickerPort {
	pickSources(label: string): Promise<readonly PickedVideoFile[]>;
}

export interface VideoSourceIdentityPort {
	load(): Record<string, string>;
	save(registry: Record<string, string>): void;
}

export interface VideoPickStrings {
	readonly addVideos: string;
	readonly selectFailed: string;
}

export interface VideoReplaceStrings {
	readonly replace: string;
	readonly selectFailed: string;
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

export type ShadowingMode = "shadow" | "repeat-after";

export interface ShadowingRange {
	readonly sourceId: string;
	readonly start: number;
	readonly end: number;
	readonly text?: string;
}

export interface ShadowingTake {
	readonly id: string;
	readonly range: ShadowingRange;
	readonly mode: ShadowingMode;
	readonly playbackRate: VideoPlaybackRate;
	readonly createdAt: number;
	readonly blob: Blob;
	readonly mimeType: string;
}

export interface ShadowRecorderPort {
	start: () => Promise<void>;
	stop: () => Promise<Blob>;
	cancel: () => void;
	play: (blob: Blob) => Promise<void>;
	dispose: () => void;
}

export interface ShadowPracticeRecord {
	readonly id: string;
	readonly sourceId: string;
	readonly kind: "difficult" | "recording";
	readonly start: number;
	readonly end: number;
	readonly text: string;
	readonly createdAt: number;
	readonly playbackRate?: number;
	readonly mimeType?: string;
	readonly audioPath?: string;
}

export interface ShadowPracticeRecordsPort {
	list(sourceId: string): Promise<ShadowPracticeRecord[]>;
	reload(sourceId: string): Promise<ShadowPracticeRecord[]>;
	markDifficult(
		sourceId: string,
		start: number,
		end: number,
		text: string,
	): Promise<ShadowPracticeRecord>;
	saveTake(take: ShadowingTake): Promise<ShadowPracticeRecord>;
	remove(sourceId: string, recordId: string): Promise<void>;
	readTake(record: ShadowPracticeRecord): Promise<ArrayBuffer>;
}

/** Only normalized vault-relative directories may contain study artifacts. */
export function validShadowVaultFolder(value: unknown): value is string {
	if (typeof value !== "string" || !value.trim() || value !== value.trim()) return false;
	if (value.includes("\\") || value.includes(":") || value.startsWith("/")) return false;
	for (let index = 0; index < value.length; index++) {
		if (value.charCodeAt(index) < 32) return false;
	}
	return value.split("/").every((part) => !!part && part !== "." && part !== "..");
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
	readonly selectedCueIds: readonly string[];
	readonly rangeStart: number;
	readonly rangeEnd: number;
	readonly canPractice: boolean;
	readonly deletedDrafts: readonly {
		readonly sourceId: string;
		readonly cueId: string;
		readonly text: string;
		readonly translation: string;
	}[];
	readonly editor: null | {
		readonly cueId: string;
		readonly text: string;
		readonly translation: string;
		readonly busy: boolean;
		readonly conflict: boolean;
		readonly deleted: boolean;
		readonly failure: string | null;
		readonly confirmingReload: boolean;
		readonly canSave: boolean;
	};
}

export type ShadowingWorkspaceViewAction =
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
			readonly type: "select-range";
			readonly start: number;
			readonly end: number;
			readonly text?: string;
	  }
	| { readonly type: "choose-cue"; readonly cueId: string; readonly extend: boolean }
	| { readonly type: "step-cue"; readonly direction: -1 | 1 }
	| { readonly type: "replay-current-cue" }
	| { readonly type: "set-cue-range"; readonly edge: "start" | "end"; readonly seconds: number }
	| { readonly type: "toggle-cue-editor" }
	| {
			readonly type: "discard-deleted-draft";
			readonly draft: ShadowingWorkspaceState["deletedDrafts"][number];
	  }
	| {
			readonly type: "set-cue-field";
			readonly field: "text" | "translation";
			readonly value: string;
			readonly expectedEditor?: ShadowingWorkspaceState["editor"];
	  }
	| {
			readonly type: "save-cue-edit";
			readonly expectedEditor?: ShadowingWorkspaceState["editor"];
	  }
	| {
			readonly type: "request-cue-reload";
			readonly expectedEditor?: ShadowingWorkspaceState["editor"];
	  }
	| {
			readonly type: "cancel-cue-reload";
			readonly expectedEditor?: ShadowingWorkspaceState["editor"];
	  }
	| {
			readonly type: "confirm-cue-reload";
			readonly expectedEditor?: ShadowingWorkspaceState["editor"];
	  }
	| { readonly type: "start-practice-selected" }
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
	| { readonly type: "delete-record"; readonly record: ShadowingRecordRow };
