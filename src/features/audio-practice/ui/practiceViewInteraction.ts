import type { AudioPracticeRuntime } from "../domain/audioPracticeRuntime";

export interface PracticeViewInteractionOptions {
	readonly runtime: Pick<
		AudioPracticeRuntime,
		"togglePlayback" | "previous" | "next" | "pause" | "bindMedia"
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
		if (
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			(event as KeyboardEvent).isComposing ||
			("nativeEvent" in event && event.nativeEvent.isComposing) ||
			(event.target as HTMLElement).closest?.(
				"button,input,textarea,select,[contenteditable=true]",
			)
		) {
			return;
		}

		if (event.key === " ") {
			event.preventDefault();
			this.options.runtime.togglePlayback();
		} else if (event.key === "ArrowLeft") {
			event.preventDefault();
			this.options.runtime.previous();
		} else if (event.key === "ArrowRight") {
			event.preventDefault();
			this.options.runtime.next();
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
