import { TFile, type App } from "obsidian";
import { FavoriteBatchError, type FavoriteBatchSource } from "../domain/favorite-batch";

/** Vault-only source selector; never reads unrelated notes for suggestions. */
export class ObsidianFavoriteBatchSource implements FavoriteBatchSource {
	constructor(private readonly app: App) {}

	pathSuggestions(query: string): string[] {
		const needle = query.trim().toLocaleLowerCase();
		return this.app.vault
			.getFiles()
			.filter(
				(file) => this.isWordList(file) && file.path.toLocaleLowerCase().includes(needle),
			)
			.map((file) => file.path)
			.sort((a, b) => a.localeCompare(b))
			.slice(0, 300);
	}

	async read(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new FavoriteBatchError("source-missing");
		if (!this.isWordList(file)) throw new FavoriteBatchError("source-invalid");
		try {
			return await this.app.vault.read(file);
		} catch {
			throw new FavoriteBatchError("source-read-failed");
		}
	}

	private isWordList(file: TFile): boolean {
		return (
			file.extension.toLocaleLowerCase() === "txt" ||
			file.extension.toLocaleLowerCase() === "md"
		);
	}
}
