import React, { memo, useId, useState } from "react";
import { Flag, Target } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { ModalSurface } from "../../../../../core/ui/primitives/Modal";
import type { ChallengeMode } from "../../../domain/sessions/challengeSessionEngine";
import { useFlashcardI18n } from "../../../strings/context";
import styles from "./Challenge.module.scss";

const MODES: readonly ChallengeMode[] = ["normal", "reversed", "spelling", "random"];

export interface ChallengeReadiness {
	readonly eligibleCount: number;
	readonly lastMode: ChallengeMode;
	readonly round: {
		readonly id: string;
		readonly mode: ChallengeMode;
		readonly completedLevelCount: number;
		readonly totalLevels: number;
		readonly completedCardCount: number;
		readonly totalCards: number;
	} | null;
}

interface ChallengeSetupModalProps {
	readiness: ChallengeReadiness;
	isStarting: boolean;
	onStart: (mode: ChallengeMode, intent: "new" | "continue") => void;
	onClose: () => void;
}

export const ChallengeSetupModal = memo(function ChallengeSetupModal({
	readiness,
	isStarting,
	onStart,
	onClose,
}: ChallengeSetupModalProps) {
	const { t } = useFlashcardI18n();
	const [mode, setMode] = useState<ChallengeMode>(readiness.lastMode);
	const titleId = useId();
	const descriptionId = useId();
	const canStart = readiness.eligibleCount > 0 && !isStarting;
	const hasResumableChallenge = readiness.round !== null;

	return (
		<ModalSurface
			className={styles.setupModal}
			labelledBy={titleId}
			describedBy={descriptionId}
			onRequestClose={onClose}
			isDismissible={!isStarting}
		>
			{({ requestClose, initialFocusProps }) => (
				<>
					<div className="flashcard-modal-header">
						<div className="flashcard-modal-heading">
							<div className="flashcard-modal-kicker fc-kicker">
								<Flag size={14} /> {t("challenge.kicker")}
							</div>
							<span id={titleId} className="flashcard-modal-title">
								{t("challenge.title")}
							</span>
							<span id={descriptionId} className="flashcard-modal-subtitle">
								{readiness.eligibleCount > 0
									? t("challenge.available", { count: readiness.eligibleCount })
									: t("challenge.noEligible")}
							</span>
						</div>
						<button
							type="button"
							className="flashcard-modal-close"
							onClick={requestClose}
							disabled={isStarting}
							aria-label={t("common.close")}
						>
							✕
						</button>
					</div>
					<div className={cls("flashcard-modal-body", styles.setupBody)}>
						{readiness.eligibleCount === 0 ? (
							<div className={styles.emptyState}>
								<Target size={28} />
								<p>{t("challenge.noEligibleNote")}</p>
							</div>
						) : (
							<>
								<p className={styles.eligibleNote}>{t("challenge.eligibleNote")}</p>
								<fieldset className={styles.modeGroup} disabled={isStarting}>
									<legend>{t("challenge.mode")}</legend>
									<div className={styles.modeGrid}>
										{MODES.map((candidate) => (
											<label
												key={candidate}
												className={cls(
													styles.modeOption,
													mode === candidate && styles.selected,
												)}
											>
												<input
													type="radio"
													name="challenge-mode"
													checked={mode === candidate}
													onChange={() => setMode(candidate)}
													{...(candidate === readiness.lastMode
														? initialFocusProps
														: {})}
												/>
												<span>
													<strong>{t(MODE_LABELS[candidate])}</strong>
													<small>{t(MODE_NOTES[candidate])}</small>
												</span>
											</label>
										))}
									</div>
								</fieldset>
								{hasResumableChallenge && (
									<div className={styles.resumeNote}>
										<strong>{t("challenge.savedProgress")}</strong>
										<span>{t("challenge.savedProgressNote")}</span>
										<span>
											{t("challenge.level", {
												current:
													(readiness.round?.completedLevelCount ?? 0) + 1,
											})}{" "}
											·{" "}
											{t("challenge.roundProgress", {
												passed: readiness.round?.completedCardCount ?? 0,
												total: readiness.round?.totalCards ?? 0,
											})}
										</span>
									</div>
								)}
							</>
						)}
					</div>
					<div className="flashcard-modal-footer">
						<FlashcardButton
							variant="ghost"
							onClick={requestClose}
							disabled={isStarting}
						>
							{t("common.cancel")}
						</FlashcardButton>
						{hasResumableChallenge && mode === readiness.round?.mode && (
							<FlashcardButton
								variant="secondary"
								onClick={() => onStart(mode, "continue")}
								disabled={!canStart}
							>
								{t("challenge.continue")}
							</FlashcardButton>
						)}
						<FlashcardButton
							variant="primary"
							onClick={() => onStart(mode, "new")}
							disabled={!canStart}
						>
							{hasResumableChallenge
								? t(
										mode === readiness.round?.mode
											? "challenge.restart"
											: "challenge.newChallenge",
									)
								: t("challenge.start")}
						</FlashcardButton>
					</div>
				</>
			)}
		</ModalSurface>
	);
});

const MODE_LABELS: Record<
	ChallengeMode,
	| "challenge.modeNormal"
	| "challenge.modeReversed"
	| "challenge.modeSpelling"
	| "challenge.modeRandom"
> = {
	normal: "challenge.modeNormal",
	reversed: "challenge.modeReversed",
	spelling: "challenge.modeSpelling",
	random: "challenge.modeRandom",
};

const MODE_NOTES: Record<
	ChallengeMode,
	| "challenge.modeNormalNote"
	| "challenge.modeReversedNote"
	| "challenge.modeSpellingNote"
	| "challenge.modeRandomNote"
> = {
	normal: "challenge.modeNormalNote",
	reversed: "challenge.modeReversedNote",
	spelling: "challenge.modeSpellingNote",
	random: "challenge.modeRandomNote",
};
