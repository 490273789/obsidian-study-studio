import {
	VIDEO_PLAYBACK_RATES,
	type DeviceVideoPlayerStateV1,
	type FloatingRect,
	type LocalVideoSource,
	type VideoMediaPort,
	type VideoPlaybackRate,
	type VideoPlayerSnapshot,
	type VideoPlayerStateStore,
} from "./types";

export interface VideoPlayerRuntimeOptions {
	readonly state: VideoPlayerStateStore;
	readonly toMediaUrl: (path: string) => string;
	readonly now?: () => number;
}

const PROGRESS_SAVE_INTERVAL_MS = 5_000;

/**
 * Plugin-lifetime playback authority. It deliberately has no DOM ownership:
 * the view may move its one bound media element between docked and floating UI.
 */
export class VideoPlayerRuntime {
	private state: DeviceVideoPlayerStateV1;
	private media: VideoMediaPort | null = null;
	private snapshot!: VideoPlayerSnapshot;
	private readonly listeners = new Set<() => void>();
	private lastProgressSaveAt = 0;
	private loadingMedia = false;
	private error: VideoPlayerSnapshot["error"] = null;
	private disposed = false;

	constructor(private readonly options: VideoPlayerRuntimeOptions) {
		this.state = options.state.load();
		this.publish();
	}

	getSnapshot = (): VideoPlayerSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	bindMedia(media: VideoMediaPort): () => void {
		if (this.media && this.media !== media) this.pauseAndSave();
		this.unbindMedia();
		if (this.disposed) return () => undefined;
		this.media = media;
		media.playbackRate = this.state.playbackRate;
		this.loadCurrentMedia();
		media.addEventListener("play", this.handleMediaChanged);
		media.addEventListener("pause", this.handleMediaPaused);
		media.addEventListener("timeupdate", this.handleMediaChanged);
		media.addEventListener("loadedmetadata", this.handleLoadedMetadata);
		media.addEventListener("ended", this.handleEnded);
		media.addEventListener("error", this.handleError);
		this.publish();
		return () => {
			if (this.media === media) this.unbindMedia();
		};
	}

	addSources(sources: readonly LocalVideoSource[]): void {
		if (this.disposed) return;
		const knownPaths = new Set(this.state.sources.map((source) => source.path));
		const additions = sources.filter((source) => {
			if (knownPaths.has(source.path)) return false;
			knownPaths.add(source.path);
			return true;
		});
		if (additions.length === 0) return;
		this.state = {
			...this.state,
			sources: [...this.state.sources, ...additions],
			currentSourceId: this.state.currentSourceId ?? additions[0]!.id,
		};
		this.persist();
		this.loadCurrentMedia();
		this.publish();
	}

	replaceSource(sourceId: string, replacement: LocalVideoSource): void {
		if (this.disposed || !this.state.sources.some((source) => source.id === sourceId)) return;
		if (
			this.state.sources.some(
				(source) => source.id !== sourceId && source.path === replacement.path,
			)
		)
			return;
		this.pauseAndSave();
		this.state = {
			...this.state,
			sources: this.state.sources.map((source) =>
				source.id === sourceId ? replacement : source,
			),
			currentSourceId:
				this.state.currentSourceId === sourceId
					? replacement.id
					: this.state.currentSourceId,
			progressBySource: renameRecordKey(
				this.state.progressBySource,
				sourceId,
				replacement.id,
			),
			completedSourceIds: this.state.completedSourceIds.map((id) =>
				id === sourceId ? replacement.id : id,
			),
		};
		this.persist();
		this.loadCurrentMedia();
		this.publish();
	}

	removeSource(sourceId: string): void {
		const index = this.state.sources.findIndex((source) => source.id === sourceId);
		if (this.disposed || index < 0) return;
		this.pauseAndSave();
		const sources = this.state.sources.filter((source) => source.id !== sourceId);
		const currentSourceId =
			this.state.currentSourceId === sourceId
				? (sources[index]?.id ?? sources[index - 1]?.id ?? null)
				: this.state.currentSourceId;
		const { [sourceId]: _removed, ...progressBySource } = this.state.progressBySource;
		this.state = {
			...this.state,
			sources,
			currentSourceId,
			progressBySource,
			completedSourceIds: this.state.completedSourceIds.filter((id) => id !== sourceId),
		};
		this.persist();
		this.loadCurrentMedia();
		this.publish();
	}

	reorderSources(sourceIds: readonly string[]): void {
		if (this.disposed || sourceIds.length !== this.state.sources.length) return;
		const byId = new Map(this.state.sources.map((source) => [source.id, source]));
		const sources = sourceIds
			.map((id) => byId.get(id))
			.filter((source): source is LocalVideoSource => !!source);
		if (sources.length !== this.state.sources.length) return;
		this.state = { ...this.state, sources };
		this.persist();
		this.publish();
	}

	selectSource(sourceId: string): void {
		if (this.disposed || !this.state.sources.some((source) => source.id === sourceId)) return;
		this.pauseAndSave();
		const completed = this.state.completedSourceIds.includes(sourceId);
		this.state = {
			...this.state,
			currentSourceId: sourceId,
			progressBySource: completed
				? { ...this.state.progressBySource, [sourceId]: 0 }
				: this.state.progressBySource,
			completedSourceIds: completed
				? this.state.completedSourceIds.filter((id) => id !== sourceId)
				: this.state.completedSourceIds,
		};
		this.persist();
		this.loadCurrentMedia();
		this.publish();
	}

	togglePlayback(): void {
		if (!this.media || !this.currentSource()) return;
		if (this.media.paused) void this.media.play().catch(() => this.setError("playback"));
		else this.media.pause();
	}

	seekBy(seconds: number): void {
		if (!this.media || !Number.isFinite(this.media.duration)) return;
		this.media.currentTime = clamp(this.media.currentTime + seconds, 0, this.media.duration);
		this.saveProgress(true);
		this.publish();
	}

	setPlaybackRate(rate: VideoPlaybackRate): void {
		if (!VIDEO_PLAYBACK_RATES.includes(rate)) return;
		this.state = { ...this.state, playbackRate: rate };
		if (this.media) this.media.playbackRate = rate;
		this.persist();
		this.publish();
	}

	previous(): void {
		const index = this.currentIndex();
		if (index > 0) this.selectSource(this.state.sources[index - 1]!.id);
	}

	next(autoPlay = false): void {
		const index = this.currentIndex();
		if (index >= 0 && index + 1 < this.state.sources.length) {
			this.selectSource(this.state.sources[index + 1]!.id);
			if (autoPlay && this.media)
				void this.media.play().catch(() => this.setError("playback"));
		}
	}

	setFloating(floating: boolean): void {
		if (this.disposed || this.snapshot.floating === floating) return;
		this.publish({ floating });
	}

	setFloatingRect(rect: FloatingRect | null): void {
		if (this.disposed) return;
		this.state = { ...this.state, floatingRect: rect };
		this.persist();
		this.publish();
	}

	pause(): void {
		this.media?.pause();
		this.saveProgress(true);
	}

	clearLocalData(): void {
		this.pause();
		this.state = emptyState();
		this.options.state.clear();
		this.loadCurrentMedia();
		this.publish();
	}

	dispose(): void {
		if (this.disposed) return;
		this.pauseAndSave();
		this.disposed = true;
		this.unbindMedia();
		this.listeners.clear();
	}

	private currentSource(): LocalVideoSource | null {
		return (
			this.state.sources.find((source) => source.id === this.state.currentSourceId) ?? null
		);
	}
	private currentIndex(): number {
		return this.state.sources.findIndex((source) => source.id === this.state.currentSourceId);
	}
	private loadCurrentMedia(): void {
		if (!this.media) return;
		const source = this.currentSource();
		this.error = null;
		this.loadingMedia = true;
		try {
			this.media.pause();
			this.media.src = source ? this.options.toMediaUrl(source.path) : "";
			this.media.load();
			this.media.currentTime = source ? (this.state.progressBySource[source.id] ?? 0) : 0;
		} finally {
			this.loadingMedia = false;
		}
	}
	private handleMediaChanged = (): void => {
		if (this.loadingMedia) return;
		this.saveProgress(false);
		this.publish();
	};
	private handleMediaPaused = (): void => {
		if (this.loadingMedia) return;
		this.saveProgress(true);
		this.publish();
	};
	private handleLoadedMetadata = (): void => {
		const source = this.currentSource();
		if (source && Number.isFinite(this.media?.duration)) {
			const saved = this.state.progressBySource[source.id] ?? 0;
			const clamped = Math.min(saved, this.media!.duration);
			this.media!.currentTime = clamped;
			if (clamped !== saved) {
				this.state = {
					...this.state,
					progressBySource: {
						...this.state.progressBySource,
						[source.id]: clamped,
					},
				};
				this.persist();
			}
		}
		this.handleMediaChanged();
	};
	private handleEnded = (): void => {
		const source = this.currentSource();
		if (source && this.media) {
			this.state = {
				...this.state,
				progressBySource: {
					...this.state.progressBySource,
					[source.id]: this.media.duration,
				},
				completedSourceIds: this.state.completedSourceIds.includes(source.id)
					? this.state.completedSourceIds
					: [...this.state.completedSourceIds, source.id],
			};
			this.persist();
		}
		this.next(true);
		this.publish();
	};
	private handleError = (): void => this.setError("media");
	private setError(error: NonNullable<VideoPlayerSnapshot["error"]>): void {
		this.error = error;
		this.publish();
	}
	private saveProgress(force: boolean): void {
		const source = this.currentSource();
		if (!source || !this.media || !Number.isFinite(this.media.currentTime)) return;
		const now = (this.options.now ?? Date.now)();
		if (!force && now - this.lastProgressSaveAt < PROGRESS_SAVE_INTERVAL_MS) return;
		this.lastProgressSaveAt = now;
		this.state = {
			...this.state,
			progressBySource: {
				...this.state.progressBySource,
				[source.id]: this.media.currentTime,
			},
		};
		this.persist();
	}
	private pauseAndSave(): void {
		this.media?.pause();
		this.saveProgress(true);
	}
	private persist(): void {
		this.options.state.save(this.state);
	}
	private publish(overrides: Partial<Pick<VideoPlayerSnapshot, "floating">> = {}): void {
		const source = this.currentSource();
		this.snapshot = {
			sources: this.state.sources,
			completedSourceIds: this.state.completedSourceIds,
			currentSourceId: this.state.currentSourceId,
			currentTime:
				this.media?.currentTime ??
				(source ? (this.state.progressBySource[source.id] ?? 0) : 0),
			duration:
				this.media && Number.isFinite(this.media.duration) ? this.media.duration : null,
			playbackRate: this.state.playbackRate,
			playing: this.media ? !this.media.paused : false,
			floating: overrides.floating ?? this.snapshot?.floating ?? false,
			floatingRect: this.state.floatingRect,
			error: this.error,
		};
		for (const listener of this.listeners) listener();
	}
	private unbindMedia(): void {
		if (!this.media) return;
		for (const [event, handler] of Object.entries({
			play: this.handleMediaChanged,
			pause: this.handleMediaPaused,
			timeupdate: this.handleMediaChanged,
			loadedmetadata: this.handleLoadedMetadata,
			ended: this.handleEnded,
			error: this.handleError,
		}))
			this.media.removeEventListener(event, handler);
		this.media = null;
	}
}

export function emptyState(): DeviceVideoPlayerStateV1 {
	return {
		schemaVersion: 1,
		sources: [],
		currentSourceId: null,
		progressBySource: {},
		completedSourceIds: [],
		playbackRate: 1,
		floatingRect: null,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
function renameRecordKey(
	record: Readonly<Record<string, number>>,
	previous: string,
	next: string,
): Record<string, number> {
	const { [previous]: value, ...rest } = record;
	return value === undefined ? rest : { ...rest, [next]: value };
}
