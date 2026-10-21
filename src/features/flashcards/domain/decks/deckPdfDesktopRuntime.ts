interface ElectronSaveDialogResult {
	canceled: boolean;
	filePath?: string;
}

interface ElectronDialog {
	showSaveDialog(
		browserWindow: ElectronBrowserWindow,
		options: {
			title: string;
			defaultPath: string;
			filters: Array<{ name: string; extensions: string[] }>;
			properties: string[];
		},
	): Promise<ElectronSaveDialogResult>;
}

interface ElectronWebContents {
	executeJavaScript(code: string): Promise<unknown>;
	setBackgroundThrottling(allowed: boolean): void;
	printToPDF(options: {
		displayHeaderFooter: boolean;
		landscape: boolean;
		pageSize: "A4";
		preferCSSPageSize: boolean;
		printBackground: boolean;
	}): Promise<Uint8Array>;
}

export interface ElectronBrowserWindow {
	webContents: ElectronWebContents;
	loadFile(filePath: string): Promise<void>;
	isDestroyed(): boolean;
	destroy(): void;
}

interface ElectronBrowserWindowConstructor {
	new (options: {
		show: boolean;
		width: number;
		height: number;
		backgroundColor: string;
		webPreferences: {
			backgroundThrottling: boolean;
		};
	}): ElectronBrowserWindow;
}

interface ObsidianDesktopWindow extends Window {
	electron?: {
		remote?: {
			BrowserWindow?: ElectronBrowserWindowConstructor;
			dialog?: ElectronDialog;
			getCurrentWindow?: () => ElectronBrowserWindow;
		};
	};
	electronWindow?: ElectronBrowserWindow;
	require?: (id: string) => unknown;
}

export interface DesktopPdfRuntime {
	browserWindow: ElectronBrowserWindow;
	dialog: ElectronDialog;
	createBackgroundWindow: () => ElectronBrowserWindow;
	createTemporaryDirectory: () => Promise<string>;
	joinPath: (...parts: string[]) => string;
	removeTemporaryDirectory: (path: string) => Promise<void>;
	writeFile: (filePath: string, data: string | Uint8Array) => Promise<void>;
}

interface DesktopPdfGlobals {
	readonly browserWindow: ElectronBrowserWindow;
	readonly dialog: ElectronDialog;
	readonly BrowserWindow: ElectronBrowserWindowConstructor;
	readonly requireModule: (id: string) => unknown;
}

/** Resolves the Electron handles the desktop PDF export needs, or null outside the desktop app. */
function resolveDesktopPdfGlobals(document: Document): DesktopPdfGlobals | null {
	const desktopWindow = document.defaultView as ObsidianDesktopWindow | null;
	const remote = desktopWindow?.electron?.remote;
	const browserWindow = desktopWindow?.electronWindow ?? remote?.getCurrentWindow?.();
	const dialog = remote?.dialog;
	const BrowserWindow = remote?.BrowserWindow;
	const requireModule = desktopWindow?.require;
	return browserWindow && dialog && BrowserWindow && requireModule
		? { browserWindow, dialog, BrowserWindow, requireModule }
		: null;
}

export function isDesktopPdfExportSupported(document: Document = activeDocument): boolean {
	return resolveDesktopPdfGlobals(document) !== null;
}

export function getDesktopPdfRuntime(document: Document = activeDocument): DesktopPdfRuntime {
	const globals = resolveDesktopPdfGlobals(document);
	if (!globals) {
		throw new Error("The Obsidian desktop PDF runtime is unavailable");
	}
	const { browserWindow, dialog, BrowserWindow, requireModule } = globals;

	const fileSystem = requireModule("node:fs/promises") as {
		mkdtemp: (prefix: string) => Promise<string>;
		rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
		writeFile: (filePath: string, data: string | Uint8Array) => Promise<void>;
	};
	const path = requireModule("node:path") as {
		join: (...parts: string[]) => string;
	};
	const operatingSystem = requireModule("node:os") as {
		tmpdir: () => string;
	};
	return {
		browserWindow,
		dialog,
		createBackgroundWindow: () =>
			new BrowserWindow({
				show: false,
				width: 794,
				height: 1123,
				backgroundColor: "#ffffff",
				webPreferences: {
					backgroundThrottling: false,
				},
			}),
		createTemporaryDirectory: () =>
			fileSystem.mkdtemp(path.join(operatingSystem.tmpdir(), "wsr-flash-card-pdf-")),
		joinPath: path.join,
		removeTemporaryDirectory: (temporaryPath) =>
			fileSystem.rm(temporaryPath, { recursive: true, force: true }),
		writeFile: fileSystem.writeFile,
	};
}

export async function yieldToUi(sourceWindow: Window | null): Promise<void> {
	if (!sourceWindow) {
		await Promise.resolve();
		return;
	}
	await new Promise<void>((resolve) => {
		sourceWindow.setTimeout(resolve, 0);
	});
}

export async function waitForPrintAssets(browserWindow: ElectronBrowserWindow): Promise<void> {
	await browserWindow.webContents.executeJavaScript(
		`(async () => {
			const pendingImages = Array.from(document.images).filter((image) => !image.complete);
			await Promise.race([
				Promise.all(
					pendingImages.map(
						(image) =>
							new Promise((resolve) => {
								image.addEventListener("load", resolve, { once: true });
								image.addEventListener("error", resolve, { once: true });
							}),
					),
				),
				new Promise((resolve) => setTimeout(resolve, 5000)),
			]);
			await document.fonts?.ready;
			await new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(resolve)),
			);
		})()`,
	);
}
