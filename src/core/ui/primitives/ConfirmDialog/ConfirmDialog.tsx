import { memo, useId } from "react";
import { AlertTriangle, Check, Sparkles, X } from "lucide-react";
import { FlashcardButton } from "../Button";
import { ModalSurface } from "../Modal";

export type ConfirmDialogTone = "primary" | "danger";

export interface ConfirmDialogProps {
	title: string;
	message: string;
	confirmText: string;
	cancelText: string;
	kicker: string;
	tone?: ConfirmDialogTone;
	onConfirm: () => void;
	onCancel: () => void;
}

export const ConfirmDialog = memo(function ConfirmDialog({
	title,
	message,
	confirmText,
	cancelText,
	kicker,
	tone = "primary",
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const titleId = useId();
	const descriptionId = useId();
	const Icon = tone === "danger" ? AlertTriangle : Sparkles;

	return (
		<ModalSurface
			className={`flashcard-confirm-dialog is-${tone}`}
			backdropClassName="flashcard-confirm-backdrop"
			role="alertdialog"
			labelledBy={titleId}
			describedBy={descriptionId}
			onRequestClose={onCancel}
		>
			{({ requestClose, initialFocusProps }) => (
				<>
					<div className="flashcard-confirm-accent" aria-hidden="true" />
					<div className="flashcard-modal-header flashcard-confirm-header">
						<div className="flashcard-confirm-heading">
							<span className="flashcard-confirm-icon" aria-hidden="true">
								<Icon size={20} />
							</span>
							<div className="flashcard-modal-heading">
								<span className="flashcard-modal-kicker fc-kicker">{kicker}</span>
								<h2 id={titleId} className="flashcard-confirm-title">
									{title}
								</h2>
							</div>
						</div>
						<FlashcardButton
							preset="icon"
							icon={X}
							onClick={requestClose}
							title={cancelText}
							aria-label={cancelText}
						/>
					</div>

					<div className="flashcard-modal-body flashcard-confirm-body">
						<p id={descriptionId}>{message}</p>
					</div>

					<div className="flashcard-modal-footer flashcard-confirm-footer">
						<FlashcardButton
							variant="secondary"
							className="flashcard-confirm-cancel"
							onClick={requestClose}
							{...initialFocusProps}
						>
							{cancelText}
						</FlashcardButton>
						<FlashcardButton
							variant={tone === "danger" ? "danger" : "primary"}
							icon={Check}
							onClick={onConfirm}
						>
							{confirmText}
						</FlashcardButton>
					</div>
				</>
			)}
		</ModalSurface>
	);
});
