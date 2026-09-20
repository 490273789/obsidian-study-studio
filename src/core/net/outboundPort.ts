import { requestUrl, type App, type RequestUrlParam } from "obsidian";
import {
	TransportError,
	type HostPinnedRequest,
	type HostPinnedResponse,
	type OutboundPort,
	type OutboundRequest,
	type OutboundResponse,
	type TransportErrorCode,
} from "./types";

/** The deadline every outbound call gets unless it asks for another one. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export interface OutboundPortOptions {
	app: App;
	/** Overrides the default deadline; `0` disables the port-level deadline. */
	defaultTimeoutMs?: number;
}

/**
 * Classifies a completed HTTP response. Returns `null` for a success, so the
 * single status-to-code rule lives here instead of in every feature.
 */
export function transportCodeForStatus(status: number): TransportErrorCode | null {
	if (status >= 200 && status < 400) return null;
	if (status === 401 || status === 403) return "unauthorized";
	if (status === 404) return "not-found";
	if (status === 429) return "rate-limited";
	return "server";
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<ArrayBuffer> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new TransportError("invalid-response", { httpStatus: response.status });
	}
	if (!response.body) {
		const bytes = await response.arrayBuffer();
		if (bytes.byteLength > maxBytes) {
			throw new TransportError("invalid-response", { httpStatus: response.status });
		}
		return bytes;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	let completed = false;
	try {
		while (true) {
			// oxlint-disable-next-line no-await-in-loop -- response chunks must be consumed in order.
			const item = await reader.read();
			if (item.done) {
				completed = true;
				break;
			}
			totalBytes += item.value.byteLength;
			if (totalBytes > maxBytes) {
				throw new TransportError("invalid-response", { httpStatus: response.status });
			}
			chunks.push(item.value);
		}
	} finally {
		if (!completed) await reader.cancel().catch(() => undefined);
		reader.releaseLock();
	}
	const result = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result.buffer;
}

/**
 * Builds the workbench's outbound port over Obsidian's request API.
 *
 * `requestUrl` cannot be cancelled, so cancellation and the deadline are a race:
 * the call settles as soon as either fires and a late response is discarded.
 */
export function createOutboundPort(options: OutboundPortOptions): OutboundPort {
	const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

	const request = (spec: OutboundRequest): Promise<OutboundResponse> => {
		const timeout = spec.timeoutMs ?? defaultTimeoutMs;
		if (spec.signal?.aborted) return Promise.reject(new TransportError("cancelled"));
		return new Promise<OutboundResponse>((resolve, reject) => {
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | null = null;
			const finish = (error?: TransportError, result?: OutboundResponse) => {
				if (settled) return;
				settled = true;
				if (timer !== null) clearTimeout(timer);
				spec.signal?.removeEventListener("abort", cancel);
				if (error) reject(error);
				else resolve(result!);
			};
			const cancel = () => finish(new TransportError("cancelled"));
			if (timeout > 0) {
				timer = setTimeout(() => finish(new TransportError("timeout")), timeout);
			}
			spec.signal?.addEventListener("abort", cancel, { once: true });

			const payload: RequestUrlParam = {
				url: spec.url,
				throw: false,
				...(spec.method ? { method: spec.method } : {}),
				...(spec.headers ? { headers: spec.headers } : {}),
				...(spec.body === undefined ? {} : { body: spec.body }),
			};
			void requestUrl(payload).then(
				(response) => {
					const code = transportCodeForStatus(response.status);
					if (code) {
						finish(
							new TransportError(code, {
								httpStatus: response.status,
								responseText: response.text,
							}),
						);
						return;
					}
					if (
						spec.maxBytes !== undefined &&
						response.arrayBuffer.byteLength > spec.maxBytes
					) {
						finish(
							new TransportError("invalid-response", {
								httpStatus: response.status,
								responseText: response.text,
							}),
						);
						return;
					}
					finish(undefined, {
						status: response.status,
						text: response.text,
						arrayBuffer: response.arrayBuffer,
						headers: response.headers,
					});
				},
				(error: unknown) => finish(new TransportError("network", { cause: error })),
			);
		});
	};

	/**
	 * `requestUrl` follows
	 * redirects and cannot refuse them, so this one path uses `fetch` with
	 * credentials omitted and redirects rejected, plus MIME and size validation.
	 */
	const requestHostPinned = async (spec: HostPinnedRequest): Promise<HostPinnedResponse> => {
		const timeout = spec.timeoutMs ?? defaultTimeoutMs;
		const controller = new AbortController();
		const abort = () => controller.abort();
		spec.signal?.addEventListener("abort", abort, { once: true });
		let timer: ReturnType<typeof setTimeout> | null = null;
		if (timeout > 0) timer = setTimeout(abort, timeout);
		try {
			const response = await fetch(spec.url, {
				credentials: "omit",
				redirect: "error",
				signal: controller.signal,
			});
			const code = transportCodeForStatus(response.status);
			if (code) {
				throw new TransportError(code, { httpStatus: response.status });
			}
			const contentType = response.headers.get("content-type") ?? "";
			if (!contentType.toLowerCase().includes(spec.accept.toLowerCase())) {
				throw new TransportError("invalid-response", { httpStatus: response.status });
			}
			const bytes = await readBoundedBody(response, spec.maxBytes);
			return { status: response.status, bytes };
		} catch (error) {
			if (error instanceof TransportError) throw error;
			if (controller.signal.aborted) {
				throw new TransportError(spec.signal?.aborted ? "cancelled" : "timeout", {
					cause: error,
				});
			}
			throw new TransportError("network", { cause: error });
		} finally {
			if (timer !== null) clearTimeout(timer);
			spec.signal?.removeEventListener("abort", abort);
		}
	};

	return {
		request,
		requestHostPinned,
		readSecret: (id) => options.app.secretStorage.getSecret(id),
	};
}
