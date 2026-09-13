import type {
	SettingsActionRef,
	SettingsDispatchResult,
	SettingsInteraction,
	SettingsPresentation,
	SettingsSnapshot,
} from "../presentation";

/** Test adapter that consumes the same callback-free interface as the Obsidian adapter. */
export class RecordingSettingsAdapter {
	private presentation: SettingsPresentation | null = null;
	private recorded: SettingsSnapshot | null = null;

	install(presentation: SettingsPresentation): void {
		this.presentation?.dispose();
		this.presentation = presentation;
		this.recorded = presentation.snapshot;
	}

	snapshot(): SettingsSnapshot {
		if (!this.recorded) throw new Error("No settings presentation is installed");
		return this.recorded;
	}

	dispatch<T>(action: SettingsActionRef<T>, value: T): Promise<SettingsDispatchResult> {
		if (!this.presentation) throw new Error("No settings presentation is installed");
		return this.presentation.invoke({ action, value } satisfies SettingsInteraction);
	}

	dispose(): void {
		this.presentation?.dispose();
		this.presentation = null;
	}
}
