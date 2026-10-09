import { describe, expect, it, vi } from "vite-plus/test";
import { RecordingSettingsAdapter } from "../../../settings/testing/recordingSettingsAdapter";
import { buildSelectionHelperSettingsViewModel } from "../viewModel";

describe("selection helper settings presentation", () => {
	it("presents the common settings and dispatches semantic actions", async () => {
		const actions = {
			setEnabled: vi.fn().mockResolvedValue(undefined),
			setModifier: vi.fn().mockResolvedValue(undefined),
			toggleDictionary: vi.fn().mockResolvedValue(undefined),
		};
		const adapter = new RecordingSettingsAdapter();
		adapter.install(
			buildSelectionHelperSettingsViewModel(
				{ enabled: true, modifier: "alt", selectedDictionaries: ["local"] },
				[{ id: "local", label: "Local" }],
				actions,
				"zh",
			),
		);

		const group = adapter.snapshot().groups[0]!;
		expect(group.heading).toBe("划词助手");
		expect(group.rows.map((row) => row.name)).toEqual([
			"启用划词快捷浮窗",
			"触发修饰键",
			"网页划词兼容状态",
			"划词展示字典",
			"Local",
		]);
		const toggle = group.rows[4]!.controls[0];
		if (toggle?.kind !== "toggle") throw new Error("Expected toggle");
		expect(await adapter.dispatch(toggle.action, false)).toEqual({ status: "applied" });
		expect(actions.toggleDictionary).toHaveBeenCalledWith("local", false);
	});

	it.each(["idle", "available", "unavailable", "mobile"] as const)(
		"shows actionable %s web compatibility status",
		(status) => {
			const presentation = buildSelectionHelperSettingsViewModel(
				{ enabled: true, modifier: "none", selectedDictionaries: [] },
				[],
				{ setEnabled: vi.fn(), setModifier: vi.fn(), toggleDictionary: vi.fn() },
				"zh",
				status,
			);
			const row = presentation.snapshot.groups[0]?.rows.find(
				(row) => row.name === "网页划词兼容状态",
			);
			expect(JSON.stringify(row)).toContain("粘贴到翻译页面");
			if (status === "available")
				expect(JSON.stringify(row)).toContain("具体页面仍可能不兼容");
		},
	);

	it("omits dictionary rows when no dictionary adapter is available", () => {
		const presentation = buildSelectionHelperSettingsViewModel(
			{ enabled: false, modifier: "none", selectedDictionaries: [] },
			[],
			{
				setEnabled: vi.fn().mockResolvedValue(undefined),
				setModifier: vi.fn().mockResolvedValue(undefined),
				toggleDictionary: vi.fn().mockResolvedValue(undefined),
			},
			"en",
		);
		expect(presentation.snapshot.groups[0]?.rows).toHaveLength(3);
	});
});
