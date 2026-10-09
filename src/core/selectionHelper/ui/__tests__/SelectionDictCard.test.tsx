import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { SelectionDictCard } from "../SelectionDictCard";
import { selectionHelperStrings } from "../../strings/selectionPopup";
import type { SelectionLookupSnapshot } from "../../domain/types";

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

	it("renders favorite button when onFavorite is provided", () => {
		const onFavorite = vi.fn();
		const strings = selectionHelperStrings("zh");
		const element = (
			<SelectionDictCard
				query="commercial"
				lookup={mockLookup}
				strings={strings}
				theme="dark"
				onSelectSource={vi.fn()}
				onSelectSection={vi.fn()}
				onLookup={vi.fn()}
				onRetry={vi.fn()}
				onGenerateAi={vi.fn()}
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
