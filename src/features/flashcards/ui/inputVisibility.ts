const MODALS = 'dialog[open], [aria-modal="true"]:not([aria-hidden="true"]), .modal-container';
const HIDDEN = '[hidden], [inert], [aria-hidden="true"]';
const ACTION = "[data-session-input-action]";
const CONTROLS =
	'input, textarea, select, button, a[href], [contenteditable], [tabindex], [role="button"]';

export interface InputReturn {
	/** Draft updates require the same question/input, independently of focus ownership. */
	isCurrent(this: void): boolean;
	focus(this: void): void;
}

export interface InputRegistration {
	readonly view: HTMLElement;
	readonly input: HTMLInputElement | null;
	readonly question: string;
	readonly focusOnEntry: boolean;
}

export interface InputBinding {
	keepVisible(this: void): void;
	blur(this: void): void;
	captureReturn(this: void): InputReturn;
	dispose(this: void): void;
}

/** One flashcard view's window compatibility and question-input interaction lifetime. */
export class InputVisibility {
	private active = false;
	private lifetime: object | null = null;
	private focusVersion = 0;
	private origin: HTMLElement | null = null;
	private current: (InputBinding & { registration: InputRegistration; enter(): void }) | null =
		null;

	constructor(private readonly document: Document) {}

	mount(): () => void {
		const win = this.document.defaultView;
		if (!win) return () => {};
		const lifetime = {};
		this.lifetime = lifetime;
		this.active = true;
		const tasks = new Tasks(win);
		const reset = () => this.resetWindowScroll();
		const viewport = () => {
			reset();
			this.current?.keepVisible();
		};
		const focusIn = (event: FocusEvent) => {
			this.recordInteraction(asElement(event.target));
			this.current?.keepVisible();
			const target = asElement(event.target);
			const owner = this.current;
			const resetCurrent = () => {
				if (owner === this.current && target?.isConnected) reset();
			};
			if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
				tasks.frame(resetCurrent);
				tasks.delay(resetCurrent, 50);
				tasks.delay(resetCurrent, 200);
			}
		};
		const focusOut = () => {
			const owner = this.current;
			tasks.frame(() => {
				if (owner === this.current) reset();
			});
		};
		const pointer = (event: PointerEvent) => this.recordInteraction(asElement(event.target));
		const blur = () => {
			this.focusVersion++;
			this.current?.blur();
		};
		win.addEventListener("scroll", reset, { passive: true });
		win.addEventListener("blur", blur);
		this.document.addEventListener("focusin", focusIn);
		this.document.addEventListener("focusout", focusOut);
		this.document.addEventListener("pointerdown", pointer, true);
		win.visualViewport?.addEventListener("resize", viewport);
		win.visualViewport?.addEventListener("scroll", viewport);
		this.current?.enter();
		return () => {
			if (this.lifetime !== lifetime) return;
			this.active = false;
			this.lifetime = null;
			this.focusVersion++;
			this.current?.dispose();
			tasks.dispose();
			win.removeEventListener("scroll", reset);
			win.removeEventListener("blur", blur);
			this.document.removeEventListener("focusin", focusIn);
			this.document.removeEventListener("focusout", focusOut);
			this.document.removeEventListener("pointerdown", pointer, true);
			win.visualViewport?.removeEventListener("resize", viewport);
			win.visualViewport?.removeEventListener("scroll", viewport);
		};
	}

	open(registration: InputRegistration): InputBinding {
		this.current?.dispose();
		const { input, view } = registration;
		const win = this.document.defaultView;
		const tasks = win ? new Tasks(win) : null;
		let disposed = false;
		let cancelVisibility: (() => void) | null = null;
		let cancelFocus: (() => void) | null = null;
		const isCurrent = () =>
			this.active &&
			!disposed &&
			this.current === binding &&
			view.isConnected &&
			view.ownerDocument === this.document &&
			(!input || (input.isConnected && input.ownerDocument === this.document));
		const clearVisibility = () => {
			cancelVisibility?.();
			cancelVisibility = null;
			view.style.removeProperty("--fc-keyboard-inset");
		};
		const focus = (version: number) => {
			if (!isCurrent() || !input || !tasks) return;
			cancelFocus?.();
			cancelFocus = tasks.delay(() => {
				cancelFocus = null;
				if (version !== this.focusVersion || !isCurrent() || !this.canFocus(registration))
					return;
				if (this.document.activeElement !== input) input.focus({ preventScroll: true });
				binding.keepVisible();
			}, 0);
		};
		const binding = {
			registration,
			enter: () => {
				if (registration.focusOnEntry && this.canFocus(registration))
					focus(this.focusVersion);
			},
			keepVisible: () => {
				if (
					!isCurrent() ||
					!input ||
					!win ||
					!tasks ||
					!this.document.hasFocus() ||
					this.document.activeElement !== input ||
					(this.origin?.isConnected && !ownsInteraction(registration, this.origin))
				)
					return;
				this.resetWindowScroll();
				const bottom = win.visualViewport
					? win.visualViewport.offsetTop + win.visualViewport.height
					: win.innerHeight;
				view.style.setProperty(
					"--fc-keyboard-inset",
					`${Math.max(0, view.getBoundingClientRect().bottom - bottom)}px`,
				);
				cancelVisibility?.();
				cancelVisibility = tasks.frame(() => {
					cancelVisibility = null;
					if (!isCurrent() || this.document.activeElement !== input) return;
					const scroller = input.closest<HTMLElement>(".flashcard-content");
					if (!scroller) return;
					const currentBottom = win.visualViewport
						? win.visualViewport.offsetTop + win.visualViewport.height
						: win.innerHeight;
					const overlap =
						input.getBoundingClientRect().bottom +
						16 -
						Math.min(scroller.getBoundingClientRect().bottom, currentBottom);
					if (overlap > 0) scroller.scrollBy({ top: overlap, behavior: "auto" });
				});
			},
			blur: () => {
				cancelFocus?.();
				cancelFocus = null;
				clearVisibility();
			},
			captureReturn: (): InputReturn => {
				const version = this.focusVersion;
				const permitted = this.canFocus(registration);
				return {
					isCurrent,
					focus: () => {
						if (permitted) focus(version);
					},
				};
			},
			dispose: () => {
				if (disposed) return;
				disposed = true;
				tasks?.dispose();
				clearVisibility();
				if (this.current === binding) this.current = null;
			},
		};
		this.current = binding;
		binding.enter();
		return binding;
	}

	private resetWindowScroll(): void {
		if (!this.active) return;
		const win = this.document.defaultView;
		if (win && (win.scrollX > 0 || win.scrollY > 0))
			win.scrollTo({ top: 0, left: 0, behavior: "instant" });
		if (this.document.body && this.document.body.scrollTop > 0)
			this.document.body.scrollTop = 0;
		if (this.document.documentElement && this.document.documentElement.scrollTop > 0)
			this.document.documentElement.scrollTop = 0;
	}

	private recordInteraction(target: HTMLElement | null): void {
		this.origin = target;
		const registration = this.current?.registration;
		if (!registration || !ownsInteraction(registration, target)) {
			this.focusVersion++;
			this.current?.blur();
		}
	}

	private canFocus(registration: InputRegistration): boolean {
		const { input, view } = registration;
		if (
			!input ||
			input.disabled ||
			!view.isConnected ||
			!input.isConnected ||
			!this.document.hasFocus() ||
			view.closest(HIDDEN) ||
			this.document.querySelector(MODALS)
		)
			return false;
		const active = asElement(this.document.activeElement);
		if (active && active !== this.document.body) return ownsInteraction(registration, active);
		return (
			!this.origin || !this.origin.isConnected || ownsInteraction(registration, this.origin)
		);
	}
}

function ownsInteraction({ input, view }: InputRegistration, target: HTMLElement | null): boolean {
	if (!target) return false;
	if (target === input) return true;
	if (!view.contains(target)) return false;
	const action = target.closest(ACTION);
	if (action && view.contains(action)) return true;
	const control = target.closest(CONTROLS);
	return !control || control === view || !view.contains(control);
}

function asElement(target: EventTarget | null): HTMLElement | null {
	return target && (target as Node).nodeType === 1 ? (target as HTMLElement) : null;
}

/** All scheduled work is tied to its owning window and one disposable lifetime. */
class Tasks {
	private readonly pending = new Set<() => void>();
	private disposed = false;
	constructor(private readonly window: Window) {}
	frame(run: () => void): () => void {
		return this.schedule(
			run,
			(callback) => this.window.requestAnimationFrame(callback),
			(id) => this.window.cancelAnimationFrame(id),
		);
	}
	delay(run: () => void, delay: number): () => void {
		return this.schedule(
			run,
			(callback) => this.window.setTimeout(callback, delay),
			(id) => this.window.clearTimeout(id),
		);
	}
	dispose(): void {
		this.disposed = true;
		for (const cancel of this.pending) cancel();
	}
	private schedule(
		run: () => void,
		acquire: (callback: () => void) => number,
		release: (id: number) => void,
	): () => void {
		if (this.disposed) return () => {};
		let cancelled = false;
		const id = acquire(() => {
			this.pending.delete(cancel);
			if (!cancelled && !this.disposed) run();
		});
		const cancel = () => {
			cancelled = true;
			this.pending.delete(cancel);
			release(id);
		};
		this.pending.add(cancel);
		return cancel;
	}
}
