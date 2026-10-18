import React from "react";
import { cls } from "../../../shared/classNames";
import type { PlaybackRatePopoverPosition, PlaybackRateTone } from "./playbackRateMenu";
import { formatPlaybackRate } from "./playbackRateMenu";

export interface PlaybackRatePopoverProps {
	/** Stable id referenced by the trigger's `aria-controls`. */
	readonly id: string;
	/** Visible control label, also used as the popover's accessible name. */
	readonly label: string;
	readonly value: number;
	readonly rates: readonly number[];
	readonly tone: PlaybackRateTone;
	/** `null` until the control has measured the trigger and popover. */
	readonly position: PlaybackRatePopoverPosition | null;
	readonly popoverRef: React.Ref<HTMLDivElement>;
	readonly optionRef: (rate: number, node: HTMLButtonElement | null) => void;
	readonly onSelect: (rate: number) => void;
	readonly onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Presentational speed menu. The control owns focus, positioning and dismissal;
 * this component only renders the measured menu surface.
 */
export function PlaybackRatePopover({
	id,
	label,
	value,
	rates,
	tone,
	position,
	popoverRef,
	optionRef,
	onSelect,
	onKeyDown,
}: PlaybackRatePopoverProps): React.ReactNode {
	// Five or fewer rates fit on one row; longer lists stay compact at four columns.
	const columns = rates.length <= 5 ? rates.length : 4;
	const gridStyle = { "--speed-columns": columns } as React.CSSProperties;

	return (
		<div
			ref={popoverRef}
			id={id}
			className={cls(
				"flashcard-speed-popover",
				tone === "dark" && "is-dark",
				position?.placement === "top" && "is-top",
				position?.placement === "bottom" && "is-bottom",
			)}
			role="menu"
			aria-label={label}
			tabIndex={-1}
			data-positioned={position ? "true" : undefined}
			style={position ? { top: position.top, left: position.left } : undefined}
			onKeyDown={onKeyDown}
		>
			<div className="flashcard-speed-grid" style={gridStyle}>
				{rates.map((rate) => {
					const active = rate === value;
					return (
						<button
							key={rate}
							ref={(node) => optionRef(rate, node)}
							type="button"
							role="menuitemradio"
							aria-checked={active}
							tabIndex={-1}
							className={cls("flashcard-speed-option", active && "is-active")}
							onClick={() => onSelect(rate)}
						>
							{formatPlaybackRate(rate)}
						</button>
					);
				})}
			</div>
		</div>
	);
}
