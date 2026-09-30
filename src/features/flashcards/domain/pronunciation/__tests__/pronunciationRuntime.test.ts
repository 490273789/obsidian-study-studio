import { afterEach, describe, expect, it, vi } from "vitest";
import { TransportError } from "../../../../../core/net/types";
import { type PronunciationSettings } from "../../../../../core/shared/types";
import { DEFAULT_SETTINGS } from "../../../../../core/host/settingsSlices";
import { MemoryPronunciationAudioCache, createPronunciationCacheKey } from "../audioCache";
import { createPronunciationRequestDescriptor, type PronunciationRequester } from "../providers";
import {
	createPronunciationRuntime,
	type PronunciationRuntimeHost,
	selectLocalEnglishVoice,
} from "../pronunciationRuntime";
import { normalizePronunciationSettings } from "../pronunciationSettings";
import type { PronunciationAudioCache } from "../types";

vi.mock("obsidian", () => ({
	requestUrl: vi.fn(),
}));

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
		onlineProvider: "azure",
		azureSecretId: "azure-flashcard",
		...overrides,
	};
}

function makeApp(): PronunciationRuntimeHost {
	return {
		request: async () => ({
			status: 200,
			text: "",
			arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
			headers: { "content-type": "audio/mpeg" },
		}),
		readSecret: (id: string) => (id ? "secret" : null),
	};
}

function makeAudioFactory(options: { reject?: boolean } = {}) {
	return vi.fn((url: string) => {
		const audio = {
			src: url,
			currentTime: 0,
			onended: null as ((event: Event) => void) | null,
			onerror: null as ((event: Event) => void) | null,
			pause: vi.fn(),
			play: vi.fn().mockImplementation(async () => {
				if (options.reject) throw new Error("playback failed");
				queueMicrotask(() => audio.onended?.({} as Event));
			}),
		};
		return audio as unknown as HTMLAudioElement;
	});
}

function makeRequester(status = 200): ReturnType<typeof vi.fn<PronunciationRequester>> {
	return vi.fn<PronunciationRequester>().mockImplementation(async () => {
		if (status >= 400) {
			throw new TransportError(
				status === 401 ? "unauthorized" : status === 429 ? "rate-limited" : "server",
				{ httpStatus: status },
			);
		}
		return {
			status,
			text: "",
			arrayBuffer: new Uint8Array([1, 2, 3]).buffer,
			headers: { "content-type": "audio/mpeg" },
		};
	});
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("local voice selection", () => {
	it("uses exact local accent, then default local English, then any local English", () => {
		const remoteExact = makeVoice("en-GB", { local: false, name: "remote" });
		const localUs = makeVoice("en-US", { name: "us" });
		const localGb = makeVoice("en-GB", { name: "gb" });
		const defaultUs = makeVoice("en-US", { default: true, name: "default" });

		expect(selectLocalEnglishVoice([remoteExact, defaultUs, localGb], "en-GB")?.name).toBe(
			"gb",
		);
		expect(selectLocalEnglishVoice([localUs, defaultUs], "en-GB")?.name).toBe("default");
		expect(selectLocalEnglishVoice([localUs], "system")?.name).toBe("us");
		expect(selectLocalEnglishVoice([remoteExact], "en-GB")).toBeNull();
	});

	it("refreshes asynchronously loaded voices after voiceschanged", () => {
		const synthesis = new FakeSpeechSynthesis();
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
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
});

describe("pronunciation configuration", () => {
	it("keeps snapshots stable and immutable until the runtime changes", async () => {
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
		});
		await vi.waitFor(() => expect(runtime.getSnapshot().cacheUsage.status).toBe("ready"));
		const first = runtime.getSnapshot();

		expect(runtime.getSnapshot()).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.settings)).toBe(true);

		await runtime.configure({ rate: "slow" });
		expect(runtime.getSnapshot()).not.toBe(first);
		runtime.dispose();
	});

	it("normalizes persisted and patched configuration in one module", () => {
		expect(
			normalizePronunciationSettings({
				...makeSettings(),
				accent: "invalid" as PronunciationSettings["accent"],
				azureCloud: "china",
				azureRegion: " EASTUS ",
				azureSecretId: " secret-id ",
			}),
		).toMatchObject({
			accent: "system",
			azureCloud: "china",
			azureRegion: "chinaeast2",
			azureSecretId: " secret-id ",
		});
		expect(
			normalizePronunciationSettings({
				...makeSettings(),
				azureCloud: "global",
				azureRegion: " ChinaNorth2 ",
			}),
		).toMatchObject({
			azureCloud: "global",
			azureRegion: "eastus",
		});
	});

	it("publishes configuration only after persistence succeeds", async () => {
		const gate = deferred<void>();
		const persistSettings = vi.fn(() => gate.promise);
		const runtime = createPronunciationRuntime(makeApp(), makeSettings({ rate: "normal" }), {
			speechSynthesis: null,
			persistSettings,
		});

		const pending = runtime.configure({ rate: "slow" });
		expect(runtime.getSnapshot()).toMatchObject({
			management: "configuring",
			settings: { rate: "normal" },
		});
		await vi.waitFor(() => expect(persistSettings).toHaveBeenCalledTimes(1));
		gate.resolve();

		await expect(pending).resolves.toMatchObject({
			status: "applied",
			settings: { rate: "slow" },
		});
		expect(runtime.getSnapshot()).toMatchObject({
			management: "idle",
			settings: { rate: "slow" },
		});
		runtime.dispose();
	});

	it("keeps the committed configuration when persistence fails", async () => {
		const runtime = createPronunciationRuntime(makeApp(), makeSettings({ rate: "normal" }), {
			speechSynthesis: null,
			persistSettings: () => Promise.reject(new Error("disk unavailable")),
		});

		await expect(runtime.configure({ rate: "slow" })).resolves.toEqual({
			status: "failed",
			reason: "persistence",
		});
		expect(runtime.getSnapshot()).toMatchObject({
			management: "idle",
			settings: { rate: "normal" },
		});
		runtime.dispose();
	});

	it("serializes patches against the last successful configuration", async () => {
		const gates = [deferred<void>(), deferred<void>()];
		const writes: PronunciationSettings[] = [];
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			persistSettings: (settings) => {
				writes.push(settings);
				return gates[writes.length - 1]!.promise;
			},
		});

		const first = runtime.configure({ rate: "slow" });
		const second = runtime.configure({ accent: "en-GB" });
		await vi.waitFor(() => expect(writes).toHaveLength(1));
		expect(writes[0]).toMatchObject({ rate: "slow", accent: "system" });
		gates[0]!.resolve();
		await expect(first).resolves.toMatchObject({ status: "applied" });
		await vi.waitFor(() => expect(writes).toHaveLength(2));
		expect(writes[1]).toMatchObject({ rate: "slow", accent: "en-GB" });
		gates[1]!.resolve();
		await expect(second).resolves.toMatchObject({ status: "applied" });
		runtime.dispose();
	});
});

describe("pronunciation management lifecycle", () => {
	it("shares online tests and lets configuration cancel the active test", async () => {
		const response = deferred<{
			status: number;
			text: string;
			arrayBuffer: ArrayBuffer;
			headers: Record<string, string>;
		}>();
		const requester = vi.fn<PronunciationRequester>(() => response.promise);
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			net: { ...makeApp(), request: requester },
			createAudio: makeAudioFactory(),
			createObjectUrl: () => "blob:test",
			revokeObjectUrl: vi.fn(),
		});

		const firstTest = runtime.testOnlineProvider("hello");
		const secondTest = runtime.testOnlineProvider("hello");
		expect(secondTest).toBe(firstTest);
		const configured = runtime.configure({ rate: "slow" });
		await expect(firstTest).resolves.toEqual({ status: "cancelled" });
		await expect(configured).resolves.toMatchObject({ status: "applied" });
		response.resolve({
			status: 200,
			text: "",
			arrayBuffer: new Uint8Array([1]).buffer,
			headers: { "content-type": "audio/mpeg" },
		});
		runtime.dispose();
	});

	it("returns busy when configuration conflicts with cache clearing", async () => {
		const clearing = deferred<void>();
		const cache: PronunciationAudioCache = {
			get: async () => null,
			put: async () => undefined,
			getUsageBytes: async () => 0,
			clear: () => clearing.promise,
		};
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			cache,
		});

		const firstClear = runtime.clearCache();
		const secondClear = runtime.clearCache();
		expect(secondClear).toBe(firstClear);
		await expect(runtime.configure({ rate: "slow" })).resolves.toEqual({
			status: "busy",
			operation: "clearing-cache",
		});
		clearing.resolve();
		await expect(firstClear).resolves.toEqual({ status: "cleared" });
		runtime.dispose();
	});

	it("models cache failures and ignores stale usage after clearing", async () => {
		const initialUsage = deferred<number>();
		const cache: PronunciationAudioCache = {
			get: async () => null,
			put: async () => undefined,
			getUsageBytes: vi.fn().mockImplementationOnce(() => initialUsage.promise),
			clear: async () => undefined,
		};
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			cache,
		});

		await expect(runtime.clearCache()).resolves.toEqual({ status: "cleared" });
		initialUsage.resolve(999);
		await vi.waitFor(() =>
			expect(runtime.getSnapshot().cacheUsage).toEqual({ status: "ready", bytes: 0 }),
		);
		runtime.dispose();
	});

	it("exposes cache usage failures and retries them explicitly", async () => {
		const cache: PronunciationAudioCache = {
			get: async () => null,
			put: async () => undefined,
			getUsageBytes: vi
				.fn()
				.mockRejectedValueOnce(new Error("IndexedDB unavailable"))
				.mockResolvedValueOnce(42),
			clear: async () => undefined,
		};
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			cache,
		});

		await vi.waitFor(() =>
			expect(runtime.getSnapshot().cacheUsage).toEqual({ status: "failed" }),
		);
		await expect(runtime.refreshCacheUsage()).resolves.toEqual({
			status: "ready",
			bytes: 42,
		});
		expect(runtime.getSnapshot().cacheUsage).toEqual({ status: "ready", bytes: 42 });
		runtime.dispose();
	});
});

describe("pronunciation runtime order and resilience", () => {
	it("uses local speech before cache or network", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("en-US")];
		const requester = makeRequester();
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
			net: { ...makeApp(), request: requester },
		});

		await expect(runtime.speak("hello", "manual")).resolves.toEqual({
			status: "success",
			source: "local",
		});
		expect(requester).not.toHaveBeenCalled();
		expect(synthesis.spoken[0]?.voice?.lang).toBe("en-US");
		runtime.dispose();
	});

	it("waits for Chromium's asynchronous voice list before using cloud fallback", async () => {
		const synthesis = new FakeSpeechSynthesis();
		const requester = makeRequester();
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
			net: { ...makeApp(), request: requester },
			voiceLoadTimeoutMs: 1000,
		});
		const pending = runtime.speak("hello", "manual");
		expect(requester).not.toHaveBeenCalled();

		synthesis.voices = [makeVoice("en-US")];
		synthesis.emitVoicesChanged();

		await expect(pending).resolves.toEqual({
			status: "success",
			source: "local",
		});
		expect(requester).not.toHaveBeenCalled();
		runtime.dispose();
	});

	it("uses cached cloud audio while offline and without a configured secret", async () => {
		const settings = makeSettings({ azureSecretId: "" });
		const descriptor = createPronunciationRequestDescriptor("hello", settings);
		const cache = new MemoryPronunciationAudioCache();
		if (!descriptor) throw new Error("Expected descriptor");
		await cache.put(await createPronunciationCacheKey(descriptor), {
			data: new Uint8Array([1, 2, 3]).buffer,
			mimeType: "audio/mpeg",
		});
		const runtime = createPronunciationRuntime(makeApp(), settings, {
			speechSynthesis: null,
			cache,
			isOnline: () => false,
			net: { ...makeApp(), readSecret: () => null },
			createAudio: makeAudioFactory(),
			createObjectUrl: () => "blob:test",
			revokeObjectUrl: vi.fn(),
		});

		expect(await runtime.canSpeak("hello")).toBe(true);
		await expect(runtime.speak("hello", "manual")).resolves.toEqual({
			status: "success",
			source: "cache",
		});
		runtime.dispose();
	});

	it("does not call a provider when offline, disabled, or missing its secret", async () => {
		const requester = makeRequester();
		const commonDependencies = {
			speechSynthesis: null,
			net: { ...makeApp(), request: requester },
			createAudio: makeAudioFactory(),
			createObjectUrl: () => "blob:test",
			revokeObjectUrl: vi.fn(),
		};
		const offlineRuntime = createPronunciationRuntime(makeApp(), makeSettings(), {
			...commonDependencies,
			isOnline: () => false,
		});
		await expect(offlineRuntime.speak("hello", "manual")).resolves.toEqual({
			status: "unavailable",
			reason: "offline",
		});
		offlineRuntime.dispose();

		const disabledRuntime = createPronunciationRuntime(
			makeApp(),
			makeSettings({ onlineProvider: "none" }),
			commonDependencies,
		);
		await expect(disabledRuntime.speak("hello", "manual")).resolves.toEqual({
			status: "unavailable",
			reason: "not-configured",
		});
		disabledRuntime.dispose();

		const missingSecretRuntime = createPronunciationRuntime(
			makeApp(),
			makeSettings({ azureSecretId: "" }),
			{
				...commonDependencies,
				net: { ...makeApp(), readSecret: () => null, request: requester },
			},
		);
		await expect(missingSecretRuntime.speak("hello", "manual")).resolves.toEqual({
			status: "unavailable",
			reason: "not-configured",
		});
		missingSecretRuntime.dispose();
		expect(requester).not.toHaveBeenCalled();
	});

	it("rejects non-word content before any online request", async () => {
		const requester = makeRequester();
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			net: { ...makeApp(), request: requester },
			createAudio: makeAudioFactory(),
			createObjectUrl: () => "blob:test",
			revokeObjectUrl: vi.fn(),
		});

		await expect(runtime.speak("hello: a private explanation", "manual")).resolves.toEqual({
			status: "unavailable",
			reason: "unsupported",
		});
		expect(requester).not.toHaveBeenCalled();
		runtime.dispose();
	});

	it("uses the selected online provider after local and cache miss, then caches audio", async () => {
		const cache = new MemoryPronunciationAudioCache();
		const requester = makeRequester();
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			cache,
			net: { ...makeApp(), request: requester },
			createAudio: makeAudioFactory(),
			createObjectUrl: () => "blob:test",
			revokeObjectUrl: vi.fn(),
		});

		await expect(runtime.speak("hello", "manual")).resolves.toEqual({
			status: "success",
			source: "azure",
		});
		expect(requester).toHaveBeenCalledTimes(1);
		expect(await cache.getUsageBytes()).toBe(3);
		runtime.dispose();
	});

	it("blocks unauthorized providers until settings change", async () => {
		const settings = makeSettings();
		const runtime = createPronunciationRuntime(makeApp(), settings, {
			speechSynthesis: null,
			net: { ...makeApp(), request: makeRequester(401) },
			createAudio: makeAudioFactory(),
			createObjectUrl: () => "blob:test",
			revokeObjectUrl: vi.fn(),
			now: () => 100,
		});

		await expect(runtime.speak("hello", "manual")).resolves.toMatchObject({
			status: "failed",
			reason: "unauthorized",
		});
		expect(await runtime.canSpeak("hello")).toBe(false);
		await runtime.configure({ ...settings });
		expect(await runtime.canSpeak("hello")).toBe(true);
		runtime.dispose();
	});

	it("applies the 60-second 429 cooldown", async () => {
		let now = 100;
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			net: { ...makeApp(), request: makeRequester(429) },
			createAudio: makeAudioFactory(),
			createObjectUrl: () => "blob:test",
			revokeObjectUrl: vi.fn(),
			now: () => now,
		});

		await expect(runtime.speak("hello", "manual")).resolves.toMatchObject({
			status: "failed",
			reason: "quota",
		});
		expect(await runtime.canSpeak("hello")).toBe(false);
		now += 60_001;
		expect(await runtime.canSpeak("hello")).toBe(true);
		runtime.dispose();
	});

	it("cancels active local playback and reports playback errors", async () => {
		const synthesis = new FakeSpeechSynthesis();
		synthesis.voices = [makeVoice("en-US")];
		synthesis.autoEnd = false;
		const localRuntime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: synthesis as unknown as SpeechSynthesis,
			createUtterance: makeUtterance,
		});
		const pending = localRuntime.speak("hello", "manual");
		localRuntime.stop();
		await expect(pending).resolves.toEqual({ status: "cancelled" });
		localRuntime.dispose();

		const cloudRuntime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			net: { ...makeApp(), request: makeRequester() },
			createAudio: makeAudioFactory({ reject: true }),
			createObjectUrl: () => "blob:test",
			revokeObjectUrl: vi.fn(),
		});
		await expect(cloudRuntime.speak("hello", "manual")).resolves.toEqual({
			status: "failed",
			reason: "playback",
		});
		cloudRuntime.dispose();
	});

	it("times out cloud requests and applies the network cooldown", async () => {
		let now = 100;
		const requester = vi.fn<PronunciationRequester>(async () => {
			throw new TransportError("timeout");
		});
		const runtime = createPronunciationRuntime(makeApp(), makeSettings(), {
			speechSynthesis: null,
			net: { ...makeApp(), request: requester },
			createAudio: makeAudioFactory(),
			createObjectUrl: () => "blob:test",
			revokeObjectUrl: vi.fn(),
			now: () => now,
			requestTimeoutMs: 5,
		});
		const pending = runtime.speak("hello", "manual");

		await expect(pending).resolves.toMatchObject({
			status: "failed",
			reason: "timeout",
		});
		expect(await runtime.canSpeak("hello")).toBe(false);
		now += 30_001;
		expect(await runtime.canSpeak("hello")).toBe(true);
		runtime.dispose();
	});
});
