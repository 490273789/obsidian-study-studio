import React, { useLayoutEffect, useState, useSyncExternalStore } from "react";
import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
	type SensorDescriptor,
	type SensorOptions,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
	type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cls } from "../../../shared/classNames";
import type { Language } from "../../../shared/types";
import { createSharedTranslator } from "../../../i18n";
import { SortableInteraction, type SortableInput } from "./sortableInteraction";

const NO_SENSORS: SensorDescriptor<SensorOptions>[] = [];

/** Keep all reorder surfaces consistent with the deck home interaction. */
export function useSortableSensors() {
	return useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 1000, tolerance: 5 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);
}

export function sortableAccessibility(language: Language, items: readonly string[]) {
	const t = createSharedTranslator(language);
	const position = (id: string | number) => items.indexOf(String(id)) + 1;
	return {
		screenReaderInstructions: { draggable: t("sort.instructions") },
		announcements: {
			onDragStart: ({ active }: DragEndEvent) =>
				t("sort.pickedUp", { position: position(active.id), total: items.length }),
			onDragOver: ({ over }: DragEndEvent) =>
				over
					? t("sort.moved", { position: position(over.id), total: items.length })
					: undefined,
			onDragEnd: ({ over }: DragEndEvent) =>
				over ? t("sort.dropped", { position: position(over.id) }) : t("sort.cancelled"),
			onDragCancel: () => t("sort.cancelled"),
		},
	};
}

/** React owns the interaction lifetime; authoritative order still comes from the owner. */
export function useSortableInteraction(input: SortableInput) {
	const [interaction] = useState(() => new SortableInteraction(input));
	useLayoutEffect(() => interaction.update(input));
	useLayoutEffect(() => interaction.mount(), [interaction]);
	const snapshot = useSyncExternalStore(
		interaction.subscribe,
		interaction.getSnapshot,
		interaction.getSnapshot,
	);
	return { interaction, snapshot };
}

/** Grid, native settings rows and queue rows share the same input coordination. */
export function ReorderableList({
	interaction,
	language,
	strategy = verticalListSortingStrategy,
	children,
}: {
	interaction: SortableInteraction;
	language: Language;
	strategy?: SortingStrategy;
	children: React.ReactNode;
}) {
	useLayoutEffect(() => () => interaction.cancelDrag(), [interaction]);
	const snapshot = useSyncExternalStore(
		interaction.subscribe,
		interaction.getSnapshot,
		interaction.getSnapshot,
	);
	const sensors = useSortableSensors();
	function handleDragStart({ active }: DragStartEvent): void {
		interaction.beginDrag(String(active.id));
	}
	function handleDragEnd({ active, over }: DragEndEvent): void {
		interaction.drop(String(active.id), over ? String(over.id) : null);
	}
	return (
		<DndContext
			sensors={snapshot.disabled ? NO_SENSORS : sensors}
			collisionDetection={closestCenter}
			accessibility={sortableAccessibility(language, snapshot.items)}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDragCancel={interaction.cancelDrag}
		>
			<SortableContext items={[...snapshot.items]} strategy={strategy}>
				{children}
			</SortableContext>
		</DndContext>
	);
}

export interface SortableItemOptions {
	id: string;
	disabled?: boolean;
	handleLabel: string;
	handleClassName?: string;
}

/** Also connects imperative Obsidian rows to the same motion and handle. */
export function useSortableItem({
	id,
	disabled,
	handleLabel,
	handleClassName,
}: SortableItemOptions) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id, disabled });
	return {
		setNodeRef,
		isDragging,
		style: {
			transform: CSS.Transform.toString(transform),
			transition: isDragging ? "none" : transition,
		},
		handle: (
			<button
				type="button"
				ref={setActivatorNodeRef}
				className={cls("fc-sortable-handle fc-focus-ring", handleClassName)}
				disabled={disabled}
				{...attributes}
				{...listeners}
				aria-label={handleLabel}
				data-sortable-id={id}
				title={handleLabel}
			>
				<GripVertical size={16} aria-hidden="true" />
			</button>
		),
	};
}

export function SortableRow({
	className,
	children,
	...options
}: SortableItemOptions & {
	className?: string;
	children: (handle: React.ReactNode) => React.ReactNode;
}) {
	const { setNodeRef, style, isDragging, handle } = useSortableItem(options);
	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cls("fc-sortable-row", className, isDragging && "is-sorting")}
		>
			{children(handle)}
		</div>
	);
}
