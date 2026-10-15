import React, { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Play } from "lucide-react";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header/FlashcardHeader";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button/Button";
import { handleSetupKeyDown } from "./setupShortcuts";
import styles from "./SetupPage.module.scss";

export { styles as setupStyles };

interface SetupPageProps {
	icon: LucideIcon;
	title: string;
	deck: { name: string; tag: string };
	count: number;
	countLabel: string;
	meta: React.ReactNode;
	summary: React.ReactNode;
	startLabel: string;
	disabled: boolean;
	onStart: () => void;
	onBack: () => void;
	children: React.ReactNode;
	afterAction?: React.ReactNode;
}

export function SetupPage({
	icon,
	title,
	deck,
	count,
	countLabel,
	meta,
	summary,
	startLabel,
	disabled,
	onStart,
	onBack,
	children,
	afterAction,
}: SetupPageProps): React.JSX.Element {
	const rootRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const root = rootRef.current;
		if (
			root &&
			root.ownerDocument.activeElement === root.ownerDocument.body &&
			!root.ownerDocument.querySelector(
				'dialog[open], [aria-modal="true"]:not([aria-hidden="true"]), .modal-container',
			)
		) {
			root.focus({ preventScroll: true });
		}
	}, []);
	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- This focused page owns its setup keyboard shortcut.
		<div
			ref={rootRef}
			className={`fc-page fc-page--fill ${styles.page}`}
			tabIndex={-1}
			onKeyDown={(event) => {
				if (event.defaultPrevented) return;
				handleSetupKeyDown(event.nativeEvent, event.currentTarget, onStart, disabled);
			}}
		>
			<FlashcardHeader className={styles.header} icon={icon} title={title} onBack={onBack} />
			<div className={`fc-page__body ${styles.body}`}>
				<div className={styles.column}>
					<section className={`fc-hero ${styles.hero}`}>
						<div className={styles.identity}>
							<div className={styles.deckName}>{deck.name}</div>
							{deck.tag && (
								<span className={styles.deckTag}>
									{deck.tag.startsWith("#") ? deck.tag : `#${deck.tag}`}
								</span>
							)}
							<div className={`fc-hero__summary ${styles.meta}`}>{meta}</div>
						</div>
						<div className={styles.figure}>
							<div className="fc-hero__label">{countLabel}</div>
							<div className="fc-hero__num">
								<b>{count}</b>
							</div>
						</div>
					</section>
					{children}
					<div className={`${styles.action} ${afterAction ? styles.stickyAction : ""}`}>
						<div className={styles.summary}>{summary}</div>
						<div className={styles.startGroup}>
							<FlashcardButton
								className={styles.startButton}
								size="lg"
								variant="primary"
								icon={Play}
								disabled={disabled}
								onClick={onStart}
							>
								{startLabel}
							</FlashcardButton>
							{!disabled && <kbd className={styles.shortcut}>Space</kbd>}
						</div>
					</div>
					{afterAction}
				</div>
			</div>
		</div>
	);
}
