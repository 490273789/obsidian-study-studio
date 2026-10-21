import type { Language } from "../../../core/shared/types";

const zh = {
	title: "AI 翻译",
	selectionCommand: "翻译选区",
	openFailed: "无法打开翻译视图，请重试。",
	modelCount: "已启用 {count} 个方案",
	openSettings: "打开翻译设置",
	direction: "翻译方向",
	chinese: "中文",
	english: "英文",
	swapDirection: "反转翻译方向",
	disabled: "AI 翻译尚未启用，请前往设置开启。",
	noProfiles: "请先在设置中启用至少一个翻译方案。",
	inputLabel: "原文",
	outputLabel: "译文",
	inputPlaceholder: "输入或粘贴需要翻译的内容…",
	outputPlaceholder: "译文将显示在这里",
	characterCount: "{count} 个字符",
	translate: "翻译",
	translating: "正在翻译…",
	clear: "清空",
	copied: "已复制",
	copyFailed: "复制失败，请手动复制。",
	shortcutHint: "Ctrl/Cmd + Enter 翻译",
	usage: "输入 {input} · 输出 {output} Token",
	resultLabel: "{name} 的译文",
	deepseek: "DeepSeek",
	bailian: "阿里云百炼",
	youdao: "有道智云",
	unavailable: "未配置",
	loadingProfiles: "正在请求 {count} 个方案…",
	completedProfiles: "已完成 {count} 个方案。",
	partialProfiles: "已完成 {success}/{total} 个方案，{failed} 个失败。",
	failedProfiles: "所有翻译方案都失败了。",
};

const en: typeof zh = {
	title: "AI translation",
	selectionCommand: "Translate selection",
	openFailed: "Unable to open the translation view. Please try again.",
	modelCount: "{count} enabled",
	openSettings: "Open translation settings",
	direction: "Translation direction",
	chinese: "Chinese",
	english: "English",
	swapDirection: "Reverse translation direction",
	disabled: "AI translation is disabled. Enable it in Settings.",
	noProfiles: "Enable at least one translation profile in Settings.",
	inputLabel: "Source text",
	outputLabel: "Translations",
	inputPlaceholder: "Type or paste text to translate…",
	outputPlaceholder: "Translation will appear here",
	characterCount: "{count} characters",
	translate: "Translate",
	translating: "Translating…",
	clear: "Clear",
	copied: "Copied",
	copyFailed: "Could not copy. Please copy it manually.",
	shortcutHint: "Ctrl/Cmd + Enter to translate",
	usage: "Input {input} · Output {output} tokens",
	resultLabel: "Translation from {name}",
	deepseek: "DeepSeek",
	bailian: "Alibaba Cloud Model Studio",
	youdao: "Youdao Zhiyun",
	unavailable: "Not configured",
	loadingProfiles: "Requesting {count} profiles…",
	completedProfiles: "Completed {count} profiles.",
	partialProfiles: "Completed {success}/{total} profiles; {failed} failed.",
	failedProfiles: "All translation profiles failed.",
};

export function translationStrings(language: Language): typeof zh {
	return language === "en" ? en : zh;
}

export function formatTranslationString(
	value: string,
	variables: Record<string, string | number> = {},
): string {
	return Object.entries(variables).reduce(
		(formatted, [name, replacement]) => formatted.split(`{${name}}`).join(String(replacement)),
		value,
	);
}
