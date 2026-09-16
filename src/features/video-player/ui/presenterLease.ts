/** Ensures duplicate workspace leaves never create two active media elements. */
export class VideoPlayerPresenterLease {
	private owner: symbol | null = null;
	private readonly listeners = new Set<() => void>();

	getSnapshot = (): symbol | null => this.owner;

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	acquire(token: symbol): boolean {
		if (this.owner && this.owner !== token) return false;
		if (this.owner === token) return true;
		this.owner = token;
		this.publish();
		return true;
	}

	release(token: symbol): void {
		if (this.owner !== token) return;
		this.owner = null;
		this.publish();
	}

	private publish(): void {
		for (const listener of this.listeners) listener();
	}
}
