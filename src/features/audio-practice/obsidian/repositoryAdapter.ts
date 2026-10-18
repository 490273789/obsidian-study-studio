import type { WorkbenchStore } from "../../../core/storage/workbenchStore";
import { normalizeAudioPracticeData } from "../domain/repository";
import type { AudioPracticeRepository } from "../domain/types";
const PARTITION = "audioPractice";
export function createAudioPracticeRepository(store: WorkbenchStore): AudioPracticeRepository {
	const source = {};
	return {
		load: () => normalizeAudioPracticeData(store.getPartition(PARTITION)),
		save: (data) =>
			store.savePartition(PARTITION, data, { source, expectedRevision: store.getRevision() }),
		subscribeExternal: (listener) =>
			store.subscribe((change) => {
				if (
					change.kind === "external" ||
					(change.source !== source &&
						(change.kind === "document" ||
							(change.kind === "partition" && change.partitionKey === PARTITION)))
				)
					listener();
			}),
	};
}
