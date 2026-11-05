import { AiError, aiFailureCode, type AiService } from "../../../core/ai";
import { cleanAiConfig } from "../../../core/ai/configuration";
import { validateHttpEndpoint } from "../../../core/net/endpoint";
import {
	detectTranslationDirection,
	normalizeTranslationSettings,
	validateTranslationSettings,
} from "./configuration";
import { TranslationExecution, type YoudaoTranslation } from "./translationExecution";
import type {
	TranslationOutput,
	TranslationResultState,
	TranslationSettings,
	TranslationSnapshot,
} from "./types";

interface TranslationDependencies {
	persist(settings: TranslationSettings): Promise<void>;
	youdao: YoudaoTranslation;
}

/** Shared session authority for every translator view; owns no UI or Obsidian I/O. */
export class TranslationRuntime {
	private settings: TranslationSettings;
	private state: Omit<TranslationSnapshot, "settings" | "clearUndoId" | "stale"> = {
		input: "",
		translatedInput: "",
		translatedDirection: "zh-en",
		results: [],
		status: "idle",
		saving: false,
		testing: false,
	};
	private snapshot!: TranslationSnapshot;
	private listeners = new Set<() => void>();
	private cache = new Map<string, TranslationOutput>();
	private generation = 0;
	private cleared: Pick<
		TranslationSnapshot,
		"input" | "results" | "translatedInput" | "translatedDirection"
	> | null = null;
	private controller: AbortController | null = null;
	private testController: AbortController | null = null;
	private views = 0;
	private disposed = false;
	private unsubscribe: () => void;
	private engineSettings: string;
	private readonly execution: TranslationExecution;

	constructor(
		settings: unknown,
		private ai: AiService,
		private deps: TranslationDependencies,
	) {
		this.settings = normalizeTranslationSettings(settings);
		this.state.translatedDirection = this.settings.direction;
		this.execution = new TranslationExecution({
			ai,
			readSettings: () => this.settings,
			youdao: deps.youdao,
		});
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
		// Keep the previous results visible; they become stale instead of disappearing.
		// Any explicit clear undo no longer applies once the user starts a new draft.
		this.cleared = null;
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
	clear({ undoable = false } = {}): boolean {
		if (undoable && !this.state.input && !this.state.results.some((r) => r.text || r.error))
			return false;
		const cleared = undoable ? this.snapshot : null;
		this.invalidate(true);
		this.state.input = "";
		if (cleared)
			this.cleared = {
				input: cleared.input,
				results: cleared.results,
				translatedInput: cleared.translatedInput,
				translatedDirection: cleared.translatedDirection,
			};
		this.publish();
		return true;
	}
	undoClear(id: number): boolean {
		const cleared = this.cleared;
		if (this.disposed || this.state.saving || !cleared || id !== this.generation) return false;
		this.invalidate(false);
		this.state.input = cleared.input;
		this.state.translatedInput = cleared.translatedInput;
		this.state.translatedDirection = cleared.translatedDirection;
		this.state.results = this.state.results.map((current) => {
			const previous = cleared.results.find((result) => result.id === current.id);
			return previous?.status === "success" || previous?.status === "error"
				? previous
				: current;
		});
		this.state.status = this.state.results.some((r) => r.status === "success")
			? "success"
			: this.state.results.some((r) => r.status === "error")
				? "error"
				: "idle";
		this.publish();
		return true;
	}
	async configure(
		input: TranslationSettings,
		{ preserveResults = false }: { preserveResults?: boolean } = {},
	): Promise<void> {
		if (this.disposed) throw new AiError("disposed");
		if (this.state.saving) throw new AiError("busy");
		validateTranslationSettings(input);
		const next = normalizeTranslationSettings(input);
		this.cleared = null;
		this.state.saving = true;
		this.publish();
		try {
			try {
				await this.deps.persist(normalizeTranslationSettings(next));
			} catch {
				throw new AiError("save-failed");
			}
			this.settings = next;
			if (preserveResults) {
				this.state.error = undefined;
			} else {
				this.invalidate(true);
			}
		} finally {
			this.state.saving = false;
			this.publish();
		}
	}
	async swapDirection(): Promise<void> {
		if (this.state.status === "loading" || this.state.saving) return;
		try {
			await this.configure(
				{
					...this.settings,
					direction: this.settings.direction === "zh-en" ? "en-zh" : "zh-en",
				},
				{ preserveResults: true },
			);
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
		const readyIds = new Set(this.state.results.filter((r) => !r.setupIssue).map((r) => r.id));
		if (!this.settings.enabled || readyIds.size === 0) {
			this.state.status = "error";
			this.state.error = "invalid-config";
			this.publish();
			return;
		}
		const settings = normalizeTranslationSettings(this.settings);
		const text = this.state.input;
		this.state.translatedInput = text;
		this.state.translatedDirection = settings.direction;
		const generation = this.generation;
		const controller = new AbortController();
		this.controller = controller;
		const translations = settings.profiles
			.filter((profile) => profile.enabled && readyIds.has(profile.id))
			.map((profile) => ({
				profile,
				request: this.execution.prepare(profile.id, settings.direction),
			}));
		this.state.status = "loading";
		this.state.results = this.state.results.map((result) =>
			readyIds.has(result.id) ? { ...result, status: "loading" } : result,
		);
		this.publish();
		await Promise.all(
			translations.map(async ({ profile, request }) => {
				const key = JSON.stringify([request.signature, text.trim()]);
				try {
					let output = this.cache.get(key);
					if (output) {
						this.cache.delete(key);
						this.cache.set(key, output);
					} else {
						output = await request.translate(text, controller.signal);
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
		this.state.status = this.deriveStatus();
		this.publish();
	}
	async retryResult(id: string): Promise<void> {
		if (this.disposed || this.state.saving || this.state.status === "loading") return;
		const result = this.state.results.find((candidate) => candidate.id === id);
		const profile = this.settings.profiles.find(
			(candidate) => candidate.id === id && candidate.enabled,
		);
		if (!result || result.status !== "error" || result.setupIssue || !profile) return;
		const text = this.state.translatedInput || this.state.input;
		if (!text.trim()) return;
		const direction = this.state.translatedDirection;
		const generation = this.generation;
		const controller = new AbortController();
		this.controller = controller;
		this.state.error = undefined;
		this.state.status = "loading";
		this.state.results = this.state.results.map((current) =>
			current.id === id ? { ...current, status: "loading", error: undefined } : current,
		);
		this.publish();
		try {
			const request = this.execution.prepare(profile.id, direction);
			const key = JSON.stringify([request.signature, text.trim()]);
			let output = this.cache.get(key);
			if (output) {
				this.cache.delete(key);
				this.cache.set(key, output);
			} else {
				output = await request.translate(text, controller.signal);
				if (generation !== this.generation || this.disposed) return;
				this.cache.set(key, output);
				if (this.cache.size > 30) this.cache.delete(this.cache.keys().next().value!);
			}
			if (generation !== this.generation || this.disposed) return;
			this.updateResult(id, { ...output, status: "success", error: undefined });
		} catch (error) {
			if (generation !== this.generation || this.disposed) return;
			this.updateResult(id, { status: "error", error: aiFailureCode(error) });
		} finally {
			if (generation === this.generation && !this.disposed) {
				this.controller = null;
				this.state.status = this.deriveStatus();
				this.publish();
			}
		}
	}
	dispose(): void {
		this.disposed = true;
		this.unsubscribe();
		this.testController?.abort();
		this.clear();
		this.listeners.clear();
	}
	private invalidate(clearCache: boolean): void {
		this.generation++;
		this.cleared = null;
		this.controller?.abort();
		this.controller = null;
		if (clearCache) this.cache.clear();
		this.state.status = "idle";
		this.state.error = undefined;
		this.state.translatedInput = "";
		this.state.translatedDirection = this.settings.direction;
		this.replaceResults();
	}
	private deriveStatus(): TranslationSnapshot["status"] {
		if (this.state.results.some((result) => result.status === "success")) return "success";
		if (this.state.results.some((result) => result.status === "error")) return "error";
		return "idle";
	}
	private replaceResults(): void {
		const configs = this.ai.getSnapshot().settings.configs;
		const youdao = this.settings.youdao;
		this.state.results = this.settings.profiles
			.filter((profile) => profile.enabled)
			.map((profile) => {
				const config = configs.find((config) => config.id === profile.configId);
				let setupIssue: TranslationResultState["setupIssue"];
				if (profile.kind === "youdao") {
					try {
						validateHttpEndpoint(youdao.baseUrl);
						if (!youdao.appKeySecretId || !youdao.appSecretSecretId)
							setupIssue = "youdaoSetup";
					} catch {
						setupIssue = "youdaoSetup";
					}
				} else if (config) {
					try {
						cleanAiConfig(config);
					} catch {
						setupIssue = "engineSetup";
					}
				} else {
					setupIssue = "engineSetup";
				}
				return {
					id: profile.id,
					name: profile.name,
					text: "",
					status: "idle",
					model: profile.kind === "youdao" ? "" : (config?.model ?? ""),
					provider: profile.kind === "youdao" ? "youdao" : (config?.provider ?? ""),
					...(setupIssue ? { setupIssue } : {}),
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
		const hasResults = this.state.results.some(
			(result) => result.status === "success" || result.status === "error",
		);
		const stale =
			hasResults &&
			(this.state.input !== this.state.translatedInput ||
				settings.direction !== this.state.translatedDirection);
		this.snapshot = Object.freeze({
			...this.state,
			stale,
			settings,
			clearUndoId: this.cleared && !this.state.saving ? this.generation : null,
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
