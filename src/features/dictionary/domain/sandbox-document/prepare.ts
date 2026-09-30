import { dictionaryText } from "../messages";
import type { SandboxDocument } from "./document";
import { defineSandboxDocument, type DictionarySandboxStorageUpdater } from "./document";
import {
	createSandboxDocumentIdentity,
	DICTIONARY_SANDBOX_CHANNEL,
	DICTIONARY_SANDBOX_MAX_CONTENT_HEIGHT,
	DICTIONARY_SANDBOX_PROTOCOL_VERSION,
	sandboxMessageExpression,
} from "./protocol";

const SAFE_BLOCKED_ELEMENTS = [
	"script",
	"iframe",
	"object",
	"embed",
	"form",
	"input",
	"button",
	"textarea",
	"select",
	"option",
	"meta",
	"base",
	"link",
	"style",
] as const;
const LOCAL_COMPATIBILITY_BLOCKED_ELEMENTS = ["iframe", "object", "embed", "meta", "base"] as const;

const RESOURCE_ATTRIBUTES = ["background", "poster", "src"] as const;
const LOCAL_RESOURCE_DATA_ATTRIBUTES = [
	"data-audio",
	"data-background",
	"data-file",
	"data-href",
	"data-image",
	"data-original",
	"data-poster",
	"data-sound",
	"data-src",
	"data-url",
] as const;
const MAX_LOCAL_DOCUMENT_CHARACTERS = 8_388_608;
const MAX_LOCAL_STYLE_OR_SCRIPT_CHARACTERS = 8_388_608;
const MAX_STYLESHEET_IMPORT_DEPTH = 8;
const AUDIO_LINK_ATTRIBUTE = "data-obsidian-tools-dictionary-audio";
const ENTRY_LINK_ATTRIBUTE = "data-obsidian-tools-dictionary-entry";
const THEME_ATTRIBUTE = "data-obsidian-tools-dictionary-theme";

export type DictionaryResourceResolver = (path: string) => Promise<string | null>;

export interface DictionarySandboxOptions {
	readonly localCompatibility?: boolean;
	readonly resolveScript?: DictionaryScriptResolver;
	readonly resolveStylesheet?: DictionaryStylesheetResolver;
	readonly script?: string;
	readonly storage?: DictionarySandboxStorage;
}

export interface DictionarySandboxStorage {
	readonly values: Readonly<Record<string, string>>;
	readonly update: DictionarySandboxStorageUpdater;
}

export type DictionaryScriptResolver = (path: string) => Promise<string | null>;
export type DictionaryStylesheetResolver = (path: string) => Promise<string | null>;

function base64DataMime(value: string): string | null {
	if (!value.toLowerCase().startsWith("data:")) return null;
	const comma = value.indexOf(",");
	if (comma < 0) return null;
	const parts = value.slice("data:".length, comma).split(";");
	const mime = parts.shift()?.toLowerCase() ?? "";
	if (!/^[a-z\d][a-z\d!#$&^_.+-]*\/[a-z\d][a-z\d!#$&^_.+-]*$/.test(mime)) return null;
	if (parts.pop()?.toLowerCase() !== "base64") return null;
	if (
		!parts.every((part) => /^(?:utf8|[a-z\d][a-z\d!#$&^_.+-]*=[a-z\d!#$&^_.+-]+)$/i.test(part))
	) {
		return null;
	}
	const payload = value.slice(comma + 1);
	if (!/^[a-z\d+/]+={0,2}$/i.test(payload) || payload.length % 4 !== 0) return null;
	return mime;
}

function isSafeMediaDataUrl(value: string): boolean {
	const mime = base64DataMime(value);
	return (
		Boolean(
			mime &&
			/^(?:image\/(?:apng|avif|bmp|gif|jpeg|png|webp|x-icon|svg\+xml)|audio\/(?:aac|flac|mp4|mpeg|ogg|opus|wav|webm)|video\/(?:mp4|ogg|quicktime|webm))$/.test(
				mime,
			),
		) ||
		/^data:image\/svg\+xml(?:;charset=utf-8|;utf8)?,[a-z\d!$&'(*+,\-./:;=?@_%~]+$/i.test(value)
	);
}

function isSafeStylesheetDataUrl(value: string): boolean {
	const mime = base64DataMime(value);
	return Boolean(
		isSafeMediaDataUrl(value) ||
		(mime &&
			/^(?:font\/(?:otf|ttf|woff|woff2)|application\/(?:font-woff|vnd\.ms-fontobject|x-font-opentype|x-font-ttf|x-font-woff)|text\/css)$/.test(
				mime,
			)),
	);
}

function isSafePackagedDataUrl(value: string): boolean {
	const mime = base64DataMime(value);
	return Boolean(
		isSafeStylesheetDataUrl(value) ||
		(mime &&
			/^(?:application\/(?:javascript|json|manifest\+json|octet-stream|wasm|xml)|text\/(?:html|javascript|plain|vtt))$/.test(
				mime,
			)),
	);
}

function isSafeResolvedUrl(value: string): boolean {
	return isSafePackagedDataUrl(value) || /^blob:[^\s"'<>]+$/i.test(value);
}

function decodeBase64DataText(value: string, expectedMime: string): string | null {
	if (base64DataMime(value) !== expectedMime) return null;
	const comma = value.indexOf(",");
	try {
		const binary = atob(value.slice(comma + 1));
		if (binary.length > MAX_LOCAL_STYLE_OR_SCRIPT_CHARACTERS) return null;
		const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

function hasControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 0x20 || codePoint === 0x7f;
	});
}

function normalizeResourcePath(value: string, basePath = ""): string | null {
	const dictionaryRootPath = /^(?:eures|sound):\/\//i.test(value) || /^[\\/]/.test(value);
	const encoded =
		value
			.replace(/^(?:eures|sound):\/\//i, "")
			.split(/[?#]/, 1)[0]
			?.trim() ?? "";
	if (!encoded) return null;
	let decoded: string;
	try {
		decoded = decodeURIComponent(encoded).trim();
	} catch {
		return null;
	}
	if (
		!decoded ||
		hasControlCharacter(decoded) ||
		/^[a-z][a-z\d+.-]*:/i.test(decoded) ||
		decoded.startsWith("//")
	) {
		return null;
	}
	const parts = dictionaryRootPath
		? []
		: basePath.replaceAll("\\", "/").split("/").filter(Boolean).slice(0, -1);
	for (const part of decoded.replaceAll("\\", "/").split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (parts.length === 0) return null;
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	if (parts.length === 0) return null;
	return parts.join("/");
}

function resourceFragment(value: string): string {
	const index = value.indexOf("#");
	if (index < 0) return "";
	try {
		const fragment = decodeURIComponent(value.slice(index + 1));
		if (!fragment || fragment.length > 512 || hasControlCharacter(fragment)) return "";
		return `#${encodeURIComponent(fragment)}`;
	} catch {
		return "";
	}
}

function resolvedResourceUrl(value: string, path: string): string {
	return `${value}#${encodeURIComponent(path)}`;
}

async function safeStylesheet(
	value: string,
	resolveResource: DictionaryResourceResolver,
	resolveStylesheet?: DictionaryStylesheetResolver,
	basePath = "",
	importedPaths: ReadonlySet<string> = new Set(),
): Promise<string> {
	let stylesheet = value
		.slice(0, MAX_LOCAL_STYLE_OR_SCRIPT_CHARACTERS)
		.replaceAll("\0", "")
		.replace(/(?:expression|javascript|vbscript|-moz-binding|behavior)\s*[:(]/gi, "blocked(")
		.replace(/<\/style/gi, "\\3c /style");
	const imports = [
		...stylesheet.matchAll(
			/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*))\s*\)|"([^"]*)"|'([^']*)')([^;]*);?/gi,
		),
	];
	const importReplacements: string[] = [];
	await Promise.all(
		imports.map(async (match, index) => {
			const raw = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? "").trim();
			if (isSafeStylesheetDataUrl(raw)) {
				importReplacements[index] = match[0];
				return;
			}
			const path = normalizeResourcePath(raw, basePath);
			if (
				!path ||
				!resolveStylesheet ||
				importedPaths.has(path) ||
				importedPaths.size >= MAX_STYLESHEET_IMPORT_DEPTH
			) {
				importReplacements[index] = "";
				return;
			}
			const imported = await resolveStylesheet(path);
			if (!imported) {
				importReplacements[index] = "";
				return;
			}
			const nextImportedPaths = new Set(importedPaths);
			nextImportedPaths.add(path);
			const prepared = await safeStylesheet(
				imported,
				resolveResource,
				resolveStylesheet,
				path,
				nextImportedPaths,
			);
			const bytes = new TextEncoder().encode(prepared);
			let binary = "";
			for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
				binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
			}
			const condition = match[6]?.trim() ?? "";
			importReplacements[index] =
				`@import url("data:text/css;base64,${btoa(binary)}")${condition ? ` ${condition}` : ""};`;
		}),
	);
	let importIndex = 0;
	stylesheet = stylesheet.replace(
		/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*))\s*\)|"([^"]*)"|'([^']*)')([^;]*);?/gi,
		() => importReplacements[importIndex++] ?? "",
	);
	const matches = [...stylesheet.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)];
	const replacements = new Map<string, string>();
	await Promise.all(
		matches.map(async (match) => {
			const raw = match[2]?.trim() ?? "";
			if (!raw || replacements.has(raw)) return;
			if (raw.startsWith("#")) {
				replacements.set(raw, raw);
				return;
			}
			if (isSafeStylesheetDataUrl(raw)) {
				replacements.set(raw, raw);
				return;
			}
			const path = normalizeResourcePath(raw, basePath);
			const resolved = path ? await resolveResource(path) : null;
			replacements.set(
				raw,
				resolved && isSafeResolvedUrl(resolved)
					? `${resolved}${resourceFragment(raw)}`
					: "",
			);
		}),
	);
	stylesheet = stylesheet.replace(
		/url\(\s*(['"]?)(.*?)\1\s*\)/gi,
		(_match, _quote: string, raw: string) => `url("${replacements.get(raw.trim()) ?? ""}")`,
	);
	return stylesheet;
}

async function safeCompanionScript(
	value: string,
	resolveResource: DictionaryResourceResolver,
	basePath = "",
): Promise<{ paths: ReadonlySet<string>; script: string }> {
	let script = value
		.slice(0, MAX_LOCAL_STYLE_OR_SCRIPT_CHARACTERS)
		.replaceAll("\0", "")
		.replace(/<\/script/gi, "<\\/script");
	const matches = [...script.matchAll(/(['"])([^'"\\\r\n]{1,512})\1/g)];
	const replacements = new Map<string, string>();
	const paths = new Set<string>();
	await Promise.all(
		matches.map(async (match) => {
			const raw = match[2]?.trim() ?? "";
			if (
				!/\.(?:aac|apng|avif|bin|bmp|css|dat|eot|flac|gif|html?|ico|jpe?g|js|json|m4a|m4v|map|md|mov|mp3|mp4|oga?|ogv|opus|otf|png|svg|ttf|txt|vtt|wasm|weba|webm|webmanifest|webp|woff2?|xml)(?:[?#].*)?$/i.test(
					raw,
				)
			) {
				return;
			}
			if (replacements.has(raw)) return;
			const path = normalizeResourcePath(raw, basePath);
			const resolved = path ? await resolveResource(path) : null;
			if (path && resolved && isSafeResolvedUrl(resolved)) paths.add(path);
			replacements.set(
				raw,
				resolved && path && isSafeResolvedUrl(resolved)
					? resolvedResourceUrl(resolved, path)
					: raw,
			);
		}),
	);
	script = script.replace(
		/(['"])([^'"\\\r\n]{1,512})\1/g,
		(match, quote: string, raw: string) => {
			const replacement = replacements.get(raw.trim());
			if (!replacement) return match;
			const escaped = replacement.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`);
			return `${quote}${escaped}${quote}`;
		},
	);
	return { paths, script };
}

function audioPlaybackScript(documentId: string): string {
	const postMessage = sandboxMessageExpression(documentId, "play-audio", "{src:s}");
	return `<script nonce="${documentId}">(()=>{const p=e=>{const s=e.getAttribute('${AUDIO_LINK_ATTRIBUTE}');if(!/^(?:blob:|data:audio\\/(?:aac|flac|mp4|mpeg|ogg|opus|wav|webm);base64,[a-z\\d+/=]+$)/i.test(s||''))return;${postMessage}};document.addEventListener('click',e=>{const t=e.target instanceof Element?e.target.closest('[${AUDIO_LINK_ATTRIBUTE}]'):null;if(!t)return;e.preventDefault();p(t)},true);document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const t=e.target instanceof Element?e.target.closest('[${AUDIO_LINK_ATTRIBUTE}]'):null;if(!t)return;e.preventDefault();p(t)},true)})()</script>`;
}

function themeScript(documentId: string): string {
	return `<script nonce="${documentId}">addEventListener('message',e=>{const x=e.data;if(e.source!==parent||!x||x.channel!=='${DICTIONARY_SANDBOX_CHANNEL}'||x.version!==${DICTIONARY_SANDBOX_PROTOCOL_VERSION}||x.documentId!=='${documentId}'||x.action!=='set-theme')return;const t=x.payload?.theme;if(t!=='dark'&&t!=='light')return;const h=document.documentElement;h.setAttribute('${THEME_ATTRIBUTE}',t);h.style.colorScheme=t})</script>`;
}

function assistantEscapeScript(documentId: string): string {
	const postMessage = sandboxMessageExpression(documentId, "request-close", "null");
	return `<script nonce="${documentId}">if(document.documentElement.getAttribute('data-obsidian-tools-dictionary-close-on-escape')==='true')document.addEventListener('keydown',e=>{if(e.key!=='Escape'||e.isComposing)return;e.preventDefault();${postMessage}},true)</script>`;
}

function contentFitScript(documentId: string): string {
	const postMessage = sandboxMessageExpression(documentId, "content-height", "h");
	return `<script nonce="${documentId}">(()=>{
if(document.documentElement.getAttribute('data-obsidian-tools-dictionary-fit-content')!=='true')return;
let frame=0,last=0,growing=0,active=true,resize,mutation;
const stop=()=>{if(!active)return;active=false;if(frame)cancelAnimationFrame(frame);frame=0;resize?.disconnect();mutation?.disconnect();document.removeEventListener('load',schedule,true);removeEventListener('resize',schedule);document.fonts?.removeEventListener('loadingdone',schedule)};
const measure=()=>{frame=0;if(!active||!document.body)return;const b=document.body,s=getComputedStyle(b);const raw=Math.max(1,Math.ceil(Math.max(b.scrollHeight,b.getBoundingClientRect().height)+Math.max(0,parseFloat(s.marginTop)||0)+Math.max(0,parseFloat(s.marginBottom)||0)));const h=Math.min(${DICTIONARY_SANDBOX_MAX_CONTENT_HEIGHT},raw);growing=h>last?growing+1:0;if(raw>${DICTIONARY_SANDBOX_MAX_CONTENT_HEIGHT}||growing>=8){document.documentElement.setAttribute('data-obsidian-tools-dictionary-fit-bounded','true');stop()}if(h===last)return;last=h;${postMessage}};
const schedule=()=>{if(active&&!frame)frame=requestAnimationFrame(measure)};
const start=()=>{if(!active)return;if(typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(schedule);resize.observe(document.body)}if(typeof MutationObserver!=='undefined'){mutation=new MutationObserver(schedule);mutation.observe(document.body,{attributes:true,childList:true,characterData:true,subtree:true})}schedule()};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
document.addEventListener('load',schedule,true);addEventListener('resize',schedule);document.fonts?.addEventListener('loadingdone',schedule);document.fonts?.ready.then(schedule);
addEventListener('pagehide',stop,{once:true});
})()</script>`;
}

function storageCompatibilityScript(
	documentId: string,
	values: Readonly<Record<string, string>>,
): string {
	const serialized = JSON.stringify(values)
		.replaceAll("<", "\\u003c")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
	const postMessage = sandboxMessageExpression(documentId, "storage-update", "m");
	return `<script nonce="${documentId}">(()=>{const d=Object.assign(Object.create(null),${serialized}),k=()=>Object.keys(d),p=m=>{${postMessage}},q=(n,v)=>{n=String(n);v=String(v);if(!n||n.length>128||n.includes('\\0')||v.length>16384||v.includes('\\0'))return false;const x={...d,[n]:v};if(Object.keys(x).length>128||JSON.stringify(x).length>262144)return false;d[n]=v;return true},a={get length(){return k().length},key:n=>Number.isInteger(n)&&n>=0?k()[n]??null:null,getItem:n=>Object.hasOwn(d,String(n))?d[String(n)]:null,setItem:(n,v)=>{n=String(n);v=String(v);if(q(n,v))p({operation:'set',key:n,value:v})},removeItem:n=>{n=String(n);if(!Object.hasOwn(d,n))return;delete d[n];p({operation:'remove',key:n})},clear:()=>{if(!k().length)return;for(const n of k())delete d[n];p({operation:'clear'})}};const s=new Proxy(a,{ownKeys:()=>k(),getOwnPropertyDescriptor:(_,n)=>typeof n==='string'&&Object.hasOwn(d,n)?{configurable:true,enumerable:true,writable:true,value:d[n]}:undefined,get:(t,n)=>typeof n==='string'&&Object.hasOwn(d,n)?d[n]:Reflect.get(t,n),set:(_,n,v)=>typeof n==='string'&&(a.setItem(n,v),true),deleteProperty:(_,n)=>typeof n==='string'&&(a.removeItem(n),true),has:(t,n)=>typeof n==='string'&&Object.hasOwn(d,n)||Reflect.has(t,n)});try{Object.defineProperty(window,'localStorage',{configurable:true,value:s})}catch{}})()</script>`;
}

function entryNavigationScript(documentId: string): string {
	const postMessage = sandboxMessageExpression(documentId, "open-entry", "{term:w}");
	return `<script nonce="${documentId}">document.addEventListener('click',e=>{const t=e.target instanceof Element?e.target.closest('a,[${ENTRY_LINK_ATTRIBUTE}]'):null;if(!t)return;const h=t.getAttribute('href')||'';let w=t.getAttribute('${ENTRY_LINK_ATTRIBUTE}')||'';if(!w){const m=new RegExp('^(?:dic|entry)://([^#?]+)','i').exec(h);if(m)try{w=decodeURIComponent(m[1]).replace(/\\s+/g,' ').trim()}catch{}else if(h.toLowerCase().startsWith('/definition/'))w=(t.textContent||'').replace(/\\s+/g,' ').trim()}if(!w||w.length>128||w.includes('\\0'))return;e.preventDefault();${postMessage}})</script>`;
}

function localNavigationGuardScript(documentId: string): string {
	return `<script nonce="${documentId}">(()=>{const g=e=>{const t=e.target instanceof Element?e.target.closest('a[href],area[href]'):null;if(!t)return;const h=t.getAttribute('href')||'';if(!h||h.startsWith('#')||t.hasAttribute('${AUDIO_LINK_ATTRIBUTE}')||t.hasAttribute('${ENTRY_LINK_ATTRIBUTE}'))return;e.preventDefault()};document.addEventListener('click',g,true);document.addEventListener('auxclick',g,true)})()</script>`;
}

function isDangerousHref(value: string): boolean {
	const normalized = value.trim();
	return (
		hasControlCharacter(normalized) ||
		/^(?:data|javascript|vbscript):/i.test(normalized) ||
		normalized.startsWith("//")
	);
}

interface SourceSetCandidate {
	readonly descriptor: string;
	readonly url: string;
}

function parseSourceSet(value: string): readonly SourceSetCandidate[] | null {
	const candidates: SourceSetCandidate[] = [];
	let offset = 0;
	while (offset < value.length) {
		while (/[\s,]/.test(value[offset] ?? "")) offset += 1;
		if (offset >= value.length) break;
		const start = offset;
		const isData = value.slice(offset, offset + 5).toLowerCase() === "data:";
		while (offset < value.length && !/\s/.test(value[offset] ?? "")) {
			if (!isData && value[offset] === ",") break;
			offset += 1;
		}
		const url = value.slice(start, offset);
		while (/\s/.test(value[offset] ?? "")) offset += 1;
		const descriptorStart = offset;
		while (offset < value.length && value[offset] !== ",") offset += 1;
		const descriptor = value.slice(descriptorStart, offset).trim();
		if (!url || (descriptor && !/^(?:\d+w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor))) {
			return null;
		}
		candidates.push({ descriptor, url });
		if (value[offset] === ",") offset += 1;
	}
	return candidates.length > 0 ? candidates : null;
}

async function safeSourceSet(
	value: string,
	resolveResource: DictionaryResourceResolver,
): Promise<string> {
	const candidates = parseSourceSet(value);
	if (!candidates) return "";
	const resolved = await Promise.all(
		candidates.map(async ({ descriptor, url }) => {
			let safeUrl = "";
			if (/^data:image\//i.test(url) && isSafeMediaDataUrl(url)) safeUrl = url;
			else {
				const path = normalizeResourcePath(url);
				const resourceUrl = path ? await resolveResource(path) : null;
				if (
					resourceUrl &&
					(/^data:image\//i.test(resourceUrl) || resourceUrl.startsWith("blob:"))
				) {
					safeUrl = `${resourceUrl}${resourceFragment(url)}`;
				}
			}
			return safeUrl ? `${safeUrl}${descriptor ? ` ${descriptor}` : ""}` : "";
		}),
	);
	return resolved.filter(Boolean).join(", ");
}

function decodeEntryWord(value: string): string {
	try {
		return decodeURIComponent(value).replace(/\s+/g, " ").trim();
	} catch {
		return "";
	}
}

function dictionaryEntryWord(element: HTMLElement, href: string): string {
	if (/^dic:\/\//i.test(href)) {
		return decodeEntryWord(href.slice("dic://".length).split("#", 1)[0] ?? "");
	}
	if (/^entry:\/\//i.test(href)) {
		return decodeEntryWord(href.slice("entry://".length).split("#", 1)[0] ?? "");
	}
	if (element.tagName === "A" && /^\/definition\//i.test(href)) {
		const label = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
		if (label) return label;
		const path = href.split(/[?#]/, 1)[0] ?? "";
		return decodeEntryWord(/([^/]+)$/.exec(path)?.[1] ?? "");
	}
	return "";
}

function sandboxDocument(
	documentId: string,
	body: string,
	stylesheet: string,
	hasAudioLinks: boolean,
	hasEntryLinks: boolean,
	options: Readonly<DictionarySandboxOptions>,
): string {
	const localCompatibility = options.localCompatibility === true;
	const policy = [
		"default-src 'none'",
		"img-src data: blob:",
		"media-src data: blob:",
		...(localCompatibility
			? [
					"script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:",
					"connect-src data: blob:",
					"worker-src data: blob:",
				]
			: [`script-src 'nonce-${documentId}'`]),
		`style-src 'unsafe-inline'${localCompatibility ? " data: blob:" : ""}`,
		"font-src data: blob:",
		"base-uri 'none'",
		"frame-src 'none'",
		"navigate-to 'none'",
		"object-src 'none'",
		"form-action 'none'",
	].join("; ");
	const strictStyles = localCompatibility
		? ""
		: "<style>body{margin:0;color:CanvasText;background:Canvas;font:14px/1.65 system-ui,sans-serif}a{color:inherit}table{max-width:100%;border-collapse:collapse}td,th{padding:.25rem;border:1px solid #9995}</style>";
	const customStyles = stylesheet ? `<style>${stylesheet}</style>` : "";
	const responsiveMediaStyles =
		'<style data-obsidian-tools-dictionary-responsive>html,body{max-width:100%}html{scrollbar-color:color-mix(in srgb,CanvasText 32%,transparent) transparent;scrollbar-width:thin}body{overflow-x:hidden}img{box-sizing:border-box;max-width:100%!important;height:auto!important}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{border:1px solid transparent;border-radius:50%;background:color-mix(in srgb,CanvasText 32%,transparent);background-clip:padding-box}::-webkit-scrollbar-thumb:hover,::-webkit-scrollbar-thumb:active{border-width:1px;background:color-mix(in srgb,CanvasText 48%,transparent);background-clip:padding-box}::-webkit-scrollbar-corner{background:transparent}html[data-obsidian-tools-dictionary-theme="dark"] .sectionHead .title,html[data-obsidian-tools-dictionary-theme="dark"] .sectionHeadDict .title,html[data-obsidian-tools-dictionary-theme="dark"] .treePart .part,html[data-obsidian-tools-dictionary-theme="dark"] .rootAffixLi .preCont,html[data-obsidian-tools-dictionary-theme="dark"] .sameRoot .nameBox .name,html[data-obsidian-tools-dictionary-theme="dark"] .sentenceInfo .trans,html[data-obsidian-tools-dictionary-theme="dark"] .sectionCont .minCont .weight,html[data-obsidian-tools-dictionary-theme="dark"] .wordcls{color:CanvasText}html[data-obsidian-tools-dictionary-theme="dark"] .cutUpLine{background:color-mix(in srgb,CanvasText 10%,Canvas)}html[data-obsidian-tools-dictionary-theme="dark"] .cutUpDashed,html[data-obsidian-tools-dictionary-theme="dark"] .treePart .smLine,html[data-obsidian-tools-dictionary-theme="dark"] .sameRootInfo .smLine{border-color:color-mix(in srgb,CanvasText 20%,Canvas)}html[data-obsidian-tools-dictionary-theme="dark"] .treePart .part .rootWord,html[data-obsidian-tools-dictionary-theme="dark"] .rootWord{background:color-mix(in srgb,#51abff 25%,Canvas);color:#a0cfff}html[data-obsidian-tools-dictionary-theme="dark"] .treePart .part .affixWord,html[data-obsidian-tools-dictionary-theme="dark"] .affixWord{background:color-mix(in srgb,CanvasText 12%,Canvas);color:CanvasText}html[data-obsidian-tools-dictionary-theme="dark"] .rootAffixLi .prefix{background:color-mix(in srgb,CanvasText 15%,Canvas);color:color-mix(in srgb,CanvasText 80%,Canvas)}html[data-obsidian-tools-dictionary-theme="dark"] .sentenceInfo .sentence{background:color-mix(in srgb,CanvasText 8%,Canvas);color:color-mix(in srgb,CanvasText 75%,Canvas)}html[data-obsidian-tools-dictionary-theme="dark"] .sentenceInfo .sentence .exp{color:color-mix(in srgb,CanvasText 90%,Canvas)}html[data-obsidian-tools-dictionary-theme="dark"] .wordDetail .wordParam{color:color-mix(in srgb,CanvasText 60%,Canvas)}html[data-obsidian-tools-dictionary-theme="dark"] .wordDetail .wordParam .arrow,html[data-obsidian-tools-dictionary-theme="dark"] .sectionHead .togArrow,html[data-obsidian-tools-dictionary-theme="dark"] .sectionHeadDict .togArrow{border-color:color-mix(in srgb,CanvasText 50%,Canvas)}</style>';
	const storageScript =
		localCompatibility && options.storage
			? storageCompatibilityScript(documentId, options.storage.values)
			: "";
	const audioScript = hasAudioLinks ? audioPlaybackScript(documentId) : "";
	const entryScript =
		hasEntryLinks || localCompatibility ? entryNavigationScript(documentId) : "";
	const navigationScript = localCompatibility ? localNavigationGuardScript(documentId) : "";
	const companionScript = localCompatibility ? (options.script ?? "") : "";
	const dictionaryScript = companionScript ? `<script>${companionScript}</script>` : "";
	const contentFitStyles =
		'<style>html[data-obsidian-tools-dictionary-fit-content="true"],html[data-obsidian-tools-dictionary-fit-content="true"] body{height:auto!important;min-height:0!important;max-height:none!important}html[data-obsidian-tools-dictionary-fit-content="true"]:not([data-obsidian-tools-dictionary-fit-bounded="true"]),html[data-obsidian-tools-dictionary-fit-content="true"]:not([data-obsidian-tools-dictionary-fit-bounded="true"]) body{overflow-y:hidden!important}html[data-obsidian-tools-dictionary-fit-bounded="true"]{overflow-y:auto!important}html[data-obsidian-tools-dictionary-fit-bounded="true"] body{overflow-y:visible!important}</style>';
	return `<!doctype html><html ${THEME_ATTRIBUTE}="light"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${assistantEscapeScript(documentId)}${contentFitScript(documentId)}${strictStyles}${customStyles}${responsiveMediaStyles}${contentFitStyles}</head><body>${storageScript}${body}${themeScript(documentId)}${dictionaryScript}${navigationScript}${audioScript}${entryScript}</body></html>`;
}

export async function prepareDictionarySandboxDocument(
	html: string,
	resolveResource: DictionaryResourceResolver,
	stylesheet = "",
	options: Readonly<DictionarySandboxOptions> = {},
): Promise<SandboxDocument> {
	const documentId = createSandboxDocumentIdentity();
	const localCompatibility = options.localCompatibility === true;
	const documentNode = new DOMParser().parseFromString(
		html.slice(0, localCompatibility ? MAX_LOCAL_DOCUMENT_CHARACTERS : 1_000_000),
		"text/html",
	);
	const preparedScript =
		localCompatibility && options.script
			? await safeCompanionScript(options.script, resolveResource)
			: { paths: new Set<string>(), script: options.script ?? "" };
	const scriptResourcePaths = new Set(preparedScript.paths);
	const preparedOptions: Readonly<DictionarySandboxOptions> =
		localCompatibility && preparedScript.script
			? { ...options, script: preparedScript.script }
			: options;
	const blockedElements = localCompatibility
		? LOCAL_COMPATIBILITY_BLOCKED_ELEMENTS
		: SAFE_BLOCKED_ELEMENTS;
	for (const selector of blockedElements) {
		for (const element of documentNode.querySelectorAll(selector)) element.remove();
	}
	const embeddedStylesheets: string[] = [];
	const localScriptTasks: Promise<void>[] = [];
	if (localCompatibility) {
		const inlineScripts = Array.from(
			documentNode.querySelectorAll<HTMLScriptElement>("script:not([src])"),
		);
		await Promise.all(
			Array.from(documentNode.querySelectorAll<HTMLLinkElement>("link")).map(
				async (element) => {
					const href = element.getAttribute("href") ?? "";
					const embeddedStylesheet = element.relList.contains("stylesheet")
						? decodeBase64DataText(href, "text/css")
						: null;
					const path = embeddedStylesheet === null ? normalizeResourcePath(href) : null;
					const resolvedStylesheet =
						embeddedStylesheet ??
						(element.relList.contains("stylesheet") && path && options.resolveStylesheet
							? await options.resolveStylesheet(path)
							: null);
					if (!resolvedStylesheet) {
						element.remove();
						return;
					}
					const replacement = documentNode.createElement("style");
					replacement.textContent = await safeStylesheet(
						resolvedStylesheet,
						resolveResource,
						options.resolveStylesheet,
						path ?? "",
						path ? new Set([path]) : new Set(),
					);
					element.replaceWith(replacement);
				},
			),
		);
		for (const element of documentNode.querySelectorAll<HTMLScriptElement>("script[src]")) {
			const source = element.getAttribute("src") ?? "";
			const sourceMime = base64DataMime(source);
			if (
				isSafePackagedDataUrl(source) &&
				(sourceMime === "text/javascript" || sourceMime === "application/javascript")
			) {
				element.removeAttribute("crossorigin");
				element.removeAttribute("integrity");
				element.removeAttribute("referrerpolicy");
				continue;
			}
			const path = normalizeResourcePath(source);
			element.removeAttribute("src");
			element.removeAttribute("crossorigin");
			element.removeAttribute("integrity");
			element.removeAttribute("referrerpolicy");
			if (!path || !options.resolveScript) {
				element.remove();
				continue;
			}
			localScriptTasks.push(
				options.resolveScript(path).then(async (value) => {
					if (!value) {
						element.remove();
						return;
					}
					const prepared = await safeCompanionScript(value, resolveResource, path);
					element.textContent = prepared.script;
					for (const resourcePath of prepared.paths)
						scriptResourcePaths.add(resourcePath);
					return undefined;
				}),
			);
		}
		for (const element of inlineScripts) {
			localScriptTasks.push(
				safeCompanionScript(element.textContent ?? "", resolveResource).then((prepared) => {
					element.textContent = prepared.script;
					for (const resourcePath of prepared.paths)
						scriptResourcePaths.add(resourcePath);
					return undefined;
				}),
			);
		}
		documentNode.body.prepend(
			...documentNode.querySelectorAll<HTMLScriptElement>("head script"),
		);
		for (const element of documentNode.querySelectorAll<HTMLStyleElement>("style")) {
			embeddedStylesheets.push(element.textContent ?? "");
			element.remove();
		}
		for (const input of documentNode.querySelectorAll<HTMLInputElement>(
			'input[type="file"],input[type="password"]',
		)) {
			input.remove();
		}
	}
	await Promise.all(localScriptTasks);

	const resourceTasks: Promise<void>[] = [];
	let hasAudioLinks = false;
	let hasEntryLinks = false;
	for (const element of documentNode.body.querySelectorAll<HTMLElement>("*")) {
		for (let index = element.attributes.length - 1; index >= 0; index -= 1) {
			const attribute = element.attributes.item(index);
			if (!attribute) continue;
			const name = attribute.name.toLowerCase();
			if (
				(!localCompatibility && (name.startsWith("on") || name === "style")) ||
				name === AUDIO_LINK_ATTRIBUTE ||
				name === ENTRY_LINK_ATTRIBUTE
			) {
				element.removeAttribute(attribute.name);
			}
			if (localCompatibility && name.startsWith("on")) {
				resourceTasks.push(
					safeCompanionScript(attribute.value, resolveResource).then((prepared) => {
						element.setAttribute(attribute.name, prepared.script);
						for (const resourcePath of prepared.paths)
							scriptResourcePaths.add(resourcePath);
						return undefined;
					}),
				);
			}
		}
		if (localCompatibility && element.hasAttribute("style")) {
			const inlineStyle = element.getAttribute("style") ?? "";
			resourceTasks.push(
				safeStylesheet(inlineStyle, resolveResource, options.resolveStylesheet).then(
					(value) => {
						if (value) element.setAttribute("style", value);
						else element.removeAttribute("style");
						return undefined;
					},
				),
			);
		}
		const sourceSet = element.getAttribute("srcset");
		if (sourceSet) {
			element.removeAttribute("srcset");
			if (localCompatibility) {
				resourceTasks.push(
					safeSourceSet(sourceSet, resolveResource).then((value) => {
						if (value) element.setAttribute("srcset", value);
						return undefined;
					}),
				);
			}
		}
		const deferredSourceSet = element.getAttribute("data-srcset");
		if (localCompatibility && deferredSourceSet) {
			resourceTasks.push(
				safeSourceSet(deferredSourceSet, resolveResource).then((value) => {
					if (value) element.setAttribute("data-srcset", value);
					return undefined;
				}),
			);
		}
		const href = element.getAttribute("href");
		if (href && !href.startsWith("#")) {
			const safePackagedHref = isSafePackagedDataUrl(href);
			if (!localCompatibility || (isDangerousHref(href) && !safePackagedHref)) {
				element.removeAttribute("href");
			}
			const word = dictionaryEntryWord(element, href);
			if (word && word.length <= 128 && !word.includes("\0")) {
				element.setAttribute("href", localCompatibility ? href : "#");
				element.setAttribute(ENTRY_LINK_ATTRIBUTE, word);
				hasEntryLinks = true;
			}
			const path = /^sound:\/\//i.test(href) ? normalizeResourcePath(href) : null;
			if (path) {
				resourceTasks.push(
					(async () => {
						const resolved = await resolveResource(path);
						if (
							!resolved ||
							!isSafeResolvedUrl(resolved) ||
							(!/^data:audio\//i.test(resolved) && !resolved.startsWith("blob:"))
						) {
							return;
						}
						element.setAttribute("href", localCompatibility ? href : "#");
						element.setAttribute(AUDIO_LINK_ATTRIBUTE, resolved);
						if (!element.hasAttribute("aria-label")) {
							const label = element
								.querySelector<HTMLElement>("[alt]")
								?.getAttribute("alt")
								?.trim();
							element.setAttribute(
								"aria-label",
								label || dictionaryText().playLocalAudio,
							);
						}
						element.setAttribute("role", "button");
						element.setAttribute("tabindex", "0");
						hasAudioLinks = true;
					})(),
				);
			}
			if (localCompatibility && safePackagedHref && /^data:audio\//i.test(href)) {
				element.setAttribute(AUDIO_LINK_ATTRIBUTE, href);
				if (!element.hasAttribute("aria-label")) {
					element.setAttribute("aria-label", dictionaryText().playLocalAudio);
				}
				element.setAttribute("role", "button");
				element.setAttribute("tabindex", "0");
				hasAudioLinks = true;
			}
			const linkedResourcePath =
				localCompatibility && !path && !word ? normalizeResourcePath(href) : null;
			if (linkedResourcePath) {
				resourceTasks.push(
					(async () => {
						const resolved = await resolveResource(linkedResourcePath);
						if (!resolved || !isSafeResolvedUrl(resolved)) return;
						element.setAttribute("href", `${resolved}${resourceFragment(href)}`);
						if (!/^data:audio\//i.test(resolved)) return;
						element.setAttribute(AUDIO_LINK_ATTRIBUTE, resolved);
						if (!element.hasAttribute("aria-label")) {
							element.setAttribute("aria-label", dictionaryText().playLocalAudio);
						}
						element.setAttribute("role", "button");
						element.setAttribute("tabindex", "0");
						hasAudioLinks = true;
					})(),
				);
			}
		}
		for (const attribute of RESOURCE_ATTRIBUTES) {
			const value = element.getAttribute(attribute);
			if (!value) continue;
			if (isSafeMediaDataUrl(value)) continue;
			const path = normalizeResourcePath(value);
			element.removeAttribute(attribute);
			if (!path) continue;
			resourceTasks.push(
				(async () => {
					const resolved = await resolveResource(path);
					if (resolved && isSafeResolvedUrl(resolved)) {
						const fragment = resourceFragment(value);
						element.setAttribute(
							attribute,
							fragment
								? `${resolved}${fragment}`
								: scriptResourcePaths.has(path)
									? resolvedResourceUrl(resolved, path)
									: resolved,
						);
					}
				})(),
			);
		}
		if (localCompatibility) {
			for (const attribute of LOCAL_RESOURCE_DATA_ATTRIBUTES) {
				const value = element.getAttribute(attribute);
				if (!value || isSafeResolvedUrl(value)) continue;
				if (/^(?:eures|sound):\/\/?$/i.test(value.trim()) || value.trim() === "/") {
					element.setAttribute(attribute, "");
					continue;
				}
				const path = normalizeResourcePath(value);
				if (!path) continue;
				resourceTasks.push(
					(async () => {
						const resolved = await resolveResource(path);
						if (resolved && isSafeResolvedUrl(resolved)) {
							element.setAttribute(
								attribute,
								`${resolved}${resourceFragment(value)}`,
							);
						}
					})(),
				);
			}

			if (element.namespaceURI === "http://www.w3.org/2000/svg") {
				const tagName = element.tagName.toLowerCase();
				if (tagName === "use" || tagName === "image" || tagName === "feimage") {
					for (const attribute of ["href", "xlink:href"] as const) {
						const value = element.getAttribute(attribute);
						if (!value || value.startsWith("#") || isSafeResolvedUrl(value)) continue;
						const path = normalizeResourcePath(value);
						if (!path) continue;
						resourceTasks.push(
							(async () => {
								const resolved = await resolveResource(path);
								if (resolved && isSafeResolvedUrl(resolved)) {
									element.setAttribute(
										attribute,
										`${resolved}${resourceFragment(value)}`,
									);
								}
							})(),
						);
					}
				}
			}
		}
	}
	await Promise.all(resourceTasks);
	return defineSandboxDocument(
		documentId,
		sandboxDocument(
			documentId,
			documentNode.body.innerHTML,
			await safeStylesheet(
				[stylesheet, ...embeddedStylesheets].join("\n"),
				resolveResource,
				options.resolveStylesheet,
			),
			hasAudioLinks,
			hasEntryLinks,
			preparedOptions,
		),
		preparedOptions.storage?.update,
	);
}
