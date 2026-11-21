import React, { useState } from "react";
import { Notice } from "obsidian";
import { copyTextToClipboard } from "../../../core/shared/clipboard";
import type { Language } from "../../../core/shared/types";
import { ConfirmDialog } from "../../../core/ui/primitives/ConfirmDialog";
import { subtitleEditingStrings } from "../strings/subtitleEditing";
import styles from "./ShadowingWorkspace.module.scss";

import type {
	ShadowingCueRow,
	ShadowingRecordRow,
	ShadowingWorkspaceState,
	ShadowingWorkspaceViewAction,
} from "../domain/types";

export type {
	ShadowingCueRow,
	ShadowingRecordRow,
	ShadowingWorkspaceState,
	ShadowingWorkspaceViewAction,
};

export interface ShadowingWorkspaceProps {
	language: Language;
	currentTime: number;
	duration: number | null;
	state: ShadowingWorkspaceState;
	onAction: (action: ShadowingWorkspaceViewAction) => Promise<void>;
}

function clock(seconds: number): string {
	const whole = Math.floor(Math.max(0, seconds));
	return `${Math.floor(whole / 60)
		.toString()
		.padStart(2, "0")}:${(whole % 60).toString().padStart(2, "0")}`;
}

async function copyDraftText(text: string, copy: ReturnType<typeof subtitleEditingStrings>) {
	const copied = await copyTextToClipboard(text);
	new Notice(copied ? copy.copied : copy.copyFailed);
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
		noCues: "先准备字幕，再开始跟读",
		subtitleSetupHint:
			"已有 SRT / VTT 字幕：选择字幕语言后导入；没有字幕：生成双语字幕。准备好后，选中一句字幕，再点“练习所选片段”。",
		candidateReady: "候选字幕已就绪",
		candidateHint: "采用候选字幕后，选中一句字幕，再点“练习所选片段”。",
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
		phasePlaying: "正在播放原声",
		phaseResting: "跟读休整窗口",
		phaseCountdown: "准备开始录音…",
		phaseRecording: "正在录音 · 请跟读",
		phaseReview: "录音完成 · 可对比回听",
		phasePaused: "已就绪",
		shortcutPrevNext: "上/下一句",
		shortcutReplay: "重播本句",
		shortcutLoop: "循环跟读",
		shortcutRecord: "录一遍 / 停止",
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
		noCues: "Prepare subtitles to start practicing",
		subtitleSetupHint:
			"Have an SRT / VTT file? Choose its language and import it. Otherwise, generate bilingual subtitles. Then select a sentence and choose “Practice selection”.",
		candidateReady: "Candidate subtitles are ready",
		candidateHint:
			"Use the candidate subtitles, select a sentence, then choose “Practice selection”.",
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
		phasePlaying: "Playing original audio",
		phaseResting: "Shadowing response window",
		phaseCountdown: "Get ready to record…",
		phaseRecording: "Recording · Speak now",
		phaseReview: "Take ready · Compare & review",
		phasePaused: "Ready",
		shortcutPrevNext: "Prev / next cue",
		shortcutReplay: "Replay sentence",
		shortcutLoop: "Toggle loop",
		shortcutRecord: "Record / stop",
	},
} as const;

/** One compact surface shared by the docked player and its floating presentation. */
export function ShadowingWorkspace({
	language,
	currentTime,
	duration,
	state,
	onAction,
}: ShadowingWorkspaceProps): React.ReactNode {
	const t = copy[language];
	const editCopy = subtitleEditingStrings(language);
	const [tab, setTab] = useState<"subtitles" | "records" | "tasks">("subtitles");
	const [importRole, setImportRole] = useState<"original" | "translation" | "bilingual">(
		"original",
	);
	const selected = state.selectedCueIds;
	const editor = state.editor;
	const [firstDeletedDraft] = state.deletedDrafts;
	const current = state.cues.find((cue) => currentTime >= cue.start && currentTime < cue.end);

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
					{state.cues.length === 0 && (
						<div className={styles.setupHint}>
							<h3>{state.hasCandidate ? t.candidateReady : t.noCues}</h3>
							<p>{state.hasCandidate ? t.candidateHint : t.subtitleSetupHint}</p>
						</div>
					)}
					{(state.status === "transcribing" || state.status === "translating") && (
						<div className={styles.inlineTaskBanner}>
							<div className={styles.inlineTaskHeader}>
								<span>
									{t.inProgress} · {clock(state.processedSeconds)}
									{state.totalSeconds !== null
										? ` / ${clock(state.totalSeconds)}`
										: ""}
								</span>
								<span className="fc-meter" aria-hidden="true">
									<i
										style={{
											width: `${
												state.totalSeconds && state.totalSeconds > 0
													? Math.min(
															100,
															Math.round(
																(state.processedSeconds /
																	state.totalSeconds) *
																	100,
															),
														)
													: 35
											}%`,
										}}
									/>
								</span>
							</div>
						</div>
					)}
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
									if (file)
										void onAction({
											type: "import-file",
											file,
											role: importRole,
										});
									event.target.value = "";
								}}
							/>
						</label>
						<button type="button" onClick={() => void onAction({ type: "generate" })}>
							{t.generate}
						</button>
						<button
							type="button"
							disabled={!state.cues.length && !state.hasCandidate}
							onClick={() => void onAction({ type: "translate-imported" })}
						>
							{t.translateImported}
						</button>
						{state.hasCandidate && (
							<button
								type="button"
								onClick={() => void onAction({ type: "adopt-candidate" })}
							>
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
									className={`${styles.cue} ${selected.includes(cue.id) ? styles.selected : ""} ${current?.id === cue.id ? styles.current : ""}`}
									onClick={(event) =>
										void onAction({
											type: "choose-cue",
											cueId: cue.id,
											extend: event.shiftKey,
										})
									}
									aria-pressed={selected.includes(cue.id)}
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
					) : null}
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
										value={state.rangeStart}
										onChange={(event) =>
											void onAction({
												type: "set-cue-range",
												edge: "start",
												seconds: Number(event.target.value),
											})
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
										value={state.rangeEnd}
										onChange={(event) =>
											void onAction({
												type: "set-cue-range",
												edge: "end",
												seconds: Number(event.target.value),
											})
										}
									/>
								</label>
							</div>
							<button
								type="button"
								className={styles.primaryAction}
								disabled={!state.canPractice}
								onClick={() => void onAction({ type: "start-practice-selected" })}
							>
								{t.start}
							</button>
							{selected.length === 1 && (
								<button
									type="button"
									onClick={() => void onAction({ type: "toggle-cue-editor" })}
								>
									{t.edit}
								</button>
							)}
						</div>
					)}
					{editor && (
						<div className={styles.editor} aria-busy={editor.busy}>
							{(editor.deleted || editor.conflict) && (
								<p role="alert">
									{editor.deleted ? editCopy.deleted : editCopy.conflict}
								</p>
							)}
							{editor.failure && (
								<p role="alert">{editCopy.saveFailed(editor.failure)}</p>
							)}
							<label>
								{t.text}
								<textarea
									value={editor.text}
									disabled={editor.busy}
									readOnly={editor.deleted}
									onChange={(event) =>
										void onAction({
											type: "set-cue-field",
											field: "text",
											value: event.target.value,
											expectedEditor: editor,
										})
									}
								/>
							</label>
							<label>
								{t.translationText}
								<textarea
									value={editor.translation}
									disabled={editor.busy}
									readOnly={editor.deleted}
									onChange={(event) =>
										void onAction({
											type: "set-cue-field",
											field: "translation",
											value: event.target.value,
											expectedEditor: editor,
										})
									}
								/>
							</label>
							<button
								type="button"
								disabled={editor.deleted || !editor.canSave}
								onClick={() =>
									void onAction({ type: "save-cue-edit", expectedEditor: editor })
								}
							>
								{editor.busy ? editCopy.saving : t.saveEdit}
							</button>
							{(editor.deleted || editor.conflict || editor.failure) && (
								<button
									type="button"
									disabled={editor.busy}
									onClick={() =>
										void onAction({
											type: "request-cue-reload",
											expectedEditor: editor,
										})
									}
								>
									{editCopy.reload}
								</button>
							)}
							{editor.confirmingReload && (
								<ConfirmDialog
									kicker={t.edit}
									title={editCopy.reloadTitle}
									message={editCopy.reloadMessage}
									confirmText={editCopy.reloadConfirm}
									cancelText={editCopy.cancel}
									tone="danger"
									onCancel={() =>
										void onAction({
											type: "cancel-cue-reload",
											expectedEditor: editor,
										})
									}
									onConfirm={() =>
										void onAction({
											type: "confirm-cue-reload",
											expectedEditor: editor,
										})
									}
								/>
							)}
						</div>
					)}
					{firstDeletedDraft && (
						<details key={firstDeletedDraft.sourceId} className={styles.deletedDrafts}>
							<summary>{editCopy.deletedDrafts}</summary>
							<ul>
								{state.deletedDrafts.map((draft) => (
									<li key={draft.cueId}>
										{(["text", "translation"] as const).map((field) => (
											<div className={styles.draftField} key={field}>
												<label>
													{field === "text" ? t.text : t.translationText}
													<textarea readOnly value={draft[field]} />
												</label>
												<button
													type="button"
													disabled={!draft[field]}
													onClick={() =>
														void copyDraftText(draft[field], editCopy)
													}
												>
													{field === "text"
														? editCopy.copyOriginal
														: editCopy.copyTranslation}
												</button>
											</div>
										))}
										<button
											type="button"
											onClick={() =>
												void onAction({
													type: "discard-deleted-draft",
													draft,
												})
											}
										>
											{editCopy.discardDraft}
										</button>
									</li>
								))}
							</ul>
						</details>
					)}
				</>
			)}
			{tab === "records" && (
				<div className={styles.recordList}>
					{state.records.length ? (
						state.records.map((record) => (
							<div key={record.id} className={styles.record}>
								<button
									type="button"
									onClick={() => void onAction({ type: "open-record", record })}
								>
									<span className={styles.time}>
										{clock(record.start)}–{clock(record.end)}
									</span>{" "}
									{record.text}
								</button>
								<button
									type="button"
									aria-label={t.delete}
									onClick={() => void onAction({ type: "delete-record", record })}
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
							<button
								type="button"
								onClick={() =>
									void onAction({ type: "retry-save", takeId: take.id })
								}
							>
								{t.retrySave}
							</button>
						</div>
					))}
				</div>
			)}
			{tab === "tasks" && (
				<div className={styles.task}>
					<div className={styles.taskProgressRow}>
						<p>
							{state.status === "transcribing" || state.status === "translating"
								? t.inProgress
								: state.status}{" "}
							· {clock(state.processedSeconds)}
							{state.totalSeconds !== null ? ` / ${clock(state.totalSeconds)}` : ""}
						</p>
						{state.totalSeconds !== null && state.totalSeconds > 0 && (
							<span className="fc-meter" aria-hidden="true">
								<i
									style={{
										width: `${Math.min(
											100,
											Math.round(
												(state.processedSeconds / state.totalSeconds) * 100,
											),
										)}%`,
									}}
								/>
							</span>
						)}
					</div>
					<div className={styles.toolbar}>
						{(state.status === "transcribing" || state.status === "translating") && (
							<button
								type="button"
								onClick={() => void onAction({ type: "pause-generation" })}
							>
								{t.pause}
							</button>
						)}
						{(state.status === "paused" || state.status === "error") && (
							<button
								type="button"
								onClick={() => void onAction({ type: "resume-generation" })}
							>
								{t.resume}
							</button>
						)}
						{state.translationFailed && (
							<button
								type="button"
								onClick={() => void onAction({ type: "retry-translation" })}
							>
								{t.retryTranslation}
							</button>
						)}
						{state.taskError && (
							<button
								type="button"
								onClick={() => void onAction({ type: "reload-subtitles" })}
							>
								{t.reloadSubtitles}
							</button>
						)}
						{state.hasCandidate && (
							<button
								type="button"
								onClick={() => void onAction({ type: "adopt-candidate" })}
							>
								{t.adopt}
							</button>
						)}
						{state.hasPrevious && (
							<button
								type="button"
								onClick={() => void onAction({ type: "restore-previous" })}
							>
								{t.restore}
							</button>
						)}
					</div>
				</div>
			)}
			{state.practiceStart !== null && state.practiceEnd !== null && (
				<div className={styles.practice} data-phase={state.practicePhase}>
					<div className={styles.practiceHeader}>
						<div className={styles.practiceStatusGroup}>
							<span className={styles.time}>
								{clock(state.practiceStart)}–{clock(state.practiceEnd)}
							</span>
							<span
								className={styles.phaseBadge}
								data-phase={state.practicePhase}
								aria-live="polite"
							>
								<span className={styles.phaseDot} aria-hidden="true" />
								{state.practicePhase === "playing"
									? t.phasePlaying
									: state.practicePhase === "resting"
										? t.phaseResting
										: state.practicePhase === "countdown"
											? t.phaseCountdown
											: state.practicePhase === "recording"
												? t.phaseRecording
												: state.practicePhase === "review"
													? t.phaseReview
													: t.phasePaused}
							</span>
						</div>
						<div className={styles.practiceHeaderControls}>
							<select
								aria-label={t.continuous}
								value={state.practiceMode}
								onChange={(event) =>
									void onAction({
										type: "set-mode",
										mode: event.target.value as typeof state.practiceMode,
									})
								}
							>
								<option value="shadow">{t.continuous}</option>
								<option value="repeat-after">{t.repeatAfter}</option>
							</select>
							{state.countdown > 0 && (
								<strong className={styles.countdownBadge} aria-live="polite">
									{state.countdown}
								</strong>
							)}
						</div>
					</div>
					{(state.practicePhase === "recording" ||
						state.practicePhase === "countdown") && (
						<div className={styles.recordingStage} aria-hidden="true">
							<div className={styles.recordingPulseRing} />
							<div className={styles.recordingWave}>
								<span />
								<span />
								<span />
								<span />
								<span />
								<span />
								<span />
							</div>
							<span className={styles.recordingStageLabel}>
								{state.practicePhase === "countdown"
									? `${t.phaseCountdown} ${state.countdown}s`
									: t.phaseRecording}
							</span>
						</div>
					)}
					<div className={styles.practiceConfig}>
						<label>
							{t.restSeconds}
							<input
								type="number"
								min="0"
								max="60"
								step="0.5"
								value={state.restSeconds}
								onChange={(event) =>
									void onAction({
										type: "set-rest-seconds",
										seconds: Number(event.target.value),
									})
								}
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
									void onAction({
										type: "set-response-multiplier",
										multiplier: Number(event.target.value),
									})
								}
							/>
						</label>
					</div>
					<div className={styles.practiceActions}>
						{state.practicePhase === "resting" && (
							<button
								type="button"
								onClick={() => void onAction({ type: "continue-early" })}
							>
								{t.continueEarly}
							</button>
						)}
						<button
							type="button"
							className={styles.primaryAction}
							onClick={() => void onAction({ type: "start-loop" })}
						>
							{t.start}
						</button>
						<button
							type="button"
							onClick={() => void onAction({ type: "stop-practice" })}
						>
							{t.stop}
						</button>
						<button
							type="button"
							className={styles.recordAction}
							onClick={() => void onAction({ type: "record-once" })}
						>
							{t.record}
						</button>
						{state.hasTemporaryTake && (
							<>
								<button
									type="button"
									onClick={() => void onAction({ type: "replay-take" })}
								>
									{t.playMine}
								</button>
								<button
									type="button"
									onClick={() => void onAction({ type: "replay-original" })}
								>
									{t.playOriginal}
								</button>
								<button
									type="button"
									disabled={state.savingTake}
									onClick={() => void onAction({ type: "save-take" })}
								>
									{t.save}
								</button>
							</>
						)}
						<button
							type="button"
							onClick={() => void onAction({ type: "mark-difficult" })}
						>
							{t.difficult}
						</button>
						<button
							type="button"
							onClick={() => void onAction({ type: "continue-watching" })}
						>
							{t.continue}
						</button>
					</div>
					<div className={styles.shadowShortcutsBar} aria-hidden="true">
						<span className={styles.shadowShortcutItem}>
							<kbd>↑</kbd>
							<kbd>↓</kbd>
							{t.shortcutPrevNext}
						</span>
						<span className={styles.shadowShortcutItem}>
							<kbd>S</kbd>
							{t.shortcutReplay}
						</span>
						<span className={styles.shadowShortcutItem}>
							<kbd>L</kbd>
							{t.shortcutLoop}
						</span>
						<span className={styles.shadowShortcutItem}>
							<kbd>R</kbd>
							{t.shortcutRecord}
						</span>
					</div>
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
	onAction,
}: {
	language: Language;
	currentCue: ShadowingCueRow | null;
	state: ShadowingWorkspaceState;
	onAction: (action: ShadowingWorkspaceViewAction) => Promise<void>;
}): React.ReactNode {
	const t = copy[language];
	return (
		<div className={styles.floating}>
			<p>{currentCue?.text ?? ""}</p>
			{currentCue?.translation && <p>{currentCue.translation}</p>}
			<div className={styles.toolbar}>
				<button
					type="button"
					className={styles.primaryAction}
					onClick={() => void onAction({ type: "start-loop" })}
					disabled={state.practiceStart === null}
				>
					{t.start}
				</button>
				<button
					type="button"
					onClick={() => void onAction({ type: "record-once" })}
					disabled={state.practiceStart === null}
				>
					{t.record}
				</button>
				<button type="button" onClick={() => void onAction({ type: "continue-watching" })}>
					{t.continue}
				</button>
			</div>
		</div>
	);
}
