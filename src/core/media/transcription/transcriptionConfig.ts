import { EndpointValidationError, validateHttpEndpoint } from "../../net/endpoint";
import { mediaFailure } from "../failures";
import type { TranscriptionConfig } from "../transcriptionTypes";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function parseBaseUrl(value: string): URL {
	const trimmed = value.trim();
	try {
		return new URL(validateHttpEndpoint(trimmed));
	} catch (error) {
		if (error instanceof EndpointValidationError)
			throw mediaFailure({ kind: "config-invalid", field: "base-url" });
		throw error;
	}
}

/** Validates a config before any audio is decoded or any paid request starts. */
export function validateTranscriptionConfig(config: TranscriptionConfig): void {
	if (!config.secretId.trim()) throw mediaFailure({ kind: "config-invalid", field: "secret" });
	if (config.provider === "bailian") {
		if (!/^[a-zA-Z0-9-]+$/.test(config.workspaceId.trim()))
			throw mediaFailure({ kind: "config-invalid", field: "workspace" });
		if (!config.model.trim()) throw mediaFailure({ kind: "config-invalid", field: "model" });
		return;
	}
	const url = parseBaseUrl(config.baseUrl);
	if (!config.model.trim()) throw mediaFailure({ kind: "config-invalid", field: "model" });
	if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname))
		throw mediaFailure({ kind: "config-invalid", field: "security" });
}

/** Builds the standard transcription endpoint from the user's API base URL. */
export function openAiCompatibleAudioUrl(baseUrl: string): string {
	const url = parseBaseUrl(baseUrl);
	const path = url.pathname.replace(/\/+$/, "");
	return `${url.origin}${path}/audio/transcriptions`;
}

/** Provider/model identity; the workspace value is hashed before a draft is saved. */
export async function transcriptionConfigFingerprint(config: TranscriptionConfig): Promise<string> {
	if (config.provider === "bailian") {
		const bytes = new TextEncoder().encode(config.workspaceId.trim());
		const hash = await crypto.subtle.digest("SHA-256", bytes);
		const workspaceHash = Array.from(new Uint8Array(hash), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
		return ["bailian", workspaceHash, config.model.trim()].join("|");
	}
	return [
		"openai-compatible",
		config.baseUrl.trim().replace(/\/+$/, ""),
		config.model.trim(),
	].join("|");
}

/** Accepts an older plaintext draft fingerprint only for the same Bailian workspace and model. */
export function matchesLegacyBailianFingerprint(
	fingerprint: string,
	config: TranscriptionConfig,
): boolean {
	return (
		config.provider === "bailian" &&
		fingerprint === ["bailian", config.workspaceId.trim(), config.model.trim()].join("|")
	);
}
