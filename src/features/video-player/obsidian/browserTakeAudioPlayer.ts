import type { TakeAudioPlayerPort } from "../domain/types";

/**
 * Browser/Obsidian adapter for playing saved shadowing takes.
 * Keeps HTMLAudioElement, Blob, and URL.createObjectURL out of the domain layer.
 */
export function createBrowserTakeAudioPlayer(): TakeAudioPlayerPort {
	let audio: HTMLAudioElement | null = null;
	let audioUrl: string | null = null;

	const stop = () => {
		if (audio) {
			audio.pause();
			audio = null;
		}
		if (audioUrl) {
			URL.revokeObjectURL(audioUrl);
			audioUrl = null;
		}
	};

	return {
		async play(data: ArrayBuffer, mimeType: string): Promise<void> {
			stop();
			const url = URL.createObjectURL(new Blob([data], { type: mimeType || "audio/webm" }));
			audioUrl = url;
			const current = new Audio(url);
			audio = current;
			current.addEventListener(
				"ended",
				() => {
					if (audio === current) stop();
				},
				{ once: true },
			);
			current.addEventListener(
				"error",
				() => {
					if (audio === current) stop();
				},
				{ once: true },
			);
			await current.play();
		},
		stop,
		dispose: stop,
	};
}
