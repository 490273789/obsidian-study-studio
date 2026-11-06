import type { Language } from "../../../core/shared/types";

const copy = {
	zh: {
		saving: "正在保存…",
		conflict: "这条字幕已变化，修正草稿已保留。请重新载入后再修正。",
		saveFailed: (reason: string) => `字幕修正未保存：${reason}`,
		reload: "重新载入这条字幕",
		reloadTitle: "放弃这条字幕的未保存修正？",
		reloadMessage: "将读取最新字幕并替换这条修正草稿，其他字幕的草稿会保留。",
		reloadConfirm: "放弃草稿并重新载入",
		cancel: "取消",
		detachedFailure: (reason: string) => `播放器已关闭，字幕修正保存失败：${reason}`,
		statusFailure: (reason: string) => `字幕任务状态更新失败：${reason}`,
	},
	en: {
		saving: "Saving…",
		conflict: "This subtitle has changed. Your draft is kept. Reload it before editing again.",
		saveFailed: (reason: string) => `Subtitle correction was not saved: ${reason}`,
		reload: "Reload this subtitle",
		reloadTitle: "Discard this subtitle correction?",
		reloadMessage:
			"The latest subtitle will replace this draft. Drafts for other subtitles will be kept.",
		reloadConfirm: "Discard draft and reload",
		cancel: "Cancel",
		detachedFailure: (reason: string) =>
			`The player was closed. Its subtitle correction could not be saved: ${reason}`,
		statusFailure: (reason: string) => `Subtitle task status could not be updated: ${reason}`,
	},
};

export function subtitleEditingStrings(language: Language) {
	return copy[language];
}
