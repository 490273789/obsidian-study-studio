import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { setTooltip } from "obsidian";
import {
	ChevronDown,
	ChevronUp,
	CirclePlay,
	FastForward,
	FolderPlus,
	Maximize2,
	Minimize2,
	Pause,
	PictureInPicture2,
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
import { PlaybackRateControl } from "../../../core/ui/primitives/PlaybackRate";
import {
	ReorderableList,
	SortableRow,
	useSortableInteraction,
} from "../../../core/ui/primitives/Sortable/Sortable";
import { cls } from "../../../core/shared/classNames";
import type { Language } from "../../../core/shared/types";
import type { ShadowingWorkspaceViewAction, VideoPlayerSnapshot } from "../domain/types";
import { VIDEO_PLAYBACK_RATES } from "../domain/types";
import type { VideoPlayerRuntime } from "../domain/videoPlayerRuntime";
import type { SubtitleEditingSession } from "./subtitleEditingSession";
import type { VideoPlayerSettings } from "../settings/slice";
import { videoPlayerStrings } from "../strings/videoPlayer";
import styles from "./VideoPlayer.module.scss";
import type {
	PlayerViewMount,
	PlayerViewPresentation,
	PlayerViewRefs,
} from "./playerViewInteraction";
import {
	ShadowingFloatingControls,
	ShadowingWorkspace,
	type ShadowingWorkspaceState,
} from "./ShadowingWorkspace";

export interface ShadowingViewBridge {
	getSnapshot(): ShadowingWorkspaceState;
	subscribe(listener: () => void): () => void;
	setEnabled(enabled: boolean): Promise<void>;
	act(action: ShadowingWorkspaceViewAction): Promise<void>;
}

interface VideoPlayerViewProps {
	runtime: VideoPlayerRuntime;
	view: PlayerViewMount;
	language: Language;
	rootEl: HTMLElement;
	settings: VideoPlayerSettings;
	onFocusExisting: () => void;
	onOpenSettings: () => void;
	shadowing?: ShadowingViewBridge;
	editing?: SubtitleEditingSession;
}

export function VideoPlayerView({
	runtime,
	view,
	language,
	rootEl,
	settings,
	onFocusExisting,
	onOpenSettings,
	shadowing,
	editing,
}: VideoPlayerViewProps): React.ReactNode {
	const snapshot = useSyncExternalStore(
		(listener) => runtime.subscribe(listener),
		() => runtime.getSnapshot(),
	);
	const viewSnapshot = useSyncExternalStore(
		(listener) => view.subscribe(listener),
		() => view.getSnapshot(),
	);
	const shadowSnapshot = useSyncExternalStore(
		(listener) => shadowing?.subscribe(listener) ?? (() => undefined),
		() => shadowing?.getSnapshot() ?? null,
	);
	const { interaction: sorting, snapshot: sortingSnapshot } = useSortableInteraction({
		items: snapshot.sources.map((source) => source.id),
		disabled: viewSnapshot.role !== "presenter" || !viewSnapshot.queueExpanded,
		onMove: (move) => runtime.reorderSources(move.items),
	});
	const t = videoPlayerStrings(language);
	const document = rootEl.ownerDocument;
	const floating = viewSnapshot.presentation.kind === "floating";
	const shadowEnabled = shadowSnapshot?.enabled ?? false;

	const addVideos = useCallback(async () => {
		await runtime.pickAndAddSources({
			addVideos: t.addVideos,
			selectFailed: t.selectFailed,
		});
	}, [runtime, t.addVideos, t.selectFailed]);

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
				right={
					<div className="flashcard-header-actions">
						<FlashcardButton
							preset="icon"
							icon={Settings}
							title={t.settings}
							aria-label={t.settings}
							onClick={onOpenSettings}
						/>
					</div>
				}
			/>

			<div
				className={cls(
					"fc-page__body",
					styles.pageBody,
					snapshot.sources.length > 0 && styles.playerBody,
				)}
			>
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
					<div
						className={cls(
							styles.layout,
							shadowEnabled && !floating && styles.layoutWithShadow,
						)}
					>
						<div className={styles.videoToolbar}>
							<div className={styles.videoDetails}>
								{currentIndex >= 0 && (
									<h2
										className={styles.videoTitle}
										title={snapshot.sources[currentIndex]?.name}
									>
										{snapshot.sources[currentIndex]?.name}
									</h2>
								)}
								{shadowing && (
									<label className={styles.shadowToggle}>
										<input
											type="checkbox"
											role="switch"
											aria-checked={shadowEnabled}
											className={styles.shadowToggleInput}
											checked={shadowEnabled}
											onChange={(event) =>
												void shadowing.setEnabled(
													event.currentTarget.checked,
												)
											}
										/>
										<span
											className={styles.shadowToggleTrack}
											aria-hidden="true"
										/>
										<span className={styles.shadowToggleText}>
											{t.shadowToggle}
											<small>{t.shadowToggleHint}</small>
										</span>
										{shadowEnabled && !!shadowSnapshot?.cues.length && (
											<span
												className={styles.shadowCueBadge}
												aria-label={t.shadowCueCount(
													shadowSnapshot.cues.length,
												)}
											>
												{shadowSnapshot.cues.length}
											</span>
										)}
									</label>
								)}
							</div>
							<aside className={styles.queue} aria-label={t.queue}>
								<div className={styles.queueHeader}>
									<FlashcardButton
										variant="ghost"
										className={styles.queueHeading}
										aria-expanded={viewSnapshot.queueExpanded}
										title={
											viewSnapshot.queueExpanded
												? t.queueCollapse
												: t.queueExpand
										}
										onClick={() =>
											view.act({
												type: "set-queue-expanded",
												expanded: !viewSnapshot.queueExpanded,
											})
										}
									>
										<span className={styles.queueChevron} aria-hidden="true">
											{viewSnapshot.queueExpanded ? (
												<ChevronUp size={16} />
											) : (
												<ChevronDown size={16} />
											)}
										</span>
										<span className={styles.queueSummaryText}>
											{t.queueSummary(
												snapshot.sources.length,
												currentIndex + 1,
											)}
										</span>
									</FlashcardButton>
									<FlashcardButton
										preset="icon"
										icon={FolderPlus}
										iconSize={14}
										className={styles.queueAddBtn}
										title={t.addVideos}
										aria-label={t.addVideos}
										onClick={() => void addVideos()}
									/>
								</div>
								{viewSnapshot.queueExpanded && (
									<div className={styles.queueList}>
										<ReorderableList interaction={sorting} language={language}>
											{snapshot.sources.map((source, index) => {
												const isActive =
													source.id === snapshot.currentSourceId;
												const progressLabel = sourceProgressLabel(
													source.id,
													snapshot,
													t,
												);
												return (
													<SortableRow
														key={source.id}
														id={source.id}
														className={`${styles.queueItem} ${isActive ? styles.active : ""}`}
														handleLabel={t.dragToReorder}
														handleClassName={styles.dragHandle}
													>
														{(handle) => (
															<>
																{handle}
																<div
																	className={styles.sourceIndex}
																	aria-hidden="true"
																>
																	{isActive ? (
																		<Play
																			size={11}
																			className={
																				styles.activePlayIcon
																			}
																		/>
																	) : (
																		<span>{index + 1}</span>
																	)}
																</div>
																<FlashcardButton
																	variant="ghost"
																	className={styles.sourceContent}
																	ref={(element) => {
																		if (element) {
																			setTooltip(
																				element,
																				source.name,
																				{
																					placement:
																						"top",
																					classes: [
																						styles.sourceNameTooltip,
																					],
																				},
																			);
																		}
																	}}
																	aria-current={
																		isActive
																			? "true"
																			: undefined
																	}
																	onClick={() => {
																		runtime.selectSource(
																			source.id,
																		);
																		view.act({
																			type: "set-queue-expanded",
																			expanded: false,
																		});
																	}}
																>
																	<span
																		className={
																			styles.sourceName
																		}
																	>
																		{source.name}
																	</span>
																	{progressLabel && (
																		<span
																			className={
																				styles.sourceMeta
																			}
																		>
																			<span
																				className={
																					isActive
																						? styles.playingTag
																						: styles.progressTag
																				}
																			>
																				{progressLabel}
																			</span>
																		</span>
																	)}
																</FlashcardButton>
																<div className={styles.itemActions}>
																	{snapshot.sources.length >
																		1 && (
																		<>
																			<IconButton
																				icon={ChevronUp}
																				size={14}
																				className={
																					styles.actionBtn
																				}
																				label={t.moveUp}
																				disabled={
																					sortingSnapshot.disabled ||
																					index === 0
																				}
																				onClick={() =>
																					sorting.move(
																						source.id,
																						snapshot
																							.sources[
																							index -
																								1
																						]?.id ??
																							source.id,
																					)
																				}
																			/>
																			<IconButton
																				icon={ChevronDown}
																				size={14}
																				className={
																					styles.actionBtn
																				}
																				label={t.moveDown}
																				disabled={
																					sortingSnapshot.disabled ||
																					index ===
																						snapshot
																							.sources
																							.length -
																							1
																				}
																				onClick={() =>
																					sorting.move(
																						source.id,
																						snapshot
																							.sources[
																							index +
																								1
																						]?.id ??
																							source.id,
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
																			await runtime.pickAndReplaceSource(
																				source.id,
																				{
																					replace:
																						t.replace,
																					selectFailed:
																						t.selectFailed,
																				},
																			);
																		}}
																	/>
																	<IconButton
																		icon={Trash2}
																		size={14}
																		className={`${styles.actionBtn} ${styles.deleteBtn}`}
																		label={t.remove}
																		onClick={() =>
																			runtime.removeSource(
																				source.id,
																			)
																		}
																	/>
																</div>
															</>
														)}
													</SortableRow>
												);
											})}
										</ReorderableList>
									</div>
								)}
							</aside>
						</div>
						<div className={styles.studyColumn}>
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
						</div>
						{shadowing && shadowEnabled && !floating && (
							<aside className={styles.shadowSide} aria-label={t.shadowSettings}>
								<ShadowingPane
									bridge={shadowing}
									editing={editing}
									language={language}
									currentTime={snapshot.currentTime}
									duration={snapshot.duration}
								/>
							</aside>
						)}
					</div>
				)}
			</div>

			{viewSnapshot.presentation.kind === "floating" &&
				createPortal(
					<div className="fc-overlay">
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
							{shadowing && shadowEnabled && (
								<ShadowingFloatingPane
									bridge={shadowing}
									language={language}
									currentTime={snapshot.currentTime}
								/>
							)}
						</FloatingPlayer>
					</div>,
					document.body,
				)}
		</div>
	);
}

function ShadowingPane({
	bridge,
	editing,
	language,
	currentTime,
	duration,
}: {
	bridge: ShadowingViewBridge;
	editing?: SubtitleEditingSession;
	language: Language;
	currentTime: number;
	duration: number | null;
}): React.ReactNode {
	const state = useSyncExternalStore(
		(listener) => bridge.subscribe(listener),
		() => bridge.getSnapshot(),
	);
	if (!editing) return null;
	return (
		<ShadowingWorkspace
			language={language}
			currentTime={currentTime}
			duration={duration}
			state={state}
			editing={editing}
			onAction={(action) => bridge.act(action)}
		/>
	);
}

function ShadowingFloatingPane({
	bridge,
	language,
	currentTime,
}: {
	bridge: ShadowingViewBridge;
	language: Language;
	currentTime: number;
}): React.ReactNode {
	const state = useSyncExternalStore(
		(listener) => bridge.subscribe(listener),
		() => bridge.getSnapshot(),
	);
	const cue =
		state.cues.find((item) => currentTime >= item.start && currentTime < item.end) ?? null;
	return (
		<ShadowingFloatingControls
			language={language}
			currentCue={cue}
			state={state}
			onAction={(action) => bridge.act(action)}
		/>
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
	const shortcuts = {
		togglePlayback: displayShortcut(settings.shortcuts.togglePlayback),
		seekBackward: displayShortcut(settings.shortcuts.seekBackward),
		seekForward: displayShortcut(settings.shortcuts.seekForward),
	};
	const shortcutHints = (
		[
			["togglePlayback", shortcuts.togglePlayback],
			["seekBackward", shortcuts.seekBackward],
			["seekForward", shortcuts.seekForward],
		] as const
	).filter(([, key]) => key);
	const playbackLabel = controlLabel(playing ? t.pause : t.play, shortcuts.togglePlayback);
	const backwardLabel = controlLabel(t.backward(settings.skipInterval), shortcuts.seekBackward);
	const forwardLabel = controlLabel(t.forward(settings.skipInterval), shortcuts.seekForward);

	const [active, setActive] = useState(true);
	const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const resetIdleTimer = useCallback(() => {
		setActive(true);
		if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
		if (playing) {
			idleTimerRef.current = setTimeout(() => {
				setActive(false);
			}, 2500);
		}
	}, [playing]);

	useEffect(() => {
		if (!playing) {
			setActive(true);
			if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
		} else {
			resetIdleTimer();
		}
		return () => {
			if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
		};
	}, [playing, resetIdleTimer]);

	return (
		<div
			ref={focusSurfaceRef}
			className={cls(styles.surface, floating && styles.surfaceFloating)}
			aria-label={t.playerRegion}
			onPointerMove={resetIdleTimer}
			onPointerEnter={resetIdleTimer}
			onPointerLeave={() => {
				if (playing) setActive(false);
			}}
		>
			<div ref={mediaHostRef} className={styles.mediaHost} />
			{error && <p className={styles.error}>{error}</p>}
			<div
				className={cls(
					styles.controlDeck,
					floating ? styles.controlDeckFloating : !active && styles.controlDeckIdle,
				)}
			>
				<ProgressSlider
					currentTime={currentTime}
					duration={duration}
					skipInterval={settings.skipInterval}
					label={t.progress}
					onSeek={onSeek}
				/>
				<div className={styles.controls}>
					<div className={styles.navGroup}>
						<IconButton
							icon={SkipBack}
							label={t.previous}
							disabled={!canPrevious}
							onClick={onPrevious}
						/>
					</div>
					<div className={styles.transport}>
						<div className={styles.skipBtnWrapper}>
							<FlashcardButton
								preset="icon"
								variant="ghost"
								icon={Rewind}
								iconSize={16}
								aria-label={backwardLabel}
								title={
									shortcuts.seekBackward
										? `${backwardLabel}\n${t.shortcutFocus}`
										: backwardLabel
								}
								className={styles.skipBtn}
								onClick={onBackward}
							>
								<span className={styles.skipStepBadge}>
									{settings.skipInterval}
								</span>
							</FlashcardButton>
						</div>
						<FlashcardButton
							preset="icon"
							variant="primary"
							icon={playing ? Pause : Play}
							iconSize={18}
							className={styles.playBtn}
							aria-label={playbackLabel}
							title={
								shortcuts.togglePlayback
									? `${playbackLabel}\n${t.shortcutFocus}`
									: playbackLabel
							}
							onClick={onToggle}
						/>
						<div className={styles.skipBtnWrapper}>
							<FlashcardButton
								preset="icon"
								variant="ghost"
								icon={FastForward}
								iconSize={16}
								aria-label={forwardLabel}
								title={
									shortcuts.seekForward
										? `${forwardLabel}\n${t.shortcutFocus}`
										: forwardLabel
								}
								className={styles.skipBtn}
								onClick={onForward}
							>
								<span className={styles.skipStepBadge}>
									{settings.skipInterval}
								</span>
							</FlashcardButton>
						</div>
					</div>
					<div className={styles.utilities}>
						<IconButton
							icon={SkipForward}
							label={t.next}
							disabled={!canNext}
							onClick={onNext}
						/>
						<PlaybackRateControl
							className={styles.rateControl}
							label={t.rate}
							value={rate}
							rates={VIDEO_PLAYBACK_RATES}
							tone="default"
							onChange={(value) =>
								onRate(value as (typeof VIDEO_PLAYBACK_RATES)[number])
							}
						/>
						{!floating && (
							<IconButton
								icon={PictureInPicture2}
								label={t.floating}
								onClick={onFloat}
							/>
						)}
					</div>
					{shortcutHints.length > 0 && (
						<div className={styles.shortcutsHint}>
							<span>{t.shortcutFocus}</span>
							<div className={styles.shortcutKeys}>
								{shortcutHints.map(([action, key]) => (
									<span key={action} className={styles.shortcutEntry}>
										<kbd className={styles.shortcutKey}>{key}</kbd>
										{t.shortcutNames[action]}
									</span>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

const arrowKeyLabels = {
	ArrowLeft: "←",
	ArrowRight: "→",
	ArrowUp: "↑",
	ArrowDown: "↓",
};

function displayShortcut(shortcut: string): string {
	return shortcut.replace(
		/(^|\+)(ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/,
		(_match, prefix: string, key: keyof typeof arrowKeyLabels) => prefix + arrowKeyLabels[key],
	);
}

function controlLabel(action: string, shortcut: string): string {
	return shortcut ? `${action} (${shortcut})` : action;
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
				style={
					{
						"--played": `${maximum > 0 ? (displayed / maximum) * 100 : 0}%`,
					} as React.CSSProperties
				}
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

function FloatingPlayer({
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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
