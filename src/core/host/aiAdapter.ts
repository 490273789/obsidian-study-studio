import { AiService, type AiSettings } from "../ai";
import type { AiDependencies } from "../ai/types";

export function createObsidianAiService(
	settings: AiSettings,
	dependencies: Omit<AiDependencies, "createId"> & Required<Pick<AiDependencies, "queueWrite">>,
): AiService {
	return new AiService(settings, {
		...dependencies,
		createId: () => crypto.randomUUID(),
	});
}
