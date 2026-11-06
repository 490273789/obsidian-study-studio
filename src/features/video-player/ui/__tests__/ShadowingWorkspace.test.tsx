import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ShadowingWorkspaceState } from "../../domain/types";
import { ShadowingWorkspace } from "../ShadowingWorkspace";
import type {
	SubtitleEditingSession,
	SubtitleEditingSessionSnapshot,
} from "../subtitleEditingSession";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
	useState: (initial: unknown) => {
		const index = hooks.index++;
		if (!(index in hooks.values)) hooks.values[index] = initial;
		return [
			hooks.values[index],
			(value: unknown) => {
				hooks.values[index] =
					typeof value === "function"
						? (value as (previous: unknown) => unknown)(hooks.values[index])
						: value;
			},
		];
	},
}));

function editorAdapter() {
	let snapshot: SubtitleEditingSessionSnapshot = {
		sourceId: "video",
		selectedCueIds: [],
		rangeStart: 4,
		rangeEnd: 6,
		canPractice: false,
		editor: null,
	};
	const actions = {
		choose: vi.fn(),
		practice: vi.fn(),
		toggleEditor: vi.fn(),
		setField: vi.fn(),
		setRange: vi.fn(),
		submit: vi.fn(async () => undefined),
		requestReload: vi.fn(),
		cancelReload: vi.fn(),
		confirmReload: vi.fn(async () => undefined),
	};
	return {
		actions,
		setSnapshot: (patch: Partial<SubtitleEditingSessionSnapshot>) => {
			snapshot = { ...snapshot, ...patch };
		},
		editing: {
			...actions,
			getSnapshot: () => snapshot,
			subscribe: () => () => undefined,
		} as unknown as SubtitleEditingSession,
	};
}

function findButton(
	tree: React.ReactNode,
	predicate: (button: React.ReactElement<React.ComponentProps<"button">>) => boolean,
): React.ReactElement<React.ComponentProps<"button">> {
	let found: React.ReactElement<React.ComponentProps<"button">> | null = null;
	const visit = (node: React.ReactNode): void => {
		React.Children.forEach(node, (child) => {
			if (found || !React.isValidElement(child)) return;
			if (child.type === "button") {
				const button = child as React.ReactElement<React.ComponentProps<"button">>;
				if (predicate(button)) {
					found = button;
					return;
				}
			}
			visit((child.props as { children?: React.ReactNode }).children);
		});
	};
	visit(tree);
	if (!found) throw new Error("Expected button");
	return found;
}

describe("ShadowingWorkspace", () => {
	it("sends the selected subtitle range through the shared intent seam", async () => {
		hooks.values = [];
		const onAction = vi.fn(async () => undefined);
		const editor = editorAdapter();
		const state = {
			cues: [{ id: "cue-1", start: 4, end: 6, text: "hello" }],
			records: [],
			failedSaves: [],
			taskError: null,
			practiceStart: null,
			practiceEnd: null,
			hasCandidate: false,
		} as unknown as ShadowingWorkspaceState;
		const render = () => {
			hooks.index = 0;
			return ShadowingWorkspace({
				language: "en",
				currentTime: 0,
				duration: 30,
				state,
				editing: editor.editing,
				onAction,
			});
		};

		const cue = findButton(render(), (button) => button.props["aria-pressed"] === false);
		cue.props.onClick?.({ shiftKey: false } as React.MouseEvent<HTMLButtonElement>);
		expect(editor.actions.choose).toHaveBeenCalledWith("cue-1", false);
		editor.setSnapshot({ selectedCueIds: ["cue-1"], canPractice: true });

		const start = findButton(
			render(),
			(button) => button.props.children === "Practice selection",
		);
		start.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(editor.actions.practice).toHaveBeenCalledOnce();
		expect(onAction).not.toHaveBeenCalled();
	});

	it("renders failed drafts even when the edited cue has disappeared and delegates recovery", () => {
		hooks.values = [];
		hooks.index = 0;
		const editor = editorAdapter();
		editor.setSnapshot({
			editor: {
				cueId: "missing",
				text: "My correction",
				translation: "我的译文",
				busy: false,
				conflict: true,
				failure: null,
				confirmingReload: false,
				canSave: false,
			},
		});
		const tree = ShadowingWorkspace({
			language: "en",
			currentTime: 0,
			duration: 30,
			state: {
				cues: [],
				records: [],
				failedSaves: [],
				hasCandidate: false,
			} as unknown as ShadowingWorkspaceState,
			editing: editor.editing,
			onAction: vi.fn(async () => undefined),
		});
		const markup = renderToStaticMarkup(tree);
		expect(markup).toContain("My correction");
		expect(markup).toContain("This subtitle has changed");
		const save = findButton(tree, (button) => button.props.children === "Save correction");
		expect(save.props.disabled).toBe(true);
		const reload = findButton(
			tree,
			(button) => button.props.children === "Reload this subtitle",
		);
		reload.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(editor.actions.requestReload).toHaveBeenCalledOnce();
		expect(editor.actions.confirmReload).not.toHaveBeenCalled();
	});

	it("renders the pending write without closing the editor after submission", () => {
		hooks.values = [];
		hooks.index = 0;
		const editor = editorAdapter();
		editor.setSnapshot({
			editor: {
				cueId: "cue-1",
				text: "Draft",
				translation: "",
				busy: true,
				conflict: false,
				failure: null,
				confirmingReload: false,
				canSave: false,
			},
		});
		const tree = ShadowingWorkspace({
			language: "zh",
			currentTime: 0,
			duration: 30,
			state: {
				cues: [],
				records: [],
				failedSaves: [],
				hasCandidate: false,
			} as unknown as ShadowingWorkspaceState,
			editing: editor.editing,
			onAction: vi.fn(async () => undefined),
		});
		const markup = renderToStaticMarkup(tree);
		expect(markup).toContain('aria-busy="true"');
		expect(markup).toContain("Draft");
		const save = findButton(tree, (button) => button.props.children === "正在保存…");
		expect(save.props.disabled).toBe(true);
		expect(editor.actions.toggleEditor).not.toHaveBeenCalled();
	});
});
