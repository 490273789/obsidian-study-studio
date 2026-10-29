# Study Studio

Study Studio supports Chinese-first learning in Obsidian. Its language captures
the learning material, learner state, and study tools that make up that work.

## Flashcard activity

**Card editing**:
The learner's interaction to create, revise, or delete a card in its Markdown source,
including preparing the card and responding to migration or repair requirements.
_Avoid_: Source synchronization, identity migration

**Card source text (卡片源文本)**:
The Markdown text of one managed source file, treated as bytes: an edit replaces only
the target card block and keeps every byte outside it, including line endings, tag prefix,
blank lines, and trailing prose.
_Avoid_: Source file content, raw Markdown, document text

**Card presentation (卡片呈现)**:
One encounter with a study or practice card, including its question and whether the learner has revealed its answer.
Returning to the card or changing its front or back begins a fresh presentation; changing only its explanation or source location preserves that encounter.
_Avoid_: Card identity, answer event, study session

**Automatic pronunciation (自动发音)**:
The learner-enabled reading of a card's word when it becomes visible during a card presentation.
A forward card exposes the word with its question; a reverse card exposes it when the learner reveals the answer.
_Avoid_: Manual pronunciation, spelling feedback pronunciation

**Word list**:
A deck's cards presented together for browsing, with front and back text that
the learner can mask and reveal and explanations they can open separately.
_Avoid_: Study session, practice session

**Daily learning activity**:
The durable total of submitted answers and time spent on one local calendar day,
kept independently from short-lived session history.
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
A batch of at most fifteen cards within a challenge round, passed when each remaining card has been answered correctly without seeing the answer first. Forward and reverse cards use the learner's self-assessment after revealing the answer.
_Avoid_: Challenge round, study day

**First attempt**:
The first submitted answer to a card during one attempt at a challenge level, kept distinct from later retries of that card.
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
Favorite entries in the same favorites document whose words match after ignoring letter case and surrounding whitespace; different word forms remain distinct.
_Avoid_: Duplicate definitions, equivalent word forms

**Favorite generated draft (收藏生成草稿)**:
AI-generated Chinese meanings and learning notes for a word or phrase, which the learner can revise before explicitly saving a favorite.
_Avoid_: Saved favorite, dictionary definition

**Batch favorite task (批量收藏任务)**:
The learner's one-time conversion of a vault word list into favorite entries in one chosen category. A single-word favorite save can replace an existing entry, while a batch task skips existing entries and keeps entries saved before a failure or stop.
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

**Subtitle draft engine (字幕草稿引擎)**:
The deep domain module managing chunked audio transcription, reference text alignment, word-level timing matching, and atomic draft editing operations before subtitles are committed to a listening material.
_Avoid_: Subtitle service, transcription manager

**Media transcription engine (媒体转写引擎)**:
The deep core module managing speech recognition provider execution, secret resolution, configuration drift detection, and cue timestamp hygiene for listening practice and video subtitles.
_Avoid_: Transcription manager, speech service, audio composition adapter

**Cue word alignment (片段词级对齐)**:
The token-level timestamp matching that binds recognized spoken words to a practice segment's text for playback highlighting.
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
The invariant binding between a canonical video path and its stable source ID, preserved across playlist removals and explicit relinks, ensuring vault-stored subtitles and recordings remain linked to the media.
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
