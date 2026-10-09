import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it, vi, beforeEach } from "vite-plus/test";
import type { App } from "obsidian";
import type { Deck } from "../../../../../core/shared/types";
import type { DesktopPdfRuntime, ElectronBrowserWindow } from "../deckPdfDesktopRuntime";
import { exportDeckToPdf, type DeckPdfExportProgress } from "../deckPdfExporter";

vi.mock("obsidian", () => ({
	Component: class {
		load() {}
		unload() {}
	},
	MarkdownRenderer: {
		render: vi.fn().mockResolvedValue(undefined),
	},
}));

function makeDeck(): Deck {
	return {
		id: "cards/词汇.md",
		name: "英语词汇",
		filePath: "cards/词汇.md",
		tag: "#英语",
		cards: [
			{
				id: "card-1",
				front: "apple",
				back: "苹果",
				fsrsCard: createEmptyCard(),
				sourceFile: "cards/词汇.md",
				indexInFile: 0,
			},
			{
				id: "card-2",
				front: "banana",
				back: "香蕉",
				fsrsCard: createEmptyCard(),
				sourceFile: "cards/词汇.md",
				indexInFile: 1,
			},
		],
		studyCount: 0,
		lastStudied: null,
	};
}

const mockLabels = {
	frontColumn: "正面",
	backColumn: "背面",
	cardCount: (n: number) => `共 ${n} 张`,
	saveDialogTitle: "导出 PDF",
};

describe("exportDeckToPdf", () => {
	function makeMockRuntime(overrides: Partial<DesktopPdfRuntime> = {}) {
		let isDestroyed = false;
		const writtenFiles: Record<string, string | Uint8Array> = {};
		const removedDirs: string[] = [];

		const mockWindow: ElectronBrowserWindow = {
			webContents: {
				executeJavaScript: vi.fn().mockResolvedValue(undefined),
				setBackgroundThrottling: vi.fn(),
				printToPDF: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
			},
			loadFile: vi.fn().mockResolvedValue(undefined),
			isDestroyed: () => isDestroyed,
			destroy: () => {
				isDestroyed = true;
			},
		};

		const runtime: DesktopPdfRuntime = {
			browserWindow: mockWindow,
			dialog: {
				showSaveDialog: vi.fn().mockResolvedValue({
					canceled: false,
					filePath: "/saved/deck.pdf",
				}),
			},
			createBackgroundWindow: vi.fn().mockReturnValue(mockWindow),
			createTemporaryDirectory: vi.fn().mockResolvedValue("/tmp/test-dir"),
			joinPath: (...parts) => parts.join("/"),
			removeTemporaryDirectory: vi.fn().mockImplementation(async (dir) => {
				removedDirs.push(dir);
			}),
			writeFile: vi.fn().mockImplementation(async (path, data) => {
				writtenFiles[path] = data;
			}),
			...overrides,
		};

		return { runtime, mockWindow, writtenFiles, removedDirs };
	}

	beforeEach(() => {
		// Mock global activeDocument for document.createElement in test environment
		if (typeof (globalThis as any).activeDocument === "undefined") {
			const fakeDoc = {
				baseURI: "app://obsidian/",
				defaultView: null,
				createElement: (tag: string) => {
					const el: any = {
						tagName: tag,
						className: "",
						textContent: "",
						children: [],
						appendChild: (child: any) => el.children.push(child),
						remove: vi.fn(),
						ownerDocument: null,
					};
					el.ownerDocument = fakeDoc;
					return el;
				},
			};
			(globalThis as any).activeDocument = fakeDoc;
		}
	});

	it("returns cancelled when user cancels the save dialog", async () => {
		const { runtime } = makeMockRuntime({
			dialog: {
				showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
			},
		});

		const result = await exportDeckToPdf({} as App, makeDeck(), mockLabels, {
			runtime,
		});

		expect(result).toEqual({ kind: "cancelled" });
		expect(runtime.createTemporaryDirectory).not.toHaveBeenCalled();
	});

	it("executes the full export pipeline, reports progress, and cleans up temp resources", async () => {
		const { runtime, mockWindow, writtenFiles, removedDirs } = makeMockRuntime();
		const progressUpdates: DeckPdfExportProgress[] = [];

		const result = await exportDeckToPdf({} as App, makeDeck(), mockLabels, {
			runtime,
			onProgress: (p) => progressUpdates.push(p),
		});

		expect(result).toEqual({ kind: "saved", filePath: "/saved/deck.pdf" });
		expect(writtenFiles["/saved/deck.pdf"]).toEqual(new Uint8Array([1, 2, 3]));
		expect(mockWindow.isDestroyed()).toBe(true);
		expect(removedDirs).toContain("/tmp/test-dir");
		expect(progressUpdates.length).toBeGreaterThan(0);
	});
});
