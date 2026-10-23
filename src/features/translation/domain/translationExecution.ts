import { AiError, type AiService } from "../../../core/ai";
import { TransportError } from "../../../core/net/types";
import { normalizeTranslationSettings, renderTranslationPrompt } from "./configuration";
import type { TranslationOutput, TranslationSettings } from "./types";

export type YoudaoTranslation = (
	connection: TranslationSettings["youdao"],
	text: string,
	direction: TranslationSettings["direction"],
	signal: AbortSignal,
) => Promise<TranslationOutput>;

interface TranslationExecutionDependencies {
	ai: Pick<AiService, "getSnapshot" | "generate">;
	readSettings(): TranslationSettings;
	youdao: YoudaoTranslation;
}

interface PreparedTranslation {
	readonly profileId: string;
	readonly signature: string;
	translate(
		text: string,
		signal: AbortSignal,
		expectedSignature?: string,
	): Promise<TranslationOutput>;
}

export class TranslationConfigurationChangedError extends Error {
	constructor() {
		super("Translation configuration changed");
		this.name = "TranslationConfigurationChangedError";
	}
}

/** Owns profile selection, execution identity, and requests without sharing view/session state. */
export class TranslationExecution {
	constructor(private readonly deps: TranslationExecutionDependencies) {}

	listProfiles(): { id: string; name: string }[] {
		return this.deps
			.readSettings()
			.profiles.filter((profile) => profile.enabled)
			.map(({ id, name }) => ({ id, name }));
	}

	/** Capturing is request-free; a missing configuration can still accompany original subtitles. */
	prepare(profileId: string, direction?: TranslationSettings["direction"]): PreparedTranslation {
		const prepared = this.capture(profileId, direction);
		return Object.freeze<PreparedTranslation>({
			profileId: prepared.profileId,
			signature: prepared.signature,
			translate: async (text, signal, expectedSignature = prepared.signature) => {
				if (signal.aborted) throw new TransportError("cancelled");
				const current = this.capture(profileId, direction);
				if (current.signature !== expectedSignature)
					throw new TranslationConfigurationChangedError();
				if (!current.profile?.enabled) throw new AiError("config-not-found");
				if (!text.trim()) throw new AiError("invalid-input");
				if (current.profile.kind === "youdao")
					return this.deps.youdao(current.youdao, text, current.direction, signal);
				if (!current.engine) throw new AiError("config-not-found");
				// No await separates capture/check from generate(), which captures the engine synchronously.
				return this.deps.ai.generate({
					configId: current.engine.id,
					thinkingEnabled: current.thinkingEnabled,
					signal,
					messages: [
						{ role: "system", text: current.prompt },
						{ role: "user", text },
					],
				});
			},
		});
	}

	private capture(selected: string, direction?: TranslationSettings["direction"]) {
		const settings = normalizeTranslationSettings(this.deps.readSettings());
		const profileId =
			selected.trim() || settings.profiles.find((profile) => profile.enabled)?.id || "";
		const profile = settings.profiles.find((profile) => profile.id === profileId);
		const resolvedDirection = direction ?? settings.direction;
		const engine =
			profile?.kind === "engine"
				? this.deps.ai
						.getSnapshot()
						.settings.configs.find((config) => config.id === profile.configId)
				: undefined;
		const prompt = renderTranslationPrompt(settings.promptTemplate, resolvedDirection);
		const signature = profileId
			? fingerprint({
					profileId,
					enabled: profile?.enabled,
					kind: profile?.kind,
					direction: resolvedDirection,
					...(profile?.kind === "youdao"
						? { youdao: settings.youdao }
						: {
								configId: profile?.configId,
								engine: engine
									? {
											provider: engine.provider,
											baseUrl: engine.baseUrl,
											model: engine.model,
											secretId: engine.secretId,
										}
									: null,
								prompt,
								thinkingEnabled: settings.thinkingEnabled,
							}),
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
			youdao: settings.youdao,
		};
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
