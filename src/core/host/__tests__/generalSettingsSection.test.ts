import { describe, expect, it, vi } from "vite-plus/test";
import type { Language } from "../../shared/types";
import { createGeneralSettingsSection } from "../generalSettingsSection";

describe("general settings", () => {
	it("saves the shared language and disables changes until persistence completes", async () => {
		let language: Language = "zh";
		let finish!: () => void;
		const refresh = vi.fn();
		const updateLanguage = vi.fn(
			(next: Language) =>
				new Promise<void>((resolve) => {
					finish = () => {
						language = next;
						resolve();
					};
				}),
		);
		const section = createGeneralSettingsSection({
			readLanguage: () => language,
			updateLanguage,
			refresh,
		});
		const presentation = section.presentation("zh");
		const control = presentation.snapshot.groups[0]!.rows[0]!.controls[0]!;
		if (control.kind !== "select") throw new Error("Expected language select");
		const pending = presentation.invoke({ action: control.action, value: "en" });
		expect(updateLanguage).toHaveBeenCalledWith("en");
		expect(section.presentation("zh").snapshot.groups[0]!.rows[0]!.controls[0]!.disabled).toBe(
			true,
		);
		expect(language).toBe("zh");
		finish();
		await pending;
		expect(language).toBe("en");
		const saved = section.presentation("en").snapshot.groups[0]!.rows[0]!.controls[0]!;
		expect(saved.disabled).toBe(false);
		if (saved.kind !== "select") throw new Error("Expected language select");
		expect(saved.value).toBe("en");
		expect(refresh).toHaveBeenCalledTimes(2);
	});

	it("retains the committed language and offers an editable retry after a save failure", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const updateLanguage = vi
			.fn()
			.mockRejectedValueOnce(new Error("disk unavailable"))
			.mockResolvedValueOnce(undefined);
		const section = createGeneralSettingsSection({
			readLanguage: () => "zh",
			updateLanguage,
			refresh: vi.fn(),
		});
		const first = section.presentation("zh");
		const select = first.snapshot.groups[0]!.rows[0]!.controls[0]!;
		if (select.kind !== "select") throw new Error("Expected language select");
		await first.invoke({ action: select.action, value: "en" });
		const failed = section.presentation("zh");
		expect(
			failed.snapshot.groups[0]!.rows.find((row) => row.key === "save-error")?.name,
		).toContain("重试");
		const retry = failed.snapshot.groups[0]!.rows[0]!.controls[0]!;
		if (retry.kind !== "select") throw new Error("Expected language select");
		expect(retry.value).toBe("zh");
		expect(retry.disabled).toBe(false);
		await failed.invoke({ action: retry.action, value: "en" });
		expect(updateLanguage).toHaveBeenCalledTimes(2);
		expect(section.presentation("zh").snapshot.groups[0]!.rows).toHaveLength(1);
		log.mockRestore();
	});
});
