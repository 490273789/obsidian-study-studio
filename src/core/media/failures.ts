import type { TransportErrorCode } from "../net/types";

/** One structural problem in a subtitle draft; copy formats it with a 1-based cue index. */
export type SubtitleProblem =
	| { readonly kind: "no-cues" }
	| { readonly kind: "bad-timing"; readonly cueIndex: number }
	| { readonly kind: "out-of-range"; readonly cueIndex: number }
	| { readonly kind: "needs-review"; readonly cueIndex: number }
	| { readonly kind: "duplicate-id"; readonly cueIndex: number }
	| { readonly kind: "empty-text"; readonly cueIndex: number }
	| { readonly kind: "blank-line"; readonly cueIndex: number };

/** Why a speech-service response could not be used. */
export type ProviderFailureReason =
	| "missing-word-timestamps"
	| "incomplete-stream"
	| "invalid-timing"
	| "invalid-payload";

export type MediaFailure =
	| { readonly kind: "subtitle-parse"; readonly reason: "timing" | "content" | "empty" }
	| { readonly kind: "subtitle-invalid"; readonly problems: readonly SubtitleProblem[] }
	| {
			readonly kind: "config-invalid";
			readonly field: "workspace" | "base-url" | "model" | "secret" | "security";
	  }
	| { readonly kind: "config-drift" }
	| { readonly kind: "cancelled" }
	| {
			readonly kind: "provider-failure";
			readonly code: TransportErrorCode;
			readonly reason?: ProviderFailureReason;
	  }
	| { readonly kind: "unknown" };

/** Shared typed media errors; callers may extend the failure vocabulary. */
export class MediaFailureError<T extends { readonly kind: string } = MediaFailure> extends Error {
	constructor(readonly failure: T) {
		super(failure.kind);
		this.name = "AudioFailureError";
	}
}
export function mediaFailure(failure: MediaFailure): MediaFailureError {
	return new MediaFailureError(failure);
}
export function toMediaFailure(error: unknown): MediaFailure {
	return error instanceof MediaFailureError ? error.failure : { kind: "unknown" };
}
