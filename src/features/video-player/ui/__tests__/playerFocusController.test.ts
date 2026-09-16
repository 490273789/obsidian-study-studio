import { describe, expect, it, vi } from "vitest";
import { PlayerFocusController } from "../playerFocusController";

describe("PlayerFocusController", () => {
	it("focuses the current surface or the next surface that mounts", () => {
		const controller = new PlayerFocusController();
		const first = vi.fn();
		const release = controller.register(first);
		controller.requestFocus();
		expect(first).toHaveBeenCalledOnce();

		controller.requestFocusAfterRemount();
		release();
		const second = vi.fn();
		controller.register(second);
		expect(second).toHaveBeenCalledOnce();
	});

	it("remembers an open-command focus request until the view mounts", () => {
		const controller = new PlayerFocusController();
		const focus = vi.fn();
		controller.requestFocus();
		controller.register(focus);
		expect(focus).toHaveBeenCalledOnce();
	});
});
