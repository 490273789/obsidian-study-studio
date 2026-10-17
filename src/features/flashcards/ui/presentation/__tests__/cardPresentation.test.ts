import { describe, expect, it } from "vite-plus/test";
import { deriveCardPresentation } from "../cardPresentation";

const card = {
	front: "front",
	back: "back",
	explanation: "explanation",
};

describe("deriveCardPresentation", () => {
	it("hides the answer side until it is visible", () => {
		const model = deriveCardPresentation({ card, direction: "normal", answerVisible: false });
		expect(model.question).toEqual({
			label: "common.question",
			content: "front",
			pronunciationWord: null,
		});
		expect(model.answer).toBeNull();
		expect(model.explanation).toBeNull();
	});

	it("exposes the answer and explanation once visible", () => {
		const model = deriveCardPresentation({ card, direction: "normal", answerVisible: true });
		expect(model.answer).toEqual({
			label: "common.answer",
			content: "back",
			pronunciationWord: null,
		});
		expect(model.explanation).toEqual({
			label: "common.explanation",
			content: "explanation",
			pronunciationWord: null,
		});
	});

	it("places the pronunciation word on the side that shows it", () => {
		const normal = deriveCardPresentation({
			card,
			direction: "normal",
			answerVisible: true,
			pronunciationWord: "front",
		});
		expect(normal.question.pronunciationWord).toBe("front");
		expect(normal.answer?.pronunciationWord).toBeNull();

		const reversed = deriveCardPresentation({
			card,
			direction: "reversed",
			answerVisible: true,
			pronunciationWord: "front",
		});
		expect(reversed.question.pronunciationWord).toBeNull();
		expect(reversed.question.content).toBe("back");
		expect(reversed.answer?.content).toBe("front");
		expect(reversed.answer?.pronunciationWord).toBe("front");
	});

	it("treats an empty pronunciation word as absent", () => {
		const model = deriveCardPresentation({
			card,
			direction: "normal",
			answerVisible: false,
			pronunciationWord: "",
		});
		expect(model.question.pronunciationWord).toBeNull();
	});

	it("uses an explicit explanation override unchanged", () => {
		const model = deriveCardPresentation({
			card: { front: "front", back: "back" },
			direction: "normal",
			answerVisible: true,
			explanation: "  raw explanation  ",
		});
		expect(model.explanation?.content).toBe("  raw explanation  ");
	});

	it("drops an empty or absent explanation", () => {
		const noExplanation = deriveCardPresentation({
			card: { front: "front", back: "back" },
			direction: "normal",
			answerVisible: true,
		});
		expect(noExplanation.explanation).toBeNull();

		const explicitNull = deriveCardPresentation({
			card,
			direction: "normal",
			answerVisible: true,
			explanation: null,
		});
		expect(explicitNull.explanation).toBeNull();
	});

	it("renders an empty question when no card is presented", () => {
		const model = deriveCardPresentation({
			card: null,
			direction: "normal",
			answerVisible: true,
		});
		expect(model.question.content).toBe("");
		expect(model.answer).toBeNull();
		expect(model.explanation).toBeNull();
	});

	it("accepts a view-specific question label", () => {
		const model = deriveCardPresentation({
			card,
			direction: "normal",
			answerVisible: false,
			questionLabel: "spelling.meaningPrompt",
		});
		expect(model.question.label).toBe("spelling.meaningPrompt");
	});
});
