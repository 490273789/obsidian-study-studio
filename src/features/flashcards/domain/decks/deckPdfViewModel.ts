import type { Deck } from "../../../../core/shared/types";

interface DeckPdfRow {
	front: string;
	back: string;
}

export interface DeckPdfExportLabels {
	frontColumn: string;
	backColumn: string;
	cardCount: (count: number) => string;
	saveDialogTitle: string;
}

interface PrintableDeck {
	root: HTMLElement;
	tableBody: HTMLTableSectionElement;
}

export const DECK_PDF_RENDER_BATCH_SIZE = 12;

export const DECK_PDF_PRINT_STYLES = `
	@page {
		size: A4 portrait;
		margin: 14mm 12mm 16mm;
	}

	@media print {
		html,
		body {
			margin: 0 !important;
			background: #ffffff !important;
			color: #1f2937 !important;
			font-family:
				-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
				"Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC",
				"Noto Sans SC", sans-serif !important;
			font-size: 10.5pt !important;
			line-height: 1.4 !important;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}

		body.flashcard-pdf-exporting > :not(.flashcard-pdf-document) {
			display: none !important;
		}

		body.flashcard-pdf-exporting > .flashcard-pdf-document {
			display: block !important;
			position: static !important;
			width: auto !important;
			height: auto !important;
			overflow: visible !important;
		}

		.flashcard-pdf-document,
		.flashcard-pdf-document * {
			box-sizing: border-box;
		}

		.flashcard-pdf-header {
			display: flex;
			align-items: flex-end;
			justify-content: space-between;
			gap: 16px;
			margin: 0 0 8mm;
			padding-bottom: 4mm;
			border-bottom: 2px solid #334155;
		}

		.flashcard-pdf-title {
			margin: 0;
			color: #0f172a;
			font-size: 19pt;
			font-weight: 700;
			line-height: 1.25;
			overflow-wrap: anywhere;
		}

		.flashcard-pdf-meta {
			flex: 0 0 auto;
			color: #64748b;
			font-size: 9pt;
			white-space: nowrap;
		}

		.flashcard-pdf-table {
			width: 100%;
			table-layout: fixed;
			border-collapse: collapse;
		}

		.flashcard-pdf-table thead {
			display: table-header-group;
		}

		.flashcard-pdf-table tr {
			break-inside: avoid;
			page-break-inside: avoid;
		}

		.flashcard-pdf-table th,
		.flashcard-pdf-table td {
			width: 50%;
			border: 0.7pt solid #94a3b8;
			vertical-align: top;
			overflow-wrap: anywhere;
			word-break: break-word;
		}

		.flashcard-pdf-table th {
			padding: 2.2mm 3mm;
			background: #e2e8f0;
			color: #0f172a;
			font-size: 10pt;
			font-weight: 700;
			text-align: left;
		}

		.flashcard-pdf-table td {
			padding: 1.8mm 3mm;
			background: #ffffff;
		}

		.flashcard-pdf-table tbody tr:nth-child(even) td {
			background: #f8fafc;
		}

		.flashcard-pdf-content > :first-child {
			margin-top: 0;
		}

		.flashcard-pdf-content > :last-child {
			margin-bottom: 0;
		}

		.flashcard-pdf-content p,
		.flashcard-pdf-content ul,
		.flashcard-pdf-content ol,
		.flashcard-pdf-content blockquote,
		.flashcard-pdf-content pre,
		.flashcard-pdf-content table {
			margin-top: 0;
			margin-bottom: 0.35em;
		}

		.flashcard-pdf-content h1,
		.flashcard-pdf-content h2,
		.flashcard-pdf-content h3,
		.flashcard-pdf-content h4,
		.flashcard-pdf-content h5,
		.flashcard-pdf-content h6 {
			margin: 0 0 0.3em;
			color: #0f172a;
			font-size: 1em;
			line-height: 1.3;
		}

		.flashcard-pdf-content img,
		.flashcard-pdf-content svg,
		.flashcard-pdf-content canvas {
			max-width: 100%;
			height: auto;
		}

		.flashcard-pdf-content pre,
		.flashcard-pdf-content code {
			white-space: pre-wrap;
			overflow-wrap: anywhere;
			font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
			font-size: 0.88em;
		}

		.flashcard-pdf-content blockquote {
			margin-left: 0;
			padding-left: 0.8em;
			border-left: 2px solid #cbd5e1;
			color: #475569;
		}

		.flashcard-pdf-content a {
			color: inherit;
			text-decoration: none;
		}
	}
`;

export function getDeckPdfRows(deck: Pick<Deck, "cards">): DeckPdfRow[] {
	return deck.cards.map((card) => ({
		front: card.front,
		back: card.back,
	}));
}

export function getDeckPdfFileStem(deckName: string): string {
	const sanitized = deckName
		.replace(/[<>:"/\\|?*]/g, "-")
		.split("")
		.map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
		.join("")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[.\s]+$/g, "");
	return sanitized || "flashcards";
}

export function ensurePdfExtension(filePath: string): string {
	return filePath.toLowerCase().endsWith(".pdf") ? filePath : `${filePath}.pdf`;
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export function createPrintableDeck(
	document: Document,
	deck: Pick<Deck, "name" | "cards">,
	labels: DeckPdfExportLabels,
): PrintableDeck {
	const root = document.createElement("main");
	root.className = "flashcard-pdf-document";

	const header = document.createElement("header");
	header.className = "flashcard-pdf-header";

	const title = document.createElement("h1");
	title.className = "flashcard-pdf-title";
	title.textContent = deck.name;
	header.appendChild(title);

	const meta = document.createElement("div");
	meta.className = "flashcard-pdf-meta";
	meta.textContent = labels.cardCount(deck.cards.length);
	header.appendChild(meta);
	root.appendChild(header);

	const table = document.createElement("table");
	table.className = "flashcard-pdf-table";

	const tableHead = document.createElement("thead");
	const headerRow = document.createElement("tr");
	for (const label of [labels.frontColumn, labels.backColumn]) {
		const headerCell = document.createElement("th");
		headerCell.scope = "col";
		headerCell.textContent = label;
		headerRow.appendChild(headerCell);
	}
	tableHead.appendChild(headerRow);
	table.appendChild(tableHead);

	const tableBody = document.createElement("tbody");
	table.appendChild(tableBody);
	root.appendChild(table);

	return { root, tableBody };
}

export function appendPrintableCell(row: HTMLTableRowElement): HTMLElement {
	const cell = row.ownerDocument.createElement("td");
	const content = row.ownerDocument.createElement("div");
	content.className = "flashcard-pdf-content";
	cell.appendChild(content);
	row.appendChild(cell);
	return content;
}

export function createPdfDocumentHtml(title: string, baseUri: string, content: string): string {
	return `<!doctype html>
<html lang="zh-CN">
	<head>
		<meta charset="utf-8">
		<meta name="color-scheme" content="light">
		<base href="${escapeHtml(baseUri)}">
		<title>${escapeHtml(title)}</title>
		<style>${DECK_PDF_PRINT_STYLES}</style>
	</head>
	<body class="flashcard-pdf-exporting">${content}</body>
</html>`;
}
