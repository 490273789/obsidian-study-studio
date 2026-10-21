import React from "react";
import { Pencil, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardMenu, type FlashcardMenuItem } from "../../../../../core/ui/primitives/Menu";
import { SessionTimer } from "../../../../../core/ui/primitives/SessionTimer";
import { useFlashcardI18n } from "../../../strings/context";

interface SessionToolbarProps {
	mode: string;
	deckName: string;
	progress: string;
	progressPercent: number;
	startTime: number;
	busy?: boolean;
	metrics?: React.ReactNode;
	onEdit?: () => void;
	onDelete?: () => void;
	onClose: () => void;
	editTitle?: string;
	deleteTitle?: string;
	closeTitle: string;
	autoPronunciation?: {
		enabled: boolean;
		onToggle: () => void;
		enableTitle: string;
		disableTitle: string;
	};
}

export function SessionToolbar({
	mode,
	deckName,
	progress,
	progressPercent,
	startTime,
	busy = false,
	onEdit,
	onDelete,
	onClose,
	editTitle,
	deleteTitle,
	closeTitle,
	autoPronunciation,
}: SessionToolbarProps) {
	const { t } = useFlashcardI18n();
	const normalizedProgress = Number.isFinite(progressPercent)
		? Math.min(Math.max(progressPercent, 0), 100)
		: 0;
	const autoTitle = autoPronunciation?.enabled
		? autoPronunciation.disableTitle
		: autoPronunciation?.enableTitle;
	const items: FlashcardMenuItem[] = [];
	if (onEdit)
		items.push({
			key: "edit",
			label: editTitle,
			icon: Pencil,
			onSelect: onEdit,
			disabled: busy,
		});
	if (onDelete)
		items.push({
			key: "delete",
			label: deleteTitle,
			icon: Trash2,
			onSelect: onDelete,
			danger: true,
			disabled: busy,
		});
	return (
		<div className="flashcard-session-shell">
			<header className="flashcard-session-header">
				<FlashcardButton
					preset="icon"
					icon={X}
					onClick={onClose}
					disabled={busy}
					className="flashcard-session-close"
					title={closeTitle}
					aria-label={closeTitle}
				/>
				<div className="flashcard-session-identity">
					<span className="flashcard-session-mode">{mode}</span>
					<span className="flashcard-deck-title" title={deckName}>
						{deckName}
					</span>
				</div>
				<div className="flashcard-session-header-tools">
					<div className="flashcard-session-progress">
						<span className="flashcard-session-progress-text">{progress}</span>
						<progress
							className="flashcard-session-progress-track"
							aria-label={t("study.progress")}
							aria-valuetext={progress}
							max={100}
							value={normalizedProgress}
						/>
					</div>
					<SessionTimer startTime={startTime} className="flashcard-session-timer" />
					{(autoPronunciation || items.length > 0) && (
						<div className="flashcard-session-actions">
							{autoPronunciation && (
								<FlashcardButton
									preset="icon"
									icon={autoPronunciation.enabled ? Volume2 : VolumeX}
									onClick={autoPronunciation.onToggle}
									disabled={busy}
									className="flashcard-session-auto-pronunciation"
									title={autoTitle}
									aria-label={autoTitle}
									aria-pressed={autoPronunciation.enabled}
									active={autoPronunciation.enabled}
								/>
							)}
							{items.length > 0 && (
								<FlashcardMenu
									items={items}
									triggerTitle={t("cardEditor.showActions")}
									ariaLabel={t("cardEditor.showActions")}
									triggerClassName="flashcard-session-actions-toggle"
									menuClassName="flashcard-session-actions-menu"
									align="end"
								/>
							)}
						</div>
					)}
				</div>
			</header>
		</div>
	);
}
