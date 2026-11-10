import {
	AiError,
	findEngine,
	type AiEngineConfig,
	type AiService,
	type AiSettings,
	type TranslationEngineConfig,
} from "../../../core/ai";
import { TransportError } from "../../../core/net/types";
import { normalizeTranslationSettings, renderTranslationPrompt } from "./configuration";
import type { TranslationOutput, TranslationSettings } from "./types";

export type YoudaoTranslation = (
	engine: TranslationEngineConfig,
	text: string,
	direction: TranslationSettings["direction"],
	signal: AbortSignal,
) => Promise<TranslationOutput>;

export interface TranslationExecutionDependencies {
	readonly ai: Pick<AiService, "getSnapshot" | "generate">;
	readSettings(): TranslationSettings;
	readonly youdao: YoudaoTranslation;
	readonly defaultDirection?: TranslationSettings["direction"];
}

export interface TranslationExecutionOptions {
	readonly profileId?: string;
	readonly direction?: TranslationSettings["direction"];
	readonly expectedSignature?: string;
	readonly signal?: AbortSignal;
}

export class TranslationConfigurationChangedError extends Error {
	constructor() {
		super("Translation configuration changed");
		this.name = "TranslationConfigurationChangedError";
	}
}

/**
 * Deep domain authority for translation execution.
 * Owns profile resolution, signature fingerprinting, configuration drift detection,
 * and dispatching to LLM or translation engines behind an atomic interface.
 */
export class TranslationExecution {
	constructor(private readonly deps: TranslationExecutionDependencies) {}

	listProfiles(): { id: string; name: string }[] {
		return this.deps
			.readSettings()
			.profiles.filter((profile) => profile.enabled)
			.map(({ id, name }) => ({ id, name }));
	}

	getProfileId(selected?: string): string {
		return this.capture(selected ?? "").profileId;
	}

	getSignature(profileId?: string, direction?: TranslationSettings["direction"]): string {
		return this.capture(profileId ?? "", direction).signature;
	}

	async translate(
		text: string,
		options?: TranslationExecutionOptions,
	): Promise<TranslationOutput> {
		const signal = options?.signal ?? new AbortController().signal;
		if (signal.aborted) throw new TransportError("cancelled");

		const current = this.capture(options?.profileId ?? "", options?.direction);
		if (
			options?.expectedSignature !== undefined &&
			current.signature !== options.expectedSignature
		) {
			throw new TranslationConfigurationChangedError();
		}
		if (!current.profile?.enabled) throw new AiError("config-not-found");
		if (!text.trim()) throw new AiError("invalid-input");

		const engine = current.engine;
		// An ASR engine is never a translation target, even when selected by a
		// stale profile; there is no fallback to another engine.
		if (!engine || engine.kind === "asr") throw new AiError("config-not-found");
		if (engine.kind === "translation") {
			return this.deps.youdao(engine, text, current.direction, signal);
		}

		// No await separates capture/check from generate(), which captures the engine synchronously.
		return this.deps.ai.generate({
			configId: engine.id,
			thinkingEnabled: current.thinkingEnabled,
			signal,
			messages: [
				{ role: "system", text: current.prompt },
				{ role: "user", text },
			],
		});
	}

	private capture(selected: string, direction?: TranslationSettings["direction"]) {
		const settings = normalizeTranslationSettings(this.deps.readSettings());
		const profileId =
			selected.trim() || settings.profiles.find((profile) => profile.enabled)?.id || "";
		const profile = settings.profiles.find((profile) => profile.id === profileId);
		const resolvedDirection = direction ?? this.deps.defaultDirection ?? settings.direction;
		const engine = profile ? findEngine(this.registry(), profile.engineId) : undefined;
		const prompt = renderTranslationPrompt(settings.promptTemplate, resolvedDirection);
		const signature = profileId
			? fingerprint({
					profileId,
					enabled: profile?.enabled,
					direction: resolvedDirection,
					engineId: profile?.engineId,
					engine: engineIdentity(engine),
					// Prompt and thinking only shape LLM requests; a translation API
					// engine's identity is its endpoint and credential references.
					...(engine?.kind === "translation"
						? {}
						: { prompt, thinkingEnabled: settings.thinkingEnabled }),
				})
			: "none";
		return {
			profileId,
			profile,
			engine,
			signature,
			direction: resolvedDirection,
			prompt,
			thinkingEnabled: settings.thinkingEnabled,
		};
	}

	/** The shared AI registry snapshot, adapted to the settings value core/ai resolves. */
	private registry(): AiSettings {
		const settings = this.deps.ai.getSnapshot().settings;
		return { engines: [...settings.engines], defaults: settings.defaults };
	}
}

/** Opaque per-kind engine identity; secret *references* only, never secret values. */
function engineIdentity(engine: AiEngineConfig | undefined): unknown {
	if (!engine) return null;
	switch (engine.kind) {
		case "llm":
			return {
				provider: engine.provider,
				baseUrl: engine.baseUrl,
				model: engine.model,
				secretId: engine.secretId,
			};
		case "translation":
			return {
				provider: engine.provider,
				baseUrl: engine.baseUrl,
				appKeySecretId: engine.appKeySecretId,
				appSecretSecretId: engine.appSecretSecretId,
			};
		case "asr":
			return { provider: engine.provider, baseUrl: engine.baseUrl };
	}
}

/** Persist an opaque, versioned identity rather than settings or credential references. */
function fingerprint(value: unknown): string {
	const serialized = JSON.stringify(value);
	let hash = 2166136261;
	for (let index = 0; index < serialized.length; index++)
		hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619);
	return `translation-v1:${(hash >>> 0).toString(16)}`;
}
