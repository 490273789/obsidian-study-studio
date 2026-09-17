import { describe, expect, it, vi } from "vitest";
import { TranslatorFocusController } from "../translatorFocusController";

describe("TranslatorFocusController", () => {
	it("focuses the current input or the next input that mounts", () => {
		const controller = new TranslatorFocusController();
		const first = vi.fn();
		const release = controller.register(first);
		controller.requestFocus();
		expect(first).toHaveBeenCalledOnce();

		release();
		controller.requestFocus();
		const second = vi.fn();
		controller.register(second);
		expect(second).toHaveBeenCalledOnce();
	});

	it("remembers an open-command focus request until the view mounts", () => {
		const controller = new TranslatorFocusController();
		const focus = vi.fn();
		controller.requestFocus();
		controller.register(focus);
		expect(focus).toHaveBeenCalledOnce();
	});

	it("does not call unregistered target after release", () => {
		const controller = new TranslatorFocusController();
		const target = vi.fn();
		const release = controller.register(target);
		release();
		controller.requestFocus();
		expect(target).not.toHaveBeenCalled();
	});
});
