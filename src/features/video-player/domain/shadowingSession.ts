import type { VideoPlayerRuntime } from "./videoPlayerRuntime";
import type { VideoPlaybackRate } from "./types";

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
export interface ShadowingSnapshot {
	readonly phase:
		| "idle"
		| "playing"
		| "resting"
		| "countdown"
		| "recording"
		| "review"
		| "paused";
	readonly range: ShadowingRange | null;
	readonly mode: ShadowingMode;
	readonly countdown: number;
	readonly restSeconds: number;
	readonly responseMultiplier: number;
	readonly take: ShadowingTake | null;
	readonly error: string | null;
	readonly saving: boolean;
	readonly failedSaves: readonly ShadowingTake[];
}
interface ShadowingSessionOptions {
	readonly runtime: VideoPlayerRuntime;
	readonly recorder: ShadowRecorderPort;
	readonly saveTake?: (take: ShadowingTake) => Promise<void>;
	readonly now?: () => number;
}

/** One activity token owns playback, timers, and microphone work, across both player surfaces. */
export class ShadowingSession {
	private snapshot: ShadowingSnapshot = {
		phase: "idle",
		range: null,
		mode: "shadow",
		countdown: 0,
		restSeconds: 2,
		responseMultiplier: 1,
		take: null,
		error: null,
		saving: false,
		failedSaves: [],
	};
	private readonly listeners = new Set<() => void>();
	private readonly saving = new Map<string, Promise<void>>();
	private readonly failures = new Map<string, ShadowingTake>();
	private generation = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private cancelWait: (() => void) | null = null;
	private disposed = false;
	private sourceId: string | null;
	private watchRate: VideoPlaybackRate;
	private readonly unsubscribe: () => void;
	private readonly unsubscribeInterruptions: () => void;

	constructor(private readonly options: ShadowingSessionOptions) {
		const current = options.runtime.getSnapshot();
		this.sourceId = current.currentSourceId;
		this.watchRate = current.playbackRate;
		this.unsubscribeInterruptions = options.runtime.subscribeInterruptions(() => {
			if (["playing", "resting", "countdown", "recording"].includes(this.snapshot.phase))
				this.stop();
		});
		this.unsubscribe = options.runtime.subscribe(() => {
			const current = options.runtime.getSnapshot();
			if (current.currentSourceId !== this.sourceId) this.setSource(current.currentSourceId);
			if (
				current.error &&
				this.snapshot.phase !== "idle" &&
				this.snapshot.phase !== "paused"
			) {
				this.stop();
				this.update({ error: "视频播放失败，请重试" });
			}
		});
	}
	getSnapshot = (): ShadowingSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	selectRange(sourceId: string, start: number, end: number, text?: string): void {
		if (this.disposed) return;
		if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
			this.update({ error: "请选择有效的练习范围" });
			return;
		}
		if (!this.snapshot.range) this.watchRate = this.options.runtime.getSnapshot().playbackRate;
		this.stop();
		this.sourceId = sourceId;
		this.update({ range: { sourceId, start, end, text }, error: null });
	}
	setMode(mode: ShadowingMode): void {
		if (mode !== this.snapshot.mode) {
			this.stop();
			this.update({ mode });
		}
	}
	setRestSeconds(seconds: number): void {
		if (Number.isFinite(seconds))
			this.update({ restSeconds: Math.max(0, Math.min(60, seconds)) });
	}
	setResponseMultiplier(multiplier: number): void {
		if (Number.isFinite(multiplier))
			this.update({ responseMultiplier: Math.max(0.25, Math.min(4, multiplier)) });
	}
	/** Finish the current response/rest window early, without interrupting active media. */
	continueEarly(): void {
		if (this.snapshot.phase !== "resting") return;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		this.cancelWait?.();
		this.cancelWait = null;
	}
	setSource(sourceId: string | null): void {
		if (sourceId === this.sourceId) return;
		this.sourceId = sourceId;
		this.leave();
	}
	startLoop(): void {
		const range = this.validRange();
		if (!range) return;
		this.stop();
		const token = this.generation;
		this.update({ error: null });
		void this.loop(token, range).catch((error: unknown) => this.fail(token, error));
	}
	stop(): void {
		this.generation++;
		if (this.timer !== null) clearTimeout(this.timer);
		this.timer = null;
		this.cancelWait?.();
		this.cancelWait = null;
		this.update({ phase: this.snapshot.range ? "paused" : "idle", countdown: 0 });
		this.options.recorder.cancel();
		this.options.runtime.stopRange();
		this.options.runtime.pause();
		this.update({ phase: this.snapshot.range ? "paused" : "idle", countdown: 0 });
	}
	recordOnce(): void {
		const range = this.validRange();
		if (!range) return;
		this.stop();
		const token = this.generation;
		this.update({ take: null, error: null });
		void this.record(token, range).catch((error: unknown) => this.fail(token, error));
	}
	replayTake(): void {
		const take = this.snapshot.take;
		if (!take) return;
		this.stop();
		const token = this.generation;
		this.update({ phase: "review", error: null });
		void this.options.recorder
			.play(take.blob)
			.catch((error: unknown) => this.fail(token, error));
	}
	replayOriginal(): void {
		const take = this.snapshot.take;
		const range = take?.range ?? this.validRange();
		if (!range || range.sourceId !== this.options.runtime.getSnapshot().currentSourceId) return;
		this.stop();
		if (take) this.options.runtime.setPlaybackRate(take.playbackRate);
		const token = this.generation;
		this.update({ phase: "playing" });
		void this.options.runtime
			.playRange(range.start, range.end)
			.then(() => {
				if (this.active(token))
					this.update({ phase: this.snapshot.take ? "review" : "paused" });
			})
			.catch((error: unknown) => this.fail(token, error));
	}
	saveTake(take: ShadowingTake | null = this.snapshot.take): Promise<void> {
		if (!take || !this.options.saveTake) return Promise.resolve();
		const existing = this.saving.get(take.id);
		if (existing) return existing;
		// Capture the take before starting I/O: leave/switch/discard cannot revoke an accepted save.
		const save = Promise.resolve()
			.then(() => this.options.saveTake!(take))
			.then(
				() => {
					this.failures.delete(take.id);
				},
				(error: unknown) => {
					this.failures.set(take.id, take);
					this.update({ error: errorMessage(error) });
				},
			)
			.finally(() => {
				this.saving.delete(take.id);
				this.update({
					saving: this.saving.size > 0,
					failedSaves: [...this.failures.values()],
				});
			});
		this.saving.set(take.id, save);
		this.update({ saving: true, error: null });
		return save;
	}
	retrySave(takeId: string): Promise<void> {
		return this.saveTake(this.failures.get(takeId) ?? null);
	}
	discardTake(): void {
		this.stop();
		this.update({ take: null });
	}
	leave({ seekToEnd = true }: { seekToEnd?: boolean } = {}): void {
		const range = this.snapshot.range;
		this.stop();
		this.update({ range: null, take: null, phase: "idle", error: null });
		if (range?.sourceId === this.options.runtime.getSnapshot().currentSourceId) {
			this.options.runtime.setPlaybackRate(this.watchRate);
			if (seekToEnd) this.options.runtime.seekTo(range.end);
		}
	}
	dispose(): void {
		if (this.disposed) return;
		this.leave();
		this.disposed = true;
		this.unsubscribe();
		this.unsubscribeInterruptions();
		this.options.recorder.dispose();
		this.listeners.clear();
	}

	private validRange(): ShadowingRange | null {
		if (this.disposed) return null;
		const range = this.snapshot.range;
		if (!range || range.sourceId !== this.options.runtime.getSnapshot().currentSourceId) {
			this.update({ error: "请先选择当前视频的练习片段" });
			return null;
		}
		return range;
	}
	private async loop(token: number, range: ShadowingRange): Promise<void> {
		while (this.active(token)) {
			this.update({ phase: "playing" });
			const rate = this.options.runtime.getSnapshot().playbackRate;
			const result = await this.options.runtime.playRange(range.start, range.end);
			if (!this.active(token)) return;
			if (result !== "completed") {
				this.stop();
				return;
			}
			this.update({ phase: "resting" });
			const seconds =
				this.snapshot.mode === "repeat-after"
					? ((range.end - range.start) / rate) * this.snapshot.responseMultiplier + 1
					: this.snapshot.restSeconds;
			await this.wait(seconds * 1000);
		}
	}
	private async record(token: number, range: ShadowingRange): Promise<void> {
		for (let countdown = 3; countdown > 0; countdown--) {
			this.update({ phase: "countdown", countdown });
			await this.wait(1000);
			if (!this.active(token)) return;
		}
		const mode = this.snapshot.mode;
		const playbackRate = this.options.runtime.getSnapshot().playbackRate;
		if (mode === "repeat-after") {
			this.update({ phase: "playing", countdown: 0 });
			if (
				(await this.options.runtime.playRange(range.start, range.end)) !== "completed" ||
				!this.active(token)
			) {
				if (this.active(token)) this.stop();
				return;
			}
		}
		await this.options.recorder.start();
		if (!this.active(token)) {
			this.options.recorder.cancel();
			return;
		}
		this.update({ phase: "recording", countdown: 0 });
		if (mode === "shadow") {
			if (
				(await this.options.runtime.playRange(range.start, range.end)) !== "completed" ||
				!this.active(token)
			) {
				if (this.active(token)) this.stop();
				return;
			}
		} else
			await this.wait(
				(((range.end - range.start) / playbackRate) * this.snapshot.responseMultiplier +
					1) *
					1000,
			);
		if (!this.active(token)) return;
		const blob = await this.options.recorder.stop();
		if (!this.active(token)) return;
		if (!blob.size) throw new Error("未录到声音，请检查麦克风后重试");
		const createdAt = (this.options.now ?? Date.now)();
		this.update({
			phase: "review",
			take: {
				id: `take-${createdAt}-${this.generation}`,
				range: { ...range },
				mode,
				playbackRate,
				createdAt,
				blob,
				mimeType: blob.type,
			},
		});
	}
	private wait(milliseconds: number): Promise<void> {
		return new Promise((resolve) => {
			this.cancelWait = resolve;
			this.timer = setTimeout(() => {
				this.timer = null;
				this.cancelWait = null;
				resolve();
			}, milliseconds);
		});
	}
	private active(token: number): boolean {
		return !this.disposed && this.generation === token;
	}
	private fail(token: number, error: unknown): void {
		if (!this.active(token)) return;
		this.stop();
		this.update({ error: errorMessage(error) });
	}
	private update(patch: Partial<ShadowingSnapshot>): void {
		this.snapshot = { ...this.snapshot, ...patch };
		if (!this.disposed) for (const listener of this.listeners) listener();
	}
}
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
