import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { FlashcardInput, FlashcardTextarea } from "../Input";

describe("shared input and textarea primitives", () => {
	it("renders default single-line input with standard control classes", () => {
		const html = renderToStaticMarkup(
			<FlashcardInput placeholder="输入文字..." defaultValue="hello" />,
		);
		expect(html).toContain("flashcard-control");
		expect(html).toContain("flashcard-input");
		expect(html).not.toContain("flashcard-input--");
		expect(html).toContain('placeholder="输入文字..."');
		expect(html).toContain('value="hello"');
	});

	it("supports variants (unstyled, quiz)", () => {
		const unstyled = renderToStaticMarkup(<FlashcardInput variant="unstyled" />);
		const quiz = renderToStaticMarkup(<FlashcardInput variant="quiz" />);

		expect(unstyled).toContain("flashcard-input--unstyled");
		expect(quiz).toContain("flashcard-input--quiz");
	});

	it("supports size modifiers (sm, lg)", () => {
		const small = renderToStaticMarkup(<FlashcardInput inputSize="sm" />);
		const large = renderToStaticMarkup(<FlashcardInput inputSize="lg" />);
		const medium = renderToStaticMarkup(<FlashcardInput inputSize="md" />);

		expect(small).toContain("flashcard-input--sm");
		expect(large).toContain("flashcard-input--lg");
		expect(medium).not.toContain("flashcard-input--md");
	});

	it("supports auto-width layout modifier", () => {
		const autoWidth = renderToStaticMarkup(<FlashcardInput fullWidth={false} />);
		expect(autoWidth).toContain("flashcard-input--auto-width");
	});

	it("handles invalid state and aria-invalid attributes", () => {
		const invalidInput = renderToStaticMarkup(<FlashcardInput invalid />);
		expect(invalidInput).toContain("is-invalid");
		expect(invalidInput).toContain('aria-invalid="true"');

		const explicitAria = renderToStaticMarkup(<FlashcardInput aria-invalid="grammar" />);
		expect(explicitAria).toContain('aria-invalid="grammar"');
	});

	it("renders textarea with standard and unstyled classes", () => {
		const defaultTextarea = renderToStaticMarkup(
			<FlashcardTextarea rows={4} placeholder="多行文字..." />,
		);
		expect(defaultTextarea).toContain("flashcard-control");
		expect(defaultTextarea).toContain("flashcard-textarea");
		expect(defaultTextarea).toContain('rows="4"');

		const unstyledTextarea = renderToStaticMarkup(
			<FlashcardTextarea variant="unstyled" invalid />,
		);
		expect(unstyledTextarea).toContain("flashcard-textarea--unstyled");
		expect(unstyledTextarea).toContain("is-invalid");
		expect(unstyledTextarea).toContain('aria-invalid="true"');
	});
});
