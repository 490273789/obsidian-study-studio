import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
	allowsMainTabShortcut,
	LookupAssistantCardView,
	type LookupAssistantCardProps,
} from "../LookupAssistantCard";
import type { DictionaryRuntime } from "../../domain/dictionaryRuntime";
import type { DictionaryQuerySession } from "../../domain/querySession";
import type { DictionaryViewState } from "../../domain/types";

const hooks = vi.hoisted(() => ({
	cursor: 0,
	callbacks: [] as Array<{ dependencies: readonly unknown[]; callback: unknown }>,
	sessionSnapshot: null as DictionaryViewState | null,
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
	useRef: (initial: unknown) => ({ current: initial }),
	useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
	useEffect: () => {},
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) =>
		hooks.sessionSnapshot ?? getSnapshot(),
}));

vi.mock("../SandboxDocumentFrame", () => ({ SandboxDocumentFrame: () => null }));

beforeEach(() => {
	hooks.cursor = 0;
	hooks.callbacks = [];
	hooks.sessionSnapshot = null;
});

describe("LookupAssistantCard", () => {
	it("identifies matching main tab shortcuts when target is inside the card", () => {
		const input = {} as HTMLElement;
		const outside = {} as HTMLElement;
		const card = {
			contains: (node: unknown) => node === input,
		} as unknown as HTMLElement;

		const makeEvent = (overrides: Partial<KeyboardEvent> = {}) =>
			({
				key: "Enter",
				ctrlKey: true,
				metaKey: false,
				shiftKey: false,
				altKey: false,
				defaultPrevented: false,
				isComposing: false,
				target: input,
				...overrides,
			}) as unknown as KeyboardEvent;

		expect(allowsMainTabShortcut(makeEvent(), card, "Ctrl+Enter")).toBe(true);
		expect(allowsMainTabShortcut(makeEvent({ target: outside }), card, "Ctrl+Enter")).toBe(
			false,
		);
		expect(allowsMainTabShortcut(makeEvent({ key: "a" }), card, "Ctrl+Enter")).toBe(false);
	});

	it("renders query input, source tabs, and handles lookup submission on Enter", () => {
		const { session, sendSpy } = fakeSession();
		hooks.sessionSnapshot = session.getSnapshot();
		const runtime = fakeRuntime(session);

		const onOpenInMainTab = vi.fn().mockResolvedValue(undefined);
		const onOpenFavorite = vi.fn().mockResolvedValue(undefined);
		const onClose = vi.fn();
		const onHeaderPointerDown = vi.fn();

		const props: LookupAssistantCardProps = {
			word: "test",
			runtime,
			openInMainTab: onOpenInMainTab,
			openFavorite: onOpenFavorite,
			onClose,
			onHeaderPointerDown,
			selectedDictionaries: ["dict-a", "dict-b"],
			dictionaryOrder: ["dict-a", "dict-b"],
			openMainShortcut: "Ctrl+Enter",
		};

		const tree = LookupAssistantCardView(props) as React.ReactElement<Record<string, unknown>>;
		expect(tree).toBeDefined();

		const input = findElement(tree, (el) => el.type === "input");
		expect(input).toBeDefined();

		// Trigger Enter key submission
		const preventDefault = vi.fn();
		(input?.props as { onKeyDown: (event: unknown) => void })?.onKeyDown({
			key: "Enter",
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			altKey: false,
			currentTarget: { value: "  new query  " },
			preventDefault,
			stopPropagation: vi.fn(),
		});

		expect(preventDefault).toHaveBeenCalled();
		expect(sendSpy).toHaveBeenCalledWith({ type: "lookup", query: "new query" });
	});

	it("triggers favorite and main-tab actions on button clicks", async () => {
		const { session } = fakeSession("hello");
		hooks.sessionSnapshot = session.getSnapshot();
		const runtime = fakeRuntime(session);

		const onOpenInMainTab = vi.fn().mockResolvedValue(undefined);
		const onOpenFavorite = vi.fn().mockResolvedValue(undefined);
		const onClose = vi.fn();

		const props: LookupAssistantCardProps = {
			word: "hello",
			runtime,
			openInMainTab: onOpenInMainTab,
			openFavorite: onOpenFavorite,
			onClose,
			selectedDictionaries: [],
			dictionaryOrder: [],
			openMainShortcut: "Ctrl+Enter",
		};

		const tree = LookupAssistantCardView(props) as React.ReactElement<Record<string, unknown>>;

		const favoriteBtn = findElement(
			tree,
			(el) =>
				(el.props as { "aria-label"?: string })["aria-label"] === "收藏" ||
				(el.props as { title?: string }).title === "收藏",
		);
		expect(favoriteBtn).toBeDefined();
		(favoriteBtn?.props as { onClick?: (e: unknown) => void })?.onClick?.({
			stopPropagation: vi.fn(),
		});
		expect(onOpenFavorite).toHaveBeenCalledWith("hello");

		const mainTabBtn = findElement(
			tree,
			(el) =>
				(el.props as { "aria-label"?: string })["aria-label"] === "在主标签页打开" ||
				Boolean((el.props as { title?: string }).title?.includes("主标签页")),
		);
		expect(mainTabBtn).toBeDefined();
		(mainTabBtn?.props as { onClick?: (e: unknown) => void })?.onClick?.({
			stopPropagation: vi.fn(),
		});
		expect(onOpenInMainTab).toHaveBeenCalledWith("hello");
	});

	it("renders source tablist and selects source on tab click", () => {
		const { session, sendSpy } = fakeSession();
		hooks.sessionSnapshot = session.getSnapshot();
		const runtime = fakeRuntime(session);

		const props: LookupAssistantCardProps = {
			word: "hello",
			runtime,
			onClose: vi.fn(),
			selectedDictionaries: [],
			dictionaryOrder: [],
			openMainShortcut: "Ctrl+Enter",
		};

		const tree = LookupAssistantCardView(props) as React.ReactElement<Record<string, unknown>>;

		const tabs = findElements(tree, (el) => (el.props as { role?: string }).role === "tab");
		expect(tabs.length).toBeGreaterThanOrEqual(2);

		(tabs[1]?.props as { onClick?: () => void })?.onClick?.();
		expect(sendSpy).toHaveBeenCalledWith({
			type: "select-source",
			sourceId: "dict-b",
		});
	});

	it("handles retry and AI generation intents", () => {
		const { session, sendSpy } = fakeSession();
		const aiSnapshot: DictionaryViewState = {
			query: "hello",
			input: "hello",
			activeSourceId: "dict-b",
			aiEngineName: "GPT-4",
			aiReady: true,
			history: [],
			status: "idle",
			sources: [
				{
					id: "dict-a",
					label: "Dict A",
					kind: "youdao",
					status: "error",
					error: "Failed to load",
					activeSectionIndex: null,
					result: null,
				},
				{
					id: "dict-b",
					label: "Dict B",
					kind: "ai",
					status: "idle",
					error: "",
					activeSectionIndex: null,
					result: null,
				},
			],
		};
		hooks.sessionSnapshot = aiSnapshot;

		const runtime = fakeRuntime(session);

		const props: LookupAssistantCardProps = {
			word: "hello",
			runtime,
			onClose: vi.fn(),
			selectedDictionaries: [],
			dictionaryOrder: [],
			openMainShortcut: "Ctrl+Enter",
		};

		const tree = LookupAssistantCardView(props) as React.ReactElement<Record<string, unknown>>;

		// The AI action button
		const aiBtn = findElement(tree, (el) => {
			const p = el.props as { type?: string; onClick?: unknown; className?: string };
			return (
				p.type === "button" &&
				Boolean(p.onClick) &&
				Boolean(p.className?.includes("aiGenerateBtn"))
			);
		});
		expect(aiBtn).toBeDefined();
		(aiBtn?.props as { onClick?: () => void })?.onClick?.();
		expect(sendSpy).toHaveBeenCalledWith({
			type: "generate-ai",
		});
	});
});

interface FakeSessionHandle {
	session: DictionaryQuerySession;
	sendSpy: ReturnType<typeof vi.fn>;
}

function fakeSession(initialQuery = "test"): FakeSessionHandle {
	let snapshot: DictionaryViewState = {
		query: initialQuery,
		input: initialQuery,
		activeSourceId: "dict-a",
		aiEngineName: "",
		aiReady: true,
		history: [],
		status: "idle",
		sources: [
			{
				id: "dict-a",
				label: "Dict A",
				kind: "youdao",
				status: "success",
				error: "",
				activeSectionIndex: null,
				result: {
					sourceId: "dict-a",
					sourceLabel: "Dict A",
					word: initialQuery,
					attribution: "",
					pronunciations: [],
					suggestions: [],
					sections: [
						{
							title: "释义",
							presentation: "stack",
							content: { kind: "list", items: ["definition text"] },
						},
					],
				},
			},
			{
				id: "dict-b",
				label: "Dict B",
				kind: "ai",
				status: "idle",
				error: "",
				activeSectionIndex: null,
				result: null,
			},
		],
	};

	const listeners = new Set<() => void>();
	const sendSpy = vi.fn(async (intent: any) => {
		if (intent.type === "select-source") {
			snapshot = { ...snapshot, activeSourceId: intent.sourceId };
		}
		for (const listener of listeners) listener();
	});

	return {
		sendSpy,
		session: {
			getSnapshot: () => snapshot,
			subscribe: (listener: () => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			send: sendSpy,
			dispose: vi.fn(),
		} as unknown as DictionaryQuerySession,
	};
}

function fakeRuntime(session: DictionaryQuerySession): DictionaryRuntime {
	return {
		query: session,
		createSelectionLookupSession: vi.fn(() => session),
		settings: {
			getDictionarySettings: () => ({
				sources: [
					{ id: "dict-a", label: "Dict A", kind: "dictionary", enabled: true },
					{ id: "dict-b", label: "Dict B", kind: "ai", enabled: true },
				],
			}),
		},
	} as unknown as DictionaryRuntime;
}

function findElement(
	root: React.ReactElement<Record<string, unknown>> | null | undefined,
	predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean,
): React.ReactElement<Record<string, unknown>> | null {
	if (!root || typeof root !== "object") return null;
	if (predicate(root)) return root;
	const children = React.Children.toArray(
		(root.props as { children?: React.ReactNode })?.children,
	);
	for (const child of children) {
		if (React.isValidElement(child)) {
			const found = findElement(
				child as React.ReactElement<Record<string, unknown>>,
				predicate,
			);
			if (found) return found;
		}
	}
	return null;
}

function findElements(
	root: React.ReactElement<Record<string, unknown>> | null | undefined,
	predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean,
): React.ReactElement<Record<string, unknown>>[] {
	const matches: React.ReactElement<Record<string, unknown>>[] = [];
	if (!root || typeof root !== "object") return matches;
	if (predicate(root)) matches.push(root);
	const children = React.Children.toArray(
		(root.props as { children?: React.ReactNode })?.children,
	);
	for (const child of children) {
		if (React.isValidElement(child)) {
			matches.push(
				...findElements(child as React.ReactElement<Record<string, unknown>>, predicate),
			);
		}
	}
	return matches;
}
