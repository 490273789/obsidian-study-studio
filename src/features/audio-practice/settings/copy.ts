import type { Language } from "../../../core/shared/types";

const zh = {
	title: "听说练习",
	enabled: "启用听说练习",
	service: "字幕生成服务",
	workspace: "百炼 Workspace ID",
	workspaceHint: "使用北京地域的业务空间。",
	secret: "API Key 密钥",
	secretHint: "选择 Obsidian 密钥库中的百炼 API Key；密钥本身不写入插件数据。",
	serviceHint:
		"生成时将音频发送到阿里云百炼（Fun-ASR-Flash），按服务用量收费。原文在本地匹配。支持不超过 10 分钟、50 MiB 的英语音频。",
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
	workspace: "Model Studio Workspace ID",
	workspaceHint: "Use a workspace in the Beijing region.",
	secret: "API key secret",
	secretHint:
		"Select a Model Studio API key from Obsidian Secret Storage. The key itself is not stored in plugin data.",
	serviceHint:
		"Generation sends audio to Alibaba Cloud Model Studio (Fun-ASR-Flash) and may incur usage charges. Reference text is matched locally. English audio: up to 10 minutes and 50 MiB.",
	error: "Unable to open listening practice.",
	missing: "File missing or not yet synced. Wait for sync or reconnect the file.",
	failed: "Operation failed. Please retry.",
	disabled: "Listening practice is disabled. Enable it in settings.",
	openSettings: "Open settings",
	saving: "Unable to save subtitles. Your review draft is preserved.",
	sourceChanged: "Audio or reference text has changed. Generate subtitles again before saving.",
};
export const audioSettingsCopy = (language: Language) => (language === "en" ? en : zh);
