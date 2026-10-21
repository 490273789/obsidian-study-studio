import { memo, useId, useState } from "react";
import { Target, X } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { ModalSurface } from "../../../../../core/ui/primitives/Modal";
import type { ChallengeMode } from "../../../domain/sessions/challengeSessionEngine";
import type { ChallengeReadiness } from "../../../domain/decks/deckHome";
import { useFlashcardI18n } from "../../../strings/context";
import styles from "./ChallengeSetup.module.scss";

const MODE_COPY: Record<
	ChallengeMode,
	{
		label:
			| "challenge.modeNormal"
			| "challenge.modeReversed"
			| "challenge.modeSpelling"
			| "challenge.modeRandom";
		note:
			| "challenge.modeNormalNote"
			| "challenge.modeReversedNote"
			| "challenge.modeSpellingNote"
			| "challenge.modeRandomNote";
	}
> = {
	normal: { label: "challenge.modeNormal", note: "challenge.modeNormalNote" },
	reversed: { label: "challenge.modeReversed", note: "challenge.modeReversedNote" },
	spelling: { label: "challenge.modeSpelling", note: "challenge.modeSpellingNote" },
	random: { label: "challenge.modeRandom", note: "challenge.modeRandomNote" },
};

const MODES = Object.keys(MODE_COPY) as readonly ChallengeMode[];

type ChallengeSetupReadiness = Omit<ChallengeReadiness, "savedRoundId">;

interface ChallengeSetupModalProps {
	readiness: ChallengeSetupReadiness;
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
	const canResume = hasResumableChallenge && mode === readiness.round?.mode;

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
							<span id={titleId} className="flashcard-modal-title">
								{t("challenge.title")}
							</span>
							<span id={descriptionId} className="flashcard-modal-subtitle">
								{readiness.eligibleCount > 0
									? t("challenge.available", { count: readiness.eligibleCount })
									: t("challenge.noEligible")}
							</span>
						</div>
						<FlashcardButton
							preset="icon"
							variant="ghost"
							size="md"
							className="flashcard-modal-close"
							onClick={requestClose}
							disabled={isStarting}
							aria-label={t("common.close")}
							icon={X}
						/>
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
													<strong>{t(MODE_COPY[candidate].label)}</strong>
													<small>{t(MODE_COPY[candidate].note)}</small>
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

						<FlashcardButton
							variant={canResume ? "secondary" : "primary"}
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
						{canResume && (
							<FlashcardButton
								variant="primary"
								onClick={() => onStart(mode, "continue")}
								disabled={!canStart}
							>
								{t("challenge.continue")}
							</FlashcardButton>
						)}
					</div>
				</>
			)}
		</ModalSurface>
	);
});
