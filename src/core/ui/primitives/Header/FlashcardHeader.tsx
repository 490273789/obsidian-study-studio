import React from "react";
import { ArrowLeft, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FlashcardButton } from "../Button";
import { useI18n } from "../../context/I18nContext";

export interface FlashcardHeaderProps {
	/** Icon displayed next to the title (optional). */
	icon?: LucideIcon;
	/** Main header title. */
	title: React.ReactNode;
	/** Compact badge displayed after the title (optional). */
	badge?: React.ReactNode;
	/** Content rendered to the left of the title (optional). */
	left?: React.ReactNode;
	/** Content rendered to the right of the title (optional). */
	right?: React.ReactNode;
	/** When provided, renders a back button on the left that calls this handler. */
	onBack?: () => void;
	/** Accessible label for the back/close button. */
	backTitle?: string;
	/** Extra CSS class names appended to the header. */
	className?: string;
}

/**
 * Shared compact page header.
 *
 * Desktop keeps the title at the leading edge and actions at the trailing edge.
 * Mobile navigation keeps the title centered and swaps the close icon for a back arrow.
 *
 * @example
 * ```tsx
 * <FlashcardHeader icon={Brain} title="Study" onBack={onBack} />
 * ```
 */
export const FlashcardHeader: React.FC<FlashcardHeaderProps> = ({
	icon: Icon,
	title,
	badge,
	left,
	right,
	onBack,
	backTitle,
	className = "",
}) => {
	const { t } = useI18n();
	const navigationLabel = backTitle ?? t("common.back");
	const desktopBackButton = (
		<FlashcardButton
			preset="icon"
			icon={X}
			iconSize={18}
			onClick={onBack}
			title={navigationLabel}
			aria-label={navigationLabel}
		/>
	);
	const mobileBackButton = (
		<FlashcardButton
			preset="icon"
			icon={ArrowLeft}
			iconSize={20}
			onClick={onBack}
			title={navigationLabel}
			aria-label={navigationLabel}
		/>
	);
	const classes = [
		"flashcard-common-header",
		"flashcard-navigation-header",
		onBack ? "has-back" : "",
		className,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<header className={classes}>
			<div className="flashcard-header-left">
				{onBack && <span className="flashcard-header-back-mobile">{mobileBackButton}</span>}
				{left}
			</div>
			<div className="flashcard-header-center">
				{Icon && <Icon size={18} />}
				<div className="flashcard-header-title-content">{title}</div>
				{badge && <span className="flashcard-header-badge">{badge}</span>}
			</div>
			<div className="flashcard-header-right">
				{right}
				{onBack && (
					<span className="flashcard-header-back-desktop">{desktopBackButton}</span>
				)}
			</div>
		</header>
	);
};
