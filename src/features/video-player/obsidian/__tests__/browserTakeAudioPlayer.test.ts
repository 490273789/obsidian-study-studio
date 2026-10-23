import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createBrowserTakeAudioPlayer } from "../browserTakeAudioPlayer";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("createBrowserTakeAudioPlayer", () => {
	it("plays audio with created blob url and revokes on stop", async () => {
		let endedHandler!: () => void;
		const playMock = vi.fn(async () => undefined);
		const pauseMock = vi.fn();
		const addEventListenerMock = vi.fn((event: string, handler: () => void) => {
			if (event === "ended") endedHandler = handler;
		});

		class FakeAudio {
			constructor(public src: string) {}
			play = playMock;
			pause = pauseMock;
			addEventListener = addEventListenerMock;
		}

		const revokeObjectURL = vi.fn();
		const createObjectURL = vi.fn(() => "blob:audio-url");

		vi.stubGlobal("Audio", FakeAudio);
		vi.stubGlobal("URL", {
			createObjectURL,
			revokeObjectURL,
		});

		const player = createBrowserTakeAudioPlayer();
		await player.play(new ArrayBuffer(10), "audio/webm");

		expect(createObjectURL).toHaveBeenCalled();
		expect(playMock).toHaveBeenCalled();

		endedHandler();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:audio-url");
		expect(pauseMock).toHaveBeenCalled();

		player.dispose();
	});
});
