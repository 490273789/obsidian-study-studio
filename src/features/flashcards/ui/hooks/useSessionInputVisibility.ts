import {
	createContext,
	createElement,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	type ReactNode,
	type RefObject,
} from "react";
import { InputVisibility, type InputBinding, type InputReturn } from "../inputVisibility";

const InputVisibilityContext = createContext<InputVisibility | null>(null);
const NO_RETURN: InputReturn = { isCurrent: () => false, focus: () => {} };

/** Own window compatibility once per flashcard view; question leases live below it. */
export function InputVisibilityProvider({
	host,
	children,
}: {
	host: HTMLElement;
	children: ReactNode;
}) {
	const visibility = useMemo(() => new InputVisibility(host.ownerDocument), [host.ownerDocument]);
	useLayoutEffect(() => visibility.mount(), [visibility]);
	return createElement(InputVisibilityContext.Provider, { value: visibility }, children);
}

/** React supplies the current question and elements; the module owns delayed work. */
export function useSessionInputVisibility(
	inputRef: RefObject<HTMLInputElement | null>,
	viewRef: RefObject<HTMLDivElement | null>,
	question: string,
	focusOnEntry = true,
) {
	const visibility = useContext(InputVisibilityContext);
	if (!visibility) throw new Error("Session input requires InputVisibilityProvider");
	const current = useRef<{
		input: HTMLInputElement | null;
		view: HTMLElement;
		question: string;
		focusOnEntry: boolean;
		binding: InputBinding;
	} | null>(null);
	useLayoutEffect(() => {
		const input = inputRef.current;
		const view = viewRef.current;
		const previous = current.current;
		if (
			previous?.input === input &&
			previous.view === view &&
			previous.question === question &&
			previous.focusOnEntry === focusOnEntry
		)
			return;
		previous?.binding.dispose();
		current.current = view
			? {
					input,
					view,
					question,
					focusOnEntry,
					binding: visibility.open({ input, view, question, focusOnEntry }),
				}
			: null;
	});
	useLayoutEffect(
		() => () => {
			current.current?.binding.dispose();
			current.current = null;
		},
		[visibility],
	);
	const keepInputVisible = useCallback(() => current.current?.binding.keepVisible(), []);
	const handleInputBlur = useCallback(() => current.current?.binding.blur(), []);
	const captureReturn = useCallback(
		() => current.current?.binding.captureReturn() ?? NO_RETURN,
		[],
	);
	return { keepInputVisible, handleInputBlur, captureReturn };
}
