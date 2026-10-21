import { useLayoutEffect } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Language } from "../shared/types";
import { ReorderableList, useSortableItem } from "../ui/primitives/Sortable/Sortable";
import type { SortableInteraction } from "../ui/primitives/Sortable/sortableInteraction";

export interface SortableSettingRow {
	id: string;
	label: string;
	element: HTMLElement;
	handleContainer: HTMLElement;
}

/** React owns only sorting and its handles; Obsidian retains the settings controls. */
export function mountSettingsSorting(
	container: HTMLElement,
	rows: readonly SortableSettingRow[],
	language: Language,
	interaction: SortableInteraction,
): () => void {
	const root = createRoot(container);
	flushSync(() => {
		root.render(
			<ReorderableList interaction={interaction} language={language}>
				{rows.map((row) => (
					<SettingsSortBinding key={row.id} row={row} />
				))}
			</ReorderableList>,
		);
	});
	return () => root.unmount();
}

function SettingsSortBinding({ row }: { row: SortableSettingRow }) {
	const { setNodeRef, style, isDragging, handle } = useSortableItem({
		id: row.id,
		handleLabel: row.label,
	});
	useLayoutEffect(() => {
		setNodeRef(row.element);
		return () => setNodeRef(null);
	}, [row.element, setNodeRef]);
	useLayoutEffect(() => {
		row.element.style.setProperty("transform", style.transform ?? "");
		row.element.style.setProperty("transition", style.transition ?? "");
		row.element.classList.toggle("is-sorting", isDragging);
		return () => {
			row.element.style.removeProperty("transform");
			row.element.style.removeProperty("transition");
			row.element.classList.remove("is-sorting");
		};
	}, [row.element, style.transform, style.transition, isDragging]);
	return createPortal(handle, row.handleContainer);
}
