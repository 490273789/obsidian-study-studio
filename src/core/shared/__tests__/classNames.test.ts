import { describe, expect, it } from "vite-plus/test";
import { cls } from "../classNames";

describe("cls", () => {
	it("joins string arguments with spaces", () => {
		expect(cls("foo", "bar", "baz")).toBe("foo bar baz");
	});

	it("ignores falsy values", () => {
		expect(cls("foo", false, null, undefined, "", 0, "bar")).toBe("foo bar");
	});

	it("handles nested arrays", () => {
		expect(cls("foo", ["bar", false, ["nested", "deep"]], "baz")).toBe(
			"foo bar nested deep baz",
		);
	});

	it("handles object conditionals", () => {
		expect(
			cls("base", {
				active: true,
				disabled: false,
				visible: 1,
			}),
		).toBe("base active visible");
	});

	it("returns empty string when no valid classes are passed", () => {
		expect(cls(null, false, undefined, "")).toBe("");
	});
});
