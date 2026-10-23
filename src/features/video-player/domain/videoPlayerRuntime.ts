import {
	VIDEO_PLAYBACK_RATES,
	type DeviceVideoPlayerStateV1,
	type FloatingRect,
	type LocalVideoSource,
	type VideoMediaPort,
	type VideoPlaybackRate,
	type VideoPlayerDocumentStore,
	type VideoPlayerSnapshot,
} from "./types";

interface VideoPlayerRuntimeOptions {
	readonly store: VideoPlayerDocumentStore;
	readonly toMediaUrl: (path: string) => string;
	readonly now?: () => number;
	readonly reportError?: (error: unknown) => void;
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
	private bounded: {
		start: number;
		end: number;
		resolve: (result: "completed" | "cancelled") => void;
		timer: ReturnType<typeof setInterval>;
		seeking: boolean;
	} | null = null;
	private readonly interruptionListeners = new Set<() => void>();
	private internalMediaChange = false;
	private suppressEnded = false;

	constructor(private readonly options: VideoPlayerRuntimeOptions) {
		this.state = options.store.load();
		this.publish();
	}

	getSnapshot = (): VideoPlayerSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	subscribeInterruptions(listener: () => void): () => void {
		this.interruptionListeners.add(listener);
		return () => this.interruptionListeners.delete(listener);
	}
	private interrupt(): void {
		for (const listener of this.interruptionListeners) listener();
	}

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
		media.addEventListener("seeking", this.handleSeeking);
		media.addEventListener("seeked", this.handleSeeked);
		media.addEventListener("ratechange", this.handleRateChanged);
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

	async play(): Promise<void> {
		this.suppressEnded = false;
		if (!this.media || !this.currentSource()) throw new Error("No video selected");
		try {
			await this.media.play();
		} catch (error) {
			this.setError("playback");
			throw error;
		}
	}

	/** Resolves only when media time reaches the boundary; cancellation never advances the queue. */
	playRange(start: number, end: number): Promise<"completed" | "cancelled"> {
		this.stopRange();
		this.suppressEnded = true;
		const media = this.media;
		if (
			!media ||
			!this.currentSource() ||
			!Number.isFinite(start) ||
			!Number.isFinite(end) ||
			start < 0 ||
			end <= start ||
			!Number.isFinite(media.duration) ||
			start >= media.duration
		)
			return Promise.reject(new Error("Invalid practice range"));
		return new Promise((resolve, reject) => {
			this.internalMediaChange = true;
			media.pause();
			media.currentTime = start;
			this.internalMediaChange = false;
			const timer = setInterval(this.checkBoundary, 25);
			this.bounded = {
				start,
				end: Math.min(end, media.duration),
				resolve,
				timer,
				seeking: media.seeking ?? false,
			};
			const bounded = this.bounded;
			if (!bounded.seeking)
				void media.play().catch((error) => {
					if (this.bounded !== bounded) return;
					reject(error);
					this.stopRange();
					this.setError("playback");
				});
			this.publish();
		});
	}

	stopRange(): void {
		const bounded = this.bounded;
		if (!bounded) return;
		this.bounded = null;
		clearInterval(bounded.timer);
		bounded.resolve("cancelled");
	}

	private checkBoundary = (): void => {
		const bounded = this.bounded;
		if (!bounded || !this.media || bounded.seeking) return;
		if (this.media.currentTime >= bounded.end) {
			this.bounded = null;
			clearInterval(bounded.timer);
			this.media.pause();
			bounded.resolve("completed");
			this.publish();
		}
	};
	private handleSeeking = (): void => {
		if (this.internalMediaChange) return;
		// The queued seeking event caused by our initial seek is allowed.
		if (
			this.bounded?.seeking &&
			Math.abs((this.media?.currentTime ?? -1) - this.bounded.start) < 0.05
		)
			return;
		this.stopRange();
		this.interrupt();
	};
	private handleSeeked = (): void => {
		const bounded = this.bounded;
		if (!bounded?.seeking || !this.media) return;
		bounded.seeking = false;
		void this.media.play().catch(() => {
			this.stopRange();
			this.setError("playback");
		});
	};
	private handleRateChanged = (): void => {
		if (!this.internalMediaChange) {
			this.stopRange();
			this.interrupt();
		}
	};

	togglePlayback(): void {
		this.interrupt();
		if (!this.bounded) this.suppressEnded = false;
		if (!this.media || !this.currentSource()) return;
		if (this.media.paused) void this.media.play().catch(() => this.setError("playback"));
		else this.media.pause();
	}

	seekBy(seconds: number): void {
		if (!this.media || !Number.isFinite(this.media.duration)) return;
		this.seekTo(this.media.currentTime + seconds);
	}

	seekTo(seconds: number): void {
		this.interrupt();
		if (!this.media || !Number.isFinite(this.media.duration) || !Number.isFinite(seconds))
			return;
		this.stopRange();
		this.media.currentTime = clamp(seconds, 0, this.media.duration);
		this.saveProgress(true);
		this.publish();
	}

	setPlaybackRate(rate: VideoPlaybackRate): void {
		this.interrupt();
		if (!VIDEO_PLAYBACK_RATES.includes(rate)) return;
		this.stopRange();
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

	pause(): void {
		this.interrupt();
		this.stopRange();
		this.media?.pause();
		this.saveProgress(true);
	}

	setQueueExpanded(expanded: boolean): void {
		if (this.disposed || this.state.queueExpanded === expanded) return;
		this.state = { ...this.state, queueExpanded: expanded };
		this.persist();
		this.publish();
	}

	setFloatingRect(rect: FloatingRect | null): void {
		if (this.disposed || this.state.floatingRect === rect) return;
		this.state = { ...this.state, floatingRect: rect };
		this.persist();
		this.publish();
	}

	clearLocalData(): void {
		this.pause();
		this.state = emptyState();
		this.options.store.clear();
		this.loadCurrentMedia();
		this.publish();
	}

	dispose(): void {
		if (this.disposed) return;
		this.pauseAndSave();
		this.disposed = true;
		this.unbindMedia();
		this.listeners.clear();
		this.interruptionListeners.clear();
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
		this.stopRange();
		this.suppressEnded = false;
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
		this.checkBoundary();
		this.saveProgress(false);
		this.publish();
	};
	private handleMediaPaused = (): void => {
		if (this.loadingMedia) return;
		// HTMLMediaElement queues pause events. An earlier internal pause may arrive
		// after playRange has already resumed playback; it must not cancel that range.
		if (this.bounded && this.media && !this.media.paused) return;
		this.checkBoundary();
		if (!this.internalMediaChange) this.stopRange();
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
		if (this.suppressEnded) {
			this.checkBoundary();
			return;
		}
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
	private handleError = (): void => {
		this.stopRange();
		this.setError("media");
	};
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
		this.stopRange();
		this.media?.pause();
		this.saveProgress(true);
	}
	private persist(): void {
		try {
			this.options.store.save(this.state);
		} catch (error) {
			this.options.reportError?.(error);
		}
	}
	private publish(): void {
		const source = this.currentSource();
		this.snapshot = {
			sources: this.state.sources,
			completedSourceIds: this.state.completedSourceIds,
			progressBySource: this.state.progressBySource,
			currentSourceId: this.state.currentSourceId,
			currentTime:
				this.media?.currentTime ??
				(source ? (this.state.progressBySource[source.id] ?? 0) : 0),
			duration:
				this.media && Number.isFinite(this.media.duration) ? this.media.duration : null,
			playbackRate: this.state.playbackRate,
			playing: this.media ? !this.media.paused : false,
			error: this.error,
			queueExpanded: this.state.queueExpanded,
			floatingRect: this.state.floatingRect,
		};
		for (const listener of this.listeners) listener();
	}
	private unbindMedia(): void {
		this.interrupt();
		this.stopRange();
		if (!this.media) return;
		for (const [event, handler] of Object.entries({
			play: this.handleMediaChanged,
			pause: this.handleMediaPaused,
			timeupdate: this.handleMediaChanged,
			loadedmetadata: this.handleLoadedMetadata,
			ended: this.handleEnded,
			error: this.handleError,
			seeking: this.handleSeeking,
			seeked: this.handleSeeked,
			ratechange: this.handleRateChanged,
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
		queueExpanded: false,
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
