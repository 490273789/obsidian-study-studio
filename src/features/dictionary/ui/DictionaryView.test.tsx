import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createDictionaryQuerySession } from "../domain/querySession";
import { DEFAULT_DICTIONARY_SETTINGS } from "../domain/configuration";
import type { DictionarySettingsStore } from "../domain/types";
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
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock("./SandboxDocumentFrame", () => ({ SandboxDocumentFrame: () => null }));

beforeEach(() => {
	hooks.cursor = 0;
	hooks.callbacks = [];
});

interface ContentProps {
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

async function setup() {
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
				word: text,
				sourceId: source.id,
				sourceLabel: source.label,
				attribution: "",
				pronunciations: [],
				suggestions: [],
				sections: [
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
	it("opens the batch favorite modal from the search controls", async () => {
		const { props } = await setup();
		let action: (() => void) | null = null;
		function visit(node: React.ReactNode): void {
			React.Children.forEach(node, (child) => {
				if (!React.isValidElement(child)) return;
				const element = child as React.ReactElement<{
					children?: React.ReactNode;
					"aria-label"?: string;
					onClick?: () => void;
				}>;
				if (element.props["aria-label"] === "批量收藏单词")
					action = element.props.onClick ?? null;
				visit(element.props.children);
			});
		}
		visit(DictionaryView(props));
		expect(action).not.toBeNull();
		(action as (() => void) | null)?.();
		expect(props.onOpenBatchFavorite).toHaveBeenCalledOnce();
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
});
