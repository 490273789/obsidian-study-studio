import { describe, expect, it } from "vitest";
import { videoPlayerStrings } from "../../strings/videoPlayer";

describe("Floating player copy", () => {
	it("has localized strings for maximize and restore actions in zh and en", () => {
		const zh = videoPlayerStrings("zh");
		expect(zh.maximize).toBe("最大化浮窗");
		expect(zh.restore).toBe("还原浮窗");

		const en = videoPlayerStrings("en");
		expect(en.maximize).toBe("Maximize floating player");
		expect(en.restore).toBe("Restore floating player");
	});
});
