import { buildYoudaoV3Body } from "../shared/youdaoSign";
import { EndpointValidationError, validateHttpEndpoint } from "./endpoint";
import type { OutboundPort } from "./types";

/** Provider-neutral Youdao failure categories; features map them to their own errors. */
export type YoudaoFailureKind =
	| "invalid-config"
	| "missing-key"
	| "unauthorized"
	| "rate-limited"
	| "not-found"
	| "server"
	| "invalid-response"
	| "network";

export class YoudaoTransportError extends Error {
	constructor(
		readonly kind: YoudaoFailureKind,
		readonly rawCode?: string,
		readonly httpStatus: number | null = null,
		options?: { cause?: unknown },
	) {
		super(`Youdao ${kind}`);
		if (options?.cause !== undefined) Object.assign(this, { cause: options.cause });
		this.name = "YoudaoTransportError";
	}
}

export interface YoudaoResolvedConnection {
	readonly endpoint: string;
	readonly appKey: string;
	readonly appSecret: string;
}

/**
 * The single Youdao error-code table. Dictionary lookups treat 120 as
 * not-found; translation callers may map that to their own generic failure.
 */
export function classifyYoudaoErrorCode(code: string): YoudaoFailureKind {
	if (["108", "111", "202", "203"].includes(code)) return "unauthorized";
	if (["411", "412"].includes(code)) return "rate-limited";
	if (code === "120") return "not-found";
	return "server";
}

/** Validates endpoint and credentials, throwing a category the caller maps. */
export function resolveYoudaoConnection(input: {
	endpoint: string;
	appKey: string;
	appSecret: string;
}): YoudaoResolvedConnection {
	let endpoint: string;
	try {
		endpoint = validateHttpEndpoint(input.endpoint);
	} catch (error) {
		if (error instanceof EndpointValidationError) {
			throw new YoudaoTransportError("invalid-config");
		}
		throw error;
	}
	const appKey = input.appKey.trim();
	const appSecret = input.appSecret.trim();
	if (!appKey || !appSecret) throw new YoudaoTransportError("missing-key");
	return { endpoint, appKey, appSecret };
}

/**
 * Signs the documented v3 form, sends it, parses JSON and classifies Youdao's
 * errorCode. Payload validation and result mapping stay with each feature.
 * Outbound-port transport errors pass through unchanged so callers keep their
 * existing timeout/network classification.
 */
export async function requestYoudaoJson(options: {
	connection: YoudaoResolvedConnection;
	query: string;
	fields: Readonly<Record<string, string>>;
	net: Pick<OutboundPort, "request">;
	label: string;
	timeoutMs?: number;
	maxBytes?: number;
	signal?: AbortSignal;
}): Promise<unknown> {
	const body = await buildYoudaoV3Body({
		appKey: options.connection.appKey,
		appSecret: options.connection.appSecret,
		fields: options.fields,
		query: options.query,
	});
	const response = await options.net.request({
		label: options.label,
		url: options.connection.endpoint,
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
		...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
		...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
		...(options.signal === undefined ? {} : { signal: options.signal }),
	});
	let payload: unknown;
	try {
		payload = JSON.parse(response.text);
	} catch (error) {
		throw new YoudaoTransportError("invalid-response", undefined, response.status, {
			cause: error,
		});
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new YoudaoTransportError("invalid-response", undefined, response.status);
	}
	const code = (payload as Record<string, unknown>).errorCode;
	if (typeof code === "string" || typeof code === "number") {
		const rawCode = String(code);
		if (rawCode !== "0") {
			throw new YoudaoTransportError(
				classifyYoudaoErrorCode(rawCode),
				rawCode,
				response.status,
			);
		}
	}
	return payload;
}
