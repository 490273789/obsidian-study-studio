import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { DictionaryFavoriteController } from "../domain/favorite-controller";
import type { DictionaryFavoriteViewState } from "../domain/types";
import { DictionaryFavoriteView } from "./DictionaryFavoriteView";

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

type ElementProps = {
	children?: React.ReactNode;
	id?: string;
	type?: string;
	disabled?: boolean;
	"aria-busy"?: boolean;
	onClick?: () => void;
	onSubmit?: (event: { preventDefault: () => void }) => void;
};

function descendants(node: React.ReactNode): React.ReactElement<ElementProps>[] {
	if (!React.isValidElement<ElementProps>(node)) return [];
	return [node, ...React.Children.toArray(node.props.children).flatMap(descendants)];
}

function render(status: DictionaryFavoriteViewState["status"] = "idle", word = "hello") {
	const state: DictionaryFavoriteViewState = {
		word,
		status,
		path: "word.md",
		savedPath: "word.md",
		meaning: "",
		note: "",
		message: "",
		pathSuggestions: [],
	};
	const controller = {
		getSnapshot: () => state,
		subscribe: vi.fn(),
		generateAi: vi.fn(),
		save: vi.fn(),
		clear: vi.fn(),
	};
	const tree = DictionaryFavoriteView({
		controller: controller as unknown as DictionaryFavoriteController,
		language: "en",
	});
	return { controller, nodes: descendants(tree), tree };
}

describe("favorite form AI generation", () => {
	it("dispatches generation through a non-submit button without requiring configuration in the view", () => {
		const { controller, nodes } = render();
		const generate = nodes.find((node) => node.props.children === "Generate with AI");
		expect(generate?.props.type).toBe("button");
		expect(generate?.props.disabled).toBe(false);
		generate?.props.onClick?.();
		expect(controller.generateAi).toHaveBeenCalledOnce();
		expect(controller.save).not.toHaveBeenCalled();
	});

	it.each(["saving", "generating"] as const)(
		"locks form editing and actions while %s",
		(status) => {
			const { controller, nodes, tree } = render(status);
			expect((tree.props as ElementProps)["aria-busy"]).toBe(true);
			const inputs = nodes.filter(
				(node) =>
					node.props.id?.startsWith("dictionary-favorite-") &&
					node.props.id !== "dictionary-favorite-path-suggestions",
			);
			expect(inputs).toHaveLength(4);
			expect(inputs.every((node) => node.props.disabled)).toBe(true);
			const actions = nodes.filter(
				(node) =>
					node.props.type === "submit" ||
					node.props.children === "Clear form" ||
					node.props.children === "Generate with AI" ||
					node.props.children === "Generating…",
			);
			expect(actions).toHaveLength(3);
			expect(actions.every((node) => node.props.disabled)).toBe(true);
			const preventDefault = vi.fn();
			nodes.find((node) => node.type === "form")?.props.onSubmit?.({ preventDefault });
			expect(preventDefault).toHaveBeenCalledOnce();
			expect(controller.save).not.toHaveBeenCalled();
		},
	);

	it("disables generation for an empty word and restores editable fields after success", () => {
		const empty = render("idle", "  ");
		expect(
			empty.nodes.find((node) => node.props.children === "Generate with AI")?.props.disabled,
		).toBe(true);
		const { nodes, tree } = render("success");
		expect((tree.props as ElementProps)["aria-busy"]).toBe(false);
		expect(
			nodes.find((node) => node.props.id === "dictionary-favorite-meaning")?.props.disabled,
		).toBe(false);
		expect(
			nodes.find((node) => node.props.children === "Generate with AI")?.props.disabled,
		).toBe(false);
	});
});
