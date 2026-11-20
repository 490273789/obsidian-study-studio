import { memo, useEffect, useRef } from "react";
import { Component } from "obsidian";

export type MarkdownRendererFn = (
	content: string,
	el: HTMLElement,
	component: Component,
	sourcePath: string,
) => Promise<void>;

interface MarkdownContentProps {
	content: string;
	className: string;
	markdownRenderer: MarkdownRendererFn;
	sourcePath: string;
}

export function renderMarkdownWithLifecycle(
	content: string,
	el: HTMLElement | null,
	markdownRenderer: MarkdownRendererFn,
	sourcePath: string,
): (() => void) | undefined {
	if (!el) return undefined;

	const component = new Component();
	const target = el.ownerDocument.createElement("div");
	target.className = "flashcard-markdown-render";
	el.replaceChildren(target);
	component.load();
	let active = true;
	// A later render can start before Obsidian finishes writing into this one.
	void (async () => {
		try {
			await markdownRenderer(content, target, component, sourcePath);
		} catch (error) {
			if (!active) return;
			console.error("Failed to render flashcard Markdown:", error);
			target.textContent = content;
		}
	})();

	return () => {
		active = false;
		component.unload();
		target.remove();
	};
}

export const MarkdownContent = memo(function MarkdownContent({
	content,
	className,
	markdownRenderer,
	sourcePath,
}: MarkdownContentProps) {
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		return renderMarkdownWithLifecycle(
			content,
			contentRef.current,
			markdownRenderer,
			sourcePath,
		);
	}, [content, markdownRenderer, sourcePath]);

	return <div ref={contentRef} className={className} />;
});
