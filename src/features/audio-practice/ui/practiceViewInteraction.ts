import type { AudioPracticeRuntime } from "../domain/audioPracticeRuntime";
import { AUDIO_PLAYBACK_RATES } from "../domain/types";

const EDITABLE_SELECTOR = "input,textarea,select,[contenteditable=true]";
const CONTROL_SELECTOR = "button,[role=button],a[href]";

/**
 * Cue rows are buttons so they can receive roving focus, but they keep acting
 * like the practice surface: Space, arrows, and the letter shortcuts stay with
 * the panel there. Every other control keeps its own native key handling.
 */
export const CUE_ROW_ATTRIBUTE = "data-cue-row";

export function blocksPracticeShortcut(target: Element | null): boolean {
	if (!target?.closest) return false;
	if (target.closest(EDITABLE_SELECTOR)) return true;
	const control = target.closest(CONTROL_SELECTOR);
	return Boolean(control && !control.hasAttribute(CUE_ROW_ATTRIBUTE));
}

export interface PracticeViewInteractionOptions {
	readonly runtime: Pick<
		AudioPracticeRuntime,
		"togglePlayback" | "previous" | "next" | "pause" | "bindMedia"
	> &
		Partial<
			Pick<
				AudioPracticeRuntime,
				| "repeat"
				| "toggleDifficult"
				| "reveal"
				| "getSnapshot"
				| "seekTo"
				| "setPlaybackRate"
			>
		>;
	readonly getContainer?: () => HTMLElement | null;
	readonly containerRef?: { readonly current: HTMLElement | null };
}

/**
 * Encapsulates DOM interaction, keyboard shortcuts, visibility listeners,
 * and cue scroll tracking for the audio practice view.
 */
export class PracticeViewInteraction {
	private mediaCleanup: (() => void) | null = null;
	private disposed = false;

	constructor(private readonly options: PracticeViewInteractionOptions) {}

	handleKeyDown = (event: React.KeyboardEvent | KeyboardEvent): void => {
		if (this.disposed) return;
		const target = event.target as HTMLElement | null;
		if (
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			(event as KeyboardEvent).isComposing ||
			("nativeEvent" in event && event.nativeEvent.isComposing) ||
			blocksPracticeShortcut(target)
		) {
			return;
		}

		const key = event.key;
		if (
			(event.shiftKey && (key === "ArrowLeft" || key === "ArrowRight")) ||
			key === "j" ||
			key === "J" ||
			key === "l" ||
			key === "L"
		) {
			const snapshot = this.options.runtime.getSnapshot?.();
			if (snapshot && typeof snapshot.currentTime === "number") {
				event.preventDefault();
				const delta = key === "ArrowLeft" || key === "j" || key === "J" ? -3 : 3;
				const duration = snapshot.duration ?? Number.POSITIVE_INFINITY;
				const targetTime = Math.max(0, Math.min(duration, snapshot.currentTime + delta));
				this.options.runtime.seekTo?.(targetTime);
				return;
			}
		}

		if (key === "[" || key === "]") {
			const snapshot = this.options.runtime.getSnapshot?.();
			if (snapshot && snapshot.playbackRate) {
				event.preventDefault();
				const currentIndex = AUDIO_PLAYBACK_RATES.indexOf(snapshot.playbackRate);
				if (currentIndex >= 0) {
					const nextIndex =
						key === "["
							? Math.max(0, currentIndex - 1)
							: Math.min(AUDIO_PLAYBACK_RATES.length - 1, currentIndex + 1);
					this.options.runtime.setPlaybackRate?.(AUDIO_PLAYBACK_RATES[nextIndex]!);
				}
				return;
			}
		}

		if (key === " ") {
			event.preventDefault();
			this.options.runtime.togglePlayback();
		} else if (key === "ArrowLeft" || key === "ArrowUp") {
			event.preventDefault();
			this.options.runtime.previous();
		} else if (key === "ArrowRight" || key === "ArrowDown") {
			event.preventDefault();
			this.options.runtime.next();
		} else if (key === "r" || key === "R") {
			event.preventDefault();
			this.options.runtime.repeat?.();
		} else if (key === "s" || key === "S" || key === "d" || key === "D") {
			const cueId = this.options.runtime.getSnapshot?.().currentCueId;
			if (cueId) {
				event.preventDefault();
				this.options.runtime.toggleDifficult?.(cueId);
			}
		} else if (key === "h" || key === "H") {
			const snapshot = this.options.runtime.getSnapshot?.();
			if (snapshot?.blind && snapshot.currentCueId) {
				event.preventDefault();
				this.options.runtime.reveal?.();
			}
		}
	};

	bindMedia = (element: HTMLAudioElement | null): (() => void) => {
		if (this.mediaCleanup) {
			this.mediaCleanup();
			this.mediaCleanup = null;
		}
		if (!element || this.disposed) return () => {};

		const releaseMedia = this.options.runtime.bindMedia(element);
		const handleVisibilityChange = () => {
			if (element.ownerDocument.hidden) {
				this.options.runtime.pause();
			}
		};

		element.ownerDocument.addEventListener("visibilitychange", handleVisibilityChange);

		const cleanup = () => {
			element.ownerDocument.removeEventListener("visibilitychange", handleVisibilityChange);
			releaseMedia();
		};

		this.mediaCleanup = cleanup;
		return cleanup;
	};

	syncCueScroll = (cueId: string | null, container?: HTMLElement | null): void => {
		if (this.disposed || !cueId) return;
		const targetContainer =
			container ?? this.options.containerRef?.current ?? this.options.getContainer?.();
		if (!targetContainer) return;

		const active = targetContainer.querySelector<HTMLElement>('[data-current-cue="true"]');
		if (!active) return;

		const reduceMotion =
			active.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
				.matches ?? false;

		active.scrollIntoView({
			block: "nearest",
			behavior: reduceMotion ? "auto" : "smooth",
		});
	};

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.mediaCleanup) {
			this.mediaCleanup();
			this.mediaCleanup = null;
		}
	}
}
