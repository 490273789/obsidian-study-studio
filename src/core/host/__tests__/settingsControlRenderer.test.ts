import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { defineSettings } from "../../settings/presentation";
import { mountSettingsSorting } from "../settingsSorting";

vi.mock("../settingsSorting", () => ({ mountSettingsSorting: vi.fn(() => vi.fn()) }));

let renderSettingsControls: typeof import("../settingsControlRenderer").renderSettingsControls;

type Listener = (event: MockEvent) => void;

class MockEvent {
	defaultPrevented = false;
	propagationStopped = false;

	constructor(
		readonly key = "",
		readonly options: {
			code?: string;
			ctrlKey?: boolean;
			altKey?: boolean;
			shiftKey?: boolean;
			metaKey?: boolean;
		} = {},
	) {}

	get code(): string {
		return this.options.code ?? "";
	}

	get ctrlKey(): boolean {
		return this.options.ctrlKey ?? false;
	}
	get altKey(): boolean {
		return this.options.altKey ?? false;
	}
	get shiftKey(): boolean {
		return this.options.shiftKey ?? false;
	}
	get metaKey(): boolean {
		return this.options.metaKey ?? false;
	}

	preventDefault(): void {
		this.defaultPrevented = true;
	}

	stopPropagation(): void {
		this.propagationStopped = true;
	}
}

class MockClassList {
	private readonly values = new Set<string>();

	add(...classes: string[]): void {
		for (const value of classes) this.values.add(value);
	}
	remove(...classes: string[]): void {
		for (const value of classes) this.values.delete(value);
	}
	contains(value: string): boolean {
		return this.values.has(value);
	}
}

class MockElement {
	children: MockElement[] = [];
	parentElement: MockElement | null = null;
	classList = new MockClassList();
	listeners = new Map<string, Listener[]>();
	attributes = new Map<string, string>();
	style: Record<string, string> = {};
	textContent = "";
	value = "";
	disabled = false;
	checked = false;
	rows = 0;
	hidden = false;
	validationMessage = "";
	setCustomValidity(message: string) {
		this.validationMessage = message;
	}
	draggable = false;
	icon = "";
	ownerDocument: MockDocument;

	constructor(
		readonly tagName: string,
		document: MockDocument,
	) {
		this.ownerDocument = document;
	}

	addClass(...classes: string[]): this {
		for (const value of classes) {
			if (value.includes(" ")) {
				throw new Error(
					`Failed to execute 'add' on 'DOMTokenList': The token provided ('${value}') contains HTML space characters, which are not valid in tokens.`,
				);
			}
			this.classList.add(value);
		}
		return this;
	}
	removeClass(value: string): this {
		this.classList.remove(value);
		return this;
	}
	setAttr(name: string, value: string): this {
		this.attributes.set(name, value);
		return this;
	}
	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
	empty(): this {
		this.children = [];
		return this;
	}
	appendChild(child: MockElement): MockElement {
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	createDiv(options: { cls?: string; text?: string } = {}): MockElement {
		return this.createEl("div", options);
	}
	createSpan(options: { cls?: string; text?: string } = {}): MockElement {
		return this.createEl("span", options);
	}
	createEl(
		tagName: string,
		options: {
			cls?: string;
			text?: string;
			type?: string;
			value?: string;
			placeholder?: string;
		} = {},
	): MockElement {
		const child = new MockElement(tagName, this.ownerDocument);
		if (options.cls) child.addClasses(options.cls);
		if (options.text !== undefined) child.textContent = options.text;
		if (options.type) child.attributes.set("type", options.type);
		if (options.value !== undefined) child.value = options.value;
		if (options.placeholder !== undefined)
			child.attributes.set("placeholder", options.placeholder);
		return this.appendChild(child);
	}
	addEventListener(name: string, listener: Listener): void {
		this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
	}
	emit(name: string, event = new MockEvent()): MockEvent {
		for (const listener of this.listeners.get(name) ?? []) listener(event);
		return event;
	}
	click(): void {
		this.emit("click");
	}
	blur(): void {
		this.emit("blur");
	}
	querySelectorAll(selector: string): MockElement[] {
		return selector.startsWith(".")
			? findAll(this, (node) => node.classList.contains(selector.slice(1)))
			: [];
	}

	private addClasses(value: string): void {
		this.classList.add(...value.split(" ").filter(Boolean));
	}
}

class MockDocument {
	createdFragments = 0;

	createDocumentFragment(): MockElement {
		this.createdFragments += 1;
		return new MockElement("fragment", this);
	}
}

class MockValueComponent {
	get selectEl() {
		return this.inputEl;
	}
	get sliderEl() {
		return this.inputEl;
	}
	get toggleEl() {
		return this.inputEl;
	}
	constructor(
		readonly inputEl: MockElement,
		private readonly value: () => string | number | boolean,
	) {}

	setPlaceholder(value: string): this {
		this.inputEl.attributes.set("placeholder", value);
		return this;
	}
	setValue(value: string | number | boolean): this {
		if (typeof value === "boolean") this.inputEl.checked = value;
		else this.inputEl.value = String(value);
		return this;
	}
	setDisabled(value: boolean): this {
		this.inputEl.disabled = value;
		return this;
	}
	setLimits(): this {
		return this;
	}
	setTooltip(): this {
		return this;
	}
	addOption(): this {
		return this;
	}
	onChange(handler: (value: string | number | boolean) => void): this {
		this.inputEl.addEventListener("change", () => handler(this.value()));
		return this;
	}
	getValue(): string {
		return this.inputEl.value;
	}
}

class MockButtonComponent {
	constructor(readonly buttonEl: MockElement) {}

	setButtonText(value: string): this {
		this.buttonEl.textContent = value;
		return this;
	}
	setDisabled(value: boolean): this {
		this.buttonEl.disabled = value;
		return this;
	}
	setWarning(): this {
		return this;
	}
	setCta(): this {
		return this;
	}
	setIcon(value: string): this {
		this.buttonEl.icon = value;
		return this;
	}
	setTooltip(value: string): this {
		this.buttonEl.attributes.set("aria-label", value);
		return this;
	}
	onClick(handler: () => void): this {
		this.buttonEl.addEventListener("click", handler);
		return this;
	}
}

class MockSetting {
	settingEl: MockElement;
	nameEl: MockElement;
	descEl: MockElement;
	controlEl: MockElement;

	constructor(parent: MockElement) {
		this.settingEl = parent.createDiv({ cls: "setting-item" });
		this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
	}
	setClass(value: string): this {
		this.settingEl.addClass(value);
		return this;
	}
	setName(value: string): this {
		this.nameEl.textContent = value;
		return this;
	}
	setDesc(value: string | MockElement): this {
		if (typeof value === "string") this.descEl.textContent = value;
		else this.descEl.appendChild(value);
		return this;
	}
	setHeading(): this {
		this.settingEl.addClass("setting-item-heading");
		return this;
	}
	addButton(build: (component: MockButtonComponent) => void): this {
		build(new MockButtonComponent(this.controlEl.createEl("button", { type: "button" })));
		return this;
	}
	addExtraButton(
		build: (component: MockButtonComponent & { extraSettingsEl: MockElement }) => void,
	): this {
		const extraSettingsEl = this.controlEl.createEl("button", { type: "button" });
		const component = new MockButtonComponent(extraSettingsEl) as MockButtonComponent & {
			extraSettingsEl: MockElement;
		};
		component.extraSettingsEl = extraSettingsEl;
		build(component);
		return this;
	}
	addText(build: (component: MockValueComponent) => void): this {
		const input = this.controlEl.createEl("input", { cls: "mock-text" });
		build(new MockValueComponent(input, () => input.value));
		return this;
	}
	addTextArea(build: (component: MockValueComponent) => void): this {
		const input = this.controlEl.createEl("textarea", { cls: "mock-textarea" });
		build(new MockValueComponent(input, () => input.value));
		return this;
	}
	addDropdown(build: (component: MockValueComponent) => void): this {
		const input = this.controlEl.createEl("select", { cls: "mock-select" });
		build(new MockValueComponent(input, () => input.value));
		return this;
	}
	addSlider(build: (component: MockValueComponent) => void): this {
		const input = this.controlEl.createEl("input", { cls: "mock-slider" });
		build(new MockValueComponent(input, () => Number(input.value)));
		return this;
	}
	addToggle(build: (component: MockValueComponent) => void): this {
		const input = this.controlEl.createEl("input", { cls: "mock-toggle" });
		build(new MockValueComponent(input, () => input.checked));
		return this;
	}
}

class MockSecretComponent extends MockValueComponent {
	constructor(_app: unknown, parent: MockElement) {
		const input = parent.createEl("input", { cls: "mock-secret" });
		super(input, () => input.value);
	}
}

vi.doMock("obsidian", () => ({
	Setting: MockSetting,
	SecretComponent: MockSecretComponent,
}));

beforeAll(async () => {
	({ renderSettingsControls } = await import("../settingsControlRenderer"));
});

function findAll(root: MockElement, predicate: (node: MockElement) => boolean): MockElement[] {
	const matches = predicate(root) ? [root] : [];
	for (const child of root.children) matches.push(...findAll(child, predicate));
	return matches;
}

function one(root: MockElement, className: string): MockElement {
	const match = findAll(root, (node) => node.classList.contains(className))[0];
	if (!match) throw new Error(`Missing .${className}`);
	return match;
}

function named(root: MockElement, text: string): MockElement {
	const match = findAll(root, (node) => node.textContent === text)[0];
	if (!match) throw new Error(`Missing ${text}`);
	return match;
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

describe("renderSettingsControls", () => {
	it("accepts repeated precise edits including returning to the original value before saving finishes", async () => {
		const finishes: (() => void)[] = [];
		const changed = vi.fn(
			(_value: number) => new Promise<void>((resolve) => finishes.push(resolve)),
		);
		const build = () =>
			defineSettings("numbers", (page) =>
				page.group("limits", "Limits", (group) =>
					group.integer(
						"daily",
						{ name: "Daily limit" },
						{ value: 20, min: 1, max: 500, step: 1, onChange: changed },
					),
				),
			);
		const container = new MockElement("div", new MockDocument());
		renderSettingsControls({} as never, container as never, build());
		const input = one(container, "fc-settings-number-input");
		input.value = "30";
		input.emit("keydown", new MockEvent("Enter"));
		input.emit("change");
		expect(changed).toHaveBeenCalledTimes(1);
		input.value = "20";
		input.emit("change");
		expect(changed.mock.calls.map((call) => call[0])).toEqual([30, 20]);
		for (const finish of finishes) finish();
		await settle();
		const replacement = new MockElement("div", new MockDocument());
		renderSettingsControls({} as never, replacement as never, build());
		expect(
			one(replacement, "fc-settings-number-input").attributes.get("data-settings-focus"),
		).toBe(input.attributes.get("data-settings-focus"));
	});
	it("keeps a precise number draft while typing and blocks empty, fractional and out-of-range submissions", async () => {
		const changed = vi.fn();
		const presentation = defineSettings("numbers", (page) => {
			page.group("limits", "Limits", (group) =>
				group.integer(
					"daily",
					{ name: "Daily limit" },
					{ value: 20, min: 1, max: 500, step: 1, onChange: changed },
				),
			);
		});
		const container = new MockElement("div", new MockDocument());
		renderSettingsControls({} as never, container as never, presentation);
		const input = one(container, "fc-settings-number-input");
		input.value = "101";
		input.emit("input");
		expect(changed).not.toHaveBeenCalled();
		for (const value of ["", "0", "501", "1.5"]) {
			input.value = value;
			input.emit("change");
			expect(input.attributes.get("aria-invalid")).toBe("true");
			expect(input.validationMessage).toContain("1–500");
		}
		await settle();
		expect(changed).not.toHaveBeenCalled();
		input.value = "101";
		input.emit("keydown", new MockEvent("Enter"));
		await settle();
		expect(changed).toHaveBeenCalledWith(101);
		expect(input.attributes.get("aria-invalid")).toBe("false");
		expect(one(container, "fc-settings-input-error").hidden).toBe(true);
	});

	it("reports action failures accessibly and ignores late feedback after disposal", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
		let fail!: (error: Error) => void;
		const presentation = defineSettings("actions", (page) => {
			page.group("general", "General", (group) =>
				group.button(
					"save",
					{ name: "Save" },
					{
						label: "Run",
						onPress: () =>
							new Promise<void>((_resolve, reject) => {
								fail = reject;
							}),
					},
				),
			);
		});
		const container = new MockElement("div", new MockDocument());
		const dispose = renderSettingsControls({} as never, container as never, presentation);
		named(container, "Run").click();
		fail(new Error("unavailable"));
		await settle();
		expect(one(container, "fc-settings-action-error").attributes.get("role")).toBe("alert");
		expect(one(container, "fc-settings-action-error").textContent).toContain("重试");
		named(container, "Run").click();
		dispose();
		const oldMessage = one(container, "fc-settings-action-error").textContent;
		fail(new Error("late failure"));
		await settle();
		expect(one(container, "fc-settings-action-error").textContent).toBe(oldMessage);
		log.mockRestore();
	});
	it("connects dictionary drag sorting to presentation actions and releases the binding", async () => {
		const moved = vi.fn();
		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.reorderable(
					"sources",
					{ name: "Sources" },
					{
						allowDrag: true,
						items: ["first", "second"].map((id) => ({
							id,
							label: id,
							kindLabel: "Local",
							enabled: true,
							onToggle: vi.fn(),
						})),
						onMove: moved,
						tooltips: { drag: "Drag", moveUp: "Up", moveDown: "Down" },
					},
				);
			});
		});
		const container = new MockElement("div", new MockDocument());
		const dispose = renderSettingsControls({} as never, container as never, presentation, "en");
		const call =
			vi.mocked(mountSettingsSorting).mock.calls[
				vi.mocked(mountSettingsSorting).mock.calls.length - 1
			]!;
		expect(call[1].map((row) => row.id)).toEqual(["first", "second"]);
		expect(call[2]).toBe("en");
		call[3].move("first", "second");
		await settle();
		expect(moved).toHaveBeenCalledExactlyOnceWith(0, 1);
		presentation.dispose();
		call[3].move("second", "first");
		await settle();
		expect(moved).toHaveBeenCalledTimes(1);
		const unmount =
			vi.mocked(mountSettingsSorting).mock.results[
				vi.mocked(mountSettingsSorting).mock.results.length - 1
			]!.value;
		dispose();
		dispose();
		expect(unmount).toHaveBeenCalledTimes(1);
	});

	it.each(["drag", "button"] as const)(
		"shares the pending lock between native move buttons and %s input",
		async (firstInput) => {
			let complete!: () => void;
			const moved = vi.fn(
				() =>
					new Promise<void>((resolve) => {
						complete = resolve;
					}),
			);
			const presentation = defineSettings("example", (page) => {
				page.group("general", "General", (group) => {
					group.reorderable(
						"sources",
						{ name: "Sources" },
						{
							allowDrag: true,
							items: ["first", "second"].map((id) => ({
								id,
								label: id,
								kindLabel: "Local",
								enabled: true,
								onToggle: vi.fn(),
							})),
							onMove: moved,
							tooltips: { drag: "Drag", moveUp: "Up", moveDown: "Down" },
						},
					);
				});
			});
			const container = new MockElement("div", new MockDocument());
			const dispose = renderSettingsControls({} as never, container as never, presentation);
			const calls = vi.mocked(mountSettingsSorting).mock.calls;
			const sorting = calls[calls.length - 1]![3];
			const down = findAll(container, (node) => node.icon === "arrow-down")[0]!;
			const up = findAll(container, (node) => node.icon === "arrow-up")[1]!;
			if (firstInput === "drag") {
				sorting.beginDrag("first");
				sorting.drop("first", "second");
			} else down.click();
			expect(down.disabled).toBe(true);
			expect(up.disabled).toBe(true);
			// Deliberately dispatch the old callbacks even though native buttons are disabled.
			up.click();
			sorting.beginDrag("second");
			sorting.drop("second", "first");
			expect(moved).toHaveBeenCalledExactlyOnceWith(0, 1);
			complete();
			await settle();
			expect(down.disabled).toBe(false);
			expect(up.disabled).toBe(false);
			dispose();
			up.click();
			expect(moved).toHaveBeenCalledTimes(1);
		},
	);

	it.each([
		{ allowDrag: false, disabled: false, count: 2 },
		{ allowDrag: true, disabled: true, count: 2 },
		{ allowDrag: true, disabled: false, count: 1 },
	])("does not mount sorting for an unavailable list: %j", ({ allowDrag, disabled, count }) => {
		vi.mocked(mountSettingsSorting).mockClear();
		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.reorderable(
					"sources",
					{ name: "Sources" },
					{
						allowDrag,
						disabled,
						items: ["first", "second"].slice(0, count).map((id) => ({
							id,
							label: id,
							kindLabel: "Local",
							enabled: true,
							onToggle: vi.fn(),
						})),
						onMove: vi.fn(),
						tooltips: { drag: "Drag", moveUp: "Up", moveDown: "Down" },
					},
				);
			});
		});
		renderSettingsControls(
			{} as never,
			new MockElement("div", new MockDocument()) as never,
			presentation,
		);
		expect(mountSettingsSorting).not.toHaveBeenCalled();
	});

	it("renders settings controls and forwards their changed values through the presentation", async () => {
		const changed = {
			text: vi.fn(),
			textarea: vi.fn(),
			toggle: vi.fn(),
			select: vi.fn(),
			slider: vi.fn(),
			integer: vi.fn(),
			button: vi.fn(),
		};
		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.text("text", { name: "Text" }, { value: "old", onChange: changed.text });
				group.textarea(
					"textarea",
					{ name: "Textarea" },
					{ value: "old", onChange: changed.textarea },
				);
				group.toggle(
					"toggle",
					{ name: "Toggle" },
					{ value: false, onChange: changed.toggle },
				);
				group.select(
					"select",
					{ name: "Select" },
					{
						value: "one",
						options: [
							{ value: "one", label: "One" },
							{ value: "two", label: "Two" },
						],
						onChange: changed.select,
					},
				);
				group.slider(
					"slider",
					{ name: "Slider" },
					{ value: 2, min: 0, max: 5, step: 1, onChange: changed.slider },
				);
				group.integer(
					"integer",
					{ name: "Integer" },
					{ value: 2, min: 0, max: 5, step: 1, onChange: changed.integer },
				);
				group.button(
					"button",
					{ name: "Button" },
					{ label: "Run", onPress: changed.button },
				);
			});
		});
		const document = new MockDocument();
		const container = new MockElement("div", document);

		renderSettingsControls({} as never, container as never, presentation);
		expect(
			named(container, "General").parentElement?.classList.contains("setting-item-heading"),
		).toBe(true);

		const [text, integer] = findAll(container, (node) => node.classList.contains("mock-text"));
		text!.value = "new text";
		text!.emit("change");
		one(container, "mock-textarea").value = "new textarea";
		one(container, "mock-textarea").emit("change");
		one(container, "mock-toggle").checked = true;
		one(container, "mock-toggle").emit("change");
		one(container, "mock-select").value = "two";
		one(container, "mock-select").emit("change");
		one(container, "mock-slider").value = "3";
		one(container, "mock-slider").emit("change");
		integer!.value = "4";
		integer!.emit("change");
		const runBtn = named(container, "Run");
		expect(runBtn.classList.contains("flashcard-btn")).toBe(true);
		expect(runBtn.classList.contains("flashcard-btn-neutral")).toBe(true);
		runBtn.click();
		await settle();

		expect(changed.text).toHaveBeenCalledWith("new text");
		expect(changed.textarea).toHaveBeenCalledWith("new textarea");
		expect(changed.toggle).toHaveBeenCalledWith(true);
		expect(changed.select).toHaveBeenCalledWith("two");
		expect(changed.slider).toHaveBeenCalledWith(3);
		expect(changed.integer).toHaveBeenCalledWith(4);
		expect(changed.button).toHaveBeenCalledOnce();
	});

	it("leaves disabled interactions to the presentation and rejects events from a disposed generation", async () => {
		const onPress = vi.fn();
		const onChange = vi.fn();
		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.button(
					"disabled",
					{ name: "Disabled" },
					{ label: "Disabled action", disabled: true, onPress },
				);
				group.text("text", { name: "Text" }, { value: "old", onChange });
			});
		});
		const container = new MockElement("div", new MockDocument());
		renderSettingsControls({} as never, container as never, presentation);

		const disabled = named(container, "Disabled action");
		expect(disabled.disabled).toBe(true);
		disabled.click();
		await settle();
		expect(onPress).not.toHaveBeenCalled();

		presentation.dispose();
		one(container, "mock-text").value = "stale";
		one(container, "mock-text").emit("change");
		await settle();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("renders the remaining supported controls", () => {
		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.secret(
					"secret",
					{ name: "Secret" },
					{ value: "token", onChange: () => undefined },
				);
				group.status("status", { name: "Status" }, "Ready");
				group.editableList(
					"list",
					{ name: "List" },
					{
						values: ["one", "two"],
						placeholder: "Value",
						addLabel: "Add",
						removeAriaLabel: "Remove value",
						onChange: () => undefined,
						onAdd: () => undefined,
						onRemove: () => undefined,
					},
				);
				group.choiceButtons(
					"choices",
					{ name: "Choices" },
					{
						value: "one",
						choices: [
							{ id: "one", label: "Choose one" },
							{ id: "two", label: "Choose two" },
						],
						emptyText: "No choices",
						onChoose: () => undefined,
					},
				);
			});
		});
		const container = new MockElement("div", new MockDocument());

		renderSettingsControls({} as never, container as never, presentation);

		expect(one(container, "mock-secret").value).toBe("token");
		expect(named(container, "Ready").classList.contains("flashcard-settings-status")).toBe(
			true,
		);
		expect(named(container, "Add").classList.contains("fc-btn-add")).toBe(true);
		expect(named(container, "Add").classList.contains("flashcard-btn")).toBe(true);
		expect(named(container, "Add").classList.contains("flashcard-btn-secondary")).toBe(true);
		const chosen = named(container, "Choose one");
		expect(chosen.classList.contains("flashcard-tag-button")).toBe(true);
		expect(chosen.classList.contains("flashcard-btn")).toBe(true);
		expect(chosen.classList.contains("flashcard-btn-outline")).toBe(true);
		expect(chosen.classList.contains("active")).toBe(true);
		expect(chosen.classList.contains("is-active")).toBe(true);
		expect(chosen.attributes.get("aria-pressed")).toBe("true");

		const unchosen = named(container, "Choose two");
		expect(unchosen.classList.contains("active")).toBe(false);
		expect(unchosen.classList.contains("is-active")).toBe(false);
		expect(unchosen.attributes.get("aria-pressed")).toBe("false");
		const removeBtn = one(container, "fc-btn-remove");
		expect(removeBtn.classList.contains("flashcard-btn")).toBe(true);
		expect(removeBtn.textContent).toBe("Remove value");
		expect(removeBtn.classList.contains("flashcard-btn-ghost")).toBe(true);
	});

	it("captures valid keybindings while cancelling Escape and reporting conflicts", async () => {
		const onChange = vi.fn();
		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.keybinding(
					"shortcut",
					{ name: "Shortcut" },
					{
						value: "",
						emptyLabel: "None",
						recordingLabel: "Recording",
						conflictMessage: "Already used",
						unavailableValues: ["Ctrl+K"],
						conflictMessages: { "Ctrl+K": "Used by Flashcards" },
						onChange,
					},
				);
			});
		});
		const container = new MockElement("div", new MockDocument());
		renderSettingsControls({} as never, container as never, presentation);
		const capture = one(container, "fc-keybinding-capture");

		capture.emit("focus");
		expect(capture.textContent).toBe("Recording");
		const escape = capture.emit("keydown", new MockEvent("Escape"));
		expect(escape.defaultPrevented).toBe(true);
		expect(onChange).not.toHaveBeenCalled();

		capture.emit("focus");
		const conflict = capture.emit("keydown", new MockEvent("k", { ctrlKey: true }));
		expect(conflict.defaultPrevented).toBe(true);
		expect(one(container, "fc-keybinding-error").textContent).toBe("Used by Flashcards");
		expect(capture.classList.contains("has-error")).toBe(true);

		const valid = capture.emit("keydown", new MockEvent("p", { ctrlKey: true }));
		expect(valid.defaultPrevented).toBe(true);
		await settle();
		expect(onChange).toHaveBeenCalledWith("Ctrl+P");
		expect(capture.textContent).toBe("None");
		expect(capture.classList.contains("has-error")).toBe(false);

		capture.emit("focus");
		capture.emit("keydown", new MockEvent("™", { altKey: true, code: "Digit2" }));
		await settle();
		expect(onChange).toHaveBeenLastCalledWith("Alt+2");
	});

	it("renders cards, reorderable actions, and rich content with the container document", async () => {
		const renamed = vi.fn();
		const changedField = vi.fn();
		const movedCard = vi.fn();
		const movedSource = vi.fn();
		const toggledSource = vi.fn();
		const presentation = defineSettings("example", (page) => {
			page.group("general", "General", (group) => {
				group.cards(
					"profiles",
					{ name: "Profiles" },
					{
						items: [
							{
								key: "one",
								badge: "1",
								enabled: true,
								build(card) {
									card.title("title", { value: "Profile", onChange: renamed });
									card.action("move", {
										label: "Move",
										icon: "move-up",
										onPress: movedCard,
									});
									card.field(
										"field",
										{
											name: "Help",
											description: [
												{ kind: "paragraph", text: "Owned document" },
											],
										},
										(field) =>
											field.text("value", {
												value: "old field",
												onChange: changedField,
											}),
									);
								},
							},
						],
					},
				);
				group.reorderable(
					"sources",
					{ name: "Sources" },
					{
						allowDrag: false,
						items: [
							{
								id: "first",
								label: "First",
								kindLabel: "Local",
								enabled: true,
								onToggle: toggledSource,
							},
							{
								id: "second",
								label: "Second",
								kindLabel: "Online",
								enabled: false,
								onToggle: vi.fn(),
							},
						],
						onMove: movedSource,
						tooltips: { drag: "Drag", moveUp: "Up", moveDown: "Down" },
					},
				);
			});
		});
		const document = new MockDocument();
		const unrelatedDocument = new MockDocument();
		const container = new MockElement("div", document);
		vi.stubGlobal("activeDocument", unrelatedDocument);
		try {
			renderSettingsControls({} as never, container as never, presentation);
		} finally {
			vi.unstubAllGlobals();
		}
		expect(named(container, "Owned document").ownerDocument).toBe(document);
		expect(named(container, "Owned document").ownerDocument).not.toBe(unrelatedDocument);
		expect(named(container, "Owned document").tagName).toBe("p");

		const card = one(container, "fc-profile-card");
		const title = one(card, "fc-profile-name-input");
		title.value = "Renamed";
		title.emit("change");
		one(card, "mock-text").value = "Changed field";
		one(card, "mock-text").emit("change");
		findAll(card, (node) => node.icon === "arrow-up")[0]!.click();

		const sourceRows = findAll(container, (node) =>
			node.classList.contains("flashcard-dictionary-source-row"),
		);
		findAll(sourceRows[0]!, (node) => node.icon === "arrow-down")[0]!.click();
		one(sourceRows[0]!, "mock-toggle").checked = false;
		one(sourceRows[0]!, "mock-toggle").emit("change");
		await settle();

		expect(renamed).toHaveBeenCalledWith("Renamed");
		expect(changedField).toHaveBeenCalledWith("Changed field");
		expect(movedCard).toHaveBeenCalledOnce();
		expect(movedSource).toHaveBeenCalledWith(0, 1);
		expect(toggledSource).toHaveBeenCalledWith(false);
	});

	it("suppresses redundant first heading when matching section title", () => {
		const presentation = defineSettings("example", (page) => {
			page.group("dictionary", "英语字典", (group) => {
				group.toggle("enabled", { name: "启用" }, { value: true, onChange: vi.fn() });
			});
			page.group("categories", "保存分类", (group) => {
				group.button("new", { name: "新建" }, { label: "新建", onPress: vi.fn() });
			});
		});
		const container = new MockElement("div", new MockDocument());
		renderSettingsControls({} as never, container as never, presentation, "zh", {
			redundantHeading: "英语字典",
		});

		const firstHeading = named(container, "英语字典").parentElement;
		expect(firstHeading?.classList.contains("setting-item-heading")).toBe(true);
		expect(firstHeading?.classList.contains("fc-heading-redundant")).toBe(true);

		const secondHeading = named(container, "保存分类").parentElement;
		expect(secondHeading?.classList.contains("setting-item-heading")).toBe(true);
		expect(secondHeading?.classList.contains("fc-heading-redundant")).toBe(false);
	});

	it("renders row structured description directly into descEl without document fragments", () => {
		const presentation = defineSettings("example", (page) => {
			page.group("help", "Help", (group) => {
				group.row("usage", {
					name: "Card format and shortcuts",
					description: [
						{ kind: "paragraph", text: "Format:" },
						{ kind: "code", text: "Front :: Back" },
						{ kind: "paragraph", text: "Shortcuts:" },
						{ kind: "list", items: ["Space: Show", "1: Again"] },
					],
				});
			});
		});
		const container = new MockElement("div", new MockDocument());
		renderSettingsControls({} as never, container as never, presentation);

		const nameEl = named(container, "Card format and shortcuts");
		expect(nameEl.tagName).toBe("div");
		const help = one(container, "flashcard-help");
		expect(named(help, "Format:").tagName).toBe("p");
		const code = findAll(help, (node) => node.tagName === "code")[0]!;
		expect(code.textContent).toBe("Front :: Back");
		expect(named(help, "Shortcuts:").tagName).toBe("p");
		const listItems = findAll(help, (node) => node.tagName === "li");
		expect(listItems.map((li) => li.textContent)).toEqual(["Space: Show", "1: Again"]);
	});
});
