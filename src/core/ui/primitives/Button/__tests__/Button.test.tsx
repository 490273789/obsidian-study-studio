import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Keyboard } from "lucide-react";
import { describe, expect, it } from "vite-plus/test";
import { FlashcardButton, type ButtonVariant } from "../Button";

describe("shared button contract", () => {
	it("keeps utility buttons neutral and icon controls quiet by default", () => {
		const utility = renderToStaticMarkup(<FlashcardButton>取消</FlashcardButton>);
		const icon = renderToStaticMarkup(
			<FlashcardButton preset="icon" icon={Keyboard} aria-label="拼写" />,
		);
		expect(utility).toContain("flashcard-btn-neutral");
		expect(utility).toContain('type="button"');
		expect(icon).toContain("flashcard-btn-ghost");
		expect(icon).toContain('aria-label="拼写"');
		expect(icon).toContain('aria-hidden="true"');
	});

	it("allows all six hierarchy levels to compose with a sized icon control", () => {
		const variants: ButtonVariant[] = [
			"primary",
			"secondary",
			"neutral",
			"outline",
			"ghost",
			"danger",
		];
		for (const variant of variants) {
			const markup = renderToStaticMarkup(
				<FlashcardButton
					variant={variant}
					preset="icon"
					size="lg"
					icon={Keyboard}
					aria-label="拼写"
				/>,
			);
			expect(markup).toContain(`flashcard-btn-${variant}`);
			expect(markup).toContain("flashcard-btn-icon");
			expect(markup).toContain("flashcard-btn-lg");
		}
	});

	it("preserves native disabled, submit and accessibility state semantics", () => {
		const markup = renderToStaticMarkup(
			<FlashcardButton variant="outline" type="submit" disabled active aria-pressed="true">
				保存
			</FlashcardButton>,
		);
		expect(markup).toContain('type="submit"');
		expect(markup).toContain('disabled=""');
		expect(markup).toContain('aria-pressed="true"');
		expect(markup).toContain("active");
		expect(markup).not.toContain("flashcard-btn-neutral");
	});
});
