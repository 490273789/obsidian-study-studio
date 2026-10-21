import { renderToStaticMarkup } from "react-dom/server";
import { BookOpen } from "lucide-react";
import { describe, expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../../../context/I18nContext";
import { FlashcardHeader } from "../FlashcardHeader";

describe("FlashcardHeader", () => {
	it("renders title, icon, and badge", () => {
		const markup = renderToStaticMarkup(
			<I18nProvider language="zh">
				<FlashcardHeader
					icon={BookOpen}
					title="学习空间"
					badge={<span className="test-badge">Badge</span>}
				/>
			</I18nProvider>,
		);
		expect(markup).toContain("学习空间");
		expect(markup).toContain("test-badge");
		expect(markup).toContain("flashcard-common-header");
	});

	it("passes interactive attributes when provided for collapsible headers", () => {
		const handleClick = vi.fn();
		const markup = renderToStaticMarkup(
			<I18nProvider language="zh">
				<FlashcardHeader
					title="Home"
					ariaExpanded={false}
					ariaControls="actions-id"
					onClick={handleClick}
				/>
			</I18nProvider>,
		);
		expect(markup).toContain('aria-expanded="false"');
		expect(markup).toContain('aria-controls="actions-id"');
	});
});
