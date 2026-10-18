import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cls } from "../../../shared/classNames";
import { PlaybackRatePopover } from "./PlaybackRatePopover";
import {
	computePlaybackRatePopoverPosition,
	formatPlaybackRate,
	nextPlaybackRateIndex,
} from "./playbackRateMenu";
import type {
	PlaybackRatePopoverAlign,
	PlaybackRatePopoverPosition,
	PlaybackRateTone,
} from "./playbackRateMenu";

export interface PlaybackRateControlProps {
	readonly label: string;
	readonly value: number;
	readonly rates: readonly number[];
	readonly onChange: (rate: number) => void;
	/** `dark` matches the immersive video player console; `default` follows theme tokens. */
	readonly tone?: PlaybackRateTone;
	readonly align?: PlaybackRatePopoverAlign;
	readonly className?: string;
}

const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * Compact playback-speed picker: a pill trigger with a portaled rate grid.
 *
 * The popover is portaled because both hosts clip their overflow (the video
 * player console and the practice footer); that wrapper also re-establishes the
 * `--fc-*` token scope. Keyboard: Arrow keys open and move, Home/End jump,
 * Enter/Space pick, Escape returns focus to the trigger.
 */
export function PlaybackRateControl({
	label,
	value,
	rates,
	onChange,
	tone = "default",
	align = "center",
	className,
}: PlaybackRateControlProps): React.ReactNode {
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState<PlaybackRatePopoverPosition | null>(null);
	const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const optionNodes = useRef(new Map<number, HTMLButtonElement>());
	const popoverId = useId();

	// The popover is portaled to the host document's body to escape the player's
	// overflow clipping; resolve the host after mount instead of during render.
	useEffect(() => {
		setPortalHost(rootRef.current?.ownerDocument.body ?? null);
	}, []);

	const close = useCallback((focusTrigger: boolean) => {
		setOpen(false);
		setPosition(null);
		if (focusTrigger) triggerRef.current?.focus({ preventScroll: true });
	}, []);

	const place = useCallback(() => {
		const trigger = triggerRef.current;
		const popover = popoverRef.current;
		const view = trigger?.ownerDocument.defaultView;
		if (!trigger || !popover || !view) return;
		const anchor = trigger.getBoundingClientRect();
		const size = popover.getBoundingClientRect();
		const next = computePlaybackRatePopoverPosition({
			anchor: {
				top: anchor.top,
				left: anchor.left,
				width: anchor.width,
				height: anchor.height,
			},
			popover: { width: size.width, height: size.height },
			viewport: { width: view.innerWidth, height: view.innerHeight },
			align,
		});
		setPosition((current) =>
			current?.top === next.top &&
			current.left === next.left &&
			current.placement === next.placement
				? current
				: next,
		);
	}, [align]);

	// Measure once the popover is mounted, then move focus onto the current rate.
	useIsomorphicLayoutEffect(() => {
		if (!open) return;
		place();
		const selected =
			optionNodes.current.get(value) ?? optionNodes.current.values().next().value;
		selected?.focus({ preventScroll: true });
	}, [open, place, value]);

	// Dismiss on outside pointer, Escape, and keep the fixed popover anchored.
	useEffect(() => {
		if (!open) return;
		const doc = rootRef.current?.ownerDocument;
		const view = doc?.defaultView;
		if (!doc || !view) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
			close(false);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			// The popover handles its own Escape while it holds focus.
			if (popoverRef.current?.contains(doc.activeElement)) return;
			event.preventDefault();
			close(true);
		};
		const handleReflow = () => place();

		view.addEventListener("resize", handleReflow);
		doc.addEventListener("scroll", handleReflow, true);
		doc.addEventListener("pointerdown", handlePointerDown, true);
		doc.addEventListener("keydown", handleKeyDown);
		return () => {
			view.removeEventListener("resize", handleReflow);
			doc.removeEventListener("scroll", handleReflow, true);
			doc.removeEventListener("pointerdown", handlePointerDown, true);
			doc.removeEventListener("keydown", handleKeyDown);
		};
	}, [open, place, close]);

	const registerOption = useCallback((rate: number, node: HTMLButtonElement | null) => {
		if (node) optionNodes.current.set(rate, node);
		else optionNodes.current.delete(rate);
	}, []);

	const selectRate = useCallback(
		(rate: number) => {
			close(true);
			if (rate !== value) onChange(rate);
		},
		[close, onChange, value],
	);

	const handlePopoverKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close(true);
			return;
		}
		if (event.key === "Tab") {
			// Return focus to the trigger so the browser continues tabbing from there.
			close(true);
			return;
		}
		const nodes = rates.map((rate) => optionNodes.current.get(rate));
		const activeIndex = nodes.indexOf(event.target as HTMLButtonElement);
		const next = nextPlaybackRateIndex(activeIndex, event.key, rates.length);
		if (next === null) return;
		event.preventDefault();
		event.stopPropagation();
		nodes[next]?.focus({ preventScroll: true });
	};

	return (
		<div
			ref={rootRef}
			className={cls(
				"flashcard-speed",
				tone === "dark" && "is-dark",
				open && "is-open",
				className,
			)}
		>
			<button
				ref={triggerRef}
				type="button"
				className="flashcard-speed-trigger"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={popoverId}
				aria-label={`${label} ${formatPlaybackRate(value)}`}
				title={label}
				onClick={() => (open ? close(false) : setOpen(true))}
				onKeyDown={(event) => {
					if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
					event.preventDefault();
					event.stopPropagation();
					if (!open) setOpen(true);
				}}
			>
				<span className="flashcard-speed-value">{formatPlaybackRate(value)}</span>
				<span className="flashcard-speed-chevron" aria-hidden="true">
					<ChevronDown size={12} />
				</span>
			</button>

			{open && portalHost
				? createPortal(
						<div className="fc-overlay">
							<PlaybackRatePopover
								id={popoverId}
								label={label}
								value={value}
								rates={rates}
								tone={tone}
								position={position}
								popoverRef={popoverRef}
								optionRef={registerOption}
								onSelect={selectRate}
								onKeyDown={handlePopoverKeyDown}
							/>
						</div>,
						portalHost,
					)
				: null}
		</div>
	);
}
