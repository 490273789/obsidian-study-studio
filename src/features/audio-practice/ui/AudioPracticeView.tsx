import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
	Headphones,
	Pause,
	Play,
	Plus,
	RotateCcw,
	Settings,
	SkipBack,
	SkipForward,
	Star,
	Trash2,
} from "lucide-react";
import type { Language } from "../../../core/shared/types";
import { FlashcardButton as Button } from "../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../core/ui/primitives/Header";
import type { AudioMaterial, AudioPracticeSnapshot } from "../domain/types";
import { AUDIO_PLAYBACK_RATES } from "../domain/types";
import type { AudioPracticeRuntime } from "../domain/audioPracticeRuntime";
import type { SubtitleGeneration } from "../generation/subtitleGeneration";
import { audioPracticeStrings } from "../strings/audioPractice";
import type { AudioPracticeStrings } from "../strings/audioPractice";
import styles from "./AudioPractice.module.scss";

export interface AudioPracticeViewProps {
	runtime: AudioPracticeRuntime;
	generation: SubtitleGeneration;
	language: Language;
	audioPaths: readonly string[];
	subtitlePaths: readonly string[];
	textPaths: readonly string[];
	onReadText: (path: string) => Promise<string>;
	onGenerate: (material: AudioMaterial, force?: boolean) => Promise<void>;
	onSaveDraft: (materialId: string) => Promise<void>;
	onOpenSettings: () => void;
}

export function AudioPracticeView(props: AudioPracticeViewProps): React.ReactNode {
	const { runtime, generation, language, onOpenSettings } = props;
	const snapshot = useSyncExternalStore(
		(listener) => runtime.subscribe(listener),
		() => runtime.getSnapshot(),
	);
	const draft = useSyncExternalStore(
		(listener) => generation.subscribe(listener),
		() => generation.getSnapshot(),
	);
	const t = audioPracticeStrings(language);
	const media = useRef<HTMLAudioElement>(null);
	const [adding, setAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const material = snapshot.currentMaterial;
	const generating = ["preparing", "transcribing", "aligning"].includes(draft.status);
	const run = async (action: () => void | Promise<unknown>) => {
		setError(null);
		setBusy(true);
		try {
			await action();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t.failed);
		} finally {
			setBusy(false);
		}
	};
	useEffect(() => {
		const audio = media.current;
		if (!audio) return;
		const release = runtime.bindMedia(audio);
		const pause = () => {
			if (audio.ownerDocument.hidden) runtime.pause();
		};
		audio.ownerDocument.addEventListener("visibilitychange", pause);
		return () => {
			audio.ownerDocument.removeEventListener("visibilitychange", pause);
			release();
		};
	}, [runtime]);
	const draftForMaterial = material !== null && draft.taskKey === material.id;
	return (
		<div className={`fc-page fc-page--fill ${styles.page}`}>
			<FlashcardHeader
				icon={Headphones}
				title={t.title}
				right={
					<Button
						preset="icon"
						icon={Settings}
						aria-label={t.settings}
						title={t.settings}
						onClick={onOpenSettings}
					/>
				}
			/>
			{/* Captions are rendered as accessible, interactive sentence text below. */}
			{/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
			<audio ref={media} preload="metadata" />
			<div className={styles.layout}>
				<aside className={`fc-panel ${styles.library}`} aria-label={t.title}>
					<Button variant="primary" icon={Plus} onClick={() => setAdding(!adding)}>
						{t.add}
					</Button>
					{snapshot.materials.map((item) => (
						<div key={item.id} className={styles.material}>
							<Button
								variant="ghost"
								active={item.id === material?.id}
								onClick={() => void run(() => runtime.selectMaterial(item.id))}
							>
								{item.title}
							</Button>
							<Button
								preset="icon"
								icon={Trash2}
								aria-label={`${t.remove}: ${item.title}`}
								title={t.remove}
								disabled={busy}
								onClick={() => void run(() => runtime.removeMaterial(item.id))}
							/>
						</div>
					))}
					<small>{t.removeHint}</small>
				</aside>
				<main className={styles.main}>
					{adding && (
						<MaterialForm
							{...props}
							t={t}
							busy={busy}
							onCancel={() => setAdding(false)}
							onSubmit={(value) =>
								void run(async () => {
									await runtime.addMaterial(value);
									setAdding(false);
								})
							}
						/>
					)}
					{!material && !adding && (
						<div className={`fc-panel ${styles.empty}`}>{t.empty}</div>
					)}
					{material && (
						<>
							<section className={`fc-panel ${styles.panel}`}>
								<div className={styles.row}>
									<h2>{material.title}</h2>
									<Button
										size="sm"
										disabled={busy || generating}
										onClick={() =>
											setEditingId(
												editingId === material.id ? null : material.id,
											)
										}
									>
										{t.original}
									</Button>
								</div>
								<small>{material.audioPath}</small>
								{editingId === material.id && (
									<MaterialForm
										key={material.id}
										{...props}
										material={material}
										t={t}
										busy={busy}
										onCancel={() => setEditingId(null)}
										onSubmit={(value) =>
											void run(async () => {
												runtime.updateMaterial(material.id, {
													title: value.title,
													originalText: value.originalText,
													audioPath: value.audioPath,
												});
												if (value.subtitlePath !== material.subtitlePath)
													await runtime.setSubtitle(
														material.id,
														value.subtitlePath ?? null,
													);
												setEditingId(null);
											})
										}
									/>
								)}
								<p className={styles.hint}>{t.generateHint}</p>
								<Button
									disabled={busy || generating}
									onClick={() => void run(() => props.onGenerate(material, true))}
								>
									{snapshot.cues.length ? t.regenerate : t.generate}
								</Button>
							</section>
							<PracticeSurface runtime={runtime} snapshot={snapshot} t={t} />
						</>
					)}
					{(error || snapshot.error) && (
						<p role="alert" className={styles.error}>
							{error ?? snapshot.error}
						</p>
					)}
					{snapshot.invalidatedMarks > 0 && (
						<output>{t.marksInvalidated(snapshot.invalidatedMarks)}</output>
					)}
					{(generating || draftForMaterial) && draft.status !== "idle" && (
						<section className={`fc-panel ${styles.panel}`} aria-label={t.review}>
							<h3>{t.review}</h3>
							{generating && (
								<output>
									{draft.status === "preparing"
										? t.preparing
										: draft.status === "aligning"
											? t.aligning
											: t.transcribing}{" "}
									{draft.totalChunks > 0
										? t.chunks(draft.completedChunks, draft.totalChunks)
										: ""}
								</output>
							)}
							{draft.error && (
								<p role="alert" className={styles.error}>
									{draft.error}
								</p>
							)}
							{draft.status === "cancelled" && <output>{t.cancelled}</output>}
							{generating && (
								<Button onClick={() => generation.cancel()}>{t.cancel}</Button>
							)}
							{draftForMaterial &&
								(draft.status === "error" || draft.status === "cancelled") && (
									<Button
										disabled={busy}
										onClick={() =>
											void run(() => props.onGenerate(material, false))
										}
									>
										{t.retry}
									</Button>
								)}
							{draftForMaterial && draft.status === "review" && (
								<>
									<p>{t.reviewHint}</p>
									<div className={styles.draftList}>
										{draft.cues.map((cue, index) => (
											<div key={cue.id} className={styles.draftCue}>
												<span>{index + 1}</span>
												<label>
													{t.cueText}
													<textarea
														value={cue.text}
														onChange={(event) =>
															generation.editCue(cue.id, {
																text: event.target.value,
															})
														}
													/>
												</label>
												<div className={styles.row}>
													<label>
														{t.start}
														<input
															type="number"
															min="0"
															step="0.01"
															value={cue.start ?? ""}
															onChange={(event) =>
																generation.editCue(cue.id, {
																	start:
																		event.target.value === ""
																			? null
																			: Number(
																					event.target
																						.value,
																				),
																})
															}
														/>
													</label>
													<label>
														{t.end}
														<input
															type="number"
															min="0"
															step="0.01"
															value={cue.end ?? ""}
															onChange={(event) =>
																generation.editCue(cue.id, {
																	end:
																		event.target.value === ""
																			? null
																			: Number(
																					event.target
																						.value,
																				),
																})
															}
														/>
													</label>
													<Button
														disabled={
															cue.start === null ||
															cue.end === null ||
															cue.end <= cue.start
														}
														onClick={() => {
															if (
																cue.start !== null &&
																cue.end !== null
															)
																runtime.preview(cue.start, cue.end);
														}}
													>
														{t.audition}
													</Button>
													<Button
														preset="icon"
														icon={Trash2}
														aria-label={`${t.deleteCue} ${index + 1}`}
														onClick={() => generation.removeCue(cue.id)}
													/>
												</div>
												<label className={styles.checkbox}>
													<input
														type="checkbox"
														checked={!cue.needsReview}
														onChange={(event) =>
															generation.editCue(cue.id, {
																needsReview: !event.target.checked,
															})
														}
													/>
													{cue.needsReview ? t.pending : t.checked}
												</label>
											</div>
										))}
									</div>
									<div className={styles.row}>
										<Button icon={Plus} onClick={() => generation.addCue()}>
											{t.addCue}
										</Button>
										<Button
											variant="primary"
											disabled={busy}
											onClick={() =>
												void run(() => props.onSaveDraft(material!.id))
											}
										>
											{busy ? t.busy : t.saveDraft}
										</Button>
									</div>
								</>
							)}
						</section>
					)}
				</main>
			</div>
		</div>
	);
}

interface MaterialInput {
	title: string;
	audioPath: string;
	subtitlePath: string | null;
	originalText: string;
}
function MaterialForm(
	props: AudioPracticeViewProps & {
		material?: AudioMaterial;
		t: AudioPracticeStrings;
		busy: boolean;
		onCancel(): void;
		onSubmit(value: MaterialInput): void;
	},
): React.ReactNode {
	const { material, t } = props;
	const [title, setTitle] = useState(material?.title ?? "");
	const [audioPath, setAudioPath] = useState(material?.audioPath ?? props.audioPaths[0] ?? "");
	const [subtitlePath, setSubtitlePath] = useState(material?.subtitlePath ?? "");
	const [text, setText] = useState(material?.originalText ?? "");
	const [readError, setReadError] = useState<string | null>(null);
	const [reading, setReading] = useState(false);
	const readVersion = useRef(0);
	useEffect(
		() => () => {
			readVersion.current++;
		},
		[],
	);
	return (
		<form
			className={`fc-panel ${styles.form}`}
			onSubmit={(event) => {
				event.preventDefault();
				if (reading || props.busy || !audioPath) return;
				props.onSubmit({
					title: title.trim() || audioPath.split("/").pop() || t.title,
					audioPath,
					subtitlePath: subtitlePath || null,
					originalText: text,
				});
			}}
		>
			<label>
				{t.name}
				<input value={title} onChange={(event) => setTitle(event.target.value)} />
			</label>
			<label>
				{t.audio}
				<select
					value={audioPath}
					onChange={(event) => setAudioPath(event.target.value)}
					required
				>
					<option value="">{t.choose}</option>
					{Array.from(
						new Set([...(material ? [material.audioPath] : []), ...props.audioPaths]),
					).map((path) => (
						<option key={path}>{path}</option>
					))}
				</select>
			</label>
			<label>
				{t.subtitle}
				<select
					value={subtitlePath}
					onChange={(event) => setSubtitlePath(event.target.value)}
				>
					<option value="">{t.noSubtitle}</option>
					{Array.from(
						new Set([
							...(material?.subtitlePath ? [material.subtitlePath] : []),
							...props.subtitlePaths,
						]),
					).map((path) => (
						<option key={path}>{path}</option>
					))}
				</select>
			</label>
			<label>
				{t.textFile}
				<select
					defaultValue=""
					onChange={(event) => {
						const path = event.target.value;
						const version = ++readVersion.current;
						if (!path) {
							setReading(false);
							return;
						}
						setReadError(null);
						setReading(true);
						void props.onReadText(path).then(
							(value) => {
								if (readVersion.current === version) {
									setText(value);
									setReading(false);
								}
							},
							(cause) => {
								if (readVersion.current === version) {
									setReadError(cause instanceof Error ? cause.message : t.failed);
									setReading(false);
								}
							},
						);
					}}
				>
					<option value="">{t.choose}</option>
					{props.textPaths.map((path) => (
						<option key={path}>{path}</option>
					))}
				</select>
			</label>
			<label>
				{t.text}
				<textarea
					value={text}
					onChange={(event) => {
						readVersion.current++;
						setReading(false);
						setText(event.target.value);
					}}
					rows={5}
				/>
			</label>
			{readError && <p role="alert">{readError}</p>}
			<div className={styles.row}>
				<Button
					type="submit"
					variant="primary"
					disabled={props.busy || reading || !audioPath}
				>
					{material ? t.save : t.create}
				</Button>
				<Button onClick={() => props.onCancel()}>{t.cancel}</Button>
			</div>
		</form>
	);
}

export function PracticeSurface({
	runtime,
	snapshot,
	t,
}: {
	runtime: AudioPracticeRuntime;
	snapshot: AudioPracticeSnapshot;
	t: AudioPracticeStrings;
}): React.ReactNode {
	const marks = snapshot.currentMaterial
		? (snapshot.progress[snapshot.currentMaterial.id]?.difficultCueIds ?? [])
		: [];
	const cues = snapshot.difficultOnly
		? snapshot.cues.filter((cue) => marks.includes(cue.id))
		: snapshot.cues;
	return (
		// The practice panel is a composite keyboard surface with its own focus target.
		/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
		<section
			className={`fc-panel fc-focus-ring ${styles.practice}`}
			aria-label={t.captions}
			tabIndex={0}
			onKeyDown={(event) => {
				if (
					event.defaultPrevented ||
					event.altKey ||
					event.ctrlKey ||
					event.metaKey ||
					event.nativeEvent.isComposing ||
					(event.target as HTMLElement).closest(
						"button,input,textarea,select,[contenteditable=true]",
					)
				)
					return;
				if (event.key === " ") {
					event.preventDefault();
					runtime.togglePlayback();
				} else if (event.key === "ArrowLeft") {
					event.preventDefault();
					runtime.previous();
				} else if (event.key === "ArrowRight") {
					event.preventDefault();
					runtime.next();
				}
			}}
		>
			<div className={styles.row}>
				<label>
					{t.mode}
					<select
						value={snapshot.mode}
						onChange={(event) =>
							runtime.setMode(
								event.target.value === "sentence" ? "sentence" : "continuous",
							)
						}
					>
						<option value="sentence">{t.sentence}</option>
						<option value="continuous">{t.continuous}</option>
					</select>
				</label>
				<label className={styles.checkbox}>
					<input
						type="checkbox"
						checked={snapshot.blind}
						onChange={(event) => runtime.setBlind(event.target.checked)}
					/>
					{t.blind}
				</label>
				<label className={styles.checkbox}>
					<input
						type="checkbox"
						checked={snapshot.difficultOnly}
						onChange={(event) => runtime.setDifficultOnly(event.target.checked)}
					/>
					{t.difficultOnly}
				</label>
				{snapshot.blind && (
					<Button disabled={!snapshot.currentCueId} onClick={() => runtime.reveal()}>
						{t.reveal}
					</Button>
				)}
			</div>
			<div className={styles.cues}>
				{cues.length === 0 && <p>{snapshot.cues.length ? t.noDifficult : t.noCues}</p>}
				{cues.map((cue) => (
					<div
						key={cue.id}
						className={`${styles.cue} ${cue.id === snapshot.currentCueId ? styles.active : ""}`}
					>
						<Button variant="ghost" onClick={() => runtime.selectCue(cue.id, true)}>
							<small>
								{timeLabel(cue.start)}–{timeLabel(cue.end)}
							</small>
							<span>
								{snapshot.blind &&
								!(cue.id === snapshot.currentCueId && snapshot.revealed)
									? t.hidden
									: cue.text}
							</span>
						</Button>
						<Button
							preset="icon"
							icon={Star}
							active={marks.includes(cue.id)}
							aria-pressed={marks.includes(cue.id)}
							aria-label={`${t.difficult}: ${timeLabel(cue.start)}`}
							onClick={() => runtime.toggleDifficult(cue.id)}
						/>
					</div>
				))}
			</div>
			<div className={styles.controls}>
				<label className={styles.seek}>
					{t.progress}
					<input
						type="range"
						min="0"
						max={snapshot.duration ?? 0}
						step="0.05"
						value={snapshot.currentTime}
						disabled={!snapshot.duration}
						onChange={(event) => runtime.seekTo(Number(event.target.value))}
					/>
					<small>
						{timeLabel(snapshot.currentTime)} / {timeLabel(snapshot.duration ?? 0)}
					</small>
				</label>
				<div className={styles.row}>
					<Button
						preset="icon"
						icon={SkipBack}
						aria-label={t.previous}
						disabled={!cues.length}
						onClick={() => runtime.previous()}
					/>
					<Button
						icon={snapshot.playing ? Pause : Play}
						variant="primary"
						onClick={() => runtime.togglePlayback()}
					>
						{snapshot.playing ? t.pause : t.play}
					</Button>
					<Button
						preset="icon"
						icon={RotateCcw}
						aria-label={t.repeat}
						disabled={!cues.length}
						onClick={() => runtime.repeat()}
					/>
					<Button
						preset="icon"
						icon={SkipForward}
						aria-label={t.next}
						disabled={!cues.length}
						onClick={() => runtime.next()}
					/>
					<label>
						{t.rate}
						<select
							value={snapshot.playbackRate}
							onChange={(event) =>
								runtime.setPlaybackRate(
									Number(
										event.target.value,
									) as (typeof AUDIO_PLAYBACK_RATES)[number],
								)
							}
						>
							{AUDIO_PLAYBACK_RATES.map((rate) => (
								<option key={rate} value={rate}>
									{rate}×
								</option>
							))}
						</select>
					</label>
					<label>
						{t.offset}
						<input
							type="number"
							step="0.1"
							value={
								snapshot.currentMaterial
									? (snapshot.progress[snapshot.currentMaterial.id]?.offset ?? 0)
									: 0
							}
							onChange={(event) => {
								if (Number.isFinite(event.target.valueAsNumber))
									runtime.setOffset(event.target.valueAsNumber);
							}}
						/>
					</label>
				</div>
			</div>
		</section>
	);
}
function timeLabel(seconds: number): string {
	return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}
