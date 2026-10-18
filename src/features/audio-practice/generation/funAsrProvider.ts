import { TransportError, type OutboundPort } from "../../../core/net/types";
import type { DraftCue, TimedWord, Transcript, TranscribeAudio } from "./types";

function base64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 8192)
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
	return btoa(binary);
}

export function parseFunAsrResponse(text: string): Transcript {
	try {
		return parseResponse(text);
	} catch {
		// JSON parsing errors can embed raw response fragments; never expose them to UI.
		throw new Error("语音服务返回了无效或不完整的识别结果。");
	}
}

function parseResponse(text: string): Transcript {
	const payloads: unknown[] = text.trim().startsWith("{")
		? [JSON.parse(text)]
		: text.split(/\r?\n\r?\n/).flatMap((event) => {
				const data = event
					.split(/\r?\n/)
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trim())
					.join("\n");
				return !data || data === "[DONE]" ? [] : [JSON.parse(data) as unknown];
			});
	const sentences = new Map<string, { cue: DraftCue; words: TimedWord[] }>();
	let hasOutput = false;
	const pending = new Set<string>();
	for (const payload of payloads) {
		if (!payload || typeof payload !== "object") throw new Error("语音服务返回了无效结果。");
		const record = payload as Record<string, unknown>;
		if (record.code) throw new Error("语音服务未能完成识别，请检查配置后重试。");
		if (!record.output || typeof record.output !== "object") continue;
		hasOutput = true;
		const output = record.output as Record<string, unknown>;
		const raw = output.sentence;
		if (!raw || typeof raw !== "object") continue;
		const sentence = raw as Record<string, unknown>;
		if (typeof sentence.sentence_id !== "number" && typeof sentence.sentence_id !== "string")
			throw new Error("语音服务返回的片段标识无效。");
		const id = String(sentence.sentence_id);
		if (sentence.sentence_end !== true) {
			pending.add(id);
			continue;
		}
		pending.delete(id);
		if (typeof sentence.begin_time !== "number" || typeof sentence.end_time !== "number")
			throw new Error("语音服务返回的时间戳无效。");
		const start = Number(sentence.begin_time) / 1000;
		const end = Number(sentence.end_time) / 1000;
		if (
			!Number.isFinite(start) ||
			!Number.isFinite(end) ||
			start < 0 ||
			end <= start ||
			typeof sentence.text !== "string"
		)
			throw new Error("语音服务返回的时间戳无效。");
		const words = (Array.isArray(sentence.words) ? sentence.words : []).flatMap(
			(rawWord): TimedWord[] => {
				if (!rawWord || typeof rawWord !== "object") return [];
				const word = rawWord as Record<string, unknown>;
				const wordStart = Number(word.begin_time) / 1000;
				const wordEnd = Number(word.end_time) / 1000;
				return typeof word.text === "string" &&
					Number.isFinite(wordStart) &&
					Number.isFinite(wordEnd) &&
					wordStart >= start &&
					wordEnd <= end &&
					wordEnd > wordStart
					? [{ text: word.text, start: wordStart, end: wordEnd }]
					: [];
			},
		);
		sentences.set(id, {
			cue: { id, text: sentence.text, start, end, needsReview: true },
			words,
		});
	}
	if (!hasOutput || pending.size > 0) throw new Error("语音服务没有返回完整识别结果。");
	const ordered = [...sentences.values()].sort((a, b) => (a.cue.start ?? 0) - (b.cue.start ?? 0));
	return { cues: ordered.map((item) => item.cue), words: ordered.flatMap((item) => item.words) };
}

export function createFunAsrProvider(outbound: OutboundPort): TranscribeAudio {
	return async (chunk, config, signal) => {
		if (!/^[a-zA-Z0-9-]+$/.test(config.workspaceId))
			throw new Error("请填写有效的百炼 Workspace ID。");
		const secret = outbound.readSecret(config.secretId);
		if (!secret) throw new Error("请在设置中配置语音服务 API Key。");
		try {
			const response = await outbound.request({
				label: "audio-practice-transcription",
				url: `https://${config.workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`,
				method: "POST",
				headers: {
					Authorization: `Bearer ${secret}`,
					"Content-Type": "application/json",
					"X-DashScope-SSE": "enable",
				},
				body: JSON.stringify({
					model: "fun-asr-flash-2026-06-15",
					input: {
						messages: [
							{
								role: "user",
								content: [
									{
										type: "input_audio",
										input_audio: {
											data: `data:audio/wav;base64,${base64(chunk.wav)}`,
										},
									},
								],
							},
						],
					},
					parameters: { format: "wav", sample_rate: "16000", language_hints: ["en"] },
				}),
				signal,
				timeoutMs: 120000,
				maxBytes: 8 * 1024 * 1024,
			});
			return parseFunAsrResponse(response.text);
		} catch (error) {
			if (error instanceof TransportError) {
				const messages: Partial<Record<TransportError["code"], string>> = {
					unauthorized: "语音服务鉴权失败，请检查 API Key 与 Workspace ID。",
					"rate-limited": "语音服务请求过多，请稍后手动重试。",
					timeout: "语音服务请求超时，请手动重试。",
					network: "网络连接失败，请检查网络后重试。",
					server: "语音服务暂时不可用，请稍后重试。",
				};
				throw new Error(messages[error.code] ?? "语音识别未完成，请手动重试。");
			}
			throw new Error("语音识别未完成，请检查音频与配置后手动重试。");
		}
	};
}
