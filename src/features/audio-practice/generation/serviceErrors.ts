import { TransportError } from "../../../core/net/types";
import type { AudioFailure } from "../domain/failures";

/**
 * Maps a transport failure into the audio-practice failure vocabulary.
 *
 * Raw provider payloads are never echoed: they may embed credentials or
 * unvalidated fragments.
 */
export function toProviderFailure(error: unknown): AudioFailure {
	if (error instanceof TransportError) return { kind: "provider-failure", code: error.code };
	return { kind: "unknown" };
}
