import { EndpointValidationError, validateHttpEndpoint } from "../../../core/net/endpoint";
import type { TranscriptionConfig } from "./types";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function parseBaseUrl(value: string): URL {
	const trimmed = value.trim();
	try {
		return new URL(validateHttpEndpoint(trimmed));
	} catch (error) {
		if (error instanceof EndpointValidationError)
			throw new Error("请填写有效的语音服务 Base URL。");
		throw error;
	}
}

/** Validates a config before any audio is decoded or any paid request starts. */
export function validateTranscriptionConfig(config: TranscriptionConfig): void {
	if (!config.secretId.trim()) throw new Error("请在设置中为字幕生成服务选择 API Key 密钥。");
	if (config.provider === "bailian") {
		if (!/^[a-zA-Z0-9-]+$/.test(config.workspaceId.trim()))
			throw new Error("请填写有效的百炼 Workspace ID。");
		if (!config.model.trim()) throw new Error("请填写百炼语音模型。");
		return;
	}
	const url = parseBaseUrl(config.baseUrl);
	if (!config.model.trim()) throw new Error("请填写语音服务模型。");
	if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname))
		throw new Error("自定义服务只允许 https，或本机回环地址的 http。");
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
