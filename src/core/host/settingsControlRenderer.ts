import { App, SecretComponent, Setting } from "obsidian";
import { createSharedTranslator } from "../i18n";
import type { Language } from "../shared/types";
import { mountSettingsSorting, type SortableSettingRow } from "./settingsSorting";
import { SortableInteraction } from "../ui/primitives/Sortable/sortableInteraction";
import {
	type SettingsActionRef,
	type SettingsButtonSnapshot,
	type SettingsCardsSnapshot,
	type SettingsChoiceButtonsSnapshot,
	type SettingsContent,
	type SettingsControlSnapshot,
	type SettingsEditableListSnapshot,
	type SettingsKeybindingSnapshot,
	type SettingsNumberSnapshot,
	type SettingsPresentation,
	type SettingsReorderableSnapshot,
	type SettingsRowSnapshot,
	type SettingsSelectSnapshot,
	type SettingsStatusSnapshot,
	type SettingsTextSnapshot,
	type SettingsToggleSnapshot,
} from "../settings/presentation";

/** Render one immutable presentation; its owner retains generation disposal and persistence. */
export function renderSettingsControls(
	app: App,
	container: HTMLElement,
	presentation: SettingsPresentation,
	language: Language = "zh",
	options?: { redundantHeading?: string },
): () => void {
	const renderer = new SettingsControlRenderer(app, language);
	try {
		renderer.render(container, presentation, options?.redundantHeading);
	} catch (error) {
		renderer.dispose();
		throw error;
	}
	return () => renderer.dispose();
}

class SettingsControlRenderer {
	private readonly disposers: (() => void)[] = [];
	private disposed = false;
	private errorEl: HTMLElement | null = null;
	private container: HTMLElement | null = null;

	constructor(
		private readonly app: App,
		private readonly language: Language,
	) {}

	dispose(): void {
		this.disposed = true;
		for (const dispose of this.disposers.splice(0).reverse()) dispose();
	}

	render(
		container: HTMLElement,
		presentation: SettingsPresentation,
		redundantHeading?: string,
	): void {
		this.container = container;
		for (let i = 0; i < presentation.snapshot.groups.length; i++) {
			const group = presentation.snapshot.groups[i];
			if (!group) continue;
			const groupEl = container.createEl("section", { cls: "fc-settings-group" });
			groupEl.setAttribute("data-settings-group", group.key);
			if (group.heading) groupEl.setAttribute("aria-label", group.heading);
			if (group.heading) {
				const headingSetting = new Setting(groupEl).setName(group.heading).setHeading();
				if (
					i === 0 &&
					redundantHeading &&
					group.heading.trim().toLowerCase() === redundantHeading.trim().toLowerCase()
				) {
					const el =
						headingSetting.settingEl ??
						(headingSetting as unknown as { addClass?: (cls: string) => void });
					el?.addClass?.("fc-heading-redundant");
				}
			}
			for (const row of group.rows) this.renderSetting(groupEl, row, presentation);
		}
	}

	private renderControl(
		setting: Setting,
		control: SettingsControlSnapshot,
		presentation: SettingsPresentation,
	): void {
		switch (control.kind) {
			case "button":
				this.renderButtonControl(setting, control, presentation);
				break;
			case "editableList":
				this.renderEditableListControl(setting, control, presentation);
				break;
			case "choiceButtons":
				this.renderChoiceButtonsControl(setting, control, presentation);
				break;
			case "select":
				this.renderSelectControl(setting, control, presentation);
				break;
			case "slider":
				this.renderSliderControl(setting, control, presentation);
				break;
			case "integer":
				this.renderIntegerControl(setting, control, presentation);
				break;
			case "toggle":
				this.renderToggleControl(setting, control, presentation);
				break;
			case "textarea":
				setting.addTextArea((text) => {
					text.setPlaceholder(control.placeholder)
						.setValue(control.value)
						.setDisabled(control.disabled);
					text.inputEl.rows = 5;
					text.inputEl.setAttribute("aria-label", setting.nameEl.textContent ?? "");
					text.inputEl.addEventListener("change", () => {
						void this.dispatch(presentation, control.action, text.getValue());
					});
				});
				break;
			case "text":
				this.renderTextControl(setting, control, presentation);
				break;
			case "keybinding":
				this.renderKeybindingControl(setting, control, presentation);
				break;
			case "secret":
				this.renderSecretControl(setting, control, presentation);
				break;
			case "status":
				this.renderStatusControl(setting, control);
				break;
			case "reorderable":
				this.renderReorderableControl(setting, control, presentation);
				break;
			case "cards":
				this.renderCardsControl(setting, control, presentation);
				break;
			default: {
				const unsupported: never = control;
				throw new Error(`Unsupported settings control: ${String(unsupported)}`);
			}
		}
	}

	private renderButtonControl(
		setting: Setting,
		control: SettingsButtonSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addButton((button) => {
			const variant =
				control.tone === "primary"
					? "primary"
					: control.tone === "warning" || control.tone === "danger"
						? "danger"
						: "neutral";
			button.buttonEl.addClass(
				"flashcard-btn",
				"flashcard-btn-md",
				`flashcard-btn-${variant}`,
			);
			button
				.setButtonText(control.label)
				.setDisabled(control.disabled)
				.onClick(() => this.dispatch(presentation, control.action, undefined));
			if (control.tone === "warning" || control.tone === "danger") {
				button.setWarning();
			} else if (control.tone === "primary") {
				button.setCta();
			}
		});
	}

	private renderEditableListControl(
		setting: Setting,
		control: SettingsEditableListSnapshot,
		presentation: SettingsPresentation,
	): void {
		this.renderEditableTextList(setting.settingEl, {
			values: [...control.values],
			listClass: "flashcard-tags-list-settings",
			itemClass: "flashcard-tag-item-settings",
			inputClass: "flashcard-tag-input",
			removeButtonClass: "flashcard-tag-remove-btn",
			addButtonClass: "flashcard-tag-add-btn",
			placeholder: control.placeholder,
			addLabel: control.addLabel,
			removeAriaLabel: control.removeAriaLabel,
			focusKey: stableFocusKey(control.changeAction),
			disabled: control.disabled,
			onChange: (index, value) => {
				void this.dispatch(presentation, control.changeAction, { index, value });
			},
			onAdd: () => {
				void this.dispatch(presentation, control.addAction, undefined);
			},
			onRemove: (index) => {
				void this.dispatch(presentation, control.removeAction, index);
			},
		});
	}

	private renderChoiceButtonsControl(
		setting: Setting,
		control: SettingsChoiceButtonsSnapshot,
		presentation: SettingsPresentation,
	): void {
		if (control.choices.length > 0) {
			const tagsContainer = setting.settingEl.createDiv({
				cls: "flashcard-tags-container",
			});
			for (const choice of control.choices) {
				const tagBtn = tagsContainer.createEl("button", {
					type: "button",
					text: choice.label,
					cls: "flashcard-btn flashcard-btn-outline flashcard-btn-sm flashcard-tag-button",
				});
				tagBtn.disabled = control.disabled;
				tagBtn.addEventListener(
					"click",
					() => void this.dispatch(presentation, control.action, choice.id),
				);
			}
			return;
		}

		setting.settingEl.createDiv({
			text: control.emptyText,
			cls: "flashcard-tags-empty",
		});
	}

	private renderSelectControl(
		setting: Setting,
		control: SettingsSelectSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addDropdown((dropdown) => {
			dropdown.selectEl.setAttribute("aria-label", setting.nameEl.textContent ?? "");
			for (const option of control.options) {
				dropdown.addOption(option.value, option.label);
			}
			dropdown
				.setValue(control.value)
				.setDisabled(control.disabled)
				.onChange((value) => {
					void this.dispatch(presentation, control.action, value);
				});
		});
	}

	private renderSliderControl(
		setting: Setting,
		control: SettingsNumberSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addSlider((slider) => {
			slider.sliderEl.setAttribute("aria-label", setting.nameEl.textContent ?? "");
			slider
				.setLimits(control.min, control.max, control.step)
				.setValue(control.value)
				.setDisabled(control.disabled)
				.onChange((value) => {
					void this.dispatch(presentation, control.action, value);
				});
		});
	}

	private renderIntegerControl(
		setting: Setting,
		control: SettingsNumberSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addText((text) => {
			text.setPlaceholder(String(control.value))
				.setValue(String(control.value))
				.setDisabled(control.disabled);
			const input = text.inputEl;
			input.type = "number";
			input.min = String(control.min);
			input.max = String(control.max);
			input.step = String(control.step);
			input.addClass("fc-settings-number-input");
			input.setAttribute("aria-label", setting.nameEl.textContent ?? "");
			input.setAttribute("data-settings-focus", stableFocusKey(control.action));
			const error = setting.controlEl.createSpan({ cls: "fc-settings-input-error" });
			const errorId = `fc-number-error-${presentation.snapshot.generation}-${control.action.id.replace(/[^a-zA-Z0-9-]/g, "-")}`;
			error.setAttribute("id", errorId);
			error.setAttribute("role", "alert");
			error.hidden = true;
			input.setAttribute("aria-describedby", errorId);
			const validate = (): boolean => {
				const value = Number(input.value);
				const valid =
					input.value.trim() !== "" &&
					Number.isInteger(value) &&
					value >= control.min &&
					value <= control.max;
				const message = valid
					? ""
					: createSharedTranslator(this.language)("settings.numberRange", {
							min: control.min,
							max: control.max,
						});
				input.setCustomValidity(message);
				input.setAttribute("aria-invalid", String(!valid));
				error.textContent = message;
				error.hidden = valid;
				return valid;
			};
			let lastRequestedValue: number | undefined = control.value;
			const commit = () => {
				if (control.disabled || !validate()) return;
				const value = Number(input.value);
				if (value === lastRequestedValue) return;
				lastRequestedValue = value;
				void this.dispatch(presentation, control.action, value).then((applied) => {
					if (!applied && lastRequestedValue === value) lastRequestedValue = undefined;
				});
			};
			input.addEventListener("input", () => {
				if (!error.hidden) validate();
			});
			input.addEventListener("change", commit);
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					commit();
				}
			});
		});
	}

	private renderToggleControl(
		setting: Setting,
		control: SettingsToggleSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addToggle((toggle) => {
			toggle
				.setValue(control.value)
				.setDisabled(control.disabled)
				.setTooltip(control.tooltip ?? "")
				.onChange((value) => {
					void this.dispatch(presentation, control.action, value);
				});
			toggle.toggleEl.setAttribute("aria-label", setting.nameEl.textContent ?? "");
		});
	}

	private renderTextControl(
		setting: Setting,
		control: SettingsTextSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addText((text) => {
			text.inputEl.setAttribute("aria-label", setting.nameEl.textContent ?? "");
			text.setPlaceholder(control.placeholder)
				.setValue(control.value)
				.setDisabled(control.disabled);
			text.inputEl.addEventListener("change", () => {
				void this.dispatch(presentation, control.action, text.getValue());
			});
		});
	}

	private renderKeybindingControl(
		setting: Setting,
		control: SettingsKeybindingSnapshot,
		presentation: SettingsPresentation,
	): void {
		const button = setting.controlEl.createEl("button", {
			type: "button",
			text: control.value || control.emptyLabel,
			cls: "fc-keybinding-capture",
		});
		button.disabled = control.disabled;
		button.setAttribute("aria-label", control.recordingLabel);
		const error = setting.controlEl.createSpan({ cls: "fc-keybinding-error" });
		button.addEventListener("focus", () => {
			button.textContent = control.recordingLabel;
			button.classList.add("is-recording");
		});
		button.addEventListener("blur", () => {
			button.textContent = control.value || control.emptyLabel;
			button.classList.remove("is-recording");
		});
		button.addEventListener("keydown", (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				button.blur();
				return;
			}
			const shortcut = settingsShortcutFromEvent(event);
			if (!shortcut) return;
			event.preventDefault();
			event.stopPropagation();
			if (control.unavailableValues.includes(shortcut)) {
				error.textContent = control.conflictMessages?.[shortcut] ?? control.conflictMessage;
				button.classList.add("has-error");
				return;
			}
			error.textContent = "";
			button.classList.remove("has-error");
			button.textContent = shortcut;
			void this.dispatch(presentation, control.action, shortcut);
			button.blur();
		});
	}

	private renderSecretControl(
		setting: Setting,
		control: SettingsTextSnapshot,
		presentation: SettingsPresentation,
	): void {
		const component = new SecretComponent(this.app, setting.controlEl);
		component
			.setValue(control.value)
			.setDisabled(control.disabled)
			.onChange((value) => {
				void this.dispatch(presentation, control.action, value);
			});
	}

	private renderStatusControl(setting: Setting, control: SettingsStatusSnapshot): void {
		setting.controlEl.createSpan({
			text: control.text,
			cls: "flashcard-settings-status",
		});
	}

	/**
	 * Renders an ordered source list with drag & drop plus keyboard-reachable
	 * move up/down buttons, mirroring the source tool's reorderable list.
	 */
	private renderReorderableControl(
		setting: Setting,
		control: SettingsReorderableSnapshot,
		presentation: SettingsPresentation,
	): void {
		const container = setting.descEl.createDiv({
			cls: "flashcard-dictionary-source-list",
		});
		if (control.items.length === 0) {
			if (control.emptyText) {
				container.createDiv({
					text: control.emptyText,
					cls: "flashcard-dictionary-source-empty",
				});
			}
			return;
		}

		const sortableRows: SortableSettingRow[] = [];
		const ids = control.items.map((item) => item.id);
		const sorting = new SortableInteraction({
			items: ids,
			disabled: control.disabled,
			onMove: async ({ activeId, overId }) => {
				const result = await presentation.invoke({
					action: control.moveAction,
					value: { fromIndex: ids.indexOf(activeId), toIndex: ids.indexOf(overId) },
				});
				if (result.status === "failed")
					console.error("Settings action failed:", result.error);
			},
		});
		this.disposers.push(sorting.mount());
		const moveButtons: ((disabled: boolean) => void)[] = [];
		this.disposers.push(
			sorting.subscribe(() => {
				for (const update of moveButtons) update(sorting.getSnapshot().disabled);
			}),
		);

		control.items.forEach((item, index) => {
			const row = new Setting(container);
			row.setClass("flashcard-dictionary-source-row");
			row.setName(item.label);
			if (item.description) row.setDesc(item.description);
			row.nameEl.createSpan({
				text: item.kindLabel,
				cls: "flashcard-dictionary-source-kind",
			});

			if (control.allowDrag && !control.disabled && control.items.length > 1) {
				row.settingEl.addClass("fc-sortable-row");
				const handleContainer = row.controlEl.createDiv({ cls: "fc-settings-sort-handle" });
				sortableRows.push({
					id: item.id,
					label: `${control.tooltips.drag} · ${item.label}`,
					element: row.settingEl,
					handleContainer,
				});
			}

			row.addExtraButton((button) => {
				moveButtons.push((disabled) => button.setDisabled(disabled || index === 0));
				button
					.setIcon("arrow-up")
					.setTooltip(control.tooltips.moveUp)
					.setDisabled(control.disabled || index === 0);
				button.onClick(() => {
					const target = ids[index - 1];
					if (target !== undefined) sorting.move(item.id, target);
				});
			});
			row.addExtraButton((button) => {
				moveButtons.push((disabled) =>
					button.setDisabled(disabled || index === control.items.length - 1),
				);
				button
					.setIcon("arrow-down")
					.setTooltip(control.tooltips.moveDown)
					.setDisabled(control.disabled || index === control.items.length - 1);
				button.onClick(() => {
					const target = ids[index + 1];
					if (target !== undefined) sorting.move(item.id, target);
				});
			});
			if (control.removeAction) {
				const removeAction = control.removeAction;
				const removeTooltip = control.tooltips.remove;
				row.addExtraButton((button) => {
					button.setIcon("trash-2");
					if (removeTooltip) button.setTooltip(removeTooltip);
					button.setDisabled(control.disabled);
					button.onClick(() => this.dispatch(presentation, removeAction, item.id));
				});
			}
			row.addToggle((toggle) => {
				toggle
					.setValue(item.enabled)
					.setDisabled(control.disabled)
					.onChange((value) => this.dispatch(presentation, item.toggleAction, value));
			});
		});
		if (sortableRows.length > 1) {
			const host = container.createDiv({ cls: "fc-settings-sort-context" });
			this.disposers.push(mountSettingsSorting(host, sortableRows, this.language, sorting));
		}
	}

	private renderCardsControl(
		setting: Setting,
		control: SettingsCardsSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.setClass("fc-profile-cards-setting");
		const container = setting.controlEl.createDiv({
			cls: "fc-profile-cards-list",
		});

		if (control.items.length === 0) {
			if (control.emptyText) {
				container.createDiv({
					text: control.emptyText,
					cls: "fc-profile-cards-empty",
				});
			}
			return;
		}

		for (const item of control.items) {
			const card = container.createDiv({
				cls: `fc-profile-card ${item.enabled ? "is-enabled" : "is-disabled"}`,
			});

			const header = card.createDiv({ cls: "fc-profile-card-header" });
			const titleGroup = header.createDiv({ cls: "fc-profile-card-title-group" });

			titleGroup.createSpan({ text: item.badge, cls: "fc-profile-badge" });
			if (item.title) {
				const title = item.title;
				const nameInput = titleGroup.createEl("input", {
					type: "text",
					value: title.value,
					placeholder: title.placeholder,
					cls: "fc-profile-name-input",
				});
				nameInput.disabled = title.disabled;
				nameInput.addEventListener(
					"change",
					() => void this.dispatch(presentation, title.action, nameInput.value),
				);
			}
			if (item.toggle) {
				const toggleSetting = new Setting(titleGroup);
				toggleSetting.setClass("fc-profile-toggle-setting");
				this.renderToggleControl(toggleSetting, item.toggle, presentation);
			}

			const actionsEl = header.createDiv({ cls: "fc-profile-card-actions" });
			const actionsSetting = new Setting(actionsEl);
			for (const action of item.actions) {
				actionsSetting.addExtraButton((button) => {
					button
						.setIcon(
							action.icon === "move-up"
								? "arrow-up"
								: action.icon === "move-down"
									? "arrow-down"
									: "trash-2",
						)
						.setTooltip(action.label)
						.setDisabled(action.disabled)
						.onClick(() => this.dispatch(presentation, action.action, undefined));
				});
			}

			const body = card.createDiv({ cls: "fc-profile-card-body" });
			for (const field of item.fields) {
				const fieldSetting = new Setting(body);
				fieldSetting.setClass("fc-profile-field-setting");
				fieldSetting.setName(field.name);
				if (field.description) this.renderDescription(fieldSetting, field.description);
				for (const fieldControl of field.controls) {
					this.renderControl(fieldSetting, fieldControl, presentation);
				}
			}
		}
	}

	private renderSetting(
		parentEl: HTMLElement,
		row: SettingsRowSnapshot,
		presentation: SettingsPresentation,
	): void {
		const setting = new Setting(parentEl);
		setting.settingEl.setAttribute("data-settings-row", row.key);
		if (!row.name && !row.controls.length) setting.setClass("fc-settings-description-row");
		if (
			row.controls.some(
				(control) => control.kind === "editableList" || control.kind === "choiceButtons",
			)
		)
			setting.setClass("fc-settings-extended-row");
		if (row.layout === "wide") setting.setClass("fc-profile-cards-setting");
		if (row.tone !== "neutral") setting.setClass(`fc-settings-tone-${row.tone}`);
		if (row.tone === "warning" || row.tone === "danger")
			setting.settingEl.setAttribute("role", "alert");
		setting.setName(row.name);
		if (row.description) this.renderDescription(setting, row.description);
		for (const control of row.controls) this.renderControl(setting, control, presentation);
	}

	private dispatch(
		presentation: SettingsPresentation,
		action: SettingsActionRef<unknown>,
		value: unknown,
	): Promise<boolean> {
		return presentation.invoke({ action, value }).then((result) => {
			if (result.status === "failed") {
				console.error("Settings action failed:", result.error);
				if (!this.disposed && this.container) {
					this.errorEl ??= this.container.createDiv({ cls: "fc-settings-action-error" });
					this.errorEl.setAttribute("role", "alert");
					this.errorEl.textContent = createSharedTranslator(this.language)(
						"settings.actionFailed",
					);
				}
			} else if (result.status === "applied" && this.errorEl) this.errorEl.textContent = "";
			return result.status === "applied";
		});
	}

	private renderDescription(setting: Setting, content: SettingsContent): void {
		if (typeof content === "string") {
			setting.setDesc(content);
			return;
		}
		setting.descEl.empty();
		const help = setting.descEl.createDiv({ cls: "flashcard-help" });
		for (const block of content) {
			if (block.kind === "paragraph") help.createEl("p", { text: block.text });
			else if (block.kind === "code") {
				const codeBlock = help.createEl("pre");
				codeBlock.createEl("code", { text: block.text });
			} else {
				const list = help.createEl("ul");
				for (const item of block.items) list.createEl("li", { text: item });
			}
		}
	}

	private renderEditableTextList(
		parentEl: HTMLElement,
		options: {
			values: string[];
			listClass: string;
			itemClass: string;
			inputClass: string;
			removeButtonClass: string;
			addButtonClass: string;
			placeholder: string;
			addLabel: string;
			removeAriaLabel: string;
			focusKey: string;
			disabled: boolean;
			onChange: (index: number, value: string) => void;
			onAdd: () => void;
			onRemove: (index: number) => void;
		},
	): void {
		const listContainer = parentEl.createDiv({
			cls: `fc-settings-list ${options.listClass}`,
		});

		options.values.forEach((value, index) => {
			const hasRemoveButton = options.values.length > 1;
			const item = listContainer.createDiv({
				cls: [
					"fc-settings-item",
					options.itemClass,
					hasRemoveButton ? "has-remove" : "",
				].join(" "),
			});

			const input = item.createEl("input", {
				type: "text",
				value,
				placeholder: options.placeholder,
				cls: `fc-settings-input ${options.inputClass}`,
			});
			input.disabled = options.disabled;
			input.setAttribute("aria-label", `${options.placeholder} ${index + 1}`);
			input.setAttribute("data-settings-focus", `${options.focusKey}/${index}`);

			input.addEventListener("change", () => {
				options.onChange(index, input.value);
			});

			if (hasRemoveButton) {
				const removeBtn = item.createEl("button", {
					type: "button",
					text: options.removeAriaLabel,
					cls: `flashcard-btn flashcard-btn-ghost flashcard-btn-sm fc-btn-remove ${options.removeButtonClass}`,
				});
				removeBtn.setAttr("aria-label", `${options.removeAriaLabel} ${value}`);
				removeBtn.disabled = options.disabled;
				removeBtn.addEventListener("click", () => {
					options.onRemove(index);
				});
			}
		});

		const addBtn = listContainer.createEl("button", {
			type: "button",
			text: options.addLabel,
			cls: `flashcard-btn flashcard-btn-secondary flashcard-btn-sm fc-btn-add ${options.addButtonClass}`,
		});
		addBtn.disabled = options.disabled;
		addBtn.addEventListener("click", () => {
			options.onAdd();
		});
	}
}

/** The action carries a generation for safety; focus identifies the same field across generations. */
function stableFocusKey(action: SettingsActionRef<unknown>): string {
	return action.id.replace(/@\d+(?=\/)/, "");
}

function settingsShortcutFromEvent(event: KeyboardEvent): string | null {
	if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
	// Option/Alt changes KeyboardEvent.key to symbols on macOS (Option+2 is ™).
	// Use the physical letter/digit for command bindings, as Obsidian does.
	const modified = event.ctrlKey || event.altKey || event.metaKey;
	const physicalKey =
		modified && /^Key[A-Z]$/.test(event.code)
			? event.code.slice(3)
			: modified && /^Digit[0-9]$/.test(event.code)
				? event.code.slice(5)
				: null;
	const key =
		physicalKey ??
		(event.key === " " || event.key === "Spacebar"
			? "Space"
			: event.key === "+"
				? "Plus"
				: event.key === "-"
					? "Minus"
					: event.key.length === 1
						? event.key.toUpperCase()
						: event.key);
	if (!key) return null;
	return [
		event.ctrlKey ? "Ctrl" : null,
		event.altKey ? "Alt" : null,
		event.shiftKey ? "Shift" : null,
		event.metaKey ? "Meta" : null,
		key,
	]
		.filter((part): part is string => part !== null)
		.join("+");
}
