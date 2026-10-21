import { AiError, aiFailureCode, type AiService } from "../../../core/ai";
import {
	detectTranslationDirection,
	normalizeTranslationSettings,
	renderTranslationPrompt,
	validateTranslationSettings,
} from "./configuration";
import type {
	TranslationOutput,
	TranslationProfile,
	TranslationResultState,
	TranslationSettings,
	TranslationSnapshot,
} from "./types";

interface TranslationDependencies {
	persist(settings: TranslationSettings): Promise<void>;
	youdao(
		settings: TranslationSettings["youdao"],
		text: string,
		direction: TranslationSettings["direction"],
		signal: AbortSignal,
	): Promise<TranslationOutput>;
}

/** Shared session authority for every translator view; owns no UI or Obsidian I/O. */
export class TranslationRuntime {
	private settings: TranslationSettings;
	private state: Omit<TranslationSnapshot, "settings"> = {
		input: "",
		results: [],
		status: "idle",
		saving: false,
		testing: false,
	};
	private snapshot!: TranslationSnapshot;
	private listeners = new Set<() => void>();
	private cache = new Map<string, TranslationOutput>();
	private generation = 0;
	private controller: AbortController | null = null;
	private testController: AbortController | null = null;
	private views = 0;
	private disposed = false;
	private unsubscribe: () => void;
	private engineSettings: string;

	constructor(
		settings: unknown,
		private ai: AiService,
		private deps: TranslationDependencies,
	) {
		this.settings = normalizeTranslationSettings(settings);
		this.engineSettings = JSON.stringify(ai.getSnapshot().settings);
		this.unsubscribe = ai.subscribe(() => {
			const next = JSON.stringify(ai.getSnapshot().settings);
			if (next === this.engineSettings) return;
			this.engineSettings = next;
			this.invalidate(true);
			this.publish();
		});
		this.replaceResults();
		this.publish();
	}
	getSnapshot = (): TranslationSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	attachView(): () => void {
		this.views++;
		let attached = true;
		return () => {
			if (!attached) return;
			attached = false;
			if (--this.views === 0) this.clear();
		};
	}
	setInput(text: string): void {
		if (this.disposed) return;
		this.invalidate(false);
		this.state.input = text;
		this.publish();
	}
	prefill(text: string): void {
		this.clear();
		this.setInput(text);
	}
	async openPrefilled(text: string): Promise<void> {
		if (this.disposed) return;
		const direction = detectTranslationDirection(text);
		if (this.settings.direction !== direction) {
			try {
				await this.configure({ ...this.settings, direction });
			} catch {
				this.settings = { ...this.settings, direction };
				this.invalidate(true);
				this.publish();
			}
		}
		this.prefill(text);
	}
	clear(): void {
		this.invalidate(true);
		this.state.input = "";
		this.publish();
	}
	async configure(input: TranslationSettings): Promise<void> {
		if (this.disposed) throw new AiError("disposed");
		if (this.state.saving) throw new AiError("busy");
		validateTranslationSettings(input);
		const next = normalizeTranslationSettings(input);
		this.state.saving = true;
		this.publish();
		try {
			try {
				await this.deps.persist(normalizeTranslationSettings(next));
			} catch {
				throw new AiError("save-failed");
			}
			this.settings = next;
			this.invalidate(true);
		} finally {
			this.state.saving = false;
			this.publish();
		}
	}
	async swapDirection(): Promise<void> {
		if (this.state.status === "loading" || this.state.saving) return;
		try {
			await this.configure({
				...this.settings,
				direction: this.settings.direction === "zh-en" ? "en-zh" : "zh-en",
			});
		} catch (error) {
			this.state.error = error instanceof AiError ? error.code : "save-failed";
			this.publish();
		}
	}
	async testYoudao(): Promise<void> {
		if (this.disposed) throw new AiError("disposed");
		if (this.state.testing) throw new AiError("busy");
		this.state.testing = true;
		const controller = new AbortController();
		this.testController = controller;
		this.publish();
		try {
			await this.deps.youdao({ ...this.settings.youdao }, "你好", "zh-en", controller.signal);
		} finally {
			this.state.testing = false;
			this.testController = null;
			this.publish();
		}
	}
	async translate(): Promise<void> {
		if (
			this.disposed ||
			this.state.status === "loading" ||
			this.state.saving ||
			!this.state.input.trim()
		)
			return;
		this.invalidate(false);
		if (!this.settings.enabled || !this.settings.profiles.some((profile) => profile.enabled)) {
			this.state.status = "error";
			this.state.error = "invalid-config";
			this.publish();
			return;
		}
		const settings = normalizeTranslationSettings(this.settings);
		const text = this.state.input;
		const generation = this.generation;
		const controller = new AbortController();
		this.controller = controller;
		this.state.status = "loading";
		this.state.results = this.state.results.map((result) => ({ ...result, status: "loading" }));
		this.publish();
		await Promise.all(
			settings.profiles
				.filter((profile) => profile.enabled)
				.map(async (profile) => {
					const key = JSON.stringify([
						this.engineSettings,
						settings.direction,
						profile,
						settings.youdao,
						settings.thinkingEnabled,
						settings.promptTemplate,
						text.trim(),
					]);
					try {
						let output = this.cache.get(key);
						if (output) {
							this.cache.delete(key);
							this.cache.set(key, output);
						} else {
							output = await this.request(profile, settings, text, controller.signal);
							if (generation !== this.generation || this.disposed) return;
							this.cache.set(key, output);
							if (this.cache.size > 30)
								this.cache.delete(this.cache.keys().next().value!);
						}
						if (generation !== this.generation || this.disposed) return;
						this.updateResult(profile.id, { ...output, status: "success" });
					} catch (error) {
						if (generation !== this.generation || this.disposed) return;
						this.updateResult(profile.id, {
							status: "error",
							error: aiFailureCode(error),
						});
					}
				}),
		);
		if (generation !== this.generation || this.disposed) return;
		this.controller = null;
		this.state.status = this.state.results.some((result) => result.status === "success")
			? "success"
			: "error";
		this.publish();
	}
	dispose(): void {
		this.disposed = true;
		this.unsubscribe();
		this.testController?.abort();
		this.clear();
		this.listeners.clear();
	}
	private request(
		profile: TranslationProfile,
		settings: TranslationSettings,
		text: string,
		signal: AbortSignal,
	): Promise<TranslationOutput> {
		if (profile.kind === "youdao")
			return this.deps.youdao(settings.youdao, text, settings.direction, signal);
		const config = this.ai
			.getSnapshot()
			.settings.configs.find((config) => config.id === profile.configId);
		if (!config) throw new AiError("config-not-found");
		if (config.provider !== "deepseek" && config.provider !== "bailian")
			throw new AiError("invalid-config");
		return this.ai.generate({
			configId: profile.configId,
			thinkingEnabled: settings.thinkingEnabled,
			signal,
			messages: [
				{
					role: "system",
					text: renderTranslationPrompt(settings.promptTemplate, settings.direction),
				},
				{ role: "user", text },
			],
		});
	}
	private invalidate(clearCache: boolean): void {
		this.generation++;
		this.controller?.abort();
		this.controller = null;
		if (clearCache) this.cache.clear();
		this.state.status = "idle";
		this.state.error = undefined;
		this.replaceResults();
	}
	private replaceResults(): void {
		this.state.results = this.settings.profiles
			.filter((profile) => profile.enabled)
			.map((profile) => {
				const config = this.ai
					.getSnapshot()
					.settings.configs.find((config) => config.id === profile.configId);
				return {
					id: profile.id,
					name: profile.name,
					text: "",
					status: "idle",
					model: profile.kind === "youdao" ? "" : (config?.model ?? ""),
					provider: profile.kind === "youdao" ? "youdao" : (config?.provider ?? ""),
				};
			});
	}
	private updateResult(id: string, patch: Partial<TranslationResultState>): void {
		this.state.results = this.state.results.map((result) =>
			result.id === id ? { ...result, ...patch } : result,
		);
		this.publish();
	}
	private publish(): void {
		const settings = normalizeTranslationSettings(this.settings);
		settings.profiles.forEach(Object.freeze);
		Object.freeze(settings.profiles);
		Object.freeze(settings.youdao);
		Object.freeze(settings);
		this.snapshot = Object.freeze({
			...this.state,
			settings,
			results: Object.freeze(
				this.state.results.map((result) =>
					Object.freeze({
						...result,
						usage: result.usage ? Object.freeze({ ...result.usage }) : result.usage,
					}),
				),
			),
		});
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				/* Observers cannot invalidate state. */
			}
		}
	}
}
