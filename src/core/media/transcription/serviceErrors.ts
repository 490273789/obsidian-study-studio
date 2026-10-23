import { TransportError } from "../../net/types";
import type { MediaFailure } from "../failures";

/**
 * Maps a transport failure into the shared media failure vocabulary.
 *
 * Raw provider payloads are never echoed: they may embed credentials or
 * unvalidated fragments.
 */
export function toProviderFailure(error: unknown): MediaFailure {
	if (error instanceof TransportError) return { kind: "provider-failure", code: error.code };
	return { kind: "unknown" };
}
