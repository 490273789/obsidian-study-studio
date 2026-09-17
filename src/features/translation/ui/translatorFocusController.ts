/** Connects the host-generated open command and prefill triggers to the translation input. */
export class TranslatorFocusController {
	private target: (() => void) | null = null;
	private pending = false;

	register(target: () => void): () => void {
		this.target = target;
		if (this.pending) {
			this.pending = false;
			target();
		}
		return () => {
			if (this.target === target) this.target = null;
		};
	}

	requestFocus(): void {
		if (this.target) this.target();
		else this.pending = true;
	}
}
