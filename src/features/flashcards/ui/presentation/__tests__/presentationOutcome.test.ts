import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Notice } from "obsidian";
import { reportPresentationOutcome } from "../presentationOutcome";

vi.mock("obsidian", () => ({ Notice: vi.fn() }));

describe("reportPresentationOutcome", () => {
	beforeEach(() => {
		vi.mocked(Notice).mockClear();
	});

	it("surfaces a failed outcome as a notice", () => {
		reportPresentationOutcome({ kind: "failed", message: "Could not save", retryable: true });
		expect(Notice).toHaveBeenCalledWith("Could not save");
	});

	it("stays silent for applied, rejected and cancelled outcomes", () => {
		reportPresentationOutcome({ kind: "applied", studyCompleted: false });
		reportPresentationOutcome({ kind: "rejected", reason: "inactive" });
		reportPresentationOutcome({ kind: "cancelled" });
		expect(Notice).not.toHaveBeenCalled();
	});
});
