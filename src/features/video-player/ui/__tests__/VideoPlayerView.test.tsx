import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { FlashcardButton } from "../../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../../core/ui/primitives/Header";
import { ReorderableList, SortableRow } from "../../../../core/ui/primitives/Sortable/Sortable";
import type { SortableInteraction } from "../../../../core/ui/primitives/Sortable/sortableInteraction";
import type { VideoPlayerSnapshot } from "../../domain/types";
import type { VideoPlayerRuntime } from "../../domain/videoPlayerRuntime";
import { normalizeVideoPlayerSettings } from "../../settings/slice";
import { videoPlayerStrings } from "../../strings/videoPlayer";
import styles from "../VideoPlayer.module.scss";
import { VideoPlayerView, type ShadowingViewBridge } from "../VideoPlayerView";
import type { PlayerViewMount } from "../playerViewInteraction";

const tooltipApi = vi.hoisted(() => ({ setTooltip: vi.fn() }));
vi.mock("obsidian", () => tooltipApi);

// Render the view's adapter boundary in node; shared sorting sensors and DOM
// gestures are covered by the primitive's own tests.
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
	useCallback: (callback: unknown) => callback,
}));

// Replace only the React hook lifecycle; reorder behavior uses the real shared module.
const sortingAdapter = vi.hoisted(() => ({
	interaction: null as SortableInteraction | null,
}));
vi.mock("../../../../core/ui/primitives/Sortable/Sortable", async (original) => {
	const actual =
		await original<typeof import("../../../../core/ui/primitives/Sortable/Sortable")>();
	const { SortableInteraction } =
		await import("../../../../core/ui/primitives/Sortable/sortableInteraction");
	return {
		...actual,
		useSortableInteraction: (input: ConstructorParameters<typeof SortableInteraction>[0]) => {
			if (!sortingAdapter.interaction) {
				sortingAdapter.interaction = new SortableInteraction(input);
				sortingAdapter.interaction.mount();
			} else {
				sortingAdapter.interaction.update(input);
			}
			return {
				interaction: sortingAdapter.interaction,
				snapshot: sortingAdapter.interaction.getSnapshot(),
			};
		},
	};
});

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
	sortingAdapter.interaction = null;
	const reorderSources = vi.fn();
	const selectSource = vi.fn();
	const addSources = vi.fn();
	const onPickVideos = vi.fn(async () => [{ id: "fourth", name: "fourth", path: "fourth.mp4" }]);
	let queueExpanded = true;
	const act = vi.fn(() => ({ kind: "applied" as const }));
	const snapshot: VideoPlayerSnapshot = {
		sources: ["first", "second", "third"].map((id) => ({
			id,
			name: id === "third" ? "A long video filename that exceeds the queue width.mp4" : id,
			path: `${id}.mp4`,
		})),
		currentSourceId: "second",
		completedSourceIds: ["first"],
		progressBySource: { third: 20 },
		currentTime: 15,
		duration: 120,
		playbackRate: 1,
		playing: true,
		error: null,
		queueExpanded: true,
		floatingRect: null,
	};
	const runtime = {
		getSnapshot: () => snapshot,
		subscribe: vi.fn(),
		reorderSources,
		selectSource,
		addSources,
	} as unknown as VideoPlayerRuntime;
	const view: PlayerViewMount = {
		getSnapshot: () => ({
			role: "presenter",
			queueExpanded,
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
		act,
		dispose: vi.fn(),
	};
	const render = (shadowing?: ShadowingViewBridge) =>
		VideoPlayerView({
			runtime,
			view,
			language: "en",
			rootEl: { ownerDocument: {} } as HTMLElement,
			settings: normalizeVideoPlayerSettings(undefined),
			onFocusExisting: vi.fn(),
			onOpenSettings: vi.fn(),
			onPickVideos,
			onPickReplacement: vi.fn(async () => null),
			shadowing,
		});
	let list: React.ReactElement<React.ComponentProps<typeof ReorderableList>>;
	function rerender() {
		list = findElement<React.ComponentProps<typeof ReorderableList>>(
			render(),
			(element) => element.type === ReorderableList,
		);
		return list;
	}
	rerender();
	function row(id: string) {
		return findElement<React.ComponentProps<typeof SortableRow>>(
			list.props.children,
			(element) => element.type === SortableRow && element.props.id === id,
		);
	}
	function content(id: string) {
		return row(id).props.children(<button type="button" aria-label="shared drag handle" />);
	}
	return {
		reorderSources,
		selectSource,
		addSources,
		onPickVideos,
		act,
		setQueueExpanded: (expanded: boolean) => {
			queueExpanded = expanded;
		},
		render,
		snapshot,
		get list() {
			return list;
		},
		row,
		content,
		rerender,
	};
}

describe("video queue view", () => {
	it("keeps a compact queue bar and opens the list on demand", () => {
		const h = harness();
		const expanded = h.render();
		const layout = (tree: React.ReactNode) =>
			findElement<React.ComponentProps<"div">>(
				tree,
				(element) =>
					element.type === "div" &&
					element.props.className?.includes(styles.layout) === true,
			);
		const queue = (tree: React.ReactNode) =>
			findElement<React.ComponentProps<"aside">>(
				tree,
				(element) =>
					element.type === "aside" && element.props["aria-label"] === "Playback queue",
			);
		const toggle = (tree: React.ReactNode) =>
			findElement<React.ComponentProps<typeof FlashcardButton>>(
				tree,
				(element) =>
					element.type === FlashcardButton &&
					element.props["aria-expanded"] !== undefined,
			);
		expect(layout(expanded).props.className).not.toContain(styles.layoutWithShadow);
		expect(toggle(expanded).props["aria-expanded"]).toBe(true);
		expect(
			findElement(toggle(expanded).props.children, (element) => element.type === ChevronUp),
		).toBeDefined();
		toggle(expanded).props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
		expect(h.act).toHaveBeenCalledWith({ type: "set-queue-expanded", expanded: false });

		h.setQueueExpanded(false);
		const collapsed = h.render();
		expect(layout(collapsed).props.className).not.toContain(styles.layoutWithShadow);
		expect(queue(collapsed).props.className).toContain(styles.queue);
		expect(toggle(collapsed).props["aria-expanded"]).toBe(false);
		expect(toggle(collapsed).props["aria-label"]).toBe(videoPlayerStrings("en").queueExpand);
		expect(
			findElement(
				toggle(collapsed).props.children,
				(element) => element.type === ChevronDown,
			),
		).toBeDefined();
		expect(() => findElement(collapsed, (element) => element.type === ReorderableList)).toThrow(
			"Expected view element",
		);
		expect(
			findElement<React.ComponentProps<typeof FlashcardButton>>(
				queue(collapsed),
				(element) =>
					element.type === FlashcardButton &&
					element.props.title === videoPlayerStrings("en").addVideos,
			),
		).toBeDefined();
		toggle(collapsed).props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
		expect(h.act).toHaveBeenLastCalledWith({ type: "set-queue-expanded", expanded: true });
	});

	it("shows the right subtitle panel only when the current video switch is on", () => {
		const h = harness();
		let enabled = false;
		const setEnabled = vi.fn(async (value: boolean) => {
			enabled = value;
		});
		const bridge = {
			getSnapshot: () => ({ enabled }),
			subscribe: () => () => undefined,
			setEnabled,
			act: vi.fn(async () => undefined),
		} as unknown as ShadowingViewBridge;
		const off = h.render(bridge);
		expect(
			findElement<React.ComponentProps<"input">>(
				off,
				(element) => element.type === "input" && element.props.type === "checkbox",
			).props.checked,
		).toBe(false);
		expect(() =>
			findElement<React.ComponentProps<"aside">>(
				off,
				(element) =>
					element.type === "aside" && element.props.className === styles.shadowSide,
			),
		).toThrow("Expected view element");

		const toggle = findElement<React.ComponentProps<"input">>(
			off,
			(element) => element.type === "input" && element.props.type === "checkbox",
		);
		toggle.props.onChange!({
			currentTarget: { checked: true },
		} as React.ChangeEvent<HTMLInputElement>);
		expect(setEnabled).toHaveBeenCalledWith(true);
		const on = h.render(bridge);
		expect(
			findElement<React.ComponentProps<"div">>(
				on,
				(element) =>
					element.type === "div" &&
					element.props.className?.includes(styles.layout) === true,
			).props.className,
		).toContain(styles.layoutWithShadow);
		expect(
			findElement<React.ComponentProps<"aside">>(
				on,
				(element) =>
					element.type === "aside" && element.props.className === styles.shadowSide,
			),
		).toBeDefined();
	});

	it("offers video import only from the queue and keeps the icon accessible", async () => {
		const h = harness();
		const tree = h.render();
		const copy = videoPlayerStrings("en");
		const header = findElement<React.ComponentProps<typeof FlashcardHeader>>(
			tree,
			(element) => element.type === FlashcardHeader,
		);
		expect(() =>
			findElement<React.ComponentProps<typeof FlashcardButton>>(
				header.props.right,
				(element) =>
					element.type === FlashcardButton && element.props.title === copy.addVideos,
			),
		).toThrow("Expected view element");
		const add = findElement<React.ComponentProps<typeof FlashcardButton>>(
			tree,
			(element) => element.type === FlashcardButton && element.props.title === copy.addVideos,
		);
		expect(add.props.preset).toBe("icon");
		expect(add.props["aria-label"]).toBe(copy.addVideos);
		expect(add.props.children).toBeUndefined();
		add.props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
		await vi.waitFor(() =>
			expect(h.addSources).toHaveBeenCalledExactlyOnceWith([
				{ id: "fourth", name: "fourth", path: "fourth.mp4" },
			]),
		);
		expect(h.onPickVideos).toHaveBeenCalledOnce();
	});

	it("passes source IDs and language to shared sorting and persists the moved order", () => {
		const h = harness();
		expect(h.list.props.interaction.getSnapshot().items).toEqual(["first", "second", "third"]);
		expect(h.list.props.language).toBe("en");
		h.list.props.interaction.beginDrag("first");
		h.list.props.interaction.drop("first", "third");
		expect(h.reorderSources).toHaveBeenCalledExactlyOnceWith(["second", "third", "first"]);
		expect(h.selectSource).not.toHaveBeenCalled();
		expect(h.snapshot.currentSourceId).toBe("second");
	});

	it("keeps source selection separate from sorting and preserves progress labels", () => {
		const h = harness();
		const source = findElement<React.ComponentProps<typeof FlashcardButton>>(
			h.content("third"),
			(element) =>
				element.type === FlashcardButton &&
				element.props.className === styles.sourceContent,
		);
		source.props.onClick!({} as React.MouseEvent<HTMLButtonElement>);
		expect(h.selectSource).toHaveBeenCalledExactlyOnceWith("third");
		expect(h.act).toHaveBeenCalledWith({ type: "set-queue-expanded", expanded: false });
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

	it("shows the full video name with an Obsidian tooltip on hover", () => {
		tooltipApi.setTooltip.mockClear();
		const h = harness();
		const source = findElement<React.ComponentPropsWithRef<typeof FlashcardButton>>(
			h.content("third"),
			(element) =>
				element.type === FlashcardButton &&
				element.props.className === styles.sourceContent,
		);
		const element = {} as HTMLButtonElement;
		if (typeof source.props.ref !== "function") throw new Error("Expected a tooltip ref");
		source.props.ref(element);
		expect(tooltipApi.setTooltip).toHaveBeenCalledExactlyOnceWith(
			element,
			"A long video filename that exceeds the queue width.mp4",
			{ placement: "top", classes: [styles.sourceNameTooltip] },
		);
	});

	it("renders only the shared handle and removes native drag event wiring", () => {
		const h = harness();
		for (const id of h.list.props.interaction.getSnapshot().items) {
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

	it("coordinates drag and move buttons through one busy interaction", async () => {
		const h = harness();
		const interaction = h.list.props.interaction;
		interaction.beginDrag("first");
		interaction.drop("first", "third");
		expect(interaction.getSnapshot().busy).toBe(true);
		h.rerender();
		expect(h.list.props.interaction).toBe(interaction);
		const down = findElement<{ label?: string; disabled?: boolean; onClick(): void }>(
			h.content("first"),
			(element) => element.props.label === "Move down",
		);
		expect(down.props.disabled).toBe(true);
		// A stale handler must also respect the shared lock.
		down.props.onClick();
		expect(h.reorderSources).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		h.rerender();
		const availableDown = findElement<{ label?: string; disabled?: boolean; onClick(): void }>(
			h.content("first"),
			(element) => element.props.label === "Move down",
		);
		expect(availableDown.props.disabled).toBe(false);
		availableDown.props.onClick();
		expect(h.reorderSources).toHaveBeenNthCalledWith(2, ["second", "first", "third"]);
		expect(interaction.getSnapshot().busy).toBe(true);
		interaction.beginDrag("third");
		interaction.drop("third", "first");
		expect(h.reorderSources).toHaveBeenCalledTimes(2);
	});
});
