import type { Language } from "../../../core/shared/types";

const zh = {
	title: "听说练习",
	enabled: "启用听说练习",
	engineLabel: "语音识别引擎",
	engineHint: "字幕生成使用所选引擎；引擎与密钥在 AI 引擎设置中统一管理。",
	defaultEngine: "默认引擎（使用 AI 引擎设置中的默认项）",
	missingEngine: "已不可用的引擎",
	manageHeading: "AI 引擎设置",
	manageHint: "ASR 引擎、模型、Base URL 与密钥都在 AI 引擎设置中统一管理。",
	openAiSettings: "打开 AI 引擎设置",
};
const en: typeof zh = {
	title: "Listening & speaking",
	enabled: "Enable listening practice",
	engineLabel: "Speech-recognition engine",
	engineHint:
		"Subtitle generation uses the selected engine; engines and secrets are managed together in AI engine settings.",
	defaultEngine: "Default engine (the default in AI engine settings)",
	missingEngine: "Unavailable engine",
	manageHeading: "AI engine settings",
	manageHint:
		"ASR engines, models, Base URLs and secrets are managed together in AI engine settings.",
	openAiSettings: "Open AI engine settings",
};
export const audioSettingsCopy = (language: Language) => (language === "en" ? en : zh);
