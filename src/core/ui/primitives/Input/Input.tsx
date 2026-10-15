import React from "react";

export type InputVariant = "default" | "unstyled" | "quiz";
export type InputSize = "sm" | "md" | "lg";

export interface FlashcardInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
	variant?: InputVariant;
	inputSize?: InputSize;
	fullWidth?: boolean;
	invalid?: boolean;
}

export type TextareaVariant = "default" | "unstyled";

export interface FlashcardTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
	variant?: TextareaVariant;
	invalid?: boolean;
}

function getInputClassName(
	className: string | undefined,
	variant: InputVariant,
	inputSize: InputSize,
	fullWidth: boolean,
	invalid: boolean,
): string {
	return [
		"flashcard-control flashcard-input",
		variant !== "default" ? `flashcard-input--${variant}` : "",
		inputSize !== "md" ? `flashcard-input--${inputSize}` : "",
		!fullWidth ? "flashcard-input--auto-width" : "",
		invalid ? "is-invalid" : "",
		className ?? "",
	]
		.filter(Boolean)
		.join(" ");
}

function getTextareaClassName(
	className: string | undefined,
	variant: TextareaVariant,
	invalid: boolean,
): string {
	return [
		"flashcard-control flashcard-textarea",
		variant !== "default" ? `flashcard-textarea--${variant}` : "",
		invalid ? "is-invalid" : "",
		className ?? "",
	]
		.filter(Boolean)
		.join(" ");
}

/** Shared single-line form control with variant, size, and error states. */
export const FlashcardInput = React.forwardRef<HTMLInputElement, FlashcardInputProps>(
	function FlashcardInput(
		{
			className,
			variant = "default",
			inputSize = "md",
			fullWidth = true,
			invalid = false,
			"aria-invalid": ariaInvalid,
			...props
		},
		ref,
	) {
		return (
			<input
				ref={ref}
				className={getInputClassName(className, variant, inputSize, fullWidth, invalid)}
				aria-invalid={ariaInvalid ?? (invalid || undefined)}
				{...props}
			/>
		);
	},
);

/** Shared multiline form control with the same states as FlashcardInput. */
export const FlashcardTextarea = React.forwardRef<HTMLTextAreaElement, FlashcardTextareaProps>(
	function FlashcardTextarea(
		{ className, variant = "default", invalid = false, "aria-invalid": ariaInvalid, ...props },
		ref,
	) {
		return (
			<textarea
				ref={ref}
				className={getTextareaClassName(className, variant, invalid)}
				aria-invalid={ariaInvalid ?? (invalid || undefined)}
				{...props}
			/>
		);
	},
);
