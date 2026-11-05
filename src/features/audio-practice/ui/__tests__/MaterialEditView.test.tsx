import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { AudioPracticeRuntime } from "../../domain/audioPracticeRuntime";
import { audioFailure } from "../../domain/failures";
import { emptyAudioPracticeData } from "../../domain/repository";
import type {
	AudioPracticeCatalog,
	AudioPracticeSnapshot,
	MaterialOperationKind,
} from "../../domain/types";
import type { SubtitleDraftSnapshot } from "../../domain/subtitleDraftEngine";
import { AudioPracticeView } from "../AudioPracticeView";
import { PracticeSummary } from "../PracticeSummary";

const hooks = vi.hoisted(() => ({
	index: 0,
	values: [] as unknown[],
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.index++;
		if (!(index in hooks.values)) hooks.values[index] = initial;
		const values = hooks.values;
		return [
			values[index],
			(value: unknown) => {
				values[index] =
					typeof value === "function"
						? (value as (previous: unknown) => unknown)(values[index])
						: value;
			},
		];
	},
	useRef: (initial: unknown) => {
		const index = hooks.index++;
		if (!(index in hooks.values)) hooks.values[index] = { current: initial };
		return hooks.values[index];
	},
	useEffect: () => {},
	useMemo: (build: () => unknown) => {
		const index = hooks.index++;
		if (!(index in hooks.values)) hooks.values[index] = build();
		return hooks.values[index];
	},
	useId: () => "test-id",
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

interface ElementProps {
	children?: React.ReactNode;
	error?: string | null;
	busy?: boolean;
	disabled?: boolean;
	role?: string;
	"aria-label"?: string;
	"aria-current"?: string;
	"aria-expanded"?: boolean;
	"data-library-collapsed"?: boolean;
	onClick?: () => void;
	onCancel?: () => void;
	onSubmit?: () => void;
	onConfirm?: () => void;
	title?: string;
	message?: string;
	onField?: (field: string, value: string) => void;
	onText?: (value: string) => void;
	onReadTextFile?: (path: string) => void;
}

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
	const result: React.ReactElement<ElementProps>[] = [];
	React.Children.forEach(node, (child) => {
		if (!React.isValidElement<ElementProps>(child)) return;
		result.push(child, ...elements(child.props.children));
	});
	return result;
}

function dialog(node: React.ReactNode): React.ReactElement<ElementProps> {
	const found = elements(node).find((element) => element.props.onSubmit && element.props.onField);
	if (!found) throw new Error("Expected material dialog");
	return found;
}

function confirmDialog(node: React.ReactNode): React.ReactElement<ElementProps> {
	const found = elements(node).find((element) => element.props.onConfirm);
	if (!found) throw new Error("Expected confirm dialog");
	return found;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function harness() {
	const material = {
		id: "material",
		title: "Original",
		audioPath: "old.mp3",
		subtitlePath: "old.srt",
		originalText: "Original text",
	};
	let snapshot: AudioPracticeSnapshot = {
		...emptyAudioPracticeData(),
		materials: [material],
		currentMaterialId: material.id,
		currentMaterial: material,
		cues: [],
		currentCueId: null,
		currentTime: 0,
		duration: null,
		playing: false,
		revealed: false,
		loading: false,
		failure: null,
		invalidatedMarks: 0,
		materialOperation: { id: 0, kind: null, materialId: null, status: "idle", failure: null },
	};
	let draftSnapshot: SubtitleDraftSnapshot = {
		status: "idle",
		cues: [],
		hasReviewWordTimings: false,
		completedChunks: 0,
		totalChunks: 0,
		duration: 0,
		failure: null,
		error: null,
		notice: null,
		taskKey: null,
	};
	const draftEngine = {
		subscribe: () => () => {},
		getSnapshot: () => draftSnapshot,
		generateForMaterial: async () => false,
		commitForMaterial: async () => false,
		cancel: () => {},
		dismissFailure: () => {},
		act: () => {},
	};
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const operation = (kind: MaterialOperationKind, materialId: string | null) => {
		snapshot = {
			...snapshot,
			materialOperation: {
				id: snapshot.materialOperation.id + 1,
				kind,
				materialId,
				status: "pending",
				failure: null,
			},
		};
		return new Promise<void>((yes, no) => {
			resolve = () => {
				snapshot = {
					...snapshot,
					materialOperation: { ...snapshot.materialOperation, status: "succeeded" },
				};
				yes();
			};
			reject = (error) => {
				snapshot = {
					...snapshot,
					materialOperation: {
						...snapshot.materialOperation,
						status: "failed",
						failure: { kind: "persist-failed" },
					},
				};
				no(error);
			};
		});
	};
	const runtime = {
		getSnapshot: () => snapshot,
		subscribe: () => () => {},
		pause: () => {},
		cancelSubtitleGeneration: () => {},
		bindMedia: () => () => {},
		editMaterial: vi.fn((id: string) => operation("edit", id)),
		addMaterial: vi.fn(() => operation("add", null)),
		selectMaterial: vi.fn((id: string) => operation("select", id)),
		removeMaterial: vi.fn((id: string) => operation("remove", id)),
		dismissMaterialOperationFailure: vi.fn(() => {
			snapshot = {
				...snapshot,
				materialOperation: { ...snapshot.materialOperation, failure: null },
			};
		}),
	};
	const files = {
		readText: async () => "read text",
		stat: () => ({ size: 1024, mtime: 10 }),
		mediaUrl: (path: string) => path,
		exists: () => true,
		writeSubtitle: async () => "generated.srt",
	};
	const catalog: AudioPracticeCatalog = {
		list: () => ({
			audioPaths: ["old.mp3", "new.mp3"],
			subtitlePaths: ["old.srt", "new.srt"],
			textPaths: ["note.md"],
		}),
		subscribe: () => () => {},
	};
	const primaryValues: unknown[] = [];
	const otherValues: unknown[] = [];
	const renderWith = (values: unknown[]) => {
		hooks.index = 0;
		hooks.values = values;
		return AudioPracticeView({
			runtime: runtime as unknown as AudioPracticeRuntime,
			draftEngine: draftEngine as never,
			files: files as never,
			catalog,
			language: "en",
			onOpenSettings: () => {},
		});
	};
	const view = () => renderWith(primaryValues);
	const other = () => renderWith(otherValues);
	const click = (node: React.ReactNode, label: string) => {
		const element = elements(node).find((item) => item.props["aria-label"] === label);
		if (!element?.props.onClick) throw new Error(`Missing action ${label}`);
		element.props.onClick();
	};
	return {
		material,
		runtime,
		view,
		other,
		setDraftStatus(status: SubtitleDraftSnapshot["status"]) {
			draftSnapshot = { ...draftSnapshot, status };
		},
		clickEdit() {
			click(view(), "Edit title and reference text");
		},
		clickAdd() {
			click(view(), "Add material");
		},
		update(value: Partial<AudioPracticeSnapshot>) {
			snapshot = { ...snapshot, ...value };
		},
		snapshot: () => snapshot,
		succeed: () => resolve(),
		fail: () => reject(audioFailure({ kind: "persist-failed" })),
	};
}

describe("listening material operations view", () => {
	it("places the library after practice and toggles its collapsed state", () => {
		const h = harness();
		const workspace = () =>
			elements(h.view()).find(
				(element) => element.props["data-library-collapsed"] !== undefined,
			)!;
		const children = React.Children.toArray(workspace().props.children).filter(
			React.isValidElement,
		);
		expect(children.map((child) => child.type)).toEqual(["main", "aside"]);
		const toggle = (label: string) =>
			elements(h.view()).find((element) => element.props["aria-label"] === label)!;
		expect(toggle("Collapse materials").props["aria-expanded"]).toBe(true);
		toggle("Collapse materials").props.onClick!();
		expect(workspace().props["data-library-collapsed"]).toBe(true);
		expect(toggle("Expand materials").props["aria-expanded"]).toBe(false);
		toggle("Expand materials").props.onClick!();
		expect(workspace().props["data-library-collapsed"]).toBe(false);
	});

	it("submits one edit, locks all views and closes only after success", async () => {
		const h = harness();
		h.clickEdit();
		const first = dialog(h.view());
		first.props.onSubmit!();
		first.props.onSubmit!();
		expect(h.runtime.editMaterial).toHaveBeenCalledExactlyOnceWith(
			"material",
			{
				title: "Original",
				audioPath: "old.mp3",
				subtitlePath: "old.srt",
				originalText: "Original text",
			},
			h.material,
		);
		expect(dialog(h.view()).props.busy).toBe(true);
		dialog(h.view()).props.onCancel!();
		expect(dialog(h.view())).toBeDefined();
		const buttons = elements(h.other()).filter(
			(node) =>
				node.props["aria-current"] ||
				node.props["aria-label"] === "Add material" ||
				node.props["aria-label"] === "Remove: Original",
		);
		expect(buttons.length).toBeGreaterThan(0);
		expect(buttons.every((node) => node.props.disabled)).toBe(true);
		h.succeed();
		await flush();
		expect(elements(h.view()).some((node) => node.props.onSubmit)).toBe(false);
	});

	it.each(["add", "edit"] as const)(
		"shows failed %s inside its originating dialog and in other views",
		async (mode) => {
			const h = harness();
			if (mode === "edit") h.clickEdit();
			else h.clickAdd();
			dialog(h.view()).props.onSubmit!();
			h.fail();
			await flush();
			const treeNow = h.view();
			expect(dialog(treeNow).props.error).toBeTruthy();
			expect(elements(h.view()).filter((node) => node.props.role === "alert")).toHaveLength(
				0,
			);

			expect(
				elements(h.other()).some(
					(element) => (element.type as { name?: string }).name === "MaterialDialog",
				),
			).toBe(false);
			expect(elements(h.other()).filter((node) => node.props.role === "alert")).toHaveLength(
				1,
			);

			dialog(treeNow).props.onCancel!();
			expect(h.runtime.dismissMaterialOperationFailure).toHaveBeenCalledOnce();
			expect(
				elements(h.view()).some(
					(element) => (element.type as { name?: string }).name === "MaterialDialog",
				),
			).toBe(false);
		},
	);

	it("keeps the material chosen when the edit dialog opened", () => {
		const h = harness();
		h.clickEdit();
		h.update({ currentMaterial: { ...h.material, id: "other" }, currentMaterialId: "other" });
		dialog(h.view()).props.onSubmit!();
		expect(h.runtime.editMaterial).toHaveBeenCalledWith(
			"material",
			expect.objectContaining({ title: "Original" }),
			h.material,
		);
	});

	it("allows add, selection and removal while generating and disables editing", () => {
		const h = harness();
		h.setDraftStatus("transcribing");
		const tree = h.view();
		const nodes = elements(tree);
		expect(nodes.find((node) => node.props["aria-current"])!.props.disabled).toBe(false);
		expect(
			nodes.find((node) => node.props["aria-label"]?.startsWith("Remove"))!.props.disabled,
		).toBe(false);
		expect(
			nodes.find((node) => node.props["aria-label"] === "Edit title and reference text")!
				.props.disabled,
		).toBe(true);
		expect(
			nodes.find((node) => node.props["aria-label"] === "Add material")!.props.disabled,
		).toBe(false);
	});

	it("shows a loading state instead of the empty state while materials load", () => {
		const h = harness();
		const bodyText = () =>
			elements(h.view())
				.map((element) => element.props.children)
				.filter((child): child is string => typeof child === "string");
		h.update({ currentMaterial: null, currentMaterialId: null });
		expect(bodyText()).toContain("Add audio to practice listening and speaking");
		h.update({ loading: true });
		expect(bodyText()).toContain("Loading materials…");
		expect(bodyText()).not.toContain("Add audio to practice listening and speaking");
	});

	it("shows the marked-sentence count on the material row", () => {
		const h = harness();
		const selectLabel = () =>
			elements(h.view()).find((element) => element.props["aria-current"] === "true")?.props[
				"aria-label"
			];
		expect(selectLabel()).toBeUndefined();
		h.update({
			progress: {
				material: { time: 0, cueId: null, difficultCueIds: ["cue-1", "cue-2"], offset: 0 },
			},
		});
		expect(selectLabel()).toBe("Original · 2 marked difficult");
	});

	it("surfaces the session summary only once the last sentence is reached", () => {
		const h = harness();
		const cues = [
			{ id: "cue-1", text: "First", start: 0, end: 2 },
			{ id: "cue-2", text: "Second", start: 2, end: 4 },
		];
		h.update({ cues, currentCueId: "cue-1", currentTime: 1, duration: 4 });
		expect(elements(h.view()).some((element) => element.type === PracticeSummary)).toBe(false);

		h.update({ currentCueId: "cue-2", currentTime: 4 });
		expect(elements(h.view()).some((element) => element.type === PracticeSummary)).toBe(true);
	});

	it("asks before removing a material record", () => {
		const h = harness();
		const removeButton = () =>
			elements(h.view()).find(
				(element) => element.props["aria-label"] === "Remove record: Original",
			)!;
		removeButton().props.onClick!();
		expect(h.runtime.removeMaterial).not.toHaveBeenCalled();
		const confirmation = confirmDialog(h.view());
		expect(confirmation.props.title).toBe("Remove material");
		expect(confirmation.props.message).toContain("Original");

		confirmation.props.onCancel!();
		expect(h.runtime.removeMaterial).not.toHaveBeenCalled();
		expect(elements(h.view()).some((element) => element.props.onConfirm)).toBe(false);

		removeButton().props.onClick!();
		confirmDialog(h.view()).props.onConfirm!();
		expect(h.runtime.removeMaterial).toHaveBeenCalledExactlyOnceWith("material");
		expect(elements(h.view()).some((element) => element.props.onConfirm)).toBe(false);
	});

	it.each(["select", "remove"] as const)(
		"shows %s failure with a shared dismissal that preserves other failures",
		async (kind) => {
			const h = harness();
			const tree = h.view();
			const node = elements(tree).find((element) =>
				kind === "select"
					? element.props["aria-current"]
					: element.props["aria-label"]?.startsWith("Remove"),
			);
			node!.props.onClick!();
			if (kind === "remove") confirmDialog(h.view()).props.onConfirm!();
			h.fail();
			await flush();
			h.update({ failure: { kind: "missing-file" } });
			const alerts = elements(h.view()).filter((element) => element.props.role === "alert");
			expect(alerts).toHaveLength(2);
			elements(alerts[0]).find((element) => element.props.onClick)!.props.onClick!();
			expect(h.runtime.dismissMaterialOperationFailure).toHaveBeenCalledOnce();
			expect(
				elements(h.view()).filter((element) => element.props.role === "alert"),
			).toHaveLength(1);
		},
	);
});
