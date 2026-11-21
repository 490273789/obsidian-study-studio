import React from "react";
import { CheckCircle2, RotateCcw, Star } from "lucide-react";
import { cls } from "../../../core/shared/classNames";
import { FlashcardButton as Button } from "../../../core/ui/primitives/Button";
import type { AudioPracticeStrings } from "../strings/audioPractice";
import type { PracticeCompletion } from "./practiceSession";
import styles from "./AudioPractice.module.scss";

interface PracticeSummaryProps {
	readonly completion: PracticeCompletion;
	readonly elapsedMs: number;
	readonly t: AudioPracticeStrings;
	/** Difficult-only practice is already active, or nothing is marked yet. */
	readonly canPracticeDifficult: boolean;
	readonly onReplay: () => void;
	readonly onPracticeDifficult: () => void;
}

function elapsedParts(elapsedMs: number): { minutes: number; seconds: number } {
	const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
	return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
}

/**
 * End-of-session card: closes an 80-sentence pass with what was practised and
 * one obvious next step, instead of freezing on the last sentence. It stays a
 * status rail rather than a modal, so the transcript and player stay usable.
 */
export function PracticeSummary(props: PracticeSummaryProps): React.ReactNode {
	const { completion, elapsedMs, t, canPracticeDifficult } = props;
	const { minutes, seconds } = elapsedParts(elapsedMs);
	return (
		<div className={styles.summary}>
			<span className={styles.summaryIcon} aria-hidden="true">
				<CheckCircle2 size={18} />
			</span>
			<output className={styles.summaryText}>
				<span className={styles.summaryTitle}>{t.summaryTitle}</span>
				<span className={cls("fc-meta", styles.summaryMeta)}>
					<span className="fc-meta__text">
						{t.summaryProgress(completion.reached, completion.total)}
					</span>
					{completion.marked > 0 && (
						<>
							<span className="fc-meta__dot" aria-hidden="true" />
							<span className="fc-meta__text">
								{t.summaryMarks(completion.marked)}
							</span>
						</>
					)}
					{elapsedMs > 0 && (
						<>
							<span className="fc-meta__dot" aria-hidden="true" />
							<span className="fc-meta__text">
								{t.summaryElapsed(minutes, seconds)}
							</span>
						</>
					)}
				</span>
			</output>
			<div className={styles.summaryActions}>
				<Button size="sm" variant="primary" icon={RotateCcw} onClick={props.onReplay}>
					{t.replay}
				</Button>
				{canPracticeDifficult && (
					<Button
						size="sm"
						variant="secondary"
						icon={Star}
						onClick={props.onPracticeDifficult}
					>
						{t.difficultOnly}
					</Button>
				)}
			</div>
		</div>
	);
}
