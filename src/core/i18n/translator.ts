import type { Language } from "../shared/types";

export const DEFAULT_LANGUAGE: Language = "zh";

export type TranslationVars = Record<string, string | number>;

export type TranslationDictionary = Record<Language, Record<string, string>>;

/** A translator bound to one language and one dictionary. */
export type Translator = (key: string, vars?: TranslationVars) => string;

export function normalizeLanguage(language: unknown): Language {
	return language === "en" || language === "zh" ? language : DEFAULT_LANGUAGE;
}

/**
 * Builds the translate primitives for one dictionary.
 *
 * The framework is dictionary-agnostic on purpose: the workbench host translates
 * its shared strings, and each feature composes its own dictionary (shared entries
 * plus its own) through this factory.
 */
export function createTranslatorFactory(dictionary: TranslationDictionary) {
	const translate = (language: Language, key: string, vars: TranslationVars = {}): string => {
		const normalized = normalizeLanguage(language);
		let value: string = dictionary[normalized][key] ?? dictionary.zh[key] ?? key;
		for (const [name, replacement] of Object.entries(vars)) {
			value = value.split(`{${name}}`).join(String(replacement));
		}
		return value;
	};

	return {
		translate,
		createTranslator:
			(language: Language): Translator =>
			(key, vars) =>
				translate(language, key, vars),
	};
}
