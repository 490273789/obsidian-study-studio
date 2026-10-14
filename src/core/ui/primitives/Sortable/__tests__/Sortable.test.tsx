import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	type DragEndEvent,
	type DndContextProps,
} from "@dnd-kit/core";
import { ReorderableList, SortableRow, sortableAccessibility } from "../Sortable";

const hooks = vi.hoisted(() => ({ cursor: 0, state: [] as unknown[], ref: { current: false } }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: () => hooks.ref,
	useState: (initial: unknown) => {
		const index = hooks.cursor++;
		if (!(index in hooks.state)) hooks.state[index] = initial;
		return [
			hooks.state[index],
			(value: unknown) => {
				hooks.state[index] = value;
			},
		];
	},
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
	hooks.cursor = 0;
	hooks.state = [];
	hooks.ref.current = false;
	sortable.isDragging = false;
});

function harness(onMove = vi.fn(), disabled = false) {
	function render() {
		hooks.cursor = 0;
		return ReorderableList({
			items: ["a", "b", "c"],
			language: "zh",
			disabled,
			onMove,
			children: null,
		}).props as DndContextProps;
	}
	function drop(active: string, over: string | null, props = render()) {
		props.onDragEnd!({
			active: { id: active },
			over: over ? { id: over } : null,
		} as DragEndEvent);
	}
	return { onMove, render, drop };
}

describe("shared sortable interaction", () => {
	it("uses the deck list's mouse, long-press touch and keyboard inputs", () => {
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

	it.each([
		["a", null],
		["a", "a"],
		["missing", "b"],
		["a", "missing"],
	] as const)("does not submit an invalid or unchanged drop (%s, %s)", async (active, over) => {
		const h = harness();
		h.drop(active, over);
		await Promise.resolve();
		expect(h.onMove).not.toHaveBeenCalled();
	});

	it("submits indices once and locks all inputs until persistence settles", async () => {
		let complete!: () => void;
		const onMove = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					complete = resolve;
				}),
		);
		const h = harness(onMove);
		const captured = h.render();
		h.drop("a", "c", captured);
		h.drop("b", "a", captured);
		await Promise.resolve();
		expect(onMove).toHaveBeenCalledExactlyOnceWith(0, 2);
		expect(h.render().sensors).toEqual([]);
		complete();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(h.render().sensors).toHaveLength(3);
	});

	it("ignores late drops when the owner disables sorting", async () => {
		const h = harness(vi.fn(), true);
		expect(h.render().sensors).toEqual([]);
		h.drop("a", "c");
		await Promise.resolve();
		expect(h.onMove).not.toHaveBeenCalled();
	});

	it("unlocks after a failed save and permits retry", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const onMove = vi
				.fn()
				.mockRejectedValueOnce(new Error("failed"))
				.mockResolvedValue(undefined);
			const h = harness(onMove);
			h.drop("a", "b");
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(h.render().sensors).toHaveLength(3);
			h.drop("a", "b");
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(onMove).toHaveBeenCalledTimes(2);
		} finally {
			error.mockRestore();
		}
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
