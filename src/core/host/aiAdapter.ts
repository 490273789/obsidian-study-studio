import type { App } from "obsidian";
import { AiService, type AiEngineTesters, type AiSettings } from "../ai";
import { createOutboundPort, type OutboundPort } from "../net";

export function createObsidianAiService(
	app: App,
	settings: AiSettings,
	persist: (settings: AiSettings) => Promise<void>,
	net: OutboundPort = createOutboundPort({ app }),
	testers?: AiEngineTesters,
): AiService {
	return new AiService(settings, {
		persist,
		createId: () => crypto.randomUUID(),
		net,
		...(testers ? { testers } : {}),
	});
}
