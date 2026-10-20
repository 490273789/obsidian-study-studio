import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { AudioPracticeRuntime } from "../../domain/audioPracticeRuntime";
import { audioFailure } from "../../domain/failures";
import { emptyAudioPracticeData } from "../../domain/repository";
import type {
	AudioMaterial,
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
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

interface ElementProps {
	children?: React.ReactNode;
	material?: AudioMaterial;
	error?: string | null;
	busy?: boolean;
	disabled?: boolean;
	role?: string;
	"aria-label"?: string;
	"aria-current"?: string;
	onClick?(): void;
	onCancel?(): void;
	onSubmit?(value: typeof input): void;
	onReadText?(path: string): Promise<string>;
}
const input = {
	title: "Revised",
	audioPath: "old.mp3",
	subtitlePath: "new.srt",
	originalText: "New text",
};
function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
	const result: React.ReactElement<ElementProps>[] = [];
	React.Children.forEach(node, (child) => {
		if (!React.isValidElement<ElementProps>(child)) return;
		result.push(child, ...elements(child.props.children));
	});
	return result;
}
function dialog(node: React.ReactNode) {
	const found = elements(node).find(
		(element) => element.props.onSubmit && element.props.onReadText,
	);
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
			resolve = yes;
			reject = no;
		});
	};
	const runtime = {
		getSnapshot: () => snapshot,
		subscribe: () => () => {},
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
	return {
		material,
		runtime,
		update(value: Partial<AudioPracticeSnapshot>) {
			snapshot = { ...snapshot, ...value };
		},
		snapshot: () => snapshot,
		succeed() {
			snapshot = {
				...snapshot,
				materialOperation: { ...snapshot.materialOperation, status: "succeeded" },
			};
			resolve();
		},
		fail() {
			const failure = { kind: "persist-failed" } as const;
			snapshot = {
				...snapshot,
				materialOperation: { ...snapshot.materialOperation, status: "failed", failure },
			};
			reject(audioFailure(failure));
		},
		view(mode: "add" | "edit" | null = "edit") {
			const values: unknown[] = [
				{ current: null },
				{ current: null },
				mode === "edit" ? { mode, material } : mode ? { mode } : null,
			];
			return () => {
				hooks.index = 0;
				hooks.values = values;
				return AudioPracticeView({
					runtime: runtime as unknown as AudioPracticeRuntime,
					language: "en",
					audioPaths: ["old.mp3"],
					subtitlePaths: ["old.srt", "new.srt"],
					textPaths: [],
					onReadText: async () => "",
					onOpenSettings: () => {},
				});
			};
		},
	};
}

describe("listening material operations view", () => {
	it("submits one edit, locks all views and closes only after success", async () => {
		const h = harness();
		const render = h.view();
		const other = h.view(null);
		const first = dialog(render());
		first.props.onSubmit!(input);
		first.props.onSubmit!(input);
		expect(h.runtime.editMaterial).toHaveBeenCalledExactlyOnceWith(
			"material",
			input,
			h.material,
		);
		expect(dialog(render()).props.busy).toBe(true);
		dialog(render()).props.onCancel!();
		expect(dialog(render())).toBeDefined();
		const buttons = elements(other()).filter(
			(node) =>
				node.props["aria-current"] ||
				node.props["aria-label"] === "Add material" ||
				node.props["aria-label"] === "Remove: Original",
		);
		expect(buttons.length).toBeGreaterThan(0);
		expect(buttons.every((node) => node.props.disabled)).toBe(true);
		h.succeed();
		await flush();
		expect(elements(render()).some((node) => node.props.onSubmit)).toBe(false);
	});

	it.each(["add", "edit"] as const)(
		"shows failed %s inside its originating dialog and in other views",
		async (mode) => {
			const h = harness();
			const render = h.view(mode);
			const other = h.view(mode);
			dialog(render()).props.onSubmit!(input);
			h.fail();
			await flush();
			expect(dialog(render()).props.error).toBeTruthy();
			expect(elements(render()).filter((node) => node.props.role === "alert")).toHaveLength(
				0,
			);
			expect(dialog(other()).props.error).toBeNull();
			expect(elements(other()).filter((node) => node.props.role === "alert")).toHaveLength(1);
		},
	);

	it("keeps the material chosen when the edit dialog opened", () => {
		const h = harness();
		const render = h.view();
		h.update({ currentMaterial: { ...h.material, id: "other" }, currentMaterialId: "other" });
		dialog(render()).props.onSubmit!(input);
		expect(h.runtime.editMaterial).toHaveBeenCalledWith("material", input, h.material);
	});

	it("allows add, selection and removal while generating and disables editing", () => {
		const h = harness();
		h.update({ draft: { ...h.snapshot().draft, status: "transcribing" } });
		const tree = h.view(null)();
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
			const render = h.view(null);
			const node = elements(render()).find((element) =>
				kind === "select"
					? element.props["aria-current"]
					: element.props["aria-label"]?.startsWith("Remove"),
			);
			node!.props.onClick!();
			h.fail();
			await flush();
			h.update({ failure: { kind: "missing-file" } });
			const alerts = elements(render()).filter((element) => element.props.role === "alert");
			expect(alerts).toHaveLength(2);
			elements(alerts[0]).find((element) => element.props.onClick)!.props.onClick!();
			expect(h.runtime.dismissMaterialOperationFailure).toHaveBeenCalledOnce();
			expect(
				elements(render()).filter((element) => element.props.role === "alert"),
			).toHaveLength(1);
		},
	);
});
