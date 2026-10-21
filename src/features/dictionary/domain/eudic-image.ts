import { base64FromBytes } from "./resource-url";
import { TransportError, type OutboundPort } from "../../../core/net/types";
import { dictionaryText } from "./messages";
import { DictionaryError } from "./types";

export const EUDIC_IMAGE_RESOURCE_KIND = "eudic-word-card-en-v2" as const;
export const MAX_EUDIC_DICTIONARY_BYTES = 512 * 1_048_576;

const EUDIC_RESOURCE_PREFIX = `${EUDIC_IMAGE_RESOURCE_KIND}/`;
const EUDIC_REMOTE_ORIGIN = "https://fs-gateway.frdic.com";
const EUDIC_REMOTE_PATH = "/buckets/main/store_main/word_card/v2/en/";
const MAX_REMOTE_IMAGE_BYTES = 4_194_304;
const REMOTE_TIMEOUT_MS = 12_000;

type EudicOutboundPort = Pick<OutboundPort, "requestHostPinned">;

function eudicResourceUrl(path: string): string | null {
	if (!path.startsWith(EUDIC_RESOURCE_PREFIX)) return null;
	const fileName = path.slice(EUDIC_RESOURCE_PREFIX.length);
	if (!/^[a-z\d][a-z\d._'-]{0,240}\.jpg$/i.test(fileName)) return null;
	const url = new URL(`${EUDIC_REMOTE_PATH}${fileName}`, EUDIC_REMOTE_ORIGIN);
	return url.origin === EUDIC_REMOTE_ORIGIN && url.pathname.startsWith(EUDIC_REMOTE_PATH)
		? url.href
		: null;
}

export class EudicImageResourceLoader {
	private readonly controllers = new Set<AbortController>();

	constructor(private readonly net: EudicOutboundPort) {}

	close(): void {
		for (const controller of this.controllers) controller.abort();
		this.controllers.clear();
	}

	async resolve(path: string): Promise<string | null> {
		const url = eudicResourceUrl(path);
		if (!url) return null;
		const controller = new AbortController();
		this.controllers.add(controller);
		try {
			const response = await this.net.requestHostPinned({
				accept: "image/jpeg",
				label: "eudic-dictionary-image",
				maxBytes: MAX_REMOTE_IMAGE_BYTES,
				signal: controller.signal,
				timeoutMs: REMOTE_TIMEOUT_MS,
				url,
			});
			const data = new Uint8Array(response.bytes);
			if (data.byteLength === 0) {
				throw new DictionaryError("empty-response", dictionaryText().errors.emptyResponse);
			}
			return `data:image/jpeg;base64,${base64FromBytes(data)}`;
		} catch (error) {
			if (error instanceof DictionaryError) throw error;
			if (error instanceof TransportError) {
				const code =
					error.code === "rate-limited"
						? "rate-limit"
						: error.code === "invalid-response"
							? "invalid-response"
							: error.code === "network" ||
								  error.code === "timeout" ||
								  error.code === "cancelled"
								? "network"
								: "server";
				throw new DictionaryError(
					code,
					error.code === "timeout"
						? dictionaryText().errors.timeout
						: dictionaryText().eudicImageUnavailable,
					error.httpStatus,
				);
			}
			throw new DictionaryError("network", dictionaryText().eudicImageUnavailable);
		} finally {
			this.controllers.delete(controller);
		}
	}
}
