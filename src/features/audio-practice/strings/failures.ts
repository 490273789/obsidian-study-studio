import type { Language } from "../../../core/shared/types";
import type {
	AudioPracticeFailure,
	ProviderFailureReason,
	SubtitleProblem,
} from "../domain/failures";

type FailureAction = "retry" | "open-settings" | "regenerate" | "choose-file";

interface FailureCopy {
	readonly message: string;
	readonly action: FailureAction | null;
}

const zh = {
	missing: "文件可能尚未同步，请检查仓库中的音频和字幕。",
	unreadable: "无法读取或播放该音频。",
	tooLarge: "生成字幕仅支持 50 MiB 以内的音频。",
	tooLong: "生成字幕仅支持 10 分钟以内的有效音频。",
	noSpeech: "音频中没有识别到可用语音，可手动补建片段。",
	parseTiming: "字幕时间格式无效。",
	parseContent: "字幕包含无效时间或空白文字。",
	parseEmpty: "未找到可用字幕，请选择 SRT 或 VTT 文件。",
	sourceChanged: "音频或原文已改变，请重新生成字幕后保存。",
	staleMaterial: "材料或字幕已更新，请重新保存。",
	workspace: "请填写有效的百炼 Workspace ID。",
	baseUrl: "请填写有效的语音服务 Base URL。",
	model: "请填写语音服务模型。",
	secret: "请在设置中为字幕生成服务配置 API Key 密钥。",
	security: "自定义服务只允许 https，或本机回环地址的 http。",
	unauthorized: "语音服务鉴权失败，请检查 API Key 与服务配置。",
	notFound: "语音服务地址不存在，请检查 Workspace ID 或 Base URL。",
	rateLimited: "语音服务请求过多，请稍后手动重试。",
	timeout: "语音服务请求超时，请手动重试。",
	network: "网络连接失败，请检查网络后重试。",
	server: "语音服务暂时不可用，请稍后重试。",
	invalidResponse: "语音服务返回了无效结果，请检查服务配置。",
	providerFallback: "语音识别未完成，请检查音频与配置后手动重试。",
	missingTimestamps: "服务未返回词级时间戳，无法自动对齐原文，请改用支持词级时间戳的模型。",
	incompleteStream: "语音服务没有返回完整识别结果，请重试。",
	invalidTiming: "语音服务返回的时间戳无效，请重试。",
	invalidPayload: "语音服务返回了无效或不完整的识别结果。",
	draftSave: "本地草稿保存失败，请保留页面并重试。",
	persist: "练习进度保存失败，请稍后重试。",
	subtitleWrite: "保存字幕失败，校对草稿已保留。",
	cancelled: "操作已取消。",
	busy: "上一次操作尚未完成，请稍后再试。",
	unknown: "操作失败，请重试。",
	listSeparator: "；",
	noCues: "至少需要一个字幕片段",
	badTiming: (index: number) => `第 ${index} 段时间无效`,
	outOfRange: (index: number) => `第 ${index} 段超出音频范围`,
	needsReview: (index: number) => `第 ${index} 段仍需校对`,
	duplicateId: (index: number) => `第 ${index} 段标识重复或缺失`,
	emptyText: (index: number) => `第 ${index} 段文字为空`,
	blankLine: (index: number) => `第 ${index} 段包含空白行，请删除空白行后保存`,
};

const en: typeof zh = {
	missing: "The file may not have synced yet. Check the audio and subtitles in your vault.",
	unreadable: "The audio could not be read or played.",
	tooLarge: "Subtitle generation supports audio up to 50 MiB.",
	tooLong: "Subtitle generation supports valid audio up to 10 minutes.",
	noSpeech: "No usable speech was detected. Add subtitle segments manually.",
	parseTiming: "The subtitle timing format is invalid.",
	parseContent: "The subtitles contain invalid timing or empty text.",
	parseEmpty: "No usable subtitles were found. Choose an SRT or VTT file.",
	sourceChanged: "Audio or reference text has changed. Generate subtitles again before saving.",
	staleMaterial: "The material or subtitles changed. Save again.",
	workspace: "Enter a valid Model Studio Workspace ID.",
	baseUrl: "Enter a valid speech-service Base URL.",
	model: "Enter a speech-service model.",
	secret: "Configure an API key for subtitle generation in settings.",
	security: "Custom services must use https, or http on a loopback host.",
	unauthorized:
		"The speech service rejected the credentials. Check the API key and service configuration.",
	notFound: "The speech-service address was not found. Check the Workspace ID or Base URL.",
	rateLimited: "The speech service is rate limited. Retry manually later.",
	timeout: "The speech-service request timed out. Retry manually.",
	network: "The network request failed. Check your connection and retry.",
	server: "The speech service is temporarily unavailable. Retry later.",
	invalidResponse:
		"The speech service returned an invalid result. Check the service configuration.",
	providerFallback:
		"Speech recognition did not finish. Check the audio and configuration, then retry manually.",
	missingTimestamps:
		"The service returned no word timestamps, so reference text cannot be aligned. Use a model that returns word timestamps.",
	incompleteStream: "The speech service did not return a complete result. Retry.",
	invalidTiming: "The speech service returned invalid timestamps. Retry.",
	invalidPayload: "The speech service returned an invalid or incomplete result.",
	draftSave: "The local draft could not be saved. Keep this page open and retry.",
	persist: "Practice progress could not be saved. Retry later.",
	subtitleWrite: "The subtitles could not be saved. Your review draft is preserved.",
	cancelled: "The operation was cancelled.",
	busy: "Another operation is still running. Try again in a moment.",
	unknown: "The operation failed. Retry.",
	listSeparator: "; ",
	noCues: "At least one subtitle segment is required.",
	badTiming: (index: number) => `Segment ${index} has invalid timing.`,
	outOfRange: (index: number) => `Segment ${index} is beyond the audio duration.`,
	needsReview: (index: number) => `Segment ${index} still needs review.`,
	duplicateId: (index: number) => `Segment ${index} has a missing or duplicate id.`,
	emptyText: (index: number) => `Segment ${index} has empty text.`,
	blankLine: (index: number) =>
		`Segment ${index} contains a blank line. Remove it before saving.`,
};

function problemCopy(copy: typeof zh, problem: SubtitleProblem): string {
	const index = "cueIndex" in problem ? problem.cueIndex + 1 : 0;
	switch (problem.kind) {
		case "no-cues":
			return copy.noCues;
		case "bad-timing":
			return copy.badTiming(index);
		case "out-of-range":
			return copy.outOfRange(index);
		case "needs-review":
			return copy.needsReview(index);
		case "duplicate-id":
			return copy.duplicateId(index);
		case "empty-text":
			return copy.emptyText(index);
		case "blank-line":
			return copy.blankLine(index);
	}
}

function providerMessage(copy: typeof zh, code: string, reason?: ProviderFailureReason): string {
	if (reason === "missing-word-timestamps") return copy.missingTimestamps;
	if (reason === "incomplete-stream") return copy.incompleteStream;
	if (reason === "invalid-timing") return copy.invalidTiming;
	if (reason === "invalid-payload") return copy.invalidPayload;
	switch (code) {
		case "unauthorized":
			return copy.unauthorized;
		case "not-found":
			return copy.notFound;
		case "rate-limited":
			return copy.rateLimited;
		case "timeout":
			return copy.timeout;
		case "network":
			return copy.network;
		case "server":
			return copy.server;
		case "invalid-response":
			return copy.invalidResponse;
		default:
			return copy.providerFallback;
	}
}

function message(copy: typeof zh, failure: AudioPracticeFailure): string {
	switch (failure.kind) {
		case "missing-file":
			return copy.missing;
		case "unreadable-media":
			return copy.unreadable;
		case "audio-too-large":
			return copy.tooLarge;
		case "audio-too-long":
			return copy.tooLong;
		case "no-speech":
			return copy.noSpeech;
		case "subtitle-parse":
			return failure.reason === "timing"
				? copy.parseTiming
				: failure.reason === "content"
					? copy.parseContent
					: copy.parseEmpty;
		case "subtitle-invalid":
			return failure.problems
				.map((problem) => problemCopy(copy, problem))
				.join(copy.listSeparator);
		case "source-changed":
			return copy.sourceChanged;
		case "stale-material":
			return copy.staleMaterial;
		case "config-invalid":
			switch (failure.field) {
				case "workspace":
					return copy.workspace;
				case "base-url":
					return copy.baseUrl;
				case "model":
					return copy.model;
				case "secret":
					return copy.secret;
				case "security":
					return copy.security;
			}
		case "provider-failure":
			return providerMessage(copy, failure.code, failure.reason);
		case "draft-save-failed":
			return copy.draftSave;
		case "persist-failed":
			return copy.persist;
		case "subtitle-write-failed":
			return copy.subtitleWrite;
		case "cancelled":
			return copy.cancelled;
		case "busy":
			return copy.busy;
		case "unknown":
			return copy.unknown;
	}
}

function action(failure: AudioPracticeFailure): FailureAction | null {
	switch (failure.kind) {
		case "missing-file":
		case "audio-too-large":
		case "audio-too-long":
		case "subtitle-parse":
			return "choose-file";
		case "no-speech":
		case "subtitle-invalid":
		case "source-changed":
			return "regenerate";
		case "config-invalid":
			return "open-settings";
		case "provider-failure":
		case "draft-save-failed":
		case "persist-failed":
		case "subtitle-write-failed":
		case "unknown":
			return "retry";
		default:
			return null;
	}
}

/** Single authority for audio-practice failure copy and its recovery hint. */
export function audioFailureCopy(language: Language, failure: AudioPracticeFailure): FailureCopy {
	const copy = language === "en" ? en : zh;
	return { message: message(copy, failure), action: action(failure) };
}
