import { describe, expect, it, vi } from "vitest";
import { defineSettings, SettingsPresentationError } from "../presentation";
import { RecordingSettingsAdapter } from "../testing/recordingSettingsAdapter";

describe("settings presentation", () => {
	it("builds an immutable callback-free snapshot and dispatches through action references", async () => {
		const setEnabled = vi.fn();
		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.toggle(
					"enabled",
					{ name: "Enabled", description: "Turn it on" },
					{ value: false, onChange: setEnabled },
				);
			});
		});
		const adapter = new RecordingSettingsAdapter();
		adapter.install(presentation);

		const snapshot = adapter.snapshot();
		const control = snapshot.groups[0]?.rows[0]?.controls[0];
		expect(snapshot).toMatchObject({
			sectionId: "example",
			groups: [{ key: "general", rows: [{ key: "enabled", name: "Enabled" }] }],
		});
		expect(JSON.stringify(snapshot)).not.toContain("onChange");
		expect(Object.isFrozen(snapshot)).toBe(true);
		if (control?.kind !== "toggle") throw new Error("Expected toggle");

		expect(await adapter.dispatch(control.action, true)).toEqual({ status: "applied" });
		expect(setEnabled).toHaveBeenCalledWith(true);
		expect(await presentation.invoke({ action: control.action, value: "true" })).toMatchObject({
			status: "failed",
			error: { code: "invalid-interaction" },
		});
		expect(setEnabled).toHaveBeenCalledOnce();
	});

	it("filters hidden rows and rejects disabled and stale interactions", async () => {
		const hidden = vi.fn();
		const disabled = vi.fn();
		const first = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.button(
					"hidden",
					{ name: "Hidden", visible: false },
					{ label: "Hidden", onPress: hidden },
				);
				group.button(
					"disabled",
					{ name: "Disabled" },
					{ label: "Disabled", disabled: true, onPress: disabled },
				);
			});
		});
		const adapter = new RecordingSettingsAdapter();
		adapter.install(first);
		const control = adapter.snapshot().groups[0]?.rows[0]?.controls[0];
		if (control?.kind !== "button") throw new Error("Expected button");
		expect(adapter.snapshot().groups[0]?.rows.map((row) => row.key)).toEqual(["disabled"]);
		expect(await adapter.dispatch(control.action, undefined)).toEqual({
			status: "ignored",
			reason: "disabled",
		});

		adapter.install(defineSettings("replacement", () => undefined));
		expect(await first.invoke({ action: control.action, value: undefined })).toEqual({
			status: "ignored",
			reason: "stale",
		});
		const replacement = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.button(
					"disabled",
					{ name: "Replacement" },
					{ label: "Replacement", onPress: vi.fn() },
				);
			});
		});
		expect(
			await replacement.invoke({ action: control.action, value: undefined }),
		).toMatchObject({
			status: "failed",
			error: { code: "invalid-interaction" },
		});
		expect(hidden).not.toHaveBeenCalled();
		expect(disabled).not.toHaveBeenCalled();
	});

	it("fails definitions atomically and reports action failures with stable codes", async () => {
		expect(() =>
			defineSettings("example", (page) => {
				page.group("general", "General", (group) => {
					group.row("same", { name: "One" });
					group.row("same", { name: "Two" });
				});
			}),
		).toThrowError(
			expect.objectContaining<Partial<SettingsPresentationError>>({ code: "duplicate-key" }),
		);

		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.button(
					"fail",
					{ name: "Fail" },
					{
						label: "Fail",
						onPress: () => Promise.reject(new Error("boom")),
					},
				);
			});
		});
		const control = presentation.snapshot.groups[0]?.rows[0]?.controls[0];
		if (control?.kind !== "button") throw new Error("Expected button");
		const result = await presentation.invoke({ action: control.action, value: undefined });
		expect(result).toMatchObject({ status: "failed", error: { code: "action-failed" } });
	});

	it("validates malformed interactions and propagates collection disabled state", async () => {
		const change = vi.fn();
		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.cards(
					"profiles",
					{ name: "Profiles" },
					{
						disabled: true,
						items: [
							{
								key: "profile/with/slashes",
								badge: "Profile",
								enabled: true,
								build: (card) =>
									card.field("name", { name: "Name" }, (row) => {
										row.text("value", { value: "Current", onChange: change });
									}),
							},
						],
					},
				);
			});
		});
		const cards = presentation.snapshot.groups[0]?.rows[0]?.controls[0];
		if (cards?.kind !== "cards") throw new Error("Expected cards");
		const text = cards.items[0]?.fields[0]?.controls[0];
		if (text?.kind !== "text") throw new Error("Expected text field");
		expect(text.disabled).toBe(true);
		expect(await presentation.invoke({ action: text.action, value: "Next" })).toEqual({
			status: "ignored",
			reason: "disabled",
		});
		expect(
			await presentation.invoke({ action: null, value: undefined } as never),
		).toMatchObject({ status: "failed", error: { code: "invalid-interaction" } });
		expect(change).not.toHaveBeenCalled();
	});
});
