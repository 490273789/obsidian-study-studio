import React from "react";
import type { LucideIcon } from "lucide-react";
import "./StatCards.scss";

export type StatCardTone = "blue" | "green" | "orange" | "purple" | "red";

export interface StatCardItem {
	key: string;
	value: React.ReactNode;
	label: React.ReactNode;
	tone?: StatCardTone;
	icon?: LucideIcon;
}

export interface StatCardsProps {
	items: StatCardItem[];
	className?: string;
	columns?: number;
}

/**
 * Modern stat card collection component.
 * Renders high-quality stat cards with subtle gradients, theme-tinted icon badges,
 * and single-line center-aligned values and labels.
 */
export const StatCards: React.FC<StatCardsProps> = ({ items, className = "", columns }) => {
	if (!items || items.length === 0) return null;

	const colClass = `columns-${columns ?? items.length}`;

	return (
		<div className={`flashcard-stat-cards-container ${className}`}>
			<ul className={`flashcard-stat-cards ${colClass}`}>
				{items.map(({ key, value, label, tone = "purple", icon: StatIcon }) => (
					<li className={`flashcard-stat-card tone-${tone}`} key={key}>
						{StatIcon && (
							<div className={`flashcard-stat-card-icon tone-${tone}`}>
								<StatIcon size={16} />
							</div>
						)}
						<div className="flashcard-stat-card-content">
							<span className={`flashcard-stat-card-value tone-${tone}`}>
								{value}
							</span>
							<span className="flashcard-stat-card-label">{label}</span>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
};
