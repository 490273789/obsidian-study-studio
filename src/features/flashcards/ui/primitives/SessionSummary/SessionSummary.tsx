import React, { useEffect } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleCheck } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardHeader } from "../../../../../core/ui/primitives/Header";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { Confetti } from "../../../../../core/ui/primitives/Confetti";
import { handleSessionSummaryKeyDown } from "./sessionSummaryKeyboard";
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
	layout?: "stacked" | "split";
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
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			handleSessionSummaryKeyDown(e, { actions, onHome });
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [actions, onHome]);

	const overviewCard = (
		<section className={cls("fc-panel", styles.overview)}>
			<div className={styles.heading}>
				<CircleCheck size={22} aria-hidden="true" />
				<h1>{title}</h1>
			</div>
			<div className={styles.description}>{description}</div>
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
		</section>
	);

	return (
		<div className={cls("fc-page fc-page--fill", styles.summary)}>
			{celebrate && <Confetti />}
			<FlashcardHeader icon={icon} title={mode} onBack={onHome} />
			<div className={cls("fc-page__body", styles.scroll)}>
				{layout === "split" ? (
					<div className={cls(styles.content, styles.splitContent)}>
						<div className={styles.primaryColumn}>
							{overviewCard}
							{overviewExtra}
						</div>
						<div className={styles.secondaryColumn}>{children}</div>
					</div>
				) : (
					<div className={styles.content}>
						{overviewCard}
						{overviewExtra}
						{children}
					</div>
				)}
			</div>
			<footer className={styles.actions}>
				{actions.map((action) => (
					<FlashcardButton
						key={action.label}
						variant={action.primary ? "primary" : "secondary"}
						icon={action.icon}
						onClick={action.onClick}
						title={action.primary ? `${action.label} (↵ / Space)` : action.label}
						aria-keyshortcuts={action.primary ? "Enter Space" : undefined}
					>
						{action.label}
					</FlashcardButton>
				))}
			</footer>
		</div>
	);
}
