import React, { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
	ChevronDown,
	ChevronRight,
	ChevronUp,
	CirclePlay,
	FastForward,
	FolderPlus,
	GripVertical,
	Maximize2,
	Minimize2,
	Pause,
	Play,
	Rewind,
	Settings,
	SkipBack,
	SkipForward,
	Trash2,
	X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FlashcardButton } from "../../../core/ui/primitives/Button";
import { FlashcardHeader } from "../../../core/ui/primitives/Header";
import { cls } from "../../../core/shared/classNames";
import type { Language } from "../../../core/shared/types";
import type { LocalVideoSource, VideoPlayerSnapshot } from "../domain/types";
import { VIDEO_PLAYBACK_RATES } from "../domain/types";
import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";
import { matchesKeyboardShortcut } from "../settings/keyboardShortcut";
import type { VideoPlayerSettings } from "../settings/slice";
import { videoPlayerStrings } from "../strings/videoPlayer";
import styles from "./VideoPlayer.module.scss";
import type {
	PlayerViewMount,
	PlayerViewPresentation,
	PlayerViewRefs,
} from "./playerViewInteraction";

/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- The player is a composite keyboard surface. */
/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The composite player must be tabbable. */

export interface VideoPlayerViewProps {
	runtime: VideoPlayerRuntime;
	view: PlayerViewMount;
	language: Language;
	rootEl: HTMLElement;
	settings: VideoPlayerSettings;
	onFocusExisting: () => void;
	onOpenSettings: () => void;
	onPickVideos: () => Promise<readonly LocalVideoSource[]>;
	onPickReplacement: (sourceId: string) => Promise<LocalVideoSource | null>;
}

export function VideoPlayerView({
	runtime,
	view,
	language,
	rootEl,
	settings,
	onFocusExisting,
	onOpenSettings,
	onPickVideos,
	onPickReplacement,
}: VideoPlayerViewProps): React.ReactNode {
	const snapshot = useSyncExternalStore(
		(listener) => runtime.subscribe(listener),
		() => runtime.getSnapshot(),
	);
	const viewSnapshot = useSyncExternalStore(
		(listener) => view.subscribe(listener),
		() => view.getSnapshot(),
	);
	const t = videoPlayerStrings(language);
	const document = rootEl.ownerDocument;
	const draggedId = useRef<string | null>(null);
	const floating = viewSnapshot.presentation.kind === "floating";

	const addVideos = useCallback(async () => {
		const sources = await onPickVideos();
		runtime.addSources(sources);
	}, [onPickVideos, runtime]);

	const currentIndex = snapshot.sources.findIndex(
		(source) => source.id === snapshot.currentSourceId,
	);
	if (viewSnapshot.role !== "presenter") {
		return (
			<div className={styles.empty}>
				<h3>{t.activeElsewhere}</h3>
				<FlashcardButton variant="primary" onClick={onFocusExisting}>
					{t.focusPlayer}
				</FlashcardButton>
			</div>
		);
	}
	const renderPlayer = () => (
		<PlayerSurface
			currentTime={snapshot.currentTime}
			duration={snapshot.duration}
			error={
				snapshot.error === "playback"
					? t.decodeError
					: snapshot.error === "media"
						? t.decodeError
						: null
			}
			floating={floating}
			focusSurfaceRef={view.refs.focusSurface}
			mediaHostRef={view.refs.mediaHost}
			playing={snapshot.playing}
			rate={snapshot.playbackRate}
			settings={settings}
			canPrevious={currentIndex > 0}
			canNext={currentIndex >= 0 && currentIndex < snapshot.sources.length - 1}
			onToggle={() => runtime.togglePlayback()}
			onPrevious={() => runtime.previous()}
			onNext={() => runtime.next()}
			onBackward={() => runtime.seekBy(-settings.skipInterval)}
			onForward={() => runtime.seekBy(settings.skipInterval)}
			onSeek={(time) => runtime.seekTo(time)}
			onRate={(rate) => runtime.setPlaybackRate(rate)}
			onFloat={() => view.act({ type: "enter-floating" })}
			t={t}
		/>
	);

	return (
		<div className={cls("fc-page fc-page--fill", styles.page)}>
			<FlashcardHeader
				icon={CirclePlay}
				title={t.title}
				badge={snapshot.sources.length > 0 ? snapshot.sources.length : undefined}
				right={
					<div className="flashcard-header-actions">
						<FlashcardButton
							preset="icon"
							icon={Settings}
							title={t.settings}
							aria-label={t.settings}
							onClick={onOpenSettings}
						/>
						<FlashcardButton
							icon={FolderPlus}
							preset="icon"
							title={t.addVideos}
							aria-label={t.addVideos}
							onClick={() => void addVideos()}
						/>
					</div>
				}
			/>

			<div className={cls("fc-page__body", styles.pageBody)}>
				{snapshot.sources.length === 0 ? (
					<div className={styles.empty}>
						<h3>{t.emptyTitle}</h3>
						<p>{t.emptyDescription}</p>
						<FlashcardButton
							variant="primary"
							icon={FolderPlus}
							onClick={() => void addVideos()}
						>
							{t.addVideos}
						</FlashcardButton>
					</div>
				) : (
					<div className={styles.layout}>
						<section className={styles.playerPanel}>
							{floating ? (
								<div className={styles.floatingPlaceholder}>
									<p>{t.floating}</p>
									<FlashcardButton
										variant="secondary"
										onClick={() => view.act({ type: "dock-and-pause" })}
									>
										{t.dockAndPause}
									</FlashcardButton>
								</div>
							) : (
								renderPlayer()
							)}
						</section>
						<aside className={styles.queue} aria-label={t.queue}>
							<div className={styles.queueHeader}>
								<button
									type="button"
									className={styles.queueHeading}
									aria-expanded={viewSnapshot.queueExpanded}
									title={
										viewSnapshot.queueExpanded ? t.queueCollapse : t.queueExpand
									}
									onClick={() =>
										view.act({
											type: "set-queue-expanded",
											expanded: !viewSnapshot.queueExpanded,
										})
									}
								>
									<span className={styles.queueChevron}>
										{viewSnapshot.queueExpanded ? (
											<ChevronDown size={16} />
										) : (
											<ChevronRight size={16} />
										)}
									</span>
									<span className={styles.queueSummaryText}>
										{t.queueSummary(snapshot.sources.length, currentIndex + 1)}
									</span>
								</button>
								<div className={styles.queueHeaderActions}>
									<button
										type="button"
										className={styles.queueAddBtn}
										onClick={(event) => {
											event.stopPropagation();
											void addVideos();
										}}
										title={t.addVideos}
									>
										<FolderPlus size={14} aria-hidden="true" />
										<span>{t.addVideos}</span>
									</button>
								</div>
							</div>
							{viewSnapshot.queueExpanded && (
								<div className={styles.queueList}>
									{snapshot.sources.map((source, index) => {
										const isActive = source.id === snapshot.currentSourceId;
										const progressLabel = sourceProgressLabel(
											source.id,
											snapshot,
											t,
										);
										return (
											<div
												key={source.id}
												className={`${styles.queueItem} ${isActive ? styles.active : ""}`}
												onDragOver={(event) => event.preventDefault()}
												onDrop={() => {
													const dragged = draggedId.current;
													if (!dragged || dragged === source.id) return;
													const ids = snapshot.sources.map(
														(item) => item.id,
													);
													const from = ids.indexOf(dragged);
													const to = ids.indexOf(source.id);
													if (from < 0 || to < 0) return;
													ids.splice(to, 0, ...ids.splice(from, 1));
													runtime.reorderSources(ids);
												}}
											>
												<div
													className={styles.dragHandle}
													draggable
													aria-label={t.dragToReorder}
													title={t.dragToReorder}
													onDragStart={() => {
														draggedId.current = source.id;
													}}
												>
													<GripVertical size={14} aria-hidden="true" />
												</div>
												<div
													className={styles.sourceIndex}
													aria-hidden="true"
												>
													{isActive ? (
														<Play
															size={11}
															className={styles.activePlayIcon}
														/>
													) : (
														<span>{index + 1}</span>
													)}
												</div>
												<div
													role="button"
													tabIndex={0}
													className={styles.sourceContent}
													onClick={() => runtime.selectSource(source.id)}
													onKeyDown={(event) => {
														if (
															event.key === "Enter" ||
															event.key === " "
														) {
															event.preventDefault();
															runtime.selectSource(source.id);
														}
													}}
													title={`${source.name}\n${source.path}`}
												>
													<div className={styles.sourceName}>
														{source.name}
													</div>
													{progressLabel && (
														<div className={styles.sourceMeta}>
															<span
																className={
																	isActive
																		? styles.playingTag
																		: styles.progressTag
																}
															>
																{progressLabel}
															</span>
														</div>
													)}
												</div>
												<div className={styles.itemActions}>
													{snapshot.sources.length > 1 && (
														<>
															<IconButton
																icon={ChevronUp}
																size={14}
																className={styles.actionBtn}
																label={t.moveUp}
																disabled={index === 0}
																onClick={() =>
																	moveSource(
																		runtime,
																		snapshot.sources,
																		index,
																		index - 1,
																	)
																}
															/>
															<IconButton
																icon={ChevronDown}
																size={14}
																className={styles.actionBtn}
																label={t.moveDown}
																disabled={
																	index ===
																	snapshot.sources.length - 1
																}
																onClick={() =>
																	moveSource(
																		runtime,
																		snapshot.sources,
																		index,
																		index + 1,
																	)
																}
															/>
														</>
													)}
													<IconButton
														icon={FolderPlus}
														size={14}
														className={styles.actionBtn}
														label={t.replace}
														onClick={async () => {
															const replacement =
																await onPickReplacement(source.id);
															if (replacement) {
																runtime.replaceSource(
																	source.id,
																	replacement,
																);
															}
														}}
													/>
													<IconButton
														icon={Trash2}
														size={14}
														className={`${styles.actionBtn} ${styles.deleteBtn}`}
														label={t.remove}
														onClick={() =>
															runtime.removeSource(source.id)
														}
													/>
												</div>
											</div>
										);
									})}
								</div>
							)}
						</aside>
					</div>
				)}
			</div>

			{viewSnapshot.presentation.kind === "floating" &&
				createPortal(
					<FloatingPlayer
						presentation={viewSnapshot.presentation}
						floatingHeaderRef={view.refs.floatingHeader}
						resizeLeftRef={view.refs.resizeLeft}
						resizeRightRef={view.refs.resizeRight}
						onClose={() => view.act({ type: "dock-and-pause" })}
						onToggleMaximize={() => view.act({ type: "toggle-maximized" })}
						title={t.title}
						closeLabel={t.dockAndPause}
						maximizeLabel={t.maximize}
						restoreLabel={t.restore}
						resizeLeftLabel={t.resizeLeft}
						resizeRightLabel={t.resizeRight}
					>
						{renderPlayer()}
					</FloatingPlayer>,
					document.body,
				)}
		</div>
	);
}

type PlayerCopy = ReturnType<typeof videoPlayerStrings>;

function PlayerSurface({
	currentTime,
	duration,
	error,
	floating,
	focusSurfaceRef,
	mediaHostRef,
	playing,
	rate,
	settings,
	canPrevious,
	canNext,
	onToggle,
	onPrevious,
	onNext,
	onBackward,
	onForward,
	onSeek,
	onRate,
	onFloat,
	t,
}: {
	currentTime: number;
	duration: number | null;
	error: string | null;
	floating: boolean;
	focusSurfaceRef: (node: HTMLDivElement | null) => void;
	mediaHostRef: (node: HTMLDivElement | null) => void;
	playing: boolean;
	rate: number;
	settings: VideoPlayerSettings;
	canPrevious: boolean;
	canNext: boolean;
	onToggle: () => void;
	onPrevious: () => void;
	onNext: () => void;
	onBackward: () => void;
	onForward: () => void;
	onSeek: (time: number) => void;
	onRate: (rate: (typeof VIDEO_PLAYBACK_RATES)[number]) => void;
	onFloat: () => void;
	t: PlayerCopy;
}): React.ReactNode {
	const handleShortcut = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (isInteractiveTarget(event.target)) return;
		const action = matchesKeyboardShortcut(event, settings.shortcuts.togglePlayback)
			? onToggle
			: matchesKeyboardShortcut(event, settings.shortcuts.seekBackward)
				? onBackward
				: matchesKeyboardShortcut(event, settings.shortcuts.seekForward)
					? onForward
					: null;
		if (!action) return;
		event.preventDefault();
		event.stopPropagation();
		if (!event.repeat) action();
	};

	return (
		<div
			ref={focusSurfaceRef}
			className={styles.surface}
			tabIndex={0}
			role="application"
			aria-label={t.playerRegion}
			onKeyDown={handleShortcut}
			onPointerDown={(event) => {
				if (!isInteractiveTarget(event.target)) event.currentTarget.focus();
			}}
		>
			<div ref={mediaHostRef} className={styles.mediaHost} />
			{error && <p className={styles.error}>{error}</p>}
			<ProgressSlider
				currentTime={currentTime}
				duration={duration}
				skipInterval={settings.skipInterval}
				label={t.progress}
				onSeek={onSeek}
			/>
			<div className={styles.controls}>
				<IconButton
					icon={SkipBack}
					label={t.previous}
					disabled={!canPrevious}
					onClick={onPrevious}
				/>
				<IconButton
					icon={Rewind}
					label={t.backward(settings.skipInterval)}
					onClick={onBackward}
				/>
				<FlashcardButton
					preset="icon"
					variant="primary"
					icon={playing ? Pause : Play}
					iconSize={18}
					className={styles.playBtn}
					aria-label={playing ? t.pause : t.play}
					title={playing ? t.pause : t.play}
					onClick={onToggle}
				/>
				<IconButton
					icon={FastForward}
					label={t.forward(settings.skipInterval)}
					onClick={onForward}
				/>
				<IconButton
					icon={SkipForward}
					label={t.next}
					disabled={!canNext}
					onClick={onNext}
				/>
				<label className={styles.rateControl}>
					<span>{t.rate}</span>
					<select
						value={String(rate)}
						onChange={(event) =>
							onRate(
								Number(event.target.value) as (typeof VIDEO_PLAYBACK_RATES)[number],
							)
						}
					>
						{VIDEO_PLAYBACK_RATES.map((value) => (
							<option key={value} value={value}>
								{value}×
							</option>
						))}
					</select>
				</label>
				{!floating && <IconButton icon={Minimize2} label={t.floating} onClick={onFloat} />}
			</div>
		</div>
	);
}

function ProgressSlider({
	currentTime,
	duration,
	skipInterval,
	label,
	onSeek,
}: {
	currentTime: number;
	duration: number | null;
	skipInterval: number;
	label: string;
	onSeek: (time: number) => void;
}): React.ReactNode {
	const [draft, setDraft] = useState<number | null>(null);
	const draftRef = useRef<number | null>(null);
	const maximum = duration && duration > 0 ? duration : 0;
	const displayed = maximum > 0 ? clamp(draft ?? currentTime, 0, maximum) : 0;
	const updateDraft = (value: number) => {
		const next = clamp(value, 0, maximum);
		draftRef.current = next;
		setDraft(next);
	};
	const commit = () => {
		if (draftRef.current === null) return;
		onSeek(draftRef.current);
		draftRef.current = null;
		setDraft(null);
	};

	return (
		<div className={styles.progressRow}>
			<span>{formatTime(displayed)}</span>
			<input
				type="range"
				className={styles.progress}
				aria-label={label}
				aria-valuetext={`${formatTime(displayed)} / ${formatTime(maximum)}`}
				min={0}
				max={maximum}
				step={1}
				value={displayed}
				disabled={maximum <= 0}
				onChange={(event) => updateDraft(Number(event.target.value))}
				onPointerUp={commit}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
					event.preventDefault();
					event.stopPropagation();
					if (event.repeat) return;
					const direction = event.key === "ArrowLeft" ? -1 : 1;
					updateDraft(displayed + direction * (event.shiftKey ? skipInterval : 1));
				}}
				onKeyUp={(event) => {
					if (event.key === "ArrowLeft" || event.key === "ArrowRight") commit();
				}}
			/>
			<span>{formatTime(maximum)}</span>
		</div>
	);
}

export function FloatingPlayer({
	presentation,
	floatingHeaderRef,
	resizeLeftRef,
	resizeRightRef,
	onClose,
	onToggleMaximize,
	title,
	closeLabel,
	maximizeLabel,
	restoreLabel,
	resizeLeftLabel,
	resizeRightLabel,
	children,
}: {
	presentation: Extract<PlayerViewPresentation, { kind: "floating" }>;
	floatingHeaderRef: PlayerViewRefs["floatingHeader"];
	resizeLeftRef: PlayerViewRefs["resizeLeft"];
	resizeRightRef: PlayerViewRefs["resizeRight"];
	onClose: () => void;
	onToggleMaximize: () => void;
	title: string;
	closeLabel: string;
	maximizeLabel: string;
	restoreLabel: string;
	resizeLeftLabel: string;
	resizeRightLabel: string;
	children: React.ReactNode;
}): React.ReactNode {
	return (
		<section
			aria-label={title}
			className={cls(styles.floatingPlayer, presentation.maximized && styles.maximized)}
			style={{
				left: presentation.maximized ? 0 : presentation.rect.x,
				top: presentation.maximized ? 0 : presentation.rect.y,
				width: presentation.maximized ? "100%" : presentation.rect.width,
				height: presentation.maximized ? "100%" : presentation.rect.height,
			}}
		>
			<header ref={floatingHeaderRef} className={styles.floatingHeader}>
				<strong>{title}</strong>
				<div className={styles.floatingHeaderActions}>
					<IconButton
						icon={presentation.maximized ? Minimize2 : Maximize2}
						label={presentation.maximized ? restoreLabel : maximizeLabel}
						onClick={onToggleMaximize}
					/>
					<IconButton icon={X} label={closeLabel} onClick={onClose} />
				</div>
			</header>
			<div className={styles.floatingBody}>{children}</div>
			{!presentation.maximized && (
				<>
					<button
						type="button"
						className={`${styles.resizeHandle} ${styles.resizeLeft}`}
						aria-label={resizeLeftLabel}
						ref={resizeLeftRef}
					/>
					<button
						type="button"
						className={`${styles.resizeHandle} ${styles.resizeRight}`}
						aria-label={resizeRightLabel}
						ref={resizeRightRef}
					/>
				</>
			)}
		</section>
	);
}

function IconButton({
	icon,
	label,
	disabled,
	onClick,
	className,
	size = 16,
}: {
	icon: LucideIcon;
	label: string;
	disabled?: boolean;
	onClick: () => void | Promise<void>;
	className?: string;
	size?: number;
}): React.ReactNode {
	return (
		<FlashcardButton
			preset="icon"
			variant="ghost"
			icon={icon}
			iconSize={size}
			aria-label={label}
			title={label}
			disabled={disabled}
			className={className}
			onClick={() => void onClick()}
		/>
	);
}

function moveSource(
	runtime: VideoPlayerRuntime,
	sources: readonly LocalVideoSource[],
	from: number,
	to: number,
): void {
	if (to < 0 || to >= sources.length) return;
	const ids = sources.map((source) => source.id);
	ids.splice(to, 0, ...ids.splice(from, 1));
	runtime.reorderSources(ids);
}

function formatTime(value: number): string {
	if (!Number.isFinite(value) || value < 0) return "0:00";
	const total = Math.floor(value);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, "0");
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
		: `${minutes}:${seconds}`;
}

function sourceProgressLabel(
	sourceId: string,
	snapshot: VideoPlayerSnapshot,
	t: PlayerCopy,
): string {
	if (sourceId === snapshot.currentSourceId && snapshot.duration) {
		return `${formatTime(snapshot.currentTime)} / ${formatTime(snapshot.duration)}`;
	}
	if (snapshot.completedSourceIds.includes(sourceId)) return t.completed;
	const progress = snapshot.progressBySource[sourceId] ?? 0;
	return progress > 0 ? t.watched(formatTime(progress)) : "";
}

function isInteractiveTarget(target: EventTarget): boolean {
	return Boolean(
		(target as Element | null)?.closest?.(
			"button, input, select, textarea, summary, a, [contenteditable='true']",
		),
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
