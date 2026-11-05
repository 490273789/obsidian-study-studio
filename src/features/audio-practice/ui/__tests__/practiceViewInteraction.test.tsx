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

		interaction.handleKeyDown({
			key: "ArrowUp",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(previous).toHaveBeenCalledTimes(2);

		interaction.handleKeyDown({
			key: "ArrowDown",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(next).toHaveBeenCalledTimes(2);
	});

	it("dispatches repeat, difficult toggle and reveal shortcuts", () => {
		const repeat = vi.fn();
		const toggleDifficult = vi.fn();
		const reveal = vi.fn();
		const getSnapshot = vi.fn(() => ({
			currentCueId: "cue-1",
			blind: true,
		}));

		const interaction = new PracticeViewInteraction({
			runtime: {
				togglePlayback: vi.fn(),
				previous: vi.fn(),
				next: vi.fn(),
				pause: vi.fn(),
				bindMedia: vi.fn(() => () => {}),
				repeat,
				toggleDifficult,
				reveal,
				getSnapshot: getSnapshot as never,
			},
		});

		const preventDefault = vi.fn();
		interaction.handleKeyDown({
			key: "r",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(repeat).toHaveBeenCalledTimes(1);

		interaction.handleKeyDown({
			key: "S",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(toggleDifficult).toHaveBeenCalledWith("cue-1");

		interaction.handleKeyDown({
			key: "h",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(reveal).toHaveBeenCalledTimes(1);
	});

	it("dispatches shift+arrow and j/l for seeking, and [ / ] for speed rate adjustments", () => {
		const seekTo = vi.fn();
		const setPlaybackRate = vi.fn();
		const getSnapshot = vi.fn(() => ({
			currentTime: 10,
			duration: 60,
			playbackRate: 1,
		}));

		const interaction = new PracticeViewInteraction({
			runtime: {
				togglePlayback: vi.fn(),
				previous: vi.fn(),
				next: vi.fn(),
				pause: vi.fn(),
				bindMedia: vi.fn(() => () => {}),
				seekTo,
				setPlaybackRate,
				getSnapshot: getSnapshot as never,
			},
		});

		const preventDefault = vi.fn();
		interaction.handleKeyDown({
			key: "ArrowLeft",
			shiftKey: true,
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(seekTo).toHaveBeenCalledWith(7);

		interaction.handleKeyDown({
			key: "l",
			shiftKey: false,
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(seekTo).toHaveBeenCalledWith(13);

		interaction.handleKeyDown({
			key: "[",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(setPlaybackRate).toHaveBeenCalledWith(0.75);

		interaction.handleKeyDown({
			key: "]",
			defaultPrevented: false,
			preventDefault,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			target: { closest: () => null },
		} as unknown as KeyboardEvent);
		expect(setPlaybackRate).toHaveBeenCalledWith(1.25);
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

	it("leaves activation keys to focused controls but keeps them on cue rows", () => {
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

		const target = (attributes: Record<string, string>) => {
			const element = {
				closest(selector: string) {
					if (selector.includes("[contenteditable")) return null;
					return selector.includes("button") ? element : null;
				},
				hasAttribute(name: string) {
					return name in attributes;
				},
			};
			return element as unknown as Element;
		};
		const keyEvent = (key: string, eventTarget: Element) =>
			({
				key,
				defaultPrevented: false,
				preventDefault: vi.fn(),
				altKey: false,
				ctrlKey: false,
				metaKey: false,
				target: eventTarget,
			}) as unknown as KeyboardEvent;

		interaction.handleKeyDown(keyEvent(" ", target({})));
		expect(togglePlayback).not.toHaveBeenCalled();

		interaction.handleKeyDown(keyEvent(" ", target({ "data-cue-row": "true" })));
		expect(togglePlayback).toHaveBeenCalledTimes(1);
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
