import { memo, useEffect, useRef } from "react";
import { Component } from "obsidian";

export type MarkdownRendererFn = (
	content: string,
	el: HTMLElement,
	component?: Component,
) => Promise<void>;

interface MarkdownContentProps {
	content: string;
	className: string;
	markdownRenderer: MarkdownRendererFn;
}

export function renderMarkdownWithLifecycle(
	content: string,
	el: HTMLElement | null,
	markdownRenderer: MarkdownRendererFn,
): (() => void) | undefined {
	if (!el) return undefined;

	const component = new Component();
	component.load();
	el.innerHTML = "";
	void markdownRenderer(content, el, component);

	return () => {
		component.unload();
	};
}

export const MarkdownContent = memo(function MarkdownContent({
	content,
	className,
	markdownRenderer,
}: MarkdownContentProps) {
	const contentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		return renderMarkdownWithLifecycle(content, contentRef.current, markdownRenderer);
	}, [content, markdownRenderer]);

	return <div ref={contentRef} className={className} />;
});
