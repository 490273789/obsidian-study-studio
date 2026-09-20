/**
 * Transport vocabulary shared by every outbound request in the workbench.
 *
 * These codes describe how a request failed, not what any one feature means by
 * that failure: each feature keeps its own domain error type and maps from here.
 * Before this module each feature re-derived the same classification from raw
 * HTTP statuses (and one hand-written table bridged two taxonomies).
 */
export type TransportErrorCode =
	| "unauthorized"
	| "not-found"
	| "rate-limited"
	| "server"
	| "network"
	| "timeout"
	| "cancelled"
	| "invalid-response";

export interface TransportErrorOptions {
	/** HTTP status when the failure came from a completed response. */
	httpStatus?: number | null;
	/** Response body, when a caller needs the provider's own error payload. */
	responseText?: string | null;
	cause?: unknown;
}

export class TransportError extends Error {
	readonly code: TransportErrorCode;
	readonly httpStatus: number | null;
	readonly responseText: string | null;
	/** The underlying failure, kept for diagnostics. */
	readonly reason: unknown;

	constructor(code: TransportErrorCode, options: TransportErrorOptions = {}) {
		super(`Transport request failed: ${code}`);
		this.name = "TransportError";
		this.code = code;
		this.httpStatus = options.httpStatus ?? null;
		this.responseText = options.responseText ?? null;
		this.reason = options.cause ?? null;
	}
}

export interface OutboundRequest {
	/** Shown in diagnostics and error messages; must never contain credentials. */
	label: string;
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	/** Maximum accepted response body size in bytes. */
	maxBytes?: number;
	/**
	 * Deadline for this call. Omit to use the port's default; `0` disables the
	 * port-level deadline for callers that enforce their own.
	 */
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface OutboundResponse {
	status: number;
	text: string;
	/** Present for requestUrl-backed calls that need a binary provider response. */
	arrayBuffer?: ArrayBuffer;
	/** Original response headers, normalized only by the host request implementation. */
	headers?: Record<string, string>;
}

export interface HostPinnedRequest {
	/** Shown in diagnostics and error messages; must never contain credentials. */
	label: string;
	url: string;
	/** Accepted response MIME type; anything else is an invalid response. */
	accept: string;
	/** Maximum accepted body size in bytes. */
	maxBytes: number;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface HostPinnedResponse {
	status: number;
	bytes: ArrayBuffer;
}

/**
 * The workbench's outbound seam: one place owns request execution, the deadline,
 * cancellation, status classification, and credential reads.
 *
 * `requestHostPinned` is the single sanctioned exception: a raw fetch
 * to a fixed host with no credentials and redirects refused, used for the Eudic
 * remote image. Its constraints live here rather than at each call site.
 */
export interface OutboundPort {
	request(spec: OutboundRequest): Promise<OutboundResponse>;
	requestHostPinned(spec: HostPinnedRequest): Promise<HostPinnedResponse>;
	readSecret(id: string): string | null;
}
