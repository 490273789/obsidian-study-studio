import type { Plugin } from "obsidian";
import type { AiService } from "../core/ai";
import type { WorkbenchStore } from "../core/storage/workbenchStore";
import type { AnyWorkbenchModule } from "../core/host/workbench";
import type { OutboundPort } from "../core/net";
import { createDictionaryFeature } from "./dictionary/feature";
import { SelectionDictionaryResultContent } from "./dictionary/ui/SelectionDictionaryResultContent";
import { createFlashcardFeature } from "./flashcards/feature";
import { createTranslationFeature } from "./translation/feature";
import { createSelectionHelperModule } from "../core/selectionHelper/module";
import { createVideoPlayerFeature } from "./video-player/feature";
import { createAudioPracticeFeature } from "./audio-practice/feature";

interface WorkbenchModuleDeps {
	ai: AiService;
	store: WorkbenchStore;
	plugin: Plugin;
	net: OutboundPort;
}

/**
 * The single composition module for the workbench: it lists every feature and
 * explicitly hands each one the shared services it needs. The composition root
 * imports only this module, so it never has to know a feature's name.
 */
export function createWorkbenchModules(deps: WorkbenchModuleDeps): AnyWorkbenchModule[] {
	const flashcards = createFlashcardFeature({
		store: deps.store,
		net: deps.net,
		plugin: deps.plugin,
	});
	const translation = createTranslationFeature({ ai: deps.ai, net: deps.net });
	const dictionary = createDictionaryFeature({
		ai: deps.ai,
		net: deps.net,
		plugin: deps.plugin,
		sourceEdits: flashcards.sourceEditAdapter,
	});
	const videoPlayer = createVideoPlayerFeature();
	const audioPractice = createAudioPracticeFeature({ store: deps.store, net: deps.net });

	const selectionHelper = createSelectionHelperModule({
		dictionary: dictionary.selectionAdapter,
		renderResultContent: SelectionDictionaryResultContent,
		translation: translation.selectionAdapter,
	});

	return [flashcards, translation, dictionary, videoPlayer, audioPractice, selectionHelper];
}
