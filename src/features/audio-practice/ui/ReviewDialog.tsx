import React, { useId } from "react";
import { Captions, ListChecks, Play, Plus, Trash2, X } from "lucide-react";
import { cls } from "../../../core/shared/classNames";
import { FlashcardButton as Button } from "../../../core/ui/primitives/Button";
import { FlashcardCheckbox } from "../../../core/ui/primitives/Checkbox";
import { FlashcardInput, FlashcardTextarea } from "../../../core/ui/primitives/Input";
import { ModalSurface } from "../../../core/ui/primitives/Modal";
import type { AudioMaterial, AudioPracticeDraftSnapshot } from "../domain/types";
import type { SubtitleDraftAction, SubtitleDraftEngine } from "../domain/subtitleDraftEngine";
import type { AudioPracticeStrings } from "../strings/audioPractice";
import styles from "./AudioPractice.module.scss";

function timeLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
	return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

export interface DraftReviewBodyProps {
	readonly draft: AudioPracticeDraftSnapshot;
	readonly material: AudioMaterial;
	readonly engine?: Pick<SubtitleDraftEngine, "act" | "commitForMaterial">;
	readonly runtime?: {
		readonly preview?: (start: number, end: number) => void;
		readonly actOnSubtitleDraft?: (action: SubtitleDraftAction) => void;
	};
	readonly onPreview?: (start: number, end: number) => void;
	readonly t: AudioPracticeStrings;
	readonly busy: boolean;
	readonly error: string | null;
	readonly titleId?: string;
	readonly hintId?: string;
	readonly initialFocusProps?: { "data-modal-initial-focus": string };
	readonly requestClose?: () => void;
	readonly onSave?: () => void;
}

export function DraftReviewBody(props: DraftReviewBodyProps): React.ReactNode {
	const {
		draft,
		material,
		engine,
		runtime,
		onPreview,
		t,
		busy,
		error,
		titleId,
		hintId,
		requestClose,
		onSave,
	} = props;
	const pending = draft.cues.filter((cue) => cue.needsReview).length;
	const act = (action: SubtitleDraftAction) => {
		if (engine) engine.act(action);
		else if (runtime?.actOnSubtitleDraft) runtime.actOnSubtitleDraft(action);
	};
	const preview = (start: number, end: number) => {
		if (onPreview) onPreview(start, end);
		else if (runtime?.preview) runtime.preview(start, end);
	};

	return (
		<>
			<div className="flashcard-modal-header">
				<div className="flashcard-modal-heading">
					<span id={titleId} className="flashcard-modal-title">
						<Captions size={17} />
						{t.review}
					</span>
					<span id={hintId} className="flashcard-modal-subtitle">
						{material.title} · {t.reviewHint}
					</span>
				</div>
				<Button
					preset="icon"
					icon={X}
					disabled={busy}
					aria-label={t.close}
					title={t.close}
					onClick={() => requestClose?.()}
				/>
			</div>
			<div className={cls("flashcard-modal-body", styles.reviewBody)}>
				<div className={styles.reviewSummary}>
					<span>{t.reviewSummary(pending, draft.cues.length)}</span>
					<Button
						size="sm"
						icon={ListChecks}
						disabled={busy || pending === 0}
						onClick={() => act({ type: "confirm-all-cues" })}
					>
						{t.markAllReviewed}
					</Button>
				</div>
				{error && (
					<p role="alert" className={styles.alert}>
						{error}
					</p>
				)}
				<ol className={styles.draftList}>
					{draft.cues.map((cue, index) => {
						const invalid =
							cue.start === null || cue.end === null || cue.end <= cue.start;
						const wordFallback = draft.hasReviewWordTimings && !cue.highlightable;
						return (
							<li key={cue.id} className={styles.draftCue}>
								<div className={styles.draftCueHeader}>
									<span className={styles.draftCueIndex}>
										{String(index + 1).padStart(2, "0")}
									</span>
									<FlashcardCheckbox
										checked={!cue.needsReview}
										onChange={(event) =>
											act({
												type: "edit-cue",
												id: cue.id,
												patch: {
													needsReview: !event.target.checked,
												},
											})
										}
										label={cue.needsReview ? t.pending : t.checked}
									/>
									<span className={styles.draftCueTime}>
										{cue.start === null ? "—" : timeLabel(cue.start)}
										<span aria-hidden="true">–</span>
										{cue.end === null ? "—" : timeLabel(cue.end)}
									</span>
									<Button
										preset="icon"
										size="sm"
										icon={Trash2}
										className={styles.draftDelete}
										aria-label={`${t.deleteCue} ${index + 1}`}
										title={t.deleteCue}
										onClick={() =>
											act({
												type: "remove-cue",
												id: cue.id,
											})
										}
									/>
								</div>
								<FlashcardTextarea
									value={cue.text}
									onChange={(event) =>
										act({
											type: "edit-cue",
											id: cue.id,
											patch: {
												text: event.target.value,
											},
										})
									}
									aria-label={`${t.cueText} ${index + 1}`}
									rows={2}
									{...(index === 0 ? props.initialFocusProps : undefined)}
								/>
								{wordFallback && (
									<p className={styles.draftWordFallback}>
										{t.wordTimingFallback}
									</p>
								)}
								<div className={styles.draftTimeRow}>
									<label className={styles.timeField}>
										<span>{t.start}</span>
										<FlashcardInput
											type="number"
											min="0"
											step="0.01"
											inputSize="sm"
											fullWidth={false}
											value={cue.start ?? ""}
											onChange={(event) =>
												act({
													type: "edit-cue",
													id: cue.id,
													patch: {
														start:
															event.target.value === ""
																? null
																: Number(event.target.value),
													},
												})
											}
										/>
									</label>
									<label className={styles.timeField}>
										<span>{t.end}</span>
										<FlashcardInput
											type="number"
											min="0"
											step="0.01"
											inputSize="sm"
											fullWidth={false}
											value={cue.end ?? ""}
											onChange={(event) =>
												act({
													type: "edit-cue",
													id: cue.id,
													patch: {
														end:
															event.target.value === ""
																? null
																: Number(event.target.value),
													},
												})
											}
										/>
									</label>
									<Button
										size="sm"
										icon={Play}
										disabled={invalid}
										onClick={() => {
											if (cue.start !== null && cue.end !== null) {
												preview(cue.start, cue.end);
											}
										}}
									>
										{t.audition}
									</Button>
								</div>
							</li>
						);
					})}
				</ol>
			</div>
			<div className={cls("flashcard-modal-footer", styles.dialogFooter)}>
				<Button icon={Plus} onClick={() => act({ type: "add-cue" })} disabled={busy}>
					{t.addCue}
				</Button>
				<span className={styles.footerSpacer} />
				<Button onClick={() => requestClose?.()} disabled={busy}>
					{t.close}
				</Button>
				<Button variant="primary" disabled={busy} onClick={() => onSave?.()}>
					{busy ? t.busy : t.saveDraft}
				</Button>
			</div>
		</>
	);
}

export interface ReviewDialogProps {
	readonly draft: AudioPracticeDraftSnapshot;
	readonly material: AudioMaterial;
	readonly engine: Pick<SubtitleDraftEngine, "act" | "commitForMaterial">;
	readonly onPreview?: (start: number, end: number) => void;
	readonly t: AudioPracticeStrings;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onRequestClose: () => void;
	readonly onSaved?: () => void;
}

export function ReviewDialog(props: ReviewDialogProps): React.ReactNode {
	const titleId = useId();
	const hintId = useId();
	const { draft, material, engine, onPreview, t, busy, error, onRequestClose, onSaved } = props;

	const handleSave = () => {
		void engine.commitForMaterial(material).then((saved) => {
			if (saved) {
				onSaved?.();
				onRequestClose();
			}
		});
	};

	return (
		<ModalSurface
			className={styles.reviewDialog}
			labelledBy={titleId}
			describedBy={hintId}
			onRequestClose={onRequestClose}
			isDismissible={!busy}
		>
			{({ requestClose, initialFocusProps }) => (
				<DraftReviewBody
					draft={draft}
					material={material}
					engine={engine}
					onPreview={onPreview}
					t={t}
					busy={busy}
					error={error}
					titleId={titleId}
					hintId={hintId}
					initialFocusProps={initialFocusProps}
					requestClose={requestClose}
					onSave={handleSave}
				/>
			)}
		</ModalSurface>
	);
}
