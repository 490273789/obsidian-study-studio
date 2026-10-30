import { MediaFailureError } from "../failures";
import type { TranscriptionProviderId } from "../transcriptionTypes";
import type { MediaTranscriptionEngine } from "../transcription/mediaTranscriptionEngine";

export interface VideoShadowingCue {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

export interface SubtitleTranslationPort {
	getProfileId(selected: string): string;
	getSignature(profileId: string): string;
	listProfiles(): { id: string; name: string }[];
	translate(
		text: string,
		profileId: string,
		expectedSignature: string,
		signal?: AbortSignal,
	): Promise<string>;
}

export interface SubtitlePipelineSignatureOptions {
	readonly transcriptionProvider: TranscriptionProviderId;
	readonly translationProfileId?: string;
}

export interface MediaSubtitlePipelineDeps {
	readonly transcription: Pick<MediaTranscriptionEngine, "transcribe" | "getSignature">;
	readonly translation: SubtitleTranslationPort;
}

interface SerializedPipelineSignature {
	v: 1;
	p: TranscriptionProviderId;
	ts: string;
	tp: string;
	tls: string;
}

export class MediaSubtitlePipeline {
	constructor(private readonly deps: MediaSubtitlePipelineDeps) {}

	async getSignature(options: SubtitlePipelineSignatureOptions): Promise<string> {
		const provider = options.transcriptionProvider;
		const transcriptionSig = await this.deps.transcription.getSignature(provider);
		const profileId = this.deps.translation.getProfileId(options.translationProfileId ?? "");
		const translationSig = profileId ? this.deps.translation.getSignature(profileId) : "";
		return encodePipelineSignature({
			v: 1,
			p: provider,
			ts: transcriptionSig,
			tp: profileId,
			tls: translationSig,
		});
	}

	async transcribe(
		audio: ArrayBuffer,
		signature: string,
		signal?: AbortSignal,
	): Promise<readonly VideoShadowingCue[]> {
		const parsed = decodePipelineSignature(signature);
		if (!parsed) {
			throw new Error("转写配置已变化，请重新生成字幕。");
		}
		const currentTransSig = await this.deps.transcription.getSignature(parsed.p);
		if (currentTransSig !== parsed.ts) {
			throw new Error("转写配置已变化，请重新生成字幕。");
		}
		try {
			const result = await this.deps.transcription.transcribe({
				audio,
				provider: parsed.p,
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
	}

	async translate(text: string, signature: string, signal?: AbortSignal): Promise<string> {
		const parsed = decodePipelineSignature(signature);
		if (!parsed) {
			throw new Error("翻译配置已变化，请重新生成字幕。");
		}
		if (!parsed.tp) {
			throw new Error("请在影子跟读设置中启用翻译配置。");
		}
		const currentTransSig = this.deps.translation.getSignature(parsed.tp);
		if (currentTransSig !== parsed.tls) {
			throw new Error("翻译配置已变化，请重新生成字幕。");
		}
		try {
			return await this.deps.translation.translate(text, parsed.tp, parsed.tls, signal);
		} catch (error) {
			if (
				(error instanceof Error && error.name === "TranslationConfigurationChangedError") ||
				(error instanceof MediaFailureError && error.failure.kind === "config-drift")
			) {
				throw new Error("翻译配置已变化，请重新生成字幕。");
			}
			throw error;
		}
	}

	listTranslationProfiles(): { id: string; name: string }[] {
		return this.deps.translation.listProfiles();
	}

	getTranslationProfileId(selected: string): string {
		return this.deps.translation.getProfileId(selected);
	}

	getTranscriptionSignature(provider: TranscriptionProviderId): Promise<string> {
		return this.deps.transcription.getSignature(provider);
	}

	getTranslationSignature(profileId: string): string {
		return this.deps.translation.getSignature(profileId);
	}
}

function encodePipelineSignature(sig: SerializedPipelineSignature): string {
	return JSON.stringify(sig);
}

export function decodePipelineSignature(signature: string): SerializedPipelineSignature | null {
	try {
		const parsed = JSON.parse(signature);
		if (parsed && typeof parsed === "object") {
			if (parsed.v === 1 && typeof parsed.p === "string") {
				return parsed as SerializedPipelineSignature;
			}
			// Backward compatibility with legacy format:
			// { provider, transcription, translationProfileId, translation }
			if ("provider" in parsed && typeof parsed.provider === "string") {
				return {
					v: 1,
					p: parsed.provider,
					ts: typeof parsed.transcription === "string" ? parsed.transcription : "",
					tp:
						typeof parsed.translationProfileId === "string"
							? parsed.translationProfileId
							: "",
					tls: typeof parsed.translation === "string" ? parsed.translation : "",
				};
			}
		}
		return null;
	} catch {
		return null;
	}
}
