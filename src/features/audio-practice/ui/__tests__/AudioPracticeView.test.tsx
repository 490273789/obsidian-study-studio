import React from "react";
import { describe, expect, it } from "vite-plus/test";
import { AudioPracticeRuntime } from "../../domain/audioPracticeRuntime";
import { emptyAudioPracticeData } from "../../domain/repository";
import { audioPracticeStrings } from "../../strings/audioPractice";
import { PracticeSurface } from "../AudioPracticeView";

interface ControlProps {
	children?: React.ReactNode;
	"aria-label"?: string;
	"aria-pressed"?: boolean;
	onClick?: () => void;
	onChange?: (event: {
		target: { value: string; checked?: boolean; valueAsNumber?: number };
	}) => void;
	type?: string;
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
async function setup() {
	const runtime = new AudioPracticeRuntime(
		{ load: emptyAudioPracticeData, save: async () => {}, subscribeExternal: () => () => {} },
		{
			exists: () => true,
			mediaUrl: (path) => path,
			readText: async () =>
				"1\n00:00:01,000 --> 00:00:02,000\nFirst sentence\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond sentence",
			writeSubtitle: async () => "generated.srt",
		},
	);
	await runtime.addMaterial({
		title: "Audio",
		audioPath: "audio.mp3",
		subtitlePath: "audio.srt",
	});
	const t = audioPracticeStrings("en");
	const render = () => PracticeSurface({ runtime, snapshot: runtime.getSnapshot(), t });
	const click = (label: string) => {
		const element = elements(render()).find(
			(element) =>
				element.props["aria-label"] === label || text(element.props.children) === label,
		);
		if (!element?.props.onClick) throw new Error(`Missing action ${label}`);
		element.props.onClick();
	};
	return { runtime, t, render, click };
}

describe("audio practice UI interaction", () => {
	it("hides all sentence text, reveals only the current sentence, and hides again after next", async () => {
		const { runtime, t, render, click } = await setup();
		runtime.setBlind(true);
		expect(text(render())).not.toContain("First sentence");
		expect(text(render())).not.toContain("Second sentence");
		click(t.reveal);
		expect(text(render())).toContain("First sentence");
		expect(text(render())).not.toContain("Second sentence");
		click(t.next);
		expect(text(render())).not.toContain("First sentence");
		expect(text(render())).not.toContain("Second sentence");
		runtime.dispose();
	});
	it("marks difficult sentences through the shared runtime and filters their presentation", async () => {
		const { runtime, render, click } = await setup();
		click("Mark difficult: 0:03.0");
		runtime.setDifficultOnly(true);
		expect(text(render())).not.toContain("First sentence");
		expect(text(render())).toContain("Second sentence");
		const star = elements(render()).find(
			(element) => element.props["aria-label"] === "Mark difficult: 0:03.0",
		);
		expect(star?.props["aria-pressed"]).toBe(true);
		click("Mark difficult: 0:03.0");
		expect(text(render())).toContain("No difficult sentences marked yet.");
		runtime.dispose();
	});
	it("ignores empty offset edits and applies finite signed offsets", async () => {
		const { runtime, render } = await setup();
		const input = elements(render()).find(
			(element) => element.type === "input" && element.props.type === "number",
		);
		input!.props.onChange!({ target: { value: "", valueAsNumber: NaN } });
		expect(
			runtime.getSnapshot().progress[runtime.getSnapshot().currentMaterialId!]!.offset,
		).toBe(0);
		input!.props.onChange!({ target: { value: "-0.5", valueAsNumber: -0.5 } });
		expect(
			runtime.getSnapshot().progress[runtime.getSnapshot().currentMaterialId!]!.offset,
		).toBe(-0.5);
		runtime.dispose();
	});
	it("handles sentence shortcuts only on the focused composite surface", async () => {
		const { runtime, render } = await setup();
		const invoke = (key: string, editing: boolean) => {
			const surface = render() as React.ReactElement<{
				onKeyDown(event: React.KeyboardEvent<HTMLElement>): void;
			}>;
			let prevented = false;
			surface.props.onKeyDown({
				key,
				defaultPrevented: false,
				altKey: false,
				ctrlKey: false,
				metaKey: false,
				nativeEvent: { isComposing: false },
				target: { closest: () => (editing ? {} : null) },
				preventDefault: () => {
					prevented = true;
				},
			} as unknown as React.KeyboardEvent<HTMLElement>);
			return prevented;
		};
		const first = runtime.getSnapshot().currentCueId;
		expect(invoke("ArrowRight", true)).toBe(false);
		expect(runtime.getSnapshot().currentCueId).toBe(first);
		expect(invoke("ArrowRight", false)).toBe(true);
		expect(runtime.getSnapshot().currentCueId).not.toBe(first);
		runtime.dispose();
	});
});
