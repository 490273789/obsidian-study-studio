import React, { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleCheck } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { Confetti } from "../../../../../core/ui/primitives/Confetti";
import { focusSessionSummary, handleSessionSummaryKeyDown } from "./sessionSummaryKeyboard";
import styles from "./SessionSummary.module.scss";

interface SummaryMetric {
	label: string;
	value: React.ReactNode;
}

interface SummaryAction {
	label: string;
	onClick: () => void;
	icon?: LucideIcon;
	primary?: boolean;
	disabled?: boolean;
}

interface SessionSummaryProps {
	mode: string;
	icon: LucideIcon;
	title: string;
	description: React.ReactNode;
	metric: SummaryMetric;
	stats: SummaryMetric[];
	actions: SummaryAction[];
	onHome: () => void;
	celebrate?: boolean;
	layout?: "stacked" | "review";
	overviewExtra?: React.ReactNode;
	children?: React.ReactNode;
}

/** Shared presentation only; each mode retains its immutable result and actions. */
export function SessionSummary({
	mode,
	icon,
	title,
	description,
	metric,
	stats,
	actions,
	onHome,
	celebrate = true,
	layout = "stacked",
	overviewExtra,
	children,
}: SessionSummaryProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (rootRef.current) focusSessionSummary(rootRef.current);
	}, []);

	const actionButtons = actions.map((action) => (
		<FlashcardButton
			key={action.label}
			variant={action.primary ? "primary" : "secondary"}
			icon={action.icon}
			onClick={action.onClick}
			disabled={action.disabled}
			title={action.primary ? `${action.label} (↵ / Space)` : action.label}
			aria-keyshortcuts={action.primary ? "Enter Space" : undefined}
		>
			{action.label}
		</FlashcardButton>
	));

	const overviewCard = (
		<section className={cls("fc-panel", styles.overview)}>
			<div className={styles.heading}>
				<CircleCheck size={22} aria-hidden="true" />
				<h1>{title}</h1>
			</div>
			<div className={styles.description}>{description}</div>
			<div className={styles.results}>
				<div className={styles.metric}>
					<strong>{metric.value}</strong>
					<span>{metric.label}</span>
				</div>
				<dl className={styles.stats}>
					{stats.map((stat) => (
						<div key={stat.label}>
							<dt>{stat.label}</dt>
							<dd>{stat.value}</dd>
						</div>
					))}
				</dl>
			</div>
			{layout === "review" && <div className={styles.inlineActions}>{actionButtons}</div>}
		</section>
	);

	return (
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- This focused page owns its result shortcuts.
		<div
			className={cls("fc-page fc-page--fill", styles.summary)}
			ref={rootRef}
			tabIndex={-1}
			onKeyDown={(event) => {
				if (event.defaultPrevented) return;
				handleSessionSummaryKeyDown(event, { actions, onHome }, event.currentTarget);
			}}
		>
			{celebrate && <Confetti />}
			<FlashcardHeader icon={icon} title={mode} onBack={onHome} />
			<div className={cls("fc-page__body", styles.scroll)}>
				<div className={cls(styles.content, layout === "review" && styles.reviewContent)}>
					{overviewCard}
					{overviewExtra}
					{children}
				</div>
			</div>
			{layout !== "review" && <footer className={styles.actions}>{actionButtons}</footer>}
		</div>
	);
}
