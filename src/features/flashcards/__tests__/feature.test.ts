import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../../core/host/settingsSlices";
import { createFlashcardFeature } from "../feature";
import { createFakeWorkbenchHost } from "../../../core/host/__tests__/fakeWorkbenchHost";

vi.mock("obsidian", () => ({
	ItemView: class {},
	Notice: vi.fn(),
	Platform: { isDesktopApp: true },
}));

const deep = vi.hoisted(() => ({
	deckHome: null as unknown,
	pronunciation: null as unknown,
}));

vi.mock("../domain/decks/deckHome", () => ({
	createDeckHome: vi.fn(() => {
		const home = {
			act: vi.fn(),
			subscribe: vi.fn(),
			getSnapshot: vi.fn(),
			dispose: vi.fn(),
		};
		deep.deckHome = home;
		return home;
	}),
}));

vi.mock("../domain/decks/deckPdfExporter", () => ({ exportDeckToPdf: vi.fn() }));

vi.mock("../domain/pronunciation", () => ({
	createPronunciationRuntime: vi.fn(() => {
		const runtime = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: () => ({
				revision: 0,
				settings: {
					spellingAutoPlay: false,
					accent: "system",
					rate: "normal",
					onlineProvider: "none",
					azureCloud: "china",
					azureRegion: "",
					azureSecretId: "",
					openaiSecretId: "",
				},
				management: "idle",
				hasLocalEnglishVoice: false,
				voicesLoaded: true,
				speakingText: null,
				cacheUsage: { status: "ready", bytes: 0 },
			}),
			configure: vi.fn(),
			testOnlineProvider: vi.fn(),
			clearCache: vi.fn(),
			refreshCacheUsage: vi.fn(),
			dispose: vi.fn(),
		};
		deep.pronunciation = runtime;
		return runtime;
	}),
}));

vi.mock("../domain/sessions/sessionLifecycle", () => ({
	createSessionLifecycle: vi.fn(() => ({
		lifecycle: { act: vi.fn(), subscribe: vi.fn(), getSnapshot: vi.fn() },
		continuitySessions: {},
	})),
	// The feature only passes the lifecycle through, so a stub type surface is enough.
	getRestartViewState: vi.fn(),
}));

vi.mock("../domain/identity/cardIdentityContinuity", () => ({
	createCardIdentityContinuity: vi.fn(() => ({
		inspect: () => ({ issues: [], migration: null }),
		synchronize: vi.fn(),
		resolve: vi.fn(),
		prepareEdit: vi.fn(),
	})),
}));

vi.mock("../domain/identity/cardIdentity", () => ({ createCardIdentity: vi.fn() }));

vi.mock("../obsidian/continuityAdapters", () => ({
	createObsidianContinuitySourceStore: vi.fn(),
}));

vi.mock("../obsidian/continuityModals", () => ({
	CardIdentityMigrationModal: class {
		open() {}
	},
	CardIdentityRepairModal: class {
		open() {}
	},
}));

function createRepository() {
	return {
		hasAvailableTagsSnapshot: () => true,
		getAvailableTags: () => ["#wordTag"],
		createContinuityStateStore: () => ({}),
	};
}

function renderFeature() {
	const feature = createFlashcardFeature({
		store: {
			load: vi.fn(),
			getSettings: () => DEFAULT_SETTINGS,
			subscribe: () => () => {},
		} as never,
		net: { request: vi.fn(), requestHostPinned: vi.fn(), readSecret: vi.fn() },
		repository: createRepository() as never,
	});
	const fake = createFakeWorkbenchHost("flashcards", DEFAULT_SETTINGS);
	feature.render(fake.host);
	return { feature, fake };
}

describe("flashcard feature", () => {
	beforeEach(() => {
		deep.deckHome = null;
		deep.pronunciation = null;
	});

	it("registers its view, catalog entry, commands, and settings section", () => {
		const { feature, fake } = renderFeature();

		expect([...fake.views.keys()]).toEqual(["flashcard-view"]);
		const entry = fake.catalog.get("flashcards")!;
		expect(entry.icon).toBe("layers");
		expect(entry.title("zh")).toBe("闪卡学习");
		expect(entry.openCommandId).toBe("open-flashcard-view");
		expect(entry.openHotkeys).toEqual([{ modifiers: ["Alt"], key: "1" }]);
		expect(entry.settingsSectionId).toBe("flashcards");
		expect(entry.available()).toBe(true);
		// The workbench owns the ribbon and the open command.
		expect(fake.ribbons).toEqual([]);
		expect(fake.commands.map((command) => command.id)).toEqual([
			"sync-flashcard-decks",
			"migrate-card-identities",
			"repair-card-identities",
		]);
		expect([...fake.sections.keys()]).toEqual(["flashcards"]);
		expect(fake.sections.get("flashcards")!.order).toBe(0);
		expect(fake.sections.get("flashcards")!.label("zh")).toBe("闪卡设置");

		feature.stop();
	});

	it("builds the flashcards settings presentation from committed settings", () => {
		const { feature, fake } = renderFeature();
		const section = fake.sections.get("flashcards")!;

		const presentation = section.presentation("zh");

		expect(presentation.snapshot.groups.length).toBeGreaterThan(0);
		expect(JSON.stringify(presentation.snapshot)).toContain("每日新卡");
		feature.stop();
	});

	it("subscribes to pronunciation feedback only while its section is active", () => {
		const { feature, fake } = renderFeature();
		const section = fake.sections.get("flashcards")!;

		section.activate?.();
		const pronunciation = deep.pronunciation as { subscribe: { mock: { calls: unknown[] } } };
		expect(pronunciation.subscribe.mock.calls).toHaveLength(1);

		// Repeated activation must not stack subscriptions.
		section.activate?.();
		expect(pronunciation.subscribe.mock.calls).toHaveLength(1);

		section.hide?.();
		feature.stop();
	});

	it("disposes its deep modules on stop", () => {
		const { feature } = renderFeature();
		const deckHome = deep.deckHome as { dispose: { mock: { calls: unknown[] } } };
		const pronunciation = deep.pronunciation as { dispose: { mock: { calls: unknown[] } } };

		feature.stop();

		expect(deckHome.dispose.mock.calls).toHaveLength(1);
		expect(pronunciation.dispose.mock.calls).toHaveLength(1);
	});
});
