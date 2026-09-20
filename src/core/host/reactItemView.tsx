import React from "react";
import { ItemView, WorkspaceLeaf, type App } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type { Language } from "../shared/types";
import { createSharedTranslator, type Translator } from "../i18n";
import { I18nProvider } from "../ui/context/I18nContext";
import type { WorkbenchItemView } from "./workbench";

/**
 * Everything a workbench view's React tree may read. The seam owns the container,
 * the React root, the owner-scoped committed settings, and the theme, so a view
 * definition only describes what it renders.
 */
export interface ReactViewAcquireContext<TSettings extends { readonly language: Language }> {
	readonly app: App;
	/** The owner-scoped committed settings snapshot, read at render time. */
	readonly settings: Readonly<TSettings>;
	readonly language: Language;
	readonly theme: "dark" | "light";
	/** Host for imperative Obsidian modals that belong to this view. */
	readonly rootEl: HTMLElement;
}

export interface ReactViewContext<
	TSettings extends { readonly language: Language },
	TResource = undefined,
> extends ReactViewAcquireContext<TSettings> {
	/** Resource acquired once for this Obsidian view and reused across React renders. */
	readonly resource: TResource;
}

export interface AcquiredReactView<TResource> {
	readonly resource: TResource;
	dispose(): void;
}

export interface ReactViewOptions<
	TSettings extends { readonly language: Language },
	TResource = undefined,
> {
	/** Obsidian view type; must equal the type passed to `WorkbenchHost.registerView`. */
	type: string;
	icon: string;
	title(language: Language): string;
	/** Reads a fresh owner-scoped snapshot whenever the seam renders. */
	readSettings(): Readonly<TSettings>;
	/** Localized message shown in place of the view when its render throws. */
	renderErrorMessage(language: Language): string;
	/**
	 * The dictionary the view's React tree translates with. Defaults to the shared
	 * workbench strings; a feature passes its own composed dictionary so its keys
	 * resolve inside the same i18n context.
	 */
	translator?(language: Language): Translator;
	/** Acquires one view-lifetime resource before the first React render. */
	acquire?(context: ReactViewAcquireContext<TSettings>): AcquiredReactView<TResource>;
	render(context: ReactViewContext<TSettings, TResource>): React.ReactNode;
	/**
	 * Re-render on Obsidian theme changes. Only views that render their own theme
	 * state (such as the dictionary's sandbox document) need this.
	 */
	trackTheme?: boolean;
	/** Runs after the first render of every open, with the view already mounted. */
	onOpen?(context: ReactViewContext<TSettings, TResource>): void;
	onClose?(): void;
}

/**
 * Wraps the React tree so a render failure stays visible. Without a boundary React
 * unmounts the whole root, the leaf silently goes blank, and the only evidence is a
 * console error.
 */
export class ReactViewErrorBoundary extends React.Component<
	{ children: React.ReactNode; message: string; viewType: string },
	{ failed: boolean }
> {
	override state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	override componentDidCatch(error: unknown): void {
		console.error(`The ${this.props.viewType} view failed to render:`, error);
	}

	override render(): React.ReactNode {
		if (this.state.failed) return <p className="fc-kicker">{this.props.message}</p>;
		return this.props.children;
	}
}

/**
 * Builds the Obsidian view factory for one React view.
 *
 * Every workbench view crosses the same seam: container setup, React root, i18n
 * provider, committed settings, error boundary, settings-push re-render, theme
 * tracking, and teardown. Features pass a definition instead of writing an
 * `ItemView` subclass, and `WorkbenchHost.registerView` accepts the result directly.
 */
export function createReactItemView<
	TSettings extends { readonly language: Language },
	TResource = undefined,
>(options: ReactViewOptions<TSettings, TResource>): (leaf: WorkspaceLeaf) => WorkbenchItemView {
	class ReactWorkbenchView extends ItemView implements WorkbenchItemView {
		private root: Root | null = null;
		private rootEl: HTMLElement | null = null;
		private acquired: AcquiredReactView<TResource> | null = null;
		private acquisitionFailed = false;
		private theme: "dark" | "light" = "light";

		getViewType(): string {
			return options.type;
		}

		getDisplayText(): string {
			return options.title(options.readSettings().language);
		}

		getIcon(): string {
			return options.icon;
		}

		async onOpen(): Promise<void> {
			const container = this.containerEl.children[1];
			if (!container) return;

			container.empty();
			container.addClass("flashcard-container");

			this.acquisitionFailed = false;
			this.theme = this.currentTheme();
			if (options.trackTheme) {
				this.registerEvent(
					this.app.workspace.on("css-change", () => {
						const theme = this.currentTheme();
						if (theme === this.theme) return;
						this.theme = theme;
						this.renderReact();
					}),
				);
			}

			this.rootEl = container.createDiv({ cls: "flashcard-root" });
			this.root = createRoot(this.rootEl);
			try {
				this.acquired = options.acquire?.(this.acquireContext()) ?? {
					resource: undefined as TResource,
					dispose: () => undefined,
				};
			} catch (error) {
				this.acquisitionFailed = true;
				console.error(`The ${options.type} view failed to acquire its resource:`, error);
				this.renderAcquisitionFailure();
				return;
			}
			this.renderReact();
			options.onOpen?.(this.context());
		}

		/** The host pushes a settings change; the seam always reads the committed document. */
		updateSettings(): void {
			this.renderReact();
		}

		async onClose(): Promise<void> {
			if (this.root) {
				this.root.unmount();
				this.root = null;
			}
			this.acquired?.dispose();
			this.acquired = null;
			this.acquisitionFailed = false;
			this.rootEl = null;
			options.onClose?.();
		}

		private currentTheme(): "dark" | "light" {
			return this.app.isDarkMode() ? "dark" : "light";
		}

		private acquireContext(): ReactViewAcquireContext<TSettings> {
			const settings = options.readSettings();
			return {
				app: this.app,
				settings,
				language: settings.language,
				theme: this.theme,
				rootEl: this.rootEl!,
			};
		}

		private context(): ReactViewContext<TSettings, TResource> {
			return {
				...this.acquireContext(),
				resource: this.acquired!.resource,
			};
		}

		private renderReact(): void {
			const root = this.root;
			if (!root || !this.rootEl) return;
			if (this.acquisitionFailed) {
				this.renderAcquisitionFailure();
				return;
			}
			const context = this.context();
			root.render(
				<React.StrictMode>
					<I18nProvider
						language={context.language}
						translator={() =>
							options.translator?.(context.language) ??
							createSharedTranslator(context.language)
						}
					>
						<ReactViewErrorBoundary
							viewType={options.type}
							message={options.renderErrorMessage(context.language)}
						>
							{options.render(context)}
						</ReactViewErrorBoundary>
					</I18nProvider>
				</React.StrictMode>,
			);
		}

		private renderAcquisitionFailure(): void {
			const root = this.root;
			if (!root) return;
			const language = options.readSettings().language;
			root.render(
				<React.StrictMode>
					<I18nProvider
						language={language}
						translator={() =>
							options.translator?.(language) ?? createSharedTranslator(language)
						}
					>
						<p className="fc-kicker">{options.renderErrorMessage(language)}</p>
					</I18nProvider>
				</React.StrictMode>,
			);
		}
	}

	return (leaf) => new ReactWorkbenchView(leaf);
}
