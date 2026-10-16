import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	type DragEndEvent,
	type DragStartEvent,
	type DndContextProps,
} from "@dnd-kit/core";
import { ReorderableList, SortableRow, sortableAccessibility } from "../Sortable";
import { SortableInteraction } from "../sortableInteraction";

const cleanups = vi.hoisted(() => [] as (() => void)[]);
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
	useLayoutEffect: (effect: () => () => void) => cleanups.push(effect()),
}));
vi.mock("@dnd-kit/core", async (original) => ({
	...(await original<typeof import("@dnd-kit/core")>()),
	useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
	useSensors: (...sensors: unknown[]) => sensors,
}));
const sortable = vi.hoisted(() => ({
	attributes: { role: "button", tabIndex: 0 },
	listeners: { onMouseDown: vi.fn(), onTouchStart: vi.fn(), onKeyDown: vi.fn() },
	setNodeRef: vi.fn(),
	setActivatorNodeRef: vi.fn(),
	transform: { x: 0, y: 38, scaleX: 1, scaleY: 1 },
	transition: "transform 200ms ease",
	isDragging: false,
}));
vi.mock("@dnd-kit/sortable", async (original) => ({
	...(await original<typeof import("@dnd-kit/sortable")>()),
	useSortable: () => sortable,
}));

beforeEach(() => {
	cleanups.splice(0);
	sortable.isDragging = false;
});

function harness() {
	const onMove = vi.fn();
	const interaction = new SortableInteraction({ items: ["a", "b", "c"], onMove });
	interaction.mount();
	function render() {
		return ReorderableList({ interaction, language: "zh", children: null })
			.props as DndContextProps;
	}
	return { onMove, interaction, render };
}

describe("shared sortable adapter", () => {
	it("uses mouse, long-press touch and keyboard sensors", () => {
		const { sensors } = harness().render();
		expect(sensors).toEqual([
			{ sensor: MouseSensor, options: { activationConstraint: { distance: 6 } } },
			{
				sensor: TouchSensor,
				options: { activationConstraint: { delay: 1000, tolerance: 5 } },
			},
			{ sensor: KeyboardSensor, options: { coordinateGetter: expect.any(Function) } },
		]);
	});

	it("connects drag events to the real interaction and disables sensors while busy", () => {
		const h = harness();
		const props = h.render();
		props.onDragStart!({ active: { id: "a" } } as DragStartEvent);
		props.onDragEnd!({ active: { id: "a" }, over: { id: "c" } } as DragEndEvent);
		expect(h.onMove).toHaveBeenCalledExactlyOnceWith({
			activeId: "a",
			overId: "c",
			items: ["b", "c", "a"],
		});
		expect(h.render().sensors).toEqual([]);
	});

	it("cancels unfinished gestures on sensor cancellation and surface unmount", () => {
		const h = harness();
		const props = h.render();
		props.onDragStart!({ active: { id: "a" } } as DragStartEvent);
		props.onDragCancel!({} as DragEndEvent);
		props.onDragEnd!({ active: { id: "a" }, over: { id: "c" } } as DragEndEvent);
		props.onDragStart!({ active: { id: "a" } } as DragStartEvent);
		for (const cleanup of cleanups) cleanup();
		props.onDragEnd!({ active: { id: "a" }, over: { id: "c" } } as DragEndEvent);
		expect(h.onMove).not.toHaveBeenCalled();
	});

	it("only the handle activates sorting and the row carries motion", () => {
		const row = SortableRow({ id: "a", handleLabel: "排序 A", children: (handle) => handle });
		expect(row.props).not.toHaveProperty("onMouseDown");
		expect(row.props.style.transform).toContain("38px");
		const handle = row.props.children as React.ReactElement<Record<string, unknown>>;
		expect(handle.type).toBe("button");
		expect(handle.props["aria-label"]).toBe("排序 A");
		expect(handle.props.onKeyDown).toBe(sortable.listeners.onKeyDown);
		expect(handle.props.ref).toBe(sortable.setActivatorNodeRef);
		sortable.isDragging = true;
		const lifted = SortableRow({ id: "a", handleLabel: "排序 A", children: () => null });
		expect(lifted.props.style.transition).toBe("none");
		expect(lifted.props.className).toContain("is-sorting");
	});

	it("provides localized instructions, positions and cancellation", () => {
		const a11y = sortableAccessibility("zh", ["a", "b"]);
		expect(a11y.screenReaderInstructions.draggable).toContain("Escape");
		expect(a11y.announcements.onDragStart({ active: { id: "a" } } as DragEndEvent)).toContain(
			"1",
		);
		expect(a11y.announcements.onDragEnd({ over: { id: "b" } } as DragEndEvent)).toContain("2");
		expect(a11y.announcements.onDragCancel()).toContain("取消");
	});
});
