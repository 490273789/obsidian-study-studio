import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SelectionLookupSection, SelectionLookupSourceSnapshot } from "../../domain/types";
import { selectionHelperStrings } from "../../strings/selectionPopup";
import {
	allowsMainTabShortcut,
	SelectionDictCard,
	type SelectionDictCardProps,
} from "../SelectionDictCard";
import type { SelectionEmbeddedContentProps } from "../types";
import styles from "../SelectionPopup.module.scss";

function source(
	sections: SelectionLookupSection[],
	overrides: Partial<SelectionLookupSourceSnapshot> = {},
): SelectionLookupSourceSnapshot {
	return {
		id: "local",
		label: "OALD",
		kind: "dictionary",
		status: "success",
		error: "",
		pronunciations: [],
		activeSectionIndex: 1,
		sections,
		...overrides,
	};
}

function props(
	sources: SelectionLookupSourceSnapshot[],
	overrides: Partial<SelectionDictCardProps> = {},
): SelectionDictCardProps {
	return {
		query: "segmenting",
		lookup: {
			query: "segment",
			activeSourceId: "local",
			aiEngineName: "",
			status: "ready",
			sources,
		},
		strings: selectionHelperStrings("zh"),
		theme: "dark",
		onSelectSource: vi.fn(),
		onSelectSection: vi.fn(),
		onLookup: vi.fn(),
		onRetry: vi.fn(),
		onGenerateAi: vi.fn(),
		onOpenInMainTab: vi.fn(),
		onClose: vi.fn(),
		...overrides,
	};
}

const embedded = (
	title: string,
	presentation: "stack" | "tab" = "tab",
): SelectionLookupSection => ({ kind: "embedded", handle: {}, title, presentation });

describe("lookup assistant content", () => {
	it("renders only the active source and chapter via the injected feature renderer", () => {
		const stack = embedded("Main", "stack");
		const selected = embedded("Selected");
		const hidden = embedded("Hidden");
		const render = vi.fn((p: SelectionEmbeddedContentProps) => <iframe title={p.title} />);
		const p = props(
			[
				source([stack, selected, hidden]),
				source([embedded("Other source", "stack")], { id: "other" }),
			],
			{ renderEmbeddedContent: render },
		);
		const html = renderToStaticMarkup(<SelectionDictCard {...p} />);
		expect(render).toHaveBeenCalledTimes(2);
		expect(render.mock.calls.map(([p]) => p.handle)).toEqual([
			stack.kind === "embedded" && stack.handle,
			selected.kind === "embedded" && selected.handle,
		]);
		expect(render.mock.calls[1]?.[0]).toMatchObject({
			theme: "dark",
			title: "OALD · Selected",
			onLookup: p.onLookup,
			onClose: p.onClose,
			fitContent: true,
		});
		expect(html).toContain('aria-label="segment"');
		expect(html).toContain("在词典主标签打开");
		expect(html).toContain('aria-label="关闭"');
		expect(html).not.toContain("请在词典主标签查看");
	});

	it("fits both stacked and single documents to their content in the outer reader", () => {
		const render = vi.fn((p: SelectionEmbeddedContentProps) => <iframe title={p.title} />);
		const documents = Array.from({ length: 9 }, (_, index) =>
			embedded(`Entry ${index}`, "stack"),
		);
		const html = renderToStaticMarkup(
			<SelectionDictCard
				{...props([source(documents)], { renderEmbeddedContent: render })}
			/>,
		);
		expect(render).toHaveBeenCalledTimes(9);
		expect(render.mock.calls.every(([p]) => p.fitContent)).toBe(true);
		expect(html).toContain(styles.bodyRich);
		render.mockClear();
		const single = renderToStaticMarkup(
			<SelectionDictCard
				{...props([source([documents[0]!])], { renderEmbeddedContent: render })}
			/>,
		);
		expect(render.mock.calls[0]?.[0].fitContent).toBe(true);
		expect(single).toContain(styles.bodyRich);
	});

	it.each(["loading", "empty", "error"] as const)(
		"does not mount documents while source is %s",
		(status) => {
			const render = vi.fn(() => <iframe title="Entry" />);
			const html = renderToStaticMarkup(
				<SelectionDictCard
					{...props(
						[
							source([embedded("Old entry", "stack")], {
								status,
								error: "Package missing",
							}),
						],
						{ renderEmbeddedContent: render },
					)}
				/>,
			);
			expect(render).not.toHaveBeenCalled();
			if (status === "loading") expect(html).toContain("正在查询");
			if (status === "empty") expect(html).toContain("未找到释义");
			if (status === "error") {
				expect(html).toContain("Package missing");
				expect(html).toContain("重试");
			}
			expect(html).toContain("在词典主标签打开");
		},
	);

	it("keeps AI generation explicit and renders plain definitions without a renderer", () => {
		const ai = source([], { id: "ai", kind: "ai", label: "AI", status: "idle" });
		const p = props([ai]);
		p.lookup.activeSourceId = "ai";
		expect(renderToStaticMarkup(<SelectionDictCard {...p} />)).toContain("生成 AI 释义");
		expect(p.onGenerateAi).not.toHaveBeenCalled();
		const plain = source([
			{ kind: "list", items: ["部分"], title: "释义", presentation: "stack" },
		]);
		expect(renderToStaticMarkup(<SelectionDictCard {...props([plain])} />)).toContain("部分");
	});
});

describe("assistant main tab keyboard shortcut", () => {
	it("keeps Enter on controls, editable text, links and frames", () => {
		const event = { key: "Enter", target: { closest: () => ({}) } };
		expect(allowsMainTabShortcut(event as unknown as KeyboardEvent)).toBe(false);
	});

	it("allows unmodified Enter outside controls and respects composing and handled keys", () => {
		const event = { key: "Enter", target: { closest: () => null } };
		expect(allowsMainTabShortcut(event as unknown as KeyboardEvent)).toBe(true);
		for (const flag of [
			"isComposing",
			"defaultPrevented",
			"ctrlKey",
			"altKey",
			"metaKey",
			"shiftKey",
		]) {
			expect(
				allowsMainTabShortcut({ ...event, [flag]: true } as unknown as KeyboardEvent),
			).toBe(false);
		}
		expect(allowsMainTabShortcut({ ...event, key: "Escape" } as unknown as KeyboardEvent)).toBe(
			false,
		);
	});
});
