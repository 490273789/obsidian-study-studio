import React, { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
	AudioLines,
	CircleAlert,
	ChevronDown,
	EyeOff,
	Headphones,
	ListChecks,
	ListMusic,
	LoaderCircle,
	NotebookPen,
	PanelRightClose,
	PanelRightOpen,
	Pause,
	Pencil,
	Play,
	Plus,
	RotateCcw,
	Settings,
	SlidersHorizontal,
	SkipBack,
	SkipForward,
	Sparkles,
	Star,
	Trash2,
	X,
} from "lucide-react";
import { cls } from "../../../core/shared/classNames";
import type { Language } from "../../../core/shared/types";
import { FlashcardButton as Button } from "../../../core/ui/primitives/Button";
import { FlashcardCheckbox } from "../../../core/ui/primitives/Checkbox";
import { FlashcardHeader } from "../../../core/ui/primitives/Header";
import { FlashcardInput, FlashcardTextarea } from "../../../core/ui/primitives/Input";
import { ModalSurface } from "../../../core/ui/primitives/Modal";
import { PlaybackRateControl } from "../../../core/ui/primitives/PlaybackRate";
import { FlashcardSelect } from "../../../core/ui/primitives/Select";
import { FlashcardSlider } from "../../../core/ui/primitives/Slider";
import type {
	AudioPracticeCatalog,
	AudioPracticeDraftSnapshot,
	AudioPracticeFiles,
	AudioPracticeSnapshot,
	TimedTextWord,
} from "../domain/types";
import { AUDIO_PLAYBACK_RATES } from "../domain/types";
import type { AudioPracticeRuntime } from "../domain/audioPracticeRuntime";
import type { SubtitleDraftEngine, SubtitleDraftSnapshot } from "../domain/subtitleDraftEngine";
import { audioFailureCopy } from "../strings/failures";
import { audioPracticeStrings } from "../strings/audioPractice";
import type { AudioPracticeStrings } from "../strings/audioPractice";
import { MaterialEditSession, type MaterialEditSessionSnapshot } from "./materialEditSession";
import { PracticeViewInteraction } from "./practiceViewInteraction";
import { ReviewDialog } from "./ReviewDialog";
import styles from "./AudioPractice.module.scss";

export { ReviewDialog as DraftReviewDialog, DraftReviewBody } from "./ReviewDialog";

const EMPTY_DRAFT: SubtitleDraftSnapshot = {
	status: "idle",
	cues: [],
	completedChunks: 0,
	totalChunks: 0,
	duration: 0,
	failure: null,
	error: null,
	notice: null,
	taskKey: null,
	hasReviewWordTimings: false,
};

const DEFAULT_DRAFT_ENGINE: Pick<
	SubtitleDraftEngine,
	| "subscribe"
	| "getSnapshot"
	| "generateForMaterial"
	| "commitForMaterial"
	| "cancel"
	| "dismissFailure"
	| "act"
> = {
	subscribe: () => () => {},
	getSnapshot: () => EMPTY_DRAFT,
	generateForMaterial: async () => false,
	commitForMaterial: async () => false,
	cancel: () => {},
	dismissFailure: () => {},
	act: () => {},
};

interface AudioPracticeViewProps {
	runtime: AudioPracticeRuntime;
	draftEngine?: SubtitleDraftEngine;
	files: AudioPracticeFiles;
	catalog: AudioPracticeCatalog;
	language: Language;
	onOpenSettings: () => void;
}

export function AudioPracticeView(props: AudioPracticeViewProps): React.ReactNode {
	const { runtime, draftEngine, files, catalog, language, onOpenSettings } = props;
	const snapshot = useSyncExternalStore(
		(listener) => runtime.subscribe(listener),
		() => runtime.getSnapshot(),
	);
	const activeDraftEngine =
		draftEngine ?? (DEFAULT_DRAFT_ENGINE as unknown as SubtitleDraftEngine);
	const readDraft = () =>
		draftEngine
			? activeDraftEngine.getSnapshot()
			: ((snapshot as unknown as { draft?: AudioPracticeDraftSnapshot }).draft ??
				activeDraftEngine.getSnapshot());
	const draft = useSyncExternalStore(activeDraftEngine.subscribe, readDraft, readDraft);
	const media = useRef<HTMLAudioElement>(null);
	const practiceRef = useRef<HTMLElement>(null);
	const interaction = useMemo(
		() => new PracticeViewInteraction({ runtime, containerRef: practiceRef }),
		[runtime],
	);
	useEffect(() => () => interaction.dispose(), [interaction]);
	const editSession = useMemo(
		() => new MaterialEditSession({ runtime, files, catalog }),
		[runtime, files, catalog],
	);
	useEffect(() => () => editSession.dispose(), [editSession]);
	const edit = useSyncExternalStore(
		editSession.subscribe,
		editSession.getSnapshot,
		editSession.getSnapshot,
	);
	const t = audioPracticeStrings(language);
	const [reviewOpen, setReviewOpen] = useState(false);
	const [materialToolsOpen, setMaterialToolsOpen] = useState(false);
	const [libraryCollapsed, setLibraryCollapsed] = useState(false);
	const [playerOptionsOpen, setPlayerOptionsOpen] = useState(false);
	const libraryId = useId();
	const materialActionsId = useId();
	const playerOptionsId = useId();
	const operation = snapshot.materialOperation;
	const materialBusy = operation.status === "pending" || snapshot.loading;
	const busy =
		materialBusy || ["preparing", "transcribing", "aligning", "saving"].includes(draft.status);
	const operationError = operation.failure
		? audioFailureCopy(language, operation.failure).message
		: null;
	const material = snapshot.currentMaterial;
	const generating = ["preparing", "transcribing", "aligning"].includes(draft.status);
	const reviewReady = draft.status === "review";
	const pendingCues = reviewReady ? draft.cues.filter((cue) => cue.needsReview).length : 0;
	const openMaterialDialog = (mode: "add" | "edit") => {
		if (mode === "edit") {
			if (material) editSession.openEdit(material);
		} else editSession.openAdd();
	};
	useEffect(() => {
		const audio = media.current;
		if (!audio) return;
		return interaction.bindMedia(audio);
	}, [interaction]);
	useEffect(() => {
		interaction.syncCueScroll(snapshot.currentCueId, practiceRef.current);
	}, [snapshot.currentCueId, snapshot.playing, interaction]);
	return (
		<div className={cls("fc-page fc-page--fill", styles.page)}>
			<FlashcardHeader
				icon={Headphones}
				title={t.title}
				badge={snapshot.materials.length || undefined}
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

			{/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Captions are rendered by the synchronized PracticeSurface below. */}
			<audio ref={media} preload="metadata" />
			<div
				className={cls("fc-page__content", styles.workspace)}
				data-mobile-tools-open={materialToolsOpen || !material}
				data-library-collapsed={libraryCollapsed}
			>
				<main className={styles.stage}>
					{!material && (
						<div className={cls("fc-panel", styles.empty)}>
							<span className={styles.emptyIcon} aria-hidden="true">
								<Headphones size={26} strokeWidth={1.6} />
							</span>
							<p className={styles.emptyText}>{t.empty}</p>
							<Button
								variant="primary"
								icon={Plus}
								disabled={materialBusy}
								onClick={() => openMaterialDialog("add")}
							>
								{t.add}
							</Button>
						</div>
					)}
					{material && (
						<>
							<section className={styles.materialBar} aria-label={material.title}>
								<div className={styles.materialIdentity}>
									<h2 className={styles.materialTitle}>{material.title}</h2>
									<div className={cls("fc-meta", styles.materialMeta)}>
										<span className="fc-meta__text" title={material.audioPath}>
											{material.audioPath}
										</span>
										<span className="fc-meta__dot" aria-hidden="true" />
										<span className="fc-meta__text">
											{snapshot.cues.length
												? t.segments(snapshot.cues.length)
												: t.noSubtitlesYet}
										</span>
										{snapshot.duration ? (
											<>
												<span className="fc-meta__dot" aria-hidden="true" />
												<span className="fc-meta__text">
													{timeLabel(snapshot.duration)}
												</span>
											</>
										) : null}
									</div>
								</div>
								<Button
									size="sm"
									variant="ghost"
									icon={ChevronDown}
									active={materialToolsOpen}
									className={styles.mobileToolsToggle}
									aria-label={t.materialTools}
									aria-expanded={materialToolsOpen}
									aria-controls={`${libraryId} ${materialActionsId}`}
									onClick={() => setMaterialToolsOpen((open) => !open)}
								>
									{t.manage}
									{pendingCues > 0 && (
										<span className={styles.countBadge}>{pendingCues}</span>
									)}
								</Button>
								<div id={materialActionsId} className={styles.materialActions}>
									{reviewReady && (
										<Button
											variant="secondary"
											icon={ListChecks}
											title={t.reviewHint}
											onClick={() => {
												setReviewOpen(true);
											}}
										>
											{t.review}
											{pendingCues > 0 && (
												<span className={styles.countBadge}>
													{pendingCues}
												</span>
											)}
										</Button>
									)}
									<Button
										preset="icon"
										icon={Pencil}
										aria-label={t.original}
										title={t.original}
										disabled={busy || generating}
										onClick={() => openMaterialDialog("edit")}
									/>
									<Button
										icon={Sparkles}
										disabled={busy || generating}
										onClick={() => {
											if (material)
												void activeDraftEngine.generateForMaterial(
													material,
													{
														force: true,
													},
												);
										}}
									>
										{snapshot.cues.length ? t.regenerate : t.generate}
									</Button>
								</div>
							</section>
							{(generating ||
								draft.status === "error" ||
								draft.status === "cancelled") && (
								<output
									className={styles.statusStrip}
									data-tone={
										generating
											? "busy"
											: draft.status === "error"
												? "error"
												: "muted"
									}
								>
									<span className={styles.statusIcon} aria-hidden="true">
										{generating ? (
											<LoaderCircle size={16} className={styles.spinning} />
										) : (
											<CircleAlert size={16} />
										)}
									</span>
									<span className={styles.statusText}>
										{generating
											? `${draft.status === "preparing" ? t.preparing : draft.status === "aligning" ? t.aligning : t.transcribing}${draft.totalChunks > 0 ? ` · ${t.chunks(draft.completedChunks, draft.totalChunks)}` : ""}`
											: draft.status === "error"
												? draft.failure
													? audioFailureCopy(language, draft.failure)
															.message
													: t.failed
												: t.cancelled}
									</span>
									{generating && (
										<Button
											size="sm"
											onClick={() => activeDraftEngine.cancel()}
										>
											{t.cancel}
										</Button>
									)}
									{!generating &&
										(draft.status === "error" ||
											draft.status === "cancelled") && (
											<Button
												size="sm"
												icon={RotateCcw}
												disabled={busy}
												onClick={() => {
													if (material)
														void activeDraftEngine.generateForMaterial(
															material,
														);
												}}
											>
												{t.retry}
											</Button>
										)}
								</output>
							)}
							{draft.status === "review" && draft.notice === "no-word-timestamps" && (
								<p className={styles.notice}>{t.noWordTimestamps}</p>
							)}
							{snapshot.invalidatedMarks > 0 && (
								<p className={styles.notice}>
									{t.marksInvalidated(snapshot.invalidatedMarks)}
								</p>
							)}
							<PracticeSurface
								runtime={runtime}
								snapshot={snapshot}
								t={t}
								surfaceRef={practiceRef}
								onKeyDown={interaction.handleKeyDown}
								playerOptionsOpen={playerOptionsOpen}
								playerOptionsId={playerOptionsId}
								onTogglePlayerOptions={() => setPlayerOptionsOpen((open) => !open)}
							/>
						</>
					)}
					{operationError && edit.failure === null && (
						<div role="alert" className={styles.alert}>
							{operationError}
							<Button
								preset="icon"
								icon={X}
								aria-label={t.close}
								onClick={() => runtime.dismissMaterialOperationFailure()}
							/>
						</div>
					)}
					{snapshot.failure && (
						<p role="alert" className={styles.alert}>
							{audioFailureCopy(language, snapshot.failure).message}
						</p>
					)}
					{draft.error && !reviewOpen && (
						<p role="alert" className={styles.alert}>
							{audioFailureCopy(language, draft.error).message}
						</p>
					)}
				</main>
				<aside
					id={libraryId}
					className={cls("fc-panel", styles.library)}
					aria-label={t.library}
					data-collapsed={libraryCollapsed}
				>
					<header className={styles.libraryHeader}>
						<h2 className={styles.libraryTitle}>
							{t.library}
							<span className={styles.libraryCount}>{snapshot.materials.length}</span>
						</h2>
						<div className={styles.libraryActions}>
							<Button
								preset="icon"
								icon={Plus}
								aria-label={t.add}
								title={t.add}
								disabled={materialBusy}
								onClick={() => openMaterialDialog("add")}
							/>
							<Button
								preset="icon"
								icon={libraryCollapsed ? PanelRightOpen : PanelRightClose}
								className={styles.libraryToggle}
								aria-label={libraryCollapsed ? t.expandLibrary : t.collapseLibrary}
								title={libraryCollapsed ? t.expandLibrary : t.collapseLibrary}
								aria-expanded={!libraryCollapsed}
								aria-controls={libraryId}
								onClick={() => setLibraryCollapsed((collapsed) => !collapsed)}
							/>
						</div>
					</header>
					<div className={styles.materialList}>
						{snapshot.materials.length === 0 && (
							<p className={styles.libraryEmpty}>{t.libraryEmpty}</p>
						)}
						{snapshot.materials.map((item) => {
							const active = item.id === material?.id;
							return (
								<div
									key={item.id}
									className={cls(
										styles.materialRow,
										active && styles.materialRowActive,
									)}
								>
									<Button
										variant="ghost"
										className={styles.materialSelect}
										disabled={materialBusy}
										aria-current={active ? "true" : undefined}
										onClick={() =>
											void runtime.selectMaterial(item.id).then(
												() => {
													if (
														runtime.getSnapshot().currentMaterialId ===
														item.id
													)
														setMaterialToolsOpen(false);
												},
												() => {},
											)
										}
									>
										<span className={styles.materialName}>{item.title}</span>
										<span className={styles.materialPath}>
											{fileName(item.audioPath)}
										</span>
									</Button>
									<Button
										preset="icon"
										size="sm"
										icon={Trash2}
										className={styles.materialRemove}
										aria-label={`${t.remove}: ${item.title}`}
										title={t.remove}
										disabled={materialBusy}
										onClick={() =>
											void runtime.removeMaterial(item.id).catch(() => {})
										}
									/>
								</div>
							);
						})}
					</div>
					<p className={styles.libraryHint}>{t.removeHint}</p>
				</aside>
			</div>
			{edit.open && (
				<MaterialDialog
					edit={edit}
					t={t}
					language={language}
					busy={
						edit.busy ||
						materialBusy ||
						(edit.mode === "edit" &&
							generating &&
							edit.expectedMaterial?.id === material?.id)
					}
					error={edit.failure ? audioFailureCopy(language, edit.failure).message : null}
					onCancel={() => {
						if (edit.failure) runtime.dismissMaterialOperationFailure();
						editSession.cancel();
					}}
					onField={(field, value) => editSession.setField(field, value)}
					onText={(value) => editSession.setText(value)}
					onReadTextFile={(path) => void editSession.readTextFile(path)}
					onSubmit={() => void editSession.submit()}
				/>
			)}
			{reviewOpen && reviewReady && material && (
				<ReviewDialog
					draft={draft}
					material={material}
					engine={activeDraftEngine}
					onPreview={(start, end) => runtime.preview(start, end)}
					t={t}
					busy={busy}
					error={draft.error ? audioFailureCopy(language, draft.error).message : null}
					onRequestClose={() => {
						setReviewOpen(false);
					}}
				/>
			)}
		</div>
	);
}

type MaterialFieldName = "title" | "audioPath" | "subtitlePath";

interface MaterialDialogProps {
	readonly edit: MaterialEditSessionSnapshot;
	readonly t: AudioPracticeStrings;
	readonly language: Language;
	readonly busy: boolean;
	readonly error: string | null;
	readonly initialFocusProps?: { "data-modal-initial-focus": string };
	onCancel(): void;
	onField(field: MaterialFieldName, value: string): void;
	onText(value: string): void;
	onReadTextFile(path: string): void;
	onSubmit(): void;
}

function MaterialDialog(props: MaterialDialogProps): React.ReactNode {
	const { t } = props;
	const titleId = useId();
	return (
		<ModalSurface
			className={styles.materialDialog}
			labelledBy={titleId}
			onRequestClose={() => props.onCancel()}
			isDismissible={!props.busy}
		>
			{({ requestClose, initialFocusProps }) => (
				<>
					<div className="flashcard-modal-header">
						<div className="flashcard-modal-heading">
							<span id={titleId} className="flashcard-modal-title">
								<NotebookPen size={17} />
								{props.edit.mode === "edit" ? t.original : t.add}
							</span>
							<span className="flashcard-modal-subtitle">{t.materialDialogHint}</span>
						</div>
						<Button
							preset="icon"
							icon={X}
							disabled={props.busy}
							aria-label={t.close}
							title={t.close}
							onClick={requestClose}
						/>
					</div>
					<MaterialForm
						{...props}
						initialFocusProps={initialFocusProps}
						onCancel={requestClose}
					/>
				</>
			)}
		</ModalSurface>
	);
}

function MaterialForm(props: MaterialDialogProps): React.ReactNode {
	const { edit, t } = props;
	const { fields, candidates } = edit;
	return (
		<form
			className={styles.materialForm}
			onSubmit={(event) => {
				event.preventDefault();
				if (props.busy || edit.readingText || !fields.audioPath) return;
				props.onSubmit();
			}}
		>
			<div className={cls("flashcard-modal-body", styles.materialBody)}>
				{props.error && (
					<p role="alert" className={styles.alert}>
						{props.error}
					</p>
				)}
				<label className={styles.field}>
					<span>{t.name}</span>
					<FlashcardInput
						disabled={props.busy}
						value={fields.title}
						onChange={(event) => props.onField("title", event.target.value)}
						{...props.initialFocusProps}
					/>
				</label>
				<label className={styles.field}>
					<span>{t.audio}</span>
					<FlashcardSelect
						disabled={props.busy}
						value={fields.audioPath}
						onChange={(event) => props.onField("audioPath", event.target.value)}
						required
					>
						<option value="">{t.choose}</option>
						{candidates.audioPaths.map((path) => (
							<option key={path}>{path}</option>
						))}
					</FlashcardSelect>
				</label>
				<div className={styles.fieldGrid}>
					<label className={styles.field}>
						<span>{t.subtitle}</span>
						<FlashcardSelect
							disabled={props.busy}
							value={fields.subtitlePath ?? ""}
							onChange={(event) => props.onField("subtitlePath", event.target.value)}
						>
							<option value="">{t.noSubtitle}</option>
							{candidates.subtitlePaths.map((path) => (
								<option key={path}>{path}</option>
							))}
						</FlashcardSelect>
					</label>
					<label className={styles.field}>
						<span>{t.textFile}</span>
						<FlashcardSelect
							disabled={props.busy}
							defaultValue=""
							onChange={(event) => props.onReadTextFile(event.target.value)}
						>
							<option value="">{t.choose}</option>
							{candidates.textPaths.map((path) => (
								<option key={path}>{path}</option>
							))}
						</FlashcardSelect>
					</label>
				</div>
				<label className={styles.field}>
					<span>{t.text}</span>
					<FlashcardTextarea
						disabled={props.busy}
						value={fields.text}
						onChange={(event) => props.onText(event.target.value)}
						rows={5}
					/>
				</label>
				{edit.readFailure && (
					<p role="alert" className={styles.alert}>
						{audioFailureCopy(props.language, edit.readFailure).message}
					</p>
				)}
			</div>
			<div className={cls("flashcard-modal-footer", styles.dialogFooter)}>
				<Button disabled={props.busy} onClick={() => props.onCancel()}>
					{t.cancel}
				</Button>
				<Button
					type="submit"
					variant="primary"
					disabled={props.busy || edit.readingText || !edit.canSubmit}
				>
					{edit.mode === "edit" ? t.save : t.create}
				</Button>
			</div>
		</form>
	);
}

function renderTimedCueText(
	text: string,
	words: readonly TimedTextWord[] | undefined,
	audioTime: number,
): React.ReactNode {
	if (!words?.length) return text;
	let cursor = 0;
	for (const word of words) {
		if (
			word.startOffset < cursor ||
			word.endOffset <= word.startOffset ||
			word.endOffset > text.length
		)
			return text;
		cursor = word.endOffset;
	}
	const parts: React.ReactNode[] = [];
	cursor = 0;
	for (const [index, word] of words.entries()) {
		if (word.startOffset > cursor) parts.push(text.slice(cursor, word.startOffset));
		const end = words[index + 1]?.startOffset ?? text.length;
		const spoken = audioTime >= word.start;
		parts.push(
			<span
				key={index}
				className={spoken ? styles.cueWordSpoken : undefined}
				data-spoken-word={spoken ? "true" : undefined}
			>
				{text.slice(word.startOffset, end)}
			</span>,
		);
		cursor = end;
	}
	return parts;
}

export function PracticeSurface({
	runtime,
	snapshot,
	t,
	surfaceRef,
	onKeyDown,
	playerOptionsOpen = false,
	playerOptionsId = "audio-practice-player-options",
	onTogglePlayerOptions,
}: {
	runtime: AudioPracticeRuntime;
	snapshot: AudioPracticeSnapshot;
	t: AudioPracticeStrings;
	surfaceRef?: React.Ref<HTMLElement>;
	onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
	playerOptionsOpen?: boolean;
	playerOptionsId?: string;
	onTogglePlayerOptions?: () => void;
}): React.ReactNode {
	const marks = snapshot.currentMaterial
		? (snapshot.progress[snapshot.currentMaterial.id]?.difficultCueIds ?? [])
		: [];
	const cues = snapshot.difficultOnly
		? snapshot.cues.filter((cue) => marks.includes(cue.id))
		: snapshot.cues;
	const offset = snapshot.currentMaterial
		? (snapshot.progress[snapshot.currentMaterial.id]?.offset ?? 0)
		: 0;
	const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
		if (onKeyDown) {
			onKeyDown(event);
			return;
		}
		if (
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.nativeEvent?.isComposing ||
			(event.target as HTMLElement).closest?.(
				"button,input,textarea,select,[contenteditable=true]",
			)
		) {
			return;
		}
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
	};
	return (
		// The practice panel is a composite keyboard surface with its own focus target.
		/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
		<section
			ref={surfaceRef}
			className={cls("fc-panel fc-focus-ring", styles.practice)}
			aria-label={t.captions}
			tabIndex={0}
			onKeyDown={handleKeyDown}
		>
			<header className={styles.practiceHeader}>
				<fieldset className={styles.modeSwitch} aria-label={t.mode}>
					<Button
						size="sm"
						variant="ghost"
						icon={ListMusic}
						active={snapshot.mode === "sentence"}
						aria-pressed={snapshot.mode === "sentence"}
						onClick={() => runtime.setMode("sentence")}
					>
						{t.sentence}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						icon={AudioLines}
						active={snapshot.mode === "continuous"}
						aria-pressed={snapshot.mode === "continuous"}
						disabled={snapshot.difficultOnly}
						title={snapshot.difficultOnly ? t.modeLocked : t.continuous}
						onClick={() => runtime.setMode("continuous")}
					>
						{t.continuous}
					</Button>
				</fieldset>
				<span className={styles.toolbarDivider} aria-hidden="true" />
				<div className={styles.toggleGroup}>
					<FlashcardCheckbox
						checked={snapshot.blind}
						onChange={(event) => runtime.setBlind(event.target.checked)}
						label={t.blind}
					/>
					<FlashcardCheckbox
						checked={snapshot.difficultOnly}
						onChange={(event) => runtime.setDifficultOnly(event.target.checked)}
						label={t.difficultOnly}
					/>
				</div>
				{snapshot.blind && (
					<Button
						size="sm"
						icon={EyeOff}
						disabled={!snapshot.currentCueId}
						onClick={() => runtime.reveal()}
					>
						{t.reveal}
					</Button>
				)}
				<span className={styles.toolbarSpacer} />
				<span className={styles.shortcutHint} aria-hidden="true">
					{t.shortcuts}
				</span>
				<span className={styles.cueCount}>{t.segments(cues.length)}</span>
			</header>
			<div className={styles.cueScroll}>
				{cues.length === 0 ? (
					<div className={styles.cueEmpty}>
						<ListMusic size={22} strokeWidth={1.6} aria-hidden="true" />
						<p>{snapshot.cues.length ? t.noDifficult : t.noCues}</p>
					</div>
				) : (
					<ol className={styles.cueList}>
						{cues.map((cue) => {
							const active = cue.id === snapshot.currentCueId;
							const marked = marks.includes(cue.id);
							const hidden = snapshot.blind && !(active && snapshot.revealed);
							return (
								<li
									key={cue.id}
									data-current-cue={active ? "true" : undefined}
									className={cls(styles.cue, active && styles.cueActive)}
								>
									<Button
										variant="ghost"
										className={styles.cueSelect}
										aria-current={active ? "true" : undefined}
										onClick={() => runtime.selectCue(cue.id, true)}
									>
										<span className={styles.cueTime}>
											{timeLabel(cue.start)}
										</span>
										<span className={styles.cueText}>
											{hidden ? (
												<span className={styles.cueHidden}>
													<EyeOff size={13} aria-hidden="true" />
													{t.hidden}
												</span>
											) : (
												renderTimedCueText(
													cue.text,
													active
														? snapshot.currentMaterial?.wordTimings?.[
																cue.id
															]
														: undefined,
													snapshot.currentTime - offset,
												)
											)}
										</span>
									</Button>
									<Button
										preset="icon"
										variant="ghost"
										icon={Star}
										iconSize={15}
										className={cls(
											styles.cueStar,
											marked && styles.cueStarActive,
										)}
										active={marked}
										aria-pressed={marked}
										aria-label={`${t.difficult}: ${timeLabel(cue.start)}`}
										title={t.difficult}
										onClick={() => runtime.toggleDifficult(cue.id)}
									/>
								</li>
							);
						})}
					</ol>
				)}
			</div>
			{renderPlayerDock(
				runtime,
				snapshot,
				t,
				playerOptionsOpen,
				playerOptionsId,
				onTogglePlayerOptions,
			)}
		</section>
	);
}

function renderPlayerDock(
	runtime: AudioPracticeRuntime,
	snapshot: AudioPracticeSnapshot,
	t: AudioPracticeStrings,
	optionsOpen: boolean,
	optionsId: string,
	onToggleOptions?: () => void,
): React.ReactNode {
	const duration = snapshot.duration ?? 0;
	const position = snapshot.currentCueId
		? snapshot.cues.findIndex((cue) => cue.id === snapshot.currentCueId)
		: -1;
	const offset = snapshot.currentMaterial
		? (snapshot.progress[snapshot.currentMaterial.id]?.offset ?? 0)
		: 0;
	const hasCues = snapshot.cues.length > 0;
	return (
		<footer className={styles.player} aria-label={t.playbackOptions}>
			<div className={styles.seekRow}>
				<span className={styles.time}>{timeLabel(snapshot.currentTime)}</span>
				<FlashcardSlider
					wrapperClassName={styles.seek}
					aria-label={t.progress}
					min={0}
					max={duration}
					step={0.05}
					value={Math.min(snapshot.currentTime, duration)}
					disabled={!duration}
					onChange={(event) => runtime.seekTo(Number(event.target.value))}
				/>
				<span className={styles.time}>{timeLabel(duration)}</span>
			</div>
			<div className={styles.playerRow}>
				<div className={styles.nowPlaying}>
					<span className={styles.nowPlayingMeta}>
						<span>{snapshot.mode === "sentence" ? t.sentence : t.continuous}</span>
						<span aria-hidden="true">·</span>
						<span>
							{position >= 0
								? t.cueCounter(position + 1, snapshot.cues.length)
								: t.noCues}
						</span>
					</span>
				</div>
				<fieldset className={styles.transport} aria-label={t.captions}>
					<Button
						preset="icon"
						variant="ghost"
						icon={SkipBack}
						aria-label={t.previous}
						title={t.previous}
						disabled={!hasCues}
						onClick={() => runtime.previous()}
					/>
					<Button
						preset="icon"
						variant="ghost"
						icon={RotateCcw}
						aria-label={t.repeat}
						title={t.repeat}
						disabled={!hasCues}
						onClick={() => runtime.repeat()}
					/>
					<Button
						preset="icon"
						variant="primary"
						icon={snapshot.playing ? Pause : Play}
						iconSize={20}
						className={styles.playButton}
						aria-label={snapshot.playing ? t.pause : t.play}
						title={snapshot.playing ? t.pause : t.play}
						onClick={() => runtime.togglePlayback()}
					/>
					<Button
						preset="icon"
						variant="ghost"
						icon={SkipForward}
						aria-label={t.next}
						title={t.next}
						disabled={!hasCues}
						onClick={() => runtime.next()}
					/>
				</fieldset>
				<div className={styles.playerOptions} data-expanded={optionsOpen}>
					<Button
						size="sm"
						variant="ghost"
						icon={SlidersHorizontal}
						active={optionsOpen}
						className={styles.playerOptionsToggle}
						aria-expanded={optionsOpen}
						aria-controls={optionsId}
						onClick={onToggleOptions}
					>
						{t.playbackOptions}
					</Button>
					<div id={optionsId} className={styles.playerOptionFields}>
						<PlaybackRateControl
							className={styles.rateControl}
							label={t.rate}
							value={snapshot.playbackRate}
							rates={AUDIO_PLAYBACK_RATES}
							align="end"
							onChange={(rate) =>
								runtime.setPlaybackRate(
									rate as (typeof AUDIO_PLAYBACK_RATES)[number],
								)
							}
						/>
						<label className={styles.option}>
							<span>{t.offset}</span>
							<FlashcardInput
								type="number"
								step="0.1"
								inputSize="sm"
								fullWidth={false}
								className={styles.offsetInput}
								aria-label={t.offset}
								value={offset}
								onChange={(event) => {
									if (Number.isFinite(event.target.valueAsNumber))
										runtime.setOffset(event.target.valueAsNumber);
								}}
							/>
						</label>
					</div>
				</div>
			</div>
		</footer>
	);
}

function fileName(path: string): string {
	return path.split("/").pop() ?? path;
}

function timeLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
	return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}
