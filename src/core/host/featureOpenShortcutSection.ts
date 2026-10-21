import { Notice } from "obsidian";
import { defineSettings, type SettingsPresentation } from "../settings/presentation";
import {
	conflictingFeatureOpenShortcut,
	DEFAULT_FEATURE_OPEN_SHORTCUTS,
	FEATURE_OPEN_SHORTCUT_KEYS,
	normalizeFeatureOpenShortcut,
	type FeatureOpenShortcutKey,
	type FeatureOpenShortcuts,
} from "../settings/featureOpenShortcuts";
import type { Language } from "../shared/types";
import type { WorkbenchSettingsSection } from "./workbench";

export const FEATURE_OPEN_SHORTCUT_SECTION_ID = "feature-open-shortcuts";

interface FeatureOpenShortcutSectionOptions {
	read(): FeatureOpenShortcuts;
	update(shortcuts: FeatureOpenShortcuts): Promise<void>;
	refresh(): void;
}

const NAMES: Record<Language, Record<FeatureOpenShortcutKey, string>> = {
	zh: {
		selectionHelper: "查词助手",
		videoPlayer: "本地视频",
		dictionary: "英语词典",
		flashcards: "闪卡学习",
		audioPractice: "听说练习",
	},
	en: {
		selectionHelper: "Lookup assistant",
		videoPlayer: "Local video",
		dictionary: "English dictionary",
		flashcards: "Flashcards",
		audioPractice: "Listening and speaking",
	},
};

export function createFeatureOpenShortcutSection(
	options: FeatureOpenShortcutSectionOptions,
): WorkbenchSettingsSection {
	let saving = false;
	let language: Language = "zh";

	const change = async (key: FeatureOpenShortcutKey, value: string): Promise<void> => {
		if (saving) return;
		const shortcut = normalizeFeatureOpenShortcut(value);
		if (shortcut === null) {
			new Notice(
				language === "zh"
					? "快捷键需包含 Ctrl、Option/Alt 或 Command，且不能使用 Esc。"
					: "Shortcut needs Ctrl, Alt, or Command and cannot use Esc.",
			);
			return;
		}
		const current = options.read();
		const conflict = conflictingFeatureOpenShortcut(current, key, shortcut);
		if (conflict) {
			new Notice(
				language === "zh"
					? `此快捷键已用于${NAMES.zh[conflict]}。`
					: `This shortcut is already used by ${NAMES.en[conflict]}.`,
			);
			return;
		}
		if (current[key] === shortcut) return;
		saving = true;
		options.refresh();
		try {
			await options.update({ ...current, [key]: shortcut });
		} finally {
			saving = false;
			options.refresh();
		}
	};

	const presentation = (nextLanguage: Language): SettingsPresentation => {
		language = nextLanguage;
		const shortcuts = options.read();
		const names = NAMES[nextLanguage];
		return defineSettings(FEATURE_OPEN_SHORTCUT_SECTION_ID, (page) => {
			page.group("open", nextLanguage === "zh" ? "打开功能" : "Open features", (group) => {
				group.row("priority", {
					name: nextLanguage === "zh" ? "快捷键优先级" : "Shortcut priority",
					description:
						nextLanguage === "zh"
							? "这里设置命令的默认组合；Obsidian「快捷键」中自定义的组合优先。其他插件或核心命令的冲突请在 Obsidian「快捷键」中处理。"
							: "These are command defaults. Custom bindings in Obsidian Hotkeys take priority. Manage conflicts with other commands there.",
				});
				for (const key of FEATURE_OPEN_SHORTCUT_KEYS) {
					const others = FEATURE_OPEN_SHORTCUT_KEYS.filter(
						(other) => other !== key && shortcuts[other],
					);
					const conflictMessages = Object.fromEntries(
						others.map((other) => [
							shortcuts[other],
							nextLanguage === "zh"
								? `此快捷键已用于${names[other]}。`
								: `Already used by ${names[other]}.`,
						]),
					);
					group.row(key, { name: names[key] }, (row) => {
						row.keybinding("binding", {
							value: shortcuts[key],
							disabled: saving,
							emptyLabel: nextLanguage === "zh" ? "未分配" : "Unassigned",
							recordingLabel:
								nextLanguage === "zh" ? "请按快捷键…" : "Press shortcut…",
							conflictMessage:
								nextLanguage === "zh"
									? "此快捷键已被占用。"
									: "Shortcut already assigned.",
							unavailableValues: others.map((other) => shortcuts[other]),
							conflictMessages,
							onChange: (value) => change(key, value),
						});
						row.button("clear", {
							label: nextLanguage === "zh" ? "清除" : "Clear",
							disabled: saving || shortcuts[key] === "",
							onPress: () => change(key, ""),
						});
						row.button("reset", {
							label: nextLanguage === "zh" ? "恢复默认" : "Reset",
							disabled:
								saving || shortcuts[key] === DEFAULT_FEATURE_OPEN_SHORTCUTS[key],
							onPress: () => change(key, DEFAULT_FEATURE_OPEN_SHORTCUTS[key]),
						});
					});
				}
			});
		});
	};

	return {
		id: FEATURE_OPEN_SHORTCUT_SECTION_ID,
		order: 1.5,
		label: (nextLanguage) => (nextLanguage === "zh" ? "功能快捷键" : "Feature shortcuts"),
		presentation,
	};
}
