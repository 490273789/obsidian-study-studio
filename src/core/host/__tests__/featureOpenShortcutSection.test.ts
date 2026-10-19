import { describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_FEATURE_OPEN_SHORTCUTS } from "../../settings/featureOpenShortcuts";
import { createFeatureOpenShortcutSection } from "../featureOpenShortcutSection";

const notices = vi.hoisted(() => vi.fn());
vi.mock("obsidian", () => ({
	Notice: class {
		constructor(message: string) {
			notices(message);
		}
	},
}));

describe("feature open shortcut settings", () => {
	it("records, clears and restores a binding while rejecting a duplicate", async () => {
		let shortcuts = { ...DEFAULT_FEATURE_OPEN_SHORTCUTS };
		const refresh = vi.fn();
		const update = vi.fn(async (next: typeof shortcuts) => {
			shortcuts = next;
		});
		const section = createFeatureOpenShortcutSection({
			read: () => shortcuts,
			update,
			refresh,
		});
		const first = section.presentation("zh");
		const row = first.snapshot.groups[0]!.rows.find((item) => item.key === "videoPlayer")!;
		const binding = row.controls.find((control) => control.kind === "keybinding")!;
		if (binding.kind !== "keybinding") throw new Error("Expected keybinding");
		expect(binding.conflictMessages?.["Alt+1"]).toContain("查词助手");
		expect(await first.invoke({ action: binding.action, value: "Alt+1" })).toEqual({
			status: "applied",
		});
		expect(update).not.toHaveBeenCalled();
		expect(notices).toHaveBeenCalledWith(expect.stringContaining("查词助手"));

		const second = section.presentation("zh");
		const secondBinding = second.snapshot.groups[0]!.rows.find(
			(item) => item.key === "videoPlayer",
		)!.controls[0]!;
		if (secondBinding.kind !== "keybinding") throw new Error("Expected keybinding");
		await second.invoke({ action: secondBinding.action, value: "Ctrl+V" });
		expect(shortcuts.videoPlayer).toBe("Ctrl+V");
		const clearPresentation = section.presentation("zh");
		const clear = clearPresentation.snapshot.groups[0]!.rows.find(
			(item) => item.key === "videoPlayer",
		)!.controls.filter((control) => control.kind === "button")[0]!;
		if (clear.kind !== "button") throw new Error("Expected button");
		await clearPresentation.invoke({ action: clear.action, value: undefined });
		expect(shortcuts.videoPlayer).toBe("");
		const resetPresentation = section.presentation("zh");
		const reset = resetPresentation.snapshot.groups[0]!.rows.find(
			(item) => item.key === "videoPlayer",
		)!.controls.filter((control) => control.kind === "button")[1]!;
		if (reset.kind !== "button") throw new Error("Expected button");
		await resetPresentation.invoke({ action: reset.action, value: undefined });
		expect(shortcuts.videoPlayer).toBe("Alt+2");
		expect(refresh).toHaveBeenCalled();
	});
});
