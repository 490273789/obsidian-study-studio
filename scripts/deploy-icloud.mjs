import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const targetDir =
	"/Users/ethan/Library/Mobile Documents/iCloud~md~obsidian/Documents/obsidianCloud/.obsidian/plugins/study-studio";
const filesToCopy = ["main.js", "manifest.json", "styles.css"];

async function assertFileExists(filePath) {
	const fileStat = await stat(filePath);

	if (!fileStat.isFile()) {
		throw new Error(`${filePath} is not a file`);
	}
}

await mkdir(targetDir, { recursive: true });

for (const fileName of filesToCopy) {
	const sourcePath = resolve(projectRoot, fileName);
	const targetPath = resolve(targetDir, basename(fileName));

	await assertFileExists(sourcePath);
	await copyFile(sourcePath, targetPath);
	console.log(`Copied ${fileName} -> ${targetPath}`);
}
