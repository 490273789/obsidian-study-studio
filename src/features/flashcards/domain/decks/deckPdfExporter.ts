import { Component, MarkdownRenderer, type App } from "obsidian";
import type { Deck } from "../../../../core/shared/types";
import {
	DECK_PDF_RENDER_BATCH_SIZE,
	appendPrintableCell,
	createPdfDocumentHtml,
	createPrintableDeck,
	ensurePdfExtension,
	getDeckPdfFileStem,
	getDeckPdfRows,
	type DeckPdfExportLabels,
} from "./deckPdfViewModel";
import {
	getDesktopPdfRuntime,
	waitForPrintAssets,
	yieldToUi,
	type DesktopPdfRuntime,
	type ElectronBrowserWindow,
} from "./deckPdfDesktopRuntime";

export type { DeckPdfExportLabels } from "./deckPdfViewModel";
export { DECK_PDF_PRINT_STYLES } from "./deckPdfViewModel";

export interface DeckPdfExportProgress {
	phase: "rendering" | "generating";
	completed: number;
	total: number;
}

interface DeckPdfExportOptions {
	onProgress?: (progress: DeckPdfExportProgress) => void;
	runtime?: DesktopPdfRuntime;
}

export type DeckPdfExportResult = { kind: "saved"; filePath: string } | { kind: "cancelled" };

export async function exportDeckToPdf(
	app: App,
	deck: Deck,
	labels: DeckPdfExportLabels,
	options: DeckPdfExportOptions = {},
): Promise<DeckPdfExportResult> {
	const sourceDocument = activeDocument;
	const desktopRuntime = options.runtime ?? getDesktopPdfRuntime(sourceDocument);
	const saveResult = await desktopRuntime.dialog.showSaveDialog(desktopRuntime.browserWindow, {
		title: labels.saveDialogTitle,
		defaultPath: `${getDeckPdfFileStem(deck.name)}.pdf`,
		filters: [{ name: "PDF", extensions: ["pdf"] }],
		properties: ["createDirectory", "showOverwriteConfirmation"],
	});
	if (saveResult.canceled || !saveResult.filePath) {
		return { kind: "cancelled" };
	}

	const component = new Component();
	const printableDeck = createPrintableDeck(sourceDocument, deck, labels);
	let pdfWindow: ElectronBrowserWindow | null = null;
	let temporaryDirectory: string | null = null;

	try {
		component.load();
		options.onProgress?.({
			phase: "rendering",
			completed: 0,
			total: deck.cards.length,
		});
		await yieldToUi(sourceDocument.defaultView);
		await renderDeckRows(
			app,
			deck,
			printableDeck.tableBody,
			component,
			sourceDocument.defaultView,
			options.onProgress,
		);

		options.onProgress?.({
			phase: "generating",
			completed: deck.cards.length,
			total: deck.cards.length,
		});
		await yieldToUi(sourceDocument.defaultView);

		temporaryDirectory = await desktopRuntime.createTemporaryDirectory();
		const htmlFilePath = desktopRuntime.joinPath(temporaryDirectory, "deck.html");
		await desktopRuntime.writeFile(
			htmlFilePath,
			createPdfDocumentHtml(deck.name, sourceDocument.baseURI, printableDeck.root.outerHTML),
		);

		pdfWindow = desktopRuntime.createBackgroundWindow();
		pdfWindow.webContents.setBackgroundThrottling(false);
		await pdfWindow.loadFile(htmlFilePath);
		await waitForPrintAssets(pdfWindow);
		const pdfData = await pdfWindow.webContents.printToPDF({
			displayHeaderFooter: false,
			landscape: false,
			pageSize: "A4",
			preferCSSPageSize: true,
			printBackground: true,
		});
		const filePath = ensurePdfExtension(saveResult.filePath);
		await desktopRuntime.writeFile(filePath, pdfData);
		return { kind: "saved", filePath };
	} finally {
		component.unload();
		printableDeck.root.remove();
		if (pdfWindow && !pdfWindow.isDestroyed()) {
			pdfWindow.destroy();
		}
		if (temporaryDirectory) {
			await desktopRuntime
				.removeTemporaryDirectory(temporaryDirectory)
				.catch(() => undefined);
		}
	}
}

async function renderDeckRows(
	app: App,
	deck: Deck,
	tableBody: HTMLTableSectionElement,
	component: Component,
	sourceWindow: Window | null,
	onProgress: DeckPdfExportOptions["onProgress"],
): Promise<void> {
	const rows = getDeckPdfRows(deck);
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (!row) {
			throw new Error(`Card ${index + 1} could not be rendered`);
		}

		const rowElement = tableBody.ownerDocument.createElement("tr");
		const front = appendPrintableCell(rowElement);
		const back = appendPrintableCell(rowElement);
		tableBody.appendChild(rowElement);
		await MarkdownRenderer.render(app, row.front, front, deck.filePath, component);
		await MarkdownRenderer.render(app, row.back, back, deck.filePath, component);

		const completed = index + 1;
		if (completed % DECK_PDF_RENDER_BATCH_SIZE === 0 || completed === rows.length) {
			onProgress?.({
				phase: "rendering",
				completed,
				total: rows.length,
			});
			await yieldToUi(sourceWindow);
		}
	}
}
