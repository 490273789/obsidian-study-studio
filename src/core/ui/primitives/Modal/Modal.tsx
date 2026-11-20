import React, {
	createContext,
	useCallback,
	useContext,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	canRequestModalClose,
	getModalFocusDestination,
	getModalLayer,
	getModalTabStops,
	registerModal,
	unregisterModal,
	type ModalId,
} from "./modalBehavior";

const INITIAL_FOCUS_SELECTOR = "[data-modal-initial-focus]";
const INITIAL_FOCUS_PROPS = { "data-modal-initial-focus": "" } as const;

interface ModalContextValue {
	host: HTMLElement;
	stack: readonly ModalId[];
	register: (modalId: ModalId) => () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

interface ModalProviderProps {
	host: HTMLElement;
	children: React.ReactNode;
}

export function ModalProvider({ host, children }: ModalProviderProps) {
	const [stack, setStack] = useState<readonly ModalId[]>([]);
	const register = useCallback((modalId: ModalId) => {
		setStack((current) => registerModal(current, modalId));
		return () => {
			setStack((current) => unregisterModal(current, modalId));
		};
	}, []);
	const value = useMemo(() => ({ host, stack, register }), [host, register, stack]);

	return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>;
}

interface ModalControls {
	requestClose: () => void;
	initialFocusProps: typeof INITIAL_FOCUS_PROPS;
}

interface ModalSurfaceProps {
	children: (controls: ModalControls) => React.ReactNode;
	onRequestClose: () => void;
	isDismissible?: boolean;
	role?: "dialog" | "alertdialog";
	labelledBy: string;
	describedBy?: string;
	className?: string;
	backdropClassName?: string;
}

export function ModalSurface({
	children,
	onRequestClose,
	isDismissible = true,
	role = "dialog",
	labelledBy,
	describedBy,
	className,
	backdropClassName,
}: ModalSurfaceProps) {
	const context = useContext(ModalContext);
	if (!context) {
		throw new Error("ModalSurface must be rendered inside ModalProvider");
	}

	const modalId = useId();
	const panelRef = useRef<HTMLDivElement | null>(null);
	const [previouslyFocused] = useState(() =>
		asFocusableElement(context.host.ownerDocument.activeElement),
	);
	const hasActivatedRef = useRef(false);
	const restoreFrameRef = useRef<number | null>(null);
	const { host, register, stack } = context;
	const { index, isTopmost } = getModalLayer(stack, modalId);

	useLayoutEffect(() => register(modalId), [modalId, register]);

	useLayoutEffect(() => {
		if (!isTopmost) return;
		const panel = panelRef.current;
		if (!panel) return;
		if (!hasActivatedRef.current) {
			hasActivatedRef.current = true;
			focusInitialElement(panel);
			return;
		}
		if (!panel.contains(host.ownerDocument.activeElement)) {
			focusInitialElement(panel);
		}
	}, [host, isTopmost]);

	useLayoutEffect(() => {
		const ownerWindow = host.ownerDocument.defaultView;
		if (ownerWindow && restoreFrameRef.current !== null) {
			ownerWindow.cancelAnimationFrame(restoreFrameRef.current);
			restoreFrameRef.current = null;
		}
		return () => {
			if (!previouslyFocused) return;
			const restoreFocus = () => {
				if (previouslyFocused.isConnected) {
					previouslyFocused.focus({ preventScroll: true });
				}
			};
			if (ownerWindow) {
				restoreFrameRef.current = ownerWindow.requestAnimationFrame(() => {
					restoreFrameRef.current = null;
					restoreFocus();
				});
			} else {
				restoreFocus();
			}
		};
	}, [host, previouslyFocused]);

	const requestClose = useCallback(() => {
		if (canRequestModalClose(isTopmost, isDismissible)) {
			onRequestClose();
		}
	}, [isDismissible, isTopmost, onRequestClose]);

	const handleBackdropClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (event.target === event.currentTarget) requestClose();
		},
		[requestClose],
	);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLDivElement>) => {
			if (!isTopmost) return;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				requestClose();
				return;
			}
			if (event.key !== "Tab") return;

			const panel = panelRef.current;
			if (!panel) return;
			const focusable = getModalTabStops(panel);
			const activeIndex = focusable.indexOf(host.ownerDocument.activeElement as HTMLElement);
			const destination = getModalFocusDestination(
				focusable.length,
				activeIndex,
				event.shiftKey,
			);
			if (destination === null) return;

			event.preventDefault();
			const target =
				destination === "container"
					? panel
					: destination === "first"
						? focusable[0]
						: focusable[focusable.length - 1];
			target?.focus({ preventScroll: true });
		},
		[host, isTopmost, requestClose],
	);

	const controls = useMemo(
		() => ({ requestClose, initialFocusProps: INITIAL_FOCUS_PROPS }),
		[requestClose],
	);
	const layerIndex = Math.max(index, 0);
	const backdropClasses = ["flashcard-modal-backdrop", backdropClassName]
		.filter(Boolean)
		.join(" ");
	const panelClasses = ["flashcard-modal", className].filter(Boolean).join(" ");

	return createPortal(
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- Backdrop click is supplemental; keyboard dismissal is handled by the dialog.
		<div
			className={backdropClasses}
			onClick={handleBackdropClick}
			aria-hidden={isTopmost ? undefined : true}
			inert={isTopmost ? undefined : true}
			style={{ zIndex: 999 + layerIndex }}
			role="presentation"
		>
			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- The runtime role is always dialog or alertdialog. */}
			<div
				ref={panelRef}
				className={panelClasses}
				role={role}
				aria-modal="true"
				aria-labelledby={labelledBy}
				aria-describedby={describedBy}
				tabIndex={-1}
				onKeyDown={handleKeyDown}
			>
				{children(controls)}
			</div>
		</div>,
		host,
	);
}

function focusInitialElement(panel: HTMLElement): void {
	const focusable = getModalTabStops(panel);
	const marked = panel.querySelector<HTMLElement>(INITIAL_FOCUS_SELECTOR);
	const initialFocus = marked && focusable.includes(marked) ? marked : (focusable[0] ?? panel);
	initialFocus.focus({ preventScroll: true });
}

function asFocusableElement(element: Element | null): HTMLElement | null {
	if (!element || typeof (element as HTMLElement).focus !== "function") return null;
	return element as HTMLElement;
}
