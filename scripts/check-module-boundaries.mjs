import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve("src");
const storageCommitFormat = path.join(
	sourceRoot,
	"features",
	"flashcards",
	"domain",
	"storage",
	"sessionCommitFormat",
);
const storageRoot = path.join(sourceRoot, "features", "flashcards", "domain", "storage");
const flashcardsDomainRoot = path.join(sourceRoot, "features", "flashcards", "domain");
/** PDF export documents this Obsidian exception; every other flashcards domain file stays pure. */
const flashcardsDomainObsidianException = path.join(
	flashcardsDomainRoot,
	"decks",
	"deckPdfExporter.ts",
);
const files = (await readdir(sourceRoot, { recursive: true }))
	.filter((file) => /\.(?:ts|tsx)$/.test(file))
	.map((file) => path.join(sourceRoot, file));
const violations = [];

for (const file of files) {
	const source = await readFile(file, "utf8");
	for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
		const specifier = match[1];
		if (
			specifier === "obsidian" &&
			isFlashcardsDomain(file) &&
			!isTestFile(file) &&
			file !== flashcardsDomainObsidianException
		) {
			violations.push(`${relative(file)} imports obsidian from the pure flashcards domain`);
		}
		if (!specifier?.startsWith(".")) continue;
		const target = path.normalize(path.resolve(path.dirname(file), specifier));
		const sourceFeature = featureId(file);
		const targetFeature = featureId(target);
		if (
			sourceFeature &&
			targetFeature &&
			sourceFeature !== targetFeature &&
			path.basename(file) !== "index.ts"
		) {
			violations.push(
				`${relative(file)} imports the ${targetFeature} feature (${specifier})`,
			);
		}
		if (isCore(file) && /[\\/]features[\\/][^\\/]+[\\/]ui(?:[\\/]|$)/.test(target)) {
			violations.push(`${relative(file)} imports feature UI (${specifier})`);
		}
		if (target === storageCommitFormat && !file.startsWith(storageRoot + path.sep)) {
			violations.push(
				`${relative(file)} imports storage-private session commit formatting (${specifier})`,
			);
		}
	}
}

if (violations.length > 0) {
	console.error(
		"Module-boundary violations:\n" + violations.map((item) => `- ${item}`).join("\n"),
	);
	process.exitCode = 1;
} else {
	console.log("Module-boundary checks passed.");
}

function featureId(file) {
	const parts = file.split(path.sep);
	const index = parts.lastIndexOf("features");
	return index >= 0 ? parts[index + 1] : null;
}

function isCore(file) {
	return file.split(path.sep).includes("core");
}

function isFlashcardsDomain(file) {
	return file.startsWith(flashcardsDomainRoot + path.sep);
}

function isTestFile(file) {
	return file.split(path.sep).includes("__tests__");
}

function relative(file) {
	return path.relative(process.cwd(), file);
}
