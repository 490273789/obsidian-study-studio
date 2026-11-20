import { MediaFailureError } from "../../../core/media/failures";
import type { ShadowTranscriptionCue } from "./shadowSubtitles";

export type VideoShadowingCue = Readonly<ShadowTranscriptionCue>;

export interface VideoShadowingSignatureOptions {
	/** Selected ASR engine id; an empty id means the default ASR engine. */
	readonly transcriptionEngineId: string;
	readonly translationProfileId?: string;
}

export interface VideoShadowingServices {
	transcribe(
		audio: ArrayBuffer,
		signature: string,
		signal?: AbortSignal,
	): Promise<readonly VideoShadowingCue[]>;
	translate(text: string, signature: string, signal?: AbortSignal): Promise<string>;
	getSignature(options: VideoShadowingSignatureOptions): Promise<string>;
	listTranslationProfiles(): { id: string; name: string }[];
}

export interface VideoShadowingServiceComponents {
	readonly transcription: {
		getSignature(engineId: string): Promise<string>;
		transcribe(input: {
			audio: ArrayBuffer;
			engineId?: string;
			expectedSignature?: string;
			signal?: AbortSignal;
		}): Promise<{
			readonly cues: readonly {
				readonly start: number | null;
				readonly end: number | null;
				readonly text: string;
			}[];
		}>;
	};
	readonly translation: {
		getProfileId(selected?: string): string;
		getSignature(profileId?: string): string;
		listProfiles(): { id: string; name: string }[];
		translate(
			text: string,
			options?: {
				readonly profileId?: string;
				readonly expectedSignature?: string;
				readonly signal?: AbortSignal;
			},
		): Promise<{ readonly text: string }>;
	};
	readonly isTranslationConfigChanged?: (error: unknown) => boolean;
}

interface SerializedShadowingSignature {
	v: 2;
	e: string;
	ts: string;
	tp: string;
	tls: string;
}

function decodeShadowingSignature(signature: string): SerializedShadowingSignature | null {
	try {
		const parsed = JSON.parse(signature) as Partial<SerializedShadowingSignature> | null;
		if (
			parsed &&
			typeof parsed === "object" &&
			parsed.v === 2 &&
			typeof parsed.e === "string" &&
			typeof parsed.ts === "string"
		) {
			return {
				v: 2,
				e: parsed.e,
				ts: parsed.ts,
				tp: typeof parsed.tp === "string" ? parsed.tp : "",
				tls: typeof parsed.tls === "string" ? parsed.tls : "",
			};
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Composes video shadowing transcription and translation from injected
 * transcription and translation capabilities, relying on downstream drift checks.
 */
export function assembleVideoShadowingServices(
	components: VideoShadowingServiceComponents,
): VideoShadowingServices {
	return {
		async getSignature(options): Promise<string> {
			const engineId = options.transcriptionEngineId;
			const transcriptionSig = await components.transcription.getSignature(engineId);
			const profileId = components.translation.getProfileId(
				options.translationProfileId ?? "",
			);
			const translationSig = profileId ? components.translation.getSignature(profileId) : "";
			const signature: SerializedShadowingSignature = {
				v: 2,
				e: engineId,
				ts: transcriptionSig,
				tp: profileId,
				tls: translationSig,
			};
			return JSON.stringify(signature);
		},

		async transcribe(
			audio: ArrayBuffer,
			signature: string,
			signal?: AbortSignal,
		): Promise<readonly VideoShadowingCue[]> {
			const parsed = decodeShadowingSignature(signature);
			if (!parsed || !parsed.ts) {
				throw new Error("转写配置已变化，请重新生成字幕。");
			}
			try {
				const result = await components.transcription.transcribe({
					audio,
					engineId: parsed.e,
					expectedSignature: parsed.ts,
					signal,
				});
				return result.cues.flatMap((cue) =>
					cue.start !== null && cue.end !== null
						? [{ start: cue.start, end: cue.end, text: cue.text }]
						: [],
				);
			} catch (error) {
				if (error instanceof MediaFailureError && error.failure.kind === "config-drift") {
					throw new Error("转写配置已变化，请重新生成字幕。");
				}
				throw error;
			}
		},

		async translate(text: string, signature: string, signal?: AbortSignal): Promise<string> {
			const parsed = decodeShadowingSignature(signature);
			if (!parsed) {
				throw new Error("翻译配置已变化，请重新生成字幕。");
			}
			if (!parsed.tp) {
				throw new Error("请在影子跟读设置中启用翻译配置。");
			}
			try {
				const output = await components.translation.translate(text, {
					profileId: parsed.tp,
					expectedSignature: parsed.tls,
					signal,
				});
				return output.text;
			} catch (error) {
				if (
					components.isTranslationConfigChanged?.(error) ||
					(error instanceof MediaFailureError && error.failure.kind === "config-drift")
				) {
					throw new Error("翻译配置已变化，请重新生成字幕。");
				}
				throw error;
			}
		},

		listTranslationProfiles(): { id: string; name: string }[] {
			return components.translation.listProfiles();
		},
	};
}
