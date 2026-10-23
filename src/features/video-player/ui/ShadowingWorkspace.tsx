import React, { useMemo, useState } from "react";
import type { Language } from "../../../core/shared/types";
import styles from "./ShadowingWorkspace.module.scss";

export interface ShadowingCueRow {
	id: string;
	start: number;
	end: number;
	text: string;
	translation?: string | null;
	needsReview?: boolean;
}

export interface ShadowingRecordRow {
	id: string;
	start: number;
	end: number;
	text: string;
	kind: "difficult" | "recording";
	createdAt?: number;
	playbackRate?: number;
}

export interface ShadowingWorkspaceState {
	enabled: boolean;
	status: "idle" | "queued" | "transcribing" | "translating" | "paused" | "error" | "complete";
	processedSeconds: number;
	totalSeconds: number | null;
	taskError: string | null;
	translationFailed: boolean;
	cues: readonly ShadowingCueRow[];
	records: readonly ShadowingRecordRow[];
	failedSaves: readonly {
		id: string;
		sourceId: string;
		start: number;
		end: number;
		text: string;
	}[];
	hasCandidate: boolean;
	hasPrevious: boolean;
	practicePhase: string;
	practiceMode: "shadow" | "repeat-after";
	practiceStart: number | null;
	practiceEnd: number | null;
	countdown: number;
	restSeconds: number;
	responseMultiplier: number;
	hasTemporaryTake: boolean;
	savingTake: boolean;
	practiceError: string | null;
}

export interface ShadowingWorkspaceActions {
	generate: () => void;
	translateImported: () => void;
	retryTranslation: () => void;
	reloadSubtitles: () => void;
	pauseGeneration: () => void;
	resumeGeneration: () => void;
	importFile: (file: File, role: "original" | "translation" | "bilingual") => void;
	adoptCandidate: () => void;
	restorePrevious: () => void;
	editCue: (id: string, text: string, translation: string) => void;
	selectRange: (start: number, end: number, text: string) => void;
	seekTo: (seconds: number) => void;
	setMode: (mode: "shadow" | "repeat-after") => void;
	setRestSeconds: (seconds: number) => void;
	setResponseMultiplier: (multiplier: number) => void;
	continueEarly: () => void;
	startLoop: () => void;
	stopPractice: () => void;
	recordOnce: () => void;
	replayTake: () => void;
	replayOriginal: () => void;
	saveTake: () => void;
	retrySave: (takeId: string) => void;
	continueWatching: () => void;
	markDifficult: () => void;
	openRecord: (record: ShadowingRecordRow) => void;
	deleteRecord: (record: ShadowingRecordRow) => void;
}

export interface ShadowingWorkspaceProps {
	language: Language;
	currentTime: number;
	duration: number | null;
	state: ShadowingWorkspaceState;
	actions: ShadowingWorkspaceActions;
}

function clock(seconds: number): string {
	const whole = Math.floor(Math.max(0, seconds));
	return `${Math.floor(whole / 60)
		.toString()
		.padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
}

const copy = {
	zh: {
		subtitles: "双语字幕",
		records: "练习记录",
		tasks: "字幕任务",
		generate: "生成双语字幕",
		import: "导入字幕",
		original: "英文原文",
		translation: "中文翻译",
		bilingual: "双语字幕",
		pause: "暂停任务",
		resume: "继续任务",
		adopt: "采用候选字幕",
		restore: "恢复上一版",
		start: "练习所选片段",
		stop: "停止跟读",
		continuous: "连续跟读",
		repeatAfter: "听完再说",
		record: "录一遍",
		playMine: "听我的录音",
		playOriginal: "听原声",
		save: "保留录音",
		continue: "继续观看",
		difficult: "标记难段",
		edit: "修正当前字幕",
		text: "英文原文",
		translationText: "中文翻译",
		saveEdit: "保存修正",
		startTime: "起点（秒）",
		endTime: "终点（秒）",
		noCues: "尚无可用字幕。可以导入字幕，或启动 AI 生成。",
		noRecords: "还没有标记难段或保留录音。",
		delete: "删除记录",
		draft: "AI 草稿",
		ready: "可练习",
		inProgress: "正在处理",
		translationPending: "翻译中…",
		translateImported: "只补全中文翻译",
		retryTranslation: "重试未完成翻译",
		reloadSubtitles: "重新载入资料库字幕（放弃未保存更改）",
		retrySave: "重试保存录音",
		failedSave: "录音尚未保存",
		restSeconds: "停顿秒数",
		responseMultiplier: "跟读时间倍数",
		continueEarly: "提前继续",
	},
	en: {
		subtitles: "Bilingual subtitles",
		records: "Practice records",
		tasks: "Subtitle tasks",
		generate: "Generate bilingual subtitles",
		import: "Import subtitles",
		original: "English original",
		translation: "Chinese translation",
		bilingual: "Bilingual subtitles",
		pause: "Pause task",
		resume: "Resume task",
		adopt: "Use candidate subtitles",
		restore: "Restore previous version",
		start: "Practice selection",
		stop: "Stop practice",
		continuous: "Continuous shadowing",
		repeatAfter: "Listen, then repeat",
		record: "Record one take",
		playMine: "Play my recording",
		playOriginal: "Play original",
		save: "Keep recording",
		continue: "Continue watching",
		difficult: "Mark difficult range",
		edit: "Correct current subtitle",
		text: "English original",
		translationText: "Chinese translation",
		saveEdit: "Save correction",
		startTime: "Start (seconds)",
		endTime: "End (seconds)",
		noCues: "No subtitles yet. Import a file or start AI generation.",
		noRecords: "No difficult ranges or saved recordings yet.",
		delete: "Delete record",
		draft: "AI draft",
		ready: "Ready to practice",
		inProgress: "Processing",
		translationPending: "Translating…",
		translateImported: "Translate current subtitles",
		retryTranslation: "Retry missing translations",
		reloadSubtitles: "Reload vault subtitles (discard unsaved changes)",
		retrySave: "Retry saving take",
		failedSave: "Unsaved recording",
		restSeconds: "Rest seconds",
		responseMultiplier: "Response time factor",
		continueEarly: "Continue now",
	},
} as const;

/** One compact surface shared by the docked player and its floating presentation. */
export function ShadowingWorkspace({
	language,
	currentTime,
	duration,
	state,
	actions,
}: ShadowingWorkspaceProps): React.ReactNode {
	const t = copy[language];
	const [tab, setTab] = useState<"subtitles" | "records" | "tasks">("subtitles");
	const [anchor, setAnchor] = useState<string | null>(null);
	const [endId, setEndId] = useState<string | null>(null);
	const [rangeStart, setRangeStart] = useState(0);
	const [rangeEnd, setRangeEnd] = useState(0);
	const [draftText, setDraftText] = useState("");
	const [draftTranslation, setDraftTranslation] = useState("");
	const [editing, setEditing] = useState(false);
	const [importRole, setImportRole] = useState<"original" | "translation" | "bilingual">(
		"original",
	);
	const selected = useMemo(() => {
		const first = state.cues.findIndex((cue) => cue.id === anchor);
		const last = state.cues.findIndex((cue) => cue.id === endId);
		if (first < 0) return [];
		return state.cues.slice(
			Math.min(first, last < 0 ? first : last),
			Math.max(first, last < 0 ? first : last) + 1,
		);
	}, [anchor, endId, state.cues]);
	const current = state.cues.find((cue) => currentTime >= cue.start && currentTime < cue.end);
	const selectedText = selected.map((cue) => cue.text).join(" ");
	const choose = (cue: ShadowingCueRow, extend: boolean): void => {
		if (extend && anchor) {
			setEndId(cue.id);
			const anchorCue = state.cues.find((item) => item.id === anchor);
			setRangeStart(Math.min(anchorCue?.start ?? cue.start, cue.start));
			setRangeEnd(Math.max(anchorCue?.end ?? cue.end, cue.end));
		} else {
			setAnchor(cue.id);
			setEndId(cue.id);
			setRangeStart(cue.start);
			setRangeEnd(cue.end);
			setDraftText(cue.text);
			setDraftTranslation(cue.translation ?? "");
			actions.seekTo(cue.start);
		}
		setEditing(false);
	};
	const canStart =
		selected.length > 0 &&
		Number.isFinite(rangeStart) &&
		Number.isFinite(rangeEnd) &&
		rangeStart >= 0 &&
		rangeEnd > rangeStart &&
		(duration === null || rangeEnd <= duration);

	return (
		<section className={styles.workspace} aria-label={t.subtitles}>
			<nav className={styles.tabs} aria-label={t.subtitles}>
				{(["subtitles", "records", "tasks"] as const).map((key) => (
					<button
						key={key}
						type="button"
						aria-current={tab === key ? "page" : undefined}
						onClick={() => setTab(key)}
					>
						{t[key]}
					</button>
				))}
			</nav>
			{state.taskError && <p role="alert">{state.taskError}</p>}
			{tab === "subtitles" && (
				<>
					<div className={styles.toolbar}>
						<select
							aria-label={t.import}
							value={importRole}
							onChange={(event) =>
								setImportRole(event.target.value as typeof importRole)
							}
						>
							<option value="original">{t.original}</option>
							<option value="translation">{t.translation}</option>
							<option value="bilingual">{t.bilingual}</option>
						</select>
						<label className={styles.fileButton}>
							{t.import}
							<input
								type="file"
								accept=".srt,.vtt,text/vtt"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) actions.importFile(file, importRole);
									event.target.value = "";
								}}
							/>
						</label>
						<button type="button" onClick={actions.generate}>
							{t.generate}
						</button>
						<button
							type="button"
							disabled={!state.cues.length && !state.hasCandidate}
							onClick={actions.translateImported}
						>
							{t.translateImported}
						</button>
						{state.hasCandidate && (
							<button type="button" onClick={actions.adoptCandidate}>
								{t.adopt}
							</button>
						)}
					</div>
					{state.cues.length ? (
						<div className={styles.cueList}>
							{state.cues.map((cue) => (
								<button
									key={cue.id}
									type="button"
									className={`${styles.cue} ${selected.includes(cue) ? styles.selected : ""} ${current?.id === cue.id ? styles.current : ""}`}
									onClick={(event) => choose(cue, event.shiftKey)}
									aria-pressed={selected.includes(cue)}
								>
									<span className={styles.time}>
										{clock(cue.start)}–{clock(cue.end)}
									</span>
									<span className={styles.original}>{cue.text}</span>
									<span className={styles.translation}>
										{cue.translation || t.translationPending}
									</span>
									{cue.needsReview && (
										<span className={styles.draft}>{t.draft}</span>
									)}
								</button>
							))}
						</div>
					) : (
						<p className={styles.empty}>{t.noCues}</p>
					)}
					{selected.length > 0 && (
						<div className={styles.selection}>
							<div className={styles.rangeInputs}>
								<label>
									{t.startTime}
									<input
										type="number"
										min="0"
										max={duration ?? undefined}
										step="0.1"
										value={rangeStart}
										onChange={(event) =>
											setRangeStart(Number(event.target.value))
										}
									/>
								</label>
								<label>
									{t.endTime}
									<input
										type="number"
										min="0"
										max={duration ?? undefined}
										step="0.1"
										value={rangeEnd}
										onChange={(event) =>
											setRangeEnd(Number(event.target.value))
										}
									/>
								</label>
							</div>
							<button
								type="button"
								disabled={!canStart}
								onClick={() =>
									actions.selectRange(rangeStart, rangeEnd, selectedText)
								}
							>
								{t.start}
							</button>
							{selected.length === 1 && (
								<button type="button" onClick={() => setEditing(!editing)}>
									{t.edit}
								</button>
							)}
							{editing && selected.length === 1 && (
								<div className={styles.editor}>
									<label>
										{t.text}
										<textarea
											value={draftText}
											onChange={(event) => setDraftText(event.target.value)}
										/>
									</label>
									<label>
										{t.translationText}
										<textarea
											value={draftTranslation}
											onChange={(event) =>
												setDraftTranslation(event.target.value)
											}
										/>
									</label>
									<button
										type="button"
										disabled={!draftText.trim()}
										onClick={() => {
											actions.editCue(
												selected[0]!.id,
												draftText,
												draftTranslation,
											);
											setEditing(false);
										}}
									>
										{t.saveEdit}
									</button>
								</div>
							)}
						</div>
					)}
				</>
			)}
			{tab === "records" && (
				<div className={styles.recordList}>
					{state.records.length ? (
						state.records.map((record) => (
							<div key={record.id} className={styles.record}>
								<button type="button" onClick={() => actions.openRecord(record)}>
									<span className={styles.time}>
										{clock(record.start)}–{clock(record.end)}
									</span>{" "}
									{record.text}
								</button>
								<button
									type="button"
									aria-label={t.delete}
									onClick={() => actions.deleteRecord(record)}
								>
									×
								</button>
							</div>
						))
					) : state.failedSaves.length === 0 ? (
						<p className={styles.empty}>{t.noRecords}</p>
					) : null}
					{state.failedSaves.map((take) => (
						<div key={take.id} className={styles.record}>
							<span>
								{t.failedSave} · {clock(take.start)}–{clock(take.end)} {take.text}
							</span>
							<button type="button" onClick={() => actions.retrySave(take.id)}>
								{t.retrySave}
							</button>
						</div>
					))}
				</div>
			)}
			{tab === "tasks" && (
				<div className={styles.task}>
					<p>
						{state.status === "transcribing" || state.status === "translating"
							? t.inProgress
							: state.status}{" "}
						· {clock(state.processedSeconds)}
						{state.totalSeconds !== null ? ` / ${clock(state.totalSeconds)}` : ""}
					</p>
					<div className={styles.toolbar}>
						{(state.status === "transcribing" || state.status === "translating") && (
							<button type="button" onClick={actions.pauseGeneration}>
								{t.pause}
							</button>
						)}
						{(state.status === "paused" || state.status === "error") && (
							<button type="button" onClick={actions.resumeGeneration}>
								{t.resume}
							</button>
						)}
						{state.translationFailed && (
							<button type="button" onClick={actions.retryTranslation}>
								{t.retryTranslation}
							</button>
						)}
						{state.taskError && (
							<button type="button" onClick={actions.reloadSubtitles}>
								{t.reloadSubtitles}
							</button>
						)}
						{state.hasCandidate && (
							<button type="button" onClick={actions.adoptCandidate}>
								{t.adopt}
							</button>
						)}
						{state.hasPrevious && (
							<button type="button" onClick={actions.restorePrevious}>
								{t.restore}
							</button>
						)}
					</div>
				</div>
			)}
			{state.practiceStart !== null && state.practiceEnd !== null && (
				<div className={styles.practice}>
					<span className={styles.time}>
						{clock(state.practiceStart)}–{clock(state.practiceEnd)}
					</span>
					<select
						aria-label={t.continuous}
						value={state.practiceMode}
						onChange={(event) =>
							actions.setMode(event.target.value as typeof state.practiceMode)
						}
					>
						<option value="shadow">{t.continuous}</option>
						<option value="repeat-after">{t.repeatAfter}</option>
					</select>
					<label>
						{t.restSeconds}
						<input
							type="number"
							min="0"
							max="60"
							step="0.5"
							value={state.restSeconds}
							onChange={(event) => actions.setRestSeconds(Number(event.target.value))}
						/>
					</label>
					<label>
						{t.responseMultiplier}
						<input
							type="number"
							min="0.25"
							max="4"
							step="0.25"
							value={state.responseMultiplier}
							onChange={(event) =>
								actions.setResponseMultiplier(Number(event.target.value))
							}
						/>
					</label>
					{state.countdown > 0 && <strong aria-live="polite">{state.countdown}</strong>}
					{state.practicePhase === "resting" && (
						<button type="button" onClick={actions.continueEarly}>
							{t.continueEarly}
						</button>
					)}
					<button type="button" onClick={actions.startLoop}>
						{t.start}
					</button>
					<button type="button" onClick={actions.stopPractice}>
						{t.stop}
					</button>
					<button type="button" onClick={actions.recordOnce}>
						{t.record}
					</button>
					{state.hasTemporaryTake && (
						<>
							<button type="button" onClick={actions.replayTake}>
								{t.playMine}
							</button>
							<button type="button" onClick={actions.replayOriginal}>
								{t.playOriginal}
							</button>
							<button
								type="button"
								disabled={state.savingTake}
								onClick={actions.saveTake}
							>
								{t.save}
							</button>
						</>
					)}
					<button type="button" onClick={actions.markDifficult}>
						{t.difficult}
					</button>
					<button type="button" onClick={actions.continueWatching}>
						{t.continue}
					</button>
					{state.practiceError && <p role="alert">{state.practiceError}</p>}
				</div>
			)}
		</section>
	);
}

export function ShadowingFloatingControls({
	language,
	currentCue,
	state,
	actions,
}: {
	language: Language;
	currentCue: ShadowingCueRow | null;
	state: ShadowingWorkspaceState;
	actions: ShadowingWorkspaceActions;
}): React.ReactNode {
	const t = copy[language];
	return (
		<div className={styles.floating}>
			<p>{currentCue?.text ?? ""}</p>
			{currentCue?.translation && <p>{currentCue.translation}</p>}
			<div className={styles.toolbar}>
				<button
					type="button"
					onClick={actions.startLoop}
					disabled={state.practiceStart === null}
				>
					{t.start}
				</button>
				<button
					type="button"
					onClick={actions.recordOnce}
					disabled={state.practiceStart === null}
				>
					{t.record}
				</button>
				<button type="button" onClick={actions.continueWatching}>
					{t.continue}
				</button>
			</div>
		</div>
	);
}
