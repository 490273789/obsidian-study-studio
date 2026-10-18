import type { Language } from "../../../core/shared/types";

const zh = {
	title: "听说练习",
	enabled: "启用听说练习",
	service: "字幕生成服务",
	provider: "服务类型",
	providerHint: "选择接收音频的语音识别服务；切换后只需填写对应服务的配置。",
	providerBailian: "阿里云百炼",
	providerOpenAi: "OpenAI 兼容服务",
	workspace: "百炼 Workspace ID",
	workspaceHint: "使用北京地域的业务空间。",
	bailianModel: "百炼模型",
	bailianModelHint:
		"可选 fun-asr-flash-2026-06-15、qwen-audio-3.1-asr-flash、qwen-audio-3.0-asr-flash，三者共用同一识别协议。qwen3-asr-flash、fun-asr、paraformer 等模型协议不同或只支持异步/WebSocket，填入会失败。",
	bailianSecret: "百炼 API Key 密钥",
	bailianSecretHint: "选择 Obsidian 密钥库中的百炼 API Key；密钥本身不写入插件数据。",
	bailianServiceHint:
		"生成时将音频发送到阿里云百炼的同步语音识别接口，按服务用量收费。原文在本地匹配。支持不超过 10 分钟、50 MiB 的英语音频。",
	baseUrl: "服务 Base URL",
	baseUrlHint:
		"填写到 API 根路径，例如 https://api.openai.com/v1；本机自建服务可用 http://127.0.0.1:8080/v1。密钥会发送到该地址，请只填写可信服务。",
	openaiModel: "模型 ID",
	openaiModelHint:
		"默认 whisper-1：OpenAI 官方只有它返回词级时间戳。Groq、DeepInfra、Together 等兼容服务的 Whisper 模型也可以；只返回文本的服务无法自动对齐原文。",
	openaiSecret: "服务 API Key 密钥",
	openaiSecretHint: "选择 Obsidian 密钥库中该服务的 API Key；密钥本身不写入插件数据。",
	openaiServiceHint:
		"生成时通过 POST {Base URL}/audio/transcriptions 发送音频，服务需兼容 verbose_json 时间戳。自建 whisper.cpp 需以 --inference-path /v1/audio/transcriptions 启动。",
	error: "听说练习无法打开。",
	missing: "文件不存在或尚未同步，请等待同步或重新关联。",
	failed: "操作失败，请重试。",
	disabled: "听说练习已停用，请在设置中启用。",
	openSettings: "打开设置",
	saving: "保存字幕失败，校对草稿已保留。",
	sourceChanged: "音频或原文已改变，请重新生成字幕后保存。",
};
const en: typeof zh = {
	title: "Listening & speaking",
	enabled: "Enable listening practice",
	service: "Subtitle generation",
	provider: "Service",
	providerHint:
		"Choose which speech-recognition service receives the audio; only the matching fields below apply.",
	providerBailian: "Alibaba Cloud Model Studio",
	providerOpenAi: "OpenAI-compatible service",
	workspace: "Model Studio Workspace ID",
	workspaceHint: "Use a workspace in the Beijing region.",
	bailianModel: "Model Studio model",
	bailianModelHint:
		"Use fun-asr-flash-2026-06-15, qwen-audio-3.1-asr-flash, or qwen-audio-3.0-asr-flash; they share one protocol. qwen3-asr-flash, fun-asr, and paraformer use different or asynchronous/WebSocket APIs and will fail here.",
	bailianSecret: "Model Studio API key",
	bailianSecretHint:
		"Select a Model Studio API key from Obsidian Secret Storage. The key itself is not stored in plugin data.",
	bailianServiceHint:
		"Generation sends audio to Alibaba Cloud Model Studio's synchronous speech API and may incur usage charges. Reference text is matched locally. English audio: up to 10 minutes and 50 MiB.",
	baseUrl: "Service Base URL",
	baseUrlHint:
		"Enter the API root, e.g. https://api.openai.com/v1; a local service can use http://127.0.0.1:8080/v1. Your API key is sent to this address, so only configure a trusted service.",
	openaiModel: "Model ID",
	openaiModelHint:
		"whisper-1 is the default: it is the only OpenAI model that returns word timestamps. Whisper models behind Groq, DeepInfra, Together, or similar compatible services also work; text-only services cannot align reference text.",
	openaiSecret: "Service API key",
	openaiSecretHint:
		"Select this service's API key from Obsidian Secret Storage. The key itself is not stored in plugin data.",
	openaiServiceHint:
		"Generation POSTs audio to {Base URL}/audio/transcriptions and requires verbose_json timestamps. A self-hosted whisper.cpp server needs --inference-path /v1/audio/transcriptions.",
	error: "Unable to open listening practice.",
	missing: "File missing or not yet synced. Wait for sync or reconnect the file.",
	failed: "Operation failed. Please retry.",
	disabled: "Listening practice is disabled. Enable it in settings.",
	openSettings: "Open settings",
	saving: "Unable to save subtitles. Your review draft is preserved.",
	sourceChanged: "Audio or reference text has changed. Generate subtitles again before saving.",
};
export const audioSettingsCopy = (language: Language) => (language === "en" ? en : zh);
