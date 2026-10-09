import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { canPlayDictionaryAudio, playDictionaryAudio, stopDictionaryAudio } from "./audio";

afterEach(() => {
	stopDictionaryAudio();
	vi.unstubAllGlobals();
});

describe("dictionary audio presentation", () => {
	it("accepts only HTTPS pronunciation URLs from supported dictionary hosts", () => {
		expect(canPlayDictionaryAudio("https://dict.youdao.com/dictvoice?audio=word")).toBe(true);
		expect(canPlayDictionaryAudio("https://dictionary.cambridge.org/media/english.mp3")).toBe(
			true,
		);
		expect(canPlayDictionaryAudio("http://dict.youdao.com/dictvoice?audio=word")).toBe(false);
		expect(canPlayDictionaryAudio("https://example.com/audio.mp3")).toBe(false);
		expect(canPlayDictionaryAudio("not a url")).toBe(false);
	});

	it("stops the previous pronunciation before starting another", async () => {
		const instances: FakeAudio[] = [];
		class FakeAudio {
			currentTime = 4;
			pause = vi.fn();
			play = vi.fn().mockResolvedValue(undefined);
			addEventListener = vi.fn();

			constructor(readonly url: string) {
				instances.push(this);
			}
		}
		vi.stubGlobal("Audio", FakeAudio);

		await expect(
			playDictionaryAudio("https://dict.youdao.com/dictvoice?audio=first"),
		).resolves.toBe(true);
		await expect(
			playDictionaryAudio("https://dict.youdao.com/dictvoice?audio=second"),
		).resolves.toBe(true);

		expect(instances[0]?.pause).toHaveBeenCalledOnce();
		expect(instances[0]?.currentTime).toBe(0);
		expect(instances[1]?.play).toHaveBeenCalledOnce();
	});

	it("reports a browser playback construction failure", async () => {
		vi.stubGlobal(
			"Audio",
			class {
				constructor() {
					throw new Error("audio unavailable");
				}
			},
		);

		await expect(
			playDictionaryAudio("https://dict.youdao.com/dictvoice?audio=word"),
		).resolves.toBe(false);
	});
});
