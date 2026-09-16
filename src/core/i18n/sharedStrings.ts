import type { Language } from "../shared/types";
import { createTranslatorFactory, type TranslationDictionary, type Translator } from "./translator";

/**
 * UI strings every part of the workbench may use: shared actions, host notices,
 * duration formatting, and the settings-tab labels.
 *
 * Feature copy lives with its feature; a feature dictionary is composed from this
 * one plus its own entries.
 */
export const sharedTranslations = {
	zh: {
		"main.ribbonOpenFlashcards": "打开闪卡",
		"main.commandOpenFlashcards": "打开闪卡学习",
		"main.commandSyncDecks": "同步闪卡题库",
		"main.commandMigrateCardIdentities": "迁移旧题库卡片身份",
		"main.commandRepairCardIdentities": "修复卡片身份冲突",
		"main.viewTitle": "闪卡学习",
		"notice.deckEmpty": "该题库没有卡片，请先添加内容",
		"notice.deckMissing": "题库不存在",
		"notice.deckSettingsSaveFailed": "题库设置保存失败：{message}",
		"notice.todayComplete": "今日学习任务已完成! 🎉",
		"notice.sourceMissing": "找不到源文件：{filePath}",
		"notice.noDecks": "暂无可添加题目的牌组",
		"notice.cardMissing": "题目不存在",
		"notice.cardSaved": "题目已保存",
		"notice.cardAdded": "题目已添加",
		"notice.cardDeleted": "题目已删除",
		"notice.cardSaveFailed": "保存失败：{message}",
		"notice.cardDeleteFailed": "删除失败：{message}",
		"notice.pdfExportSaved": "PDF 已保存到：{filePath}",
		"notice.pdfExportDesktopOnly": "导出 PDF 文件目前仅支持 Obsidian 桌面端",
		"notice.pdfExportRendering": "正在准备 PDF：{completed}/{total}，仍可继续使用 Obsidian",
		"notice.pdfExportGenerating": "正在后台生成 PDF，可继续使用 Obsidian",
		"notice.pdfExportFailed": "导出 PDF 失败：{message}",
		"notice.pdfExportUnknownError": "未知错误",
		"notice.viewRenderFailed": "界面渲染失败，请重新打开该视图；若仍失败请重载插件。",
		"common.back": "返回",
		"common.close": "关闭",
		"common.save": "保存",
		"common.confirm": "确认",
		"common.confirmAction": "请确认操作",
		"common.cancel": "取消",
		"common.all": "全部",
		"common.cards": "张卡片",
		"common.questions": "题",
		"common.space": "空格",
		"common.question": "问题",
		"common.answer": "答案",
		"common.cardFront": "正面",
		"common.cardBack": "背面",
		"common.explanation": "解释",
		"common.explanationOptional": "解释（可选）",
		"common.showAnswer": "显示答案",
		"common.undo": "上一题",
		"common.loading": "加载中...",
		"time.minute": "{count}分钟",
		"time.hour": "{count}小时",
		"time.day": "{count}天",
		"time.seconds": "{count}秒",
		"time.minutesSeconds": "{minutes}分{seconds}秒",
		"time.minutes": "{count}分钟",
		"time.hoursMinutes": "{hours}小时{minutes}分钟",
		"time.hours": "{count}小时",
		"settings.tabFlashcards": "闪卡设置",
		"settings.tabAi": "AI 引擎设置",
	},
	en: {
		"main.ribbonOpenFlashcards": "Open flashcards",
		"main.commandOpenFlashcards": "Open flashcard study",
		"main.commandSyncDecks": "Sync flashcard decks",
		"main.commandMigrateCardIdentities": "Migrate legacy card identities",
		"main.commandRepairCardIdentities": "Repair card identity conflicts",
		"main.viewTitle": "Flashcard Study",
		"notice.deckEmpty": "This deck has no cards. Add content first.",
		"notice.deckMissing": "Deck not found",
		"notice.deckSettingsSaveFailed": "Failed to save deck settings: {message}",
		"notice.todayComplete": "Today's study tasks are complete! 🎉",
		"notice.sourceMissing": "Source file not found: {filePath}",
		"notice.noDecks": "No available deck to add cards to",
		"notice.cardMissing": "Card not found",
		"notice.cardSaved": "Card saved",
		"notice.cardAdded": "Card added",
		"notice.cardDeleted": "Card deleted",
		"notice.cardSaveFailed": "Save failed: {message}",
		"notice.cardDeleteFailed": "Delete failed: {message}",
		"notice.pdfExportSaved": "PDF saved to: {filePath}",
		"notice.pdfExportDesktopOnly":
			"PDF file export is currently available in Obsidian desktop only",
		"notice.pdfExportRendering":
			"Preparing PDF: {completed}/{total}. You can keep using Obsidian.",
		"notice.pdfExportGenerating":
			"Generating PDF in the background. You can keep using Obsidian.",
		"notice.pdfExportFailed": "PDF export failed: {message}",
		"notice.pdfExportUnknownError": "Unknown error",
		"notice.viewRenderFailed":
			"This view failed to render. Reopen it, and reload the plugin if it still fails.",
		"common.back": "Back",
		"common.close": "Close",
		"common.save": "Save",
		"common.confirm": "Confirm",
		"common.confirmAction": "Confirm action",
		"common.cancel": "Cancel",
		"common.all": "All",
		"common.cards": "cards",
		"common.questions": "questions",
		"common.space": "Space",
		"common.question": "Question",
		"common.answer": "Answer",
		"common.cardFront": "Front",
		"common.cardBack": "Back",
		"common.explanation": "Explanation",
		"common.explanationOptional": "Explanation (optional)",
		"common.showAnswer": "Show Answer",
		"common.undo": "Undo",
		"common.loading": "Loading...",
		"time.minute": "{count} min",
		"time.hour": "{count} hr",
		"time.day": "{count} d",
		"time.seconds": "{count}s",
		"time.minutesSeconds": "{minutes}m {seconds}s",
		"time.minutes": "{count}m",
		"time.hoursMinutes": "{hours}h {minutes}m",
		"time.hours": "{count}h",
		"settings.tabFlashcards": "Flashcard Settings",
		"settings.tabAi": "AI Engine Settings",
	},
} satisfies TranslationDictionary;

export type SharedTranslationKey = keyof typeof sharedTranslations.zh;

const factory = createTranslatorFactory(sharedTranslations);

export const translateShared = factory.translate as (
	language: Language,
	key: SharedTranslationKey,
	vars?: Record<string, string | number>,
) => string;

/** Default translator for host-owned UI and for views without their own dictionary. */
export const createSharedTranslator = (language: Language): Translator =>
	factory.createTranslator(language);
