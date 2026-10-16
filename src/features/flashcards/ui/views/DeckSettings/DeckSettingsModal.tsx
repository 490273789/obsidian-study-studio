import { memo, useId } from "react";
import { TriangleAlert, X } from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardCheckbox } from "../../../../../core/ui/primitives/Checkbox";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { ModalSurface } from "../../../../../core/ui/primitives/Modal";
import { FlashcardSelect } from "../../../../../core/ui/primitives/Select";
import { FlashcardSlider } from "../../../../../core/ui/primitives/Slider";
import type { DeckHomeSettingsChange, DeckHomeSettingsDraft } from "../../../domain/decks/deckHome";
import { calculateEstimatedDays, STUDY_SETTINGS_LIMITS } from "../../../settings/studyMeta";
import { useFlashcardI18n } from "../../../strings/context";
import { formatStudyOrder } from "../../../strings/index";
import styles from "./DeckSettingsModal.module.scss";

export interface DeckSettingsModalProps {
	draft: DeckHomeSettingsDraft;
	isSaving: boolean;
	isMigratingIdentity: boolean;
	onChange: (change: DeckHomeSettingsChange) => void;
	onSave: () => Promise<void>;
	onOpenSourceFile: () => void;
	onMigrateIdentity: () => Promise<boolean>;
	onClose: () => void;
}

export const DeckSettingsModal = memo(function DeckSettingsModal({
	draft,
	isSaving,
	isMigratingIdentity,
	onChange,
	onSave,
	onOpenSourceFile,
	onMigrateIdentity,
	onClose,
}: DeckSettingsModalProps) {
	const { t, language } = useFlashcardI18n();
	const totalCards = draft.totalCards;
	const titleId = useId();
	const subtitleId = useId();
	const spellingValidation = draft.spelling;
	const hasStableIdentities = draft.spelling.hasStableIdentities;
	const spellingBlocked =
		draft.wordLearningEnabled && (!spellingValidation.canStart || !hasStableIdentities);
	const isBusy = isMigratingIdentity || isSaving;

	const handleDailyNewCardsChange = (val: number) => {
		onChange({ field: "dailyNewCards", value: val });
	};

	const handleDaysToCompleteChange = (raw: string) => {
		onChange({ field: "daysToComplete", value: raw });
	};

	const handleSave = async () => {
		if (spellingBlocked || isBusy) return;
		await onSave();
	};

	const handleMigrateIdentity = async () => {
		if (isBusy) return;
		await onMigrateIdentity();
	};

	return (
		<ModalSurface
			className={styles.modal}
			labelledBy={titleId}
			describedBy={subtitleId}
			onRequestClose={onClose}
			isDismissible={!isBusy}
		>
			{({ requestClose, initialFocusProps }) => (
				<>
					<div className="flashcard-modal-header">
						<div className="flashcard-modal-heading">
							<span id={titleId} className="flashcard-modal-title">
								{t("deckSettings.title", {
									deckName: draft.deckName,
								})}
							</span>
							<span id={subtitleId} className="flashcard-modal-subtitle">
								{t("deckSettings.subtitle", {
									totalCards,
									mode: draft.useCustom
										? t("deckSettings.usingCustom")
										: t("deckSettings.usingGlobal"),
								})}
							</span>
						</div>
						<FlashcardButton
							preset="icon"
							variant="ghost"
							size="md"
							className="flashcard-modal-close"
							onClick={requestClose}
							disabled={isBusy}
							aria-label={t("common.close")}
							icon={X}
						/>
					</div>

					<div className="flashcard-modal-body">
						<div className={cls(styles.purpose, styles.card)}>
							<div className={styles.purposeHeading}>
								<div>
									<strong>{t("deckSettings.wordLearningTitle")}</strong>
									<p>{t("deckSettings.wordLearningDescription")}</p>
								</div>
								<FlashcardCheckbox
									checked={draft.wordLearningEnabled}
									{...initialFocusProps}
									onChange={(event) =>
										onChange({
											field: "wordLearningEnabled",
											value: event.target.checked,
										})
									}
									label={t("deckSettings.wordLearningToggle")}
								/>
							</div>

							{draft.wordLearningEnabled && !hasStableIdentities && (
								<div className={styles.warning}>
									<TriangleAlert size={16} />
									<span>{t("deckSettings.identityRequired")}</span>
									<FlashcardButton
										variant="secondary"
										onClick={() => void handleMigrateIdentity()}
										disabled={isBusy}
									>
										{isMigratingIdentity
											? t("identity.migrating")
											: t("identity.migrateNow")}
									</FlashcardButton>
								</div>
							)}

							{draft.wordLearningEnabled &&
								(!spellingValidation.canStart ||
									spellingValidation.invalidCards.length > 0) && (
									<div className={styles.warning}>
										<TriangleAlert size={16} />
										<div>
											<strong>
												{spellingValidation.canStart
													? t("deckSettings.invalidSpellingCards", {
															count: spellingValidation.invalidCards
																.length,
														})
													: t("deckSettings.noEligibleSpellingCards", {
															count: spellingValidation.invalidCards
																.length,
														})}
											</strong>
											<ul>
												{spellingValidation.invalidCards
													.slice(0, 5)
													.map((invalidCard) => (
														<li key={invalidCard.cardId}>
															{t("deckSettings.invalidSpellingCard", {
																index: invalidCard.indexInFile + 1,
																front:
																	invalidCard.front
																		.replace(/\s+/g, " ")
																		.slice(0, 40) || "—",
															})}
														</li>
													))}
											</ul>
											{spellingValidation.invalidCards.length > 5 && (
												<span>
													{t("deckSettings.invalidSpellingCardsMore", {
														count:
															spellingValidation.invalidCards.length -
															5,
													})}
												</span>
											)}
										</div>
										<FlashcardButton
											variant="secondary"
											onClick={onOpenSourceFile}
										>
											{t("home.openSourceTitle")}
										</FlashcardButton>
									</div>
								)}
						</div>

						<div className={cls(styles.toggle, styles.card)}>
							<FlashcardCheckbox
								checked={draft.useCustom}
								onChange={(e) =>
									onChange({
										field: "useCustom",
										value: e.target.checked,
									})
								}
								label={t("deckSettings.useCustom")}
							/>
							<p className={styles.toggleCopy}>{t("deckSettings.useCustomCopy")}</p>
						</div>

						{!draft.useCustom ? (
							<div className={cls(styles.hint, styles.card)}>
								{t("deckSettings.globalHint", {
									dailyNewCards: draft.global.dailyNewCards,
									dailyReviewCards: draft.global.dailyReviewCards,
									studyOrder: formatStudyOrder(language, draft.global.studyOrder),
								})}
								{totalCards > 0 && (
									<span>
										&nbsp;
										{t("deckSettings.estimatedDays", {
											days: calculateEstimatedDays(
												totalCards,
												draft.global.dailyNewCards,
											),
										})}
									</span>
								)}
							</div>
						) : (
							<div className={styles.fields}>
								<div className={cls(styles.summary, styles.card)}>
									<div>
										<span className={styles.summaryLabel}>
											{t("deckSettings.completionPace")}
										</span>
										<strong className={styles.summaryValue}>
											{t("deckSettings.days", {
												count: draft.daysToComplete,
											})}
										</strong>
									</div>
									<span className={styles.summaryLabel}>
										{t("deckSettings.dailySummary", {
											dailyNewCards: draft.dailyNewCards,
											dailyReviewCards: draft.dailyReviewCards,
										})}
									</span>
								</div>
								<div className={styles.field}>
									<label>
										<span>{t("deckSettings.dailyNewCards")}</span>
										<strong>{draft.dailyNewCards}</strong>
									</label>
									<FlashcardSlider
										min={STUDY_SETTINGS_LIMITS.dailyNewCards.min}
										max={STUDY_SETTINGS_LIMITS.dailyNewCards.max}
										step={STUDY_SETTINGS_LIMITS.dailyNewCards.step}
										value={draft.dailyNewCards}
										onChange={(e) =>
											handleDailyNewCardsChange(parseInt(e.target.value))
										}
									/>
								</div>
								{totalCards > 0 && (
									<div className={cls(styles.field, styles.fieldRow)}>
										<label>{t("deckSettings.estimatedDaysLabel")}</label>
										<div className={styles.daysInputs}>
											<FlashcardInput
												type="number"
												min={1}
												max={totalCards}
												value={draft.daysToComplete}
												onChange={(e) =>
													handleDaysToCompleteChange(e.target.value)
												}
											/>
											<span className={styles.daysUnit}>
												{t("deckSettings.daysUnit")}
											</span>
											<span className={styles.daysHint}>
												{t("deckSettings.totalCardsHint", {
													totalCards,
												})}
											</span>
										</div>
									</div>
								)}
								<div className={styles.field}>
									<label>
										<span>{t("deckSettings.dailyReviewCards")}</span>
										<strong>{draft.dailyReviewCards}</strong>
									</label>
									<FlashcardSlider
										min={STUDY_SETTINGS_LIMITS.dailyReviewCards.min}
										max={STUDY_SETTINGS_LIMITS.dailyReviewCards.max}
										step={STUDY_SETTINGS_LIMITS.dailyReviewCards.step}
										value={draft.dailyReviewCards}
										onChange={(e) =>
											onChange({
												field: "dailyReviewCards",
												value: parseInt(e.target.value),
											})
										}
									/>
								</div>
								<div className={cls(styles.field, styles.fieldRow)}>
									<label>{t("deckSettings.studyOrder")}</label>
									<FlashcardSelect
										value={draft.studyOrder}
										onChange={(e) =>
											onChange({
												field: "studyOrder",
												value: e.target.value as "sequential" | "random",
											})
										}
									>
										<option value="sequential">{t("order.sequential")}</option>
										<option value="random">{t("order.random")}</option>
									</FlashcardSelect>
								</div>
								<div className={styles.field}>
									<label>
										<span>{t("deckSettings.targetRetention")}</span>
										<strong>{draft.requestRetention.toFixed(2)}</strong>
									</label>
									<FlashcardSlider
										min={STUDY_SETTINGS_LIMITS.requestRetention.min}
										max={STUDY_SETTINGS_LIMITS.requestRetention.max}
										step={STUDY_SETTINGS_LIMITS.requestRetention.step}
										value={draft.requestRetention}
										onChange={(e) =>
											onChange({
												field: "requestRetention",
												value: parseFloat(e.target.value),
											})
										}
									/>
								</div>
								<div className={cls(styles.field, styles.fieldRow)}>
									<label>{t("deckSettings.maxReviewInterval")}</label>
									<FlashcardInput
										type="number"
										min={STUDY_SETTINGS_LIMITS.maximumInterval.min}
										max={STUDY_SETTINGS_LIMITS.maximumInterval.max}
										value={draft.maximumInterval}
										onChange={(e) =>
											onChange({
												field: "maximumInterval",
												value: e.target.value,
											})
										}
									/>
								</div>
							</div>
						)}
					</div>

					<div className="flashcard-modal-footer">
						<FlashcardButton
							variant="primary"
							onClick={() => void handleSave()}
							disabled={spellingBlocked || isBusy}
						>
							{t("common.save")}
						</FlashcardButton>
						<FlashcardButton onClick={requestClose} disabled={isBusy}>
							{t("common.cancel")}
						</FlashcardButton>
					</div>
				</>
			)}
		</ModalSurface>
	);
});
