import type { Language } from "../../../core/shared/types";

export interface SelectionHelperStrings {
	webCompatibility: string;
	webStatus: Record<"idle" | "available" | "unavailable" | "mobile", string>;
	lookup: string;
	translate: string;
	openInMainTabHint: string;
	openInMainTab: string;
	close: string;
	details: string;
	renderFailed: string;
	emptyDefinition: string;
	loading: string;
	settingsHeading: string;
	enablePopup: string;
	enablePopupDesc: string;
	modifier: string;
	modifierDesc: string;
	modifierNone: string;
	modifierAlt: string;
	modifierShift: string;
	modifierCtrl: string;
	dictionaryDisabled: string;
	translationDisabled: string;
	dictSelectionHeading: string;
	dictSelectionDesc: string;
	noDictionariesAvailable: string;
	aiGenerate: string;
	aiGenerating: string;
	retry: string;
}

const ZH_STRINGS: SelectionHelperStrings = {
	webCompatibility: "网页划词兼容状态",
	webStatus: {
		idle: "尚未检测到可用的网页选区接口。请在桌面 Web viewer 打开网页；无法划词时，可复制文字并粘贴到翻译页面。",
		available:
			"已检测到网页采集接口；具体页面仍可能不兼容。无法划词时，可复制文字并粘贴到翻译页面。",
		unavailable: "部分网页无法接入划词助手。请复制文字并粘贴到翻译页面；普通页面划词不受影响。",
		mobile: "移动端支持应用内可选文字。无法接入的嵌入网页，请复制文字并粘贴到翻译页面。",
	},
	lookup: "查词",
	translate: "翻译",
	openInMainTabHint: "按 Enter 在主标签页打开",
	openInMainTab: "在词典主标签打开",
	close: "关闭",
	details: "词条章节",
	renderFailed: "词条显示失败，请重试或在词典主标签查看。",
	emptyDefinition: "未找到释义",
	loading: "正在查询...",
	settingsHeading: "划词助手",
	enablePopup: "启用划词快捷浮窗",
	enablePopupDesc:
		"在 Obsidian 页面、侧栏、弹窗和普通输入框中选中文字后，显示查词与翻译入口；移动端长按选中。",
	modifier: "触发修饰键",
	modifierDesc: "设置桌面鼠标划词所需的修饰键；移动端长按选中无需修饰键。",
	modifierNone: "无（直接划词抬起鼠标即触发）",
	modifierAlt: "Alt / Option",
	modifierShift: "Shift",
	modifierCtrl: "Ctrl / Command",
	dictionaryDisabled: "词典功能未开启，请先在词典设置中启用",
	translationDisabled: "AI 翻译未开启，请先在翻译设置中启用",
	dictSelectionHeading: "划词展示字典",
	dictSelectionDesc:
		"选择在划词浮窗中展示哪些字典。若全部勾选或全部未选，则默认展示所有已启用的字典。",
	noDictionariesAvailable: "暂无可用的字典源，请先在「词典」设置中启用至少一个字典。",
	aiGenerate: "生成 AI 释义",
	aiGenerating: "正在生成 AI 释义…",
	retry: "重试",
};

const EN_OVERRIDES: Partial<SelectionHelperStrings> = {
	webCompatibility: "Web selection compatibility",
	webStatus: {
		idle: "No web selection interface detected yet. Open a page in desktop Web viewer. If selection is unavailable, copy and paste text into Translation.",
		available:
			"Web capture interface detected; individual pages may still be incompatible. If unavailable, copy and paste text into Translation.",
		unavailable:
			"Some web pages cannot connect to the selection helper. Copy and paste text into Translation; ordinary page selection remains available.",
		mobile: "Mobile supports selectable text within the app. For inaccessible embedded pages, copy and paste text into Translation.",
	},
	lookup: "Lookup",
	translate: "Translate",
	openInMainTabHint: "Press Enter to open in main tab",
	openInMainTab: "Open in dictionary tab",
	close: "Close",
	details: "Entry sections",
	renderFailed: "Unable to display this entry. Retry or open it in the dictionary tab.",
	emptyDefinition: "No definitions found",
	loading: "Searching...",
	settingsHeading: "Selection Helper",
	enablePopup: "Enable selection popup",
	enablePopupDesc:
		"Show lookup and translation actions for selected text across Obsidian pages, sidebars, dialogs, and text fields. Long-press on mobile.",
	modifier: "Trigger modifier key",
	modifierDesc:
		"Require a modifier for desktop mouse selection. Mobile long-press does not require a modifier.",
	modifierNone: "None (Direct selection)",
	modifierAlt: "Alt / Option",
	modifierShift: "Shift",
	modifierCtrl: "Ctrl / Command",
	dictionaryDisabled: "Dictionary is disabled in settings",
	translationDisabled: "Translation is disabled in settings",
	dictSelectionHeading: "Popup Dictionaries",
	dictSelectionDesc:
		"Select which dictionaries to display in the selection popup. If none are explicitly selected, all enabled dictionaries will be shown.",
	noDictionariesAvailable:
		"No dictionary sources available. Please enable at least one dictionary in Dictionary settings.",
	aiGenerate: "Generate AI definitions",
	aiGenerating: "Generating AI definitions…",
	retry: "Retry",
};

export function selectionHelperStrings(language: Language): SelectionHelperStrings {
	if (language === "en") {
		return { ...ZH_STRINGS, ...EN_OVERRIDES };
	}
	return ZH_STRINGS;
}
