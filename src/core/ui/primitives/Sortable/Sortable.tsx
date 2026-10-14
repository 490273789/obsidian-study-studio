import React, { useRef, useState } from "react";
import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type SensorDescriptor,
	type SensorOptions,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cls } from "../../../shared/classNames";
import type { Language } from "../../../shared/types";
import { createSharedTranslator } from "../../../i18n";

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

/** Presentation only: owners retain the authoritative order and persistence. */
export function ReorderableList({
	items,
	language,
	disabled = false,
	onMove,
	children,
}: {
	items: readonly string[];
	language: Language;
	disabled?: boolean;
	onMove: (fromIndex: number, toIndex: number) => void | Promise<void>;
	children: React.ReactNode;
}) {
	const sensors = useSortableSensors();
	const saving = useRef(false);
	const [busy, setBusy] = useState(false);
	function handleDragEnd({ active, over }: DragEndEvent): void {
		if (disabled || saving.current || !over || active.id === over.id) return;
		const fromIndex = items.indexOf(String(active.id));
		const toIndex = items.indexOf(String(over.id));
		if (fromIndex < 0 || toIndex < 0) return;
		saving.current = true;
		setBusy(true);
		// Lock immediately, including when another input completes before React renders.
		void Promise.resolve()
			.then(() => onMove(fromIndex, toIndex))
			.catch((error: unknown) => console.error("Reorder failed:", error))
			.finally(() => {
				saving.current = false;
				setBusy(false);
			});
	}
	return (
		<DndContext
			sensors={disabled || busy ? NO_SENSORS : sensors}
			collisionDetection={closestCenter}
			accessibility={sortableAccessibility(language, items)}
			onDragEnd={handleDragEnd}
		>
			<SortableContext items={[...items]} strategy={verticalListSortingStrategy}>
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
