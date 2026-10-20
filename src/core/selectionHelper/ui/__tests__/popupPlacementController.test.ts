import { describe, expect, it, vi } from "vite-plus/test";
import {
	PopupPlacementController,
	popupPosition,
	popupPositionAtAnchor,
	type PopupViewport,
} from "../popupPlacementController";

describe("PopupPlacementController", () => {
	const defaultViewport: PopupViewport = {
		left: 0,
		top: 0,
		width: 1000,
		height: 800,
	};

	describe("pure placement calculations", () => {
		it("positions popup below the target when space is sufficient", () => {
			const pos = popupPosition(
				{ x: 100, y: 100 },
				{ width: 300, height: 200 },
				defaultViewport,
			);
			expect(pos).toEqual({
				left: 100,
				top: 112, // 100 + 12
				maxWidth: 968, // 1000 - 32
				maxHeight: 560, // 800 * 0.7
			});
		});

		it("flips above target when content would overflow bottom", () => {
			const pos = popupPosition(
				{ x: 100, y: 700 },
				{ width: 300, height: 200 },
				defaultViewport,
			);
			// 700 + 12 + 200 = 912 > bottom (784) => flips to 700 - 200 - 12 = 488
			expect(pos).toEqual({
				left: 100,
				top: 488,
				maxWidth: 968,
				maxHeight: 560,
			});
		});

		it("clamps to viewport boundaries including margins", () => {
			// Clamps left to 16
			const posLeft = popupPosition(
				{ x: -50, y: 100 },
				{ width: 300, height: 200 },
				defaultViewport,
			);
			expect(posLeft.left).toBe(16);

			// Clamps right to right - width = 1000 - 16 - 300 = 684
			const posRight = popupPosition(
				{ x: 950, y: 100 },
				{ width: 300, height: 200 },
				defaultViewport,
			);
			expect(posRight.left).toBe(684);
		});

		it("anchors dictionary content to top-left and grows downwards/rightwards", () => {
			const pos = popupPositionAtAnchor({ left: 600, top: 400 }, defaultViewport);
			expect(pos).toEqual({
				left: 600,
				top: 400,
				maxWidth: 384, // 1000 - 16 - 600
				maxHeight: 384, // 800 - 16 - 400 = 384 <= 560
			});
		});
	});

	describe("programmatic controller lifecycle", () => {
		it("initializes snapshot and centers manual trigger", () => {
			const controller = new PopupPlacementController({
				target: { x: 0, y: 0, trigger: "manual" },
				mode: "dictionary",
			});

			const snapshot = controller.syncMeasurements(
				{ width: 300, height: 200 },
				defaultViewport,
				"initial",
			);

			// (1000 - 300) / 2 = 350, (800 - 200) / 2 = 300
			expect(snapshot.left).toBe(350);
			expect(snapshot.top).toBe(300);
			expect(controller.getSnapshot()).toEqual(snapshot);
			expect(controller.placedAnchor).toEqual({ left: 350, top: 300 });
		});

		it("preserves placed corner when dictionary content resizes", () => {
			const controller = new PopupPlacementController({
				target: { x: 500, y: 200 },
				mode: "dictionary",
			});

			const initial = controller.syncMeasurements(
				{ width: 250, height: 150 },
				defaultViewport,
				"initial",
			);
			expect(initial.left).toBe(500);
			expect(initial.top).toBe(212);

			// Content resizes: anchor is preserved
			const resized = controller.syncMeasurements(
				{ width: 400, height: 450 },
				defaultViewport,
				"content",
			);
			expect(resized.left).toBe(500);
			expect(resized.top).toBe(212);
			expect(resized.maxWidth).toBe(484); // 984 - 500
			expect(resized.maxHeight).toBe(560); // 800 * 0.7
		});

		it("supports programmatic dragging and preserves dragged position", () => {
			const controller = new PopupPlacementController({
				target: { x: 100, y: 100 },
				mode: "dictionary",
			});

			controller.syncMeasurements({ width: 200, height: 100 }, defaultViewport, "initial");
			expect(controller.isDragging).toBe(false);

			controller.startDrag({ x: 120, y: 120 }, 1);
			expect(controller.isDragging).toBe(true);

			controller.moveDrag(
				{ x: 220, y: 270 },
				1,
				{ width: 200, height: 100 },
				defaultViewport,
			);
			// moved delta: +100 x, +150 y => left = 100 + 100 = 200, top = 112 + 150 = 262
			expect(controller.getSnapshot()).toMatchObject({ left: 200, top: 262 });

			controller.endDrag(1);
			expect(controller.isDragging).toBe(false);

			// After endDrag, content resize still honors manual drag position
			const resized = controller.syncMeasurements(
				{ width: 300, height: 250 },
				defaultViewport,
				"content",
			);
			expect(resized.left).toBe(200);
			expect(resized.top).toBe(262);
		});

		it("notifies subscribers and suppresses duplicate updates", () => {
			const listener = vi.fn();
			const onPositionChange = vi.fn();
			const controller = new PopupPlacementController({
				target: { x: 100, y: 100 },
				mode: "dictionary",
				onPositionChange,
			});
			const unsub = controller.subscribe(listener);

			controller.syncMeasurements({ width: 200, height: 100 }, defaultViewport, "initial");
			expect(listener).toHaveBeenCalledTimes(1);
			expect(onPositionChange).toHaveBeenCalledTimes(1);

			// Calling again with exact same measurements: no duplicate notifications
			controller.syncMeasurements({ width: 200, height: 100 }, defaultViewport, "initial");
			expect(listener).toHaveBeenCalledTimes(1);
			expect(onPositionChange).toHaveBeenCalledTimes(1);

			unsub();
			controller.syncMeasurements({ width: 400, height: 300 }, defaultViewport, "content");
			expect(listener).toHaveBeenCalledTimes(1); // unsubscribed
			expect(onPositionChange).toHaveBeenCalledTimes(2); // still receives direct prop callback
		});
	});

	describe("DOM integration and gesture validation", () => {
		function createDOMFixture() {
			const viewport = Object.assign(new EventTarget(), {
				offsetLeft: 0,
				offsetTop: 0,
				width: 1000,
				height: 800,
			});
			let triggerResizeContent = () => {};
			const disconnect = vi.fn();
			const ownerWindow = Object.assign(new EventTarget(), {
				visualViewport: viewport,
				innerWidth: 1000,
				innerHeight: 800,
				ResizeObserver: class {
					constructor(callback: () => void) {
						triggerResizeContent = callback;
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

			return {
				element: element as unknown as HTMLElement,
				ownerWindow: ownerWindow as unknown as Window,
				header: header as unknown as HTMLElement & {
					style: { cursor: string };
					setPointerCapture: (id: number) => void;
					releasePointerCapture: (id: number) => void;
				},
				viewport,
				disconnect,
				triggerResizeContent: () => triggerResizeContent(),
			};
		}

		it("attaches listeners and handles header pointer down in dictionary mode", () => {
			const f = createDOMFixture();
			const onPositionChange = vi.fn();
			const controller = new PopupPlacementController({
				element: f.element,
				ownerWindow: f.ownerWindow,
				target: { x: 200, y: 150 },
				mode: "dictionary",
				onPositionChange,
			});

			expect(onPositionChange).toHaveBeenCalledWith(
				expect.objectContaining({ left: 200, top: 162 }),
			);
			expect(controller.onHeaderPointerDown).not.toBeNull();

			// Non-primary or right click ignored
			const preventDefault = vi.fn();
			controller.onHeaderPointerDown!({
				button: 2,
				isPrimary: true,
				pointerId: 1,
				clientX: 210,
				clientY: 160,
				currentTarget: f.header,
				target: f.header,
				preventDefault,
			} as unknown as React.PointerEvent<HTMLElement>);
			expect(controller.isDragging).toBe(false);
			expect(preventDefault).not.toHaveBeenCalled();

			// Interactive control target ignored
			controller.onHeaderPointerDown!({
				button: 0,
				isPrimary: true,
				pointerId: 1,
				clientX: 210,
				clientY: 160,
				currentTarget: f.header,
				target: {
					closest: (sel: string) => (sel.includes("button") ? {} : null),
				} as unknown as HTMLElement,
				preventDefault,
			} as unknown as React.PointerEvent<HTMLElement>);
			expect(controller.isDragging).toBe(false);

			// Valid primary drag start
			controller.onHeaderPointerDown!({
				button: 0,
				isPrimary: true,
				pointerId: 1,
				clientX: 210,
				clientY: 160,
				currentTarget: f.header,
				target: f.header,
				preventDefault,
			} as unknown as React.PointerEvent<HTMLElement>);
			expect(controller.isDragging).toBe(true);
			expect(preventDefault).toHaveBeenCalled();
			expect(f.header.style.cursor).toBe("grabbing");
			expect(f.header.setPointerCapture).toHaveBeenCalledWith(1);

			// Dispatch pointer move on window
			f.ownerWindow.dispatchEvent(
				Object.assign(new Event("pointermove", { cancelable: true }), {
					pointerId: 1,
					clientX: 310,
					clientY: 210,
				}),
			);
			expect(controller.getSnapshot()).toMatchObject({ left: 300, top: 212 });

			// Pointer up releases capture and resets cursor
			f.ownerWindow.dispatchEvent(
				Object.assign(new Event("pointerup"), {
					pointerId: 1,
				}),
			);
			expect(controller.isDragging).toBe(false);
			expect(f.header.style.cursor).toBe("");
			expect(f.header.releasePointerCapture).toHaveBeenCalledWith(1);

			controller.dispose();
			expect(f.disconnect).toHaveBeenCalledOnce();
		});

		it("does not bind pointer events in actions mode", () => {
			const f = createDOMFixture();
			const controller = new PopupPlacementController({
				element: f.element,
				ownerWindow: f.ownerWindow,
				target: { x: 100, y: 100 },
				mode: "actions",
			});

			expect(controller.onHeaderPointerDown).toBeNull();
			controller.dispose();
		});
	});
});
