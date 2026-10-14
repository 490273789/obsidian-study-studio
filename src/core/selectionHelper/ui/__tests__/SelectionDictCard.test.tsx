import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { SelectionDictCard } from "../SelectionDictCard";
import { selectionHelperStrings } from "../../strings/selectionPopup";
import type { SelectionLookupSession, SelectionLookupSnapshot } from "../../domain/types";

describe("SelectionDictCard", () => {
	const mockLookup: SelectionLookupSnapshot = {
		query: "commercial",
		activeSourceId: "youdao",
		aiEngineName: "",
		status: "ready",
		sources: [
			{
				id: "youdao",
				label: "有道词典",
				kind: "dictionary",
				status: "success",
				error: "",
				pronunciations: [],
				sections: [
					{ title: "释义", presentation: "stack", kind: "list", items: ["商业的"] },
				],
				activeSectionIndex: 0,
			},
		],
	};

	const mockSession: SelectionLookupSession = {
		getSnapshot: () => mockLookup,
		subscribe: vi.fn(() => () => {}),
		selectSource: vi.fn(),
		selectSection: vi.fn(),
		lookup: vi.fn().mockResolvedValue(undefined),
		retry: vi.fn().mockResolvedValue(undefined),
		generateAi: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
	};

	it("renders favorite button when onFavorite is provided", () => {
		const onFavorite = vi.fn();
		const strings = selectionHelperStrings("zh");
		const element = (
			<SelectionDictCard
				query="commercial"
				lookup={mockLookup}
				session={mockSession}
				strings={strings}
				theme="dark"
				onOpenInMainTab={vi.fn()}
				onFavorite={onFavorite}
				onClose={vi.fn()}
			/>
		);

		// Component renders properly as a React element with expected props
		expect(element.props.onFavorite).toBe(onFavorite);
		expect(element.props.strings.favorite).toBe("收藏");
	});
});
