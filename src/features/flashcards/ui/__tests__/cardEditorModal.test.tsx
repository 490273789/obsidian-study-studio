import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../../core/ui/context/I18nContext";
import { flashcardTranslator } from "../../strings";
import { CardEditorModal } from "../views/Card/CardEditorModal";

vi.mock("../../../../core/ui/primitives/Modal", () => ({
	ModalSurface: ({
		children,
		onRequestClose,
		isDismissible,
	}: {
		children: (controls: {
			requestClose: () => void;
			initialFocusProps: object;
		}) => React.ReactNode;
		onRequestClose: () => void;
		isDismissible: boolean;
	}) => (
		<div data-dismissible={isDismissible}>
			{children({ requestClose: onRequestClose, initialFocusProps: {} })}
		</div>
	),
}));

function render(isSaving: boolean, error: string | null) {
	return renderToStaticMarkup(
		<I18nProvider language="en" translator={flashcardTranslator}>
			<CardEditorModal
				mode="edit"
				decks={[{ id: "deck", name: "Deck", tag: "word" }]}
				initialDeckId="deck"
				initialFront="unsaved front"
				initialBack="unsaved back"
				initialExplanation="unsaved explanation"
				isSaving={isSaving}
				error={error}
				onSave={async () => {}}
				onClose={() => {}}
			/>
		</I18nProvider>,
	);
}

describe("CardEditorModal interaction snapshot", () => {
	it("locks fields and dismissal while the interaction is saving", () => {
		const html = render(true, null);
		expect(html).toContain('data-dismissible="false"');
		const controls = html.match(/<(?:button|textarea)\b[^>]*>/g)!;
		expect(controls.length).toBeGreaterThan(0);
		for (const control of controls) expect(control).toContain('disabled=""');
	});

	it("renders a failed interaction's error and leaves draft fields available", () => {
		const html = render(false, "write failed");
		expect(html).toContain('data-dismissible="true"');
		expect(html).toContain("write failed");
		expect(html).toContain("unsaved front");
		expect(html).toContain("unsaved back");
		expect(html).not.toContain('disabled=""');
	});
});
