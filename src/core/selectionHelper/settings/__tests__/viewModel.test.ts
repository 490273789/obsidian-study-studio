import { describe, expect, it, vi } from "vite-plus/test";
import { RecordingSettingsAdapter } from "../../../settings/testing/recordingSettingsAdapter";
import { buildSelectionHelperSettingsViewModel } from "../viewModel";

describe("selection helper settings presentation", () => {
	it("presents saved popup order, appends new dictionaries and keeps selection independent", async () => {
		const moveDictionary = vi.fn().mockResolvedValue(undefined);
		const presentation = buildSelectionHelperSettingsViewModel(
			{
				enabled: true,
				modifier: "none",
				selectedDictionaries: ["a"],
				dictionaryOrder: ["b", "missing", "a", "b"],
			},
			["a", "b", "new"].map((id) => ({ id, label: id })),
			{
				setEnabled: vi.fn(),
				setModifier: vi.fn(),
				toggleDictionary: vi.fn(),
				moveDictionary,
			},
			"zh",
		);
		const list = presentation.snapshot.groups[0]!.rows[3]!.controls[0];
		if (list?.kind !== "reorderable") throw new Error("Expected reorderable list");
		expect(list.allowDrag).toBe(true);
		expect(list.items.map(({ id, enabled }) => ({ id, enabled }))).toEqual([
			{ id: "b", enabled: false },
			{ id: "a", enabled: true },
			{ id: "new", enabled: false },
		]);
		await presentation.invoke({ action: list.moveAction, value: { fromIndex: 0, toIndex: 2 } });
		expect(moveDictionary).toHaveBeenCalledExactlyOnceWith(0, 2);
	});

	it("presents the common settings and dispatches semantic actions", async () => {
		const actions = {
			setEnabled: vi.fn().mockResolvedValue(undefined),
			setModifier: vi.fn().mockResolvedValue(undefined),
			moveDictionary: vi.fn().mockResolvedValue(undefined),
			toggleDictionary: vi.fn().mockResolvedValue(undefined),
		};
		const adapter = new RecordingSettingsAdapter();
		adapter.install(
			buildSelectionHelperSettingsViewModel(
				{
					enabled: true,
					modifier: "alt",
					dictionaryOrder: [],
					selectedDictionaries: ["local"],
				},
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
		]);
		const list = group.rows[3]!.controls[0];
		if (list?.kind !== "reorderable") throw new Error("Expected reorderable list");
		expect(await adapter.dispatch(list.items[0]!.toggleAction, false)).toEqual({
			status: "applied",
		});
		expect(actions.toggleDictionary).toHaveBeenCalledWith("local", false);
	});

	it.each(["idle", "available", "unavailable", "mobile"] as const)(
		"shows actionable %s web compatibility status",
		(status) => {
			const presentation = buildSelectionHelperSettingsViewModel(
				{ enabled: true, modifier: "none", dictionaryOrder: [], selectedDictionaries: [] },
				[],
				{
					setEnabled: vi.fn(),
					setModifier: vi.fn(),
					moveDictionary: vi.fn().mockResolvedValue(undefined),
					toggleDictionary: vi.fn(),
				},
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
			{ enabled: false, modifier: "none", dictionaryOrder: [], selectedDictionaries: [] },
			[],
			{
				setEnabled: vi.fn().mockResolvedValue(undefined),
				setModifier: vi.fn().mockResolvedValue(undefined),
				moveDictionary: vi.fn().mockResolvedValue(undefined),
				toggleDictionary: vi.fn().mockResolvedValue(undefined),
			},
			"en",
		);
		expect(presentation.snapshot.groups[0]?.rows).toHaveLength(3);
	});
});
