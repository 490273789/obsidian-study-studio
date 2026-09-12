import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { translationStrings } from "../strings/translation";
import { translationSettingsStrings } from "../strings/settings";
import { Notice } from "obsidian";
import { createTranslationFeature } from "../feature";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: vi.fn(),
	requestUrl: vi.fn(),
}));

const runtimeSpies = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("../domain/translationRuntime", () => ({
	TranslationRuntime: class {
		readonly prefill = vi.fn();
		readonly dispose = vi.fn();
		readonly subscribe = vi.fn(() => () => {});
		readonly configure = vi.fn();
		readonly translate = vi.fn();
		readonly testYoudao = vi.fn();
		readonly getSnapshot = () => ({
			settings: {
				enabled: true,
				direction: "zh-en",
				promptTemplate: "",
				profiles: [],
			},
			input: "",
			results: [],
			status: "idle",
			saving: false,
			testing: false,
		});
		constructor() {
			runtimeSpies.instances.push(this);
		}
	},
}));

const enabledSettings = {
	...DEFAULT_SETTINGS,
	translation: { ...DEFAULT_SETTINGS.translation, enabled: true },
};

function lastRuntime(): { prefill: { mock: { calls: unknown[] } } } {
	return runtimeSpies.instances[runtimeSpies.instances.length - 1] as never;
}

describe("translation feature", () => {
	beforeEach(() => {
		runtimeSpies.instances.length = 0;
		vi.mocked(Notice).mockClear();
	});

	it("registers its view, its chrome, and its settings section", () => {
		const feature = createTranslationFeature({ ai: {} as never, net: {} as never });
		const fake = createFakeWorkbenchHost("translation", enabledSettings);

		feature.render(fake.host);

		expect([...fake.views.keys()]).toEqual(["flashcard-translator-view"]);
		const entry = fake.catalog.get("translation")!;
		expect(entry.icon).toBe("languages");
		expect(entry.title("zh")).toBe(translationStrings("zh").title);
		expect(entry.openCommandId).toBe("open-ai-translator");
		expect(entry.openHotkeys).toEqual([{ modifiers: ["Alt"], key: "3" }]);
		expect(entry.settingsSectionId).toBe("translation");
		expect(entry.available()).toBe(true);
		// The open command belongs to the workbench; only the feature-specific
		// command is registered here.
		expect(fake.commands.map((command) => command.id)).toEqual(["translate-selection"]);
		expect(fake.ribbons).toEqual([]);
		expect(fake.sections.get("translation")!.order).toBe(2);
		expect(fake.sections.get("translation")!.label("zh")).toBe(
			translationSettingsStrings("zh").heading,
		);

		feature.stop();
	});

	it("adds no chrome while translation is disabled", () => {
		const feature = createTranslationFeature({ ai: {} as never, net: {} as never });
		const fake = createFakeWorkbenchHost("translation", {
			...DEFAULT_SETTINGS,
			translation: { ...DEFAULT_SETTINGS.translation, enabled: false },
		});

		feature.render(fake.host);

		expect(fake.ribbons).toEqual([]);
		expect(fake.commands).toEqual([]);
		expect(fake.catalog.get("translation")!.available()).toBe(false);
		expect([...fake.views.keys()]).toEqual(["flashcard-translator-view"]);

		feature.stop();
	});

	it("only prefills the selection, without translating or touching the note", () => {
		const feature = createTranslationFeature({ ai: {} as never, net: {} as never });
		const fake = createFakeWorkbenchHost("translation", enabledSettings);
		feature.render(fake.host);

		const command = fake.commands.find((entry) => entry.id === "translate-selection")!;
		expect(command.selection).toBeDefined();
		command.selection!.run("selected text");

		expect(lastRuntime().prefill.mock.calls).toEqual([["selected text"]]);
		expect(fake.activateView).toHaveBeenCalledWith("flashcard-translator-view");

		feature.stop();
	});

	it("adapts 选区助手 translation to direction, prefill, and main-tab activation", async () => {
		const feature = createTranslationFeature({ ai: {} as never, net: {} as never });
		const fake = createFakeWorkbenchHost("translation", enabledSettings);
		feature.render(fake.host);

		await feature.selectionAdapter.openPrefilled("selected text");

		const runtime = runtimeSpies.instances[runtimeSpies.instances.length - 1] as {
			configure: ReturnType<typeof vi.fn>;
			prefill: ReturnType<typeof vi.fn>;
			translate: ReturnType<typeof vi.fn>;
		};
		expect(runtime.configure).toHaveBeenCalledWith(
			expect.objectContaining({ direction: "en-zh" }),
		);
		expect(runtime.prefill).toHaveBeenCalledWith("selected text");
		expect(runtime.translate).not.toHaveBeenCalled();
		expect(fake.activateView).toHaveBeenCalledWith("flashcard-translator-view", {
			mainTab: true,
		});

		feature.stop();
	});

	it("reports a view open failure without rejecting", async () => {
		const feature = createTranslationFeature({ ai: {} as never, net: {} as never });
		const fake = createFakeWorkbenchHost("translation", enabledSettings);
		fake.activateView.mockRejectedValue(new Error("private diagnostic"));
		feature.render(fake.host);

		// The workbench generates the open command from the catalog entry.
		const entry = fake.catalog.get("translation")!;
		expect(() => entry.open()).not.toThrow();
		await vi.waitFor(() => {
			expect(Notice).toHaveBeenLastCalledWith(translationStrings("zh").openFailed);
		});

		feature.stop();
	});

	it("builds one runtime and disposes it on stop", () => {
		const feature = createTranslationFeature({ ai: {} as never, net: {} as never });
		const fake = createFakeWorkbenchHost("translation", enabledSettings);

		feature.render(fake.host);
		feature.render(fake.host);
		expect(runtimeSpies.instances).toHaveLength(1);

		feature.stop();
		expect(
			(runtimeSpies.instances[0] as { dispose: { mock: { calls: unknown[] } } }).dispose.mock
				.calls,
		).toHaveLength(1);
	});
});
