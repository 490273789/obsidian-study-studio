import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { AudioPracticeRuntime } from "../../domain/audioPracticeRuntime";
import { audioFailure } from "../../domain/failures";
import { emptyAudioPracticeData } from "../../domain/repository";
import type { AudioPracticeSnapshot } from "../../domain/types";
import { AudioPracticeView } from "../AudioPracticeView";

const hooks = vi.hoisted(() => ({
	index: 0,
	setters: [] as { index: number; value: unknown }[],
}));

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useState: (initial: unknown) => {
		const index = hooks.index++;
		return [
			index === 0 ? "edit" : initial,
			(value: unknown) => hooks.setters.push({ index, value }),
		];
	},
	useRef: (value: unknown) => ({ current: value }),
	useEffect: () => {},
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

interface MaterialDialogProps {
	onSubmit(value: {
		title: string;
		audioPath: string;
		subtitlePath: string | null;
		originalText: string;
	}): void;
	onReadText(path: string): Promise<string>;
}

function findMaterialDialog(node: React.ReactNode): React.ReactElement<MaterialDialogProps> {
	let found: React.ReactElement<MaterialDialogProps> | null = null;
	const visit = (children: React.ReactNode): void => {
		React.Children.forEach(children, (child) => {
			if (found || !React.isValidElement(child)) return;
			const element = child as React.ReactElement<MaterialDialogProps>;
			if ("onSubmit" in element.props && "onReadText" in element.props) found = element;
			else visit((child.props as { children?: React.ReactNode }).children);
		});
	};
	visit(node);
	if (!found) throw new Error("Expected material dialog");
	return found;
}

function renderEdit(editMaterial: AudioPracticeRuntime["editMaterial"]) {
	hooks.index = 0;
	hooks.setters = [];
	const material = {
		id: "material",
		title: "Original",
		audioPath: "old.mp3",
		subtitlePath: "old.srt",
		originalText: "Original text",
	};
	const snapshot: AudioPracticeSnapshot = {
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
	const runtime = {
		getSnapshot: () => snapshot,
		subscribe: () => () => {},
		editMaterial,
		dismissFailure: () => {},
	} as unknown as AudioPracticeRuntime;
	const view = AudioPracticeView({
		runtime,
		language: "en",
		audioPaths: ["old.mp3"],
		subtitlePaths: ["old.srt", "new.srt"],
		textPaths: [],
		onReadText: async () => "",
		onOpenSettings: () => {},
	});
	return findMaterialDialog(view);
}

describe("listening material edit view", () => {
	it("submits one semantic edit and closes only after it succeeds", async () => {
		const editMaterial = vi.fn(async () => {});
		const dialog = renderEdit(editMaterial);
		const input = {
			title: "Revised",
			audioPath: "old.mp3",
			subtitlePath: "new.srt",
			originalText: "New text",
		};
		dialog.props.onSubmit(input);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(editMaterial).toHaveBeenCalledOnce();
		expect(editMaterial).toHaveBeenCalledWith("material", input);
		expect(hooks.setters).toContainEqual({ index: 0, value: null });
	});

	it("leaves the dialog open and reports a failed edit", async () => {
		const editMaterial = vi.fn(async () => {
			throw audioFailure({ kind: "persist-failed" });
		});
		const dialog = renderEdit(editMaterial);
		dialog.props.onSubmit({
			title: "Revised",
			audioPath: "old.mp3",
			subtitlePath: "new.srt",
			originalText: "New text",
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(hooks.setters).not.toContainEqual({ index: 0, value: null });
		expect(hooks.setters).toContainEqual({
			index: 2,
			value: { kind: "persist-failed" },
		});
	});
});
