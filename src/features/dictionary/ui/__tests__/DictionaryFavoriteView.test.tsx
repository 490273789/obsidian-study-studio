/* oxlint-disable typescript/unbound-method */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DictionaryFavoriteView, isFavoritePageFocused } from "../DictionaryFavoriteView";
import type { DictionaryFavoriteSession } from "../../domain/favoriteSession";
import type { DictionaryFavoriteViewState } from "../../domain/types";
import { FlashcardButton } from "../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../core/ui/primitives/Input";
import { FlashcardSelect } from "../../../../core/ui/primitives/Select";

const hookSlots: { current: unknown }[] = [];
let hookCursor = 0;

vi.mock("react", async (original) => ({
	...(await original<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
	useEffect: (callback: () => void | (() => void)) => {
		callback();
	},
	useRef: (initial: unknown) => {
		const slot = (hookSlots[hookCursor++] ??= { current: initial });
		return slot;
	},
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

function findNativeButtons(
	node: React.ReactNode,
): React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>[] {
	const found: React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>[] = [];
	function visit(current: React.ReactNode): void {
		React.Children.forEach(current, (child) => {
			if (!React.isValidElement(child)) return;
			if (child.type === "button") {
				found.push(
					child as React.ReactElement<React.ButtonHTMLAttributes<HTMLButtonElement>>,
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

function findMain(
	node: React.ReactNode,
): React.ReactElement<React.HTMLAttributes<HTMLElement>> | null {
	let found: React.ReactElement<React.HTMLAttributes<HTMLElement>> | null = null;
	function visit(current: React.ReactNode): void {
		React.Children.forEach(current, (child) => {
			if (!React.isValidElement(child)) return;
			if (child.type === "main") {
				found = child as React.ReactElement<React.HTMLAttributes<HTMLElement>>;
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
	beforeEach(() => {
		hookCursor = 0;
		hookSlots.length = 0;
	});

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
	it("renders clickable file path and triggers controller.openSavedFile on click", () => {
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
		const nativeButtons = findNativeButtons(tree);
		const pathButton = nativeButtons.find((b) => b.props["aria-label"]?.includes("打开源文件"));

		expect(pathButton).toBeDefined();
		expect(pathButton?.props.disabled).toBe(false);

		// Verify standalone external link FlashcardButton beside select is removed
		const flashcardButtons = findButtons(tree);
		const oldOpenButton = flashcardButtons.find((b) => b.props["aria-label"] === "打开源文件");
		expect(oldOpenButton).toBeUndefined();

		const fakeEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		} as unknown as React.MouseEvent<HTMLButtonElement>;

		pathButton?.props.onClick?.(fakeEvent);
		expect(fakeEvent.preventDefault).toHaveBeenCalled();
		expect(fakeEvent.stopPropagation).toHaveBeenCalled();
		expect(controller.openSavedFile).toHaveBeenCalledWith("1-English/Word.md");
	});

	it("does not render file path button when path is empty", () => {
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
		const nativeButtons = findNativeButtons(tree);
		const pathButton = nativeButtons.find((b) => b.props["aria-label"]?.includes("打开源文件"));

		expect(pathButton).toBeUndefined();
	});

	it("renders header clear button when form has content and calls session.clear", () => {
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedCategoryId: "default",
			meaning: "一些释义",
			message: "",
			note: "",
			path: "word.md",
			status: "idle",
			word: "test",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
			clear: vi.fn(),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const buttons = findButtons(tree);
		const clearButton = buttons.find((b) => b.props["aria-label"] === "清空表单");

		expect(clearButton).toBeDefined();
		clearButton?.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(controller.clear).toHaveBeenCalledOnce();
	});

	it("does not render header clear button when form is empty", () => {
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedCategoryId: "default",
			meaning: "",
			message: "",
			note: "",
			path: "word.md",
			status: "idle",
			word: "",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
			clear: vi.fn(),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const buttons = findButtons(tree);
		const clearButton = buttons.find((b) => b.props["aria-label"] === "清空表单");

		expect(clearButton).toBeUndefined();
	});

	it("triggers AI generation on click of the inline AI button", () => {
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
			generateAi: vi.fn(),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const buttons = findButtons(tree);
		const aiButton = buttons.find((b) => b.props["aria-label"]?.includes("AI 生成"));

		expect(aiButton).toBeDefined();
		aiButton?.props.onClick?.({} as React.MouseEvent<HTMLButtonElement>);
		expect(controller.generateAi).toHaveBeenCalledOnce();
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

	it("passes ref to the word input and automatically focuses it when AI generation completes", () => {
		let currentStatus: DictionaryFavoriteViewState["status"] = "generating";
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedCategoryId: "default",
			meaning: "苹果；珍宝",
			message: "",
			note: "",
			path: "word.md",
			get status() {
				return currentStatus;
			},
			word: "apple",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
		} as unknown as DictionaryFavoriteSession;

		const mockFocus = vi.fn();
		const mockSetSelectionRange = vi.fn();
		const mockInput = {
			value: "apple",
			focus: mockFocus,
			setSelectionRange: mockSetSelectionRange,
		};
		const wordRef = { current: mockInput as unknown as HTMLInputElement };

		// First render: state.status is "generating"
		hookCursor = 0;
		const tree1 = DictionaryFavoriteView({
			controller,
			language: "zh",
			wordInputRef: wordRef,
		});

		const inputs1 = findInputs(tree1);
		const wordEl1 = inputs1.find((i) => i.props.id === "dictionary-favorite-word");
		expect(wordEl1).toBeDefined();
		expect((wordEl1!.props as { ref?: unknown }).ref).toBe(wordRef);
		expect(mockFocus).not.toHaveBeenCalled();

		// Second render: state.status transitioned to "success"
		currentStatus = "success";
		hookCursor = 0;
		DictionaryFavoriteView({
			controller,
			language: "zh",
			wordInputRef: wordRef,
		});

		expect(mockFocus).toHaveBeenCalledOnce();
		expect(mockSetSelectionRange).toHaveBeenCalledWith(5, 5);
	});

	it("automatically focuses and selects the word input when save completes", () => {
		let currentStatus: DictionaryFavoriteViewState["status"] = "saving";
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedCategoryId: "default",
			meaning: "苹果；珍宝",
			message: "",
			note: "",
			path: "word.md",
			get status() {
				return currentStatus;
			},
			word: "apple",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
		} as unknown as DictionaryFavoriteSession;

		const mockFocus = vi.fn();
		const mockSelect = vi.fn();
		const mockInput = {
			value: "apple",
			focus: mockFocus,
			select: mockSelect,
		};
		const wordRef = { current: mockInput as unknown as HTMLInputElement };

		// First render: state.status is "saving"
		hookCursor = 0;
		DictionaryFavoriteView({
			controller,
			language: "zh",
			wordInputRef: wordRef,
		});
		expect(mockFocus).not.toHaveBeenCalled();

		// Second render: state.status transitioned to "success"
		currentStatus = "success";
		hookCursor = 0;
		DictionaryFavoriteView({
			controller,
			language: "zh",
			wordInputRef: wordRef,
		});

		expect(mockFocus).toHaveBeenCalledOnce();
		expect(mockSelect).toHaveBeenCalledOnce();
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

	it("triggers save on Ctrl+Enter, Cmd+Enter, or Ctrl+S when main element is focused", () => {
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
			save: vi.fn(),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const main = findMain(tree);
		expect(main).toBeDefined();
		expect(main?.props.tabIndex).toBe(-1);

		// Ctrl+Enter on main
		const ctrlEnter = {
			key: "Enter",
			ctrlKey: true,
			metaKey: false,
			nativeEvent: { isComposing: false },
			preventDefault: vi.fn(),
		} as unknown as React.KeyboardEvent<HTMLElement>;
		main?.props.onKeyDown?.(ctrlEnter);
		expect(ctrlEnter.preventDefault).toHaveBeenCalled();
		expect(controller.save).toHaveBeenCalledTimes(1);

		// Cmd+Enter on main
		const cmdEnter = {
			key: "Enter",
			ctrlKey: false,
			metaKey: true,
			nativeEvent: { isComposing: false },
			preventDefault: vi.fn(),
		} as unknown as React.KeyboardEvent<HTMLElement>;
		main?.props.onKeyDown?.(cmdEnter);
		expect(cmdEnter.preventDefault).toHaveBeenCalled();
		expect(controller.save).toHaveBeenCalledTimes(2);

		// Ctrl+S on main
		const ctrlS = {
			key: "s",
			ctrlKey: true,
			metaKey: false,
			nativeEvent: { isComposing: false },
			preventDefault: vi.fn(),
		} as unknown as React.KeyboardEvent<HTMLElement>;
		main?.props.onKeyDown?.(ctrlS);
		expect(ctrlS.preventDefault).toHaveBeenCalled();
		expect(controller.save).toHaveBeenCalledTimes(3);
	});

	it("focuses main element on pointer down when clicking outside interactive controls", () => {
		const snapshot: DictionaryFavoriteViewState = {
			categories: [{ id: "default", name: "默认收藏", path: "word.md" }],
			selectedCategoryId: "default",
			meaning: "",
			message: "",
			note: "",
			path: "word.md",
			status: "idle",
			word: "",
		};

		const controller = {
			subscribe: vi.fn(() => () => {}),
			getSnapshot: vi.fn(() => snapshot),
		} as unknown as DictionaryFavoriteSession;

		const tree = DictionaryFavoriteView({ controller, language: "zh" });
		const main = findMain(tree);
		expect(main?.props.onPointerDown).toBeDefined();

		const focus = vi.fn();
		const currentTarget = { focus } as unknown as HTMLElement;

		// Clicking on non-interactive element (e.g. empty space in main)
		const emptySpaceTarget = { closest: () => null } as unknown as HTMLElement;
		main?.props.onPointerDown?.({
			button: 0,
			target: emptySpaceTarget,
			currentTarget,
		} as unknown as React.PointerEvent<HTMLElement>);
		expect(focus).toHaveBeenCalledWith({ preventScroll: true });

		// Clicking with right mouse button should not focus
		focus.mockClear();
		main?.props.onPointerDown?.({
			button: 2,
			target: emptySpaceTarget,
			currentTarget,
		} as unknown as React.PointerEvent<HTMLElement>);
		expect(focus).not.toHaveBeenCalled();

		// Clicking on an input should not trigger manual main focus
		focus.mockClear();
		const inputTarget = {
			closest: (selector: string) => (selector.includes("input") ? {} : null),
		} as unknown as HTMLElement;
		main?.props.onPointerDown?.({
			button: 0,
			target: inputTarget,
			currentTarget,
		} as unknown as React.PointerEvent<HTMLElement>);
		expect(focus).not.toHaveBeenCalled();

		// Clicking on a label should not trigger manual main focus
		focus.mockClear();
		const labelTarget = {
			closest: (selector: string) => (selector.includes("label") ? {} : null),
		} as unknown as HTMLElement;
		main?.props.onPointerDown?.({
			button: 0,
			target: labelTarget,
			currentTarget,
		} as unknown as React.PointerEvent<HTMLElement>);
		expect(focus).not.toHaveBeenCalled();
	});

	describe("isFavoritePageFocused", () => {
		class MockElement {
			readonly nodeType = 1;
			parentElement: MockElement | null = null;
			isConnected = true;
			classList = {
				classes: new Set<string>(),
				add: (c: string) => {
					this.classList.classes.add(c);
				},
				contains: (c: string) => this.classList.classes.has(c),
			};
			className = "";
			attributes = new Map<string, string>();

			constructor(
				readonly ownerDocument: MockDocument,
				public tagName = "div",
			) {}

			contains(node: unknown): boolean {
				for (
					let current = node as MockElement | null;
					current;
					current = current.parentElement
				) {
					if (current === this) return true;
				}
				return false;
			}

			closest(selector: string, from: MockElement = this): MockElement | null {
				const selectors = selector.split(",").map((s) => s.trim());
				for (
					let current: MockElement | null = from;
					current;
					current = current.parentElement
				) {
					for (const s of selectors) {
						if (
							s === ".workspace-leaf" &&
							(current.classList.contains("workspace-leaf") ||
								current.className.includes("workspace-leaf"))
						) {
							return current;
						}
						if (
							s === ".modal" &&
							(current.classList.contains("modal") ||
								current.className.includes("modal"))
						) {
							return current;
						}
						if (s.startsWith("[") && s.endsWith("]")) {
							const attr = s.slice(1, -1).split("=")[0]!;
							if (current.attributes.has(attr)) return current;
						}
					}
				}
				return null;
			}

			setAttribute(key: string, value: string): void {
				this.attributes.set(key, value);
			}
		}

		class MockDocument {
			activeElement: MockElement | null = null;
			activeTabHeader: MockElement | null = null;
			modalContainer: MockElement | null = null;

			querySelector(selector: string): MockElement | null {
				if (selector === ".modal-container") return this.modalContainer;
				if (selector === ".workspace-tab-header.is-active") return this.activeTabHeader;
				return null;
			}
		}

		it("detects focus when active element is inside main", () => {
			const doc = new MockDocument();
			const main = new MockElement(doc, "main");
			const input = new MockElement(doc, "input");
			input.parentElement = main;

			doc.activeElement = input;
			expect(isFavoritePageFocused(main as unknown as HTMLElement)).toBe(true);

			doc.activeElement = main;
			expect(isFavoritePageFocused(main as unknown as HTMLElement)).toBe(true);
		});

		it("detects focus when active element is inside the hosting leaf", () => {
			const doc = new MockDocument();
			const leaf = new MockElement(doc, "div");
			leaf.className = "workspace-leaf is-active";
			leaf.classList.add("workspace-leaf");
			leaf.classList.add("is-active");

			const viewHeader = new MockElement(doc, "div");
			viewHeader.parentElement = leaf;

			const main = new MockElement(doc, "main");
			main.parentElement = leaf;

			doc.activeElement = viewHeader;
			expect(isFavoritePageFocused(main as unknown as HTMLElement)).toBe(true);
		});

		it("detects focus when active tab header is focused for active leaf", () => {
			const doc = new MockDocument();
			const tabHeader = new MockElement(doc, "div");
			doc.activeTabHeader = tabHeader;
			doc.activeElement = tabHeader;

			const leaf = new MockElement(doc, "div");
			leaf.className = "workspace-leaf is-active";
			leaf.classList.add("workspace-leaf");
			leaf.classList.add("is-active");

			const main = new MockElement(doc, "main");
			main.parentElement = leaf;

			expect(isFavoritePageFocused(main as unknown as HTMLElement)).toBe(true);
		});

		it("detects focus when active element is inside a modal", () => {
			const doc = new MockDocument();
			const modal = new MockElement(doc, "div");
			modal.className = "modal";
			modal.classList.add("modal");

			const main = new MockElement(doc, "main");
			main.parentElement = modal;

			const textarea = new MockElement(doc, "textarea");
			textarea.parentElement = main;

			doc.activeElement = textarea;
			expect(isFavoritePageFocused(main as unknown as HTMLElement)).toBe(true);
		});

		it("returns false when disconnected, hidden, or focused elsewhere", () => {
			const doc = new MockDocument();
			const main = new MockElement(doc, "main");
			main.isConnected = false;
			expect(isFavoritePageFocused(main as unknown as HTMLElement)).toBe(false);

			main.isConnected = true;
			const outsideInput = new MockElement(doc, "input");
			doc.activeElement = outsideInput;
			expect(isFavoritePageFocused(main as unknown as HTMLElement)).toBe(false);

			main.setAttribute("hidden", "true");
			doc.activeElement = main;
			expect(isFavoritePageFocused(main as unknown as HTMLElement)).toBe(false);
		});

		it("returns false when a modal dialog is open in the workspace and main is in sidebar", () => {
			const doc = new MockDocument();
			const leaf = new MockElement(doc, "div");
			leaf.className = "workspace-leaf is-active";
			leaf.classList.add("workspace-leaf");
			leaf.classList.add("is-active");

			const main = new MockElement(doc, "main");
			main.parentElement = leaf;
			doc.activeElement = main;

			// Open modal in workspace
			doc.modalContainer = new MockElement(doc, "div");

			expect(isFavoritePageFocused(main as unknown as HTMLElement)).toBe(false);
		});
	});
});
