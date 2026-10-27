/* oxlint-disable typescript/unbound-method */
import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DictionaryFavoriteView } from "../DictionaryFavoriteView";
import type { DictionaryFavoriteSession } from "../../domain/favoriteSession";
import type { DictionaryFavoriteViewState } from "../../domain/types";
import { FlashcardButton } from "../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../core/ui/primitives/Input";
import { FlashcardSelect } from "../../../../core/ui/primitives/Select";

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
	useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

function findButtons(
	node: React.ReactNode,
): React.ReactElement<React.ComponentProps<typeof FlashcardButton>>[] {
	const found: React.ReactElement<React.ComponentProps<typeof FlashcardButton>>[] = [];
	function visit(current: React.ReactNode): void {
		React.Children.forEach(current, (child) => {
			if (!React.isValidElement(child)) return;
			if (child.type === FlashcardButton) {
				found.push(
					child as React.ReactElement<React.ComponentProps<typeof FlashcardButton>>,
				);
			}
			const props = child.props as { children?: React.ReactNode };
			if (props && props.children) {
				visit(props.children);
			}
		});
	}
	visit(node);
	return found;
}

function findInputs(
	node: React.ReactNode,
): React.ReactElement<React.ComponentProps<typeof FlashcardInput>>[] {
	const found: React.ReactElement<React.ComponentProps<typeof FlashcardInput>>[] = [];
	function visit(current: React.ReactNode): void {
		React.Children.forEach(current, (child) => {
			if (!React.isValidElement(child)) return;
			if (child.type === FlashcardInput) {
				found.push(
					child as React.ReactElement<React.ComponentProps<typeof FlashcardInput>>,
				);
			}
			const props = child.props as { children?: React.ReactNode };
			if (props && props.children) {
				visit(props.children);
			}
		});
	}
	visit(node);
	return found;
}

function findForm(
	node: React.ReactNode,
): React.ReactElement<React.FormHTMLAttributes<HTMLFormElement>> | null {
	let found: React.ReactElement<React.FormHTMLAttributes<HTMLFormElement>> | null = null;
	function visit(current: React.ReactNode): void {
		React.Children.forEach(current, (child) => {
			if (!React.isValidElement(child)) return;
			if (child.type === "form") {
				found = child as React.ReactElement<React.FormHTMLAttributes<HTMLFormElement>>;
				return;
			}
			const props = child.props as { children?: React.ReactNode };
			if (props && props.children) {
				visit(props.children);
			}
		});
	}
	visit(node);
	return found;
}

describe("DictionaryFavoriteView", () => {
	it("shows new category last and routes selection and creation separately", () => {
		const snapshot: DictionaryFavoriteViewState = {
			categories: [
				{ id: "default", name: "默认收藏", path: "word.md" },
				{ id: "second", name: "第二类", path: "second.md" },
			],
			selectedCategoryId: "default",
			meaning: "",
			message: "",
			note: "",
			path: "word.md",
			status: "idle",
			word: "apple",
		};
		const selectCategory = vi.fn();
		const onCreateCategory = vi.fn();
		const controller = {
			subscribe: vi.fn(() => () => undefined),
			getSnapshot: () => snapshot,
			selectCategory,
		} as unknown as DictionaryFavoriteSession;
		const tree = DictionaryFavoriteView({ controller, language: "zh", onCreateCategory });
		const found: React.ReactElement<React.ComponentProps<typeof FlashcardSelect>>[] = [];
		function visit(node: React.ReactNode): void {
			React.Children.forEach(node, (child) => {
				if (!React.isValidElement(child)) return;
				if (child.type === FlashcardSelect)
					found.push(
						child as React.ReactElement<React.ComponentProps<typeof FlashcardSelect>>,
					);
				visit((child.props as { children?: React.ReactNode }).children);
			});
		}
		visit(tree);
		const select = found[0]!;
		expect(
			React.Children.toArray(select.props.children).map((child) =>
				React.isValidElement(child) ? (child.props as { value: string }).value : "",
			),
		).toEqual(["default", "second", "__new__"]);
		const target = { value: "__new__" };
		select.props.onChange?.({
			target,
			currentTarget: target,
		} as React.ChangeEvent<HTMLSelectElement>);
		expect(onCreateCategory).toHaveBeenCalledOnce();
		expect(target.value).toBe("default");
		select.props.onChange?.({
			target: { value: "second" },
		} as React.ChangeEvent<HTMLSelectElement>);
		expect(selectCategory).toHaveBeenCalledWith("second");
	});
	it("renders open-source-file button and triggers controller.openSavedFile on click", () => {
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "1-English/Word.md" }],
			selectedCategoryId: "default",
			meaning: "测试释义",
			message: "",
			note: "测试笔记",
			path: "1-English/Word.md",
			status: "idle",
			word: "test",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
			openSavedFile: vi.fn(),
			setPath: vi.fn(),
			setWord: vi.fn(),
			setMeaning: vi.fn(),
			setNote: vi.fn(),
			save: vi.fn(),
			clear: vi.fn(),
			generateAi: vi.fn(),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const buttons = findButtons(tree);
		const openButton = buttons.find((b) => b.props["aria-label"] === "打开源文件");

		expect(openButton).toBeDefined();
		expect(openButton?.props.disabled).toBe(false);

		const fakeEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		} as unknown as React.MouseEvent<HTMLButtonElement>;

		openButton?.props.onClick?.(fakeEvent);
		expect(fakeEvent.preventDefault).toHaveBeenCalled();
		expect(fakeEvent.stopPropagation).toHaveBeenCalled();
		expect(controller.openSavedFile).toHaveBeenCalledWith("1-English/Word.md");
	});

	it("disables the open-source-file button when path is empty", () => {
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedCategoryId: "default",
			meaning: "",
			message: "",
			note: "",
			path: "   ",
			status: "idle",
			word: "test",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
			openSavedFile: vi.fn(),
			setPath: vi.fn(),
			setWord: vi.fn(),
			setMeaning: vi.fn(),
			setNote: vi.fn(),
			save: vi.fn(),
			clear: vi.fn(),
			generateAi: vi.fn(),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const buttons = findButtons(tree);
		const openButton = buttons.find((b) => b.props["aria-label"] === "打开源文件");

		expect(openButton).toBeDefined();
		expect(openButton?.props.disabled).toBe(true);
	});

	it("triggers AI generation on Enter in word input", () => {
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedCategoryId: "default",
			meaning: "",
			message: "",
			note: "",
			path: "word.md",
			status: "idle",
			word: "apple",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
			openSavedFile: vi.fn(),
			setPath: vi.fn(),
			setWord: vi.fn(),
			setMeaning: vi.fn(),
			setNote: vi.fn(),
			save: vi.fn(),
			clear: vi.fn(),
			generateAi: vi.fn(),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const inputs = findInputs(tree);
		const wordInput = inputs.find((i) => i.props.id === "dictionary-favorite-word");
		expect(wordInput).toBeDefined();

		const enterEvent = {
			key: "Enter",
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			altKey: false,
			nativeEvent: { isComposing: false },
			preventDefault: vi.fn(),
		} as unknown as React.KeyboardEvent<HTMLInputElement>;

		wordInput?.props.onKeyDown?.(enterEvent);
		expect(enterEvent.preventDefault).toHaveBeenCalled();
		expect(controller.generateAi).toHaveBeenCalledOnce();
		expect(controller.save).not.toHaveBeenCalled();
	});

	it("does not trigger AI generation on Enter if composing in IME", () => {
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedCategoryId: "default",
			meaning: "",
			message: "",
			note: "",
			path: "word.md",
			status: "idle",
			word: "apple",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
			openSavedFile: vi.fn(),
			setPath: vi.fn(),
			setWord: vi.fn(),
			setMeaning: vi.fn(),
			setNote: vi.fn(),
			save: vi.fn(),
			clear: vi.fn(),
			generateAi: vi.fn(),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const inputs = findInputs(tree);
		const wordInput = inputs.find((i) => i.props.id === "dictionary-favorite-word");

		const composingEvent = {
			key: "Enter",
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			altKey: false,
			nativeEvent: { isComposing: true },
			preventDefault: vi.fn(),
		} as unknown as React.KeyboardEvent<HTMLInputElement>;

		wordInput?.props.onKeyDown?.(composingEvent);
		expect(composingEvent.preventDefault).not.toHaveBeenCalled();
		expect(controller.generateAi).not.toHaveBeenCalled();
	});

	it("triggers save on Ctrl+Enter in word input and form", () => {
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedCategoryId: "default",
			meaning: "苹果",
			message: "",
			note: "",
			path: "word.md",
			status: "idle",
			word: "apple",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
			openSavedFile: vi.fn(),
			setPath: vi.fn(),
			setWord: vi.fn(),
			setMeaning: vi.fn(),
			setNote: vi.fn(),
			save: vi.fn(),
			clear: vi.fn(),
			generateAi: vi.fn(),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const inputs = findInputs(tree);
		const wordInput = inputs.find((i) => i.props.id === "dictionary-favorite-word");

		const ctrlEnterEvent = {
			key: "Enter",
			ctrlKey: true,
			metaKey: false,
			nativeEvent: { isComposing: false },
			preventDefault: vi.fn(),
		} as unknown as React.KeyboardEvent<HTMLInputElement>;

		wordInput?.props.onKeyDown?.(ctrlEnterEvent);
		expect(ctrlEnterEvent.preventDefault).toHaveBeenCalled();
		expect(controller.save).toHaveBeenCalledOnce();

		const form = findForm(tree);
		expect(form).toBeDefined();

		const formCtrlEnterEvent = {
			key: "Enter",
			ctrlKey: true,
			metaKey: false,
			nativeEvent: { isComposing: false },
			preventDefault: vi.fn(),
		} as unknown as React.KeyboardEvent<HTMLFormElement>;

		form?.props.onKeyDown?.(formCtrlEnterEvent);
		expect(formCtrlEnterEvent.preventDefault).toHaveBeenCalled();
		expect(controller.save).toHaveBeenCalledTimes(2);
	});
});
