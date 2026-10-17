/** Counts are rendered in every row and the home hero; cache one formatter per language. */
const COUNT_FORMATTERS: Partial<Record<"zh" | "en", Intl.NumberFormat>> = {};

export function formatDeckCount(language: "zh" | "en", value: number): string {
	return (COUNT_FORMATTERS[language] ??= new Intl.NumberFormat(
		language === "zh" ? "zh-CN" : "en-US",
	)).format(value);
}
