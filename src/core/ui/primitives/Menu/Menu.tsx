import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { Ellipsis } from "lucide-react";
import { FlashcardButton } from "../Button";

export interface FlashcardMenuItem {
	key: string;
	label: React.ReactNode;
	icon?: LucideIcon;
	onSelect: () => void;
	disabled?: boolean;
	danger?: boolean;
	title?: string;
	iconClassName?: string;
}

export interface FlashcardMenuProps {
	items: FlashcardMenuItem[];
	triggerTitle: string;
	ariaLabel: string;
	triggerIcon?: LucideIcon;
	triggerClassName?: string;
	menuClassName?: string;
	align?: "start" | "end";
	open?: boolean;
	presentation?: "dropdown" | "floating" | "inline";
	onOpenChange?: (open: boolean) => void;
	stopPropagation?: boolean;
}

/** Accessible action menu with outside-click, Escape, and arrow-key behavior. */
export const FlashcardMenu: React.FC<FlashcardMenuProps> = ({
	items,
	triggerTitle,
	ariaLabel,
	triggerIcon = Ellipsis,
	triggerClassName = "",
	menuClassName = "",
	align = "end",
	open,
	presentation = "dropdown",
	onOpenChange,
	stopPropagation = true,
}) => {
	const [localOpen, setLocalOpen] = useState(false);
	const isOpen = open ?? localOpen;
	const floating = presentation === "floating";
	const inline = presentation === "inline" && isOpen;
	const openStateIsLocal = open === undefined;
	const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
	const menuId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const initialFocus = useRef(0);

	useLayoutEffect(() => {
		if (floating && isOpen) setPortalHost(rootRef.current?.ownerDocument.body ?? null);
	}, [floating, isOpen]);

	const setOpen = useCallback(
		(open: boolean) => {
			if (openStateIsLocal) setLocalOpen(open);
			onOpenChange?.(open);
		},
		[onOpenChange, openStateIsLocal],
	);

	const focusItem = useCallback((index: number) => {
		const controls = Array.from(
			menuRef.current?.querySelectorAll<HTMLButtonElement>(
				".flashcard-menu-item:not(:disabled)",
			) ?? [],
		);
		const target =
			controls.length > 0
				? controls[(index + controls.length) % controls.length]
				: menuRef.current;
		target?.focus();
	}, []);

	useLayoutEffect(() => {
		const trigger = triggerRef.current;
		const menu = menuRef.current;
		const view = trigger?.ownerDocument.defaultView;
		if (!isOpen || !trigger || !menu || !view) return;
		if (floating) {
			const anchor = trigger.getBoundingClientRect();
			const { width, height } = menu.getBoundingClientRect();
			const gap = 8;
			const below = anchor.bottom + gap;
			const above = anchor.top - gap - height;
			const top = below + height <= view.innerHeight - gap || above < gap ? below : above;
			const left = align === "end" ? anchor.right - width : anchor.left;
			menu.style.top = `${Math.max(gap, Math.min(top, view.innerHeight - height - gap))}px`;
			menu.style.left = `${Math.max(gap, Math.min(left, view.innerWidth - width - gap))}px`;
		}
		focusItem(initialFocus.current);
		initialFocus.current = 0;
	}, [align, floating, focusItem, isOpen, portalHost]);

	useEffect(() => {
		if (!isOpen) return;
		const ownerDocument = rootRef.current?.ownerDocument;
		if (!ownerDocument) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
				setOpen(false);
			}
		};
		const closeAndFocus = () => {
			setOpen(false);
			triggerRef.current?.focus({ preventScroll: true });
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			closeAndFocus();
		};
		const handleScroll = (event: Event) => {
			if (!menuRef.current?.contains(event.target as Node | null)) closeAndFocus();
		};
		const view = ownerDocument.defaultView;

		ownerDocument.addEventListener("pointerdown", handlePointerDown);
		ownerDocument.addEventListener("keydown", handleKeyDown);
		if (floating) {
			ownerDocument.addEventListener("scroll", handleScroll, true);
			view?.addEventListener("resize", closeAndFocus);
		}
		return () => {
			ownerDocument.removeEventListener("pointerdown", handlePointerDown);
			ownerDocument.removeEventListener("keydown", handleKeyDown);
			if (floating) {
				ownerDocument.removeEventListener("scroll", handleScroll, true);
				view?.removeEventListener("resize", closeAndFocus);
			}
		};
	}, [floating, isOpen, setOpen]);

	const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const controls = Array.from(
			menuRef.current?.querySelectorAll<HTMLButtonElement>(
				".flashcard-menu-item:not(:disabled)",
			) ?? [],
		);
		const currentIndex = controls.indexOf(event.target as HTMLButtonElement);
		if (event.key === "Tab") {
			setOpen(false);
			triggerRef.current?.focus({ preventScroll: true });
		} else if (event.key === "ArrowDown") {
			event.preventDefault();
			focusItem(currentIndex + 1);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			focusItem(currentIndex < 0 ? -1 : currentIndex - 1);
		} else if (event.key === "Home") {
			event.preventDefault();
			focusItem(0);
		} else if (event.key === "End") {
			event.preventDefault();
			focusItem(controls.length - 1);
		}
	};

	const menu = isOpen ? (
		<div
			ref={menuRef}
			id={menuId}
			className={`flashcard-menu${menuClassName ? ` ${menuClassName}` : ""}`}
			role="menu"
			tabIndex={-1}
			aria-label={ariaLabel}
			onKeyDown={handleMenuKeyDown}
		>
			{items.map((item) => {
				const Icon = item.icon;
				return (
					<button
						key={item.key}
						type="button"
						className={`flashcard-menu-item${item.danger ? " is-danger" : ""}`}
						role="menuitem"
						tabIndex={-1}
						disabled={item.disabled}
						title={item.title}
						onClick={(event) => {
							if (stopPropagation) event.stopPropagation();
							setOpen(false);
							triggerRef.current?.focus({ preventScroll: true });
							item.onSelect();
						}}
					>
						{Icon && (
							<Icon size={16} className={item.iconClassName} aria-hidden="true" />
						)}
						<span>{item.label}</span>
					</button>
				);
			})}
		</div>
	) : null;

	return (
		<div
			ref={rootRef}
			className={`flashcard-menu-root is-${align}${inline ? " is-inline" : ""}`}
		>
			<FlashcardButton
				ref={triggerRef}
				preset="icon"
				icon={triggerIcon}
				className={`flashcard-menu-trigger${triggerClassName ? ` ${triggerClassName}` : ""}`}
				onClick={(event) => {
					if (stopPropagation) event.stopPropagation();
					setOpen(!isOpen);
					if (isOpen) triggerRef.current?.focus({ preventScroll: true });
				}}
				onKeyDown={(event) => {
					if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
					event.preventDefault();
					const index = event.key === "ArrowUp" ? -1 : 0;
					if (isOpen) {
						focusItem(index);
					} else {
						initialFocus.current = index;
						setOpen(true);
					}
				}}
				active={isOpen}
				title={triggerTitle}
				aria-label={triggerTitle}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				aria-controls={isOpen ? menuId : undefined}
			/>
			{floating
				? menu &&
					portalHost &&
					createPortal(
						<div className="fc-overlay flashcard-menu-root is-floating">{menu}</div>,
						portalHost,
					)
				: menu}
		</div>
	);
};
