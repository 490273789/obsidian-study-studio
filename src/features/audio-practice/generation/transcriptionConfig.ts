import { EndpointValidationError, validateHttpEndpoint } from "../../../core/net/endpoint";
import { audioFailure } from "../domain/failures";
import type { TranscriptionConfig } from "./types";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function parseBaseUrl(value: string): URL {
	const trimmed = value.trim();
	try {
		return new URL(validateHttpEndpoint(trimmed));
	} catch (error) {
		if (error instanceof EndpointValidationError)
			throw audioFailure({ kind: "config-invalid", field: "base-url" });
		throw error;
	}
}

/** Validates a config before any audio is decoded or any paid request starts. */
export function validateTranscriptionConfig(config: TranscriptionConfig): void {
	if (!config.secretId.trim()) throw audioFailure({ kind: "config-invalid", field: "secret" });
	if (config.provider === "bailian") {
		if (!/^[a-zA-Z0-9-]+$/.test(config.workspaceId.trim()))
			throw audioFailure({ kind: "config-invalid", field: "workspace" });
		if (!config.model.trim()) throw audioFailure({ kind: "config-invalid", field: "model" });
		return;
	}
	const url = parseBaseUrl(config.baseUrl);
	if (!config.model.trim()) throw audioFailure({ kind: "config-invalid", field: "model" });
	if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname))
		throw audioFailure({ kind: "config-invalid", field: "security" });
}

/** Builds the standard transcription endpoint from the user's API base URL. */
export function openAiCompatibleAudioUrl(baseUrl: string): string {
	const url = parseBaseUrl(baseUrl);
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${path}/audio/transcriptions`;
}

/** Provider/model identity; credentials are deliberately excluded. */
export function transcriptionConfigFingerprint(config: TranscriptionConfig): string {
	return config.provider === "bailian"
		? ["bailian", config.workspaceId.trim(), config.model.trim()].join("|")
		: [
				"openai-compatible",
				config.baseUrl.trim().replace(/\/+$/, ""),
				config.model.trim(),
			].join("|");
}
