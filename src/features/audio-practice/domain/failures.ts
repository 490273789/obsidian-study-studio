import type { TransportErrorCode } from "../../../core/net/types";

import { MediaFailureError } from "../../../core/media/failures";
import type { SubtitleProblem, ProviderFailureReason } from "../../../core/media/failures";
export type { SubtitleProblem, ProviderFailureReason } from "../../../core/media/failures";

/**
 * Typed audio-practice failure vocabulary crossing the domain/UI seam.
 *
 * Domain and generation modules never carry localized sentences; `strings/`
 * turns these variants into copy and an optional recovery action.
 */
export type AudioFailure =
	| { readonly kind: "missing-file" }
	| { readonly kind: "unreadable-media" }
	| { readonly kind: "audio-too-large"; readonly maxBytes: number }
	| { readonly kind: "audio-too-long"; readonly maxSeconds: number }
	| { readonly kind: "no-speech" }
	| {
			readonly kind: "subtitle-parse";
			readonly reason: "timing" | "content" | "empty";
	  }
	| { readonly kind: "subtitle-invalid"; readonly problems: readonly SubtitleProblem[] }
	| { readonly kind: "source-changed" }
	| { readonly kind: "stale-material" }
	| { readonly kind: "busy" }
	| {
			readonly kind: "config-invalid";
			readonly field: "workspace" | "base-url" | "model" | "secret" | "security";
	  }
	| {
			readonly kind: "provider-failure";
			readonly code: TransportErrorCode;
			readonly reason?: ProviderFailureReason;
	  }
	| { readonly kind: "draft-save-failed" }
	| { readonly kind: "persist-failed" }
	| { readonly kind: "subtitle-write-failed" }
	| { readonly kind: "config-drift" }
	| { readonly kind: "cancelled" }
	| { readonly kind: "unknown" };

export type AudioPracticeFailure = AudioFailure;

export const AudioFailureError = MediaFailureError<AudioFailure>;
export type AudioFailureError = MediaFailureError<AudioFailure>;

export function audioFailure(failure: AudioFailure): AudioFailureError {
	return new AudioFailureError(failure);
}

/** Converts any thrown value from a domain boundary into the typed vocabulary. */
export function toAudioFailure(error: unknown): AudioFailure {
	if (error instanceof AudioFailureError) return error.failure;
	return { kind: "unknown" };
}
