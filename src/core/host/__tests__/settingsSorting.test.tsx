import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mountSettingsSorting } from "../settingsSorting";
import { ReorderableList } from "../../ui/primitives/Sortable/Sortable";

const adapter = vi.hoisted(() => ({
	render: vi.fn(),
	unmount: vi.fn(),
	setNodeRef: vi.fn(),
	cleanups: [] as (() => void)[],
	style: { transform: "translate3d(0, 32px, 0)", transition: "transform 200ms ease" },
}));
vi.mock("react-dom/client", () => ({
	createRoot: () => ({ render: adapter.render, unmount: adapter.unmount }),
}));
vi.mock("react-dom", () => ({
	flushSync: (callback: () => void) => callback(),
	createPortal: (children: unknown, container: unknown) => ({ children, container }),
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useLayoutEffect: (effect: () => (() => void) | undefined) => {
		const cleanup = effect();
		if (cleanup) adapter.cleanups.push(cleanup);
	},
}));
vi.mock("../../ui/primitives/Sortable/Sortable", () => ({
	ReorderableList: () => null,
	useSortableItem: () => ({
		setNodeRef: adapter.setNodeRef,
		style: adapter.style,
		isDragging: true,
		handle: "handle",
	}),
}));

beforeEach(() => {
	vi.clearAllMocks();
	adapter.cleanups = [];
});

describe("Obsidian settings sorting adapter", () => {
	it("binds existing rows, portals the handle and removes motion and refs on cleanup", () => {
		const classes = new Set<string>();
		const style = {
			transform: "",
			transition: "",
			setProperty(name: "transform" | "transition", value: string) {
				this[name] = value;
			},
			removeProperty(name: "transform" | "transition") {
				this[name] = "";
			},
		};
		const element = {
			style,
			classList: {
				toggle: (name: string, active: boolean) =>
					active ? classes.add(name) : classes.delete(name),
				remove: (name: string) => classes.delete(name),
			},
		} as unknown as HTMLElement;
		const row = { id: "a", label: "Sort A", element, handleContainer: {} as HTMLElement };
		const onMove = vi.fn(async () => {});
		const dispose = mountSettingsSorting({} as HTMLElement, [row], "en", onMove);
		const list = adapter.render.mock.calls[0]![0] as React.ReactElement<
			React.ComponentProps<typeof ReorderableList>
		>;
		expect(list.type).toBe(ReorderableList);
		expect(list.props.items).toEqual(["a"]);
		expect(list.props.language).toBe("en");
		expect(list.props.onMove).toBe(onMove);
		const binding = React.Children.toArray(list.props.children)[0] as React.ReactElement<{
			row: typeof row;
		}>;
		const renderBinding = binding.type as (props: { row: typeof row }) => unknown;
		expect(renderBinding(binding.props)).toEqual({
			children: "handle",
			container: row.handleContainer,
		});
		expect(adapter.setNodeRef).toHaveBeenCalledWith(element);
		expect(element.style.transform).toBe(adapter.style.transform);
		expect(classes.has("is-sorting")).toBe(true);
		for (const cleanup of adapter.cleanups) cleanup();
		expect(adapter.setNodeRef).toHaveBeenLastCalledWith(null);
		expect(element.style.transform).toBe("");
		expect(element.style.transition).toBe("");
		expect(classes.size).toBe(0);
		dispose();
		expect(adapter.unmount).toHaveBeenCalledOnce();
	});
});
