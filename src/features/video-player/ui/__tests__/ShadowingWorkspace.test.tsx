import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ShadowingWorkspaceState } from "../../domain/types";
import { ShadowingWorkspace } from "../ShadowingWorkspace";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
const clipboard = vi.hoisted(() => ({
	copy: vi.fn(async (_text: string) => true),
	notice: vi.fn(),
}));
vi.mock("../../../../core/shared/clipboard", () => ({ copyTextToClipboard: clipboard.copy }));
vi.mock("obsidian", () => ({
	Notice: class {
		constructor(message: string) {
			clipboard.notice(message);
		}
	},
}));

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
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
	it.each(["zh", "en"] as const)(
		"offers subtitle setup actions without starting a task automatically (%s)",
		(language) => {
			hooks.values = [];
			hooks.index = 0;
			const onAction = vi.fn(async () => undefined);
			const state = {
				cues: [],
				records: [],
				failedSaves: [],
				taskError: null,
				practiceStart: null,
				practiceEnd: null,
				hasCandidate: false,
				selectedCueIds: [],
				rangeStart: 0,
				rangeEnd: 0,
				canPractice: false,
				deletedDrafts: [],
				editor: null,
			} as unknown as ShadowingWorkspaceState;
			const tree = ShadowingWorkspace({
				language,
				currentTime: 0,
				duration: 30,
				state,
				onAction,
			});
			const markup = renderToStaticMarkup(tree);
			expect(markup).toContain("SRT / VTT");
			expect(markup).toContain('type="file"');
			expect(onAction).not.toHaveBeenCalled();
			const generate = findButton(
				tree,
				(button) =>
					button.props.children ===
					(language === "zh" ? "生成双语字幕" : "Generate bilingual subtitles"),
			);
			generate.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
			expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: "generate" });
		},
	);

	it("sends the selected subtitle range through the shared intent seam", async () => {
		hooks.values = [];
		const onAction = vi.fn(async () => undefined);
		let state = {
			cues: [{ id: "cue-1", start: 4, end: 6, text: "hello" }],
			records: [],
			failedSaves: [],
			taskError: null,
			practiceStart: null,
			practiceEnd: null,
			hasCandidate: false,
			selectedCueIds: [] as string[],
			rangeStart: 4,
			rangeEnd: 6,
			canPractice: false,
			deletedDrafts: [],
			editor: null,
		} as unknown as ShadowingWorkspaceState;
		const render = () => {
			hooks.index = 0;
			return ShadowingWorkspace({
				language: "en",
				currentTime: 0,
				duration: 30,
				state,
				onAction,
			});
		};

		const cue = findButton(render(), (button) => button.props["aria-pressed"] === false);
		cue.props.onClick?.({ shiftKey: false } as React.MouseEvent<HTMLButtonElement>);
		expect(onAction).toHaveBeenCalledWith({
			type: "choose-cue",
			cueId: "cue-1",
			extend: false,
		});

		state = {
			...state,
			selectedCueIds: ["cue-1"],
			canPractice: true,
		};

		const start = findButton(
			render(),
			(button) => button.props.children === "Practice selection",
		);
		start.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(onAction).toHaveBeenCalledWith({ type: "start-practice-selected" });
	});

	it("shows the deleted cue's draft in a read-only editor and keeps reload available", () => {
		hooks.values = [];
		hooks.index = 0;
		const onAction = vi.fn(async () => undefined);
		const editor = {
			cueId: "missing",
			text: "My correction",
			translation: "我的译文",
			busy: false,
			conflict: true,
			deleted: true,
			failure: null,
			confirmingReload: false,
			canSave: false,
		};
		const state = {
			cues: [],
			records: [],
			failedSaves: [],
			hasCandidate: false,
			selectedCueIds: ["missing"],
			rangeStart: 0,
			rangeEnd: 0,
			canPractice: false,
			deletedDrafts: [],
			editor,
		} as unknown as ShadowingWorkspaceState;
		const tree = ShadowingWorkspace({
			language: "en",
			currentTime: 0,
			duration: 30,
			state,
			onAction,
		});
		const markup = renderToStaticMarkup(tree);
		expect(markup).toContain("My correction");
		expect(markup).toContain("This subtitle was deleted");
		expect(markup.match(/readonly=""/giu)).toHaveLength(2);
		const save = findButton(tree, (button) => button.props.children === "Save correction");
		expect(save.props.disabled).toBe(true);
		const reload = findButton(
			tree,
			(button) => button.props.children === "Reload this subtitle",
		);
		reload.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(onAction).toHaveBeenCalledWith({
			type: "request-cue-reload",
			expectedEditor: editor,
		});
	});

	it("offers collapsed recovery with no remaining cues and copies or discards the exact draft", async () => {
		hooks.values = [];
		hooks.index = 0;
		const onAction = vi.fn(async () => undefined);
		const draft = {
			sourceId: "video",
			cueId: "missing",
			text: "My correction",
			translation: "我的译文",
		};
		const state = {
			cues: [],
			records: [],
			failedSaves: [],
			practiceStart: null,
			practiceEnd: null,
			selectedCueIds: [],
			editor: null,
			deletedDrafts: [draft],
		} as unknown as ShadowingWorkspaceState;
		const tree = ShadowingWorkspace({
			language: "en",
			currentTime: 0,
			duration: 30,
			state,
			onAction,
		});

		const markup = renderToStaticMarkup(tree);
		expect(markup).toMatch(
			/<details class="[^"]+"><summary>View drafts for deleted subtitles<\/summary>/u,
		);
		expect(markup).toContain(draft.text);
		expect(markup).toContain(draft.translation);
		const click = (label: string) =>
			findButton(tree, (button) => button.props.children === label).props.onClick?.(
				{} as React.MouseEvent<HTMLButtonElement>,
			);
		click("Copy original");
		await vi.waitFor(() => expect(clipboard.notice).toHaveBeenCalledWith("Copied."));
		clipboard.copy.mockResolvedValueOnce(false);
		click("Copy translation");
		await vi.waitFor(() =>
			expect(clipboard.notice).toHaveBeenCalledWith(
				"Could not copy. You can select and copy the text manually.",
			),
		);
		expect(clipboard.copy.mock.calls).toEqual([[draft.text], [draft.translation]]);
		click("Discard this draft");
		expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: "discard-deleted-draft", draft });
	});

	it("renders the pending write without closing the editor after submission", () => {
		hooks.values = [];
		hooks.index = 0;
		const onAction = vi.fn(async () => undefined);
		const state = {
			cues: [],
			records: [],
			failedSaves: [],
			hasCandidate: false,
			selectedCueIds: ["cue-1"],
			rangeStart: 0,
			rangeEnd: 0,
			canPractice: false,
			deletedDrafts: [],
			editor: {
				cueId: "cue-1",
				text: "Draft",
				translation: "",
				busy: true,
				conflict: false,
				deleted: false,
				failure: null,
				confirmingReload: false,
				canSave: false,
			},
		} as unknown as ShadowingWorkspaceState;
		const tree = ShadowingWorkspace({
			language: "zh",
			currentTime: 0,
			duration: 30,
			state,
			onAction,
		});
		const markup = renderToStaticMarkup(tree);
		expect(markup).toContain('aria-busy="true"');
		expect(markup).toContain("Draft");
		const save = findButton(tree, (button) => button.props.children === "正在保存…");
		expect(save.props.disabled).toBe(true);
	});
});
