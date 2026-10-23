import type { AiService } from "../../core/ai";
import { createTranscriptionProvider } from "../../core/media/transcription/providers";
import type { DraftCue } from "../../core/media/transcriptionTypes";
import type { WorkbenchStore } from "../../core/storage/workbenchStore";
import type { OutboundPort } from "../../core/net";
import type { VideoShadowingCue, VideoShadowingServices } from "../video-player/feature";
import {
	TranscriptionConfiguration,
	TranscriptionConfigurationChangedError,
} from "../audio-practice/domain/transcriptionConfiguration";
import { translateYoudao } from "../translation/domain/youdao";
import {
	TranslationConfigurationChangedError,
	TranslationExecution,
} from "../translation/domain/translationExecution";

export interface VideoShadowingServicesDeps {
	ai: AiService;
	store: WorkbenchStore;
	net: OutboundPort;
}

/**
 * Filters out invalid cues: rejects nulls, non-finite bounds, negative start times,
 * zero/inverted intervals (end <= start), and empty or whitespace-only text.
 */
export function sanitizeTranscriptCues(
	cues: readonly Pick<DraftCue, "start" | "end" | "text">[],
): VideoShadowingCue[] {
	return cues.flatMap((cue) => {
		const trimmed = cue.text.trim();
		if (
			cue.start !== null &&
			cue.end !== null &&
			Number.isFinite(cue.start) &&
			Number.isFinite(cue.end) &&
			cue.start >= 0 &&
			cue.end > cue.start &&
			trimmed.length > 0
		) {
			return [{ start: cue.start, end: cue.end, text: trimmed }];
		}
		return [];
	});
}

/**
 * Creates the video shadowing services adapter, borrowing transcription configuration
 * and translation execution across feature boundaries without leaking their full runtimes.
 */
export function createVideoShadowingServices(
	deps: VideoShadowingServicesDeps,
): VideoShadowingServices {
	const transcribe = createTranscriptionProvider(deps.net);
	const transcription = new TranscriptionConfiguration({
		read: () => deps.store.getSettings().audioPractice,
		readSecret: (id) => deps.net.readSecret(id),
	});
	const translation = new TranslationExecution({
		ai: deps.ai,
		readSettings: () => deps.store.getSettings().translation,
		youdao: (connection, text, direction, signal) =>
			translateYoudao(connection, text, direction, deps.net, signal),
	});

	return {
		async transcribe(audio, provider, signature, signal) {
			let config;
			try {
				config = await transcription.accept(provider, signature, signal);
			} catch (error) {
				if (error instanceof TranscriptionConfigurationChangedError) {
					throw new Error("转写配置已变化，请重新生成字幕。");
				}
				throw error;
			}
			const transcript = await transcribe(
				{ index: 0, start: 0, end: 0, wav: audio },
				config,
				signal,
			);
			return sanitizeTranscriptCues(transcript.cues);
		},
		getTranscriptionSignature(provider) {
			return transcription.signature(provider);
		},
		getTranslationProfileId(selected) {
			return translation.prepare(selected, "en-zh").profileId;
		},
		getTranslationSignature(profileId) {
			return translation.prepare(profileId, "en-zh").signature;
		},
		listTranslationProfiles() {
			return translation.listProfiles();
		},
		async translate(text, profileId, signature, signal) {
			try {
				const output = await translation
					.prepare(profileId, "en-zh")
					.translate(text, signal, signature);
				return output.text;
			} catch (error) {
				if (error instanceof TranslationConfigurationChangedError) {
					throw new Error("翻译配置已变化，请重新生成字幕。");
				}
				throw error;
			}
		},
	};
}
