import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ShadowingWorkspaceState } from "../../domain/types";
import { ShadowingWorkspace } from "../ShadowingWorkspace";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useMemo: (calculate: () => unknown) => calculate(),
	useState: (initial: unknown) => {
		const index = hooks.index++;
		if (!(index in hooks.values)) hooks.values[index] = initial;
		return [
			hooks.values[index],
			(value: unknown) => {
				hooks.values[index] =
					typeof value === "function"
						? (value as (previous: unknown) => unknown)(hooks.values[index])
						: value;
			},
		];
	},
}));

function findButton(
	tree: React.ReactNode,
	predicate: (button: React.ReactElement<React.ComponentProps<"button">>) => boolean,
): React.ReactElement<React.ComponentProps<"button">> {
	let found: React.ReactElement<React.ComponentProps<"button">> | null = null;
	const visit = (node: React.ReactNode): void => {
		React.Children.forEach(node, (child) => {
			if (found || !React.isValidElement(child)) return;
			if (child.type === "button") {
				const button = child as React.ReactElement<React.ComponentProps<"button">>;
				if (predicate(button)) {
					found = button;
					return;
				}
			}
			visit((child.props as { children?: React.ReactNode }).children);
		});
	};
	visit(tree);
	if (!found) throw new Error("Expected button");
	return found;
}

describe("ShadowingWorkspace", () => {
	it("sends the selected subtitle range through the shared intent seam", async () => {
		hooks.values = [];
		const onAction = vi.fn(async () => undefined);
		const state = {
			cues: [{ id: "cue-1", start: 4, end: 6, text: "hello" }],
			records: [],
			failedSaves: [],
			taskError: null,
			practiceStart: null,
			practiceEnd: null,
			hasCandidate: false,
		} as unknown as ShadowingWorkspaceState;
		const render = () => {
			hooks.index = 0;
			return ShadowingWorkspace({
				language: "en",
				currentTime: 0,
				duration: 30,
				state,
				onAction,
			});
		};

		const cue = findButton(render(), (button) => button.props["aria-pressed"] === false);
		cue.props.onClick?.({ shiftKey: false } as React.MouseEvent<HTMLButtonElement>);
		expect(onAction).toHaveBeenCalledWith({ type: "seek-to", seconds: 4 });

		const start = findButton(
			render(),
			(button) => button.props.children === "Practice selection",
		);
		start.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(onAction).toHaveBeenLastCalledWith({
			type: "select-range",
			start: 4,
			end: 6,
			text: "hello",
		});
	});
});
