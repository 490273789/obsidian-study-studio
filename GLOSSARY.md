# Study Studio

Study Studio supports English learning for Chinese-speaking learners in Obsidian.
This glossary defines the shared language for learning material, learner state, and study tools.

## Flashcard activity

**Card editing**:
The learner's interaction to create, revise, or delete a card in its Markdown source,
including preparing the card and responding to migration or repair requirements.
_Avoid_: Source synchronization, identity migration

**Card source text (卡片源文本)**:
The original Markdown text of a managed card source file, including its card blocks
and surrounding content. Editing one card preserves all text outside that block,
including line endings, tags, blank lines, and trailing prose.
_Avoid_: Source file content, raw Markdown, document text

**Card presentation (卡片呈现)**:
One encounter with a card in study, practice, spelling, or challenge mode, including its question and answer visibility.
Returning to the card or changing its front or back begins a fresh presentation; changing only its explanation or source location preserves that encounter.
_Avoid_: Card identity, answer event, study session

**Automatic pronunciation (自动发音)**:
The learner-enabled reading of a card's word when it becomes visible during a study or practice card presentation.
A forward card exposes the word with its question; a reverse card exposes it when the learner reveals the answer.
_Avoid_: Manual pronunciation, spelling feedback pronunciation

**Word list**:
A deck's cards presented together for browsing, with front and back text that
the learner can mask and reveal and explanations they can open separately.
_Avoid_: Study session, practice session

**Daily learning activity**:
The durable record of submitted answers, learning time, and completed sessions on
one local calendar day, including time spent browsing word lists and kept
independently from short-lived session history.
_Avoid_: Daily statistics, history entry

**Completion day**:
A local calendar day on which the learner finishes at least one study, practice,
or spelling session, or passes one challenge level. Partial sessions and word-list visits do not qualify.
_Avoid_: Active day, study day

**Current learning streak**:
The unbroken run of completion days ending today or yesterday when today is
still available for completion.
_Avoid_: Login streak, activity streak

**Best learning streak**:
The longest unbroken run of completion days in the retained daily learning
activity.
_Avoid_: Record streak, yearly streak

## Challenge practice

**Challenge round**:
A fixed collection of previously studied, spellable cards drawn across spelling-enabled decks for practice until every eligible card has been passed.
_Avoid_: Deck, challenge level

**Challenge level**:
A batch of at most fifteen cards within a challenge round, passed when every
remaining card is answered correctly. Spelling requires an answer before it is
shown; forward and reverse questions use self-assessment after revealing it.
_Avoid_: Challenge round, study day

**First attempt**:
The first submitted retrieval answer to a card during one spelling session or one
attempt at a challenge level, kept distinct from later corrections or retries.
_Avoid_: Correction, retry

## Dictionary lookup

**Favorite entry (收藏词条)**:
A word or phrase together with the meaning and learning notes that the learner explicitly saves in a chosen favorites document.
_Avoid_: Favorite generated draft, dictionary definition

**Favorite category (收藏分类)**:
A named destination for favorite entries, associated with one favorites document. The learner chooses a category when saving a word or phrase.
_Avoid_: Favorites document, dictionary source

**Favorites document (收藏文档)**:
The Markdown note that holds the favorite entries assigned to one favorite category.
_Avoid_: Favorite category, dictionary definition

**Same-word favorites (同词收藏)**:
Favorite entries in the same favorites document whose words match after ignoring letter case, trimming surrounding whitespace, and collapsing internal whitespace; different word forms remain distinct.
_Avoid_: Duplicate definitions, equivalent word forms

**Favorite generated draft (收藏生成草稿)**:
AI-generated Chinese meanings and learning notes for a word or phrase, which the learner can revise before explicitly saving a favorite.
_Avoid_: Saved favorite, dictionary definition

**Batch favorite task (批量收藏任务)**:
The learner's one-time conversion of a vault word list into favorite entries in one chosen category, keeping entries saved before a failure or stop. Each distinct word is fulfilled when saved or found in the favorites document; existing entries are skipped even though a single-word save can replace them, and repeated input lines count only toward progress.
_Avoid_: Favorite generated draft, dictionary import

**Local dictionary (本地字典)**:
A learner-imported dictionary available for lookup in the dictionary view and the lookup assistant.
_Avoid_: Custom API, online dictionary configuration

**Selection helper (选区助手)**:
The shared lookup and translation entry for text the learner selects across supported Obsidian pages, windows, and text fields. It also hosts manually opened lookup cards; a new selection replaces the previous assistant.
_Avoid_: Lookup assistant, translation page

**Lookup assistant (查词助手)**:
The larger lookup card within the selection helper that queries dictionaries for selected or manually entered text.
_Avoid_: Dictionary main tab, selection helper

**Selection source (选区来源)**:
The original document or page containing the text selected by the learner, distinct
from the captured text and from the dictionaries used to look it up.
_Avoid_: Dictionary source, query result

**Entry navigation (词条跳转)**:
A lookup initiated by following an entry link inside a dictionary definition.
_Avoid_: Source switching, chapter switching

## Listening and speaking practice

**Listening material (听说材料)**:
An audio recording with its reference text or timed subtitles, prepared for listening and spoken repetition.
_Avoid_: Flashcard deck, playback queue

**Practice segment (练习片段)**:
A timed passage selected for listening and repetition. A segment may contain part of a sentence or more than one sentence.
_Avoid_: Sentence as an exact synonym

**Subtitle draft (字幕草稿)**:
An editable proposed transcript with timing that the learner reviews before using it as the material's subtitles.
_Avoid_: Saved subtitles, reference text

**Cue word alignment (片段词级对齐)**:
The association between individual words in a practice segment's text and their
spoken time ranges, used to highlight words during playback.
_Avoid_: Acoustic forced alignment, speech recognition

**Difficult segment (难句)**:
A practice segment the learner marks for focused repetition.
_Avoid_: Scheduled review card

## Local video study

**Video source**:
A user-selected local video that can be played during study. A source has a
stable identity independent of its current place in a queue.
_Avoid_: Video file, media item

**Video source identity (视频源稳定身份)**:
The stable identity that keeps a video source linked to its subtitles and saved
recordings. Re-adding the same canonical path restores that identity; explicitly
relinking the source preserves the identity while replacing its path association.
_Avoid_: File path ID, source ID cache, desktop picker mapping

**Playback queue**:
The ordered collection of video sources available to one player. Its order
defines the previous and next source.
_Avoid_: Playlist, video list

**Playback session**:
The single active study experience over a playback queue, including the selected
source and its current playback state.
_Avoid_: Player instance, video session

**Player view**:
The normal Obsidian workspace view through which a playback session is managed
and watched alongside notes.
_Avoid_: Player tab, video page

**Floating player**:
The movable, resizable presentation of the active playback session within the
Obsidian window.
_Avoid_: Picture-in-picture, system window

**External local path**:
A path to a video source outside the current vault on the user's computer.
_Avoid_: Vault path, attachment path

**Playback position**:
The point within a video source where watching should resume.
_Avoid_: Progress, timestamp

**Playback focus**:
The interaction state in which playback controls may respond to local keyboard
shortcuts. It belongs to the player surface and controls, not to the playback
queue or settings controls.
_Avoid_: Video element focus, window focus

**Skip interval**:
The user-configured duration by which a skip action moves the playback position
forward or backward.
_Avoid_: Fast-forward seconds, rewind seconds

**Video subtitle document (视频字幕文档)**:
The versioned, editable original and translated cues associated with a stable video
source identity. A generated or imported candidate can be reviewed before replacing
the active cues.
_Avoid_: Subtitle task, listening material

**Video subtitle editing (视频字幕修正)**:
学习者选择视频中的一条字幕，修正其原文或译文，并明确保存的交互。
修正草稿属于当前跟读工作区中的一个视频和一条字幕；切换时保留，原字幕被删除后仍可找回草稿，关闭工作区后释放。
_Avoid_: 字幕生成、字幕草稿引擎、视频字幕任务

**Video subtitle task (视频字幕任务)**:
The device-local checkpoint for progressively extracting, transcribing, and
translating a video source. It may continue while no player view is open.
_Avoid_: Video subtitle document, one network request

**Shadowing workspace (影子跟读工作区)**:
The cohesive study environment for a video source that brings together subtitle
generation, cue editing, segment-based repetition or shadowing, microphone recording,
and saved take management under a single active presentation.
_Avoid_: Shadowing bridge, player view, video tab

**Shadowing session (影子跟读会话)**:
The temporary practice state for one selected video practice segment, including
loop or listen-then-repeat playback, microphone recording, and replay.
_Avoid_: Playback session, saved recording

**Saved shadowing take (已保存跟读录音)**:
A learner-approved microphone recording of one practice segment, stored with its
source identity, range, and playback rate in the vault.
_Avoid_: Temporary take, difficult segment

## AI capabilities

**AI engine (AI 引擎)**:
One configured AI connection with a capability type: large-language-model text
generation, speech recognition, or text translation. Learners configure engines
in the shared AI engine settings and select them in the features that use them.
_Avoid_: Provider, model configuration, AI setting

**AI engine kind (引擎类型)**:
The capability an engine serves, which decides its fields and the features that may
select it. A feature can only select an engine of the kind it consumes; audio
listening practice and video subtitles share the speech-recognition kind.
_Avoid_: Engine provider, service type
