import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SelectionPopupHost, type SelectionPopupHostProps } from "../SelectionPopupHost";
import type { SelectionHelper } from "../../domain/selectionHelper";
import type { SelectionHelperSnapshot, SelectionLookupSlotProps } from "../../domain/types";
import { selectionHelperStrings } from "../../strings/selectionPopup";

// Simulate React's retained hooks; native listeners and positioning run unchanged.
const hooks = vi.hoisted(() => ({
	refs: [] as { current: unknown }[],
	refIndex: 0,
	position: { left: 0, top: 0, maxWidth: 570, maxHeight: 420 },
	snapshot: null as unknown,
	effect: null as null | (() => void | (() => void)),
	deps: [] as unknown[],
}));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useRef: (initial: unknown) => {
		const index = hooks.refIndex++;
		return (hooks.refs[index] ??= { current: initial });
	},
	useCallback: (callback: unknown) => callback,
	useSyncExternalStore: () => hooks.snapshot,
	useState: () => [
		hooks.position,
		(update: (value: typeof hooks.position) => typeof hooks.position) => {
			hooks.position = update(hooks.position);
		},
	],
	useLayoutEffect: (effect: () => void | (() => void), deps: unknown[]) => {
		if (deps.some((value, index) => value !== hooks.deps[index])) {
			hooks.deps = deps;
			hooks.effect = effect;
		}
	},
}));

beforeEach(() => {
	hooks.refs = [];
	hooks.deps = [];
	hooks.effect = null;
	hooks.position = { left: 0, top: 0, maxWidth: 570, maxHeight: 420 };
});

function fixture() {
	const viewport = Object.assign(new EventTarget(), {
		offsetLeft: 0,
		offsetTop: 0,
		width: 1000,
		height: 800,
	});
	let resizeContent = () => {};
	const disconnect = vi.fn();
	const ownerWindow = Object.assign(new EventTarget(), {
		visualViewport: viewport,
		innerWidth: 1000,
		innerHeight: 800,
		ResizeObserver: class {
			constructor(callback: () => void) {
				resizeContent = callback;
			}
			observe() {}
			disconnect = disconnect;
		},
	});
	const element = {
		ownerDocument: { defaultView: ownerWindow },
		offsetWidth: 300,
		offsetHeight: 200,
	};
	const header = Object.assign(new EventTarget(), {
		style: { cursor: "" },
		setPointerCapture: vi.fn(),
		hasPointerCapture: () => true,
		releasePointerCapture: vi.fn(),
	});
	const state: SelectionHelperSnapshot = {
		visible: true,
		mode: "dictionary",
		target: { source: { id: "source" }, text: "word", isEnglishWord: true, x: 100, y: 100 },
		canLookup: true,
		canTranslate: true,
	};
	hooks.snapshot = state;
	let lastSlotProps: SelectionLookupSlotProps | null = null;
	const renderLookupSlot = vi.fn((slotProps: SelectionLookupSlotProps) => {
		lastSlotProps = slotProps;
		return <div data-testid="lookup-slot">Slot Content</div>;
	});
	const props: SelectionPopupHostProps = {
		helper: {
			subscribe: () => () => {},
			getSnapshot: () => state,
			dismiss: vi.fn(),
			selectedDictionaries: ["source-a"],
			dictionaryOrder: ["source-a"],
			openMainShortcut: "Ctrl+Enter",
		} as unknown as SelectionHelper,
		strings: selectionHelperStrings("zh"),
		language: "zh",
		theme: "light",
		renderLookupSlot,
	};
	let cleanup: void | (() => void);
	let pointerDown: React.PointerEventHandler<HTMLElement> | undefined;
	function render(): React.ReactElement | null {
		hooks.refIndex = 0;
		lastSlotProps = null;
		const tree = SelectionPopupHost(props) as React.ReactElement | null;
		hooks.refs[0]!.current = element;
		if (hooks.effect) {
			cleanup?.();
			cleanup = hooks.effect();
			hooks.effect = null;
		}
		pointerDown = (lastSlotProps as SelectionLookupSlotProps | null)?.onHeaderPointerDown;
		return tree;
	}
	function start(
		options: {
			control?: boolean;
			pointerType?: string;
			pointerId?: number;
			button?: number;
			isPrimary?: boolean;
		} = {},
	) {
		const preventDefault = vi.fn();
		pointerDown?.({
			button: 0,
			isPrimary: true,
			pointerId: 1,
			clientX: 110,
			clientY: 122,
			pointerType: "mouse",
			...options,
			currentTarget: header,
			target: { closest: () => (options.control ? {} : null) },
			preventDefault,
		} as unknown as React.PointerEvent<HTMLElement>);
		return preventDefault;
	}
	function pointer(type: string, x: number, y: number, pointerId = 1) {
		ownerWindow.dispatchEvent(
			Object.assign(new Event(type, { cancelable: true }), {
				pointerId,
				clientX: x,
				clientY: y,
			}),
		);
	}
	render();
	return {
		state,
		element,
		header,
		viewport,
		ownerWindow,
		renderLookupSlot,
		getLastSlotProps: () => lastSlotProps,
		getPointerDown: () => pointerDown,
		render,
		start,
		pointer,
		resizeContent: () => resizeContent(),
		disconnect,
		unmount: () => cleanup?.(),
	};
}

describe("selection dictionary popup dragging", () => {
	it("renders lookup slot in dictionary mode and bubble in actions mode", () => {
		const f = fixture();
		expect(f.renderLookupSlot).toHaveBeenCalled();
		expect(f.getLastSlotProps()).toMatchObject({
			word: "word",
			selectedDictionaries: ["source-a"],
			openMainShortcut: "Ctrl+Enter",
		});

		f.renderLookupSlot.mockClear();
		f.state.mode = "actions";
		f.render();
		expect(f.renderLookupSlot).not.toHaveBeenCalled();
		f.unmount();
	});

	it("centers a manually opened blank card and keeps it draggable", () => {
		const f = fixture();
		f.state.target = { ...f.state.target!, text: "", trigger: "manual", x: 0, y: 0 };
		f.render();
		expect(hooks.position).toMatchObject({ left: 350, top: 300 });
		f.start();
		f.pointer("pointermove", 210, 222);
		expect(hooks.position).toMatchObject({ left: 450, top: 400 });
		f.unmount();
	});

	it.each(["mouse", "touch"])(
		"drags with %s, retaining the pointer offset and clamping at edges",
		(pointerType) => {
			const f = fixture();
			expect(hooks.position).toMatchObject({ left: 100, top: 112 });
			f.start({ pointerType });
			expect(f.header.setPointerCapture).toHaveBeenCalledWith(1);
			f.pointer("pointermove", 210, 222);
			expect(hooks.position).toMatchObject({ left: 200, top: 212 });
			f.pointer("pointermove", 2000, -1000);
			expect(hooks.position).toMatchObject({ left: 684, top: 16 });
			f.pointer("pointerup", 2000, -1000);
			f.pointer("pointermove", 300, 300);
			expect(hooks.position).toMatchObject({ left: 684, top: 16 });
			expect(f.header.releasePointerCapture).toHaveBeenCalledWith(1);
			f.unmount();
		},
	);

	it("excludes controls, secondary buttons and non-primary touches", () => {
		const f = fixture();
		expect(f.start({ control: true })).not.toHaveBeenCalled();
		expect(f.start({ button: 2 })).not.toHaveBeenCalled();
		expect(f.start({ isPrimary: false })).not.toHaveBeenCalled();
		f.pointer("pointermove", 500, 500);
		expect(hooks.position).toMatchObject({ left: 100, top: 112 });
		expect(f.header.setPointerCapture).not.toHaveBeenCalled();
		f.unmount();
	});

	it("preserves dragged position through content measurement, resetting for a new selection", () => {
		const f = fixture();
		f.start();
		f.pointer("pointermove", 310, 322);
		f.pointer("pointerup", 310, 322);
		f.render();
		f.element.offsetHeight = 300;
		f.resizeContent();
		expect(hooks.position).toMatchObject({ left: 300, top: 312 });
		f.state.target = { ...f.state.target!, x: 50, y: 40 };
		f.render();
		expect(hooks.position).toMatchObject({ left: 50, top: 52 });
		f.unmount();
	});

	it("keeps the top-left corner when switching to taller or wider dictionary content", () => {
		const f = fixture();
		f.state.target = { ...f.state.target!, x: 650, y: 600 };
		f.element.offsetHeight = 100;
		f.render();
		expect(hooks.position).toMatchObject({ left: 650, top: 612 });

		f.render();
		f.element.offsetWidth = 500;
		f.element.offsetHeight = 500;
		f.resizeContent();
		expect(hooks.position).toMatchObject({
			left: 650,
			top: 612,
			maxWidth: 334,
			maxHeight: 172,
		});

		f.element.offsetWidth = 280;
		f.element.offsetHeight = 120;
		f.resizeContent();
		expect(hooks.position).toMatchObject({ left: 650, top: 612 });
		f.unmount();
	});

	it("keeps the dragged corner when the result grows beyond the available space", () => {
		const f = fixture();
		f.start();
		f.pointer("pointermove", 510, 522);
		f.pointer("pointerup", 510, 522);
		expect(hooks.position).toMatchObject({ left: 500, top: 512 });
		f.element.offsetHeight = 500;
		f.resizeContent();
		expect(hooks.position).toMatchObject({ left: 500, top: 512, maxHeight: 272 });
		f.unmount();
	});

	it("clamps manual position on visual viewport resize and scroll without reanchoring", () => {
		const f = fixture();
		f.start();
		f.pointer("pointermove", 510, 422);
		f.pointer("pointerup", 510, 422);
		f.viewport.width = 600;
		f.viewport.height = 450;
		f.viewport.dispatchEvent(new Event("resize"));
		expect(hooks.position).toMatchObject({ left: 284, top: 234 });
		f.viewport.offsetLeft = 300;
		f.viewport.offsetTop = 300;
		f.viewport.dispatchEvent(new Event("scroll"));
		expect(hooks.position).toMatchObject({ left: 316, top: 316 });
		f.unmount();
	});

	it("reclamps on a desktop resize and releases dictionary dragging when returning to actions", () => {
		const f = fixture();
		f.start();
		f.pointer("pointermove", 510, 422);
		f.pointer("pointerup", 510, 422);
		f.viewport.width = 600;
		f.ownerWindow.dispatchEvent(new Event("resize"));
		expect(hooks.position).toMatchObject({ left: 284, top: 412 });
		f.state.mode = "actions";
		f.render();
		expect(f.getPointerDown()).toBeUndefined();
		f.pointer("pointermove", 800, 600);
		expect(hooks.position).toMatchObject({ left: 100, top: 112 });
		f.unmount();
	});

	it.each(["pointercancel", "lostpointercapture", "blur", "unmount"])(
		"cleans up an active gesture on %s",
		(ending) => {
			const f = fixture();
			f.start();
			f.pointer("pointermove", 210, 222);
			if (ending === "unmount") f.unmount();
			else if (ending === "lostpointercapture") f.header.dispatchEvent(new Event(ending));
			else if (ending === "blur") f.ownerWindow.dispatchEvent(new Event(ending));
			else f.pointer(ending, 210, 222);
			f.pointer("pointermove", 510, 522);
			expect(hooks.position).toMatchObject({ left: 200, top: 212 });
			expect(f.header.style.cursor).toBe("");
			if (ending !== "unmount") f.unmount();
			expect(f.disconnect).toHaveBeenCalledOnce();
		},
	);
});
