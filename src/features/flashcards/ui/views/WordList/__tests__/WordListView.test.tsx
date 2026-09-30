import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createEmptyCard } from "ts-fsrs";
import { describe, expect, it, vi } from "vitest";
import type { Deck } from "../../../../../../core/shared/types";
import { I18nProvider } from "../../../../../../core/ui/context/I18nContext";
import { flashcardTranslator } from "../../../../strings";
import type { WordListItem } from "../../../../domain/wordList/wordListPresentationModel";
import { WordListView } from "../WordListView";

const bindings = vi.hoisted(() => ({ row: vi.fn(), scroll: vi.fn(), list: vi.fn() }));

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useSyncExternalStore: <T,>(
			subscribe: (listener: () => void) => () => void,
			getSnapshot: () => T,
		) => actual.useSyncExternalStore(subscribe, getSnapshot, getSnapshot),
	};
});

vi.mock("../wordListViewport", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../wordListViewport")>();
	return {
		...actual,
		WordListViewport: class extends actual.WordListViewport {
			constructor(items: readonly WordListItem[]) {
				super(items);
				this.refs.row = bindings.row.mockImplementation(this.refs.row);
				this.refs.scroll = bindings.scroll.mockImplementation(this.refs.scroll);
				this.refs.list = bindings.list.mockImplementation(this.refs.list);
			}
		},
	};
});

describe("word list rendering", () => {
	it("renders virtual rows without creating or invoking DOM bindings during render", () => {
		const deck: Deck = {
			id: "words",
			name: "Words",
			filePath: "words.md",
			tag: "#words",
			studyCount: 0,
			lastStudied: null,
			cards: ["hello", "world"].map((front, indexInFile) => ({
				id: front,
				front,
				back: `meaning ${front}`,
				sourceFile: "words.md",
				indexInFile,
				fsrsCard: createEmptyCard(),
			})),
		};
		const html = renderToStaticMarkup(
			<I18nProvider language="en" translator={flashcardTranslator}>
				<WordListView deck={deck} onBack={() => {}} />
			</I18nProvider>,
		);
		expect(html).toContain("hello");
		expect(html).toContain("world");
		expect(html).toContain("translateY(130px)");
		expect(bindings.row).not.toHaveBeenCalled();
		expect(bindings.scroll).not.toHaveBeenCalled();
		expect(bindings.list).not.toHaveBeenCalled();
	});
});
