import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { dictionaryStrings } from "../strings/dictionary";
import { createDictionaryFeature } from "../feature";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: class {},
	Platform: { isDesktopApp: false },
	requestUrl: vi.fn(),
}));

const runtimeSpies = vi.hoisted(() => ({ instances: [] as unknown[] }));

vi.mock("../domain/dictionaryRuntime", () => ({
	DictionaryRuntime: class {
		readonly query = {
			getSnapshot: vi.fn(),
			subscribe: vi.fn(() => () => {}),
			send: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn(),
		};
		readonly favoriteController = { prefill: vi.fn(), resetSession: vi.fn() };
		readonly dispose = vi.fn();
		readonly applySettings = vi.fn();
		constructor(readonly options?: { net: unknown }) {
			runtimeSpies.instances.push(this);
		}
	},
}));

vi.mock("../obsidian/modals", () => ({
	DictionaryLookupModal: class {
		open() {}
		close() {}
	},
}));

const enabledSettings = {
	...DEFAULT_SETTINGS,
	dictionary: { ...DEFAULT_SETTINGS.dictionary, enabled: true },
};

describe("dictionary feature", () => {
	beforeEach(() => {
		runtimeSpies.instances.length = 0;
	});

	it("registers its two views, its chrome, and its settings section", () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings);

		feature.render(fake.host);

		expect([...fake.views.keys()]).toEqual([
			"flashcard-dictionary-view",
			"flashcard-dictionary-favorite-view",
		]);
		const entry = fake.catalog.get("dictionary")!;
		expect(entry.icon).toBe("book-open");
		expect(entry.title("zh")).toBe(dictionaryStrings("zh").displayName);
		expect(entry.openCommandId).toBe("open-dictionary");
		expect(entry.openHotkeys).toEqual([{ modifiers: ["Alt"], key: "2" }]);
		expect(entry.settingsSectionId).toBe("dictionary");
		expect(entry.available()).toBe(true);
		expect(fake.commands.map((command) => command.id)).toEqual(["dictionary-lookup-selection"]);
		expect(fake.ribbons).toEqual([]);
		expect([...fake.sections.keys()]).toEqual(["dictionary"]);
		// The section keeps the historical position after the AI 翻译 section.
		expect(fake.sections.get("dictionary")!.order).toBe(3);
		expect(fake.sections.get("dictionary")!.label("zh")).toBe(
			dictionaryStrings("zh").settingsHeading,
		);

		feature.stop();
	});

	it("keeps its views and settings section but adds no chrome while disabled", () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", {
			...DEFAULT_SETTINGS,
			dictionary: { ...DEFAULT_SETTINGS.dictionary, enabled: false },
		});

		feature.render(fake.host);

		expect(fake.ribbons).toEqual([]);
		expect(fake.commands).toEqual([]);
		expect(fake.catalog.get("dictionary")!.available()).toBe(false);
		expect([...fake.views.keys()]).toHaveLength(2);
		expect([...fake.sections.keys()]).toEqual(["dictionary"]);

		feature.stop();
	});

	it("builds one runtime, applies settings on every render, and disposes it on stop", () => {
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: {} as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings);

		feature.render(fake.host);
		feature.render(fake.host);

		expect(runtimeSpies.instances).toHaveLength(1);
		const runtime = runtimeSpies.instances[0] as {
			applySettings: { mock: { calls: unknown[] } };
			dispose: { mock: { calls: unknown[] } };
		};
		// Committed settings must reach the runtime on every render, the way the
		// composition root used to call applySettings() after publishing settings.
		expect(runtime.applySettings.mock.calls).toHaveLength(2);

		feature.stop();
		expect(runtime.dispose.mock.calls).toHaveLength(1);
	});

	it("passes the outbound port directly to the runtime", () => {
		const netRequest = vi.fn(async () => ({
			status: 200,
			text: JSON.stringify({ simple: { word: "test" } }),
			headers: { "content-type": "application/json" },
		}));
		const feature = createDictionaryFeature({
			ai: {} as never,
			net: { request: netRequest } as never,
			plugin: {} as never,
		});
		const fake = createFakeWorkbenchHost("dictionary", enabledSettings);
		feature.render(fake.host);

		const runtime = runtimeSpies.instances[0] as { options?: { net: unknown } };
		expect(runtime.options?.net).toEqual(expect.objectContaining({ request: netRequest }));

		feature.stop();
	});
});
