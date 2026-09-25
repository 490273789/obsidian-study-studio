import { describe, expect, it, vi } from "vitest";
import { browserWordListViewportDom } from "../wordListViewportDom";

describe("word list browser measurement adapter", () => {
	it("uses the owning window for measurements, events and frame cancellation", () => {
		const observers: Observer[] = [];
		class Observer {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
			constructor(readonly changed: (entries: { target: HTMLElement }[]) => void) {
				observers.push(this);
			}
		}
		let frame: (() => void) | undefined;
		const win = {
			ResizeObserver: Observer,
			getComputedStyle: vi.fn(() => ({ gap: "16px" })),
			requestAnimationFrame: vi.fn((callback: () => void) => {
				frame = callback;
				return 23;
			}),
			cancelAnimationFrame: vi.fn(),
		};
		const scroll = {
			ownerDocument: { defaultView: win },
			scrollTop: 200,
			clientWidth: 600,
			clientHeight: 400,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		} as unknown as HTMLElement;
		const list = {} as HTMLElement;
		const row = {
			getBoundingClientRect: () => ({ height: 143 }),
		} as HTMLElement;
		const changed = { viewport: vi.fn(), row: vi.fn() };
		const mount = browserWordListViewportDom.mount(scroll, list, changed);

		expect(mount.readViewport()).toEqual({ scrollTop: 200, width: 600, height: 400, gap: 16 });
		expect(win.getComputedStyle).toHaveBeenCalledWith(list);
		expect(mount.readHeight(row)).toBe(143);
		expect(scroll.addEventListener).toHaveBeenCalledWith("scroll", changed.viewport, {
			passive: true,
		});
		expect(observers[0]!.observe).toHaveBeenCalledWith(scroll);
		observers[0]!.changed([]);
		expect(changed.viewport).toHaveBeenCalledOnce();
		mount.observeRow(row);
		expect(observers[1]!.observe).toHaveBeenCalledWith(row);
		observers[1]!.changed([{ target: row }]);
		expect(changed.row).toHaveBeenCalledWith(row);
		mount.unobserveRow(row);
		expect(observers[1]!.unobserve).toHaveBeenCalledWith(row);

		const onFrame = vi.fn();
		const cancel = mount.requestFrame(onFrame);
		expect(onFrame).not.toHaveBeenCalled();
		frame!();
		expect(onFrame).toHaveBeenCalledOnce();
		cancel();
		expect(win.cancelAnimationFrame).toHaveBeenCalledWith(23);
		mount.dispose();
		expect(scroll.removeEventListener).toHaveBeenCalledWith("scroll", changed.viewport);
		for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledOnce();
	});
});
