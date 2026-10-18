import type { OutboundPort } from "../../../core/net/types";
import { speechServiceFailure } from "./serviceErrors";
import type {
	AudioChunk,
	BailianTranscriptionConfig,
	DraftCue,
	TimedWord,
	Transcript,
} from "./types";

function base64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 8192)
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
	return btoa(binary);
}

export function parseBailianResponse(text: string): Transcript {
	try {
		return parseResponse(text);
	} catch {
		// JSON parsing errors can embed raw response fragments; never expose them to UI.
		throw new Error("语音服务返回了无效或不完整的识别结果。");
	}
}

interface ParsedSentence {
	cue: DraftCue;
	words: TimedWord[];
}

/** Returns the text that follows a cumulative snapshot, or null when it is independent. */
function cumulativeRemainder(previous: string, next: string): string | null {
	if (next.startsWith(previous)) return next.slice(previous.length);
	const trimmed = previous.trimEnd();
	if (trimmed !== previous && next.startsWith(trimmed)) return next.slice(trimmed.length);
	return null;
}

function sameWord(left: TimedWord, right: TimedWord): boolean {
	return (
		left.text === right.text &&
		Math.abs(left.start - right.start) < 0.1 &&
		Math.abs(left.end - right.end) < 0.1
	);
}

/**
 * The synchronous SSE API may repeat the transcript recognised so far in every
 * event: text and words accumulate, `begin_time` stays at the first speech and
 * `end_time` grows. Such events are progress snapshots, not separate sentences.
 */
function isCumulativeSnapshot(entries: ParsedSentence[]): boolean {
	if (entries.length < 2) return false;
	return entries.every((entry, index) => {
		if (index === 0) return true;
		const previous = entries[index - 1]!;
		return (
			Math.abs((entry.cue.start ?? 0) - (previous.cue.start ?? 0)) <= 0.05 &&
			(entry.cue.end ?? 0) > (previous.cue.end ?? 0) &&
			entry.words.length >= previous.words.length &&
			cumulativeRemainder(previous.cue.text, entry.cue.text) !== null
		);
	});
}

function foldCumulativeSnapshots(entries: ParsedSentence[]): Transcript {
	const cues: DraftCue[] = [];
	const words: TimedWord[] = [];
	let previous: ParsedSentence | null = null;
	for (const entry of entries) {
		const previousEnd = previous?.cue.end ?? 0;
		let sentenceWords = entry.words;
		if (previous) {
			const sharedPrefix =
				entry.words.length >= previous.words.length &&
				previous.words.every((word, index) => sameWord(entry.words[index]!, word));
			sentenceWords = sharedPrefix
				? entry.words.slice(previous.words.length)
				: entry.words.filter((word) => word.start >= previousEnd - 0.05);
		}
		const remainder = previous ? cumulativeRemainder(previous.cue.text, entry.cue.text) : null;
		const text = (remainder ?? entry.cue.text).trim();
		const label =
			text ||
			sentenceWords
				.map((word) => word.text.trim())
				.join(" ")
				.trim();
		const start = previous ? (sentenceWords[0]?.start ?? previousEnd) : (entry.cue.start ?? 0);
		const end = entry.cue.end ?? 0;
		if (label && end > start) {
			cues.push({ ...entry.cue, text: label, start, end });
			words.push(...sentenceWords);
		}
		previous = entry;
	}
	return { cues, words };
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
	const sentences = new Map<string, ParsedSentence>();
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
	const entries = [...sentences.values()];
	if (isCumulativeSnapshot(entries)) return foldCumulativeSnapshots(entries);
	const ordered = entries.sort((a, b) => (a.cue.start ?? 0) - (b.cue.start ?? 0));
	return { cues: ordered.map((item) => item.cue), words: ordered.flatMap((item) => item.words) };
}

export function createBailianProvider(outbound: OutboundPort) {
	return async (
		chunk: AudioChunk,
		config: BailianTranscriptionConfig,
		signal: AbortSignal,
	): Promise<Transcript> => {
		if (!/^[a-zA-Z0-9-]+$/.test(config.workspaceId.trim()))
			throw new Error("请填写有效的百炼 Workspace ID。");
		if (!config.model.trim()) throw new Error("请填写百炼语音模型。");
		const secret = outbound.readSecret(config.secretId);
		if (!secret) throw new Error("请在设置中配置语音服务 API Key。");
		let response;
		try {
			response = await outbound.request({
				label: "audio-practice-transcription",
				url: `https://${config.workspaceId.trim()}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`,
				method: "POST",
				headers: {
					Authorization: `Bearer ${secret}`,
					"Content-Type": "application/json",
					"X-DashScope-SSE": "enable",
				},
				body: JSON.stringify({
					model: config.model.trim(),
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
		} catch (error) {
			throw speechServiceFailure(error);
		}
		return parseBailianResponse(response.text);
	};
}
