import type { SubtitleCue } from "../../../core/media/subtitles";

/** How close to a sentence or media boundary still counts as finished (seconds). */
const END_EPSILON_SECONDS = 0.25;

export interface PracticeCompletion {
	/** 1-based index of the sentence the practice stopped on. */
	readonly reached: number;
	readonly total: number;
	readonly marked: number;
}

export interface PracticeCompletionInput {
	/** The sentences on screen, already filtered by difficult-only practice. */
	readonly cues: readonly SubtitleCue[];
	readonly currentCueId: string | null;
	readonly currentTime: number;
	readonly duration: number | null;
	readonly offset: number;
	readonly marked: number;
}

/**
 * A session is complete once playback reaches the end of the last visible
 * sentence (or the end of the media). Returns `null` while practice is running,
 * so the view can render its completion state from a single derived value.
 */
export function practiceCompletion(input: PracticeCompletionInput): PracticeCompletion | null {
	const { cues, currentCueId, currentTime, duration, offset, marked } = input;
	if (cues.length === 0) return null;
	const last = cues[cues.length - 1]!;
	const reachedMediaEnd = duration !== null && currentTime >= duration - END_EPSILON_SECONDS;
	const reachedCueEnd = currentTime >= last.end + offset - END_EPSILON_SECONDS;
	if (!reachedMediaEnd && !reachedCueEnd) return null;
	const index = currentCueId ? cues.findIndex((cue) => cue.id === currentCueId) : -1;
	return {
		reached: index >= 0 ? index + 1 : cues.length,
		total: cues.length,
		marked,
	};
}

/**
 * Accumulates the time actually spent playing, so a completion summary can
 * report session length without counting pauses. Owned by the view and fed by
 * the snapshot's `playing` flag.
 */
export class PracticeSessionClock {
	private total = 0;
	private runningSince: number | null = null;

	constructor(private readonly now: () => number = () => Date.now()) {}

	setPlaying(playing: boolean): void {
		if (playing === (this.runningSince !== null)) return;
		const stamp = this.now();
		if (playing) {
			this.runningSince = stamp;
			return;
		}
		if (this.runningSince !== null) {
			this.total += Math.max(0, stamp - this.runningSince);
			this.runningSince = null;
		}
	}

	elapsedMs(): number {
		if (this.runningSince === null) return this.total;
		return this.total + Math.max(0, this.now() - this.runningSince);
	}

	reset(): void {
		this.total = 0;
		this.runningSince = null;
	}
}
