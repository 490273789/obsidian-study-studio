import { cleanEngine, normalizeAiSettings, validateAiConnection } from "./configuration";
import { TransportError } from "../net/types";
import {
	callAiJson,
	encodeMessages,
	fetchAiModels,
	knownImageInput,
	readUsage,
	readTextResponse,
} from "./providers";
import {
	AiError,
	type AiDependencies,
	type AiEngineConfig,
	type AiEngineKind,
	type AiGenerateRequest,
	type AiModel,
	type AiRequestOptions,
	type AiSettings,
	type AiSnapshot,
	type AiTextResult,
	type LlmEngineConfig,
	type TranslationEngineConfig,
} from "./types";

function isLlmEngine(engine: AiEngineConfig): engine is LlmEngineConfig {
	return engine.kind === "llm";
}

/**
 * Authority for the shared AI engine registry and for text-generation requests.
 * Every feature selects engine ids; only this service resolves them and talks to
 * providers. ASR execution belongs to `core/media`, translation execution to the
 * translation feature; both read the same committed registry through this snapshot.
 */
export class AiService {
	private settings: AiSettings;
	private models = new Map<string, AiModel[]>();
	private loadingModels = new Set<string>();
	private testing = new Set<string>();
	private listeners = new Set<() => void>();
	private requestControllers = new Set<AbortController>();
	private writes: Promise<unknown> = Promise.resolve();
	private disposed = false;
	private snapshot!: AiSnapshot;

	constructor(
		settings: unknown,
		private readonly deps: AiDependencies,
	) {
		this.settings = normalizeAiSettings(settings);
		this.publish();
	}

	getSnapshot = (): AiSnapshot => this.snapshot;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	/** Stable id for an unsaved engine form; ids are opaque elsewhere. */
	createEngineId(): string {
		return this.deps.createId();
	}

	/** Upserts one engine for its kind; the first engine of a kind becomes its default. */
	async saveEngine(input: AiEngineConfig): Promise<string> {
		const engine = cleanEngine(input);
		const updating = this.settings.engines.some((item) => item.id === engine.id);
		if (updating && this.engineKind(engine.id) !== engine.kind)
			throw new AiError("config-not-found");
		await this.write((next) => {
			const index = next.engines.findIndex((item) => item.id === engine.id);
			if (index < 0) next.engines.push(engine);
			else next.engines[index] = engine;
			if (engine.kind !== "translation" && !next.defaults[engine.kind])
				next.defaults[engine.kind] = engine.id;
		});
		return engine.id;
	}

	async deleteEngine(id: string): Promise<void> {
		await this.write((next) => {
			if (!next.engines.some((engine) => engine.id === id))
				throw new AiError("config-not-found");
			next.engines = next.engines.filter((engine) => engine.id !== id);
			if (next.defaults.llm === id) next.defaults.llm = null;
			if (next.defaults.asr === id) next.defaults.asr = null;
		});
	}

	async setDefault(kind: Exclude<AiEngineKind, "translation">, id: string | null): Promise<void> {
		await this.write((next) => {
			if (
				id !== null &&
				!next.engines.some((engine) => engine.id === id && engine.kind === kind)
			)
				throw new AiError("config-not-found");
			next.defaults[kind] = id;
		});
	}

	async generate(request: AiGenerateRequest): Promise<AiTextResult> {
		this.assertActive();
		const config = this.resolveLlm(request.configId);
		const messages = encodeMessages(request.messages);
		const imageInput =
			this.models.get(connectionKey(config))?.find((item) => item.id === config.model)
				?.imageInput ?? knownImageInput(config);
		if (
			request.messages.some((message) => message.images?.length) &&
			imageInput === "unsupported"
		)
			throw new AiError("unsupported-image");
		return this.run(request, async (signal, timeoutMs, check) => {
			const body: Record<string, unknown> = {
				model: config.model,
				messages,
				stream: false,
			};
			if (request.thinkingEnabled !== undefined) {
				if (config.provider === "deepseek")
					body.thinking = { type: request.thinkingEnabled ? "enabled" : "disabled" };
				if (config.provider === "bailian") body.enable_thinking = request.thinkingEnabled;
			}
			if (request.jsonMode) body.response_format = { type: "json_object" };
			const data = await callAiJson(
				this.deps,
				config,
				`${config.baseUrl}/chat/completions`,
				body,
				{ signal, timeoutMs },
				check,
			);
			const usage = readUsage(data);
			return {
				text: readTextResponse(data),
				configId: config.id,
				model: config.model,
				...(usage === undefined ? {} : { usage }),
			};
		});
	}

	/** Tests one engine by kind: LLM inline, translation through the injected port. */
	async testEngine(target: AiEngineConfig): Promise<void> {
		this.assertActive();
		if (target.kind === "llm") return this.testConnection(target);
		if (target.kind === "translation") {
			const tester = this.deps.testers?.translation;
			if (!tester) throw new AiError("invalid-input");
			const engine = cleanEngine(target) as TranslationEngineConfig;
			await this.withTesting(engine.id, () => tester(engine));
			return;
		}
		throw new AiError("invalid-input");
	}

	async testConnection(
		target: string | LlmEngineConfig,
		options: AiRequestOptions = {},
	): Promise<void> {
		this.assertActive();
		const config =
			typeof target === "string"
				? this.resolveLlm(target)
				: cleanEngine({ ...target, name: target.name.trim() || "Test" });
		if (!isLlmEngine(config)) throw new AiError("invalid-config");
		const testingKey = typeof target === "string" ? config.id : target.id;
		if (this.testing.has(testingKey)) throw new AiError("busy");
		this.testing.add(testingKey);
		this.publish();
		try {
			await this.run(options, async (signal, timeoutMs, check) => {
				const messages = encodeMessages([{ role: "user", text: "Reply with OK." }]);
				const data = await callAiJson(
					this.deps,
					config,
					`${config.baseUrl}/chat/completions`,
					{ model: config.model, messages, stream: false },
					{ signal, timeoutMs },
					check,
				);
				readTextResponse(data);
			});
		} finally {
			this.testing.delete(testingKey);
			this.publish();
		}
	}

	/** Can query a draft connection before choosing a model or saving it. */
	async listModels(config: LlmEngineConfig, options: AiRequestOptions = {}): Promise<AiModel[]> {
		this.assertActive();
		const captured = { ...config, baseUrl: config.baseUrl.trim().replace(/\/+$/, "") };
		validateAiConnection(captured);
		if (this.loadingModels.has(captured.id)) throw new AiError("busy");
		this.loadingModels.add(captured.id);
		this.publish();
		try {
			const models = await this.run(options, (signal, timeoutMs, check) =>
				fetchAiModels(this.deps, captured, check, { signal, timeoutMs }),
			);
			// Cache by connection so draft discovery survives saving under a new ID.
			// Snapshots only expose catalogues matching currently committed connections.
			this.models.set(
				connectionKey(captured),
				models.map((model) => ({ ...model })),
			);
			return models;
		} finally {
			this.loadingModels.delete(captured.id);
			this.publish();
		}
	}

	dispose(): void {
		this.disposed = true;
		for (const controller of this.requestControllers) controller.abort();
		this.requestControllers.clear();
		this.listeners.clear();
	}

	/** Replace settings after Obsidian Sync updates the shared data.json document. */
	replaceSettings(settings: unknown): void {
		this.assertActive();
		const next = normalizeAiSettings(settings);
		this.dropStaleModelCaches(next);
		this.settings = next;
		this.publish();
	}

	private engineKind(id: string): AiEngineKind | undefined {
		return this.settings.engines.find((engine) => engine.id === id)?.kind;
	}

	private resolveLlm(id: string | undefined): LlmEngineConfig {
		const selected = id === undefined ? this.settings.defaults.llm : id;
		if (selected === null) throw new AiError("no-default");
		const engine = this.settings.engines.find((item) => item.id === selected);
		if (!engine || engine.kind !== "llm") throw new AiError("config-not-found");
		return cleanEngine(engine) as LlmEngineConfig;
	}

	private async withTesting(engineId: string, action: () => Promise<void>): Promise<void> {
		if (this.testing.has(engineId)) throw new AiError("busy");
		this.testing.add(engineId);
		this.publish();
		try {
			await action();
		} finally {
			this.testing.delete(engineId);
			this.publish();
		}
	}

	private async write(change: (settings: AiSettings) => void): Promise<void> {
		const write = this.writes.then(() => this.commit(change));
		this.writes = write.catch(() => {});
		return write;
	}

	private async commit(change: (settings: AiSettings) => void): Promise<void> {
		this.assertActive();
		const next = normalizeAiSettings(this.settings);
		change(next);
		try {
			await this.deps.persist(normalizeAiSettings(next));
		} catch {
			throw new AiError("save-failed");
		}
		this.dropStaleModelCaches(next);
		this.settings = next;
		this.publish();
	}

	private dropStaleModelCaches(next: AiSettings): void {
		for (const previous of this.settings.engines) {
			if (!isLlmEngine(previous)) continue;
			if (
				!next.engines.some(
					(current) =>
						isLlmEngine(current) && connectionKey(current) === connectionKey(previous),
				)
			)
				this.models.delete(connectionKey(previous));
		}
	}

	private async run<T>(
		options: AiRequestOptions,
		work: (signal: AbortSignal, timeoutMs: number, check: () => void) => Promise<T>,
	): Promise<T> {
		this.assertActive();
		const timeout = options.timeoutMs ?? 120_000;
		if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2_147_483_647)
			throw new AiError("invalid-input");
		if (options.signal?.aborted) throw new TransportError("cancelled");
		const controller = new AbortController();
		const cancel = () => controller.abort();
		options.signal?.addEventListener("abort", cancel, { once: true });
		this.requestControllers.add(controller);
		const check = () => {
			if (controller.signal.aborted) throw new TransportError("cancelled");
		};
		try {
			check();
			return await work(controller.signal, timeout, check);
		} finally {
			options.signal?.removeEventListener("abort", cancel);
			this.requestControllers.delete(controller);
		}
	}

	private assertActive(): void {
		if (this.disposed) throw new AiError("disposed");
	}

	private publish(): void {
		const llmEngines = this.settings.engines.filter(isLlmEngine);
		this.snapshot = Object.freeze({
			settings: Object.freeze({
				engines: Object.freeze(
					this.settings.engines.map((engine) => Object.freeze({ ...engine })),
				),
				defaults: Object.freeze({ ...this.settings.defaults }),
			}),
			models: Object.freeze(
				Object.fromEntries(
					llmEngines.flatMap((engine) => {
						const models = this.models.get(connectionKey(engine));
						return models
							? [
									[
										engine.id,
										Object.freeze(
											models.map((model) => Object.freeze({ ...model })),
										),
									],
								]
							: [];
					}),
				),
			),
			loadingModels: Object.freeze([...this.loadingModels]),
			testing: Object.freeze([...this.testing]),
		});
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				/* Subscribers cannot invalidate committed state. */
			}
		}
	}
}

function connectionKey(config: LlmEngineConfig): string {
	return JSON.stringify([config.provider, config.baseUrl, config.secretId]);
}
