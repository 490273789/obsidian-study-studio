import { AiError } from "../../../core/ai/types";
import { TransportError, type OutboundPort } from "../../../core/net/types";
import {
	requestYoudaoJson,
	resolveYoudaoConnection,
	YoudaoTransportError,
} from "../../../core/net/youdaoTransport";

interface YoudaoConnection {
	baseUrl: string;
	appKeySecretId: string;
	appSecretSecretId: string;
}

function parseTranslationPayload(payload: unknown): { text: string; usage: null } {
	const result = payload as Record<string, unknown>;
	if (!Array.isArray(result.translation)) throw new TransportError("invalid-response");
	const translations = result.translation.filter(
		(value): value is string => typeof value === "string" && Boolean(value.trim()),
	);
	if (!translations.length) throw new TransportError("invalid-response");
	return { text: translations.join("\n"), usage: null };
}

/** Keeps the translation surface's existing classification for shared Youdao failures. */
function throwYoudaoTranslationError(error: YoudaoTransportError): never {
	switch (error.kind) {
		case "invalid-config":
		case "missing-key":
			throw new AiError(error.kind);
		case "unauthorized":
		case "rate-limited":
			throw new TransportError(error.kind, { httpStatus: error.httpStatus ?? undefined });
		case "not-found":
			// The 词典 surface owns not-found semantics; translation keeps its old server bucket.
			throw new TransportError("server", { httpStatus: error.httpStatus ?? undefined });
		case "server":
			throw new TransportError("server", { httpStatus: error.httpStatus ?? undefined });
		case "invalid-response":
			throw new TransportError("invalid-response");
		case "network":
			throw new TransportError("network", { cause: error });
	}
}

export async function translateYoudao(
	connection: YoudaoConnection,
	text: string,
	direction: "zh-en" | "en-zh",
	net: Pick<OutboundPort, "request" | "readSecret">,
	signal?: AbortSignal,
): Promise<{ text: string; usage: null }> {
	if (!text.trim()) throw new AiError("invalid-input");
	let appKey: string | null;
	let appSecret: string | null;
	try {
		appKey = net.readSecret(connection.appKeySecretId.trim());
		appSecret = net.readSecret(connection.appSecretSecretId.trim());
	} catch {
		throw new AiError("missing-key");
	}
	try {
		const resolved = resolveYoudaoConnection({
			endpoint: connection.baseUrl,
			appKey: appKey ?? "",
			appSecret: appSecret ?? "",
		});
		const payload = await requestYoudaoJson({
			connection: resolved,
			query: text.trim(),
			fields:
				direction === "zh-en" ? { from: "zh-CHS", to: "en" } : { from: "en", to: "zh-CHS" },
			net,
			label: "translation-youdao",
			...(signal === undefined ? {} : { signal }),
		});
		return parseTranslationPayload(payload);
	} catch (error) {
		if (error instanceof YoudaoTransportError) throwYoudaoTranslationError(error);
		if (error instanceof AiError || error instanceof TransportError) throw error;
		throw new TransportError("network", { cause: error });
	}
}
