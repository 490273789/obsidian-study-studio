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
import { AudioPracticeView } from "../AudioPracticeView";

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
				values[index] = value;
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
	onClick?: () => void;
	onCancel?: () => void;
	onSubmit?: () => void;
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
		draft: {
			status: "idle",
			cues: [],
			hasReviewWordTimings: false,
			completedChunks: 0,
			totalChunks: 0,
			failure: null,
			error: null,
			notice: null,
		},
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
		h.update({ draft: { ...h.snapshot().draft, status: "transcribing" } });
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
