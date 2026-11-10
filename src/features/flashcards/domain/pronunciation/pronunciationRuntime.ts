import type { PronunciationAccent, PronunciationSettings } from "../../../../core/shared/types";
import { extractSpellingWord } from "../cards/spellingWord";
import { normalizePronunciationSettings } from "./pronunciationSettings";
import type {
	PronunciationConfigureOutcome,
	PronunciationManagementAction,
	PronunciationOutcome,
	PronunciationRuntime,
	PronunciationSnapshot,
} from "./types";

interface ActivePlayback {
	cancel(): void;
}

export interface PronunciationRuntimeDependencies {
	speechSynthesis?: SpeechSynthesis | null;
	createUtterance?: ((text: string) => SpeechSynthesisUtterance) | null;
	voiceLoadTimeoutMs?: number;
	persistSettings?: (settings: PronunciationSettings) => Promise<void>;
}

export function createPronunciationRuntime(
	settings: PronunciationSettings,
	dependencies: PronunciationRuntimeDependencies = {},
): PronunciationRuntime {
	return new BrowserPronunciationRuntime(settings, {
		speechSynthesis:
			dependencies.speechSynthesis ??
			(typeof window === "undefined" ? null : window.speechSynthesis),
		createUtterance:
			dependencies.createUtterance ??
			(typeof SpeechSynthesisUtterance === "undefined"
				? null
				: (text) => new SpeechSynthesisUtterance(text)),
		voiceLoadTimeoutMs: dependencies.voiceLoadTimeoutMs ?? 400,
		persistSettings: dependencies.persistSettings ?? (() => Promise.resolve()),
	});
}

class BrowserPronunciationRuntime implements PronunciationRuntime {
	private settings: PronunciationSettings;
	private readonly listeners = new Set<() => void>();
	private voices: SpeechSynthesisVoice[] = [];
	private voicesLoaded = false;
	private speakingText: string | null = null;
	private management: "idle" | PronunciationManagementAction = "idle";
	private revision = 0;
	private snapshot: PronunciationSnapshot | null = null;
	private activePlayback: ActivePlayback | null = null;
	private operationId = 0;
	private configureQueue: Promise<void> = Promise.resolve();
	private queuedConfigurations = 0;
	private readonly voiceLoadWaiters = new Set<() => void>();
	private readonly voiceChangeListener = () => this.refreshVoices();

	constructor(
		settings: PronunciationSettings,
		private readonly dependencies: Required<PronunciationRuntimeDependencies>,
	) {
		this.settings = normalizePronunciationSettings(settings);
		this.refreshVoices();
		this.dependencies.speechSynthesis?.addEventListener(
			"voiceschanged",
			this.voiceChangeListener,
		);
	}

	getSnapshot(): PronunciationSnapshot {
		if (this.snapshot) return this.snapshot;
		this.snapshot = Object.freeze({
			revision: this.revision,
			settings: Object.freeze({ ...this.settings }),
			management: this.management,
			hasLocalEnglishVoice: this.hasLocalEnglishVoice(),
			voicesLoaded: this.voicesLoaded,
			speakingText: this.speakingText,
		});
		return this.snapshot;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	configure(patch: Partial<PronunciationSettings>): Promise<PronunciationConfigureOutcome> {
		this.stop();
		this.queuedConfigurations++;
		if (this.management !== "configuring") {
			this.management = "configuring";
			this.bump();
		}

		const pending = this.configureQueue.then(
			async (): Promise<PronunciationConfigureOutcome> => {
				const nextSettings = normalizePronunciationSettings({
					...this.settings,
					...patch,
				});
				try {
					await this.dependencies.persistSettings({ ...nextSettings });
				} catch {
					return { status: "failed", reason: "persistence" };
				}

				this.stop();
				this.settings = nextSettings;
				this.bump();
				return {
					status: "applied",
					settings: { ...nextSettings },
				};
			},
		);
		this.configureQueue = pending.then(
			() => undefined,
			() => undefined,
		);
		return pending.finally(() => {
			this.queuedConfigurations--;
			if (this.queuedConfigurations === 0 && this.management === "configuring") {
				this.management = "idle";
				this.bump();
			}
		});
	}

	async canSpeak(text: string): Promise<boolean> {
		const normalizedText = extractSpellingWord(text);
		if (!normalizedText) return false;
		if (!this.voicesLoaded) {
			await this.ensureVoicesLoaded();
		}
		return this.hasLocalEnglishVoice();
	}

	async speak(text: string, _intent: "manual" | "auto"): Promise<PronunciationOutcome> {
		const normalizedText = extractSpellingWord(text);
		this.stop();
		const operationId = ++this.operationId;
		if (!normalizedText) return { status: "unavailable", reason: "unsupported" };

		if (!this.voicesLoaded) {
			await this.ensureVoicesLoaded();
			if (operationId !== this.operationId) return { status: "cancelled" };
		}

		const voice = selectLocalEnglishVoice(this.voices, this.settings.accent);
		if (!voice) {
			return { status: "unavailable", reason: "not-configured" };
		}

		return this.playLocal(normalizedText, voice, operationId);
	}

	stop(): void {
		this.operationId++;
		this.activePlayback?.cancel();
		this.activePlayback = null;
		if (this.speakingText !== null) {
			this.speakingText = null;
			this.bump();
		}
	}

	dispose(): void {
		this.stop();
		this.dependencies.speechSynthesis?.removeEventListener(
			"voiceschanged",
			this.voiceChangeListener,
		);
		for (const finish of this.voiceLoadWaiters) finish();
		this.voiceLoadWaiters.clear();
		this.listeners.clear();
	}

	private refreshVoices(): void {
		const synthesis = this.dependencies.speechSynthesis;
		this.voices = synthesis?.getVoices() ?? [];
		if (this.voices.length > 0 || synthesis === null) {
			this.voicesLoaded = true;
			for (const finish of this.voiceLoadWaiters) finish();
			this.voiceLoadWaiters.clear();
		}
		this.bump();
	}

	private async ensureVoicesLoaded(): Promise<void> {
		if (this.voicesLoaded) return;
		await new Promise<void>((resolve) => {
			let settled = false;
			const timer = globalThis.setTimeout(
				() => finish(),
				this.dependencies.voiceLoadTimeoutMs,
			);
			const finish = () => {
				if (settled) return;
				settled = true;
				globalThis.clearTimeout(timer);
				this.voiceLoadWaiters.delete(finish);
				resolve();
			};
			this.voiceLoadWaiters.add(finish);
		});
		if (this.voicesLoaded) return;
		this.voicesLoaded = true;
		this.bump();
	}

	private hasLocalEnglishVoice(): boolean {
		return selectLocalEnglishVoice(this.voices, this.settings.accent) !== null;
	}

	private async playLocal(
		text: string,
		voice: SpeechSynthesisVoice,
		operationId: number,
	): Promise<PronunciationOutcome> {
		const synthesis = this.dependencies.speechSynthesis;
		const createUtterance = this.dependencies.createUtterance;
		if (!synthesis || !createUtterance) {
			return { status: "unavailable", reason: "unsupported" };
		}
		let utterance: SpeechSynthesisUtterance;
		try {
			utterance = createUtterance(text);
		} catch {
			return { status: "failed", reason: "playback" };
		}
		utterance.voice = voice;
		utterance.lang = this.settings.accent === "system" ? voice.lang : this.settings.accent;
		utterance.rate = this.settings.rate === "slow" ? 0.75 : 1;
		return new Promise((resolve) => {
			let settled = false;
			const finish = (outcome: PronunciationOutcome) => {
				if (settled) return;
				settled = true;
				if (operationId === this.operationId) {
					this.activePlayback = null;
					this.speakingText = null;
					this.bump();
				}
				resolve(outcome);
			};
			this.activePlayback = {
				cancel: () => {
					try {
						synthesis.cancel();
					} catch {
						// Continue settling this plugin's active request.
					} finally {
						finish({ status: "cancelled" });
					}
				},
			};
			this.speakingText = text;
			this.bump();
			utterance.onend = () => finish({ status: "success", source: "local" });
			utterance.onerror = (event) =>
				finish(
					event.error === "canceled" || event.error === "interrupted"
						? { status: "cancelled" }
						: { status: "failed", reason: "playback" },
				);
			try {
				synthesis.speak(utterance);
			} catch {
				finish({ status: "failed", reason: "playback" });
			}
		});
	}

	private bump(): void {
		this.revision++;
		this.snapshot = null;
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				// A presentation listener must not break runtime state transitions.
			}
		}
	}
}

export function selectLocalEnglishVoice(
	voices: readonly SpeechSynthesisVoice[],
	accent: PronunciationAccent,
): SpeechSynthesisVoice | null {
	const localEnglishVoices = voices.filter(
		(voice) => voice.localService && voice.lang.toLowerCase().startsWith("en"),
	);
	if (localEnglishVoices.length === 0) return null;
	if (accent !== "system") {
		const exact = localEnglishVoices.find(
			(voice) => voice.lang.toLowerCase() === accent.toLowerCase(),
		);
		if (exact) return exact;
	}
	return localEnglishVoices.find((voice) => voice.default) ?? localEnglishVoices[0] ?? null;
}
