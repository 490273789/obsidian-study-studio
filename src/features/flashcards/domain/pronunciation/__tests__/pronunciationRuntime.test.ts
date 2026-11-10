import { describe, expect, it } from "vite-plus/test";
import { type PronunciationSettings } from "../../../../../core/shared/types";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import { createPronunciationRuntime, selectLocalEnglishVoice } from "../pronunciationRuntime";
import { normalizePronunciationSettings } from "../pronunciationSettings";

function makeVoice(
	lang: string,
	options: { local?: boolean; default?: boolean; name?: string } = {},
): SpeechSynthesisVoice {
	return {
		default: options.default ?? false,
		lang,
		localService: options.local ?? true,
		name: options.name ?? lang,
		voiceURI: options.name ?? lang,
	} as SpeechSynthesisVoice;
}

class FakeSpeechSynthesis {
	voices: SpeechSynthesisVoice[] = [];
	autoEnd = true;
	spoken: SpeechSynthesisUtterance[] = [];
	cancelled = 0;
	private listener: (() => void) | null = null;

	getVoices(): SpeechSynthesisVoice[] {
		return this.voices;
	}

	addEventListener(_name: string, listener: () => void): void {
		this.listener = listener;
	}

	removeEventListener(): void {
		this.listener = null;
	}

	speak(utterance: SpeechSynthesisUtterance): void {
		this.spoken.push(utterance);
		if (this.autoEnd) {
			queueMicrotask(() => utterance.onend?.({} as SpeechSynthesisEvent));
		}
	}

	cancel(): void {
		this.cancelled++;
		const utterance = this.spoken[this.spoken.length - 1];
		utterance?.onerror?.({ error: "canceled" } as SpeechSynthesisErrorEvent);
	}

	emitVoicesChanged(): void {
		this.listener?.();
	}
}

function makeUtterance(text: string): SpeechSynthesisUtterance {
	return {
		text,
		lang: "",
		rate: 1,
		voice: null,
		onend: null,
		onerror: null,
	} as unknown as SpeechSynthesisUtterance;
}

function makeSettings(overrides: Partial<PronunciationSettings> = {}): PronunciationSettings {
	return {
		...DEFAULT_SETTINGS.pronunciation,
		...overrides,
	};
}

describe("BrowserPronunciationRuntime (local speech synthesis)", () => {
	it("uses exact local accent, then default local English, then any local English", () => {
		const usVoice = makeVoice("en-US");
		const gbVoice = makeVoice("en-GB", { default: true });
		const genericVoice = makeVoice("en-AU");
		const zhVoice = makeVoice("zh-CN");

		expect(selectLocalEnglishVoice([zhVoice], "en-US")).toBeNull();
		expect(selectLocalEnglishVoice([genericVoice, gbVoice, usVoice], "en-US")?.lang).toBe(
			"en-US",
		);
		expect(selectLocalEnglishVoice([genericVoice, gbVoice, usVoice], "en-GB")?.lang).toBe(
			"en-GB",
		);
		expect(selectLocalEnglishVoice([genericVoice, gbVoice, usVoice], "system")?.lang).toBe(
			"en-GB",
		);
		expect(selectLocalEnglishVoice([genericVoice], "system")?.lang).toBe("en-AU");
	});

	it("refreshes asynchronously loaded voices after voiceschanged", () => {
		const synthesis = new FakeSpeechSynthesis();
		const runtime = createPronunciationRuntime(makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
		});

		expect(runtime.getSnapshot()).toMatchObject({
			voicesLoaded: false,
			hasLocalEnglishVoice: false,
		});

		synthesis.voices = [makeVoice("en-US")];
		synthesis.emitVoicesChanged();

		expect(runtime.getSnapshot()).toMatchObject({
			voicesLoaded: true,
			hasLocalEnglishVoice: true,
		});
		runtime.dispose();
	});

	it("keeps snapshots stable and immutable until the runtime changes", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("en-US")];
		const runtime = createPronunciationRuntime(makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
		});

		const firstSnapshot = runtime.getSnapshot();
		expect(runtime.getSnapshot()).toBe(firstSnapshot);

		await runtime.configure({ rate: "slow" });
		const nextSnapshot = runtime.getSnapshot();
		expect(nextSnapshot).not.toBe(firstSnapshot);
		expect(nextSnapshot.settings.rate).toBe("slow");
		runtime.dispose();
	});

	it("normalizes persisted and patched configuration in one module", () => {
		expect(
			normalizePronunciationSettings({
				rate: "slow",
				accent: "en-GB",
				spellingAutoPlay: true,
				ignoredOnlineKey: "openai",
			}),
		).toEqual({
			spellingAutoPlay: true,
			accent: "en-GB",
			rate: "slow",
		});

		expect(
			normalizePronunciationSettings({
				rate: "invalid",
				accent: "fr-FR",
				spellingAutoPlay: "yes",
			}),
		).toEqual({
			spellingAutoPlay: false,
			accent: "system",
			rate: "normal",
		});
	});

	it("publishes configuration only after persistence succeeds", async () => {
		const synthesis = new FakeSpeechSynthesis();
		let persisted: PronunciationSettings | null = null;
		const runtime = createPronunciationRuntime(makeSettings({ rate: "normal" }), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
			persistSettings: async (settings) => {
				persisted = { ...settings };
			},
		});

		const outcome = await runtime.configure({ rate: "slow" });
		expect(outcome).toEqual({
			status: "applied",
			settings: {
				...DEFAULT_SETTINGS.pronunciation,
				rate: "slow",
			},
		});
		expect(persisted).toEqual(runtime.getSnapshot().settings);
		runtime.dispose();
	});

	it("keeps the committed configuration when persistence fails", async () => {
		const synthesis = new FakeSpeechSynthesis();
		const runtime = createPronunciationRuntime(makeSettings({ rate: "normal" }), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
			persistSettings: () => Promise.reject(new Error("Disk error")),
		});

		const outcome = await runtime.configure({ rate: "slow" });
		expect(outcome).toEqual({ status: "failed", reason: "persistence" });
		expect(runtime.getSnapshot().settings.rate).toBe("normal");
		runtime.dispose();
	});

	it("serializes patches against the last successful configuration", async () => {
		const synthesis = new FakeSpeechSynthesis();
		const calls: string[] = [];
		const runtime = createPronunciationRuntime(makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
			persistSettings: async (settings) => {
				calls.push(settings.rate);
			},
		});

		const first = runtime.configure({ rate: "slow" });
		const second = runtime.configure({ rate: "normal" });
		await Promise.all([first, second]);

		expect(calls).toEqual(["slow", "normal"]);
		expect(runtime.getSnapshot().settings.rate).toBe("normal");
		runtime.dispose();
	});

	it("checks canSpeak based on spelling word and local voice availability", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("en-US")];
		const runtime = createPronunciationRuntime(makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
		});

		expect(await runtime.canSpeak("hello")).toBe(true);
		expect(await runtime.canSpeak("## science")).toBe(true);
		expect(await runtime.canSpeak("12345")).toBe(false);
		expect(await runtime.canSpeak("你好")).toBe(false);

		synthesis.voices = [];
		synthesis.emitVoicesChanged();
		expect(await runtime.canSpeak("hello")).toBe(false);
		runtime.dispose();
	});

	it("speaks locally using configured accent and rate", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("en-US"), makeVoice("en-GB")];
		const runtime = createPronunciationRuntime(
			makeSettings({ accent: "en-GB", rate: "slow" }),
			{
				speechSynthesis: synthesis as unknown as SpeechSynthesis,
				createUtterance: makeUtterance,
			},
		);

		const outcome = await runtime.speak("apple", "manual");
		expect(outcome).toEqual({ status: "success", source: "local" });
		expect(synthesis.spoken).toHaveLength(1);
		expect(synthesis.spoken[0]?.text).toBe("apple");
		expect(synthesis.spoken[0]?.lang).toBe("en-GB");
		expect(synthesis.spoken[0]?.rate).toBe(0.75);
		runtime.dispose();
	});

	it("returns unavailable not-configured when no local voice is available", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("zh-CN")];
		const runtime = createPronunciationRuntime(makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
		});

		const outcome = await runtime.speak("apple", "manual");
		expect(outcome).toEqual({ status: "unavailable", reason: "not-configured" });
		expect(synthesis.spoken).toHaveLength(0);
		runtime.dispose();
	});

	it("rejects non-word content with unsupported reason", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("en-US")];
		const runtime = createPronunciationRuntime(makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
		});

		const outcome = await runtime.speak("你好世界", "manual");
		expect(outcome).toEqual({ status: "unavailable", reason: "unsupported" });
		expect(synthesis.spoken).toHaveLength(0);
		runtime.dispose();
	});

	it("cancels active local playback when stop() is called", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("en-US")];
		synthesis.autoEnd = false;
		const runtime = createPronunciationRuntime(makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
		});

		const speakPromise = runtime.speak("apple", "manual");
		expect(runtime.getSnapshot().speakingText).toBe("apple");

		runtime.stop();
		const outcome = await speakPromise;
		expect(outcome).toEqual({ status: "cancelled" });
		expect(runtime.getSnapshot().speakingText).toBeNull();
		runtime.dispose();
	});

	it("cancels prior speech when speak() is called again", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("en-US")];
		synthesis.autoEnd = false;
		const runtime = createPronunciationRuntime(makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
		});

		const first = runtime.speak("apple", "manual");
		synthesis.autoEnd = true;
		const second = runtime.speak("banana", "manual");

		expect(await first).toEqual({ status: "cancelled" });
		expect(await second).toEqual({ status: "success", source: "local" });
		runtime.dispose();
	});

	it("handles playback error gracefully", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("en-US")];
		synthesis.autoEnd = false;
		const runtime = createPronunciationRuntime(makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
		});

		const speakPromise = runtime.speak("apple", "manual");
		const utterance = synthesis.spoken[0];
		utterance?.onerror?.({ error: "audio-busy" } as SpeechSynthesisErrorEvent);

		const outcome = await speakPromise;
		expect(outcome).toEqual({ status: "failed", reason: "playback" });
		expect(runtime.getSnapshot().speakingText).toBeNull();
		runtime.dispose();
	});
});
