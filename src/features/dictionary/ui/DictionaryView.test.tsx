import React from "react";
import { FlashcardMenu, type FlashcardMenuItem } from "../../../core/ui/primitives/Menu";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createDictionaryQuerySession } from "../domain/querySession";
import { DEFAULT_DICTIONARY_SETTINGS } from "../domain/configuration";
import type { DictionarySection, DictionarySettingsStore } from "../domain/types";
import { defineSandboxDocument } from "../domain/sandbox-document/document";
import { DictionaryView, type DictionaryViewProps } from "./DictionaryView";

// Exercise the view's emitted props in node; React's actual DOM reconciler and
// iframe registration are outside this adapter test.
const hooks = vi.hoisted(() => ({
	cursor: 0,
	callbacks: [] as Array<{ dependencies: readonly unknown[]; callback: unknown }>,
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useCallback: (callback: unknown, dependencies: readonly unknown[]) => {
		const index = hooks.cursor++;
		const previous = hooks.callbacks[index];
		if (
			!previous ||
			dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))
		) {
			hooks.callbacks[index] = { callback, dependencies };
		}
		return hooks.callbacks[index]!.callback;
	},
	useRef: () => ({ current: null }),
	useState: () => [null, () => {}],
	useEffect: () => {},
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock("./SandboxDocumentFrame", () => ({ SandboxDocumentFrame: () => null }));

beforeEach(() => {
	hooks.cursor = 0;
	hooks.callbacks = [];
});

interface ContentProps {
	fitContent?: boolean;
	content: unknown;
	onLookup: (word: string) => void;
	theme: string;
	strings: unknown;
}

function contents(props: DictionaryViewProps): React.ReactElement<ContentProps>[] {
	hooks.cursor = 0;
	const found: React.ReactElement<ContentProps>[] = [];
	function visit(node: React.ReactNode): void {
		React.Children.forEach(node, (child) => {
			if (!React.isValidElement(child)) return;
			const element = child as React.ReactElement<{ children?: React.ReactNode }>;
			if (element.props && "content" in element.props && "onLookup" in element.props) {
				found.push(element as React.ReactElement<ContentProps>);
			}
			visit(element.props.children);
		});
	}
	visit(DictionaryView(props));
	return found;
}

function dictionaryActions(tree: React.ReactNode): FlashcardMenuItem[] {
	for (const child of React.Children.toArray(tree)) {
		if (
			!React.isValidElement<{ children?: React.ReactNode; items?: FlashcardMenuItem[] }>(
				child,
			)
		)
			continue;
		if (child.type === FlashcardMenu) return child.props.items ?? [];
		const nested = dictionaryActions(child.props.children);
		if (nested.length > 0) return nested;
	}
	return [];
}

async function setup(resultSections?: () => DictionarySection[]) {
	let dictionary = structuredClone(DEFAULT_DICTIONARY_SETTINGS);
	dictionary.sources = ["first", "second", "third"].map((id) => ({
		id,
		kind: "local",
		label: id,
		enabled: true,
	}));
	const store: DictionarySettingsStore = {
		getDictionarySettings: () => dictionary,
		updateDictionarySettings: async (mutate) => {
			const draft = structuredClone(dictionary);
			mutate(draft);
			dictionary = draft;
			return true;
		},
		getLocalDictionaryAdministrationState: () => dictionary,
		setLocalDictionaryAdministrationState: () => {},
		save: async () => {},
	};
	const query = createDictionaryQuerySession({
		settings: store,
		notify: vi.fn(),
		aiEngineInfo: () => ({ configId: null, name: null }),
		resolveSource: (source) => ({
			...source,
			lookup: async ({ text }) => ({
				word: text === "diagnose" ? "diagnosis" : text,
				sourceId: source.id,
				sourceLabel: source.label,
				attribution: "",
				pronunciations: [],
				suggestions: [],
				sections: resultSections?.() ?? [
					{
						title: "Definition",
						presentation: "stack",
						content: { kind: "list", items: [text] },
					},
				],
			}),
		}),
	});
	await query.send({ type: "lookup", query: "word" });
	const props: DictionaryViewProps = {
		query,
		language: "zh",
		theme: "dark",
		onOpenSettings: vi.fn(),
		onOpenFavorite: vi.fn(),
		onOpenBatchFavorite: vi.fn(),
		onPlayAudio: vi.fn(),
	};
	return { query, props };
}

describe("dictionary result presentation", () => {
	it("lets a standalone local document scroll inside its frame and stacks multiple documents", async () => {
		const documentSection = (): DictionarySection => ({
			title: "Definition",
			presentation: "stack",
			content: {
				kind: "document",
				document: defineSandboxDocument("local", "<p>Dictionary entry</p>"),
			},
		});
		const single = await setup(() => [documentSection()]);
		expect(contents(single.props).map(({ props }) => props.fitContent)).toEqual([
			false,
			false,
			false,
		]);

		const multiple = await setup(() => [documentSection(), documentSection()]);
		expect(contents(multiple.props).map(({ props }) => props.fitContent)).toEqual(
			Array(6).fill(true),
		);
	});

	it("opens batch favorites and settings from the dictionary actions menu", async () => {
		const { props } = await setup();
		const actions = dictionaryActions(DictionaryView(props));
		expect(actions.map(({ label }) => label)).toEqual([
			"批量收藏单词",
			"打开字典设置",
			"清除当前查询和结果",
		]);
		actions.find(({ key }) => key === "batch-favorite")?.onSelect();
		actions.find(({ key }) => key === "settings")?.onSelect();
		expect(props.onOpenBatchFavorite).toHaveBeenCalledOnce();
		expect(props.onOpenSettings).toHaveBeenCalledOnce();
	});

	it("keeps section props stable across input and source selection, including hidden sources", async () => {
		const { query, props } = await setup();
		const initial = contents(props);
		expect(initial).toHaveLength(3);
		expect(initial[0]!.type).toMatchObject({ $$typeof: Symbol.for("react.memo") });
		for (let i = 0; i < 20; i++) {
			await query.send({ type: "change-input", value: `typing${i}` });
			const next = contents(props);
			next.forEach((element, index) =>
				Object.entries(element.props).forEach(([key, value]) =>
					expect(value).toBe(initial[index]!.props[key as keyof ContentProps]),
				),
			);
		}
		await query.send({ type: "select-source", sourceId: "second" });
		contents(props).forEach((element, index) =>
			Object.entries(element.props).forEach(([key, value]) =>
				expect(value).toBe(initial[index]!.props[key as keyof ContentProps]),
			),
		);
	});

	it("invalidates changed theme, language, query results, and session callbacks", async () => {
		const { query, props } = await setup();
		const initial = contents(props)[0]!;
		expect(contents({ ...props, theme: "light" })[0]!.props.theme).toBe("light");
		expect(contents({ ...props, language: "en" })[0]!.props.strings).not.toBe(
			initial.props.strings,
		);
		await query.send({ type: "lookup", query: "replacement" });
		expect(contents(props)[0]!.props.content).not.toBe(initial.props.content);
		const replacement = await setup();
		const lookup = contents(replacement.props)[0]!.props.onLookup;
		expect(lookup).not.toBe(initial.props.onLookup);
		lookup("linked word");
		expect(replacement.query.getSnapshot().query).toBe("linked word");
		expect(query.getSnapshot().query).toBe("replacement");
	});

	it("limits initial history and detail choices and keeps the selected extra tab visible", async () => {
		const titles = ["英英释义", "词形变化", "柯林斯", "词义辨析", "短语", "近义词"];
		const { query, props } = await setup(() =>
			titles.map((title) => ({
				title,
				presentation: "tab",
				content: { kind: "list", items: [title] },
			})),
		);
		for (const word of ["first", "second", "third", "fourth"]) {
			await query.send({ type: "lookup", query: word });
		}

		function visibleControls() {
			hooks.cursor = 0;
			const tabs: string[] = [];
			const history: string[] = [];
			function visit(node: React.ReactNode): void {
				React.Children.forEach(node, (child) => {
					if (
						!React.isValidElement<{
							children?: React.ReactNode;
							role?: string;
							title?: string;
							id?: string;
						}>(child)
					)
						return;
					if (
						child.props.role === "tab" &&
						child.props.id?.startsWith("dictionary-section-tab-first-")
					) {
						tabs.push(String(child.props.children));
					}
					if (
						child.props.title === child.props.children &&
						typeof child.props.title === "string"
					) {
						history.push(child.props.title);
					}
					visit(child.props.children);
				});
			}
			visit(DictionaryView(props));
			return { tabs, history };
		}

		expect(visibleControls()).toEqual({
			tabs: ["英英释义", "词形变化", "短语"],
			history: ["fourth", "third", "second"],
		});
		await query.send({ type: "select-section", sourceId: "first", sectionIndex: 2 });
		expect(visibleControls().tabs).toEqual(["英英释义", "词形变化", "柯林斯", "短语"]);
	});

	it("distinguishes clearing the input from clearing the submitted query", async () => {
		const { query, props } = await setup();
		await query.send({ type: "change-input", value: "draft" });
		const actions = new Map<string, () => void>();
		function visit(node: React.ReactNode): void {
			React.Children.forEach(node, (child) => {
				if (
					!React.isValidElement<{
						children?: React.ReactNode;
						title?: string;
						"aria-label"?: string;
						onClick?: () => void;
					}>(child)
				)
					return;
				const { title, "aria-label": label, onClick } = child.props;
				if (title && title === label && onClick) actions.set(title, onClick);
				visit(child.props.children);
			});
		}
		const view = DictionaryView(props);
		visit(view);
		actions.get("清空输入")?.();
		expect(query.getSnapshot()).toMatchObject({ input: "", query: "word" });
		const clear = dictionaryActions(view).find(({ key }) => key === "clear-query");
		expect(clear?.disabled).toBe(false);
		clear?.onSelect();
		expect(query.getSnapshot()).toMatchObject({ input: "", query: "", history: ["word"] });
		hooks.cursor = 0;
		expect(
			dictionaryActions(DictionaryView(props)).find(({ key }) => key === "clear-query")
				?.disabled,
		).toBe(true);
	});

	it("keeps the resolved headword and its actions independent of input edits", async () => {
		const { query, props } = await setup();
		await query.send({ type: "lookup", query: "diagnose" });
		await query.send({ type: "change-input", value: "typing" });

		const buttonLabels: string[] = [];
		const headwords: string[] = [];
		let favorite: (() => void) | undefined;
		function visit(node: React.ReactNode): void {
			React.Children.forEach(node, (child) => {
				if (!React.isValidElement(child)) return;
				const element = child as React.ReactElement<{
					children?: React.ReactNode;
					"aria-label"?: string;
					title?: string;
					onClick?: () => void;
				}>;
				if (element.type === "h2") headwords.push(String(element.props.children));
				if (element.props["aria-label"] === "收藏单词") favorite = element.props.onClick;
				if (element.props["aria-label"]) {
					buttonLabels.push(element.props["aria-label"]);
				}
				visit(element.props.children);
			});
		}
		visit(DictionaryView(props));

		// WCAG 4.1.2: Bookmark and Copy buttons must provide accessible names
		expect(buttonLabels).toContain("收藏单词");
		expect(buttonLabels).toContain("复制单词");
		expect(buttonLabels).not.toContain("从历史中移除“word”");
		expect(headwords).toEqual(["diagnosis", "diagnosis", "diagnosis"]);
		favorite?.();
		expect(props.onOpenFavorite).toHaveBeenCalledWith("diagnosis");
	});
});
