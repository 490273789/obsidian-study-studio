import { describe, expect, it, vi } from "vitest";
import { groupDictionaryFiles } from "../local-administration";

vi.mock("obsidian", () => ({ normalizePath: (value: string) => value }));

interface FileNameCounter {
	reads: number;
}

function trackedFile(name: string, webkitRelativePath: string, counter: FileNameCounter): File {
	return {
		get name() {
			counter.reads += 1;
			return name;
		},
		size: 1,
		webkitRelativePath,
	} as File;
}

function file(name: string, webkitRelativePath: string): File {
	return { name, size: 1, webkitRelativePath } as File;
}

describe("groupDictionaryFiles", () => {
	it("groups a large selection with a linear number of filename inspections", () => {
		const counter: FileNameCounter = { reads: 0 };
		const files = Array.from({ length: 120 }, (_, index) => {
			const name = `dictionary-${index}`;
			const directory = `bundle/${name}`;
			return [
				trackedFile(`${name}.mdx`, `${directory}/${name}.mdx`, counter),
				trackedFile(`${name}.mdd`, `${directory}/${name}.mdd`, counter),
				trackedFile(`${name}.css`, `${directory}/${name}.css`, counter),
				trackedFile(`${name}.js`, `${directory}/${name}.js`, counter),
			];
		}).flat();

		const groups = groupDictionaryFiles(files);

		expect(groups).toHaveLength(120);
		expect(counter.reads).toBe(files.length);
	});

	it("does not rescan every file for each dictionary in one flat directory", () => {
		const files = Array.from({ length: 120 }, (_, index) =>
			file(`dictionary-${index}.mdx`, `bundle/dictionary-${index}.mdx`),
		);
		const testPattern = vi.spyOn(RegExp.prototype, "test");
		let patternTestCount = 0;
		let groups: ReturnType<typeof groupDictionaryFiles> = [];
		try {
			groups = groupDictionaryFiles(files);
			patternTestCount = testPattern.mock.calls.length;
		} finally {
			testPattern.mockRestore();
		}

		expect(groups).toHaveLength(files.length);
		expect(patternTestCount).toBe(files.length);
	});

	it("preserves nested alternatives, resource ordering, and companion fallback rules", () => {
		const groups = groupDictionaryFiles([
			file("alpha.mdx", "alpha.mdx"),
			file("alpha.2.mdd", "alpha.2.mdd"),
			file("alpha.mdd", "alpha.mdd"),
			file("alpha.0.mdd", "alpha.0.mdd"),
			file("alpha.css", "alpha.css"),
			file("alpha.js", "alpha.js"),
			file("ＡLPHA.mdx", "selection/nested/ＡLPHA.mdx"),
			file("solo.mdx", "selection/solo/solo.mdx"),
			file("theme.css", "selection/solo/theme.css"),
			file("runtime.js", "selection/solo/runtime.js"),
			file("one.mdx", "selection/shared/one.mdx"),
			file("two.mdx", "selection/shared/two.mdx"),
			file("theme.css", "selection/shared/theme.css"),
			file("portable.eudic", "selection/portable.eudic"),
		]);

		expect(groups.map((group) => group.name)).toEqual([
			"alpha",
			"solo",
			"one",
			"two",
			"portable",
		]);
		expect(groups[0]?.files.map((item) => item.name)).toEqual([
			"alpha.mdx",
			"alpha.mdd",
			"alpha.0.mdd",
			"alpha.2.mdd",
			"alpha.css",
			"alpha.js",
		]);
		expect(groups[1]?.files.map((item) => item.name)).toEqual([
			"solo.mdx",
			"theme.css",
			"runtime.js",
		]);
		expect(groups[2]?.files.map((item) => item.name)).toEqual(["one.mdx"]);
		expect(groups[3]?.files.map((item) => item.name)).toEqual(["two.mdx"]);
		expect(groups[4]).toMatchObject({ format: "eudic" });
	});
});
