import { describe, expect, it } from "vite-plus/test";
import { detectTranslationDirection } from "../selectionDirection";

describe("detectTranslationDirection", () => {
	it("detects Chinese text as zh-en", () => {
		expect(detectTranslationDirection("你好")).toBe("zh-en");
		expect(detectTranslationDirection("这是一个测试句子")).toBe("zh-en");
		expect(detectTranslationDirection("Hello 世界")).toBe("zh-en");
	});

	it("detects English and non-Chinese text as en-zh", () => {
		expect(detectTranslationDirection("hello world")).toBe("en-zh");
		expect(detectTranslationDirection("Apple")).toBe("en-zh");
		expect(detectTranslationDirection("12345")).toBe("en-zh");
		expect(detectTranslationDirection("")).toBe("en-zh");
	});
});
