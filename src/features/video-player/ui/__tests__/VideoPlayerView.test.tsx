import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { ReorderableList, SortableRow } from "../../../../core/ui/primitives/Sortable/Sortable";
import type { VideoPlayerSnapshot } from "../../domain/types";
import type { VideoPlayerRuntime } from "../../domain/videoPlayerRuntime";
import { normalizeVideoPlayerSettings } from "../../settings/slice";
import { videoPlayerStrings } from "../../strings/videoPlayer";
import { VideoPlayerView } from "../VideoPlayerView";
import type { PlayerViewMount } from "../playerViewInteraction";

// Render the view's adapter boundary in node; shared sorting sensors and DOM
// gestures are covered by the primitive's own tests.
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
	useCallback: (callback: unknown) => callback,
}));

function findElement<P>(
	node: React.ReactNode,
	predicate: (element: React.ReactElement<P>) => boolean,
): React.ReactElement<P> {
	let found: React.ReactElement<P> | undefined;
	function visit(children: React.ReactNode): void {
		React.Children.forEach(children, (child) => {
			if (found || !React.isValidElement(child)) return;
			const element = child as React.ReactElement<P>;
			if (predicate(element)) found = element;
			else {
				const nested = (child.props as { children?: React.ReactNode }).children;
				if (typeof nested !== "function") visit(nested);
			}
		});
	}
	visit(node);
	if (!found) throw new Error("Expected view element");
	return found;
}

function expectNoNativeDrag(node: React.ReactNode): void {
	React.Children.forEach(node, (child) => {
		if (!React.isValidElement(child)) return;
		const props = child.props as { children?: React.ReactNode };
		for (const property of ["draggable", "onDragStart", "onDragOver", "onDrop"]) {
			expect(props).not.toHaveProperty(property);
		}
		if (typeof props.children !== "function") expectNoNativeDrag(props.children);
	});
}

function harness() {
	const reorderSources = vi.fn();
	const selectSource = vi.fn();
	const snapshot: VideoPlayerSnapshot = {
		sources: ["first", "second", "third"].map((id) => ({ id, name: id, path: `${id}.mp4` })),
		currentSourceId: "second",
		completedSourceIds: ["first"],
		progressBySource: { third: 20 },
		currentTime: 15,
		duration: 120,
		playbackRate: 1,
		playing: true,
		error: null,
	};
	const runtime = {
		getSnapshot: () => snapshot,
		subscribe: vi.fn(),
		reorderSources,
		selectSource,
	} as unknown as VideoPlayerRuntime;
	const view: PlayerViewMount = {
		getSnapshot: () => ({
			role: "presenter",
			queueExpanded: true,
			presentation: { kind: "docked" },
		}),
		subscribe: () => () => {},
		refs: {
			focusSurface: vi.fn(),
			mediaHost: vi.fn(),
			floatingHeader: vi.fn(),
			resizeLeft: vi.fn(),
			resizeRight: vi.fn(),
		},
		act: () => ({ kind: "applied" }),
		dispose: vi.fn(),
	};
	const tree = VideoPlayerView({
		runtime,
		view,
		language: "en",
		rootEl: { ownerDocument: {} } as HTMLElement,
		settings: normalizeVideoPlayerSettings(undefined),
		onFocusExisting: vi.fn(),
		onOpenSettings: vi.fn(),
		onPickVideos: vi.fn(async () => []),
		onPickReplacement: vi.fn(async () => null),
	});
	const list = findElement<React.ComponentProps<typeof ReorderableList>>(
		tree,
		(element) => element.type === ReorderableList,
	);
	function row(id: string) {
		return findElement<React.ComponentProps<typeof SortableRow>>(
			list.props.children,
			(element) => element.type === SortableRow && element.props.id === id,
		);
	}
	function content(id: string) {
		return row(id).props.children(<button type="button" aria-label="shared drag handle" />);
	}
	return { reorderSources, selectSource, snapshot, list, row, content };
}

describe("video queue sorting", () => {
	it("passes source IDs and language to shared sorting and persists the moved order", async () => {
		const h = harness();
		expect(h.list.props.items).toEqual(["first", "second", "third"]);
		expect(h.list.props.language).toBe("en");
		await h.list.props.onMove(0, 2);
		expect(h.reorderSources).toHaveBeenCalledExactlyOnceWith(["second", "third", "first"]);
		expect(h.selectSource).not.toHaveBeenCalled();
		expect(h.snapshot.currentSourceId).toBe("second");
	});

	it("keeps source selection separate from sorting and preserves progress labels", () => {
		const h = harness();
		const source = findElement<React.ComponentProps<"button">>(
			h.content("third"),
			(element) => element.type === "button" && element.props.title === "third\nthird.mp4",
		);
		source.props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
		expect(h.selectSource).toHaveBeenCalledExactlyOnceWith("third");
		expect(h.reorderSources).not.toHaveBeenCalled();
		for (const [id, label] of [
			["first", "Completed"],
			["second", "0:15 / 2:00"],
			["third", "Watched 0:20"],
		] as const) {
			expect(
				findElement<{ children?: React.ReactNode }>(
					h.content(id),
					(element) => element.type === "span" && element.props.children === label,
				),
			).toBeDefined();
		}
	});

	it("renders only the shared handle and removes native drag event wiring", () => {
		const h = harness();
		for (const id of h.list.props.items) {
			const row = h.row(id);
			expect(row.props.handleLabel).toBe(videoPlayerStrings("en").dragToReorder);
			expect(row.props).not.toHaveProperty("onDrop");
			expect(row.props).not.toHaveProperty("onDragOver");
			const handle = findElement<React.ComponentProps<"button">>(
				h.content(id),
				(element) => element.props["aria-label"] === "shared drag handle",
			);
			expect(handle.type).toBe("button");
			expectNoNativeDrag(h.content(id));
		}
	});

	it("keeps move buttons and boundary availability", () => {
		const h = harness();
		const up = findElement<{ label?: string; disabled?: boolean; onClick(): void }>(
			h.content("first"),
			(element) => element.props.label === "Move up",
		);
		const down = findElement<{ label?: string; disabled?: boolean; onClick(): void }>(
			h.content("first"),
			(element) => element.props.label === "Move down",
		);
		expect(up.props.disabled).toBe(true);
		expect(down.props.disabled).toBe(false);
		down.props.onClick();
		expect(h.reorderSources).toHaveBeenCalledExactlyOnceWith(["second", "first", "third"]);
		const lastDown = findElement<{ label?: string; disabled?: boolean }>(
			h.content("third"),
			(element) => element.props.label === "Move down",
		);
		expect(lastDown.props.disabled).toBe(true);
	});
});
