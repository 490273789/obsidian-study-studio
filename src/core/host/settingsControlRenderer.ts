import { App, SecretComponent, Setting } from "obsidian";
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
): void {
	new SettingsControlRenderer(app, container.ownerDocument).render(container, presentation);
}

class SettingsControlRenderer {
	constructor(
		private readonly app: App,
		private readonly document: Document,
	) {}

	render(container: HTMLElement, presentation: SettingsPresentation): void {
		for (const group of presentation.snapshot.groups) {
			if (group.heading) new Setting(container).setName(group.heading).setHeading();
			for (const row of group.rows) this.renderSetting(container, row, presentation);
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
					text.inputEl.addEventListener("change", () => {
						this.dispatch(presentation, control.action, text.getValue());
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
		this.renderEditableTextList(setting.descEl, {
			values: [...control.values],
			listClass: "flashcard-tags-list-settings",
			itemClass: "flashcard-tag-item-settings",
			inputClass: "flashcard-tag-input",
			removeButtonClass: "flashcard-tag-remove-btn",
			addButtonClass: "flashcard-tag-add-btn",
			placeholder: control.placeholder,
			addLabel: control.addLabel,
			removeAriaLabel: control.removeAriaLabel,
			disabled: control.disabled,
			onChange: (index, value) => {
				this.dispatch(presentation, control.changeAction, { index, value });
			},
			onAdd: () => {
				this.dispatch(presentation, control.addAction, undefined);
			},
			onRemove: (index) => {
				this.dispatch(presentation, control.removeAction, index);
			},
		});
	}

	private renderChoiceButtonsControl(
		setting: Setting,
		control: SettingsChoiceButtonsSnapshot,
		presentation: SettingsPresentation,
	): void {
		if (control.choices.length > 0) {
			const tagsContainer = setting.descEl.createDiv({
				cls: "flashcard-tags-container",
			});
			for (const choice of control.choices) {
				const tagBtn = tagsContainer.createEl("button", {
					text: choice.label,
					cls: "flashcard-tag-button",
				});
				tagBtn.disabled = control.disabled;
				tagBtn.addEventListener("click", () =>
					this.dispatch(presentation, control.action, choice.id),
				);
			}
			return;
		}

		setting.descEl.createDiv({
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
			for (const option of control.options) {
				dropdown.addOption(option.value, option.label);
			}
			dropdown
				.setValue(control.value)
				.setDisabled(control.disabled)
				.onChange((value) => {
					this.dispatch(presentation, control.action, value);
				});
		});
	}

	private renderSliderControl(
		setting: Setting,
		control: SettingsNumberSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addSlider((slider) =>
			slider
				.setLimits(control.min, control.max, control.step)
				.setValue(control.value)
				.setDisabled(control.disabled)
				.onChange((value) => {
					this.dispatch(presentation, control.action, value);
				}),
		);
	}

	private renderIntegerControl(
		setting: Setting,
		control: SettingsNumberSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addText((text) =>
			text
				.setPlaceholder(String(control.value))
				.setValue(String(control.value))
				.setDisabled(control.disabled)
				.onChange((value) => {
					this.dispatch(presentation, control.action, value);
				}),
		);
	}

	private renderToggleControl(
		setting: Setting,
		control: SettingsToggleSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addToggle((toggle) =>
			toggle
				.setValue(control.value)
				.setDisabled(control.disabled)
				.setTooltip(control.tooltip ?? "")
				.onChange((value) => {
					this.dispatch(presentation, control.action, value);
				}),
		);
	}

	private renderTextControl(
		setting: Setting,
		control: SettingsTextSnapshot,
		presentation: SettingsPresentation,
	): void {
		setting.addText((text) => {
			text.setPlaceholder(control.placeholder)
				.setValue(control.value)
				.setDisabled(control.disabled);
			text.inputEl.addEventListener("change", () => {
				this.dispatch(presentation, control.action, text.getValue());
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
				error.textContent = control.conflictMessage;
				button.classList.add("has-error");
				return;
			}
			error.textContent = "";
			button.classList.remove("has-error");
			button.textContent = shortcut;
			this.dispatch(presentation, control.action, shortcut);
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
				this.dispatch(presentation, control.action, value);
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

		let draggedId: string | null = null;
		const clearDragOver = (): void => {
			for (const el of container.querySelectorAll(".is-drag-over")) {
				el.removeClass("is-drag-over");
			}
		};

		control.items.forEach((item, index) => {
			const row = new Setting(container);
			row.setClass("flashcard-dictionary-source-row");
			row.setName(item.label);
			if (item.description) row.setDesc(item.description);
			row.nameEl.createSpan({
				text: item.kindLabel,
				cls: "flashcard-dictionary-source-kind",
			});

			if (control.allowDrag && !control.disabled) {
				row.addExtraButton((button) => {
					button.setIcon("grip-vertical").setTooltip(control.tooltips.drag);
					button.extraSettingsEl.draggable = true;
					button.extraSettingsEl.addEventListener("dragstart", () => {
						draggedId = item.id;
						row.settingEl.addClass("is-dragging");
					});
					button.extraSettingsEl.addEventListener("dragend", () => {
						draggedId = null;
						row.settingEl.removeClass("is-dragging");
						clearDragOver();
					});
				});
				row.settingEl.addEventListener("dragover", (event) => {
					if (!draggedId || draggedId === item.id) return;
					event.preventDefault();
					row.settingEl.addClass("is-drag-over");
				});
				row.settingEl.addEventListener("dragleave", () => {
					row.settingEl.removeClass("is-drag-over");
				});
				row.settingEl.addEventListener("drop", (event) => {
					event.preventDefault();
					row.settingEl.removeClass("is-drag-over");
					const sourceId = draggedId;
					draggedId = null;
					if (!sourceId || sourceId === item.id) return;
					const fromIndex = control.items.findIndex(
						(candidate) => candidate.id === sourceId,
					);
					if (fromIndex < 0) return;
					this.dispatch(presentation, control.moveAction, {
						fromIndex,
						toIndex: index,
					});
				});
			}

			row.addExtraButton((button) => {
				button
					.setIcon("arrow-up")
					.setTooltip(control.tooltips.moveUp)
					.setDisabled(control.disabled || index === 0);
				button.onClick(() =>
					this.dispatch(presentation, control.moveAction, {
						fromIndex: index,
						toIndex: index - 1,
					}),
				);
			});
			row.addExtraButton((button) => {
				button
					.setIcon("arrow-down")
					.setTooltip(control.tooltips.moveDown)
					.setDisabled(control.disabled || index === control.items.length - 1);
				button.onClick(() =>
					this.dispatch(presentation, control.moveAction, {
						fromIndex: index,
						toIndex: index + 1,
					}),
				);
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
				nameInput.addEventListener("change", () =>
					this.dispatch(presentation, title.action, nameInput.value),
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
				if (field.description) fieldSetting.setDesc(this.renderContent(field.description));
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
		if (row.layout === "wide") setting.setClass("fc-profile-cards-setting");
		if (row.tone !== "neutral") setting.setClass(`fc-settings-tone-${row.tone}`);
		setting.setName(row.name);
		if (row.description) setting.setDesc(this.renderContent(row.description));
		for (const control of row.controls) this.renderControl(setting, control, presentation);
	}

	private dispatch(
		presentation: SettingsPresentation,
		action: SettingsActionRef<unknown>,
		value: unknown,
	): void {
		void presentation.invoke({ action, value }).then((result) => {
			if (result.status === "failed") console.error("Settings action failed:", result.error);
		});
	}

	private renderContent(content: SettingsContent): string | DocumentFragment {
		if (typeof content === "string") return content;
		const fragment = this.document.createDocumentFragment();
		const help = fragment.createDiv({ cls: "flashcard-help" });
		for (const block of content) {
			if (block.kind === "paragraph") help.createEl("p", { text: block.text });
			else if (block.kind === "code") {
				const codeBlock = help.createEl("pre");
				codeBlock.createEl("code").textContent = block.text;
			} else {
				const list = help.createEl("ul");
				for (const item of block.items) list.createEl("li", { text: item });
			}
		}
		return fragment;
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

			input.addEventListener("change", () => {
				options.onChange(index, input.value);
			});

			if (hasRemoveButton) {
				const removeBtn = item.createEl("button", {
					type: "button",
					text: "✕",
					cls: `fc-btn-remove ${options.removeButtonClass}`,
				});
				removeBtn.setAttr("aria-label", options.removeAriaLabel);
				removeBtn.disabled = options.disabled;
				removeBtn.addEventListener("click", () => {
					options.onRemove(index);
				});
			}
		});

		const addBtn = listContainer.createEl("button", {
			type: "button",
			text: options.addLabel,
			cls: `fc-btn-add ${options.addButtonClass}`,
		});
		addBtn.disabled = options.disabled;
		addBtn.addEventListener("click", () => {
			options.onAdd();
		});
	}
}

function settingsShortcutFromEvent(event: KeyboardEvent): string | null {
	if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
	const key =
		event.key === " " || event.key === "Spacebar"
			? "Space"
			: event.key === "+"
				? "Plus"
				: event.key === "-"
					? "Minus"
					: event.key.length === 1
						? event.key.toUpperCase()
						: event.key;
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
