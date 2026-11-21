import React, { useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
	ArrowRight,
	ArrowRightLeft,
	BrainCircuit,
	Keyboard,
	Layers,
	ListOrdered,
	Repeat2,
	Shuffle,
	SlidersHorizontal,
	Target,
} from "lucide-react";
import { cls } from "../../../../../core/shared/classNames";
import type { CardDirection, Deck } from "../../../../../core/shared/types";
import type { DeckSpellingSnapshot } from "../../../domain/decks/deckHome";
import type { SessionStartRequest } from "../../../domain/sessions/sessionLifecycle";
import type { PracticeSetupPlan, SpellingSetupPlan } from "../../../domain/sessions/sessionPlanner";
import {
	type PracticeKind,
	type PracticePreferenceStore,
	type PracticeQuickCountOption,
	PracticeSetupSession,
} from "../../../domain/sessions/practiceSetupSession";
import { FlashcardButton } from "../../../../../core/ui/primitives/Button";
import { FlashcardInput } from "../../../../../core/ui/primitives/Input";
import { useFlashcardI18n } from "../../../strings/context";
import { SetupControlGroup, SetupSelector } from "../../../../../core/ui/primitives/SetupSelector";
import { SetupPage, setupStyles as styles } from "../../primitives/SetupPage/SetupPage";
import practiceStyles from "./PracticeSetup.module.scss";

const STORAGE_KEY_PREFIX = "study-studio:practice-kind:";

const browserPracticePreferenceStore: PracticePreferenceStore = {
	getPreference(deckId: string): PracticeKind | null {
		try {
			if (typeof window !== "undefined" && window.localStorage) {
				const saved = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${deckId}`);
				if (saved === "spelling" || saved === "flip") return saved;
			}
		} catch {
			// safe fallback
		}
		return null;
	},
	setPreference(deckId: string, kind: PracticeKind): void {
		try {
			if (typeof window !== "undefined" && window.localStorage) {
				window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${deckId}`, kind);
			}
		} catch {
			// safe fallback
		}
	},
};

interface PracticeSetupProps {
	deck: Deck;
	plan: PracticeSetupPlan;
	spellingPlan?: SpellingSetupPlan | null;
	spellingSnapshot?: DeckSpellingSnapshot;
	defaultDirection?: CardDirection;
	initialDirection?: CardDirection;
	initialKind?: PracticeKind;
	preferenceStore?: PracticePreferenceStore;
	onStartSession: (request: SessionStartRequest) => void;
	onBack: () => void;
}

export const PracticeSetup = React.memo(function PracticeSetup(props: PracticeSetupProps) {
	const {
		deck,
		plan,
		spellingPlan,
		spellingSnapshot,
		defaultDirection,
		initialDirection,
		initialKind,
		preferenceStore,
		onStartSession,
		onBack,
	} = props;
	const { t } = useFlashcardI18n();

	const [session] = useState(
		() =>
			new PracticeSetupSession({
				deck,
				plan,
				spellingPlan,
				spellingSnapshot,
				defaultDirection,
				initialDirection,
				initialKind,
				preferenceStore: preferenceStore ?? browserPracticePreferenceStore,
			}),
	);
	const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
	useLayoutEffect(() => {
		session.updateSource({ deck, plan, spellingPlan, spellingSnapshot });
	}, [session, deck, plan, spellingPlan, spellingSnapshot]);

	const {
		practiceKind,
		showModeSelector,
		spellingEligible,
		selectionMode,
		maxCount,
		allCountMinutes,
		quickCounts,
		count,
		countInput,
		countMinutes,
		showCustomEstimate,
		rangeStart,
		rangeEnd,
		rangeStartInput,
		rangeEndInput,
		rangeCount,
		rangeMinutes,
		activeCount,
		activeMinutes,
		isStartDisabled,
		direction,
		spellingStats,
	} = snapshot;
	const isSpelling = practiceKind === "spelling";

	const spellingUnavailableReason =
		snapshot.spellingUnavailableReason?.kind === "disabled"
			? t("practice.spellingUnavailable")
			: snapshot.spellingUnavailableReason?.kind === "not-ready"
				? t("home.spellingUnavailableTitle", {
						count: snapshot.spellingUnavailableReason.issueCount,
					})
				: undefined;

	const handleStart = () => {
		const request = session.start();
		if (request) onStartSession(request);
	};

	return (
		<SetupPage
			icon={isSpelling ? Keyboard : Target}
			title={isSpelling ? t("spelling.title") : t("practice.title")}
			deck={deck}
			count={activeCount}
			countLabel={isSpelling ? t("setup.words") : t("setup.questions")}
			meta={
				isSpelling ? (
					<>
						<span>{t("setup.totalWords", { count: spellingStats.total })}</span>
						<span>
							{t("setup.unpracticedWords", { count: spellingStats.unpracticed })}
						</span>
						{activeMinutes > 0 && (
							<span>{t("practice.estimatedTime", { minutes: activeMinutes })}</span>
						)}
					</>
				) : (
					<>
						<span>{t("setup.availableCards", { count: maxCount })}</span>
						{activeMinutes > 0 && (
							<span>{t("practice.estimatedTime", { minutes: activeMinutes })}</span>
						)}
					</>
				)
			}
			summary={
				isSpelling ? (
					<>
						{t(
							selectionMode === "smart"
								? "spelling.smartSelection"
								: "spelling.rangeSelection",
						)}
						{selectionMode === "range" && (
							<>
								{" "}
								· {rangeStart}–{rangeEnd}
							</>
						)}
						{activeMinutes > 0 && (
							<> · {t("practice.estimatedTime", { minutes: activeMinutes })}</>
						)}
					</>
				) : (
					<>
						{t(
							selectionMode === "range"
								? "practice.modeRange"
								: "practice.modeRandomCount",
						)}{" "}
						·{" "}
						{direction === "normal"
							? t("practice.directionNormal")
							: t("practice.directionReversed")}
						{selectionMode === "range" && (
							<>
								{" "}
								· {rangeStart}–{rangeEnd}
							</>
						)}
						{activeMinutes > 0 && (
							<> · {t("practice.estimatedTime", { minutes: activeMinutes })}</>
						)}
					</>
				)
			}
			startLabel={
				isSpelling
					? t("spelling.start", { count: activeCount })
					: t("practice.startQuestions", { count: activeCount })
			}
			disabled={isStartDisabled}
			onStart={handleStart}
			onBack={onBack}
		>
			<div className={cls("fc-panel", styles.setupPanel)}>
				{showModeSelector && (
					<SetupControlGroup
						icon={Layers}
						title={t("practice.type")}
						note={
							isSpelling ? t("practice.typeSpellingNote") : t("practice.typeCardNote")
						}
					>
						<SetupSelector
							value={practiceKind}
							ariaLabel={t("practice.type")}
							options={[
								{
									value: "flip",
									label: t("practice.typeCard"),
									icon: Layers,
								},
								{
									value: "spelling",
									label: t("practice.typeSpelling"),
									icon: Keyboard,
									disabled: !spellingEligible,
									title: !spellingEligible
										? (spellingUnavailableReason ??
											t("practice.spellingUnavailable"))
										: undefined,
								},
							]}
							onChange={(kind) => session.act({ type: "set-kind", kind })}
						/>
					</SetupControlGroup>
				)}

				{isSpelling ? (
					<SetupControlGroup
						icon={SlidersHorizontal}
						title={t("spelling.chooseWords")}
						note={t(
							selectionMode === "smart"
								? "spelling.chooseWordsNote"
								: "spelling.rangeSelectionNote",
						)}
					>
						<SetupSelector
							value={selectionMode === "range" ? "range" : "smart"}
							ariaLabel={t("spelling.chooseWords")}
							options={[
								{
									value: "smart",
									label: t("spelling.smartSelection"),
									icon: BrainCircuit,
								},
								{
									value: "range",
									label: t("spelling.rangeSelection"),
									icon: ListOrdered,
								},
							]}
							onChange={(mode) => session.act({ type: "set-selection-mode", mode })}
						/>

						<div className={styles.controlDetail}>
							{selectionMode === "smart"
								? renderCountFields(t, {
										count,
										countInput,
										countMinutes,
										showCustomEstimate,
										quickCounts,
										maxCount,
										allCountMinutes,
										customLabel: t("spelling.customCount"),
										onPickCount: (nextCount) =>
											session.act({ type: "pick-count", count: nextCount }),
										onChangeCount: (value) =>
											session.act({ type: "edit-count", value }),
										onCommitCount: () => session.act({ type: "commit-count" }),
									})
								: renderRangeFields(t, {
										startInput: rangeStartInput,
										endInput: rangeEndInput,
										count: rangeCount,
										minutes: rangeMinutes,
										onChangeStart: (value) =>
											session.act({ type: "edit-range-start", value }),
										onChangeEnd: (value) =>
											session.act({ type: "edit-range-end", value }),
										onCommitRange: () => session.act({ type: "commit-range" }),
									})}
						</div>
					</SetupControlGroup>
				) : (
					<>
						<SetupControlGroup
							icon={SlidersHorizontal}
							title={t("practice.chooseCount")}
							note={
								selectionMode === "range"
									? t("practice.rangeSelectedSummary", { count: rangeCount })
									: t("practice.chooseCountNote")
							}
						>
							<SetupSelector
								value={selectionMode === "range" ? "range" : "random"}
								ariaLabel={t("practice.chooseCount")}
								options={[
									{
										value: "random",
										label: t("practice.modeRandomCount"),
										icon: Shuffle,
									},
									{
										value: "range",
										label: t("practice.modeRange"),
										icon: ListOrdered,
									},
								]}
								onChange={(mode) =>
									session.act({ type: "set-selection-mode", mode })
								}
							/>

							<div className={styles.controlDetail}>
								{selectionMode === "random"
									? renderCountFields(t, {
											count,
											countInput,
											countMinutes,
											showCustomEstimate,
											quickCounts,
											maxCount,
											allCountMinutes,
											customLabel: t("practice.customCount"),
											onPickCount: (nextCount) =>
												session.act({
													type: "pick-count",
													count: nextCount,
												}),
											onChangeCount: (value) =>
												session.act({ type: "edit-count", value }),
											onCommitCount: () =>
												session.act({ type: "commit-count" }),
										})
									: renderRangeFields(t, {
											startInput: rangeStartInput,
											endInput: rangeEndInput,
											count: rangeCount,
											minutes: rangeMinutes,
											onChangeStart: (value) =>
												session.act({ type: "edit-range-start", value }),
											onChangeEnd: (value) =>
												session.act({ type: "edit-range-end", value }),
											onCommitRange: () =>
												session.act({ type: "commit-range" }),
										})}
							</div>
						</SetupControlGroup>

						<SetupControlGroup
							icon={ArrowRightLeft}
							title={t("mode.direction")}
							note={
								direction === "normal"
									? t("practice.directionNormalNote")
									: t("practice.directionReversedNote")
							}
						>
							<SetupSelector
								value={direction}
								ariaLabel={t("mode.direction")}
								options={[
									{
										value: "normal",
										label: t("practice.directionNormal"),
										icon: ArrowRight,
									},
									{
										value: "reversed",
										label: t("practice.directionReversed"),
										icon: Repeat2,
									},
								]}
								onChange={(dir) =>
									session.act({ type: "set-direction", direction: dir })
								}
							/>

							<div className={practiceStyles.directionFlowCard}>
								<div className={practiceStyles.flowStep}>
									<span className={practiceStyles.flowBadge}>
										{t("practice.flowPrompt")}
									</span>
									<span className={practiceStyles.flowText}>
										{direction === "normal"
											? t("practice.flowFrontPrompt")
											: t("practice.flowBackPrompt")}
									</span>
								</div>
								<div className={practiceStyles.flowArrow} aria-hidden="true">
									<ArrowRight size={14} />
								</div>
								<div className={practiceStyles.flowStep}>
									<span className={practiceStyles.flowBadgeAnswer}>
										{t("practice.flowAnswer")}
									</span>
									<span className={practiceStyles.flowText}>
										{direction === "normal"
											? t("practice.flowBackAnswer")
											: t("practice.flowFrontAnswer")}
									</span>
								</div>
							</div>
						</SetupControlGroup>
					</>
				)}
			</div>
		</SetupPage>
	);
});

interface CountFieldsProps {
	count: number;
	countInput: string;
	countMinutes: number;
	showCustomEstimate: boolean;
	quickCounts: readonly PracticeQuickCountOption[];
	maxCount: number;
	allCountMinutes: number;
	customLabel: string;
	onPickCount: (count: number) => void;
	onChangeCount: (value: string) => void;
	onCommitCount: () => void;
}

type Translate = ReturnType<typeof useFlashcardI18n>["t"];

function renderCountFields(
	t: Translate,
	{
		count,
		countInput,
		countMinutes,
		showCustomEstimate,
		quickCounts,
		maxCount,
		allCountMinutes,
		customLabel,
		onPickCount,
		onChangeCount,
		onCommitCount,
	}: CountFieldsProps,
): React.JSX.Element {
	const chipClass = cls(styles.chip, practiceStyles.chipWithTime);

	return (
		<>
			<div className={styles.quickButtons}>
				{quickCounts.map(({ count: preset, minutes }) => (
					<FlashcardButton
						key={preset}
						type="button"
						className={chipClass}
						active={count === preset}
						aria-pressed={count === preset}
						aria-label={t("practice.chipAria", { count: preset, minutes })}
						onClick={() => onPickCount(preset)}
					>
						<span>{preset}</span>
						<span className={practiceStyles.chipSub}>~{minutes}m</span>
					</FlashcardButton>
				))}
				<FlashcardButton
					type="button"
					className={chipClass}
					active={count === maxCount}
					aria-pressed={count === maxCount}
					aria-label={t("practice.allCardsAria", {
						count: maxCount,
						minutes: allCountMinutes,
					})}
					onClick={() => onPickCount(maxCount)}
				>
					<span>{t("common.all")}</span>
					<span className={practiceStyles.chipSub}>({maxCount})</span>
				</FlashcardButton>
			</div>
			<div className={practiceStyles.customInputRow}>
				<label className={styles.customField}>
					<span className={styles.inputLabel}>{customLabel}</span>
					<FlashcardInput
						type="number"
						className={styles.input}
						value={countInput}
						onChange={(event) => onChangeCount(event.target.value)}
						onBlur={onCommitCount}
						min={1}
						max={maxCount}
					/>
					<span className={styles.inputHint}>1–{maxCount}</span>
				</label>
				{showCustomEstimate && (
					<span className={practiceStyles.customEstimate}>
						{t("practice.estimatedTime", { minutes: countMinutes })}
					</span>
				)}
			</div>
		</>
	);
}

interface RangeFieldsProps {
	startInput: string;
	endInput: string;
	count: number;
	minutes: number;
	onChangeStart: (value: string) => void;
	onChangeEnd: (value: string) => void;
	onCommitRange: () => void;
}

function renderRangeFields(
	t: Translate,
	{
		startInput,
		endInput,
		count,
		minutes,
		onChangeStart,
		onChangeEnd,
		onCommitRange,
	}: RangeFieldsProps,
): React.JSX.Element {
	const fields = [
		{ label: "practice.rangeStart", value: startInput, onChange: onChangeStart },
		{ label: "practice.rangeEnd", value: endInput, onChange: onChangeEnd },
	] as const;

	return (
		<div className={styles.rangeGroup}>
			<div className={styles.rangeInputs}>
				{fields.map(({ label, value, onChange }) => (
					<label key={label} className={styles.rangeField}>
						<span className={styles.inputLabel}>{t(label)}</span>
						<FlashcardInput
							type="number"
							className={styles.input}
							value={value}
							onChange={(event) => onChange(event.target.value)}
							onBlur={onCommitRange}
						/>
					</label>
				))}
			</div>
			<div className={practiceStyles.rangeSelectedNotice}>
				<span className={practiceStyles.rangeCountHighlight}>
					{t("practice.rangeSelectedSummary", { count })}
				</span>
				<span className={practiceStyles.rangeEstimatedTime}>
					（{t("practice.estimatedTime", { minutes })}）
				</span>
			</div>
		</div>
	);
}
