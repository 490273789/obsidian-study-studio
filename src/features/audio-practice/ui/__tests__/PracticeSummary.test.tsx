import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { audioPracticeStrings } from "../../strings/audioPractice";
import { PracticeSummary } from "../PracticeSummary";

interface ControlProps {
	children?: React.ReactNode;
	"aria-label"?: string;
	onClick?: () => void;
}
function elements(node: React.ReactNode): React.ReactElement<ControlProps>[] {
	const result: React.ReactElement<ControlProps>[] = [];
	React.Children.forEach(node, (child) => {
		if (!React.isValidElement<ControlProps>(child)) return;
		result.push(child, ...elements(child.props.children));
	});
	return result;
}
function text(node: React.ReactNode): string {
	let result = "";
	React.Children.forEach(node, (child) => {
		if (typeof child === "string" || typeof child === "number") result += child;
		else if (React.isValidElement<ControlProps>(child)) result += text(child.props.children);
	});
	return result;
}

function render(overrides: Record<string, unknown> = {}) {
	const onReplay = vi.fn();
	const onPracticeDifficult = vi.fn();
	const tree = PracticeSummary({
		completion: { reached: 2, total: 2, marked: 3 },
		elapsedMs: 252_000,
		t: audioPracticeStrings("en"),
		canPracticeDifficult: true,
		onReplay,
		onPracticeDifficult,
		...overrides,
	});
	return { tree, onReplay, onPracticeDifficult };
}

describe("practice summary", () => {
	it("reports the session, the marks and the elapsed playing time", () => {
		const { tree } = render();
		const body = text(tree);
		expect(body).toContain("Session complete");
		expect(body).toContain("Reached 2 of 2");
		expect(body).toContain("3 marked difficult");
		expect(body).toContain("4 min 12 s");
	});

	it("forwards replay and difficult practice", () => {
		const { tree, onReplay, onPracticeDifficult } = render();
		const click = (label: string) => {
			const element = elements(tree).find(
				(item) => item.props["aria-label"] === label || text(item.props.children) === label,
			);
			if (!element?.props.onClick) throw new Error(`Missing action ${label}`);
			element.props.onClick();
		};
		click("Practice again");
		click("Difficult sentences only");
		expect(onReplay).toHaveBeenCalledTimes(1);
		expect(onPracticeDifficult).toHaveBeenCalledTimes(1);
	});

	it("hides difficult practice when it is already active and omits a zero time", () => {
		const { tree } = render({ canPracticeDifficult: false, elapsedMs: 0 });
		const body = text(tree);
		expect(body).not.toContain("Difficult sentences only");
		expect(body).not.toContain(" min ");
	});
});
