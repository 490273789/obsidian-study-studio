import { describe, expect, it, vi } from "vite-plus/test";
import { PracticeViewInteraction } from "../practiceViewInteraction";

describe("PracticeViewInteraction", () => {
	it("dispatches space, left and right arrow keys to runtime", () => {
		const togglePlayback = vi.fn();
		const previous = vi.fn();
		const next = vi.fn();
		const pause = vi.fn();
		const bindMedia = vi.fn(() => () => {});

		const interaction = new PracticeViewInteraction({
			runtime: { togglePlayback, previous, next, pause, bindMedia },
		});

		const preventDefault = vi.fn();
		interaction.handleKeyDown({
			key: " ",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);

		expect(preventDefault).toHaveBeenCalled();
		expect(togglePlayback).toHaveBeenCalledTimes(1);

		interaction.handleKeyDown({
			key: "ArrowLeft",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(previous).toHaveBeenCalledTimes(1);

		interaction.handleKeyDown({
			key: "ArrowRight",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(next).toHaveBeenCalledTimes(1);
	});

	it("ignores keyboard events from inputs or with modifier keys", () => {
		const togglePlayback = vi.fn();
		const interaction = new PracticeViewInteraction({
			runtime: {
				togglePlayback,
				previous: vi.fn(),
				next: vi.fn(),
				pause: vi.fn(),
				bindMedia: vi.fn(() => () => {}),
			},
		});

		interaction.handleKeyDown({
			key: " ",
			defaultPrevented: false,
			preventDefault: vi.fn(),
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: (sel: string) => (sel.includes("input") ? {} : null) },
		} as unknown as KeyboardEvent);

		expect(togglePlayback).not.toHaveBeenCalled();

		interaction.handleKeyDown({
			key: " ",
			defaultPrevented: false,
			preventDefault: vi.fn(),
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);

		expect(togglePlayback).not.toHaveBeenCalled();
	});

	it("binds media and pauses on ownerDocument visibilitychange", () => {
		const pause = vi.fn();
		const releaseMedia = vi.fn();
		const bindMedia = vi.fn(() => releaseMedia);

		const interaction = new PracticeViewInteraction({
			runtime: {
				togglePlayback: vi.fn(),
				previous: vi.fn(),
				next: vi.fn(),
				pause,
				bindMedia,
			},
		});

		const listeners: Record<string, () => void> = {};
		const doc = {
			hidden: false,
			addEventListener: (event: string, fn: () => void) => {
				listeners[event] = fn;
			},
			removeEventListener: (event: string) => {
				delete listeners[event];
			},
		};
		const audio = { ownerDocument: doc } as unknown as HTMLAudioElement;

		const unbind = interaction.bindMedia(audio);
		expect(bindMedia).toHaveBeenCalledWith(audio);

		doc.hidden = true;
		listeners.visibilitychange?.();
		expect(pause).toHaveBeenCalledTimes(1);

		unbind();
		expect(releaseMedia).toHaveBeenCalledTimes(1);

		listeners.visibilitychange?.();
		expect(pause).toHaveBeenCalledTimes(1);
	});
});
