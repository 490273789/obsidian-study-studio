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

export type VideoPlayerPlaybackStateV1 = Pick<
	DeviceVideoPlayerStateV1,
	| "schemaVersion"
	| "sources"
	| "currentSourceId"
	| "progressBySource"
	| "completedSourceIds"
	| "playbackRate"
>;

export type VideoPlayerPresentationStateV1 = Pick<
	DeviceVideoPlayerStateV1,
	"floatingRect" | "queueExpanded"
>;

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
}

/** Narrow boundary over the single media element owned by the runtime. */
export interface VideoMediaPort {
	currentTime: number;
	readonly duration: number;
	paused: boolean;
	playbackRate: number;
	src: string;
	play(): Promise<void>;
	pause(): void;
	load(): void;
	addEventListener(type: string, listener: EventListener): void;
	removeEventListener(type: string, listener: EventListener): void;
}

export interface VideoPlayerStateStore {
	load(): VideoPlayerPlaybackStateV1;
	save(state: VideoPlayerPlaybackStateV1): void;
	clear(): void;
}
