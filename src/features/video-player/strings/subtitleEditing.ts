import type { Language } from "../../../core/shared/types";

const copy = {
	zh: {
		saving: "正在保存…",
		conflict: "这条字幕已变化，修正草稿已保留。请重新载入后再修正。",
		deleted: "这条字幕已被删除。你可以复制保留的草稿。",
		deletedDrafts: "查看已删除字幕的草稿",
		discardDraft: "丢弃此草稿",
		copyOriginal: "复制原文",
		copyTranslation: "复制译文",
		copied: "已复制。",
		copyFailed: "复制失败。你可以选中文本后手动复制。",
		saveFailed: (reason: string) => `字幕修正未保存：${reason}`,
		reload: "重新载入这条字幕",
		reloadTitle: "放弃这条字幕的未保存修正？",
		reloadMessage: "如果找到最新字幕，它会替换这条草稿。若字幕已删除，草稿会保留供复制。",
		reloadConfirm: "放弃草稿并重新载入",
		cancel: "取消",
		statusFailure: (reason: string) => `字幕任务状态更新失败：${reason}`,
	},
	en: {
		saving: "Saving…",
		conflict: "This subtitle has changed. Your draft is kept. Reload it before editing again.",
		deleted: "This subtitle was deleted. You can copy the retained draft.",
		deletedDrafts: "View drafts for deleted subtitles",
		discardDraft: "Discard this draft",
		copyOriginal: "Copy original",
		copyTranslation: "Copy translation",
		copied: "Copied.",
		copyFailed: "Could not copy. You can select and copy the text manually.",
		saveFailed: (reason: string) => `Subtitle correction was not saved: ${reason}`,
		reload: "Reload this subtitle",
		reloadTitle: "Discard this subtitle correction?",
		reloadMessage:
			"If the subtitle is found, its latest version will replace this draft. If it was deleted, you can still copy the draft.",
		reloadConfirm: "Discard draft and reload",
		cancel: "Cancel",
		statusFailure: (reason: string) => `Subtitle task status could not be updated: ${reason}`,
	},
};

export function subtitleEditingStrings(language: Language) {
	return copy[language];
}
