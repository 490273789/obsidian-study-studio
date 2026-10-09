import { describe, expect, it } from "vite-plus/test";
import {
	canRequestModalClose,
	getModalFocusDestination,
	getModalLayer,
	registerModal,
	unregisterModal,
} from "../modalBehavior";

describe("modal behavior", () => {
	it("keeps registration idempotent and exposes only the latest modal as topmost", () => {
		const first = registerModal([], "settings");
		const nested = registerModal(first, "confirmation");

		expect(registerModal(nested, "confirmation")).toBe(nested);
		expect(getModalLayer(nested, "settings")).toEqual({
			index: 0,
			isTopmost: false,
		});
		expect(getModalLayer(nested, "confirmation")).toEqual({
			index: 1,
			isTopmost: true,
		});
	});

	it("reveals the previous modal when the topmost modal unregisters", () => {
		const stack = ["settings", "confirmation"];
		const remaining = unregisterModal(stack, "confirmation");

		expect(remaining).toEqual(["settings"]);
		expect(getModalLayer(remaining, "settings").isTopmost).toBe(true);
		expect(unregisterModal(remaining, "missing")).toBe(remaining);
	});

	it("wraps tab focus within the modal", () => {
		expect(getModalFocusDestination(0, -1, false)).toBe("container");
		expect(getModalFocusDestination(3, -1, false)).toBe("first");
		expect(getModalFocusDestination(3, -1, true)).toBe("last");
		expect(getModalFocusDestination(3, 0, true)).toBe("last");
		expect(getModalFocusDestination(3, 2, false)).toBe("first");
		expect(getModalFocusDestination(3, 1, false)).toBeNull();
	});

	it("accepts close requests only for a dismissible topmost modal", () => {
		expect(canRequestModalClose(true, true)).toBe(true);
		expect(canRequestModalClose(true, false)).toBe(false);
		expect(canRequestModalClose(false, true)).toBe(false);
	});
});
