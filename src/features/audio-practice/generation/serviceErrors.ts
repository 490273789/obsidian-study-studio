import { TransportError } from "../../../core/net/types";

/**
 * Maps transport failures into user-facing speech-service messages.
 *
 * Provided raw response bodies are never echoed: provider payloads may embed
 * credentials or unvalidated fragments.
 */
export function speechServiceFailure(error: unknown): Error {
	if (error instanceof TransportError) {
		const messages: Partial<Record<TransportError["code"], string>> = {
			unauthorized: "语音服务鉴权失败，请检查 API Key 与服务配置。",
			"not-found": "语音服务地址不存在，请检查 Workspace ID 或 Base URL。",
			"rate-limited": "语音服务请求过多，请稍后手动重试。",
			timeout: "语音服务请求超时，请手动重试。",
			network: "网络连接失败，请检查网络后重试。",
			server: "语音服务暂时不可用，请稍后重试。",
			"invalid-response": "语音服务返回了无效结果，请检查服务配置。",
		};
		const message = messages[error.code];
		if (message) return new Error(message);
	}
	return new Error("语音识别未完成，请检查音频与配置后手动重试。");
}
