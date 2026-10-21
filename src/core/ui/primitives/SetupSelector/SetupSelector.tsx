import React from "react";
import type { LucideIcon } from "lucide-react";
import { FlashcardButton } from "../Button";

export interface SetupControlGroupProps {
	icon: LucideIcon;
	title: React.ReactNode;
	note: React.ReactNode;
	children: React.ReactNode;
}

export const SetupControlGroup: React.FC<SetupControlGroupProps> = ({
	icon: Icon,
	title,
	note,
	children,
}) => {
	return (
		<section className="flashcard-setup-control-group">
			<div className="flashcard-setup-control-copy">
				<span className="flashcard-setup-control-icon" aria-hidden="true">
					<Icon size={17} />
				</span>
				<div className="flashcard-setup-control-text">
					<div className="flashcard-setup-control-title">{title}</div>
					<div className="flashcard-setup-control-note">{note}</div>
				</div>
			</div>
			<div className="flashcard-setup-control-body">{children}</div>
		</section>
	);
};

export interface SetupSelectorOption<T extends string> {
	value: T;
	label: React.ReactNode;
	icon: LucideIcon;
}

interface SetupSelectorProps<T extends string> {
	value: T;
	options: SetupSelectorOption<T>[];
	ariaLabel: string;
	onChange: (value: T) => void;
}

export function SetupSelector<T extends string>({
	value,
	options,
	ariaLabel,
	onChange,
}: SetupSelectorProps<T>): React.JSX.Element {
	return (
		<fieldset className="flashcard-setup-segmented" aria-label={ariaLabel}>
			{options.map((option) => (
				<FlashcardButton
					key={option.value}
					type="button"
					icon={option.icon}
					iconSize={16}
					className="flashcard-setup-segment-btn"
					active={value === option.value}
					aria-pressed={value === option.value}
					onClick={() => onChange(option.value)}
				>
					<span className="flashcard-setup-segment-label">{option.label}</span>
				</FlashcardButton>
			))}
		</fieldset>
	);
}
