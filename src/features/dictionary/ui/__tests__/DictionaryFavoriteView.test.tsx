/* oxlint-disable typescript/unbound-method */
import React from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DictionaryFavoriteView } from "../DictionaryFavoriteView";
import type { DictionaryFavoriteController } from "../../domain/favorite-controller";
import type { DictionaryFavoriteViewState } from "../../domain/types";
import { FlashcardButton } from "../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../core/ui/primitives/Input";

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
	it("renders open-source-file button and triggers controller.openSavedFile on click", () => {
		const snapshot: DictionaryFavoriteViewState = {
			meaning: "测试释义",
			message: "",
			note: "测试笔记",
			path: "1-English/Word.md",
			pathSuggestions: [],
			savedPath: "word.md",
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
		} as unknown as DictionaryFavoriteController;

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
			meaning: "",
			message: "",
			note: "",
			path: "   ",
			pathSuggestions: [],
			savedPath: "word.md",
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
		} as unknown as DictionaryFavoriteController;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const buttons = findButtons(tree);
		const openButton = buttons.find((b) => b.props["aria-label"] === "打开源文件");

		expect(openButton).toBeDefined();
		expect(openButton?.props.disabled).toBe(true);
	});

	it("triggers AI generation on Enter in word input", () => {
		const snapshot: DictionaryFavoriteViewState = {
			meaning: "",
			message: "",
			note: "",
			path: "word.md",
			pathSuggestions: [],
			savedPath: "word.md",
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
		} as unknown as DictionaryFavoriteController;

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
			meaning: "",
			message: "",
			note: "",
			path: "word.md",
			pathSuggestions: [],
			savedPath: "word.md",
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
		} as unknown as DictionaryFavoriteController;

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
			meaning: "苹果",
			message: "",
			note: "",
			path: "word.md",
			pathSuggestions: [],
			savedPath: "word.md",
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
		} as unknown as DictionaryFavoriteController;

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
