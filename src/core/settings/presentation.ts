/** Renderer-neutral settings presentation with one action seam for every settings section. */

export type SettingsActionResult = void | Promise<void>;

export type SettingsTone = "neutral" | "primary" | "warning" | "danger";
export type SettingsLayout = "standard" | "wide";

export type SettingsContent = string | readonly SettingsContentBlock[];

export type SettingsContentBlock =
	| { kind: "paragraph"; text: string }
	| { kind: "code"; text: string }
	| { kind: "list"; items: readonly string[] };

export interface SettingsActionRef<T = void> {
	readonly id: string;
	/** Phantom payload type; action references contain no callback. */
	readonly __payload?: T;
}

export interface SettingsRowCopy {
	name: string;
	description?: SettingsContent;
	layout?: SettingsLayout;
	tone?: SettingsTone;
	visible?: boolean;
}

interface SettingsControlState {
	key: string;
	disabled: boolean;
}

export interface SettingsButtonSnapshot extends SettingsControlState {
	kind: "button";
	label: string;
	action: SettingsActionRef;
	tone: SettingsTone;
	icon?: "move-up" | "move-down" | "remove";
}

export interface SettingsToggleSnapshot extends SettingsControlState {
	kind: "toggle";
	value: boolean;
	action: SettingsActionRef<boolean>;
	tooltip?: string;
}

export interface SettingsSelectOption {
	value: string;
	label: string;
}

export interface SettingsSelectSnapshot extends SettingsControlState {
	kind: "select";
	value: string;
	options: readonly SettingsSelectOption[];
	action: SettingsActionRef<string>;
}

export interface SettingsTextSnapshot extends SettingsControlState {
	kind: "text" | "textarea" | "secret";
	value: string;
	placeholder: string;
	action: SettingsActionRef<string>;
}

export interface SettingsNumberSnapshot extends SettingsControlState {
	kind: "slider" | "integer";
	value: number;
	min: number;
	max: number;
	step: number;
	action: SettingsActionRef<number>;
}

export interface SettingsStatusSnapshot extends SettingsControlState {
	kind: "status";
	text: string;
}

export interface SettingsEditableListSnapshot extends SettingsControlState {
	kind: "editableList";
	values: readonly string[];
	placeholder: string;
	addLabel: string;
	removeAriaLabel: string;
	changeAction: SettingsActionRef<{ index: number; value: string }>;
	addAction: SettingsActionRef;
	removeAction: SettingsActionRef<number>;
}

export interface SettingsChoiceButtonsSnapshot extends SettingsControlState {
	kind: "choiceButtons";
	choices: readonly { id: string; label: string }[];
	emptyText: string;
	action: SettingsActionRef<string>;
}

export interface SettingsReorderableItemSnapshot {
	id: string;
	label: string;
	description?: string;
	kindLabel: string;
	enabled: boolean;
	toggleAction: SettingsActionRef<boolean>;
}

export interface SettingsReorderableSnapshot extends SettingsControlState {
	kind: "reorderable";
	allowDrag: boolean;
	emptyText?: string;
	items: readonly SettingsReorderableItemSnapshot[];
	moveAction: SettingsActionRef<{ fromIndex: number; toIndex: number }>;
	removeAction?: SettingsActionRef<string>;
	tooltips: { drag: string; moveDown: string; moveUp: string; remove?: string };
}

export interface SettingsCardFieldSnapshot {
	key: string;
	name: string;
	description?: SettingsContent;
	controls: readonly SettingsPrimitiveControlSnapshot[];
}

export interface SettingsCardSnapshot {
	key: string;
	badge: string;
	enabled: boolean;
	title?: SettingsTextSnapshot;
	toggle?: SettingsToggleSnapshot;
	actions: readonly SettingsButtonSnapshot[];
	fields: readonly SettingsCardFieldSnapshot[];
}

export interface SettingsCardsSnapshot extends SettingsControlState {
	kind: "cards";
	emptyText?: string;
	items: readonly SettingsCardSnapshot[];
}

export type SettingsPrimitiveControlSnapshot =
	| SettingsButtonSnapshot
	| SettingsToggleSnapshot
	| SettingsSelectSnapshot
	| SettingsTextSnapshot
	| SettingsNumberSnapshot
	| SettingsStatusSnapshot;

export type SettingsControlSnapshot =
	| SettingsPrimitiveControlSnapshot
	| SettingsEditableListSnapshot
	| SettingsChoiceButtonsSnapshot
	| SettingsReorderableSnapshot
	| SettingsCardsSnapshot;

export interface SettingsRowSnapshot {
	key: string;
	name: string;
	description?: SettingsContent;
	layout: SettingsLayout;
	tone: SettingsTone;
	controls: readonly SettingsControlSnapshot[];
}

export interface SettingsGroupSnapshot {
	key: string;
	heading: string;
	rows: readonly SettingsRowSnapshot[];
}

export interface SettingsSnapshot {
	sectionId: string;
	generation: number;
	groups: readonly SettingsGroupSnapshot[];
}

export interface SettingsInteraction {
	action: SettingsActionRef<unknown>;
	value: unknown;
}

export type SettingsDispatchResult =
	| { status: "applied" }
	| { status: "ignored"; reason: "disabled" | "stale" }
	| { status: "failed"; error: SettingsPresentationError };

export type SettingsPresentationErrorCode =
	| "duplicate-key"
	| "invalid-definition"
	| "invalid-interaction"
	| "action-failed";

export class SettingsPresentationError extends Error {
	constructor(
		readonly code: SettingsPresentationErrorCode,
		message: string,
		readonly path?: string,
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "SettingsPresentationError";
	}
}

export interface SettingsPresentation {
	readonly snapshot: SettingsSnapshot;
	invoke(interaction: SettingsInteraction): Promise<SettingsDispatchResult>;
	dispose(): void;
}

interface ActionEntry {
	disabled: boolean;
	parse(value: unknown): unknown;
	run(value: unknown): SettingsActionResult;
}

export interface SettingsValueSpec<T> {
	value: T;
	disabled?: boolean;
	onChange(value: T): SettingsActionResult;
}

export interface SettingsTextSpec extends SettingsValueSpec<string> {
	placeholder?: string;
}

export interface SettingsSelectSpec<T extends string = string> extends SettingsValueSpec<T> {
	options: readonly { value: T; label: string }[];
	missingValueLabel?: string;
}

export interface SettingsNumberSpec extends SettingsValueSpec<number> {
	min: number;
	max: number;
	step: number;
}

export interface SettingsButtonSpec {
	label: string;
	disabled?: boolean;
	tone?: SettingsTone;
	icon?: SettingsButtonSnapshot["icon"];
	onPress(): SettingsActionResult;
}

export interface SettingsEditableListSpec {
	values: readonly string[];
	placeholder: string;
	addLabel: string;
	removeAriaLabel: string;
	disabled?: boolean;
	onChange(index: number, value: string): SettingsActionResult;
	onAdd(): SettingsActionResult;
	onRemove(index: number): SettingsActionResult;
}

export interface SettingsChoiceButtonsSpec {
	choices: readonly { id: string; label: string }[];
	emptyText: string;
	disabled?: boolean;
	onChoose(id: string): SettingsActionResult;
}

export interface SettingsReorderableSpec {
	allowDrag: boolean;
	emptyText?: string;
	disabled?: boolean;
	items: readonly {
		id: string;
		label: string;
		description?: string;
		kindLabel: string;
		enabled: boolean;
		onToggle(enabled: boolean): SettingsActionResult;
	}[];
	onMove(fromIndex: number, toIndex: number): SettingsActionResult;
	onRemove?: (id: string) => SettingsActionResult;
	tooltips: { drag: string; moveDown: string; moveUp: string; remove?: string };
}

export interface SettingsCardSpec {
	key: string;
	badge: string;
	enabled: boolean;
	build(card: SettingsCardBuilder): void;
}

export interface SettingsCardsSpec {
	emptyText?: string;
	disabled?: boolean;
	items: readonly SettingsCardSpec[];
}

export interface SettingsPageBuilder {
	group(
		key: string,
		heading: string,
		build: (group: SettingsGroupBuilder) => void,
		options?: { visible?: boolean },
	): void;
}

export interface SettingsGroupBuilder {
	row(key: string, copy: SettingsRowCopy, build?: (row: SettingsRowBuilder) => void): void;
	button(key: string, copy: SettingsRowCopy, spec: SettingsButtonSpec): void;
	toggle(key: string, copy: SettingsRowCopy, spec: SettingsValueSpec<boolean>): void;
	select<T extends string>(key: string, copy: SettingsRowCopy, spec: SettingsSelectSpec<T>): void;
	text(key: string, copy: SettingsRowCopy, spec: SettingsTextSpec): void;
	textarea(key: string, copy: SettingsRowCopy, spec: SettingsTextSpec): void;
	secret(key: string, copy: SettingsRowCopy, spec: SettingsTextSpec): void;
	slider(key: string, copy: SettingsRowCopy, spec: SettingsNumberSpec): void;
	integer(key: string, copy: SettingsRowCopy, spec: SettingsNumberSpec): void;
	status(key: string, copy: SettingsRowCopy, text: string): void;
	editableList(key: string, copy: SettingsRowCopy, spec: SettingsEditableListSpec): void;
	choiceButtons(key: string, copy: SettingsRowCopy, spec: SettingsChoiceButtonsSpec): void;
	reorderable(key: string, copy: SettingsRowCopy, spec: SettingsReorderableSpec): void;
	cards(key: string, copy: SettingsRowCopy, spec: SettingsCardsSpec): void;
}

export interface SettingsRowBuilder {
	button(key: string, spec: SettingsButtonSpec): void;
	toggle(key: string, spec: SettingsValueSpec<boolean> & { tooltip?: string }): void;
	select<T extends string>(key: string, spec: SettingsSelectSpec<T>): void;
	text(key: string, spec: SettingsTextSpec): void;
	textarea(key: string, spec: SettingsTextSpec): void;
	secret(key: string, spec: SettingsTextSpec): void;
	slider(key: string, spec: SettingsNumberSpec): void;
	integer(key: string, spec: SettingsNumberSpec): void;
	status(key: string, text: string): void;
	editableList(key: string, spec: SettingsEditableListSpec): void;
	choiceButtons(key: string, spec: SettingsChoiceButtonsSpec): void;
}

export interface SettingsCardBuilder {
	title(key: string, spec: SettingsTextSpec): void;
	toggle(key: string, spec: SettingsValueSpec<boolean> & { tooltip?: string }): void;
	action(key: string, spec: SettingsButtonSpec): void;
	field(
		key: string,
		copy: Omit<SettingsRowCopy, "layout" | "tone" | "visible">,
		build: (row: SettingsRowBuilder) => void,
	): void;
}

let nextGeneration = 1;

/** Encodes a domain identity for use as one stable composer key segment. */
export function settingsKey(value: string): string {
	return encodeURIComponent(value);
}

export function defineSettings(
	sectionId: string,
	build: (page: SettingsPageBuilder) => void,
): SettingsPresentation {
	assertKey(sectionId, sectionId);
	const actions = new Map<string, ActionEntry>();
	const groups: SettingsGroupSnapshot[] = [];
	const groupKeys = new Set<string>();
	const generation = nextGeneration++;

	const page: SettingsPageBuilder = {
		group(key, heading, buildGroup, options) {
			if (options?.visible === false) return;
			assertUniqueKey(groupKeys, key, sectionId);
			const rows: SettingsRowSnapshot[] = [];
			const composer = new GroupComposer(`${sectionId}@${generation}/${key}`, rows, actions);
			buildGroup(composer);
			if (rows.length > 0) groups.push({ key, heading, rows });
		},
	};

	build(page);
	const snapshot = deepFreeze({ sectionId, generation, groups });
	let active = true;

	return {
		snapshot,
		async invoke(interaction) {
			if (!active) return { status: "ignored", reason: "stale" };
			const actionId = readActionId(interaction);
			if (!actionId) {
				return {
					status: "failed",
					error: new SettingsPresentationError(
						"invalid-interaction",
						"Settings interaction requires an action reference",
					),
				};
			}
			const entry = actions.get(actionId);
			if (!entry) {
				return {
					status: "failed",
					error: new SettingsPresentationError(
						"invalid-interaction",
						`Unknown settings action: ${actionId}`,
						actionId,
					),
				};
			}
			if (entry.disabled) return { status: "ignored", reason: "disabled" };
			try {
				const value = entry.parse(interaction.value);
				await entry.run(value);
				return { status: "applied" };
			} catch (error) {
				return {
					status: "failed",
					error:
						error instanceof SettingsPresentationError
							? error
							: new SettingsPresentationError(
									"action-failed",
									`Settings action failed: ${actionId}`,
									actionId,
									error,
								),
				};
			}
		},
		dispose() {
			active = false;
			actions.clear();
		},
	};
}

class GroupComposer implements SettingsGroupBuilder {
	private readonly keys = new Set<string>();

	constructor(
		private readonly path: string,
		private readonly rows: SettingsRowSnapshot[],
		private readonly actions: Map<string, ActionEntry>,
	) {}

	row(key: string, copy: SettingsRowCopy, build?: (row: SettingsRowBuilder) => void): void {
		if (copy.visible === false) return;
		assertUniqueKey(this.keys, key, this.path);
		const controls: SettingsControlSnapshot[] = [];
		build?.(new RowComposer(`${this.path}/${key}`, controls, this.actions));
		this.rows.push({
			key,
			name: copy.name,
			description: copy.description,
			layout: copy.layout ?? "standard",
			tone: copy.tone ?? "neutral",
			controls,
		});
	}

	button(key: string, copy: SettingsRowCopy, spec: SettingsButtonSpec): void {
		this.row(key, copy, (row) => row.button("control", spec));
	}
	toggle(key: string, copy: SettingsRowCopy, spec: SettingsValueSpec<boolean>): void {
		this.row(key, copy, (row) => row.toggle("control", spec));
	}
	select<T extends string>(
		key: string,
		copy: SettingsRowCopy,
		spec: SettingsSelectSpec<T>,
	): void {
		this.row(key, copy, (row) => row.select("control", spec));
	}
	text(key: string, copy: SettingsRowCopy, spec: SettingsTextSpec): void {
		this.row(key, copy, (row) => row.text("control", spec));
	}
	textarea(key: string, copy: SettingsRowCopy, spec: SettingsTextSpec): void {
		this.row(key, copy, (row) => row.textarea("control", spec));
	}
	secret(key: string, copy: SettingsRowCopy, spec: SettingsTextSpec): void {
		this.row(key, copy, (row) => row.secret("control", spec));
	}
	slider(key: string, copy: SettingsRowCopy, spec: SettingsNumberSpec): void {
		this.row(key, copy, (row) => row.slider("control", spec));
	}
	integer(key: string, copy: SettingsRowCopy, spec: SettingsNumberSpec): void {
		this.row(key, copy, (row) => row.integer("control", spec));
	}
	status(key: string, copy: SettingsRowCopy, text: string): void {
		this.row(key, copy, (row) => row.status("control", text));
	}

	editableList(key: string, copy: SettingsRowCopy, spec: SettingsEditableListSpec): void {
		this.row(key, copy, (row) => row.editableList("control", spec));
	}

	choiceButtons(key: string, copy: SettingsRowCopy, spec: SettingsChoiceButtonsSpec): void {
		this.row(key, copy, (row) => row.choiceButtons("control", spec));
	}

	reorderable(key: string, copy: SettingsRowCopy, spec: SettingsReorderableSpec): void {
		assertUniqueValues(
			spec.items.map((item) => item.id),
			`${this.path}/${key}`,
		);
		if (spec.onRemove && !spec.tooltips.remove) {
			definitionError("A removable list requires a remove tooltip", `${this.path}/${key}`);
		}
		this.complexRow(key, copy, () => {
			const path = `${this.path}/${key}/control`;
			const disabled = spec.disabled ?? false;
			const itemIds = new Set(spec.items.map((item) => item.id));
			const items = spec.items.map((item) => ({
				id: item.id,
				label: item.label,
				description: item.description,
				kindLabel: item.kindLabel,
				enabled: item.enabled,
				toggleAction: registerAction(
					this.actions,
					`${path}/item/${settingsKey(item.id)}:toggle`,
					disabled,
					parseBoolean,
					(value) => item.onToggle(value),
				),
			}));
			return {
				kind: "reorderable",
				key: "control",
				disabled,
				allowDrag: spec.allowDrag,
				emptyText: spec.emptyText,
				items,
				moveAction: registerAction(
					this.actions,
					`${path}:move`,
					disabled,
					(value) => parseMove(value, spec.items.length),
					(value) => spec.onMove(value.fromIndex, value.toIndex),
				),
				removeAction: spec.onRemove
					? registerAction(
							this.actions,
							`${path}:remove`,
							disabled,
							stringIn(itemIds),
							(value) => spec.onRemove?.(value),
						)
					: undefined,
				tooltips: spec.tooltips,
			} satisfies SettingsReorderableSnapshot;
		});
	}

	cards(key: string, copy: SettingsRowCopy, spec: SettingsCardsSpec): void {
		assertUniqueValues(
			spec.items.map((item) => item.key),
			`${this.path}/${key}`,
		);
		this.complexRow(key, { ...copy, layout: copy.layout ?? "wide" }, () => {
			const disabled = spec.disabled ?? false;
			const items = spec.items.map((item) => {
				const composer = new CardComposer(
					`${this.path}/${key}/card/${settingsKey(item.key)}`,
					this.actions,
					disabled,
				);
				item.build(composer);
				return composer.snapshot(item.key, item.badge, item.enabled);
			});
			return {
				kind: "cards",
				key: "control",
				disabled,
				emptyText: spec.emptyText,
				items,
			} satisfies SettingsCardsSnapshot;
		});
	}

	private complexRow(
		key: string,
		copy: SettingsRowCopy,
		create: () => SettingsControlSnapshot,
	): void {
		if (copy.visible === false) return;
		this.row(key, copy);
		const row = this.rows[this.rows.length - 1];
		if (!row || row.key !== key)
			definitionError("Failed to create settings row", `${this.path}/${key}`);
		(row.controls as SettingsControlSnapshot[]).push(create());
	}
}

class RowComposer implements SettingsRowBuilder {
	private readonly keys = new Set<string>();

	constructor(
		private readonly path: string,
		private readonly controls: SettingsControlSnapshot[],
		private readonly actions: Map<string, ActionEntry>,
		private readonly parentDisabled = false,
	) {}

	button(key: string, spec: SettingsButtonSpec): void {
		this.add(
			key,
			createButton(
				this.path,
				key,
				{ ...spec, disabled: this.parentDisabled || spec.disabled },
				this.actions,
			),
		);
	}
	toggle(key: string, spec: SettingsValueSpec<boolean> & { tooltip?: string }): void {
		const disabled = this.parentDisabled || (spec.disabled ?? false);
		this.add(key, {
			kind: "toggle",
			key,
			disabled,
			value: spec.value,
			tooltip: spec.tooltip,
			action: registerAction(
				this.actions,
				`${this.path}/${key}:change`,
				disabled,
				parseBoolean,
				(value) => spec.onChange(value),
			),
		});
	}
	select<T extends string>(key: string, spec: SettingsSelectSpec<T>): void {
		const options = [...spec.options];
		assertUniqueValues(
			options.map((option) => option.value),
			`${this.path}/${key}`,
		);
		if (!options.some((option) => option.value === spec.value)) {
			if (!spec.missingValueLabel)
				definitionError("Selected value is missing", `${this.path}/${key}`);
			options.unshift({ value: spec.value, label: spec.missingValueLabel });
		}
		const disabled = this.parentDisabled || (spec.disabled ?? false);
		const allowed = new Set(options.map((option) => option.value));
		const action = registerAction(
			this.actions,
			`${this.path}/${key}:change`,
			disabled,
			(value): T => stringIn(allowed)(value) as T,
			(value) => spec.onChange(value),
		);
		this.add(key, {
			kind: "select",
			key,
			disabled,
			value: spec.value,
			options,
			action,
		});
	}
	text(key: string, spec: SettingsTextSpec): void {
		this.textLike("text", key, spec);
	}
	textarea(key: string, spec: SettingsTextSpec): void {
		this.textLike("textarea", key, spec);
	}
	secret(key: string, spec: SettingsTextSpec): void {
		this.textLike("secret", key, spec);
	}
	slider(key: string, spec: SettingsNumberSpec): void {
		this.number("slider", key, spec);
	}
	integer(key: string, spec: SettingsNumberSpec): void {
		this.number("integer", key, spec);
	}
	status(key: string, text: string): void {
		this.add(key, { kind: "status", key, disabled: true, text });
	}

	editableList(key: string, spec: SettingsEditableListSpec): void {
		const path = `${this.path}/${key}`;
		const disabled = this.parentDisabled || (spec.disabled ?? false);
		this.add(key, {
			kind: "editableList",
			key,
			disabled,
			values: [...spec.values],
			placeholder: spec.placeholder,
			addLabel: spec.addLabel,
			removeAriaLabel: spec.removeAriaLabel,
			changeAction: registerAction(
				this.actions,
				`${path}:change`,
				disabled,
				(value) => parseListChange(value, spec.values.length),
				(value) => spec.onChange(value.index, value.value),
			),
			addAction: registerAction(this.actions, `${path}:add`, disabled, parseVoid, () =>
				spec.onAdd(),
			),
			removeAction: registerAction(
				this.actions,
				`${path}:remove`,
				disabled,
				(value) => parseIndex(value, spec.values.length),
				(value) => spec.onRemove(value),
			),
		});
	}

	choiceButtons(key: string, spec: SettingsChoiceButtonsSpec): void {
		const path = `${this.path}/${key}`;
		assertUniqueValues(
			spec.choices.map((choice) => choice.id),
			path,
		);
		const disabled = this.parentDisabled || (spec.disabled ?? false);
		const allowed = new Set(spec.choices.map((choice) => choice.id));
		this.add(key, {
			kind: "choiceButtons",
			key,
			disabled,
			choices: [...spec.choices],
			emptyText: spec.emptyText,
			action: registerAction(
				this.actions,
				`${path}:choose`,
				disabled,
				stringIn(allowed),
				(value) => spec.onChoose(value),
			),
		});
	}

	private textLike(
		kind: "text" | "textarea" | "secret",
		key: string,
		spec: SettingsTextSpec,
	): void {
		const disabled = this.parentDisabled || (spec.disabled ?? false);
		this.add(key, {
			kind,
			key,
			disabled,
			value: spec.value,
			placeholder: spec.placeholder ?? "",
			action: registerAction(
				this.actions,
				`${this.path}/${key}:change`,
				disabled,
				parseString,
				(value) => spec.onChange(value),
			),
		});
	}

	private number(kind: "slider" | "integer", key: string, spec: SettingsNumberSpec): void {
		if (
			![spec.value, spec.min, spec.max, spec.step].every(Number.isFinite) ||
			spec.min > spec.max ||
			spec.value < spec.min ||
			spec.value > spec.max ||
			spec.step <= 0
		) {
			definitionError("Invalid numeric settings definition", `${this.path}/${key}`);
		}
		const disabled = this.parentDisabled || (spec.disabled ?? false);
		this.add(key, {
			kind,
			key,
			disabled,
			value: spec.value,
			min: spec.min,
			max: spec.max,
			step: spec.step,
			action: registerAction(
				this.actions,
				`${this.path}/${key}:change`,
				disabled,
				numberIn(spec.min, spec.max, kind === "integer"),
				(value) => spec.onChange(value),
			),
		});
	}

	private add(key: string, control: SettingsControlSnapshot): void {
		assertUniqueKey(this.keys, key, this.path);
		this.controls.push(control);
	}
}

class CardComposer implements SettingsCardBuilder {
	private titleControl?: SettingsTextSnapshot;
	private toggleControl?: SettingsToggleSnapshot;
	private readonly actionsList: SettingsButtonSnapshot[] = [];
	private readonly fields: SettingsCardFieldSnapshot[] = [];
	private readonly keys = new Set<string>();

	constructor(
		private readonly path: string,
		private readonly actions: Map<string, ActionEntry>,
		private readonly parentDisabled: boolean,
	) {}

	title(key: string, spec: SettingsTextSpec): void {
		if (this.titleControl) definitionError("A card can only have one title", this.path);
		const controls: SettingsControlSnapshot[] = [];
		new RowComposer(this.path, controls, this.actions).text(key, {
			...spec,
			disabled: this.parentDisabled || spec.disabled,
		});
		this.titleControl = controls[0] as SettingsTextSnapshot;
	}

	toggle(key: string, spec: SettingsValueSpec<boolean> & { tooltip?: string }): void {
		if (this.toggleControl)
			definitionError("A card can only have one header toggle", this.path);
		const controls: SettingsControlSnapshot[] = [];
		new RowComposer(this.path, controls, this.actions).toggle(key, {
			...spec,
			disabled: this.parentDisabled || spec.disabled,
		});
		this.toggleControl = controls[0] as SettingsToggleSnapshot;
	}

	action(key: string, spec: SettingsButtonSpec): void {
		assertUniqueKey(this.keys, key, this.path);
		this.actionsList.push(
			createButton(
				this.path,
				key,
				{
					...spec,
					disabled: this.parentDisabled || spec.disabled,
				},
				this.actions,
			),
		);
	}

	field(
		key: string,
		copy: Omit<SettingsRowCopy, "layout" | "tone" | "visible">,
		build: (row: SettingsRowBuilder) => void,
	): void {
		assertUniqueKey(this.keys, key, this.path);
		const controls: SettingsPrimitiveControlSnapshot[] = [];
		build(new RowComposer(`${this.path}/${key}`, controls, this.actions, this.parentDisabled));
		this.fields.push({ key, name: copy.name, description: copy.description, controls });
	}

	snapshot(key: string, badge: string, enabled: boolean): SettingsCardSnapshot {
		return {
			key,
			badge,
			enabled,
			title: this.titleControl,
			toggle: this.toggleControl,
			actions: this.actionsList,
			fields: this.fields,
		};
	}
}

function createButton(
	path: string,
	key: string,
	spec: SettingsButtonSpec,
	actions: Map<string, ActionEntry>,
): SettingsButtonSnapshot {
	const disabled = spec.disabled ?? false;
	return {
		kind: "button",
		key,
		disabled,
		label: spec.label,
		tone: spec.tone ?? "neutral",
		icon: spec.icon,
		action: registerAction(actions, `${path}/${key}:press`, disabled, parseVoid, () =>
			spec.onPress(),
		),
	};
}

function registerAction<T>(
	actions: Map<string, ActionEntry>,
	id: string,
	disabled: boolean,
	parse: (value: unknown) => T,
	run: (value: T) => SettingsActionResult,
): SettingsActionRef<T> {
	if (actions.has(id)) definitionError("Duplicate action key", id, "duplicate-key");
	actions.set(id, { disabled, parse, run: (value) => run(value as T) });
	return { id };
}

function assertKey(key: string, path: string): void {
	if (!key.trim() || key.includes("/"))
		definitionError("Keys must be non-empty and cannot contain '/'", path);
}

function assertUniqueKey(keys: Set<string>, key: string, path: string): void {
	assertKey(key, `${path}/${key}`);
	if (keys.has(key)) definitionError("Duplicate settings key", `${path}/${key}`, "duplicate-key");
	keys.add(key);
}

function assertUniqueValues(values: readonly string[], path: string): void {
	if (new Set(values).size !== values.length)
		definitionError("Values must be unique", path, "duplicate-key");
}

function definitionError(
	message: string,
	path: string,
	code: SettingsPresentationErrorCode = "invalid-definition",
): never {
	throw new SettingsPresentationError(code, `${message}: ${path}`, path);
}

function invalidInteraction(message: string): never {
	throw new SettingsPresentationError("invalid-interaction", message);
}

function readActionId(interaction: SettingsInteraction): string | null {
	const candidate = interaction as unknown;
	if (!candidate || typeof candidate !== "object" || !("action" in candidate)) return null;
	const action = candidate.action;
	if (!action || typeof action !== "object" || !("id" in action)) return null;
	return typeof action.id === "string" && action.id.length > 0 ? action.id : null;
}

function parseVoid(value: unknown): void {
	if (value !== undefined) invalidInteraction("Expected no settings action value");
}
function parseBoolean(value: unknown): boolean {
	if (typeof value !== "boolean") invalidInteraction("Expected a boolean settings value");
	return value;
}
function parseString(value: unknown): string {
	if (typeof value !== "string") invalidInteraction("Expected a string settings value");
	return value;
}
function parseIndex(value: unknown, length: number): number {
	if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= length)
		invalidInteraction("Expected an index within the presented collection");
	return value as number;
}
function parseListChange(value: unknown, length: number): { index: number; value: string } {
	if (!value || typeof value !== "object") invalidInteraction("Expected a list change");
	const candidate = value as { index?: unknown; value?: unknown };
	return { index: parseIndex(candidate.index, length), value: parseString(candidate.value) };
}
function parseMove(value: unknown, length: number): { fromIndex: number; toIndex: number } {
	if (!value || typeof value !== "object") invalidInteraction("Expected a move interaction");
	const candidate = value as { fromIndex?: unknown; toIndex?: unknown };
	return {
		fromIndex: parseIndex(candidate.fromIndex, length),
		toIndex: parseIndex(candidate.toIndex, length),
	};
}
function stringIn(allowed: ReadonlySet<string>): (value: unknown) => string {
	return (value) => {
		const parsed = parseString(value);
		if (!allowed.has(parsed)) invalidInteraction(`Unknown settings option: ${parsed}`);
		return parsed;
	};
}
function numberIn(min: number, max: number, integer: boolean): (value: unknown) => number {
	return (value) => {
		const parsed =
			typeof value === "string" && value.trim() !== "" ? Number(value) : (value as number);
		if (
			typeof parsed !== "number" ||
			!Number.isFinite(parsed) ||
			parsed < min ||
			parsed > max ||
			(integer && !Number.isInteger(parsed))
		) {
			invalidInteraction("Numeric settings value is outside its allowed range");
		}
		return parsed;
	};
}

function deepFreeze<T>(value: T): T {
	if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
