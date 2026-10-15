import React from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Visual variant for the button.
 * Maps directly to CSS classes: `flashcard-btn-{variant}`
 */
export type ButtonVariant = "primary" | "secondary" | "neutral" | "outline" | "ghost" | "danger";

export type ButtonSize = "sm" | "md" | "lg";

/**
 * Special button presets that override the default shape / behavior.
 * - `"icon"`       — compact square icon-only button
 * - `"show"`       — full-width "Show Answer" button
 * - `"prev"`       — undo / previous-card button (square)
 * - `"rating"`     — FSRS rating button (used inside rating grid)
 * - `"practice-wrong"`  — practice wrong-answer button
 * - `"practice-correct"` — practice correct-answer button
 */
export type ButtonPreset =
	| "icon"
	| "show"
	| "prev"
	| "rating"
	| "practice-wrong"
	| "practice-correct";

/** CSS class applied per preset. Presets shape the button; variants color it. */
const PRESET_CLASSES: Record<ButtonPreset, string> = {
	icon: "flashcard-btn-icon",
	show: "flashcard-btn-show",
	prev: "flashcard-btn-prev",
	rating: "flashcard-rating-btn",
	"practice-wrong": "flashcard-practice-btn-wrong",
	"practice-correct": "flashcard-practice-btn-correct",
};

/** Default icon size in pixels when not explicitly provided. */
const DEFAULT_ICON_SIZE = 16;

export interface FlashcardButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	/** Visual hierarchy. Defaults to neutral, or ghost for icon/previous controls. */
	variant?: ButtonVariant;
	/** Control size. Defaults to the shared medium size; views may override the height token. */
	size?: ButtonSize;
	/** Special shape / behavior preset. Class generation combines preset and variant. */
	preset?: ButtonPreset;
	/** FSRS rating (1-5). Adds `flashcard-rating-{n}`; normally combined with preset="rating". */
	rating?: 1 | 2 | 3 | 4 | 5;
	/** Optional Lucide icon element rendered before children. */
	icon?: LucideIcon;
	/** Icon size in pixels. Defaults to 16 when not set. */
	iconSize?: number;
	/** Extra CSS class names appended after the generated ones. */
	className?: string;
	/** Extra CSS class names applied to the icon element. */
	iconClassName?: string;
	/** Active state — appends `active` class (useful for toggle buttons). */
	active?: boolean;
}

/**
 * Unified flashcard button.
 *
 * `preset` shapes the button, `variant` colors it, and the two compose:
 * `preset="show" variant="primary"` renders `flashcard-btn-show flashcard-btn-primary`.
 *
 * The rendered element defaults to `type="button"` and marks its icon as
 * decorative (`aria-hidden`), so callers only need to provide an accessible
 * name when the button has no visible text.
 *
 * Usage examples:
 * ```tsx
 * <FlashcardButton variant="primary" onClick={handleSave}>Save</FlashcardButton>
 * <FlashcardButton preset="icon" icon={X} onClick={onClose} title="Close" />
 * <FlashcardButton variant="secondary" icon={Target} active={isActive}>Practice</FlashcardButton>
 * ```
 */
export const FlashcardButton = React.forwardRef<HTMLButtonElement, FlashcardButtonProps>(
	function FlashcardButton(
		{
			variant,
			size = "md",
			preset,
			rating,
			icon: Icon,
			iconSize,
			className: extraClassName = "",
			iconClassName,
			active = false,
			children,
			...rest
		},
		ref,
	) {
		const resolvedVariant =
			variant ?? (preset === "icon" || preset === "prev" ? "ghost" : "neutral");
		const classes: string[] = [
			"flashcard-btn",
			`flashcard-btn-${size}`,
			`flashcard-btn-${resolvedVariant}`,
		];

		if (preset) {
			classes.push(PRESET_CLASSES[preset]);
		}
		if (rating !== undefined) {
			classes.push(`flashcard-rating-${rating}`);
		}
		if (active) {
			classes.push("active");
		}
		if (extraClassName) {
			classes.push(extraClassName);
		}

		// Resolve icon size: use explicit iconSize if provided, otherwise default to 16px
		const resolvedIconSize = iconSize ?? DEFAULT_ICON_SIZE;

		return (
			// `type="button"` is the safe default; callers may override via `type`.
			<button ref={ref} type="button" className={classes.join(" ")} {...rest}>
				{Icon && (
					<Icon
						size={resolvedIconSize}
						className={iconClassName}
						style={{
							width: resolvedIconSize,
							height: resolvedIconSize,
							minWidth: resolvedIconSize,
							minHeight: resolvedIconSize,
							flexShrink: 0,
						}}
						aria-hidden="true"
					/>
				)}
				{children}
			</button>
		);
	},
);
