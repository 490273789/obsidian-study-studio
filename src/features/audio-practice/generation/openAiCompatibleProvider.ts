import { isRecord } from "../../../core/shared/isRecord";
import type { OutboundPort } from "../../../core/net/types";
import { buildMultipartBody, createMultipartBoundary } from "./multipart";
import { speechServiceFailure } from "./serviceErrors";
import { openAiCompatibleAudioUrl, validateTranscriptionConfig } from "./transcriptionConfig";
import type {
	AudioChunk,
	DraftCue,
	OpenAiCompatibleTranscriptionConfig,
	TimedWord,
	Transcript,
} from "./types";

interface ParsedSegment {
	text: string;
	start: number;
	end: number;
	words: TimedWord[];
}

function finiteTime(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function readWords(value: unknown): TimedWord[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((raw): TimedWord[] => {
		if (!isRecord(raw) || typeof raw.word !== "string") return [];
		const start = finiteTime(raw.start);
		const end = finiteTime(raw.end);
		return start !== null && end !== null && end > start && raw.word.trim()
			? [{ text: raw.word, start, end }]
			: [];
	});
}

function readSegments(value: unknown): ParsedSegment[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((raw): ParsedSegment[] => {
		if (!isRecord(raw) || typeof raw.text !== "string" || !raw.text.trim()) return [];
		const start = finiteTime(raw.start);
		const end = finiteTime(raw.end);
		return start !== null && end !== null && end > start
			? [{ text: raw.text.trim(), start, end, words: readWords(raw.words) }]
			: [];
	});
}

/** Groups word timestamps into sentence-sized cues when a service omits segments. */
function cuesFromWords(words: readonly TimedWord[]): DraftCue[] {
	const cues: DraftCue[] = [];
	let run: TimedWord[] = [];
	const flush = () => {
		if (!run.length) return;
		cues.push({
			id: String(cues.length),
			text: run
				.map((word) => word.text.trim())
				.join(" ")
				.trim(),
			start: run[0]!.start,
			end: run[run.length - 1]!.end,
			needsReview: true,
		});
		run = [];
	};
	for (const word of words) {
		run.push(word);
		if (/[.!?…。！？]["'”’)]*$/.test(word.text) || run.length >= 12) flush();
	}
	flush();
	return cues.filter((cue) => cue.text.length > 0);
}

export function parseOpenAiCompatibleResponse(text: string): Transcript {
	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		throw new Error("语音服务返回了无效或不完整的识别结果。");
	}
	if (!isRecord(payload)) throw new Error("语音服务返回了无效结果。");
	if (payload.error) throw new Error("语音服务未能完成识别，请检查配置后重试。");
	const topLevelWords = readWords(payload.words);
	const segments = readSegments(payload.segments);
	const words = topLevelWords.length
		? topLevelWords
		: segments.flatMap((segment) => segment.words);
	const cues: DraftCue[] = segments.length
		? segments.map((segment, index) => ({
				id: String(index),
				text: segment.text,
				start: segment.start,
				end: segment.end,
				needsReview: true,
			}))
		: cuesFromWords(words);
	if (cues.length === 0)
		throw new Error(
			"语音服务未返回时间信息，无法生成字幕；请改用支持 verbose_json 时间戳的模型。",
		);
	return { cues, words };
}

export function createOpenAiCompatibleProvider(outbound: OutboundPort) {
	return async (
		chunk: AudioChunk,
		config: OpenAiCompatibleTranscriptionConfig,
		signal: AbortSignal,
	): Promise<Transcript> => {
		validateTranscriptionConfig(config);
		const secret = outbound.readSecret(config.secretId);
		if (!secret) throw new Error("请在设置中配置语音服务 API Key。");
		const boundary = createMultipartBoundary();
		const body = buildMultipartBody(
			[
				{ name: "model", value: config.model.trim() },
				{ name: "language", value: "en" },
				{ name: "response_format", value: "verbose_json" },
				{ name: "timestamp_granularities[]", value: "word" },
				{ name: "timestamp_granularities[]", value: "segment" },
			],
			{ name: "file", filename: "chunk.wav", contentType: "audio/wav", bytes: chunk.wav },
			boundary,
		);
		let response;
		try {
			response = await outbound.request({
				label: "audio-practice-transcription",
				url: openAiCompatibleAudioUrl(config.baseUrl),
				method: "POST",
				headers: {
					Authorization: `Bearer ${secret}`,
					"Content-Type": `multipart/form-data; boundary=${boundary}`,
				},
				body,
				signal,
				timeoutMs: 120000,
				maxBytes: 8 * 1024 * 1024,
			});
		} catch (error) {
			throw speechServiceFailure(error);
		}
		return parseOpenAiCompatibleResponse(response.text);
	};
}
