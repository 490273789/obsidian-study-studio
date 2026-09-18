import React from "react";
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Confetti } from "../Confetti";

describe("Confetti component", () => {
	it("renders canvas element with default class name", () => {
		const html = renderToString(<Confetti />);
		expect(html).toContain("<canvas");
		expect(html).toContain("fc-confetti");
	});

	it("renders canvas element with custom class name", () => {
		const html = renderToString(<Confetti className="custom-fireworks" />);
		expect(html).toContain("<canvas");
		expect(html).toContain("fc-confetti custom-fireworks");
	});
});
