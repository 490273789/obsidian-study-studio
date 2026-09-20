import type {
	DeviceVideoPlayerStateV1,
	VideoPlayerPlaybackStateV1,
	VideoPlayerPresentationStateV1,
} from "./types";

export interface VideoPlayerDocumentStore {
	load(): DeviceVideoPlayerStateV1;
	save(state: DeviceVideoPlayerStateV1): void;
	clear(): void;
}

export interface VideoPlayerPlaybackStateStore {
	load(): VideoPlayerPlaybackStateV1;
	save(state: VideoPlayerPlaybackStateV1): void;
	clear(): void;
}

export interface VideoPlayerPresentationStateStore {
	load(): VideoPlayerPresentationStateV1;
	save(state: VideoPlayerPresentationStateV1): void;
	subscribe(listener: () => void): () => void;
}

export interface LocalVideoPlayerStateFailure {
	readonly kind: "presentation-save-failed";
	readonly error: unknown;
}

export interface LocalVideoPlayerStateAuthorityOptions {
	readonly report?: (failure: LocalVideoPlayerStateFailure) => void;
}

export class LocalVideoPlayerStateAuthority {
	private document: DeviceVideoPlayerStateV1;
	private readonly presentationListeners = new Set<() => void>();

	readonly playback: VideoPlayerPlaybackStateStore = {
		load: () => playbackState(this.document),
		save: (state) => {
			this.document = { ...this.document, ...state };
			this.store.save(this.document);
		},
		clear: () => this.clear(),
	};

	readonly presentation: VideoPlayerPresentationStateStore = {
		load: () => presentationState(this.document),
		save: (state) => {
			this.document = { ...this.document, ...state };
			try {
				this.store.save(this.document);
			} catch (error) {
				this.options.report?.({ kind: "presentation-save-failed", error });
			}
			this.publishPresentation();
		},
		subscribe: (listener) => {
			this.presentationListeners.add(listener);
			return () => this.presentationListeners.delete(listener);
		},
	};

	constructor(
		private readonly store: VideoPlayerDocumentStore,
		private readonly options: LocalVideoPlayerStateAuthorityOptions = {},
	) {
		this.document = store.load();
	}

	clear(): void {
		const previous = this.document;
		this.store.clear();
		this.document = {
			schemaVersion: 1,
			sources: [],
			currentSourceId: null,
			progressBySource: {},
			completedSourceIds: [],
			playbackRate: 1,
			floatingRect: null,
			queueExpanded: true,
		};
		if (
			previous.floatingRect !== this.document.floatingRect ||
			previous.queueExpanded !== this.document.queueExpanded
		) {
			this.publishPresentation();
		}
	}

	private publishPresentation(): void {
		for (const listener of this.presentationListeners) listener();
	}
}

function playbackState(document: DeviceVideoPlayerStateV1): VideoPlayerPlaybackStateV1 {
	return {
		schemaVersion: 1,
		sources: document.sources,
		currentSourceId: document.currentSourceId,
		progressBySource: document.progressBySource,
		completedSourceIds: document.completedSourceIds,
		playbackRate: document.playbackRate,
	};
}

function presentationState(document: DeviceVideoPlayerStateV1): VideoPlayerPresentationStateV1 {
	return {
		floatingRect: document.floatingRect,
		queueExpanded: document.queueExpanded,
	};
}
