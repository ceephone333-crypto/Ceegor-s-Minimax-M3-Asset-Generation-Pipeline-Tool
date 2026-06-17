/* renderer/app.js â€” UI logic, no build step. */
// We use globals (window.api from preload) to stay build-free.

// Tool version: bump / refresh this whenever you ship a build. The
// string is read from package.json via window.api.getAppVersion()
// at startup (added in the same change that bumped it to 1.1.1), so
// the renderer always shows the version that ships in this build's
// package.json â€” no risk of a stale string in the source when
// someone forgets to bump it. The format is "<version> Â· <compile
// date> <compile time>" so the user can see at a glance which
// build they have.
let BUILD_VERSION = '1.1.1 Â· loadingâ€¦';
const TOOL_NAME = 'MiniMax Assets Tool';
const TOOL_INFO =
  'A friendly desktop app for the MiniMax AI service. ' +
  'Generate images, speech, music, and short videos from text prompts in one window. ' +
  'Works with both Token Plan keys and pay-as-you-go (PAYG) API keys. ' +
  'Includes style presets (so you can keep the same look across many generations), ' +
  'batch generation (run a whole list of prompts in one click), ' +
  'and built-in tools to upscale, crop, remove backgrounds, and shrink the file size of every result.';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ----------------- State -----------------
const state = {
  config: { api_key: '', output_dir: '', region: 'global', theme: 'dark', styles: [] },
  voices: [],
  voicesLoaded: false,
  fbDir: '',
  currentTab: 'image',
  theme: 'dark',
  batches: { image: [], speech: [], music: [], video: [] },
  // Per-tab last visited folder (for per-tab folder persistence, see showTab)
  fbDirs: { image: '', speech: '', music: '', video: '' },
  // Global "Target file prefix" â€” prepended to every generated file's
  // name. Mirrored on all 4 tabs (one input on each) so the user can
  // tweak it without switching tabs. Persisted to state.json.
  filePrefix: '',
  // Real-ESRGAN model name (passed to the ncnn-vulkan binary via
  // `-n <model>`). The default is the general-purpose 4Ã— BSD-3 model.
  // Users pick a different one in âš™ Settings â†’ Image upscaling â†’
  // Model. The actual spawn is whitelisted in src/realesrgan.js to a
  // short known set so a corrupted state.json can't inject an
  // arbitrary model name (or argv flag) into the binary.
  realesrganModel: 'realesrgan-x4plus',
  // First-run dismissal for the optional Real-ESRGAN install
  // popup. Set to true by the popup's "Don't ask again" / "Skip"
  // / successful install paths. Persisted to state.json so a user
  // who already saw the popup on a previous launch isn't
  // re-prompted. Initialised here so the first read isn't
  // `undefined` (the truthy check would still work, but the
  // implicit shape change is harder to grep for).
  realesrganFirstRunDismissed: false,
  // Upscale-on-Generate: when true, every newly generated image is
  // upscaled locally (Canvas API) after the mmx call returns, using the
  // settings below. Persisted to state.json so it survives restarts.
  upscaleEnabled: false,
  // The auto-crop options are now part of the upscale settings â€” they
  // live here so the Add button in the image tab can capture them as
  // part of the batch entry snapshot, and the image tab's generate
  // handler can apply them after the upscale. The âš™ Settings â†’
  // Upscale Settings popup exposes all five fields (multiplier,
  // autoCrop, cropWidth, cropHeight, cropAnchorX/Y) so the user can
  // configure everything in one place.
  upscaleSettings: { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' },
  // When the upscale is on, also remove the background from the
  // (optionally upscaled + cropped) output via the optional isnetbg
  // binary. Persisted to state.json so the user's "yes, always
  // free up my generated assets" choice survives restarts. The
  // standalone right-click "Remove background" action does NOT
  // depend on this flag â€” it's an explicit user gesture every
  // time, so accidental turn-on here is contained to the
  // generation pipeline.
  removeBackgroundEnabled: false,
  // Whether to ask the isnetbg binary to use GPU acceleration.
  // We default to true (DirectML / CUDA / Vulkan whatever the
  // binary supports) because IS-Net on a CPU is slow; the user
  // can opt out if the GPU path is misbehaving on their box.
  removeBackgroundUseGpu: true,
  // Image-optimisation settings. When `enabled` is true, every
  // generated image is run through the Sharp-based
  // image-optimizer IPC after upscale (and after the optional
  // auto-crop + background-removal stages). Persisted to
  // state.json. The right-click "Optimize / Compress" entry in
  // the folder browser always opens the dialog regardless of
  // this toggle (it's an explicit user gesture every time).
  //
  // Defaults match the spec's "sweet spot" for perceptually
  // lossless compression: quality 82, keep the source format
  // (so a PNG round-trip doesn't silently re-encode to JPEG),
  // strip EXIF (camera model / GPS / etc.) but keep the ICC
  // profile so colours still render correctly on colour-
  // managed displays.
  optimizeSettings: { enabled: false, quality: 82, format: 'keep', stripMetadata: true },
  // Resizable-layout sizes (folder-browser column width,
  // log/preview row height, picture-preview column width).
  // Persisted to state.json via the splitter drag handlers so
  // the user only has to set their preferred sizes once. The
  // sidebar + logbar defaults match the CSS `:root` block in
  // styles.css; the previewW default is recomputed at startup
  // to half the available row width (see applyLayoutSettings)
  // so a fresh install opens with a balanced 50/50 split.
  layoutSettings: { sidebarW: 360, logbarH: 280, previewW: 480 },
  // Per-tab generation state used for status dots and the batch runner.
  // "running" while mmx is in flight, "done" after success, "idle" otherwise.
  // Green dot is only shown when the tab is not the active one.
  genStatus: { image: 'idle', speech: 'idle', music: 'idle', video: 'idle' },
  // Set to the tab key while a generation is in progress. Cleared by
  // armGenBtnWithCancel's cleanup. Used by startBatchGen to wait for
  // completion between batch entries.
  generating: null,
  // Per-tab generation queue progress. genQueueSize is the total number
  // of items the current run will produce (variants Ã— --n). genQueueDone
  // is how many items have finished. The tab's ETA timer reads both
  // values to compute a "remaining time for the whole queue" estimate.
  // Cleared by armGenBtnWithCancel's cleanup. Without these, the ETA
  // only ever showed the time for the CURRENT item â€” useless when the
  // user is running a 5-variant batch and wants to know when the whole
  // batch will be done.
  genQueueSize: { image: 0, speech: 0, music: 0, video: 0 },
  genQueueDone: { image: 0, speech: 0, music: 0, video: 0 },
  // The path of the image currently shown in the right-side preview
  // pane. Used by previewImageFromFile to short-circuit "click the
  // same file twice" and avoid a re-decode + flicker. Cleared when
  // the preview is reset to the empty state (e.g. after a file is
  // deleted or moved out from under the pane). Initialized here so
  // the first read doesn't see "undefined" â€” the comparison would
  // still work, but writing to it via a property assignment on
  // `state` would silently create the key on first use, which is
  // the kind of implicit shape change that's hard to grep for.
  _lastPreviewPath: null,
  // Snapshot of the file-browser list (the items returned by
  // window.api.fbList and rendered into #fb-list). Used by helpers
  // that need to look up a full fs-item record by path (size, ext,
  // mtimeMs, isDir) without re-issuing an IPC call. Populated by
  // renderFbList on every refresh.
  _fbItems: [],
  // The current multi-image preview batch, when one is shown. Set
  // by previewImagesFromFiles to { paths: string[], index: number }.
  // Cleared by previewImageFromFile when a single-image preview
  // replaces the multi-image grid. The image-overlay arrow-key
  // handler (added in a later feature) reads from this to navigate
  // to the previous / next image in the batch. Cleared to `null`
  // (not undefined) so the first read returns a known value.
  _previewBatch: null,
  // Sort mode for the file-browser list. One of:
  //   'name-asc' (default), 'name-desc',
  //   'size-desc', 'size-asc',
  //   'mtime-desc' (newest first), 'mtime-asc' (oldest first),
  //   'created-desc' (newest first), 'created-asc' (oldest first),
  //   'type-asc' (by file extension)
  // Persisted to state.json so the user's preferred sort survives a
  // restart. The renderer re-sorts the items in memory; the main
  // process still returns them in its default (name-asc, dirs-first)
  // order so a corrupted state.json value just falls back to the
  // server-side default.
  fbSort: 'name-asc',
  // Which file-browser columns are visible. An object keyed by
  // column id (see FB_COLUMNS) with boolean values. The "name"
  // column is mandatory and is always rendered, regardless of
  // this object; the option-overlay reflects that by disabling
  // its checkbox. The default set is the smallest reasonable
  // view (name + size). Persisted to state.json so the user's
  // choice survives a restart.
  fbColumns: {
    size: true,
    type: false,
    mtime: false,
    created: false,
    path: false,
  },
  // File-browser image thumbnail toggle. When true, image rows
  // in the folder explorer render a small centered thumbnail of
  // the actual image file (instead of the generic ðŸ–¼ icon). The
  // row height grows to fit the thumbnail; non-image rows are
  // unaffected. When false, the regular icon is shown and is
  // left-aligned (was centred before â€” the user explicitly asked
  // for left-alignment when thumbnails are off, so plain icons
  // read like a normal Explorer list instead of a centred
  // badge). Persisted to state.json.
  fbThumbnails: false,
  // Structured event log. Each entry is one line in the
  // bottom-left log pane. Replaces the old <pre id="log">
  // raw-text approach (which didn't support selection / expand
  // / structured copy). The new pane renders each event as a
  // row with a time stamp, a category icon, a result icon,
  // and a one-line headline; clicking the row toggles its
  // selection, and clicking the small chevron toggles the
  // expanded details. Capped at LOG_MAX_EVENTS to keep memory
  // usage bounded over a long session.
  _logEvents: [],
  // The id of the most recently clicked event row. Used by
  // the shift-click range-select (shift-click selects every
  // event between this id and the clicked one).
  _logLastClickedId: null,
  // Popup display policy. Controls how the optional "first run"
  // / "tab intro" popups behave. One of:
  //   'once-fresh'   â€” default. Show each popup until the user
  //                    dismisses it; then never show it again
  //                    (across restarts).
  //   'per-session'  â€” Show each popup the first time it's
  //                    triggered after each app start; reset on
  //                    every launch.
  //   'never'        â€” Never show these popups.
  //   'always'       â€” Always show these popups (ignoring any
  //                    prior dismissal).
  // The user can change this in âš™ Settings â†’ Popups.
  popupPolicy: 'once-fresh',
  // Map of popup-id â†’ ISO timestamp of the user's last dismissal.
  // Used by the 'once-fresh' policy to decide whether the popup
  // should still fire. We also keep an in-memory per-session set
  // for the 'per-session' policy so popups don't re-show inside
  // the same launch. see _popupSeenThisSession below.
  seenPopups: {},
};
// Per-session set of popup ids that have already been shown during
// this app launch. Used by the 'per-session' popup policy so a
// popup that was dismissed earlier in this session doesn't re-fire.
// Cleared at app start; the on-disk seenPopups (state.seenPopups)
// is preserved across launches and used by the 'once-fresh' policy.
const _popupSeenThisSession = new Set();

// ----------------- Centralized help system -----------------
// Every option in the app (form field, button, settings toggle,
// context-menu action) has a help topic. Topics are keyed by a
// stable string ID; the help text is intentionally written in
// plain, non-technical English so a first-time user can
// understand it without prior experience with image / audio
// generation tooling.
//
// Two ways to wire a topic into the UI:
//   1. Inline `?` icon: pass the topic ID to `helpButton(id)`.
//      Clicking the icon opens the help modal.
//   2. Inline text only: pass an object with `{ text, topic }`
//      to `helpButton()`. The icon shows a 1-line hover
//      summary; click opens the same modal for the full text.
//
// The help modal is the same `showModal` primitive used for
// every other dialog in the app, so it gets the standard
// Esc-to-close + click-outside-to-close + focus-management
// behaviour for free. The "Got it" button is just the default
// `Close` action â€” the user can also press Esc.
//
// Why a central map (and not inline text everywhere)?
//   - One place to update wording when the user reports
//     something is unclear.
//   - Searchable: `grep '"topic\\.image\\.prompt"'` finds every
//     place in the renderer that references the image-prompt
//     help topic, even after the help text is rewritten.
//   - The `helpButton` factory always renders the same DOM shape
//     (consistent styling, consistent a11y title, consistent
//     click target).
const helpTopics = {
  // -- Topbar --
  'topbar.tabImage':       { title: 'Image tab',                text: 'Generate still images from a text prompt using the MiniMax AI service (works with both Token Plan and pay-as-you-go / PAYG API keys). You can also enable local post-processing (upscale, crop, background removal, file-size optimization) that runs after the API returns the image.' },
  'topbar.tabSpeech':      { title: 'Speech tab',               text: 'Convert text into spoken audio. Pick a voice, paste or type the text, and click Generate. The result is written to the folder browser (right side) as an MP3 file.' },
  'topbar.tabMusic':       { title: 'Music tab',                text: 'Generate music from a description (genre, mood, instruments). The result is a short instrumental track â€” lyrics are not supported.' },
  'topbar.tabVideo':       { title: 'Video tab',                text: 'Generate short videos from a text prompt. Note: video generations are expensive â€” Token Plan keys allow only 3 per week; pay-as-you-go (PAYG) keys have no weekly cap and are billed per video. Each video takes a few minutes to render.' },
  'topbar.quota':          { title: 'Quota display',            text: 'Shows how many generations you have left on your MiniMax plan for the current day and the current week. Token Plan keys have daily and/or weekly caps; pay-as-you-go (PAYG) keys instead deduct credits per generation. Some models have daily limits, some have weekly limits, and a few have both. Click the round arrow to refresh.' },
  'topbar.styleBtn':       { title: 'Style Settings',           text: 'Manage your saved "style presets" — short text snippets that are automatically prepended to every prompt. For example, a "Cinematic" style might prepend "Cinematic lighting, shallow depth of field, 35mm film" to every image prompt. Use them to keep the same look across many generations without retyping.\n\nTip: the same style presets are also available in ⚙ Settings → Style presets. Manage them from whichever place is more convenient; both edit the same saved list.' },
  'topbar.themeBtn':       { title: 'Theme toggle',             text: 'Switch between the dark and light UI themes. The choice is remembered for your next launch.' },
  'topbar.settingsBtn':    { title: 'Settings',                 text: 'Open the main Settings dialog: API key, output folder, region, theme, style presets, image upscaling, image optimization, and the optional add-ons manager (Real-ESRGAN, IS-Net background-removal).' },

  // -- Folder browser --
  'sidebar.upBtn':         { title: 'Up',                       text: 'Go to the parent folder of the current folder browser location.' },
  'sidebar.refreshBtn':    { title: 'Refresh',                  text: 'Re-scan the current folder and re-render the file list. Use this if you added or removed files in another program (e.g. Windows Explorer) and the browser is out of date.' },
  'sidebar.filter':        { title: 'Filter',                   text: 'Type to filter the file list by name. Only files whose name contains the typed text are shown. Clear the field to show everything again.' },
  'sidebar.sort':          { title: 'Sort',                     text: 'Sort the file browser. The available modes are: Name â†‘/â†“ (alphabetical, with "natural" number ordering so file_2.png sorts before file_10.png), Size â†‘/â†“ (by file size; directories always come first regardless of the chosen mode), Newest / Oldest (by last-modified date), Created â†‘/â†“ (by creation date â€” falls back to last-modified on filesystems that don\'t track creation, e.g. FAT32), and Type (by file extension). The selected sort is remembered across restarts.' },
  'sidebar.pickBtn':       { title: 'Open folder',              text: 'Open the Windows folder-selection dialog and switch the file browser to any folder on your computer. The folder is added to the list of folders the tool is allowed to read and write to.' },
  'sidebar.newFolderBtn':  { title: 'New folder',               text: 'Create a new empty folder inside the current folder.' },
  'sidebar.openExplorerBtn': { title: 'Open in Explorer',       text: 'Open the current folder in Windows File Explorer so you can use your normal file-management tools (copy, paste, rename, share) on the generated files.' },
  'sidebar.options':       { title: 'Folder options',          text: 'Open the folder-options overlay: pick which columns the folder explorer shows (Size, Type, Modified, Created, Path) and toggle image thumbnails in the list. The File-name column is always visible â€” turning it off would make the list unscannable. Toggle a column and the change is applied live (you can see the row get wider / narrower immediately). Enable image thumbnails to replace the generic ðŸ–¼ icon with a centered preview of the actual image file (image rows only â€” folder rows and non-image files are unaffected). The selections are remembered across restarts. When the columns don\'t fit the available width, a horizontal scroll bar appears at the bottom of the list automatically.' },
  'sidebar.thumbnails':    { title: 'Image thumbnails',        text: 'Replace the generic ðŸ–¼ icon on image rows with a centered preview of the actual image file (folder rows and non-image files are unaffected). The row height grows automatically so the thumbnail is fully visible â€” even when every column is enabled at once. When the toggle is off, the regular emoji icon is shown and is left-aligned (instead of the previous centred style), so a plain list reads like a normal Explorer view. The choice is remembered across restarts.' },

  // -- Image tab --
  'image.prompt':          { title: 'Prompt',                   text: 'Describe the image you want. Be as specific as you can â€” include the subject, the setting, the lighting, the mood, the camera angle, the artistic style. For example, instead of "a cat", try "a fluffy ginger cat sitting on a sunlit windowsill, soft afternoon light, photographic style". The more detail, the closer the result matches what you had in mind.' },
  'image.style':           { title: 'Style preset',             text: 'A saved prefix that is automatically added to your prompt. Use a style to keep the same look across many images (for example, all images in a comic-strip project share the same "ink illustration" style prefix). Manage your styles via the ðŸŽ¨ button in the top bar.' },
  'image.negativePrompt':  { title: 'Negative prompt',         text: 'A list of things you do NOT want in the image. For example, "blurry, low quality, extra fingers" steers the model away from those problems. Leave empty for the default.' },
  'image.model':           { title: 'Model',                    text: 'Which image-generation model to use. Different models have different strengths: some are photorealistic, some are better for illustrations, some are optimised for text rendering, etc. If you are not sure, start with the default.' },
  'image.aspect':          { title: 'Aspect ratio',             text: 'The shape of the output image. "1:1" is a square. "16:9" is a wide landscape (good for desktop wallpapers). "9:16" is a tall portrait (good for phone wallpapers). "4:3" is the classic monitor shape.' },
  'image.resolution':      { title: 'Resolution',               text: 'The pixel size of the output image. Higher = more detail but slower to generate and uses more of your quota. The default (1024Ã—1024 for 1:1) is a good balance for most uses.' },
  'image.variants':        { title: 'Variants',                 text: 'How many different images to generate from the same prompt in a single click. Each variant uses one quota unit. Use 2-3 to compare options; use 4-5 if you want a wider selection to pick from.' },
  'image.seed':            { title: 'Seed',                     text: 'A number that controls the random pattern used by the model. The same prompt + the same seed always produces (roughly) the same image. Useful when you want to re-generate with one small change and keep everything else the same. Leave "-1" (default) for a fresh random seed each time.' },
  'image.referenceImage':  { title: 'Reference image',          text: 'An optional local image file the model should "look at" while generating. The model tries to match the style, the colour palette, the composition, or the subject of the reference. Not all models support this.' },
  'image.filePrefix':      { title: 'File-name prefix',         text: 'A short text prepended to every generated file name. For example, a prefix of "project42_" produces files like "project42_2024-01-15_â€¦". Useful for grouping related generations in a single project folder.' },
  'image.upscaleCheckbox': { title: 'Upscale after generation', text: 'When checked, every generated image is upscaled locally after the API returns it. Pure browser / Sharp pipeline, no extra network call. Click the label to open the settings dialog (multiplier, auto-crop, background-removal, optimization).' },
  'image.upscaleSettings': { title: 'Upscale settings',         text: 'Configure the local post-processing pipeline: how much to upscale (2Ã— / 3Ã— / 4Ã—), whether to auto-crop to a target resolution, and whether to remove the background or optimize the file size after upscale. Click the ðŸ” Upscale label to open this dialog.' },
  'image.addToBatch':      { title: 'Add to BatchGen',          text: 'Save the current prompt + settings as one entry in the BatchGen queue for this tab. You can then click "Start BatchGen" to run all queued entries one after another â€” useful for variations on a theme (same character, different poses / outfits / settings).' },
  'image.generateBtn':     { title: 'Generate',                 text: 'Send the current prompt to the MiniMax API. While the generation is in progress the button becomes "Cancel" â€” click it to abort. After the API returns, any enabled post-processing (upscale, crop, background removal, optimization) runs automatically before the image is shown in the preview pane. Works with both Token Plan and pay-as-you-go (PAYG) keys.' },
  'image.batchStart':      { title: 'Start BatchGen',           text: 'Run every prompt in the batch queue, one after another, using the prompt + settings of each entry. While a generation is running on this tab, the button is locked (greyed out) â€” wait for the current one to finish first.' },
  'image.batchEdit':       { title: 'Edit batch entries',       text: 'Open the BatchGen manager for this tab: add, remove, reorder, or edit the saved prompts. You can also paste a list of prompts (one per line) for bulk entry.' },

  // -- Speech tab --
  'speech.prompt':         { title: 'Text to speak',            text: 'The text the voice will read out. Plain text, no special formatting. Newlines are spoken as short pauses. Use punctuation (commas, periods, question marks) to control the pacing â€” they really do change how the voice sounds.' },
  'speech.voice':          { title: 'Voice',                    text: 'Which voice to use. The list is loaded from the API and contains dozens of voices in many languages. Each voice has a different age, gender, accent, and personality â€” click around to find the one you like. The "preview" button (â–¶) plays a sample.' },
  'speech.speed':          { title: 'Speed',                    text: 'How fast the voice speaks. 1.0 is the default. 0.5 is half-speed (slower, more deliberate). 2.0 is double-speed (chipmunk territory â€” usually too fast). Most use cases want 0.9-1.1.' },
  'speech.pitch':          { title: 'Pitch',                    text: 'How high or low the voice sounds. 0 is the default. Positive values make it higher, negative values make it lower. Small changes (Â±2) are usually all you need; large changes (Â±10+) start to sound unnatural.' },
  'speech.volume':         { title: 'Volume',                   text: 'Output loudness in decibels. 0 is the default. Positive values are louder, negative values are quieter. Useful for matching the level of multiple generated clips without re-encoding them.' },
  'speech.emotion':        { title: 'Emotion',                  text: 'Optional emotional tone: happy, sad, angry, surprised, fearful, disgusted, neutral. Leave at "Auto" for the model to pick based on the text. Not all voices support all emotions â€” the dropdown only shows what is available for the selected voice.' },
  'speech.language':       { title: 'Language',                 text: 'The spoken language. Most voices speak multiple languages â€” pick the one closest to the text you are feeding in. "Auto" lets the model detect the language from the text.' },
  'speech.format':         { title: 'Output format',            text: 'Audio file format. MP3 is the most compatible (plays on every device). PCM is raw audio (larger file, no quality loss). FLAC is lossless compression (smaller than PCM, same quality).' },
  'speech.sampleRate':     { title: 'Sample rate',              text: 'Audio quality, measured in samples per second. 32 kHz is good for speech. 44.1 kHz is CD quality. 48 kHz is studio quality â€” usually overkill for speech but fine for music. Higher = bigger file.' },

  // -- Music tab --
  'music.prompt':          { title: 'Music description',        text: 'Describe the music you want: genre (jazz, classical, electronicâ€¦), mood (energetic, melancholic, calmâ€¦), instruments (piano, drums, synthâ€¦), tempo (slow, mid-tempo, fastâ€¦), any reference (e.g. "in the style of 80s synthwave"). The more specific you are, the closer the result matches.' },
  'music.model':           { title: 'Model',                    text: 'Which music-generation model to use. Different models produce different lengths and styles. The default is a good starting point.' },
  'music.duration':        { title: 'Duration',                 text: 'How long the generated track should be, in seconds. Most models produce tracks between 10 and 60 seconds. Longer tracks use more quota.' },
  'music.instrumental':    { title: 'Instrumental only',        text: 'When checked, the model produces an instrumental track with no singing. When unchecked, the model can add vocals based on the description.' },

  // -- Video tab --
  'video.prompt':          { title: 'Prompt',                   text: 'Describe the short video you want. The model is best at clear, concrete subjects and actions (a dog running on a beach, a car driving through a city). Abstract or surreal prompts produce less reliable results.' },
  'video.model':           { title: 'Model',                    text: 'Which video-generation model to use. Different models have different resolution, length, and motion characteristics. The default is a good starting point.' },
  'video.resolution':     { title: 'Resolution',               text: 'The pixel size of the video. Higher = more detail but slower to render and uses more quota. 720p is a good default.' },
  'video.duration':        { title: 'Duration',                 text: 'How long the video should be, in seconds. Most models produce 5-10 second clips. Each extra second roughly doubles the render time and quota cost.' },
  'video.fps':             { title: 'Frames per second',        text: 'How smooth the video motion looks. 24 fps is the cinema standard. 30 fps is the TV standard. 60 fps is very smooth (used for sports / games). Higher = bigger file and more quota.' },
  'video.camera':          { title: 'Camera motion',            text: 'Optional camera movement (pan, zoom, dolly, etc.). Leave at "Static" for a fixed shot. Not all models support camera motion â€” the dropdown only shows what is available for the selected model.' },

  // -- Settings dialog --
  'settings.apiKey':       { title: 'API key',                  text: 'Your MiniMax API key. Works with both Token Plan keys (which look like "sk-cp-xxxxxxxx") and pay-as-you-go (PAYG) keys. Get a Token Plan key from the MiniMax dashboard, or create a PAYG key at the developer portal under "Interface Keys". Paste it here. The key is stored in config.txt next to the executable â€” never in the cloud, never embedded in the tool. You can use the "Show" / "Hide" toggle to confirm you pasted it correctly; the field is masked by default to prevent shoulder-surfing.' },
  'settings.outputDir':    { title: 'Output folder',            text: 'Where every generated file (image, audio, music, video) is written. Pick a folder with enough free space â€” videos and high-resolution images can be hundreds of megabytes each. The default is a "generated" folder next to the executable.' },
  'settings.region':       { title: 'Region',                   text: 'Which MiniMax API region to talk to. Most users want "global". Pick the regional endpoint only if you are inside a regulated network that blocks the global one. The region setting applies to both Token Plan and pay-as-you-go (PAYG) keys.' },
  'settings.theme':        { title: 'Theme',                    text: 'Pick the UI theme. "Dark" is easier on the eyes for long sessions. "Light" is better for screenshots / screen sharing in a bright room.' },
  'settings.upscale':      { title: 'Image upscaling',          text: 'Configure the local post-processing pipeline. The default works without any extra software, but you can install Real-ESRGAN (BSD-3-Clause) for noticeably higher-quality 4Ã— upscale, and IS-Net for one-click background removal. Both are optional.' },
  'settings.optionalAddons': { title: 'Optional add-ons',      text: 'One-click installers for the optional quality tools: Real-ESRGAN binary, IS-Net binary, IS-Net ONNX model. The tool works without them; they are quality upgrades, not requirements.' },
  'settings.popupPolicy':    { title: 'Popup behaviour',        text: 'Controls how often the optional popups appear: the welcome screen on every fresh launch, the first-time setup, the optional add-ons installer, and the per-tab intro messages. "Show once to fresh users, then never" is the default â€” each popup fires once and remembers your dismissal across restarts. "Show first time each app start" re-triggers every popup on the next launch (useful while you\'re still learning the tool). "Never show these popups" silences all of them at once. "Always show (even after dismissal)" re-fires them on every trigger â€” useful for demos and training. The "Reset popup history" button below wipes the dismissal record so every popup fires again on its next trigger.' },
  'settings.popupsBtn':      { title: 'Popups settings',        text: 'Open the popup behaviour settings: pick how often the welcome / first-time / add-on / tab-intro popups appear, or reset the seen-popups history so every popup fires again the next time it is triggered.' },

  // -- Image pipeline (right-click context menu) --
  'ctx.upscale':           { title: 'Upscale',                  text: 'Make the image bigger (2Ã—, 3Ã—, or 4Ã—) using the built-in canvas pipeline, or the higher-quality Real-ESRGAN binary if installed. The new file is written next to the original with a "_2x" / "_3x" / "_4x" suffix in the filename.' },
  'ctx.crop':              { title: 'Crop',                     text: 'Crop the image to a specific rectangle. Drag the crop frame with the mouse, or type exact W Ã— H values. The cropped file is written next to the original with a "_cropped_WxH" suffix.' },
  'ctx.convert':           { title: 'Convert format',           text: 'Re-encode the image to a different format. PNG is lossless (good for screenshots / illustrations, supports transparency). JPEG is much smaller (good for photos, no transparency). WebP is a modern middle ground (smaller than JPEG, supports transparency, but less universal).' },
  'ctx.optimize':          { title: 'Optimize / Compress',      text: 'Shrink the file size while keeping the image looking (almost) the same. The default quality of 82 is the "perceptually lossless" sweet spot for photos. You can also re-encode to WebP / AVIF for further size savings, and strip non-essential EXIF data (camera model, GPS, software tag) while keeping the colour profile.' },
  'ctx.removeBackground':  { title: 'Remove background',        text: 'Replace the background of the image with transparency. Uses the optional IS-Net model (a state-of-the-art segmentation model) â€” the tool walks you through the one-time install on first use. The result is a transparent PNG written next to the original.' },

  // -- Audio pipeline (right-click context menu) --
  'ctx.audioCut':          { title: 'Audio cut',                text: 'Open the audio in a waveform editor. Drag the two markers to set the selection, or use the time inputs for millisecond precision. Quality-of-life helpers: "Auto-trim silence" removes leading/trailing silence, "Snap to zero-crossing" prevents clicks at the cut edges, and a configurable micro-fade (5 ms by default) buries any residual click. Pick a different output format (MP3 / WAV / OGG / Opus / FLAC / M4A) from the dropdown, then "Export" writes the trimmed file next to the original. Keyboard: Space = play/stop, I/O = set start/end at the playhead, Z = zoom to selection, F = fit, A = amplify view, S = toggle snap, L = toggle loop.' },

  // -- Splitters --
  'layout.splitter':       { title: 'Drag to resize',           text: 'Click and drag this bar to resize the two areas on either side. The new size is remembered for your next launch. Three splitters exist: between the main content and the folder browser (vertical), between the content row and the log row (horizontal), and between the log and the picture preview (vertical).' },

  // -- Log + preview pane --
  'log.copy':              { title: 'Copy log',                 text: 'Copy the entire log to the clipboard. Useful for sharing an error with support or a friend. The API key is automatically masked in the copy (only the first 5 characters + "***" are shown) so a full key never accidentally leaves your machine.' },
  'log.clear':             { title: 'Clear log',                text: 'Erase the log. This is purely cosmetic â€” the next generation will start a fresh log. Useful when you are about to do a deliberate test and want a clean log of the test run only.' },
  'log.toggle':            { title: 'Collapse / expand the log', text: 'Collapse the log pane to a small button bar on the LEFT side so the picture preview can use the rest of the row. Click again to expand. The picture preview is locked to the RIGHT side of the window â€” there is never empty space to its right.' },
  'log.structured':        { title: 'Log events',               text: 'Each row in the log pane is one event. The columns are: time stamp, category icon (âœŽ generate, â¤´ upscale, â— background, âˆ‡ optimize, â–¤ batch, ! error, Ã— cancel, Â· info), result icon (âœ“ for success, âœ• for error), and a one-line headline. Click anywhere on a row to select it; click the small â–¸ chevron to expand and see the full details. Use Ctrl+click and Shift+click to multi-select multiple rows. The Copy button copies the selected rows (or all rows if nothing is selected) in a plain-text format that includes both the headline and the expanded details, so a support ticket gets the full picture.' },
  'preview.clear':         { title: 'Clear picture preview',    text: 'Reset the picture preview pane to its empty state. The file in the file browser is not touched â€” only the preview pane is cleared.' },
  'preview.pane':          { title: 'Picture preview pane',     text: 'When you click an image in the folder browser, it is shown here. The image is fit to the pane (no cropping, no zoom). For multi-image runs (a batch of 4 variants), the pane splits into a grid of thumbnails â€” click any thumbnail to open it at 1:1 size.' },
  'preview.overlayNav':    { title: 'Image overlay navigation', text: 'When the image overlay is open (1:1 view from a thumbnail click), use the left and right arrow keys to switch to the previous / next image. If the overlay was opened from a multi-image batch (e.g. 4 variants from a single Generate click), the arrow keys step through the batch in order. If it was opened from a single image in the file browser, the arrow keys step through all the images in the current folder, in the same order the folder explorer shows them. The position counter ("(3 / 12)") in the overlay header tells you where you are in the sequence. The "â€¹" and "â€º" buttons in the overlay header do the same thing with the mouse.' },
  'preview.liveUpdates':   { title: 'Live batchgen updates',    text: 'While a generation is in progress (including a multi-variant BatchGen run), the folder explorer and the picture preview pane update live as each new image is written to disk: a 1-second poll scans the output folder, every newly-discovered image is added to the multi-image preview grid as a thumbnail, the matching row in the folder explorer is marked active, and the new row + thumbnail briefly blink so you can see the progress at a glance. The polling stops automatically when the generation ends (or is cancelled).' },
};

function helpButton(topic) {
  // Build a clickable `?` icon that opens the help modal for
  // the given topic. Returns an HTMLElement you can drop
  // inline next to a label.
  //
  // `topic` can be either:
  //   - a string (treated as a key into helpTopics), or
  //   - an object with `{ text, topic }` for an inline
  //     1-line summary that ALSO links to the full topic.
  // The existing `def.help = "..."` strings (e.g. in
  // buildParamRow) are passed through unchanged; we just
  // upgrade them to a clickable button.
  let helpKey = null;
  let inlineText = null;
  if (typeof topic === 'string') {
    inlineText = topic;
    helpKey = topic;
  } else if (topic && typeof topic === 'object') {
    inlineText = topic.text || '';
    helpKey = topic.topic || null;
  }
  const titleAttr = inlineText
    ? (inlineText.length > 200 ? inlineText.slice(0, 197) + 'â€¦' : inlineText)
    : 'Show help';
  const b = el('button', {
    type: 'button',
    class: 'help-btn',
    title: titleAttr,
    'aria-label': 'Show help',
    onclick: (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Prefer the topic-keyed version (richer text) when
      // available; fall back to the inline summary.
      showHelp(helpKey, inlineText);
    },
  }, '?');
  return b;
}

function showHelp(topicKey, fallbackText) {
  // Open a modal that displays the help text for the given
  // topic key. If the key is not in the registry, fall back
  // to whatever inline text the caller supplied.
  let topic = null;
  if (topicKey && helpTopics[topicKey]) {
    topic = helpTopics[topicKey];
  } else if (topicKey) {
    // Unrecognised key: synthesize a minimal entry so the
    // user still sees *something* instead of a blank modal.
    topic = { title: 'Help', text: topicKey };
  } else if (fallbackText) {
    topic = { title: 'Help', text: fallbackText };
  } else {
    topic = { title: 'Help', text: 'No help text available for this option.' };
  }
  // Pass an id derived from the topic key so the modal-stack
  // dedup catches repeated clicks on the same help button.
  // Without this, mashing the ? icon on a glitchy trackpad
  // could pile up five identical help modals on top of each
  // other (each with its own backdrop and Esc listener).
  const modalId = topicKey ? ('help:' + topicKey) : 'help:inline';
  showModal((m, close) => {
    m.classList.add('help-modal');
    m.appendChild(el('h2', {}, 'â“ ' + topic.title));
    // The help text can contain short paragraphs separated by
    // blank lines â€” render as multiple <p> elements so the
    // typography is consistent with the rest of the app.
    const paragraphs = String(topic.text).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    const body = el('div', { class: 'help-modal-body' });
    for (const p of paragraphs) {
      body.appendChild(el('p', {}, p));
    }
    m.appendChild(body);
    // Footer with a single "Got it" close button so the
    // user has an obvious "I'm done" action. Esc also
    // closes (handled by the global keydown listener in
    // showModal).
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { class: 'primary', onclick: close }, 'Got it'),
    ]));
  }, { id: modalId });
}

// Wire every element that has a `data-help-topic` attribute
// (e.g. the topbar buttons, the sidebar buttons, the log
// buttons) to open the help modal on click. We use event
// delegation on the document so we don't have to attach
// listeners to every individual button (and so dynamically
// added elements get the behaviour for free as long as
// they have the attribute).
function setupHelpDelegation() {
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-help-topic]');
    if (!t) return;
    // Suppress help for form controls (INPUT/SELECT/TEXTAREA)
    // â€” clicking into the folder-browser filter, a prompt
    // textarea, or a model dropdown should focus the control,
    // not pop a help modal. The help is still reachable via
    // the surrounding label / the explicit ? icon. Without
    // this guard, clicking the filter opens the help modal,
    // closes it, and the user is forced to click the filter a
    // SECOND time to type â€” which opens the modal again,
    // forever.
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const topic = t.getAttribute('data-help-topic');
    showHelp(topic, t.getAttribute('title') || null);
  });
}

// Hover-driven tooltip for inline `data-help` icons (the small
// `?` spans next to form-field labels). Replaces the previous
// CSS pseudo-element approach (`[data-help]:hover::after`) which
// positioned the tooltip `absolute` next to the icon and was
// clipped by the content area's `overflow: auto`. Long tooltips
// (e.g. for --width, --model) routinely extended past the right
// edge of #content and were rendered invisible behind the
// folder-explorer area. The new tooltip is `position: fixed` so
// no parent container can clip it.
//
// A SINGLE tooltip element is created and reused. We use event
// delegation on the document so dynamically added icons (e.g.
// the help icons mounted by the per-tab build() calls) pick up
// the behaviour for free.
//
// The tooltip is repositioned on every scroll / resize event so
// it always tracks the currently-hovered icon, even when the
// page is scrolled while the tooltip is open.
function setupHoverHelpTooltips() {
  const tip = document.createElement('div');
  tip.className = 'help-hover-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.style.display = 'none';
  document.body.appendChild(tip);
  // The icon we're currently showing a tooltip for. Lets the
  // scroll/resize listener know whether to reposition or hide.
  let activeEl = null;
  // Show / hide / reposition helpers ----------------------------------
  function showFor(el) {
    const text = el.getAttribute('data-help') || el.getAttribute('title') || '';
    if (!text) { hide(); return; }
    tip.textContent = text;
    tip.style.display = '';
    activeEl = el;
    position(tip, el);
  }
  function hide() {
    tip.style.display = 'none';
    activeEl = null;
  }
  function position(tipEl, anchor) {
    // Position below the icon by default. If the tooltip would
    // overflow the bottom of the viewport, flip it above the
    // icon instead. If it would overflow the right edge, clamp
    // the left position so the right edge stays inside the
    // viewport. We use getBoundingClientRect (relative to the
    // viewport) because the tooltip itself is position: fixed.
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8; // px from the viewport edge
    // Measure the tooltip after we set the text but BEFORE we
    // position it â€” display:none / display:'' flicker is
    // unavoidable but lasts one frame, which is fine.
    const tipR = tipEl.getBoundingClientRect();
    let top = r.bottom + 6;
    let left = r.left;
    if (top + tipR.height > vh - margin) {
      // Try above the icon first
      const above = r.top - tipR.height - 6;
      if (above >= margin) top = above;
      else top = Math.max(margin, vh - tipR.height - margin);
    }
    if (left + tipR.width > vw - margin) {
      left = vw - tipR.width - margin;
    }
    if (left < margin) left = margin;
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }
  // Event delegation on the document. We use mouseover /
  // mouseout (NOT mouseenter / mouseleave) because they bubble â€”
  // critical for delegation. mouseover fires once per icon
  // entry, mouseout fires once per icon leave.
  document.addEventListener('mouseover', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-help]');
    if (!t) return;
    showFor(t);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target && e.target.closest && e.target.closest('[data-help]');
    if (!t) return;
    // Only hide if we're really leaving the icon (not just
    // moving to a child node inside the icon). relatedTarget
    // is the element the pointer is moving to; if it's still
    // inside `[data-help]`, we keep the tooltip open.
    const to = e.relatedTarget;
    if (to && t.contains(to)) return;
    hide();
  });
  // Hide on Esc and on window blur (the latter is a safety net
  // for cases like alt-tabbing away with the tooltip open).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && activeEl) hide();
  });
  window.addEventListener('blur', hide);
  // Reposition on scroll / resize so the tooltip stays glued to
  // the icon even if the user is mid-scroll. capture: true on
  // the scroll listener so we catch scrolls inside the
  // scrollable #content (which doesn't bubble to window).
  window.addEventListener('scroll', () => {
    if (activeEl) position(tip, activeEl);
  }, true);
  window.addEventListener('resize', () => {
    if (activeEl) position(tip, activeEl);
  });
}

// ----------------- Utilities -----------------
// Phase 3: lokale el()-Definition entfernt. Verwendet jetzt
// window.createElement aus core/DomHelpers.js (semantisch
// identisch, inkl. Array-Children-Flatten via [].concat()).
const el = window.createElement;

// ----------------- API key masking -----------------
// Phase 3: extrahiert nach renderer/utils/securityUtils.js.
// Hier nur Shim-Aliase, damit der 800+-Aufruf-Code in app.js
// unverändert bleibt. Funktionen liegen auf window.SecurityUtils
// und werden über index.html VOR app.js geladen.
const { maskApiKey, maskLine, showRevealableKey } = window.SecurityUtils;

// ----------------- Structured event log -----------------
// The new log pane is a list of structured events (one per row)
// instead of the old raw-text <pre>. Each event has:
//   { id, ts, category, headline, details, result, expanded, raw }
// and is rendered as a row with time stamp + category icon + result
// icon + headline. The user can multi-select rows with the mouse
// (click / ctrl-click / shift-click), expand a row to see its
// details, and copy the selected events (or all) to the clipboard
// in a plain-text format that includes both the headline and the
// expanded details â€” so pasting into a support ticket gives the
// helper every piece of information the renderer has.

// Maximum number of events kept in memory. Newer events push older
// ones out (FIFO). Caps memory growth over a long session; the
// user almost never scrolls back more than a few hundred lines.
const LOG_MAX_EVENTS = 500;

// Map of category id â†’ (icon glyph, label). The icon is the
// leading character in each row; the label is shown on hover
// (and used by the keyboard-shortcut help modal). Kept short
// so a single row stays one line in the collapsed state.
const LOG_CATEGORIES = {
  info:     { icon: 'Â·', label: 'Info' },
  gen:      { icon: 'âœŽ', label: 'Generate' },
  upscale:  { icon: 'â¤´', label: 'Upscale' },
  bg:       { icon: 'â—', label: 'Background' },
  optimize: { icon: 'âˆ‡', label: 'Optimize' },
  batch:    { icon: 'â–¤', label: 'Batch' },
  error:    { icon: '!', label: 'Error' },
  cancel:   { icon: 'Ã—', label: 'Cancel' },
};

// Add a new event to the log. Returns the new event id so the
// caller can reference it later (e.g. for a "background
// generation complete" event that needs to update a prior
// "background generation started" event).
//
// Args:
//   opts.headline  : string, short one-line description (required)
//   opts.category  : string, one of LOG_CATEGORIES keys (default 'info')
//   opts.details   : string | string[] | null, extra lines shown
//                    when the row is expanded. Strings are split
//                    on \n into multiple lines; null is no details.
//   opts.result    : 'ok' | 'err' | null (default null). Drives the
//                    trailing âœ… / âŒ icon.
//   opts.ts        : Date | null (default: now). Pass a custom
//                    timestamp for events that happened earlier
//                    (e.g. after a delay).
//   opts.select    : boolean (default false). If true, the new
//                    event is also added to the current selection.
//   opts.raw       : string | null. Free-form text (used by the
//                    legacy log() wrapper). Included in the
//                    copy output but not shown in the row.
//
// Masking: the headline + details are passed through maskLine()
// so a full API key never appears in a log event the user
// might paste into a support ticket.
function addLogEvent(opts) {
  opts = opts || {};
  const cfg = state.config || {};
  const mask = (s) => maskLine(String(s == null ? '' : s), cfg.api_key);
  const ev = {
    id: (_logNextId()),
    ts: opts.ts instanceof Date ? opts.ts : new Date(),
    category: LOG_CATEGORIES[opts.category] ? opts.category : 'info',
    headline: mask(opts.headline || ''),
    details: (function () {
      const d = opts.details;
      if (d == null) return [];
      const arr = Array.isArray(d) ? d : String(d).split(/\r?\n/);
      return arr.map((s) => mask(s)).filter((s) => s !== '');
    })(),
    result: opts.result === 'ok' || opts.result === 'err' ? opts.result : null,
    expanded: !!opts.expanded,
    raw: opts.raw != null ? mask(String(opts.raw)) : null,
  };
  state._logEvents.push(ev);
  // Cap the buffer. Drop the oldest events (FIFO) so the
  // visible scroll position stays near the bottom (newest
  // event). The user can still scroll up to see what's left
  // of the dropped events (they're gone from memory but the
  // UI re-renders only the live buffer).
  if (state._logEvents.length > LOG_MAX_EVENTS) {
    state._logEvents.splice(0, state._logEvents.length - LOG_MAX_EVENTS);
  }
  renderLogEvent(ev);
  // Auto-scroll the container to the new event unless the user
  // has scrolled up to read older events (a "stick to bottom"
  // toggle is a future enhancement; the simple "always scroll
  // to bottom on new event" is the right default for a log).
  const root = $('#log');
  if (root) root.scrollTop = root.scrollHeight;
  if (opts.select) toggleLogSelection(ev.id, true, false);
  return ev.id;
}
let _logIdCounter = 0;
function _logNextId() { return ++_logIdCounter; }

// Render a single event into the log pane. Builds the row's
// DOM once and appends it. The row carries the event id on a
// data attribute so click handlers can look up the underlying
// event in state._logEvents.
function renderLogEvent(ev) {
  const root = $('#log');
  if (!root) return;
  const cat = LOG_CATEGORIES[ev.category] || LOG_CATEGORIES.info;
  const row = el('div', {
    class: 'log-event',
    'data-log-id': ev.id,
    'data-log-cat': ev.category,
  });
  // 1. Time stamp
  const tsText = ev.ts.toLocaleTimeString('en-GB', { hour12: false });
  row.appendChild(el('span', { class: 'log-event-ts', title: ev.ts.toISOString() }, tsText));
  // 2. Category icon (single character so the row stays compact)
  row.appendChild(el('span', { class: 'log-event-cat', title: cat.label }, cat.icon));
  // 3. Result icon. "ok" â†’ green check, "err" â†’ red cross, null â†’ no icon.
  let resChar = '';
  let resTitle = '';
  if (ev.result === 'ok') { resChar = 'âœ“'; resTitle = 'Success'; }
  else if (ev.result === 'err') { resChar = 'âœ•'; resTitle = 'Error'; }
  if (resChar) {
    const cls = 'log-event-res ' + (ev.result === 'ok' ? 'ok' : 'err');
    row.appendChild(el('span', { class: cls, title: resTitle }, resChar));
  } else {
    row.appendChild(el('span', { class: 'log-event-res none' }, ''));
  }
  // 4. Headline + the (collapsed) details, shown as a single
  //    text node. The user-visible headline is truncated with
  //    ellipsis if it overflows the row, but the full text is
  //    available on hover via the title attribute.
  const headlineEl = el('span', { class: 'log-event-headline', title: ev.headline }, ev.headline);
  row.appendChild(headlineEl);
  // 5. Expand chevron. Toggles the details section on click.
  //    We always render it (even when details is empty) so the
  //    visual position of the column is stable. The chevron is
  //    visually-disabled (lower opacity, no hover) when there
  //    are no details to show.
  const hasDetails = ev.details.length > 0 || !!ev.raw;
  const chev = el('button', {
    type: 'button',
    class: 'log-event-chev' + (hasDetails ? '' : ' log-event-chev-empty'),
    'aria-label': hasDetails ? 'Toggle details' : 'No details',
  }, ev.expanded ? 'â–¾' : 'â–¸');
  row.appendChild(chev);
  // 6. Details section (rendered but hidden when not expanded).
  //    Each detail line is its own <div> for clean wrapping.
  //    When the user copies selected events, both the headline
  //    and every detail line are included (so the clipboard
  //    contains everything, not just the visible one-liner).
  if (hasDetails) {
    const det = el('div', { class: 'log-event-details' });
    if (!ev.expanded) det.style.display = 'none';
    for (const line of ev.details) {
      det.appendChild(el('div', { class: 'log-event-detail-line' }, line));
    }
    if (ev.raw) {
      det.appendChild(el('div', { class: 'log-event-detail-line log-event-detail-raw' }, ev.raw));
    }
    row.appendChild(det);
  }
  // Selection state. If this event id is currently in the
  // selection set, add the class so the row shows the
  // highlight. The toggle is done in the click handler.
  if (isLogSelected(ev.id)) row.classList.add('selected');
  if (ev.expanded) row.classList.add('expanded');
  root.appendChild(row);
  // Click delegation: the row-level click listener is attached
  // once on the root element (see setupLogClicks below), so
  // individual rows don't need per-row listeners.
}
// Track which events are currently in the multi-selection. A
// Set is used so the copy path can do a fast ordered iteration
// (Set preserves insertion order). The set is NOT exposed on
// state â€” it's an internal implementation detail of the log
// pane.
const _logSelected = new Set();
function isLogSelected(id) { return _logSelected.has(id); }
function toggleLogSelection(id, selected, scrollIntoView) {
  if (selected) _logSelected.add(id);
  else _logSelected.delete(id);
  const row = document.querySelector(`.log-event[data-log-id="${id}"]`);
  if (row) {
    row.classList.toggle('selected', selected);
    if (scrollIntoView) {
      try { row.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    }
  }
}
function clearLogSelection() {
  _logSelected.clear();
  $$('.log-event.selected').forEach((n) => n.classList.remove('selected'));
}
// Range-select helper: select every event between `fromId` and
// `toId` (inclusive) by document order. Used by shift-click.
function selectLogRange(fromId, toId) {
  const ids = state._logEvents.map((e) => e.id);
  const a = ids.indexOf(fromId);
  const b = ids.indexOf(toId);
  if (a < 0 || b < 0) return;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  for (let i = lo; i <= hi; i++) toggleLogSelection(ids[i], true, false);
}

// Serialize a single event for the clipboard. Returns a string
// with the event's headline + every detail line, separated by
// \n so the paste target can render it correctly. The format
// is intentionally simple (no markdown) â€” a support ticket
// should display it as-is.
function formatLogEventForCopy(ev) {
  const parts = [];
  const ts = ev.ts.toLocaleString();
  const cat = (LOG_CATEGORIES[ev.category] || LOG_CATEGORIES.info).label;
  const res = ev.result === 'ok' ? ' [OK]' : ev.result === 'err' ? ' [ERR]' : '';
  parts.push(`[${ts}] [${cat}]${res} ${ev.headline}`);
  for (const d of ev.details) parts.push('    ' + d);
  if (ev.raw) parts.push('    ' + ev.raw);
  return parts.join('\n');
}

// Serialize the current selection (or all events, if the
// selection is empty) for the clipboard. Returns the joined
// string the caller writes to the clipboard. The order is the
// same as the document order so a multi-line copy reads top
// to bottom.
function collectLogCopyText() {
  const events = state._logEvents;
  if (!events.length) return '';
  // If the user has a selection, only copy those. Otherwise
  // copy every event currently in memory.
  let chosen;
  if (_logSelected.size > 0) {
    const selSet = _logSelected;
    chosen = events.filter((e) => selSet.has(e.id));
    // Sort by document order (events are pushed in order so
    // _logEvents is already sorted by id, but we re-derive the
    // order to be safe against future changes).
    chosen.sort((a, b) => a.id - b.id);
  } else {
    chosen = events.slice();
  }
  return chosen.map(formatLogEventForCopy).join('\n');
}

// Wire click + keydown on the log root. Click handling:
//   click on a row              â†’ toggle that row's selection
//                                 (single-click replaces; ctrl
//                                 adds; shift range-selects)
//   click on the chevron        â†’ toggle that row's expand
//                                 (NOT the selection)
// We attach the listener once, on the root, and let event
// delegation do the rest (so dynamically-added events get
// the behaviour for free).
function setupLogClicks() {
  const root = $('#log');
  if (!root) return;
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.log-event');
    if (!row) return;
    const id = parseInt(row.getAttribute('data-log-id') || '0', 10);
    if (!id) return;
    // Chevron click â€” toggle expand only.
    if (e.target.classList.contains('log-event-chev')) {
      e.stopPropagation();
      const ev = state._logEvents.find((x) => x.id === id);
      if (!ev) return;
      if (!ev.details.length && !ev.raw) return;
      ev.expanded = !ev.expanded;
      row.classList.toggle('expanded', ev.expanded);
      const det = row.querySelector('.log-event-details');
      if (det) det.style.display = ev.expanded ? '' : 'none';
      const chev = row.querySelector('.log-event-chev');
      if (chev) chev.textContent = ev.expanded ? 'â–¾' : 'â–¸';
      return;
    }
    // Multi-select on row click.
    e.preventDefault();
    if (e.shiftKey && state._logLastClickedId != null) {
      selectLogRange(state._logLastClickedId, id);
    } else if (e.ctrlKey || e.metaKey) {
      toggleLogSelection(id, !isLogSelected(id), false);
    } else {
      clearLogSelection();
      toggleLogSelection(id, true, false);
    }
    state._logLastClickedId = id;
  });
}

function log(line) {
  // Legacy free-form log line (used for mmx stderr streaming).
  // We now route these through addLogEvent() so the new
  // structured pane picks them up. The 'info' category + a
  // 'headline' that is the full line preserves the original
  // text; the headline is also used by the new pane (one
  // line per event) so a casual user sees a one-line
  // summary, and a help-desk helper can click the chevron
  // to see the full line.
  if (!line) return;
  addLogEvent({
    category: 'info',
    headline: maskLine(String(line), state.config && state.config.api_key),
  });
}

function toast(msg, kind = 'info', ms = 3000) {
  const root = $('#toast-root');
  const t = el('div', { class: 'toast ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : '') }, msg);
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; }, ms - 300);
  setTimeout(() => t.remove(), ms);
}

// v1.1.1 polish: a "What's new" toast that fires the first time
// the user launches a build with a newer package.json version
// than what they last saw. The flag is per-version (not just
// a one-time "saw it" boolean) so future upgrades also surface
// their changelog. The user can dismiss the toast with the X
// button; it never auto-shows again until the next upgrade.
//
// The toast is intentionally compact (a single line of headline
// + a few bullets) so it doesn't block the user's first
// action. It can be expanded by clicking the title.
async function maybeShowWhatsNewToast() {
  try {
    const meta = await window.api.getAppVersion();
    if (!meta || !meta.version) return;
    const seen = (state.state && state.state.lastSeenVersion) || '';
    if (seen === meta.version) return;
    // v1.1.1 is the first release to use this mechanism, so
    // anyone upgrading from anything earlier sees the
    // changelog. If the user is on a brand-new install (no
    // saved state at all) the startup popup already covers
    // the onboarding case; we just want to surface WHAT
    // changed for returning users.
    const headline = `v${meta.version} is here`;
    const items = [
      'Folder options: choose your columns (size, type, modified, created, path)',
      'Live batchgen: watch files appear in the preview as each variant finishes',
      'New log pane: time-stamped, multi-select, click-to-expand, structured copy',
      'Arrow keys in image overlay: ← / → to step through your batch / folder',
      'Mark active in browser: the file you\'re previewing is always highlighted',
    ];
    showWhatsNewToast(headline, items, async () => {
      // Persist "I've seen this version" so the toast doesn't
      // fire again on the next launch of the same build.
      try {
        if (!state.state) state.state = {};
        state.state.lastSeenVersion = meta.version;
        await window.api.stateSet(state.state);
      } catch (_) { /* non-fatal */ }
    });
  } catch (_) { /* non-fatal */ }
}

function showWhatsNewToast(headline, items, onDismiss) {
  const root = $('#toast-root');
  // The toast is a compact card (single column, ~380px wide
  // — see styles.css .whats-new-toast) with a header row
  // (X button) + the headline + a collapsed bullet list.
  // Clicking the headline expands the bullets. The 380px
  // width + 15px headline font was bumped from the original
  // 320/13 because the user reported the headline was being
  // cut off on smaller windows.
  const t = el('div', { class: 'whats-new-toast' });
  const header = el('div', { class: 'whats-new-header' });
  const h = el('span', { class: 'whats-new-headline' }, headline);
  h.title = 'Click to expand';
  const x = el('button', { class: 'btn-mini whats-new-x', type: 'button' }, '×');
  header.append(h, x);
  t.appendChild(header);
  const list = el('ul', { class: 'whats-new-list' });
  for (const item of items) list.appendChild(el('li', {}, item));
  t.appendChild(list);
  // Click anywhere on the toast body to expand. Click X to
  // dismiss.
  h.addEventListener('click', () => { t.classList.toggle('expanded'); });
  t.addEventListener('click', (e) => { if (e.target === t) t.classList.toggle('expanded'); });
  x.addEventListener('click', (e) => {
    e.stopPropagation();
    t.style.transition = 'opacity 200ms ease, transform 200ms ease';
    t.style.opacity = '0';
    t.style.transform = 'translateY(-8px)';
    setTimeout(() => { t.remove(); if (onDismiss) onDismiss(); }, 220);
  });
  root.appendChild(t);
  // Don't auto-dismiss â€” the user should explicitly close it
  // (or accept that it stays). Persisting `lastSeenVersion` only
  // happens on X click so an unexpected reload still shows the
  // toast next launch.
}

// ----------------- Modal -----------------
// Stack-based modal manager. The previous version used a single
// `_modalClose` slot and wiped `modal-root` on every `showModal` call â€”
// that destroyed any underlying modal (e.g. opening the bulk-paste
// dialog from the BatchGen manager wiped the BatchGen modal entirely,
// and the user lost Esc-to-close on the parent). Stacking keeps each
// modal's DOM around until its own close is called, and Esc closes the
// topmost modal first.
//
// Focus restoration: when a modal opens we remember the
// document.activeElement so we can restore focus on close. Without
// this, clicking into the folder-browser filter opened the
// help modal AND stripped focus from the input; after dismissing
// the modal the user had to click the input again, which would
// re-trigger the same help modal â€” an infinite loop. Restoring
// focus on close breaks the cycle.
//
// Stack dedup: every modal can carry an optional `id` string.
// If a modal with the same id is already on the stack, the new
// call is treated as a no-op (returns the existing modal's close
// fn). Without this, mashing a help button on a glitchy trackpad
// could pile up five identical help modals on top of each other.
let _modalClose = null;
const _modalStack = [];
function showModal(build, opts) {
  const root = $('#modal-root');
  const id = (opts && opts.id) || null;
  // Stack dedup: refuse to open a second modal with the same id
  // when one is already showing. The user gets the existing one
  // (and its focus) â€” clicking the same help button twice is a
  // no-op rather than stacking two copies.
  if (id) {
    for (const entry of _modalStack) {
      if (entry && entry.id === id) return entry.close;
    }
  }
  root.classList.add('active');
  const m = el('div', { class: 'modal' });
  root.appendChild(m);
  // Remember the currently-focused element so we can restore it
  // on close. We capture this BEFORE we run the builder, because
  // the builder typically focuses its primary button (which would
  // otherwise become the "previously focused" element).
  const prevFocus = document.activeElement;
  const stackEntry = { id, close: null };
  const close = () => {
    if (m.parentNode) m.remove();
    if (root.children.length === 0) {
      root.classList.remove('active');
    }
    const idx = _modalStack.indexOf(stackEntry);
    if (idx >= 0) _modalStack.splice(idx, 1);
    if (_modalStack.length > 0) {
      _modalClose = _modalStack[_modalStack.length - 1].close;
    } else if (_modalClose === close) {
      _modalClose = null;
    }
    // Restore focus to the element that was focused when the
    // modal opened. Falls back to <body> if the original element
    // was removed from the DOM in the meantime (e.g. a settings
    // dialog re-rendered its form).
    try {
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) {
        prevFocus.focus();
      }
    } catch (_) { /* ignore */ }
  };
  stackEntry.close = close;
  _modalStack.push(stackEntry);
  _modalClose = close;
  build(m, close);
  return close;
}

// Close the active modal when the user presses Escape. Also auto-focus the
// first primary button so Enter triggers it.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _modalClose) {
    e.preventDefault();
    _modalClose();
  }
});

// ----------------- Startup popup -----------------
// Shown on every fresh launch. Single OK button to dismiss. Reachable later
// from the âš™ Settings menu (TODO: wire into settings if needed).
//
// Honours the user-configurable popup policy (state.popupPolicy):
//   'once-fresh'   â€” default. Show on every fresh launch until the user
//                    dismisses it; once dismissed, never show again.
//   'per-session'  â€” Show once per app start.
//   'never'        â€” Skip entirely.
//   'always'       â€” Always show (ignoring any prior dismissal).
// The popup id is 'startup'. openGatedPopup() is the central dispatcher;
// new tab-triggered popups should reuse it with their own stable id.
function shouldShowPopup(id) {
  const policy = state.popupPolicy || 'once-fresh';
  if (policy === 'always') return true;
  if (policy === 'never') return false;
  if (policy === 'per-session') {
    return !_popupSeenThisSession.has(id);
  }
  // 'once-fresh' (default): persist dismissal in state.seenPopups so
  // a returning user never sees the popup again unless they reset
  // the seen set from âš™ Settings â†’ Popups.
  return !(state.seenPopups && state.seenPopups[id]);
}
function markPopupSeen(id) {
  if (!id) return;
  _popupSeenThisSession.add(id);
  if (!state.seenPopups || typeof state.seenPopups !== 'object') state.seenPopups = {};
  state.seenPopups[id] = new Date().toISOString();
  scheduleStateSave();
}
function resetPopupSeen() {
  // Wipe both the persistent record AND the per-session set so a
  // "Reset all popup history" action in âš™ Settings immediately
  // re-triggers every popup on the very next trigger.
  state.seenPopups = {};
  _popupSeenThisSession.clear();
  scheduleStateSave();
}
function openGatedPopup(id, build) {
  // Centralised dispatcher: gates a popup behind the user's chosen
  // popup policy, then opens it via the standard showModal() so it
  // gets all the same Esc/click-outside/stack behaviour as every
  // other dialog. Callers wrap the popup body in `build(m, close,
  // markSeen)` and MUST call `markSeen()` exactly once (typically
  // from every close path) so the 'once-fresh' / 'per-session'
  // policies don't re-fire it.
  if (!shouldShowPopup(id)) return null;
  const markSeen = () => markPopupSeen(id);
  return showModal((m, close) => {
    build(m, close, markSeen);
  });
}
function showStartupPopup() {
  openGatedPopup('startup', (m, close, markSeen) => {
    m.classList.add('startup-modal');
    m.appendChild(el('h2', {}, TOOL_NAME));
    m.appendChild(el('div', { class: 'startup-version' }, BUILD_VERSION));
    m.appendChild(el('p', { class: 'startup-info' }, TOOL_INFO));
    const shortcuts = el('div', { class: 'shortcuts-box' });
    shortcuts.appendChild(el('h4', {}, 'âŒ¨ Keyboard shortcuts'));
    const list = [
      ['Ctrl+Enter', 'Generate on the active tab (same as clicking the big Generate button)'],
      ['Ctrl+1 / 2 / 3 / 4', 'Switch to the Image / Speech / Music / Video tab'],
      ['Ctrl+B', 'Open BatchGen for the active tab (queue multiple prompts to run in sequence)'],
      ['Ctrl+T', 'Open Style Settings (manage your saved prompt prefixes)'],
      ['Ctrl+S', 'Open Settings (API key, output folder, region, theme, image pipeline)'],
      ['Ctrl+L', 'Switch between dark and light mode'],
      ['Ctrl+F', 'Focus the file-browser filter (start typing to filter the file list)'],
      ['Ctrl+R', 'Refresh the quota counter (how many generations you have left)'],
      ['â† / â†’', 'When the image overlay is open: step to the previous / next image (multi-image batch, or all images in the current folder)'],
    ];
    for (const [keys, desc] of list) {
      shortcuts.appendChild(el('div', { class: 'shortcut-row' }, [
        el('kbd', {}, keys),
        el('span', {}, desc),
      ]));
    }
    m.appendChild(shortcuts);
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { class: 'primary', onclick: () => {
        markSeen();
        close();
        // After the user dismisses the greetings popup, if any of the
        // essential settings (api_key, output_dir) are still empty, walk
        // them through the first-time setup form. The folder field uses
        // the standard Windows folder-selection dialog via pickFolder.
        // Otherwise (config already valid), skip straight to the
        // unified "Optional add-ons" popup so a user with a fresh
        // ./bin/ also discovers the one-click installers for
        // Real-ESRGAN, the IS-Net binary, and the IS-Net model.
        if (!state.config.api_key || !state.config.output_dir) {
          openFirstTimeSetup();
        } else if (!state.realesrganFirstRunDismissed) {
          openOptionalAddons({ autoOpened: true }).catch(() => {});
        }
      } }, 'OK'),
    ]));
    // OK on Enter for convenience
    setTimeout(() => { m.querySelector('button.primary')?.focus(); }, 0);
  });
}

// ----------------- First-time setup popup -----------------
// Shown right after the greetings popup if either the API key or the
// output directory is missing. Fields are pre-filled with whatever
// values are already in config.txt so the user only has to fix the
// gaps. The "Save" button validates that both required fields are
// present and writes the config before closing. "Skip for now" closes
// without saving â€” the user can fill the values in later from âš™
// Settings.
function openFirstTimeSetup() {
  openGatedPopup('first-time-setup', (m, close, markSeen) => {
    m.classList.add('first-time-setup-modal');
    m.appendChild(el('h2', {}, 'First-time setup'));
    // Plain-language description. Avoids jargon ("endpoint",
    // "config") and tells the user exactly what each value is
    // for and where it ends up.
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Welcome! The tool needs two pieces of information to work: your MiniMax API key (so the tool can talk to the model) and the folder where you want generated files to be saved. Both can be changed later in âš™ Settings. Click the "?" next to any field for a longer explanation.'));

    const cfg = { ...state.config };

    // API key. We use the showRevealableKey helper so the first-time
    // setup behaves the same as the regular âš™ Settings popup: the
    // real key is hidden behind a "Show" toggle by default, but
    // the user can reveal it (or type a new one) with one click.
    // Without the toggle, the placeholder is a generic "sk-cp-xxxâ€¦"
    // so the user knows what shape to paste, but the value field
    // never contains the real key unless the user explicitly asked
    // for it. See the comment on showRevealableKey for the full
    // security rationale.
    //
    // Both Token Plan keys (sk-cp-â€¦) and pay-as-you-go (PAYG) keys
    // are accepted. The placeholder shows the Token Plan shape as a
    // hint but the input is plain text â€” we do not enforce a prefix.
    const apiRow = showRevealableKey(cfg.api_key || '', {
      placeholder: 'sk-cp-xxxxxxxx  (or your PAYG key)',
      label: 'API key (MiniMax Token Plan or PAYG)',
    });
    // Help icon for the API-key field â€” the same one used in the
    // Settings dialog so the user gets a consistent explanation
    // regardless of which entry point they came from.
    try {
      const lbl = apiRow.row.querySelector('label');
      if (lbl) lbl.appendChild(helpButton('settings.apiKey'));
    } catch (_) {}
    m.appendChild(apiRow.row);
    const apiInput = apiRow.input;

    // Output directory â€” text input + Browse button that opens the
    // standard Windows folder-selection dialog (the same one the
    // âš™ Settings popup uses).
    const outInput = el('input', { type: 'text', value: cfg.output_dir || '', placeholder: 'C:\\Users\\me\\Pictures\\MiniMax-Assets' });
    const browse = el('button', { class: 'btn-mini', type: 'button' }, 'Browseâ€¦');
    browse.addEventListener('click', async () => {
      const picked = await window.api.pickFolder();
      if (picked) outInput.value = picked;
    });
    m.appendChild(el('div', { class: 'row' }, [
      el('label', {}, ['Output directory', helpButton('settings.outputDir')]),
      el('div', { class: 'combo' }, [outInput, browse]),
    ]));

    // Region (already has a default of 'global' but show it so the
    // user can confirm / change it on first launch).
    const regInput = el('select', {});
    for (const r of ['global', 'cn']) regInput.appendChild(el('option', { value: r }, r));
    regInput.value = cfg.region || 'global';
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Region', helpButton('settings.region')]), regInput]));

    const save = el('button', { class: 'primary' }, 'Save');
    const skip = el('button', { onclick: () => { markSeen(); close(); } }, 'Skip for now');
    save.addEventListener('click', async () => {
      // Use the helper's getValue() (not apiInput.value) so we
      // never accidentally persist the masked version. The helper
      // returns the real current value regardless of whether the
      // field is currently shown or hidden.
      const api_key = apiRow.getValue().trim();
      const output_dir = outInput.value.trim();
      const region = regInput.value || 'global';
      if (!api_key) { toast('API key is required. Paste it into the API key field above, or click "Skip for now" and set it later in âš™ Settings.', 'err', 5000); return; }
      if (!output_dir) { toast('Output directory is required. Pick a folder with the Browseâ€¦ button, or click "Skip for now".', 'err', 5000); return; }
      const newCfg = { ...state.config, api_key, output_dir, region };
      state.config = await window.api.setConfig(newCfg);
      toast('Settings saved.', 'ok');
      markSeen();
      close();
      // Reload anything that depends on config (quota + the file
      // browser, so the freshly-set output_dir is shown).
      refreshQuota();
      refreshBrowser();
    });
    m.appendChild(el('div', { class: 'footer' }, [skip, save]));

    // Focus the first empty field, then the second â€” saves the user a
    // click when both are blank.
    setTimeout(() => {
      if (!cfg.api_key) apiInput.focus();
      else if (!cfg.output_dir) outInput.focus();
      else apiInput.focus();
    }, 0);
  });

  // After the first-time setup popup (Save or Skip), walk the user
  // through the optional Real-ESRGAN install. Without this, a user
  // who picked the built-in upscaler without ever opening âš™
  // Settings would never see the one-click installer, and would
  // wonder "why doesn't this upscale as well as the screenshots
  // show?" later. The install IS automated (one click) â€” the issue
  // is purely discoverability. The popup is gated on
  //   - Real-ESRGAN binary not present
  //   - user hasn't already dismissed it
  // so it never nags. It is intentionally NOT gated on
  // "config was just set on this launch" â€” a user who already had a
  // valid config but a fresh install (no ./bin/) should still see
  // it on first launch.
  if (!state.realesrganFirstRunDismissed) {
    openOptionalAddons({ autoOpened: true }).catch(() => {});
  }
}

// ----------------- Real-ESRGAN first-run popup -----------------
// Surfaces the one-click Real-ESRGAN installer on the very first
// launch (after the first-time setup popup) so the user doesn't
// have to dig through âš™ Settings to discover it. If the binary is
// already present (e.g. the user copied it in themselves), the
// popup auto-closes without bothering them. The "Don't ask again"
// button persists a flag in state.json so this never re-appears
// after dismissal.
// ----------------- Optional add-ons popup (unified) -----------------
// The single place where the user installs every optional component
// the tool supports: Real-ESRGAN upscaler, isnetbg binary, and the
// IS-Net ONNX model. Designed to be shown both as a first-run
// prompt (when nothing is installed) and as a re-openable manager
// from âš™ Settings (the "Re-open add-ons" link in the Upscale
// Settings section re-invokes it).
//
// Per-component install options:
//   1. "Download" (Real-ESRGAN only) â€” fixed GitHub URL in main.js.
//      Streams progress via the existing realesrganDownload IPC.
//   2. "Open download page" (Real-ESRGAN + model) â€” opens the
//      upstream release page / HuggingFace mirror in the user's
//      default browser. The user then downloads the file
//      themselves and uses the file-picker. This is the universal
//      "no auto-download breakage" path.
//   3. "Pick fileâ€¦" (all three) â€” file-picker copies the picked
//      file into ./bin/ (or ./bin/models/) under the name the
//      wrapper probes for. This is the universal fallback for
//      when neither auto-download nor the upstream URL is
//      available (e.g. the user built the isnetbg binary from
//      the C# reference in the README).
//
// A single "Re-detect" button at the bottom re-probes both
// Real-ESRGAN and isnetbg so the user sees the status reflect
// their latest install attempt. The popup itself can stay open
// across multiple install attempts (it doesn't auto-close on
// success) so the user can install all three components in one
// sitting.
async function openOptionalAddons({ autoOpened = false, force = false } = {}) {
  // Probe both backends BEFORE opening the modal. If everything
  // is already installed (e.g. the developer pre-bundled the
  // files in ./bin/ before building the portable .exe), skip the
  // popup entirely on first run â€” the same "don't nag" logic the
  // previous Real-ESRGAN-only popup had.
  const probeAll = async () => {
    let reSt = null, isSt = null;
    try { reSt = await window.api.realesrganAvailable(); } catch (_) {}
    try { isSt = await window.api.isnetbgAvailable(); } catch (_) {}
    return { reSt, isSt };
  };
  // If this is the first-run auto-open, AND everything is
  // installed, AND the user hasn't explicitly opened the popup
  // via the âš™ Settings link, silently dismiss.
  if (autoOpened) {
    const { reSt, isSt } = await probeAll();
    const reOk = reSt && reSt.available;
    const isOk = isSt && isSt.available && isSt.modelPresent;
    if (reOk && isOk) {
      state.realesrganFirstRunDismissed = true;
      scheduleStateSave();
      return;
    }
    // Honour the popup policy on the auto-opened path. When the
    // user picks 'never' (or has already dismissed this popup
    // under 'once-fresh' / 'per-session'), skip silently so the
    // auto-open from the startup flow doesn't nag.
    if (!force && !shouldShowPopup('optional-addons')) return;
  }

  showModal((m, close) => {
    m.classList.add('optional-addons-modal');
    m.appendChild(el('h2', {}, 'ðŸ§© Optional add-ons'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'The tool ships with built-in defaults that work without any extra software. The components below are optional quality upgrades â€” install them if you want sharper upscale, transparent backgrounds, or both. You can re-open this popup any time from âš™ Settings â†’ Image upscaling â†’ "Re-open add-ons".'));

    // ---- Section 1: Real-ESRGAN upscaler ----
    const reCard = el('div', { class: 'addon-card' });
    reCard.appendChild(el('h3', {}, 'ðŸ” Real-ESRGAN upscaler (BSD-3-Clause)'));
    reCard.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; margin: 4px 0 8px;' },
      'Drop-in upgrade for the built-in multi-step upscaler. Noticeably more detail on 4Ã— upscale, and the only way to use the official 4Ã— BSD-3 model.'));
    const reStatus = el('div', { class: 'addon-status' }, 'Detectingâ€¦');
    reCard.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Status'), reStatus]));
    const reProgress = el('div', { class: 'addon-progress' });
    reProgress.style.display = 'none';
    reProgress.style.color = 'var(--fg-2)';
    reProgress.style.fontSize = '12px';
    reCard.appendChild(reProgress);
    const reActions = el('div', { class: 'addon-actions' });
    const reDownload = el('button', { class: 'primary' }, 'Download from GitHub');
    const rePick = el('button', {}, 'Pick fileâ€¦');
    const reOpenPage = el('button', { class: 'btn-mini' }, 'Open releases page');
    reActions.append(reOpenPage, rePick, reDownload);
    reCard.appendChild(reActions);
    m.appendChild(reCard);

    // ---- Section 2: IS-Net background-removal binary ----
    const isBinCard = el('div', { class: 'addon-card' });
    isBinCard.appendChild(el('h3', {}, 'âœ¨ IS-Net background removal â€” binary (MIT)'));
    isBinCard.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; margin: 4px 0 8px;' },
      'The local ONNX-driven background-removal engine. Build the binary from the C# reference in the project README (Microsoft.ML.OnnxRuntime + SixLabors.ImageSharp), then point this popup at the resulting .exe.'));
    const isBinStatus = el('div', { class: 'addon-status' }, 'Detectingâ€¦');
    isBinCard.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Status'), isBinStatus]));
    const isBinActions = el('div', { class: 'addon-actions' });
    const isBinPick = el('button', { class: 'primary' }, 'Pick binaryâ€¦');
    const isBinOpenReadme = el('button', { class: 'btn-mini' }, 'Open README');
    isBinActions.append(isBinOpenReadme, isBinPick);
    isBinCard.appendChild(isBinActions);
    m.appendChild(isBinCard);

    // ---- Section 3: IS-Net model file ----
    const isModelCard = el('div', { class: 'addon-card' });
    isModelCard.appendChild(el('h3', {}, 'âœ¨ IS-Net model â€” isnet-general-use.onnx (MIT, ~170 MB)'));
    isModelCard.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; margin: 4px 0 8px;' },
      'The ONNX model the isnetbg binary loads at startup. Download from a HuggingFace mirror of your choice, or any of the official IS-Net model repos, then point this popup at the file.'));
    const isModelStatus = el('div', { class: 'addon-status' }, 'Detectingâ€¦');
    isModelCard.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Status'), isModelStatus]));
    const isModelActions = el('div', { class: 'addon-actions' });
    const isModelPick = el('button', { class: 'primary' }, 'Pick modelâ€¦');
    const isModelOpenPage = el('button', { class: 'btn-mini' }, 'Open HuggingFace');
    isModelActions.append(isModelOpenPage, isModelPick);
    isModelCard.appendChild(isModelActions);
    m.appendChild(isModelCard);

    // ---- Footer: Re-detect + Dismiss + Don't-ask-again ----
    const footer = el('div', { class: 'footer' });
    const redetect = el('button', { class: 'btn-mini' }, 'ðŸ”„ Re-detect');
    const skipBtn = el('button', { onclick: () => { markPopupSeen('optional-addons'); close(); } }, 'Skip for now');
    const neverBtn = el('button', { class: 'btn-mini' }, "Don't ask again");
    footer.append(neverBtn, skipBtn, redetect);
    m.appendChild(footer);

    // ---- Wiring ----
    function setStatus(node, text, color) {
      node.textContent = text;
      if (color) node.style.color = color;
    }

    async function refreshAll() {
      setStatus(reStatus, 'Detectingâ€¦');
      setStatus(isBinStatus, 'Detectingâ€¦');
      setStatus(isModelStatus, 'Detectingâ€¦');
      const { reSt, isSt } = await probeAll();
      if (reSt && reSt.available) {
        const v = reSt.version ? ` v${reSt.version}` : '';
        setStatus(reStatus, 'Detected: ' + (reSt.binaryPath || '') + v, 'var(--success)');
      } else {
        setStatus(reStatus, 'Not found â€” choose an install method below.', 'var(--fg-2)');
      }
      if (isSt && isSt.available && isSt.modelPresent) {
        // Differentiate the Node.js backend from a hand-built C#
        // binary. The `version` field returned by probeVersion()
        // is the string 'node-onnxruntime' for the Node backend
        // and a semver for the C# binary; for the binary path we
        // also display the resolved binaryPath so the user can
        // see WHICH binary was detected.
        const isNode = isSt.version === 'node-onnxruntime';
        if (isNode) {
          setStatus(isBinStatus, 'IS-Net Node.js wrapper (onnxruntime-node) + model detected.', 'var(--success)');
        } else {
          const v = isSt.version ? ` v${isSt.version}` : '';
          setStatus(isBinStatus, 'IS-Net binary' + v + ' + model detected.', 'var(--success)');
        }
        setStatus(isModelStatus, 'Detected: ' + (isSt.modelPath || ''), 'var(--success)');
      } else if (isSt && isSt.available && !isSt.modelPresent) {
        setStatus(isBinStatus, 'Binary detected â€” model file missing.', 'var(--warn, #d9a300)');
        setStatus(isModelStatus, 'Not found â€” pick the .onnx file below.', 'var(--fg-2)');
      } else {
        setStatus(isBinStatus, 'Not found â€” pick the binary you built.', 'var(--fg-2)');
        setStatus(isModelStatus, 'Not found â€” pick the .onnx file below.', 'var(--fg-2)');
      }
    }
    refreshAll();

    // Re-detect button â€” single place to refresh after any install.
    redetect.addEventListener('click', () => refreshAll());

    // Don't-ask-again: persist dismissal and close. We use the
    // same state flag the old Real-ESRGAN popup used so existing
    // state.json files still work.
    neverBtn.addEventListener('click', async () => {
      state.realesrganFirstRunDismissed = true;
      markPopupSeen('optional-addons');
      try { await scheduleStateSave(); } catch (_) {}
      close();
    });

    // Real-ESRGAN: download (with progress) + open releases page + pick file.
    reDownload.addEventListener('click', async () => {
      reDownload.disabled = true; rePick.disabled = true; reOpenPage.disabled = true;
      reProgress.style.display = '';
      reProgress.style.color = 'var(--fg-2)';
      reProgress.textContent = 'Starting downloadâ€¦';
      const off = window.api.onRealesrganDownloadProgress((data) => {
        if (data.phase === 'download') {
          if (data.total > 0) {
            const pct = (data.downloaded / data.total) * 100;
            const mb = (data.downloaded / 1024 / 1024).toFixed(1);
            const totalMb = (data.total / 1024 / 1024).toFixed(1);
            reProgress.textContent = `Downloadingâ€¦ ${mb} / ${totalMb} MB (${pct.toFixed(0)}%)`;
          } else {
            reProgress.textContent = 'Downloadingâ€¦';
          }
        } else if (data.phase === 'extract') {
          reProgress.textContent = 'Extractingâ€¦';
        } else if (data.phase === 'done') {
          reProgress.textContent = 'Done. Refreshing statusâ€¦';
        }
      });
      try {
        const r = await window.api.realesrganDownload();
        off();
        if (r && r.ok) {
          reProgress.textContent = 'Installed to ' + (r.binDir || './bin') + '.';
          await refreshAll();
          state.realesrganFirstRunDismissed = true;
          try { await scheduleStateSave(); } catch (_) {}
        } else {
          reProgress.textContent = 'Download failed: ' + ((r && r.error) || 'unknown') +
            ' â€” try "Pick fileâ€¦" or "Open releases page" instead.';
          reProgress.style.color = 'var(--danger)';
        }
      } catch (e) {
        off();
        reProgress.textContent = 'Download failed: ' + (e && e.message || e) +
          ' â€” try "Pick fileâ€¦" or "Open releases page" instead.';
        reProgress.style.color = 'var(--danger)';
      } finally {
        reDownload.disabled = false; rePick.disabled = false; reOpenPage.disabled = false;
      }
    });
    reOpenPage.addEventListener('click', () => {
      window.api.installOpenUrl('https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0');
    });
    rePick.addEventListener('click', async () => {
      const r = await window.api.installPickAndCopy('realesrgan-binary');
      if (r && r.ok) {
        toast('Real-ESRGAN binary installed.', 'ok', 2500);
        await refreshAll();
      } else if (r && r.canceled) {
        // Silent â€” user just cancelled the dialog.
      } else {
        toast('Install failed: ' + ((r && r.error) || 'unknown'), 'err', 6000);
      }
    });

    // IS-Net binary: pick file (user built it from the README's C# ref) + open README.
    isBinPick.addEventListener('click', async () => {
      const r = await window.api.installPickAndCopy('isnetbg-binary');
      if (r && r.ok) {
        toast('isnetbg binary installed.', 'ok', 2500);
        await refreshAll();
      } else if (r && r.canceled) {
        // Silent.
      } else {
        toast('Install failed: ' + ((r && r.error) || 'unknown'), 'err', 6000);
      }
    });
    isBinOpenReadme.addEventListener('click', () => {
      // Open the upstream IS-Net project page (DIS on GitHub) â€”
      // the README there links to every current ONNX mirror +
      // a C# reference implementation the user can build their
      // isnetbg binary from. We don't try to ship a bundled
      // build script because the binary has to be compiled on
      // the user's machine (OS + ONNX runtime + ImageSharp),
      // and a one-click compile cross-platform from Electron
      // is its own can of worms.
      window.api.installOpenUrl('https://github.com/xuebinqin/DIS');
    });

    // IS-Net model: pick file + open HuggingFace mirror.
    isModelPick.addEventListener('click', async () => {
      const r = await window.api.installPickAndCopy('isnetbg-model');
      if (r && r.ok) {
        toast('isnet-general-use.onnx installed.', 'ok', 2500);
        await refreshAll();
      } else if (r && r.canceled) {
        // Silent.
      } else {
        toast('Install failed: ' + ((r && r.error) || 'unknown'), 'err', 6000);
      }
    });
    isModelOpenPage.addEventListener('click', () => {
      // The IS-Net ONNX model is hosted on several HuggingFace
      // mirrors. We open the DIS project README on GitHub
      // (which links to all current mirrors + a C# reference
      // implementation) instead of hard-coding a single mirror
      // that may go stale.
      window.api.installOpenUrl('https://github.com/xuebinqin/DIS');
    });
  });
}

// ----------------- Form helpers -----------------

// Build the "Target file prefix" input row. The same row is mounted on
// every tab (image/speech/music/video) but the value is global â€” when
// the user types in one tab, the other tabs' inputs are updated in
// place so they always show the same prefix. The prefix is prepended
// verbatim to the generated file's name in every gen handler (see
// image/speech/music/video .gen-btn click listeners). The value lives
// in state.filePrefix and is persisted to state.json via saveAllStates.
function buildFilePrefixRow() {
  const input = el('input', {
    type: 'text',
    class: 'file-prefix-input',
    value: state.filePrefix || '',
    placeholder: '(no prefix)',
  });
  // Keep the four mirrored inputs in sync and bump the autosave debounce
  // so the value lands in state.json within ~500ms of the last keystroke.
  input.addEventListener('input', () => {
    state.filePrefix = input.value;
    for (const other of document.querySelectorAll('input.file-prefix-input')) {
      if (other !== input) other.value = state.filePrefix;
    }
    scheduleStateSave();
  });
  // +1 button: scan the input value for the rightmost run of digits
  // and increment it by 1, padding with leading zeros to preserve
  // the original width. The rightmost match (not necessarily at the
  // end of the string) means the user can use prefixes like
  // "BildserieFÃ¼rSpiel_Reihe1_" and have the trailing series counter
  // bump. The regex `(\d+)(?=\D*$)` matches the last digit run that
  // is followed by zero or more non-digits to the end-of-string
  // anchor; e.g. for "Reihe10_v2" it matches "10", for "abc" nothing.
  // When no number is present we surface a hint toast rather than
  // silently doing nothing.
  const plusOneBtn = el('button', {
    class: 'btn-mini plus-one-btn',
    type: 'button',
    title: 'Increment the rightmost number in the prefix by 1',
  }, '+1');
  plusOneBtn.addEventListener('click', () => {
    const val = input.value;
    const match = val.match(/(\d+)(?=\D*$)/);
    if (!match) {
      toast('No number in the prefix to increment. Add a number (e.g. "..._Reihe1_") first.', 'warn', 3500);
      return;
    }
    const numStr = match[1];
    const num = parseInt(numStr, 10);
    const newNum = num + 1;
    // Keep the leading-zero padding so "001" â†’ "002", not "2".
    const newNumStr = String(newNum).padStart(numStr.length, '0');
    const newVal = val.substring(0, match.index) + newNumStr + val.substring(match.index + numStr.length);
    input.value = newVal;
    // Re-fire the input event so the four mirrored inputs across the
    // tabs stay in sync AND state.filePrefix + state.json are updated
    // (the input listener above does both).
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return el('div', { class: 'row file-prefix-row' }, [
    el('label', {}, [
      'Target file prefix',
      el('span', {
        class: 'help',
        'data-help': 'Prepended to every generated file name. Empty = original name. Example: prefix "ZYX" turns abc123.jpg into ZYXabc.jpg.',
        title: 'Prepended to every generated file name. Empty = original name. Example: prefix "ZYX" turns abc123.jpg into ZYXabc.jpg.',
      }, '?'),
    ]),
    input,
    plusOneBtn,
  ]);
}

// Build a "parameter row" with label, dropdown, optional help tooltip.
// `def = { kind, options, default, help, customType }`
//   kind: 'enum' | 'boolean' | 'text' | 'number' | 'enum-text' (enum with custom text override)
//   options: [{ value, label }]   value==='' means "off / default"
//   fileFilters (for kind:'text'): adds a Browse button with these filters
//   id: explicit DOM id (used for state save/load + cross-tab unique key)
function buildParamRow(label, def, id) {
  // Help icon: if def.help is a string, we use it as both the
  // 1-line hover summary (the original behaviour) and the
  // inline text in the help modal. If it's a key into the
  // central helpTopics map, we use the richer text from there.
  // Either way, the helpButton factory renders the same
  // clickable `?` icon so the user can read the full
  // explanation in a modal â€” the old `<span class="help">`
  // only had a tiny native title tooltip which most users
  // never read.
  const helpEl = def.help ? helpButton(def.help) : null;
  const lbl = el('label', {}, [label, helpEl].filter(Boolean));

  let input;
  const value = def.value ?? def.default ?? '';

  if (def.kind === 'boolean') {
    const sel = el('select', {});
    sel.appendChild(el('option', { value: 'off' }, 'Off'));
    sel.appendChild(el('option', { value: 'on' }, 'On'));
    sel.value = value ? 'on' : 'off';
    if (id) sel.id = id;
    input = sel;
  } else if (def.kind === 'number' || def.kind === 'enum-number') {
    const sel = el('select', {});
    for (const o of def.options) {
      sel.appendChild(el('option', { value: String(o.value) }, o.label ?? String(o.value)));
    }
    if (def.allowCustom !== false) {
      sel.appendChild(el('option', { value: '__custom__' }, 'Customâ€¦'));
    }
    const num = el('input', { type: 'number', value: def.customDefault ?? '', placeholder: 'value', min: def.min, max: def.max, step: def.step ?? 1 });
    num.style.display = 'none';
    const current = (def.options || []).find((o) => String(o.value) === String(value));
    if (current) sel.value = String(current.value);
    else if (value !== '' && value != null) { sel.value = '__custom__'; num.value = value; num.style.display = ''; }
    const combo = el('div', { class: 'combo' });
    if (sel.value === '__custom__') combo.classList.add('has-custom');
    sel.addEventListener('change', () => {
      num.style.display = sel.value === '__custom__' ? '' : 'none';
      combo.classList.toggle('has-custom', sel.value === '__custom__');
      if (sel.value !== '__custom__') num.value = '';
    });
    combo.append(sel, num);
    if (id) { sel.id = id + '.sel'; num.id = id + '.num'; }
    input = { el: combo, getValue: () => sel.value === '__custom__' ? num.value : sel.value, type: 'number' };
  } else if (def.kind === 'enum-text') {
    const sel = el('select', {});
    for (const o of def.options) {
      sel.appendChild(el('option', { value: String(o.value) }, o.label ?? String(o.value)));
    }
    if (def.allowCustom !== false) sel.appendChild(el('option', { value: '__custom__' }, 'Customâ€¦'));
    const txt = el('input', { type: 'text', value: def.customDefault ?? '', placeholder: 'custom value' });
    txt.style.display = 'none';
    const current = (def.options || []).find((o) => String(o.value) === String(value));
    if (current) sel.value = String(current.value);
    else if (value) { sel.value = '__custom__'; txt.value = value; txt.style.display = ''; }
    const combo = el('div', { class: 'combo' });
    if (sel.value === '__custom__') combo.classList.add('has-custom');
    sel.addEventListener('change', () => {
      txt.style.display = sel.value === '__custom__' ? '' : 'none';
      combo.classList.toggle('has-custom', sel.value === '__custom__');
    });
    combo.append(sel, txt);
    if (id) { sel.id = id + '.sel'; txt.id = id + '.txt'; }
    input = { el: combo, getValue: () => sel.value === '__custom__' ? txt.value : sel.value, type: 'text' };
  } else if (def.kind === 'text') {
    const inp = el('input', { type: 'text', value, placeholder: def.placeholder || '' });
    if (id) inp.id = id;
    if (def.fileFilters && def.fileFilters.length) {
      // File-picker text input with Browse button
      const browse = el('button', { class: 'btn-mini', type: 'button' }, 'Browseâ€¦');
      browse.addEventListener('click', async () => {
        const r = await window.api.pickFile({ title: def.browseTitle || 'Select file', filters: def.fileFilters });
        if (r.ok) { inp.value = r.path; inp.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      const combo = el('div', { class: 'combo' }, [inp, browse]);
      input = inp;  // raw element; arg builder uses inp.value
      const row = el('div', { class: 'row' }, [lbl, combo]);
      // Same top-level `.el` / `.getValue` aliases as the main
      // return below â€” see comment there for the rationale.
      return { row, input, el: inp, getValue: () => inp.value };
    }
    input = inp;
  } else if (def.kind === 'textarea') {
    input = el('textarea', {}, value);
    if (id) input.id = id;
  } else {
    // enum
    const sel = el('select', {});
    for (const o of def.options) {
      sel.appendChild(el('option', { value: String(o.value) }, o.label ?? String(o.value)));
    }
    sel.value = value ?? def.options?.[0]?.value ?? '';
    if (id) sel.id = id;
    input = sel;
  }

  const row = el('div', { class: 'row' }, [lbl, input.el || input]);
  // Expose `el` and `getValue` at the top level too. The legacy
  // return shape was `{ row, input }` only, but two call sites â€”
  // attachImageDimGuards() and attachSubjectRefGuard() in the
  // image tab's build() â€” read `width.el.addEventListener(...)`
  // and `subjRef.el` directly on the returned param. Without the
  // top-level aliases those read `undefined.el` and crashed
  // "Cannot read properties of undefined (reading
  // 'addEventListener')" on every startup. The `.input` property
  // is kept for backwards-compat with the existing call sites
  // that read `width.input.getValue()` and `subjRef.input.value`.
  const elAlias = input.el || input;
  const getValueAlias = input.getValue || (() => input.value);
  return { row, input, el: elAlias, getValue: getValueAlias };
}

// Extract the --flag from a param's enclosing .row label (e.g. "--model (hd)"
// â†’ "--model"). The flag is the first "--xxx" token in the label. Returns
// null if the row is unlabeled (e.g. prompt, lyrics textarea, variants row).
function _flagForParam(param) {
  if (!param) return null;
  const el = param.el || param;
  if (!el || !el.closest) return null;
  const row = el.closest('.row');
  if (!row) return null;
  const lbl = row.querySelector('label');
  if (!lbl) return null;
  const m = lbl.textContent && lbl.textContent.match(/--[a-zA-Z][a-zA-Z0-9-]*/);
  return m ? m[0] : null;
}

function appendFlag(args, param) {
  if (!param) return;
  const v = param.getValue ? param.getValue() : (param.value ?? param.el?.value);
  if (v == null || v === '' || v === 'off') return;
  const flag = param.flag || _flagForParam(param);
  if (!flag) {
    console.warn('[appendFlag] could not determine flag for param, skipping', param);
    return;
  }
  args.push(flag, String(v));
}
function appendBoolFlag(args, param, flag) {
  const v = param.getValue ? param.getValue() : param.value;
  if (v === 'on' || v === true) args.push(flag);
}

// ----------------- Image-dim guards -----------------
// Three live warnings below the image tab's W Ã— H row:
//   1. "W Ã— H doesn't match aspect ratio 1:1" â€” when the user
//      has an aspect ratio selected AND has manually entered both
//      W and H such that their ratio is off by more than 1%.
//      "Correct" auto-fills the offending dimension (W is the
//      source of truth, per the user's spec).
//   2. "W must be a multiple of 8" / "H must be a multiple of
//      8" â€” mmx rejects non-multiple-of-8 dimensions with a
//      cryptic 400. "Correct" rounds to the nearest multiple.
//   3. Same for the subject-ref field â€” it must be a valid
//      filesystem path or http(s) URL; mmx rejects everything
//      else.
//
// All three are wired to the param objects returned by
// buildParamRow() so they read the current value via getValue()
// and write back via the underlying input/select (which also
// fires 'input' / 'change' for the per-tab state autosave).
function attachImageDimGuards(aspect, width, height) {
  const warning = el('div', { class: 'image-dim-warning', style: 'display: none;' });
  // We insert the warning into the .section that owns the W Ã— H
  // row, right after the .grid. The caller is responsible for
  // appending the warning element to the right parent.
  // (We return the element so the caller can do that.)
  function setValue(param, v) {
    // Write a numeric value into a buildParamRow number param.
    // The combo (sel + num input) has a "Customâ€¦" option that
    // reveals the num input; we select it, set the value, and
    // dispatch the input event so has-custom class flips.
    const combo = param.el;
    const sel = combo.querySelector('select');
    const num = combo.querySelector('input[type="number"]');
    const options = Array.from(sel.options).map((o) => o.value);
    if (options.includes(String(v))) {
      sel.value = String(v);
      num.style.display = 'none';
      num.value = '';
    } else {
      sel.value = '__custom__';
      num.style.display = '';
      num.value = String(v);
    }
    combo.classList.toggle('has-custom', sel.value === '__custom__');
    num.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function show(text, onCorrect) {
    warning.innerHTML = '';
    const span = el('span', { style: 'flex: 1;' }, text);
    warning.appendChild(span);
    if (onCorrect) {
      const btn = el('button', { class: 'correct-btn', type: 'button' }, 'Correct');
      btn.addEventListener('click', onCorrect);
      warning.appendChild(btn);
    }
    warning.style.display = '';
  }
  function hide() {
    warning.style.display = 'none';
    warning.innerHTML = '';
  }
  function parseAspect(v) {
    if (!v) return null;
    const m = String(v).match(/^(\d+):(\d+)$/);
    if (!m) return null;
    return { w: parseInt(m[1], 10), h: parseInt(m[2], 10) };
  }
  function recheck() {
    const aspectVal = aspect.getValue();
    const w = parseInt(width.getValue(), 10);
    const h = parseInt(height.getValue(), 10);
    const ap = parseAspect(aspectVal);
    // 1. Aspect ratio mismatch.
    if (ap && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      const actual = w / h;
      const expected = ap.w / ap.h;
      // Allow 1% slop for float rounding.
      if (Math.abs(actual - expected) / expected > 0.01) {
        show(
          `W Ã— H (${w}Ã—${h}) doesn't match the selected aspect ratio ${aspectVal}. The API will likely reject this or auto-override one of the values.`,
          () => {
            // Prioritise W as the source of truth: H = W * ratio.
            const newH = Math.max(8, Math.round((w * ap.h) / ap.w / 8) * 8);
            setValue(height, newH);
            recheck();
          },
        );
        return;
      }
    }
    // 2. Divisible-by-8 checks.
    if (Number.isFinite(w) && w > 0 && w % 8 !== 0) {
      show(
        `W (${w}) must be a multiple of 8 (the API rejects other values with a 400).`,
        () => {
          setValue(width, Math.max(8, Math.round(w / 8) * 8));
          recheck();
        },
      );
      return;
    }
    if (Number.isFinite(h) && h > 0 && h % 8 !== 0) {
      show(
        `H (${h}) must be a multiple of 8 (the API rejects other values with a 400).`,
        () => {
          setValue(height, Math.max(8, Math.round(h / 8) * 8));
          recheck();
        },
      );
      return;
    }
    hide();
  }
  // Wire the listeners. buildParamRow number params are combos;
  // the 'input' event bubbles from the inner num input.
  width.el.addEventListener('input', recheck);
  width.el.addEventListener('change', recheck);
  height.el.addEventListener('input', recheck);
  height.el.addEventListener('change', recheck);
  // The aspect select lives in aspect.el directly.
  aspect.el.addEventListener('change', () => {
    // If the user picks a new aspect ratio, auto-fill whichever
    // of W or H is already set (or both, if both are empty, to
    // the first preset value that matches the aspect).
    const aspectVal = aspect.getValue();
    const ap = parseAspect(aspectVal);
    if (!ap) { recheck(); return; }
    const w = parseInt(width.getValue(), 10);
    const h = parseInt(height.getValue(), 10);
    if (Number.isFinite(w) && w > 0) {
      const newH = Math.max(8, Math.round((w * ap.h) / ap.w / 8) * 8);
      setValue(height, newH);
    } else if (Number.isFinite(h) && h > 0) {
      const newW = Math.max(8, Math.round((h * ap.w) / ap.h / 8) * 8);
      setValue(width, newW);
    }
    recheck();
  });
  // Initial pass â€” picks up restored state on first paint.
  recheck();
  return warning;
}

// Validate the --subject-ref value. mmx accepts:
//   - a local filesystem path that exists (PNG / JPG / JPEG / WebP)
//   - an http(s) URL (and seemingly URLs to a CDN)
//   - an empty string (no character ref)
// Everything else is rejected with a "file not found" or
// "invalid URL" 400. We watch the input and surface a warning
// when the value doesn't look like one of the above.
function attachSubjectRefGuard(subjRef) {
  const warning = el('div', { class: 'subject-ref-warning', style: 'display: none;' });
  const input = subjRef.el;
  function recheck() {
    const v = (input.value || '').trim();
    if (!v) { warning.style.display = 'none'; warning.innerHTML = ''; return; }
    if (/^https?:\/\//i.test(v)) { warning.style.display = 'none'; warning.innerHTML = ''; return; }
    // For local paths we can't easily async-check existence from
    // the renderer (no fs access in the renderer's main world),
    // and the renderer's fb:list already validates this on click.
    // We just sanity-check the shape: must look like a path and
    // have a recognised image extension.
    const looksLikePath = /[\\/]/.test(v) || /^[a-zA-Z]:[\\/]/.test(v) || v.startsWith('./') || v.startsWith('../') || v.startsWith('/') || /^[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+$/.test(v);
    if (!looksLikePath) {
      warning.innerHTML = '';
      warning.appendChild(el('span', { style: 'flex: 1;' },
        'Subject reference must be a local image path or an http(s) URL. Examples: C:\\Users\\me\\char.png  Â·  https://example.com/char.png'));
      warning.style.display = '';
      return;
    }
    const ext = v.toLowerCase().split('.').pop();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      warning.innerHTML = '';
      warning.appendChild(el('span', { style: 'flex: 1;' },
        `Subject reference must be a .png, .jpg, .jpeg or .webp file. Got: .${ext}`));
      warning.style.display = '';
      return;
    }
    warning.style.display = 'none';
    warning.innerHTML = '';
  }
  input.addEventListener('input', recheck);
  recheck();
  return warning;
}

// ----------------- Tabs -----------------
const TABS = {};

// ----------------- Per-model spec registry -----------------
// Single source of truth for what each model accepts. Each tab
// builds its form from one of these specs; the spec also drives
// per-row validation (max chars, max value, min value) and the
// "show only supported parameters" rule.
//
// The values below are pulled from the official MiniMax API
// documentation at https://platform.minimax.io/docs/api-reference/
// (image / video / music / speech tabs). Adding a new model
// here is the only change required — every parameter row in the
// corresponding tab consults this table to decide whether to be
// shown, what its max is, and how to format the help text.
//
// Schema for each entry:
//   prompt: { max: <chars>, help: <human-readable> }
//   supportedFlags: [<string>, ...] — only these --flags are sent.
//     Rows whose label doesn't appear here are NOT rendered.
//   perRowOverrides: optional map of flag → { max, min, step }
//     used by a few rows whose numeric range is tighter than the
//     generic input type definition.
//
// To verify a value is in range the renderer does TWO things:
//   1. The number <input> gets min/max attributes (already does).
//   2. Before mmx is called, validateAgainstSpec() re-checks every
//      row against the spec and short-circuits with a toast if
//      anything is out of range.
const MODEL_SPECS = {
  image: {
    label: 'Image generation',
    // Currently the API exposes image-01 + image-01-live. Both
    // accept the same parameter set; the help text for --model
    // explains the style difference.
    prompt: { max: 1500, help: 'Up to 1500 characters (hard limit).' },
    supportedFlags: [
      '--prompt',           // mandatory; the textarea above the parameters grid
      '--model',            // image-01 (default) / image-01-live
      '--aspect-ratio',     // 1:1 (default) / 16:9 / 9:16 / 4:3 / 3:4 / 2:3 / 3:2 / 21:9
      '--n',                // 1–9 (renderer clamps to 4)
      '--width',            // 512–2048 multiple of 8, image-01 only
      '--height',           // 512–2048 multiple of 8, image-01 only
      '--seed',             // 0 .. 2^31-1
      '--prompt-optimizer', // boolean
      '--aigc-watermark',   // boolean
      '--subject-reference-file', // image-01 + image-01-live
      '--subject-reference-type', // 'character' (only supported value)
    ],
    perRowOverrides: {
      '--aspect-ratio': { note: '21:9 is image-01 only — hidden on image-01-live.' },
    },
    imageExtra: {
      // (image-01-only) custom width/height; aspect-ratio is
      // overridden when both are set.
    },
  },
  speech: {
    label: 'Speech generation',
    prompt: { max: 10000, help: 'Up to 10 000 characters (hard limit).' },
    supportedFlags: [
      '--model',      // speech-2.8-hd / speech-2.8-turbo / speech-2.6-hd / speech-2.6-turbo / speech-02-hd / speech-02-turbo / speech-2.6 / speech-02
      '--voice',      // voice id (loaded from `mmx speech voices`)
      '--speed',      // 0.5–2.0, step 0.05, default 1.0
      '--volume',     // 0–10, step 1, default 0
      '--pitch',      // -12..+12 semitones, step 1, default 0
      '--format',     // mp3 / wav / pcm / flac / opus / pcmu_raw / pcmu_wav
      '--sample-rate',// 8000/16000/22050/24000/32000/44100/48000
      '--bitrate',    // 32000..320000
      '--channels',   // 1 / 2
      '--language',   // 2-letter code or 'auto' (voice-dependent)
      '--subtitles',  // boolean (saves .srt alongside audio)
      '--sound-effect',
      '--pronunciation', // from=to list
      '--emotion',    // happy/sad/angry/fearful/surprised/disgusted/neutral
      '--text',       // the textarea; mandatory
    ],
    perRowOverrides: {
      // speech-2.6 and below do NOT support --emotion. The
      // renderer hides the row when one of those models is
      // selected.
      '--emotion': {
        supportedForModels: new Set(['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo']),
        note: 'Emotion control is only available on the 2.6+ speech models.',
      },
      // --bitrate only applies to compressed formats (mp3 / opus).
      '--bitrate': {
        supportedForFormats: new Set(['mp3', 'opus']),
        note: 'Bitrate only affects MP3 / Opus; WAV / PCM / FLAC are lossless.',
      },
    },
  },
  music: {
    label: 'Music generation',
    prompt: { max: 2000, help: 'Up to 2 000 characters (hard limit).' },
    lyrics: { max: 3500, help: 'Up to 3 500 characters. Required unless is_instrumental or lyrics_optimizer is enabled.' },
    supportedFlags: [
      '--model',              // music-2.0 / music-2.5 / music-2.5+ / music-2.6
      '--prompt',             // mandatory, 10–2000 chars
      '--lyrics',             // 10–3000 chars (2.6 supports 3500); not needed for instrumental
      '--instrumental',       // boolean, music-2.5+ / music-2.6
      '--lyrics-optimizer',   // boolean (music-2.6)
      '--sample-rate',        // 8000/16000/22050/24000/32000/44100 (music-2.0 supports 8000)
      '--bitrate',            // 32000/64000/128000/256000
      '--format',             // mp3 (default) / wav / pcm
    ],
    perRowOverrides: {
      // music-2.0 does NOT support --instrumental, --lyrics, or
      // --lyrics-optimizer. music-2.5 supports --lyrics but not
      // --lyrics-optimizer. Only music-2.6 supports all three.
      '--instrumental': {
        supportedForModels: new Set(['music-2.5', 'music-2.5+', 'music-2.6']),
        note: 'Instrumental mode is supported on music-2.5 / 2.5+ / 2.6 only.',
      },
      '--lyrics-optimizer': {
        supportedForModels: new Set(['music-2.6']),
        note: 'Auto-lyrics is supported on music-2.6 only.',
      },
      '--lyrics': {
        // music-2.0 supports lyrics but the model often ignores
        // them. The renderer keeps the row visible but flags it.
        note: 'music-2.5 / 2.6 honor --lyrics reliably; music-2.0 may ignore them.',
      },
    },
  },
  video: {
    label: 'Video generation',
    prompt: { max: 2000, help: 'Up to 2 000 characters (hard limit).' },
    supportedFlags: [
      '--model',                   // MiniMax-Hailuo-2.3 / MiniMax-Hailuo-02 / S2V-01
      '--prompt',                  // mandatory, 1–2000 chars
      '--first-frame-image',       // image path or URL
      '--last-frame-image',        // image path or URL (Hailuo-02 only)
      '--subject-image',           // S2V-01 only
      '--duration',                // 6 (always) or 10 (768p only)
      '--resolution',              // 768p / 1080p (1080p = 6s only on 2.3 / 02)
      '--prompt-optimizer',        // boolean
      '--fast-pretreatment',       // boolean (Hailuo-2.3 + Hailuo-02)
    ],
    perRowOverrides: {
      '--first-frame-image': {
        supportedForModels: new Set(['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02']),
        note: 'MiniMax-Hailuo-2.3-Fast and MiniMax-Hailuo-02 require a first-frame image.',
      },
      '--last-frame-image': {
        supportedForModels: new Set(['MiniMax-Hailuo-02']),
        note: 'Last-frame image is supported on MiniMax-Hailuo-02 only (first+last frame interpolation).',
      },
      '--subject-image': {
        supportedForModels: new Set(['S2V-01']),
        note: 'Subject-image (face reference) is supported on S2V-01 only.',
      },
      '--duration': {
        // 10 s is only available at 768P. The renderer drops the
        // 10 option from the dropdown when 1080P is selected.
        dependsOnResolution: true,
        note: '10-second duration is only available at 768P.',
      },
      '--resolution': {
        allowedForModels: {
          'MiniMax-Hailuo-2.3':       new Set(['768P', '1080P']),
          'MiniMax-Hailuo-2.3-Fast': new Set(['768P']),     // fast model only supports 768p
          'MiniMax-Hailuo-02':       new Set(['768P', '1080P']),
          'S2V-01':                  new Set(['768P']),     // S2V-01 only 768p
        },
        note: 'MiniMax-Hailuo-2.3-Fast and S2V-01 only support 768P.',
      },
      '--fast-pretreatment': {
        supportedForModels: new Set(['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02']),
        note: 'Fast-pretreatment is supported on Hailuo-2.3 (+Fast) and Hailuo-02.',
      },
    },
  },
};

// Look up the per-model override for a row. Returns null if
// the row is generally supported for the tab but has no
// per-model restriction. Used by buildParamRow (to decide
// whether to render the row at all) and by the gen handler
// (to short-circuit before the request is sent).
function getRowSpec(tabKey, flag, currentModel, currentResolution) {
  const tab = MODEL_SPECS[tabKey];
  if (!tab || !tab.perRowOverrides) return null;
  const ov = tab.perRowOverrides[flag];
  if (!ov) return null;
  // Resolution-dependent rows: pick the option that matches
  // the current resolution dropdown value (used for the
  // video tab's --duration row, where the 10s option is
  // only valid at 768P).
  if (ov.dependsOnResolution && currentResolution && ov.resolutionOverrides) {
    return ov.resolutionOverrides[currentResolution] || ov;
  }
  return ov;
}

// Decide whether a flag should be visible for the currently
// selected model / resolution. A flag is hidden if:
//   - the model's perRowOverrides lists a supportedForModels set
//     and the current model is NOT in that set, OR
//   - the flag is registered as model-restricted (no override
//     = always visible).
//
// This is the implementation of "show only supported parameters".
function isFlagVisibleForCurrentModel(tabKey, flag, currentModel, currentResolution) {
  const ov = getRowSpec(tabKey, flag, currentModel, currentResolution);
  if (!ov) return true;
  if (ov.supportedForModels && currentModel) {
    return ov.supportedForModels.has(currentModel);
  }
  return true;
}

// Validate every value in the per-tab state against the spec.
// Returns an array of error strings (empty = OK). Called by the
// gen handler right before the request is sent so the user never
// gets a cryptic 400 from the API.
function validateTabAgainstSpec(tabKey, params, currentModel, currentResolution) {
  const errs = [];
  const tab = MODEL_SPECS[tabKey];
  if (!tab) return errs;
  for (const flag of tab.supportedFlags || []) {
    const param = params && params[flag];
    if (!param) continue;
    const v = param.getValue ? param.getValue() : (param.value ?? param.el?.value);
    if (v == null || v === '' || v === 'off') continue;
    // Skip flags that aren't visible for the current model.
    if (!isFlagVisibleForCurrentModel(tabKey, flag, currentModel, currentResolution)) {
      errs.push(`${flag} is not supported on ${currentModel}. Switch models or hide this row.`);
      continue;
    }
    // Number range checks (only meaningful for numeric rows;
    // the buildParamRow already sets HTML min/max attributes
    // for native validation, but we re-check here so the
    // user sees a precise toast instead of a silent clamp).
    if (typeof v === 'number' || (typeof v === 'string' && /^-?\d/.test(v))) {
      const ov = tab.perRowOverrides && tab.perRowOverrides[flag];
      if (ov && ov.max != null && Number(v) > ov.max) {
        errs.push(`${flag} = ${v} exceeds max ${ov.max} for ${currentModel || 'this model'}.`);
      }
      if (ov && ov.min != null && Number(v) < ov.min) {
        errs.push(`${flag} = ${v} below min ${ov.min} for ${currentModel || 'this model'}.`);
      }
    }
    // Prompt max length (the textarea above the parameters
    // grid; the counter already colours itself red when over).
    if (flag === '--prompt' && tab.prompt && tab.prompt.max) {
      const len = String(v).length;
      if (len > tab.prompt.max) {
        errs.push(`Prompt is ${len} characters; max for ${tab.label} is ${tab.prompt.max}.`);
      }
    }
    if (flag === '--lyrics' && tab.lyrics && tab.lyrics.max) {
      const len = String(v).length;
      if (len > tab.lyrics.max) {
        errs.push(`Lyrics is ${len} characters; max for ${currentModel || 'this model'} is ${tab.lyrics.max}.`);
      }
    }
  }
  return errs;
}

// ----------------- Prompt character counter -----------------
// Builds a small "X / 2000" counter for the --prompt argument. The API
// limit is on the --prompt VALUE only (not the entire command line), so
// we count exactly what would be sent in the --prompt argument:
//   extraPrefix + styleText + manual
function computePromptSize(selEl, manualEl, extraPrefix = '') {
  const selVal = selEl ? selEl.value : '';
  const manual = manualEl ? manualEl.value.trim() : '';
  const styleText = getStyleText(selVal);
  return (extraPrefix + styleText + manual).length;
}
function buildPromptCounter({ selEl, manualEl, getExtraPrefix = () => '', max = 2000, id = '' }) {
  const lbl = el('span', { class: 'prompt-counter-label' }, 'Prompt length:');
  const val = el('span', { class: 'prompt-counter-val' }, '0');
  const maxEl = el('span', { class: 'prompt-counter-max' }, ` / ${max}`);
  const wrap = el('div', { class: 'prompt-counter', id: id ? `counter-${id}` : '' }, [lbl, val, maxEl]);
  const update = () => {
    const extra = getExtraPrefix() || '';
    const n = computePromptSize(selEl, manualEl, extra);
    val.textContent = String(n);
    wrap.classList.toggle('warn', n > max * 0.9 && n <= max);
    wrap.classList.toggle('err', n > max);
  };
  if (selEl) selEl.addEventListener('change', update);
  if (manualEl) manualEl.addEventListener('input', update);
  // Initial
  update();
  return { wrap, update };
}

// ----------------- Variants dropdown -----------------
// "Variants" = run the same generation N times (each becomes a separate
// output file). Disabled when a seed is set (would produce identical
// results, wasting API quota). The disabled handler is run initially and
// after every change to the seed control.
function buildVariantsRow({ id, seedInput = null, defaultN = 1, label = '--variants' } = {}) {
  const sel = el('select', { class: 'variants-select', id: id || 'variants' });
  for (let i = 1; i <= 5; i++) {
    sel.appendChild(el('option', { value: String(i) }, `${i}Ã—`));
  }
  sel.value = String(defaultN);
  const lbl = el('label', { class: 'variants-label' }, [
    label,
    el('span', { class: 'help', 'data-help': 'Run this generation N times in a row. Each variant gets its own file. Disabled when a seed is set (all variants would be identical).', title: 'Run this generation N times in a row. Each variant gets its own file. Disabled when a seed is set (all variants would be identical).' }, '?'),
  ]);
  const row = el('div', { class: 'row variants-row' }, [lbl, sel]);
  // seedInput can be:
  //   - a raw element with .value
  //   - the result of buildParamRow: { row, input: { el, getValue, type } }
  //   - the input portion of that: { el, getValue, type }
  const seedEl = seedInput && (seedInput.input ? seedInput.input.el : (seedInput.el || seedInput));
  const readSeed = () => {
    if (!seedInput) return '';
    if (seedInput.input && typeof seedInput.input.getValue === 'function') return seedInput.input.getValue();
    if (typeof seedInput.getValue === 'function') return seedInput.getValue();
    return (seedEl && seedEl.value) || '';
  };
  const updateDisabled = () => {
    if (!seedInput) return;
    const v = readSeed();
    const seeded = String(v) !== '' && String(v) !== 'undefined';
    sel.disabled = seeded;
    if (seeded) sel.title = 'Disabled: a fixed seed would produce identical variants';
    else sel.title = '';
  };
  if (seedEl) {
    seedEl.addEventListener('change', updateDisabled);
    seedEl.addEventListener('input', updateDisabled);
    updateDisabled();
  }
  return { row, sel, updateDisabled };
}

function showTab(name) {
  // Save the current fbDir into the slot for the tab we're leaving so we
  // can restore it on the next visit (per-tab folder persistence).
  const prev = state.currentTab;
  if (prev && state.fbDir) state.fbDirs[prev] = state.fbDir;

  state.currentTab = name;
  // Restore the saved folder for the tab we're entering. refreshBrowser
  // will pick it up via state.fbDirs[currentTab].
  const saved = state.fbDirs[name];
  if (saved) state.fbDir = saved;
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of $$('.tabpanel')) p.classList.toggle('active', p.id === `tab-${name}`);
  // Refresh file browser to the matching subfolder if present
  refreshBrowser().catch(() => {});
  // Switching into a tab clears the green "finished" indicator for that tab
  // (the user has effectively seen the result by opening the tab). Red
  // "running" indicators must remain visible.
  if (state.genStatus[name] === 'done') state.genStatus[name] = 'idle';
  refreshTabStatusDots();
  // Persist current tab selection
  scheduleStateSave();
  // First-time intro popup for the tab. Gated by the same popup
  // policy as the startup / first-time-setup popups, so the user
  // can flip "never" in âš™ Settings â†’ Popups to silence every
  // intro popup in one go. The popup id is `tab-intro:<name>` so
  // each tab's intro is independently dismissable.
  maybeShowTabIntro(name);
}

// ----------------- Tab intro popups -----------------
// A short, friendly "what's this tab about" popup shown the first
// time the user opens each tab. Gated by the popup policy in
// state.popupPolicy (configured in âš™ Settings â†’ Popups). The popup
// is rendered with the same showModal() primitive so it gets the
// full Esc/click-outside/stack behaviour. The default text is short
// on purpose: the detailed field-level help is still available via
// the `?` icons on every input.
function maybeShowTabIntro(tabName) {
  const intros = {
    image:  'ðŸ–¼ Image tab â€” describe what you want to generate in the prompt, tweak the model + aspect + variants, then click Generate. Enable the Upscale / Optimize toggle to run a local pipeline after the API returns.',
    speech: 'ðŸ—£ Speech tab â€” type or paste the text, pick a voice, then click Generate. Use the â–¶ button next to each voice to hear a quick preview. The output is an MP3 (or your chosen format) saved to the folder browser on the right.',
    music:  'ðŸŽµ Music tab â€” describe the music you want (genre, mood, instruments, tempo). Toggle "Instrumental only" to skip vocals. Each click of Generate produces one short track and writes it to the folder browser.',
    video:  'ðŸŽ¬ Video tab â€” describe the short video you want, pick the model + resolution + duration, then click Generate. Note: Token Plan keys allow only 3 video generations per week; pay-as-you-go (PAYG) keys are billed per video with no weekly cap. Each video takes a few minutes to render.',
  };
  const text = intros[tabName];
  if (!text) return;
  openGatedPopup('tab-intro:' + tabName, (m, close, markSeen) => {
    m.classList.add('tab-intro-modal');
    const titles = { image: 'Image', speech: 'Speech', music: 'Music', video: 'Video' };
    m.appendChild(el('h2', {}, 'ðŸ‘‹ Welcome to the ' + (titles[tabName] || tabName) + ' tab'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 13px; line-height: 1.55;' }, text));
    m.appendChild(el('p', { style: 'color: var(--fg-3); font-size: 11px;' },
      'You can disable these intro popups in âš™ Settings â†’ Popups.'));
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { class: 'primary', onclick: () => { markSeen(); close(); } }, 'Got it'),
    ]));
    setTimeout(() => { m.querySelector('button.primary')?.focus(); }, 0);
  });
}

// Update the colored status dots on the tab buttons. The rules are:
//   - genStatus === 'running'  â†’ red dot
//   - genStatus === 'done' and tab !== currentTab â†’ green dot
//   - genStatus === 'done' and tab === currentTab â†’ no dot (the user has
//     effectively "seen" the result by switching into the tab)
//   - genStatus === 'idle'     â†’ no dot
function refreshTabStatusDots() {
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const t = $(`.tab[data-tab="${tabKey}"]`);
    if (!t) continue;
    // Remove any prior dot
    t.classList.remove('tab-dot-red', 'tab-dot-green');
    const st = state.genStatus[tabKey] || 'idle';
    if (st === 'running') t.classList.add('tab-dot-red');
    else if (st === 'done' && state.currentTab !== tabKey) t.classList.add('tab-dot-green');
  }
  refreshTabEtas();
}

// Per-tab ETA timer. While a generation is running, show a small mm:ss
// countdown next to the tab label, based on the average time of the last
// successful generation in that tab. For batch runs (variants, --n > 1),
// the countdown reflects the TOTAL remaining time for all items in the
// queue (current item + future items). As each item completes, the
// running average is updated and the ETA is recomputed on the next
// 1-second tick. The countdown is an estimate, not a guarantee â€” but it
// gives the user a sense of how long the current call will still take.
function refreshTabEtas() {
  for (const tabKey of ['image', 'speech', 'music', 'video']) {
    const t = $(`.tab[data-tab="${tabKey}"]`);
    if (!t) continue;
    // Lazily create the eta span the first time we need it.
    let eta = t.querySelector('.tab-eta');
    if (!eta) {
      eta = el('span', { class: 'tab-eta' }, '');
      t.appendChild(eta);
    }
    eta.textContent = _formatTabEta(tabKey);
  }
}
function _formatTabEta(tabKey) {
  const status = state.genStatus[tabKey];
  if (status !== 'running') return '';
  const start = state.genStartMs && state.genStartMs[tabKey];
  if (!start) return '...';
  // Use the running average if we have one; otherwise a sensible per-tab
  // default so the user always sees an estimate even on the very first
  // generation. (If they only see "...", the timer looks broken.)
  let avg = (state.genAvgSec && state.genAvgSec[tabKey]) || 0;
  if (!avg) {
    const defaults = { image: 35, speech: 12, music: 75, video: 90 };
    avg = defaults[tabKey] || 30;
  }
  // Total queue size for the current run (variants Ã— n, where n is the
  // --n count). When the gen handler kicks off, it sets
  // state.genQueueSize[tabKey] and increments state.genQueueDone[tabKey]
  // after each completed item. -1 for "the item currently in flight".
  const queueSize = Math.max(1, (state.genQueueSize && state.genQueueSize[tabKey]) || 1);
  const queueDone = Math.max(0, (state.genQueueDone && state.genQueueDone[tabKey]) || 0);
  const itemsLeft = Math.max(1, queueSize - queueDone);
  // How much of the CURRENT item is still pending. When the user just
  // kicked off the run, genStartMs is the start of the whole run (not
  // the current item), so we approximate per-item elapsed as
  // (now - runStart) / itemsLeft. This is a slight underestimate for
  // the first few items (a long first item pushes the per-item avg up),
  // but it's the best we can do without per-item timestamps and it
  // self-corrects as soon as the first item finishes. Clamp to [0, avg]
  // so a race condition (e.g. startMs=0 right after arm) can't produce
  // a negative remaining time.
  const runElapsed = Math.max(0, (Date.now() - start) / 1000);
  const rawPerItem = runElapsed / itemsLeft;
  const currentItemElapsed = Math.max(0, Math.min(avg, rawPerItem));
  const currentItemRemaining = Math.max(0, avg - currentItemElapsed);
  const futureItems = Math.max(0, itemsLeft - 1);
  const futureTime = futureItems * avg;
  const totalRemaining = currentItemRemaining + futureTime;
  // If the user just kicked off the run and genQueueSize hasn't been
  // written yet (race during the first tick), itemsLeft === 1 so we
  // fall back to the old "remaining for the current item only" math.
  const remaining = Math.max(0, Math.round(totalRemaining));
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `- ${m}:${String(s).padStart(2, '0')}`;
}
// Update the ETA once a second while a tab is running. Cheap text update â€”
// the tab has only 4 instances.
let _etaTimer = null;
function ensureEtaTimer() {
  if (_etaTimer) return;
  _etaTimer = setInterval(() => {
    let anyRunning = false;
    for (const k of ['image', 'speech', 'music', 'video']) {
      if (state.genStatus[k] === 'running') { anyRunning = true; break; }
    }
    if (!anyRunning) {
      clearInterval(_etaTimer);
      _etaTimer = null;
      // Clear the ETA labels one last time.
      for (const k of ['image', 'speech', 'music', 'video']) {
        const t = $(`.tab[data-tab="${k}"]`);
        if (!t) continue;
        const eta = t.querySelector('.tab-eta');
        if (eta) eta.textContent = '';
      }
      return;
    }
    refreshTabEtas();
  }, 1000);
}

// ----------------- Style dropdown refresh -----------------
// Refresh every open style-preset dropdown so the new list of styles is
// immediately reflected after add/edit/delete â€” without requiring the user
// to switch tabs. Implemented as a class query so detached dropdowns
// (from rebuilt tabs) are automatically ignored.
function _refreshAllStyleDropdowns() {
  for (const sel of document.querySelectorAll('select.style-select')) {
    // Skip if the select is no longer in the document
    if (!sel.isConnected) continue;
    const cur = sel.value;
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '' }, '(no style)'));
    for (const s of (state.config.styles || [])) {
      const opt = el('option', { value: s.name }, s.name);
      if (s.value && s.value.length > 60) opt.title = s.value;
      sel.appendChild(opt);
    }
    // Try to preserve the current selection
    if (cur && (state.config.styles || []).some((s) => s.name === cur)) sel.value = cur;
  }
}

// ----------------- IMAGE TAB -----------------
TABS.image = {
  prefilled: 'a cyberpunk city night scene in 16:9',
  build() {
    const root = $('#tab-image');
    root.innerHTML = '';

    // Prompt
    const prompt = buildParamRow('Prompt (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'The description of the image to generate. Sent as --prompt. Max 1500 characters.' });
    const styleRow = buildStyleRow('image', 'Select a style preset. Its value is prepended (with a comma) to your manual prompt before the request is sent.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview._previewEl, selEl: styleRow.sel, manualEl: prompt.input };
    const updatePreview = () => updateStylePreview(tabState);
    styleRow.sel.addEventListener('change', updatePreview);
    prompt.input.addEventListener('input', updatePreview);
    updatePreview();
    // mmx image API hard limit is 1500 chars on --prompt; counter goes red above.
    const counter = buildPromptCounter({ selEl: styleRow.sel, manualEl: prompt.input, max: 1500, id: 'image' });
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Prompt'),
      styleRow.row,
      prompt.row,
      stylePreview,
      counter.wrap,
    ]));

    // Parameters
    const model = buildParamRow('--model', {
      kind: 'enum', default: 'image-01',
      options: [
        { value: 'image-01', label: 'image-01 (default â€” general purpose)' },
        { value: 'image-01-live', label: 'image-01-live (hand-drawn, cartoon, style control)' },
      ],
      help: 'Image generation model.\n\nimage-01 (default):\n  â€¢ General-purpose text-to-image\n  â€¢ Aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4, 2:3, 3:2, 21:9\n  â€¢ Custom width/height: 512-2048 px (multiple of 8)\n  â€¢ --subject-ref, --prompt-optimizer, --aigc-watermark, --seed\n\nimage-01-live:\n  â€¢ Hand-drawn / cartoon / stylized outputs\n  â€¢ Finer style control\n  â€¢ Same flags as image-01',
    });
    const aspect = buildParamRow('--aspect-ratio', {
      kind: 'enum', default: '',
      options: [
        { value: '', label: '(default — let the model pick)' },
        { value: '1:1', label: '1:1 â€” square' },
        { value: '16:9', label: '16:9 â€” widescreen' },
        { value: '9:16', label: '9:16 â€” portrait / phone' },
        { value: '4:3', label: '4:3 â€” classic' },
        { value: '3:4', label: '3:4 â€” portrait classic' },
        { value: '2:3', label: '2:3 â€” photo portrait' },
        { value: '3:2', label: '3:2 â€” photo landscape' },
        { value: '21:9', label: '21:9 â€” ultrawide / cinematic' },
      ],
      help: 'Output aspect ratio. The default (empty) lets the model pick its own ratio (image-01 falls back to 1:1). Ignored if you set both --width and --height. The 21:9 ultrawide option is image-01 only.',
    });
    const n = buildParamRow('--n (count)', {
      kind: 'number', default: 1, min: 1, max: 4, customDefault: 1, step: 1,
      options: [1, 2, 3, 4].map((v) => ({ value: v, label: String(v) })),
      help: 'How many images to generate in one call.',
    });
    const width = buildParamRow('--width (px)', {
      kind: 'number', default: '', min: 512, max: 2048, step: 8,
      options: [
        { value: '', label: '(unset)' },
        { value: 768, label: '768' },
        { value: 1024, label: '1024' },
        { value: 1280, label: '1280' },
        { value: 1536, label: '1536' },
        { value: 1792, label: '1792' },
        { value: 1920, label: '1920' },
        { value: 2048, label: '2048' },
      ],
      help: 'Pixel width (512â€“2048, multiple of 8). Overrides --aspect-ratio when paired with --height. image-01 only.',
    });
    const height = buildParamRow('--height (px)', {
      kind: 'number', default: '', min: 512, max: 2048, step: 8,
      options: [
        { value: '', label: '(unset)' },
        { value: 768, label: '768' },
        { value: 1024, label: '1024' },
        { value: 1280, label: '1280' },
        { value: 1536, label: '1536' },
        { value: 1792, label: '1792' },
        { value: 1080, label: '1080' },
        { value: 2048, label: '2048' },
      ],
      help: 'Pixel height (512â€“2048, multiple of 8). Overrides --aspect-ratio when paired with --width. image-01 only.',
    });
    const seed = buildParamRow('--seed', {
      kind: 'number', default: '', min: 0, max: 2_147_483_647, step: 1,
      options: [
        { value: '', label: 'Random' },
        { value: 0, label: '0' },
        { value: 1, label: '1' },
        { value: 42, label: '42' },
        { value: 12345, label: '12345' },
        { value: 1337, label: '1337' },
        { value: 9999, label: '9999' },
      ],
      help: 'Random seed for reproducible generation. Same seed + prompt = identical output.',
    });
    const promptOpt = buildParamRow('--prompt-optimizer', {
      kind: 'boolean', default: false, help: 'Let the model rewrite your prompt for better results.',
    });
    const watermark = buildParamRow('--aigc-watermark', {
      kind: 'boolean', default: false, help: 'Embed an AI-generated content watermark into the output image.',
    });
    const subjRef = buildParamRow('--subject-ref', {
      kind: 'text', default: '',
      placeholder: 'Path or URL to character image',
      fileFilters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select character reference image',
      help: 'Character consistency reference.\nFormat: type=character,image=<value>\nYou can also paste a public URL (https://...).\nSupported formats: PNG, JPG, JPEG, WebP.',
    });
    const respFmt = buildParamRow('--response-format', {
      kind: 'enum', default: 'url',
      options: [
        { value: 'url', label: 'url (CDN, downloaded to disk)' },
        { value: 'base64', label: 'base64 (no CDN)' },
      ],
      help: 'How the image bytes come back. base64 bypasses the CDN.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      buildFilePrefixRow(),
      el('div', { class: 'grid' }, [aspect.row, n.row, width.row, height.row, seed.row, respFmt.row, promptOpt.row, watermark.row, subjRef.row]),
      // Live validity warnings for the W Ã— H combo and the subject
      // ref field. attachImageDimGuards wires the aspect/W/H
      // listeners (auto-fill on aspect change, ratio-mismatch
      // warning, div-by-8 warning) and returns the warning div
      // for the .section. attachSubjectRefGuard does the same for
      // the --subject-ref field (must be a path or http(s) URL
      // with a recognised image extension). Both are hidden when
      // the inputs are valid.
      attachImageDimGuards(aspect, width, height),
      attachSubjectRefGuard(subjRef),
    ]));

    // Action bar + preview
    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    // Upscale checkbox: when on, every generated image is upscaled locally
    // after generation using the saved settings. Clicking the label
    // (or the box) opens the settings overlay.
    const upscaleCb = el('input', { type: 'checkbox', title: 'Upscale the generated image after creation' });
    const upscaleLabel = el('label', { class: 'upscale-checkbox', title: 'Click to configure upscale settings' });
    const upscaleMult = el('span', { class: 'upscale-mult' }, '');
    upscaleLabel.append(upscaleCb, 'ðŸ” Upscale', upscaleMult);
    // Reflect persisted state
    if (state.upscaleEnabled) upscaleCb.checked = true;
    function refreshUpscaleCheckboxUI() {
      const m = (state.upscaleSettings && state.upscaleSettings.multiplier) || 2;
      upscaleMult.textContent = state.upscaleEnabled ? ` (${m}Ã—)` : '';
      upscaleLabel.classList.toggle('active', !!state.upscaleEnabled);
    }
    refreshUpscaleCheckboxUI();
    upscaleLabel.addEventListener('click', (e) => {
      // Only open the settings overlay when the user clicks the label
      // text (not the input itself â€” clicking the input toggles it).
      if (e.target === upscaleCb) return; // let the input toggle
      e.preventDefault();
      showUpscaleSettings();
    });
    upscaleCb.addEventListener('change', async () => {
      state.upscaleEnabled = !!upscaleCb.checked;
      if (state.upscaleEnabled && !state.upscaleSettings) {
        state.upscaleSettings = { multiplier: 2 };
      }
      refreshUpscaleCheckboxUI();
      await scheduleStateSave();
    });
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'image', class: 'batch-controls' });
    // Variants dropdown (image tab: disabled when seed is set)
    const variants = buildVariantsRow({ id: 'variants-image', seedInput: seed });
    actions.append(buildAddToBatchBtn('image'), genBtn, upscaleLabel, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No image generated yet.'));

    // Sticky footer: actions + preview stay visible while the rest of the
    // tab scrolls. CSS uses position: sticky on .tab-footer.
    // Tab footer: the preview area goes ABOVE the actions row so
    // the Generate / +Add / batch controls sit at the very bottom
    // of the tab. The user asked to move them down so there is
    // no visible "scrolling content behind a small area below
    // them" — the fix is to keep the actions row as the LAST
    // element in the sticky footer. The preview is still sticky-
    // attached to the actions row via the tab-footer flex column.
    const tabFooter = el('div', { class: 'tab-footer' }, [preview, actions]);
    root.appendChild(tabFooter);

    // ---- Generate handler ----
    genBtn.addEventListener('click', async () => {
      // Re-entrancy guard: another generation is in progress. The cancel
      // click handler (added by armGenBtnWithCancel) will run for clicks
      // that should cancel instead.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const promptText = buildFinalPrompt(styleRow.sel, prompt.input);
      if (!promptText) { toast('Prompt is required (style or manual input).', 'warn'); return; }
      // Pre-flight: validate every visible parameter against the
      // MODEL_SPECS registry. We do this BEFORE building argv so
      // the user sees a precise "X exceeds max Y" toast instead of
      // a cryptic 400 from the API. The registry also tells us
      // which rows are supported on the selected model — a flag
      // that's been left over from a different model would otherwise
      // be sent verbatim and rejected by the backend.
      const imageParams = {
        '--prompt': prompt.input,
        '--model': model.input,
        '--aspect-ratio': aspect.input,
        '--n': n.input,
        '--width': width.input,
        '--height': height.input,
        '--seed': seed.input,
        '--prompt-optimizer': promptOpt.input,
        '--aigc-watermark': watermark.input,
        '--subject-reference-file': subjRef.input,
      };
      const preErrs = validateTabAgainstSpec('image', imageParams, model.input.getValue(), null);
      if (preErrs.length) {
        for (const e of preErrs) toast(e, 'err', 6000);
        return;
      }
      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      const seedVal = seed.input.getValue();
      const seedLocked = String(seedVal) !== '' && variantsCount > 1;
      if (seedLocked) {
        // Defensive: shouldn't happen since the dropdown is disabled, but just in case
        toast('Variants are disabled while a fixed seed is set (would produce identical images).', 'warn');
        return;
      }
      let outDir;
      try { outDir = await ensureSubDir('image'); }
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
      const slug = slugify(promptText).slice(0, 60) || 'image';
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      // Log a "generation started" event up front so the user
      // sees one row per click in the new structured log pane,
      // and so the "completed" / "failed" events below can be
      // read as part of the same group. We use the prompt text
      // (truncated) as the headline; the full prompt stays
      // available in the expand-on-click details.
      const promptShort = (promptText || '').replace(/\s+/g, ' ').slice(0, 120);
      const genStartEvId = addLogEvent({
        category: 'gen',
        headline: `Image generation started: ${promptShort}${promptText && promptText.length > 120 ? 'â€¦' : ''}`,
        details: [
          `Variants: ${variantsCount}`,
          `Seed: ${seedVal === '' ? '(random)' : String(seedVal)}`,
          `Aspect: ${aspect.input.getValue() || '(default)'}`,
          `Model: ${model.input.getValue() || '(default)'}`,
          `Reference: ${subjRef.input.value && subjRef.input.value.trim() ? subjRef.input.value.trim() : '(none)'}`,
        ],
      });
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      // outFiles tracks every image file we know about after generation
      // completes. For variants without --out-dir, each variant produces
      // one known file we push here. For --out-dir, the per-call output
      // files are unknown at gen time, so we scan the directory at the
      // end of the loop (see resolveOutDirFiles). After the upscale +
      // crop step, the original file is replaced by the upscaled (and
      // optionally cropped) one â€” we update the list in place.
      const outFiles = [];
      // lastFailedR captures the most recent failed mmxRun result so the
      // error UI (preview + toast) can surface its full details, including
      // the classified type and a copy-paste blob for support.
      let lastFailedR = null;
      let threw = null;
      // The mmx CLI rejects `--out` when `--n > 1` ("--out cannot be used with
      // --n > 1. Use --out-dir instead."). When the user requested multiple
      // images via the --n (count) dropdown, we omit --out and let mmx write
      // numbered files into outDir.
      const nRaw = n.input.getValue();
      const nCount = nRaw === '' || nRaw == null ? 1 : Math.max(1, parseInt(String(nRaw), 10) || 1);
      const useOutDir = nCount > 1;
      // Total images this run will produce. The per-tab ETA timer reads
      // this from state.genQueueSize[tabKey] to compute a "remaining
      // time for the whole batch" estimate that ticks down as each
      // variant completes.
      const totalImages = variantsCount * nCount;
      if (!state.genQueueSize) state.genQueueSize = { image: 0, speech: 0, music: 0, video: 0 };
      if (!state.genQueueDone) state.genQueueDone = { image: 0, speech: 0, music: 0, video: 0 };
      state.genQueueSize.image = totalImages;
      state.genQueueDone.image = 0;
      // Validate width/height pairing once (would otherwise warn on every variant).
      const wv0 = width.input.getValue();
      const hv0 = height.input.getValue();
      if ((wv0 && !hv0) || (!wv0 && hv0)) {
        toast('Width and height must both be set (or both unset). Width/height ignored.', 'warn');
      }
      // Build the argv once and reuse it across variant attempts â€” the prompt
      // and parameters don't change between retries.
      function buildImageArgs() {
        const args = ['image', 'generate'];
        args.push('--prompt', promptText);
        appendFlag(args, model.input);
        appendFlag(args, aspect.input);
        appendFlag(args, n.input);
        if (wv0 && hv0) { args.push('--width', String(wv0)); args.push('--height', String(hv0)); }
        if (String(seedVal) !== '') args.push('--seed', String(seedVal));
        appendBoolFlag(args, promptOpt.input, '--prompt-optimizer');
        appendBoolFlag(args, watermark.input, '--aigc-watermark');
        if (subjRef.input.value && subjRef.input.value.trim()) {
          args.push('--subject-ref', `type=character,image=${subjRef.input.value.trim()}`);
        }
        appendFlag(args, respFmt.input);
        if (useOutDir) {
          args.push('--out-dir', outDir);
        }
        return args;
      }
      // Returns the resolved outFile for this variant (or outDir when --out-dir).
      function makeOutPath(v) {
        if (useOutDir) return outDir;
        const ts = timestamp();
        const variantTag = variantsCount > 1 ? `_v${v}` : '';
        const prefix = (state.filePrefix || '').trim();
        return uniquePath(outDir, `${prefix}${ts}_${slug}${variantTag}.png`);
      }
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          // Small breather between variants to avoid hitting the mmx rate
          // limiter (especially right after a failed call).
          if (v > 1) await new Promise((r) => setTimeout(r, 800));
          if (cancel.wasCancelled()) break;

          // Build the per-variant argv. The base args are identical except
          // for --out, which gets a unique filename per variant.
          const baseArgs = buildImageArgs();
          const outFile = makeOutPath(v);
          const args = baseArgs.slice();
          if (!useOutDir) args.push('--out', outFile);
          lastCmd.textContent = maskLine(`mmx ${args.join(' ')}`, state.config && state.config.api_key);

          // Per-variant start time. We use this (not the whole-run start
          // time) to update the per-item average as each item finishes,
          // so the ETA ticks down more accurately as the run progresses.
          const itemStart = Date.now();
          const statusMsg = variantsCount > 1
            ? `Generating imageâ€¦ variant ${v}/${variantsCount}`
            : (useOutDir ? `Generating imageâ€¦ (${nCount} images to ${outDir})` : 'Generating imageâ€¦');
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;

          // Try the call, then retry up to 3 times with exponential backoff
          // on transient errors. The "API error: system error (HTTP 200)"
          // pattern we see in the field is almost always a backend hiccup
          // that succeeds on retry. We also detect rate-limit messages and
          // wait longer for those.
          let r = await window.api.mmxRun(args);
          if (!r.ok && !cancel.wasCancelled()) {
            const firstMsg = formatMmxError(r);
            const isRateLimit = /rate|limit|throttl|too many|429/i.test(firstMsg);
            const maxRetries = 3;
            for (let attempt = 1; attempt <= maxRetries && !cancel.wasCancelled(); attempt++) {
              // Exponential backoff: 1.5s, 3s, 6s (Ã—2 if rate-limited)
              const baseDelay = 1500 * Math.pow(2, attempt - 1);
              const delay = isRateLimit ? baseDelay * 2 : baseDelay;
              await new Promise((res) => setTimeout(res, delay));
              if (cancel.wasCancelled()) break;
              setStatus(`Retrying image variant ${v}/${variantsCount} (attempt ${attempt + 1}/${maxRetries + 1})â€¦`, true);
              preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(`Retrying variant ${v}/${variantsCount} (attempt ${attempt + 1})â€¦`)}</div>`;
              r = await window.api.mmxRun(args);
              if (r.ok) {
                toast(`Image variant ${v}/${variantsCount} succeeded on retry ${attempt}.`, 'ok', 2500);
                break;
              }
            }
            if (!r.ok) toast(`Image variant ${v}/${variantsCount} failed after ${maxRetries + 1} attempts: ${firstMsg}`, 'err', 6000);
          }
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            // Mark this variant as failed but continue with the next one so
            // the user gets the remaining variants (e.g. 1, 2 OK, 3 failed,
            // 4, 5 still attempted). We also expose a "Retry" button so the
            // user can manually re-attempt this exact variant.
            allOk = false;
            lastFailedR = r;
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}). Continuing with next variantâ€¦</div><div class="meta">${escapeHtml(formatMmxError(r))}</div>`;
            // Advance the queue counter even on failure so the ETA
            // doesn't keep counting this variant as "still in flight"
            // for the rest of the run. Failed variants still consume
            // wall-clock time, so we add their elapsed time to the
            // per-item average (so the ETA reflects the real pace of
            // the call, not just the successful ones â€” otherwise a
            // string of slow failures would under-estimate the time
            // for the remaining variants).
            const failDur = (Date.now() - itemStart) / 1000;
            if (!state.genAvgSec) state.genAvgSec = {};
            const prevAvgFail = state.genAvgSec.image || 0;
            state.genAvgSec.image = prevAvgFail === 0 ? failDur : (prevAvgFail * 0.6 + failDur * 0.4);
            state.genQueueDone.image = (state.genQueueDone.image || 0) + nCount;
            refreshTabEtas();
            continue;
          }
          // Update the per-item average so the ETA improves with each
          // completion. The previous version only updated the avg in
          // armGenBtnWithCancel's cleanup (i.e. once at the end of the
          // whole run), so for a 5-variant batch the ETA stayed pinned
          // to the default for the first 4 items.
          const itemDur = (Date.now() - itemStart) / 1000;
          if (!state.genAvgSec) state.genAvgSec = {};
          const prevAvg = state.genAvgSec.image || 0;
          state.genAvgSec.image = prevAvg === 0 ? itemDur : (prevAvg * 0.6 + itemDur * 0.4);
          // Each mmx call with --n > 1 produces nCount images, so
          // queueDone advances by nCount for those calls. For single
          // images (useOutDir=false) it's 1.
          state.genQueueDone.image = (state.genQueueDone.image || 0) + nCount;
          refreshTabEtas();
          lastPreview = r.parsed;
          lastOutFile = outFile;
          if (!useOutDir) outFiles.push(outFile);
          // Live-update the folder explorer + preview pane. The
          // gen handler knows the output path for non-(--out-dir)
          // runs, so we don't have to wait for the 1s polling
          // to discover the file â€” the UI reacts on the same
          // tick the file is written. The polling is still
          // running in the background as a safety net for the
          // --out-dir case (and for the post-processed upscaled
          // / cropped / no-bg / optimised files the gen handler
          // creates after the raw mmx call returns). Idempotent
          // â€” calling it with the same path twice is a no-op.
          if (!useOutDir) {
            try { notifyImageGenerated(outFile); } catch (_) {}
            // Add the blink class to the row for the CSS animation.
            // We use a microtask so the row exists in the DOM
            // (the folder explorer was re-rendered by
            // startGenPolling's tick on the previous second, or
            // by the user's last refresh). If the row isn't there
            // yet, the next polling tick will add the class.
            queueMicrotask(() => {
              const row = document.querySelector(`.fb-item[data-path="${CSS.escape(outFile)}"]`);
              if (row) row.classList.add('fb-item-new');
            });
          }
        }
        // Post-processing INSIDE the try block â€” the previous layout ran
        // the upscale + crop + background-removal AFTER the finally, which
        // meant cancel.cleanup() had already restored the Generate button
        // to its idle state and cleared state.generating. The post-
        // processing then ran for several seconds under a "Generate"
        // button that the user could click again, racing the still-
        // running upscale and â€” when they did â€” the new click would
        // arm another cancel handler while the old run's pending
        // promises leaked. Now the button stays as "Cancel" and the
        // state.generating guard stays set until every post-processing
        // step has completed, matching what the UI promises.
        if (allOk && lastOutFile && !cancel.wasCancelled()) {
        // Resolve the full list of output files. For --out-dir runs
        // (--n > 1), the per-call filenames are not known to the
        // renderer (mmx writes them with its own naming scheme), so
        // we scan outDir for files that were created during this
        // run. We use the run start time + a small 1.5s pre-roll as
        // the lower bound, and "now" as the upper bound. For single-
        // file runs (useOutDir=false), we already have the file list
        // from the variant loop in `outFiles`.
        let sourceFiles = outFiles.slice();
        if (useOutDir) {
          try {
            const dirList = await window.api.fbList(outDir);
            if (dirList && dirList.ok && Array.isArray(dirList.items)) {
              const startMs = (state.genStartMs && state.genStartMs.image) || (Date.now() - 600000);
              const nowMs = Date.now();
              const matches = dirList.items
                .filter((it) => !it.isDir && ['.png', '.jpg', '.jpeg', '.webp'].includes(it.ext))
                .filter((it) => {
                  const m = it.mtimeMs || 0;
                  return m >= startMs - 1500 && m <= nowMs + 5000;
                })
                .sort((a, b) => (a.mtimeMs || 0) - (b.mtimeMs || 0));
              if (matches.length) sourceFiles = matches.map((m) => m.path);
            }
          } catch (_) { /* fall back to whatever we have */ }
        }
        // Post-processing chain: for EVERY generated file (not just
        // the last one â€” that was the bug fixed in this revision),
        // run the upscale â†’ crop â†’ remove-background â†’ optimize chain
        // and collect the final paths. Each step is independently
        // non-fatal: a failure on variant N keeps the original file
        // for variant N and continues with the next one, so the user
        // never loses an image they paid API credits to generate.
        const displayFiles = [];
        const postProcessEach = state.upscaleEnabled
          || state.removeBackgroundEnabled
          || (state.optimizeSettings && state.optimizeSettings.enabled);
        const lastIdx = sourceFiles.length - 1;
        for (let i = 0; i < sourceFiles.length; i++) {
          if (cancel.wasCancelled()) {
            // Cancel mid-chain: any files we haven't processed yet
            // stay as their raw generated path. The files we have
            // processed stay as their processed paths.
            for (let j = i; j < sourceFiles.length; j++) {
              if (!displayFiles.includes(sourceFiles[j])) displayFiles.push(sourceFiles[j]);
            }
            break;
          }
          const src = sourceFiles[i];
          const tag = sourceFiles.length > 1 ? ` (${i + 1}/${sourceFiles.length})` : '';
          try {
            if (postProcessEach) {
              const finalPath = await runPostProcessChain(src, {
                label: tag,
                onStatus: (msg) => {
                  setStatus(msg, true);
                  preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(msg)}</div>`;
                },
                onRefresh: () => { try { refreshBrowser(); } catch (_) {} },
              });
              displayFiles.push(finalPath);
            } else {
              displayFiles.push(src);
            }
          } catch (e) {
            // runPostProcessChain is supposed to swallow per-step
            // errors and return the best-available path, so we only
            // land here on a truly unexpected throw. Be defensive:
            // fall back to the source file so the user still gets
            // the raw generated image in the preview pane.
            console.error('Post-process failed for', src, e);
            displayFiles.push(src);
          }
          // Refresh the folder browser once per processed file so
          // the new (upscaled / no-bg / optimised) files appear in
          // the right-hand file list as soon as they're written.
          // Cheap, and the user explicitly asked for live updates
          // during batchgen (see feature #6).
          if (i === lastIdx) {
            try { await refreshBrowser(); } catch (_) {}
          }
        }
        // The last entry of displayFiles is the most recently
        // processed path â€” treat it as the canonical "last preview"
        // for legacy callers (toast messages that reference it, the
        // preview-ready message at the end, etc.). For a single-
        // file run, this is the same file as the raw generated
        // output (or its post-processed replacement).
        const displayFile = displayFiles.length ? displayFiles[displayFiles.length - 1] : lastOutFile;
        // The image tab's left-side preview no longer shows the
        // generated image â€” per the user's request, the picture
        // preview lives in the right-side folder-explorer's preview
        // pane (which subdivides into N thumbnails for N images).
        // The left-side area only carries a short status line so the
        // layout doesn't collapse but the prompt / parameter inputs
        // are no longer obscured.
        preview.innerHTML = '';
        // v1.1.1 polish: include a "â†» Regenerate" button on the
        // success state so the user can re-run the same prompt
        // with one click instead of scrolling up to the Generate
        // button. Power users iterate a lot on the same prompt
        // (e.g. trying different aspect ratios, switching the
        // seed off, etc.) and this is the single biggest workflow
        // improvement we can make to the success state.
        const readyWrap = el('div', { class: 'empty' });
        const readyMsg = el('div', { class: 'preview-ready-msg' }, [
          'âœ… ',
          String(displayFiles.length),
          (displayFiles.length === 1 ? ' image' : ' images'),
          ' ready â€” see the preview pane on the right. Click any thumbnail to open it at 1:1.',
        ]);
        const regenBtn = el('button', { class: 'btn-mini preview-regen-btn', type: 'button' }, 'â†» Regenerate');
        regenBtn.title = 'Re-run the same prompt (no changes to inputs)';
        regenBtn.addEventListener('click', () => { try { genBtn.click(); } catch (_) {} });
        readyWrap.appendChild(readyMsg);
        readyWrap.appendChild(el('div', { class: 'preview-ready-actions' }, [regenBtn]));
        preview.appendChild(readyWrap);
        try { previewImagesFromFiles(displayFiles); } catch (_) {}
        bumpGenerationCounter('image', totalImages);
        // Log a "generation completed" event so the user has
        // a single row to copy / expand that summarises the
        // run. The full file list is in the details (one per
        // line) so the user can paste it into a support
        // ticket.
        addLogEvent({
          category: 'gen',
          result: 'ok',
          headline: `Generated ${displayFiles.length} image${displayFiles.length === 1 ? '' : 's'}`,
          details: displayFiles.map((p) => 'â€¢ ' + p),
        });
      } else if (!allOk) {
        // Log a "generation failed" event so the user can copy
        // the structured error from the log pane (e.g. into a
        // support ticket). The full classified error message +
        // stderr / stdout are included in the details so the
        // helper doesn't have to ask the user "what did it
        // say?".
        try {
          const failedMsg = formatMmxError(lastFailedR || { stderr: '', stdout: '', code: -1 });
          const failedClass = classifyMmxError(lastFailedR || {}, failedMsg);
          addLogEvent({
            category: 'error',
            result: 'err',
            headline: `Image generation failed: ${failedMsg}`,
            details: [
              `Classification: ${failedClass}`,
              `Stderr: ${(lastFailedR && lastFailedR.stderr) || '(empty)'}`,
              `Stdout: ${(lastFailedR && lastFailedR.stdout) || '(empty)'}`,
              `Exit code: ${(lastFailedR && lastFailedR.code) != null ? String(lastFailedR.code) : '(unknown)'}`,
            ],
          });
        } catch (_) { /* never block the rest of the error UI on log */ }
        // Build a detailed, actionable error block. The user has been
        // hitting "API error: system error (HTTP 200)" which is opaque â€”
        // we now classify the error (auth, rate, quota, network, server,
        // unknown) and show targeted tips + buttons to diagnose / retry /
        // copy the raw error for support.
        const lastErrMsg = formatMmxError(lastFailedR || { stderr: '', stdout: '', code: -1 });
        const classification = classifyMmxError(lastFailedR || {}, lastErrMsg);
        const tips = {
          auth: [
            'Your API key may be invalid, expired, or revoked.',
            'Click "Test connection" below to verify.',
            'Re-paste your key in âš™ Settings if needed.',
          ],
          rate: [
            'The service is rate-limiting your account.',
            'Wait 30â€“60 seconds, then click Retry.',
            'Avoid running many batches back-to-back.',
          ],
          quota: [
            'Your Token Plan quota is exhausted for this model.',
            'Wait for the rolling window to reset, or upgrade your plan.',
            'Check the âš¡ quota display in the top bar.',
          ],
          network: [
            'Could not reach the service (DNS / firewall / offline).',
            'Verify your internet connection and any VPN / proxy settings.',
            'Click "Diagnose" below to check the installation.',
          ],
          server: [
            'The service returned a server-side error. Usually transient.',
            'Wait a few seconds and click Retry.',
            'If it persists, the service may be degraded â€” try again later.',
          ],
          unknown: [
            'The service returned an unrecognised error.',
            'Click "Copy error" to share the details with support.',
            'Click "Diagnose" to verify the mmx installation.',
          ],
        };
        const tipList = tips[classification] || tips.unknown;
        preview.innerHTML = '';
        const wrap = el('div', { class: 'empty preview-error' });
        wrap.appendChild(el('div', { class: 'preview-error-title' }, 'âš  Generation failed'));
        const detail = el('div', { class: 'preview-error-message' });
        detail.textContent = lastErrMsg || 'Unknown error (see log pane for details).';
        wrap.appendChild(detail);
        // Classified troubleshooting tips
        const tipsBlock = el('div', { class: 'preview-error-tips' });
        for (const t of tipList) {
          const li = el('div', { class: 'preview-error-tip' }, 'â€¢ ' + t);
          tipsBlock.appendChild(li);
        }
        wrap.appendChild(tipsBlock);
        // Action buttons: Retry / Test connection / Diagnose / Copy error
        const retryBtn = el('button', { class: 'primary' }, 'ðŸ”„ Retry');
        const testBtn = el('button', { class: 'btn-mini' }, 'ðŸ”‘ Test connection');
        const diagBtn = el('button', { class: 'btn-mini' }, 'ðŸ©º Diagnose');
        const copyBtn = el('button', { class: 'btn-mini' }, 'ðŸ“‹ Copy error');
        retryBtn.addEventListener('click', () => genBtn.click());
        testBtn.addEventListener('click', async () => {
          testBtn.disabled = true; testBtn.textContent = 'Testingâ€¦';
          const r = await window.api.authStatus();
          testBtn.disabled = false; testBtn.textContent = 'ðŸ”‘ Test connection';
          if (r.ok) {
            toast(r.message || 'API key is valid.', 'ok', 4000);
          } else {
            toast('Auth failed: ' + (r.error || 'unknown'), 'err', 6000);
          }
        });
        diagBtn.addEventListener('click', () => showDiagnose());
        copyBtn.addEventListener('click', async () => {
          const blob = JSON.stringify({
            classification,
            message: lastErrMsg,
            code: lastFailedR?.code,
            stderr: (lastFailedR?.stderr || '').slice(0, 4000),
            stdout: (lastFailedR?.stdout || '').slice(0, 4000),
            parsed: lastFailedR?.parsed,
            ts: new Date().toISOString(),
          }, null, 2);
          try {
            await navigator.clipboard.writeText(blob);
            toast('Error details copied to clipboard.', 'ok', 1500);
          } catch (_) {
            // Fallback: just toast the message
            toast('Clipboard unavailable â€” error: ' + lastErrMsg, 'warn', 6000);
          }
        });
        const actions = el('div', { class: 'preview-error-actions' }, [retryBtn, testBtn, diagBtn, copyBtn]);
        wrap.appendChild(actions);
        preview.appendChild(wrap);
        // Also surface a short toast
        const shortMsg = classification === 'auth'
          ? 'Auth failed. Click Test connection.'
          : classification === 'rate'
            ? 'Rate limited. Wait 30s and Retry.'
            : classification === 'quota'
              ? 'Quota exhausted.'
              : 'Generation failed. See preview for details.';
        toast(shortMsg, 'warn', 4000);
      }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Image generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        cancel.cleanup();
        setStatus('Ready', false);
        // Always refresh â€” even on cancel/failure, partial files may exist
        // on disk and the user should see them.
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Image generated. ${variantsCount} variants saved.`
          : 'Image generated.', 'ok');
      }
    });
  },
};

// ----------------- SPEECH TAB -----------------
TABS.speech = {
  prefilled: 'Welcome to MiniMax â€” Token Plan or PAYG, both work here.',
  build() {
    const root = $('#tab-speech');
    root.innerHTML = '';

    const text = buildParamRow('Text to read (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'What the voice will say. Up to 10 000 characters across all models.' });
    const styleRow = buildStyleRow('speech', 'Select a style preset. Its value is prepended (with a comma) to your text before the request is sent. Useful for narration tone, language hints, etc.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview._previewEl, selEl: styleRow.sel, manualEl: text.input };
    const update = () => updateStylePreview(tabState);
    styleRow.sel.addEventListener('change', update);
    text.input.addEventListener('input', update);
    update();
    // Speech API actually accepts up to 10 000 chars, but we still show the
    // same counter pattern so the user has a constant reference.
    const counter = buildPromptCounter({ selEl: styleRow.sel, manualEl: text.input, max: 10000, id: 'speech' });
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Text'),
      styleRow.row,
      text.row,
      stylePreview,
      counter.wrap,
    ]));

    const model = buildParamRow('--model', {
      kind: 'enum', default: 'speech-2.8-hd',
      options: [
        { value: 'speech-2.8-hd', label: 'speech-2.8-hd (newest, best quality â€” default)' },
        { value: 'speech-2.8-turbo', label: 'speech-2.8-turbo (faster, lower latency)' },
        { value: 'speech-2.6-hd', label: 'speech-2.6-hd' },
        { value: 'speech-2.6-turbo', label: 'speech-2.6-turbo' },
        { value: 'speech-02-hd', label: 'speech-02-hd' },
        { value: 'speech-02-turbo', label: 'speech-02-turbo' },
        { value: 'speech-2.6', label: 'speech-2.6 (legacy)' },
        { value: 'speech-02', label: 'speech-02 (legacy)' },
      ],
      help: 'Text-to-speech model.\n\nspeech-2.8-hd (default): Newest, best audio quality, supports sound tags.\nspeech-2.8-turbo: Same quality tier but lower latency.\nspeech-2.6-hd / 2.6-turbo: Previous generation, still high quality.\nspeech-02-hd / 02-turbo: Older generation, 24 languages.\nLegacy 2.6 / 02: Use only if you hit issues with 2.8.\n\nAll models: up to 10 000 chars input, --speed / --volume / --pitch supported.',
    });
    const voice = buildParamRow('--voice', {
      kind: 'enum', default: 'English_expressive_narrator',
      options: [{ value: 'English_expressive_narrator', label: 'English_expressive_narrator (default)' }],
      help: 'Which voice speaks. 300+ voices available â€” list loaded from `mmx speech voices`.',
    });
    const speed = buildParamRow('--speed', {
      kind: 'number', default: 1.0, step: 0.05,
      options: [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0].map((v) => ({ value: v, label: String(v) })),
      help: 'Playback speed multiplier. 1.0 = normal.',
    });
    const volume = buildParamRow('--volume', {
      kind: 'number', default: 1, min: 0, max: 10, step: 1,
      options: [0, 1, 2, 3, 5, 7, 10].map((v) => ({ value: v, label: String(v) })),
      help: 'Volume level 0 (silent) â€“ 10 (loudest).',
    });
    const pitch = buildParamRow('--pitch', {
      kind: 'number', default: 0, min: -12, max: 12, step: 1,
      options: [-12, -6, -3, 0, 3, 6, 12].map((v) => ({ value: v, label: String(v) })),
      help: 'Pitch shift in semitones. 0 = no change.',
    });
    const format = buildParamRow('--format', {
      kind: 'enum', default: 'mp3',
      options: [
        { value: 'mp3', label: 'mp3 (default)' },
        { value: 'wav', label: 'wav' },
        { value: 'pcm', label: 'pcm' },
        { value: 'flac', label: 'flac' },
        { value: 'opus', label: 'opus' },
        { value: 'pcmu_raw', label: 'pcmu_raw' },
        { value: 'pcmu_wav', label: 'pcmu_wav' },
      ],
      help: 'Output audio container.',
    });
    const sampleRate = buildParamRow('--sample-rate', {
      kind: 'number', default: 32000, step: 1000,
      options: [8000, 16000, 22050, 24000, 32000, 44100, 48000].map((v) => ({ value: v, label: String(v) })),
      help: 'Sample rate in Hz.',
    });
    const bitrate = buildParamRow('--bitrate', {
      kind: 'number', default: 128000, step: 1000,
      options: [32000, 64000, 96000, 128000, 192000, 256000, 320000].map((v) => ({ value: v, label: String(v) })),
      help: 'Bitrate in bits/second.',
    });
    const channels = buildParamRow('--channels', {
      kind: 'enum', default: 1,
      options: [{ value: 1, label: '1 (mono)' }, { value: 2, label: '2 (stereo)' }],
      help: 'Number of audio channels.',
    });
    const language = buildParamRow('--language (boost)', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(none)' },
        { value: 'auto', label: 'auto' },
        { value: 'en', label: 'en' },
        { value: 'zh', label: 'zh' },
        { value: 'ja', label: 'ja' },
        { value: 'ko', label: 'ko' },
        { value: 'es', label: 'es' },
        { value: 'fr', label: 'fr' },
        { value: 'de', label: 'de' },
        { value: 'pt', label: 'pt' },
        { value: 'ru', label: 'ru' },
        { value: 'it', label: 'it' },
        { value: 'ar', label: 'ar' },
        { value: 'hi', label: 'hi' },
      ],
      help: 'Boost recognition for a specific language code (e.g. "en", "zh").',
    });
    const subtitles = buildParamRow('--subtitles', {
      kind: 'boolean', default: false, help: 'Also save an .srt subtitle file alongside the audio.',
    });
    const soundEffect = buildParamRow('--sound-effect', {
      kind: 'enum-text', default: '',
      options: [{ value: '', label: '(none)' }],
      help: 'Optional background sound effect (model-dependent).',
    });
    const pronunciation = buildParamRow('--pronunciation (repeatable)', {
      kind: 'text', default: '', help: 'Custom pronunciation rule in the form from=to. Add multiple via comma.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      el('div', { class: 'grid' }, [
        model.row, voice.row,
        speed.row, volume.row,
        pitch.row, format.row,
        sampleRate.row, bitrate.row,
        channels.row, language.row,
        subtitles.row, soundEffect.row,
        pronunciation.row,
      ]),
    ]));

    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'speech', class: 'batch-controls' });
    // Variants dropdown (speech tab has no seed, so always enabled)
    const variants = buildVariantsRow({ id: 'variants-speech' });
    actions.append(buildAddToBatchBtn('speech'), genBtn, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No audio generated yet.'));
    // Preview ABOVE the actions row so the Generate / +Add buttons
    // sit at the very bottom of the tab. See the image tab's
    // tabFooter comment for the rationale.
    const tabFooter = el('div', { class: 'tab-footer' }, [preview, actions]);
    root.appendChild(tabFooter);

    // Populate voices list
    this.populateVoices(voice.input).catch(() => {});

    genBtn.addEventListener('click', async () => {
      // Re-entrancy guard: another generation is in progress.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const txt = text.input.value.trim();
      if (!txt) { toast('Text is required.', 'warn'); return; }
      // Pre-flight: validate visible parameters against MODEL_SPECS.
      // --emotion only exists on 2.6+ speech models; the row is
      // hidden in the form via isFlagVisibleForCurrentModel, but
      // an old saved value could still be set when the user
      // switches models — we strip it here so the API never
      // receives an unsupported flag.
      const speechParams = {
        '--text': text.input,
        '--model': model.input,
        '--voice': voice.input,
        '--speed': speed.input,
        '--volume': volume.input,
        '--pitch': pitch.input,
        '--format': format.input,
        '--sample-rate': sampleRate.input,
        '--bitrate': bitrate.input,
        '--channels': channels.input,
        '--language': language.input,
        '--subtitles': subtitles.input,
        '--sound-effect': soundEffect.input,
        '--pronunciation': pronunciation.input,
        '--emotion': emotion && emotion.input ? emotion.input : null,
      };
      const speechModel = model.input.getValue();
      const speechErrs = [];
      for (const k of Object.keys(speechParams)) {
        if (!speechParams[k]) { delete speechParams[k]; continue; }
      }
      const preErrs = validateTabAgainstSpec('speech', speechParams, speechModel, null);
      if (preErrs.length) {
        for (const e of preErrs) toast(e, 'err', 6000);
        return;
      }
      // Speech-specific gate: --bitrate only matters when the
      // output format is a lossy codec (mp3 / opus). The spec
      // table's perRowOverrides flags this so we suppress a
      // useless --bitrate send when the user picked WAV / PCM /
      // FLAC, otherwise the API may reject it or ignore it
      // silently.
      const speechFormat = (format.input.value || 'mp3').split('_')[0];
      if (!['mp3', 'opus'].includes(speechFormat)) {
        // Clear the value so appendFlag skips it (we keep the
        // dropdown visible because the spec is "always show,
        // greyed when irrelevant").
        bitrate.input.value = '';
      }
      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      let outDir;
      try { outDir = await ensureSubDir('speech'); }
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
      const slug = slugify(txt).slice(0, 60) || 'speech';
      const ext = (format.input.value || 'mp3').split('_')[0];
      // Total assets this run will produce. The per-tab ETA timer reads
      // this from state.genQueueSize[tabKey] to compute a "remaining
      // time for the whole batch" estimate that ticks down as each
      // variant completes.
      if (!state.genQueueSize) state.genQueueSize = { image: 0, speech: 0, music: 0, video: 0 };
      if (!state.genQueueDone) state.genQueueDone = { image: 0, speech: 0, music: 0, video: 0 };
      state.genQueueSize.speech = variantsCount;
      state.genQueueDone.speech = 0;
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      let threw = null;
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          const itemStart = Date.now();
          const args = ['speech', 'synthesize'];
          args.push('--text', txt);
          appendFlag(args, model.input);
          appendFlag(args, voice.input);
          appendFlag(args, speed.input);
          appendFlag(args, volume.input);
          appendFlag(args, pitch.input);
          appendFlag(args, format.input);
          appendFlag(args, sampleRate.input);
          appendFlag(args, bitrate.input);
          appendFlag(args, channels.input);
          if (language.input.getValue()) args.push('--language', String(language.input.getValue()));
          appendBoolFlag(args, subtitles.input, '--subtitles');
          if (soundEffect.input.getValue()) args.push('--sound-effect', String(soundEffect.input.getValue()));
          if (pronunciation.input.value && pronunciation.input.value.trim()) {
            for (const rule of pronunciation.input.value.split(',').map(s => s.trim()).filter(Boolean)) {
              args.push('--pronunciation', rule);
            }
          }
          const ts = timestamp();
          const variantTag = variantsCount > 1 ? `_v${v}` : '';
          const prefix = (state.filePrefix || '').trim();
          const outFile = uniquePath(outDir, `${prefix}${ts}_${slug}${variantTag}.${ext}`);
          args.push('--out', outFile);
          lastCmd.textContent = maskLine(`mmx ${args.join(' ')}`, state.config && state.config.api_key);
          const statusMsg = variantsCount > 1
            ? `Generating speechâ€¦ variant ${v}/${variantsCount}`
            : 'Generating speechâ€¦';
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;
          const r = await window.api.mmxRun(args);
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            const msg = formatMmxError(r);
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast('Speech generation failed: ' + msg, 'err', 6000);
            allOk = false;
            break;
          }
          // Update the per-item average + advance the queue counter so
          // the ETA ticks down per item. See the image-tab comment
          // for the full rationale.
          const itemDur = (Date.now() - itemStart) / 1000;
          if (!state.genAvgSec) state.genAvgSec = {};
          const prevAvg = state.genAvgSec.speech || 0;
          state.genAvgSec.speech = prevAvg === 0 ? itemDur : (prevAvg * 0.6 + itemDur * 0.4);
          state.genQueueDone.speech = (state.genQueueDone.speech || 0) + 1;
          refreshTabEtas();
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Speech generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        cancel.cleanup();
        setStatus('Ready', false);
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk && lastOutFile) {
        showAudioPreview(preview, lastOutFile, lastPreview);
        bumpGenerationCounter('speech', variantsCount);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Speech generated. ${variantsCount} variants saved.`
          : 'Speech generated.', 'ok');
      }
    });
  },
  async populateVoices(sel) {
    if (state.voicesLoaded) { fillVoices(sel, state.voices); return; }
    const v = await window.api.voices();
    if (Array.isArray(v) && v.length) {
      state.voices = v; state.voicesLoaded = true;
      fillVoices(sel, v);
    }
  },
};

function fillVoices(sel, voices) {
  const current = sel.value;
  sel.innerHTML = '';
  for (const v of voices) sel.appendChild(el('option', { value: v }, v));
  if (voices.includes(current)) sel.value = current;
}

// ----------------- MUSIC TAB -----------------
TABS.music = {
  prefilled: 'calm piano melody, 15 seconds',
  build() {
    const root = $('#tab-music');
    root.innerHTML = '';

    const prompt = buildParamRow('Music prompt (prefilled, editable)',
      { kind: 'textarea', value: this.prefilled, help: 'Describe the music: genre, mood, instruments, tempo, length (e.g. "30 seconds", "2 minutes"). The most up-to-date model (music-2.6) supports up to about 6 minutes. Max 2 000 characters.' });
    const styleRow = buildStyleRow('music', 'Select a style preset. Its value is prepended (with a comma) to your music prompt before the request is sent. Use it for repeated genre/mood tags.');
    const stylePreview = buildStylePreviewBlock();
    const tabState = { previewEl: stylePreview._previewEl, selEl: styleRow.sel, manualEl: prompt.input };
    // extraPrefix is filled in AFTER the vocal-mode `mode` row is defined below.
    let extraPrefix = () => '';
    const updatePreview = () => updateStylePreview(tabState, extraPrefix());
    styleRow.sel.addEventListener('change', updatePreview);
    prompt.input.addEventListener('input', updatePreview);
    updatePreview();
    // Character counter for the --prompt argument value.
    // NOTE: extraPrefix is a `let` that gets REASSIGNED below (after `mode`
    // and `instrumental` are defined). Passing it directly would freeze the
    // counter to the initial empty function. Wrap it so the counter always
    // reads the current extraPrefix value.
    const counter = buildPromptCounter({
      selEl: styleRow.sel,
      manualEl: prompt.input,
      getExtraPrefix: () => extraPrefix(),
      id: 'music',
    });
    // Placeholder for the mode listener, attached after `mode` is built below.
    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Prompt'),
      styleRow.row,
      prompt.row,
      stylePreview,
      counter.wrap,
    ]));

    // === Instrumental toggle (a normal parameter entry) ===
    // The user-facing "make this song voice-less" toggle. ON sets
    // the vocal mode to "instrumental" and prepends a strong
    // no-vocals clause to the prompt, which the music-2.6 model
    // honors more reliably than `--instrumental` alone (per
    // MiniMax docs).
    //
    // Layout: rendered as a regular row in the Vocals & Lyrics
    // section (same `.row` styling as every other param), with a
    // small 🎵 marking + a per-row warning banner that appears
    // when the toggle is ON. No more separate "prominent" section
    // — the user wanted it in the normal parameter list.
    const instrumental = buildParamRow('🎵 Instrumental (voice-less)', {
      kind: 'boolean',
      default: false,
      help: 'Generate a voice-less / instrumental track. ON sets the vocal mode to "instrumental" AND auto-prepends "no vocals, no lyrics, no human voice," to the prompt — the model-2.6 API ignores --instrumental without this hint. Requires music-2.5+ or music-2.6.',
    });
    // Per-row warning that appears directly under the
    // instrumental row when the toggle is ON. Same
    // .info-banner styling as the lyrics-mode banner so the
    // visual weight is identical (instead of the old
    // bigger "prominent section" treatment that used to break
    // the normal parameter rhythm).
    const instrBanner = el('div', { class: 'info-banner instrumental-banner', style: 'display:none;' });
    instrBanner.appendChild(el('div', { class: 'info-banner-title' }, '🎵 Instrumental mode is on'));
    instrBanner.appendChild(el('div', {}, [
      'Lyrics will be ignored and ',
      el('strong', {}, '"no vocals, no lyrics, no human voice, "'),
      ' will be prepended to the prompt so the model stays voice-less.',
    ]));

    // Mode
    const mode = buildParamRow('Vocal mode', {
      kind: 'enum', default: 'lyrics-optimizer',
      options: [
        { value: 'lyrics-optimizer', label: 'Auto-generate lyrics from prompt' },
        { value: 'lyrics', label: 'Use my custom lyrics' },
        { value: 'instrumental', label: 'Instrumental (no vocals)' },
      ],
      help: 'How vocals/lyrics are handled. (Auto-overridden when "Instrumental mode" is ON above.)',
    });
    // When vocal mode is "instrumental", the model still tends to add vocals unless
    // the prompt explicitly forbids them. We auto-prepend a strong no-vocals clause.
    // (Bound here so `mode` is in scope.)
    const INSTRUMENTAL_PREFIX = 'no vocals, no lyrics, no human voice, ';
    extraPrefix = () => (mode.input.value === 'instrumental' || instrumental.input.value === 'on')
      ? INSTRUMENTAL_PREFIX : '';
    const onInstrumentalChange = () => {
      // If the toggle is ON, force the mode to instrumental
      if (instrumental.input.value === 'on') {
        mode.input.value = 'instrumental';
        mode.input.disabled = true;
        mode.row.classList.add('locked-by-instrumental');
      } else {
        mode.input.disabled = false;
        mode.row.classList.remove('locked-by-instrumental');
        if (mode.input.value === 'instrumental') mode.input.value = 'lyrics-optimizer';
      }
      instrBanner.style.display = instrumental.input.value === 'on' ? '' : 'none';
      counter.update();
      updatePreview();
    };
    instrumental.input.addEventListener('change', onInstrumentalChange);
    mode.input.addEventListener('change', () => { counter.update(); updatePreview(); });
    // Re-render once now that the prefix logic is in place
    updatePreview();
    counter.update();
    const lyrics = buildParamRow('Custom lyrics', {
      kind: 'textarea', value: '', help: 'Used when "Use my custom lyrics" is selected. Supports structure tags: [Verse], [Chorus], [Bridge], [Intro], [Outro], [Pre Chorus], [Interlude], [Post Chorus], [Transition], [Break], [Hook], [Build Up], [Inst], [Solo]. Max 3500 chars.\nNote: only music-2.5+ and music-2.6 reliably support --lyrics. If the output ignores the lyrics, switch the model in the dropdown below.',
    });
    const lyricsFile = buildParamRow('Lyrics file path (alt)', {
      kind: 'text', default: '',
      placeholder: 'Path to .txt file with lyrics',
      fileFilters: [
        { name: 'Text files', extensions: ['txt', 'md', 'lrc'] },
        { name: 'All files', extensions: ['*'] },
      ],
      browseTitle: 'Select lyrics text file',
      help: 'Read lyrics from a text file instead of pasting them.\nFormat: structure tags ([Verse], [Chorus], [Bridge], etc.) + free text.\nMax 3500 chars per song.\nNote: only music-2.5+ and music-2.6 reliably support --lyrics. If the\noutput ignores the lyrics, switch the model in the dropdown above.',
    });
    // Lyrics-mode info banner (shown only when mode === 'lyrics')
    const lyricsModeBanner = el('div', { class: 'info-banner', style: 'display:none;' });
    lyricsModeBanner.appendChild(el('div', { class: 'info-banner-title' }, 'ðŸŽ¤ Custom Lyrics mode'));
    const bannerBody = el('div', {});
    const bannerText = document.createTextNode('Fill the textarea above (or use a .txt file). Ensure --model is set to ');
    bannerBody.appendChild(bannerText);
    const m1 = el('strong', {}, 'music-2.6');
    bannerBody.appendChild(m1);
    bannerBody.appendChild(document.createTextNode(' or '));
    const m2 = el('strong', {}, 'music-2.5+');
    bannerBody.appendChild(m2);
    bannerBody.appendChild(document.createTextNode('. music-2.0 ignores --lyrics. Max 3500 chars; structure tags like '));
    bannerBody.appendChild(el('code', {}, '[Verse]'));
    bannerBody.appendChild(document.createTextNode(', '));
    bannerBody.appendChild(el('code', {}, '[Chorus]'));
    bannerBody.appendChild(document.createTextNode(', '));
    bannerBody.appendChild(el('code', {}, '[Bridge]'));
    bannerBody.appendChild(document.createTextNode(' are supported.'));
    lyricsModeBanner.appendChild(bannerBody);
    function updateLyricsBanner() {
      const isLyrics = mode.input.value === 'lyrics';
      lyricsModeBanner.style.display = isLyrics ? '' : 'none';
      // Hide lyrics + lyricsFile when mode is not 'lyrics' (they'd be ignored otherwise)
      lyrics.row.style.display = isLyrics ? '' : 'none';
      lyricsFile.row.style.display = isLyrics ? '' : 'none';
    }
    mode.input.addEventListener('change', updateLyricsBanner);
    updateLyricsBanner();

    // Vocals & Lyrics section. The Instrumental toggle is now a
    // normal entry INSIDE this section (not a separate prominent
    // box). It still has the 🎵 prefix + a per-row warning banner
    // when ON, so the user gets the same visual cue without the
    // rhythm-breaking separate-section layout.
    const lyricsSection = el('div', { class: 'section' }, [
      el('h3', {}, 'Vocals & Lyrics'),
      instrumental.row,
      instrBanner,
      mode.row,
      lyrics.row,
      lyricsFile.row,
      lyricsModeBanner,
    ]);
    root.appendChild(lyricsSection);
    const model = buildParamRow('--model', {
      kind: 'enum', default: 'music-2.6',
      options: [
        { value: 'music-2.6', label: 'music-2.6 (newest â€” cover, instrumental, lyrics-optimizer, default)' },
        { value: 'music-2.5+', label: 'music-2.5+ (instrumental unlocked, richer arrangements)' },
        { value: 'music-2.5', label: 'music-2.5 (paragraph-level precision, 14+ structure tags)' },
        { value: 'music-2.0', label: 'music-2.0 (legacy)' },
      ],
      help: 'Music generation model.\n\nmusic-2.6 (default): Newest. Supports --lyrics-optimizer, --instrumental,\n  --lyrics, --cover. Best for full-length songs with vocals.\n\nmusic-2.5+: Instrumental mode unlocked natively, richer multi-instrument\n  arrangements. Use when music-2.6 instrumental sounds too thin.\n\nmusic-2.5: 14+ structure tags with paragraph-level precision. Good\n  when you need fine-grained control over song structure.\n\nmusic-2.0: Legacy. May not support --lyrics or --instrumental.',
    });
    const genre = buildParamRow('--genre', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'pop', label: 'pop' },
        { value: 'rock', label: 'rock' },
        { value: 'jazz', label: 'jazz' },
        { value: 'classical', label: 'classical' },
        { value: 'hip-hop', label: 'hip-hop' },
        { value: 'electronic', label: 'electronic' },
        { value: 'folk', label: 'folk' },
        { value: 'cinematic', label: 'cinematic' },
        { value: 'lo-fi', label: 'lo-fi' },
        { value: 'ambient', label: 'ambient' },
        { value: 'country', label: 'country' },
        { value: 'r&b', label: 'r&b' },
        { value: 'metal', label: 'metal' },
        { value: 'indie', label: 'indie' },
      ],
      help: 'Music genre tag. Free-text fallback if you pick "Customâ€¦".',
    });
    const mood = buildParamRow('--mood', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'happy', label: 'happy' },
        { value: 'sad', label: 'sad' },
        { value: 'energetic', label: 'energetic' },
        { value: 'calm', label: 'calm' },
        { value: 'melancholic', label: 'melancholic' },
        { value: 'aggressive', label: 'aggressive' },
        { value: 'romantic', label: 'romantic' },
        { value: 'dark', label: 'dark' },
        { value: 'uplifting', label: 'uplifting' },
        { value: 'dreamy', label: 'dreamy' },
      ],
      help: 'Mood or emotion. Free-text fallback if you pick "Customâ€¦".',
    });
    const vocals = buildParamRow('--vocals', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'warm male baritone', label: 'warm male baritone' },
        { value: 'bright female soprano', label: 'bright female soprano' },
        { value: 'duet with harmonies', label: 'duet with harmonies' },
        { value: 'choir', label: 'choir' },
      ],
      help: 'Vocal style descriptor. Free-text fallback if you pick "Customâ€¦".',
    });
    const instruments = buildParamRow('--instruments', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'piano', label: 'piano' },
        { value: 'acoustic guitar', label: 'acoustic guitar' },
        { value: 'electric guitar', label: 'electric guitar' },
        { value: 'drums', label: 'drums' },
        { value: 'strings', label: 'strings' },
        { value: 'synth', label: 'synth' },
        { value: 'orchestral', label: 'orchestral' },
      ],
      help: 'Featured instruments. Free-text fallback if you pick "Customâ€¦".',
    });
    const bpm = buildParamRow('--bpm', {
      kind: 'number', default: '', min: 40, max: 220, step: 1,
      options: [
        { value: '', label: '(unset)' },
        { value: 60, label: '60' }, { value: 80, label: '80' }, { value: 90, label: '90' },
        { value: 100, label: '100' }, { value: 110, label: '110' }, { value: 120, label: '120' },
        { value: 128, label: '128' }, { value: 140, label: '140' }, { value: 160, label: '160' },
      ],
      help: 'Exact tempo in BPM.',
    });
    const key = buildParamRow('--key', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'C major', label: 'C major' },
        { value: 'C minor', label: 'C minor' },
        { value: 'D major', label: 'D major' },
        { value: 'D minor', label: 'D minor' },
        { value: 'E major', label: 'E major' },
        { value: 'E minor', label: 'E minor' },
        { value: 'F major', label: 'F major' },
        { value: 'F minor', label: 'F minor' },
        { value: 'G major', label: 'G major' },
        { value: 'G minor', label: 'G minor' },
        { value: 'A major', label: 'A major' },
        { value: 'A minor', label: 'A minor' },
        { value: 'B major', label: 'B major' },
      ],
      help: 'Musical key. Free-text fallback if you pick "Customâ€¦".',
    });
    const tempo = buildParamRow('--tempo', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'slow', label: 'slow' },
        { value: 'moderate', label: 'moderate' },
        { value: 'fast', label: 'fast' },
      ],
      help: 'Coarse tempo hint.',
    });
    const structure = buildParamRow('--structure', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'verse-chorus-verse-chorus', label: 'verse-chorus-verse-chorus' },
        { value: 'verse-chorus-bridge-chorus', label: 'verse-chorus-bridge-chorus' },
        { value: 'intro-verse-chorus', label: 'intro-verse-chorus' },
      ],
      help: 'Song structure description.',
    });
    const references = buildParamRow('--references', {
      kind: 'text', default: '', help: 'Reference tracks or artists, e.g. "similar to Ed Sheeran".',
    });
    const avoid = buildParamRow('--avoid', {
      kind: 'text', default: '', help: 'Elements to avoid in the generated music.',
    });
    const useCase = buildParamRow('--use-case', {
      kind: 'enum-text', default: '',
      options: [
        { value: '', label: '(any)' },
        { value: 'background music for video', label: 'background music for video' },
        { value: 'theme song', label: 'theme song' },
        { value: 'jingle', label: 'jingle' },
        { value: 'podcast intro', label: 'podcast intro' },
      ],
      help: 'Use case context.',
    });
    const extra = buildParamRow('--extra', {
      kind: 'text', default: '', help: 'Additional fine-grained requirements not covered above.',
    });
    const audioFormat = buildParamRow('--format', {
      kind: 'enum', default: 'mp3',
      options: [
        { value: 'mp3', label: 'mp3 (default)' },
        { value: 'wav', label: 'wav' },
        { value: 'pcm', label: 'pcm' },
      ],
      help: 'Output audio container.',
    });
    const sampleRate = buildParamRow('--sample-rate', {
      kind: 'number', default: 44100, step: 1000,
      options: [22050, 32000, 44100, 48000].map((v) => ({ value: v, label: String(v) })),
      help: 'Sample rate in Hz.',
    });
    const bitrate = buildParamRow('--bitrate', {
      kind: 'number', default: 256000, step: 1000,
      options: [128000, 192000, 256000, 320000].map((v) => ({ value: v, label: String(v) })),
      help: 'Bitrate in bits/second.',
    });
    const watermark = buildParamRow('--aigc-watermark', {
      kind: 'boolean', default: false, help: 'Embed an AI-generated content watermark in the audio.',
    });
    const outputFormat = buildParamRow('--output-format', {
      kind: 'enum', default: 'hex',
      options: [
        { value: 'hex', label: 'hex (default, saved to file)' },
        { value: 'url', label: 'url (24h expiry â€” download promptly)' },
      ],
      help: 'How audio bytes come back. hex is saved directly; url requires separate download.',
    });

    root.appendChild(el('div', { class: 'section' }, [
      el('h3', {}, 'Parameters'),
      buildFilePrefixRow(),
      el('div', { class: 'grid' }, [
        mode.row, model.row,
        lyrics.row, lyricsFile.row,
        genre.row, mood.row,
        vocals.row, instruments.row,
        bpm.row, key.row,
        tempo.row, structure.row,
        references.row, avoid.row,
        useCase.row, extra.row,
        audioFormat.row, sampleRate.row,
        bitrate.row, watermark.row,
        outputFormat.row,
      ]),
    ]));

    const actions = el('div', { class: 'actions' });
    const genBtn = el('button', { class: 'primary' }, 'Generate');
    const lastCmd = el('span', { class: 'lastcmd' }, '');
    const batchControls = el('span', { 'data-batch-controls': 'music', class: 'batch-controls' });
    // Variants dropdown (music tab has no seed, so always enabled)
    const variants = buildVariantsRow({ id: 'variants-music' });
    actions.append(buildAddToBatchBtn('music'), genBtn, variants.row, batchControls, lastCmd);
    const preview = el('div', { class: 'preview' }, el('div', { class: 'empty' }, 'No audio generated yet.'));
    // Preview ABOVE the actions row so the Generate / +Add buttons
    // sit at the very bottom of the tab. See the image tab's
    // tabFooter comment for the rationale.
    const tabFooter = el('div', { class: 'tab-footer' }, [preview, actions]);
    root.appendChild(tabFooter);

    genBtn.addEventListener('click', async () => {
      // Re-entrancy guard: another generation is in progress.
      if (state.generating) return;
      if (!state.config.api_key) { toast('No API key configured. Click ⚙ to open Settings.', 'err'); return; }
      const promptText = buildFinalPrompt(styleRow.sel, prompt.input, extraPrefix());
      if (!promptText) { toast('Prompt is required (style or manual input).', 'warn'); return; }
      // Validate lyrics-mode input once, before looping variants
      if (mode.input.value === 'lyrics') {
        if (!lyricsFile.input.value.trim() && !lyrics.input.value.trim()) {
          toast('Custom lyrics mode selected but no lyrics provided.', 'warn');
          return;
        }
      }
      // Pre-flight: validate against MODEL_SPECS so the user
      // never gets a cryptic 400 for an out-of-range prompt,
      // unsupported flag for the current model, or a too-long
      // lyrics block. --instrumental / --lyrics-optimizer only
      // exist on the 2.5+ / 2.6 models; --lyrics is supported
      // on every model but unreliable on music-2.0.
      const musicModel = model.input.getValue();
      const musicParams = {
        '--model': model.input,
        '--prompt': prompt.input,
        '--lyrics': lyrics.input,
        '--instrumental': instrumental.input,
        '--lyrics-optimizer': mode.input, // mode maps to --lyrics-optimizer
        '--sample-rate': sampleRate.input,
        '--bitrate': audioBitrate.input,
        '--format': audioFormat.input,
      };
      const preErrs = validateTabAgainstSpec('music', musicParams, musicModel, null);
      if (preErrs.length) {
        for (const e of preErrs) toast(e, 'err', 6000);
        return;
      }
      // music-2.0 doesn't have --sample-rate 8000 in its accepted
      // set, so we already validate. But for safety: if the user
      // picked music-2.0 and a 8000Hz sample rate, the API
      // returns the closest supported rate. We don't block it.
      // Lyrics length: 3500 chars max for music-2.6; shorter for
      // older models. The spec table's lyrics.max covers all
      // models in one number (3500).

      const variantsCount = Math.max(1, Math.min(5, parseInt(variants.sel.value, 10) || 1));
      let outDir;
      try { outDir = await ensureSubDir('music'); }
      catch (e) { toast('No output directory set. Open Settings.', 'err'); return; }
      const slug = slugify(promptText).slice(0, 60) || 'music';
      const ext = (audioFormat.input.value || 'mp3');
      // Total assets this run will produce. The per-tab ETA timer reads
      // this from state.genQueueSize[tabKey] to compute a "remaining
      // time for the whole batch" estimate that ticks down as each
      // variant completes.
      if (!state.genQueueSize) state.genQueueSize = { image: 0, speech: 0, music: 0, video: 0 };
      if (!state.genQueueDone) state.genQueueDone = { image: 0, speech: 0, music: 0, video: 0 };
      state.genQueueSize.music = variantsCount;
      state.genQueueDone.music = 0;
      const cancel = armGenBtnWithCancel(genBtn, 'Generate');
      let allOk = true;
      let lastPreview = null;
      let lastOutFile = null;
      let threw = null;
      try {
        for (let v = 1; v <= variantsCount; v++) {
          if (cancel.wasCancelled()) break;
          const itemStart = Date.now();
          const args = ['music', 'generate'];
          args.push('--prompt', promptText);
          // Mode
          if (mode.input.value === 'lyrics-optimizer') args.push('--lyrics-optimizer');
          else if (mode.input.value === 'instrumental') args.push('--instrumental');
          else if (mode.input.value === 'lyrics') {
            if (lyricsFile.input.value.trim()) args.push('--lyrics-file', lyricsFile.input.value.trim());
            else if (lyrics.input.value.trim()) args.push('--lyrics', lyrics.input.value.trim());
          }
          appendFlag(args, model.input);
          appendFlag(args, genre.input);
          appendFlag(args, mood.input);
          appendFlag(args, vocals.input);
          appendFlag(args, instruments.input);
          if (bpm.input.getValue() !== '') args.push('--bpm', String(bpm.input.getValue()));
          appendFlag(args, key.input);
          appendFlag(args, tempo.input);
          appendFlag(args, structure.input);
          if (references.input.value.trim()) args.push('--references', references.input.value.trim());
          if (avoid.input.value.trim()) args.push('--avoid', avoid.input.value.trim());
          appendFlag(args, useCase.input);
          if (extra.input.value.trim()) args.push('--extra', extra.input.value.trim());
          appendFlag(args, audioFormat.input);
          appendFlag(args, sampleRate.input);
          appendFlag(args, bitrate.input);
          appendBoolFlag(args, watermark.input, '--aigc-watermark');
          if (outputFormat.input.value && outputFormat.input.value !== 'hex') {
            args.push('--output-format', outputFormat.input.value);
          }
          // Unique output file per variant
          const ts = timestamp();
          const variantTag = variantsCount > 1 ? `_v${v}` : '';
          const outFile = uniquePath(outDir, `${ts}_${slug}${variantTag}.${ext}`);
          args.push('--out', outFile);
          lastCmd.textContent = maskLine(`mmx ${args.join(' ')}`, state.config && state.config.api_key);
          const statusMsg = variantsCount > 1
            ? `Generating musicâ€¦ variant ${v}/${variantsCount} (may take 30sâ€“2min each)`
            : 'Generating musicâ€¦ (may take 30sâ€“2min)';
          setStatus(statusMsg, true);
          preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(statusMsg)}</div>`;
          const r = await window.api.mmxRun(args);
          if (cancel.wasCancelled()) { allOk = false; break; }
          if (!r.ok) {
            const msg = formatMmxError(r);
            preview.innerHTML = `<div class="empty">Generation failed (variant ${v}/${variantsCount}).</div><div class="meta">${escapeHtml(msg)}</div>`;
            toast(`Music generation failed: ${msg}`, 'err', 6000);
            allOk = false;
            break;
          }
          // Update the per-item average + advance the queue counter so
          // the ETA ticks down per item. See the image-tab comment
          // for the full rationale.
          const itemDur = (Date.now() - itemStart) / 1000;
          if (!state.genAvgSec) state.genAvgSec = {};
          const prevAvg = state.genAvgSec.music || 0;
          state.genAvgSec.music = prevAvg === 0 ? itemDur : (prevAvg * 0.6 + itemDur * 0.4);
          state.genQueueDone.music = (state.genQueueDone.music || 0) + 1;
          refreshTabEtas();
          lastPreview = r.parsed;
          lastOutFile = outFile;
        }
      } catch (e) {
        threw = e;
        allOk = false;
        console.error('Music generation threw:', e);
        toast('Generation error: ' + (e && e.message || String(e)), 'err', 6000);
      } finally {
        cancel.cleanup();
        setStatus('Ready', false);
        try { await refreshBrowser(); } catch {}
        try { await refreshQuota(); } catch {}
      }
      if (threw) return;
      if (cancel.wasCancelled()) {
        preview.innerHTML = '<div class="empty">Generation cancelled.</div>';
        toast('Cancelled.', 'warn');
        return;
      }
      if (allOk && lastOutFile) {
        showAudioPreview(preview, lastOutFile, lastPreview);
        bumpGenerationCounter('music', variantsCount);
      }
      if (allOk) {
        toast(variantsCount > 1
          ? `Music generated. ${variantsCount} variants saved.`
          : 'Music generated.', 'ok');
      }
    });
  },
};

// ----------------- Previews -----------------
// Build a file:// URL that works in the renderer. The path may contain
// characters that are special in a URL (#, ?, %, &) â€” these MUST be percent-
// encoded or the file fails to load (e.g. a folder named "v2 #3" would
// otherwise have the "#3" parsed as a fragment).
function fileUrl(p) {
  if (!p) return '';
  // Normalize Windows backslashes to forward slashes (the file:// URL
  // scheme uses forward slashes, regardless of OS).
  let normalized = p.replace(/\\/g, '/');
  // encodeURI keeps '/' and ':' intact, encodes everything else. That's
  // almost right but it does NOT escape '#' or '?' â€” those are reserved
  // URL characters, so a filename with '#' (e.g. "render#001.png")
  // would have the URL truncated at the '#', silently loading the
  // wrong file (or nothing). Manually escape them after encodeURI.
  const encoded = encodeURI(normalized)
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
  // file:// URLs use 3 slashes after the scheme for absolute paths:
  //   - Windows: "file:///C:/Users/me/file.png"  â† drive letter stays
  //   - POSIX:   "file:///home/me/file.png"      â† no leading slash in path
  // Concatenating "file:///" with an absolute POSIX path (which already
  // starts with "/") would produce 4 slashes (file:////home/...) which
  // Chromium accepts but some Chromium-based clients (and Electron's
  // older image-loader) reject as malformed. Strip a single leading
  // slash so the result is always exactly 3 slashes after "file:".
  const body = encoded.startsWith('/') ? encoded.slice(1) : encoded;
  return 'file:///' + body;
}

function showImagePreview(rootEl, file, parsed) {
  // Use file:// to let the renderer display the local file.
  // We add a cache-busting query string in case the same path is regenerated.
  // The preview now renders a 400Ã—400 thumbnail instead of the full image
  // (the preview pane was locking the screen when the generation produced
  // a large image). Clicking the thumbnail opens the image overlay at
  // 1:1 pixel mode with a zoom dropdown.
  const url = fileUrl(file) + '?t=' + Date.now();
  const filename = (file || '').split(/[\\/]/).pop() || 'image';
  const preLoad = new Image();
  preLoad.onload = () => {
    rootEl.innerHTML = '';
    const thumb = el('img', {
      src: url,
      alt: filename,
      class: 'preview-thumb',
      title: `${preLoad.naturalWidth}Ã—${preLoad.naturalHeight} â€” click to view full size`,
    });
    thumb.addEventListener('click', () => {
      openImageOverlay(url, filename, preLoad.naturalWidth, preLoad.naturalHeight, file);
    });
    rootEl.appendChild(thumb);
    const meta = el('div', { class: 'meta' });
    meta.appendChild(document.createTextNode(file));
    meta.appendChild(el('div', { class: 'preview-thumb-size' },
      `${preLoad.naturalWidth}Ã—${preLoad.naturalHeight} â€” click for 1:1 view`));
    if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
    rootEl.appendChild(meta);
  };
  preLoad.onerror = () => {
    // Fallback when pre-loading fails (e.g. file still being written to disk).
    rootEl.innerHTML = '';
    const thumb = el('img', { src: url, alt: filename, class: 'preview-thumb' });
    thumb.addEventListener('click', () => openImageOverlay(url, filename, 0, 0, file));
    rootEl.appendChild(thumb);
    const meta = el('div', { class: 'meta' }, file);
    rootEl.appendChild(meta);
  };
  preLoad.src = url;
}

function showAudioPreview(rootEl, file, parsed) {
  const url = fileUrl(file) + '?t=' + Date.now();
  rootEl.innerHTML = '';
  const audio = el('audio', { controls: '', src: url });
  rootEl.appendChild(audio);
  const meta = el('div', { class: 'meta' });
  meta.appendChild(document.createTextNode(file));
  if (parsed) meta.appendChild(el('div', {}, '[mmx] ' + safeStringify(parsed)));
  rootEl.appendChild(meta);
}

// Open the image overlay: a full-screen modal showing the image at
// 1:1 pixel mode by default, with a zoom dropdown (75% / 50% / 25% /
// Fit-to-window). Used by both the generation preview thumbnail and the
// file-browser preview pane.
// Track the most recent overlay's close function so a re-open can
// dispose the previous one cleanly (removes its document-level
// keydown listener). Without this, every rapid thumbnail click
// leaked one Esc listener on `document`, and the user had to
// press Esc N times to dismiss a single overlay after N re-opens.
let _openImageOverlayClose = null;

// Set of extensions the overlay's arrow-key navigation considers
// "browsable" â€” i.e. an image file the user can step through.
// Mirrors the same set the file browser / preview pane use to
// decide what to render.
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

// Build the list of image paths the user can step through with
// the arrow keys in the overlay. Prefers the active multi-image
// batch (state._previewBatch) when the current path is in it;
// otherwise falls back to the folder explorer's currently-rendered
// image list, which is sorted the same way as the folder explorer
// (because the file browser sorts server-side and the renderer
// displays the items in the order it received them).
//
// Returns { paths: string[], index: number } or null when no list
// could be built (e.g. no folder context, no batch, no match).
function buildOverlayNavList(currentPath) {
  const cur = (currentPath || '').toLowerCase();
  // 1) Multi-image batch â€” only if the current path is actually in it.
  if (state._previewBatch && Array.isArray(state._previewBatch.paths) && state._previewBatch.paths.length > 1) {
    const idx = state._previewBatch.paths.findIndex((p) => (p || '').toLowerCase() === cur);
    if (idx >= 0) {
      return { paths: state._previewBatch.paths, index: idx };
    }
  }
  // 2) Fallback: all image files in the current folder, in the
  //    same order the folder explorer renders them. The
  //    file-browser renderer stores the items on state._fbItems
  //    (added in feature #2) and they arrive pre-sorted from the
  //    main process (name + dirs-first). We further filter to
  //    image files so the arrow keys only step through images
  //    and not, say, the user's text notes.
  if (Array.isArray(state._fbItems) && state._fbItems.length) {
    const paths = state._fbItems
      .filter((it) => !it.isDir && IMAGE_EXTS.includes((it.ext || '').toLowerCase()))
      .map((it) => it.path);
    if (!paths.length) return null;
    const idx = paths.findIndex((p) => (p || '').toLowerCase() === cur);
    return { paths, index: idx >= 0 ? idx : 0 };
  }
  return null;
}

function openImageOverlay(src, filename, naturalWidth, naturalHeight, filePath) {
  // If there's already an overlay open, close it cleanly (this
  // removes the previous keydown listener before we open a new one).
  if (_openImageOverlayClose) {
    try { _openImageOverlayClose(); } catch (_) {}
    _openImageOverlayClose = null;
  }
  // The previous code did `existing.remove()` here, which
  // removed the DOM but never called close() â€” so the keydown
  // listener stayed attached forever. The cleanup is now in
  // _openImageOverlayClose above.
  const overlay = el('div', { class: 'image-overlay', id: 'image-overlay' });
  // Header
  const fname = el('span', { class: 'image-overlay-filename', title: filename || '' }, filename || '');
  const size = el('span', { class: 'image-overlay-size' },
    (naturalWidth && naturalHeight) ? `${naturalWidth}Ã—${naturalHeight}` : '');
  // Position counter (e.g. "3 / 12") on the overlay header. Shown
  // when the arrow keys can navigate, hidden otherwise. Built
  // from the same nav list the arrow keys use, so the two stay
  // in lock-step.
  const navList = buildOverlayNavList(filePath);
  const pos = el('span', { class: 'image-overlay-pos' }, '');
  if (navList && navList.paths.length > 1) {
    pos.textContent = ` (${navList.index + 1} / ${navList.paths.length})`;
  }
  const zoom = el('select', { class: 'image-overlay-zoom', title: 'Zoom level' });
  for (const [val, label] of [
    ['100', '100% (1:1)'],
    ['75', '75%'],
    ['50', '50%'],
    ['25', '25%'],
    ['fit', 'Fit to window'],
  ]) {
    const opt = el('option', { value: val }, label);
    if (val === '100') opt.selected = true;
    zoom.appendChild(opt);
  }
  const closeBtn = el('button', { class: 'btn-mini image-overlay-close', title: 'Close (Esc)' }, 'Ã—');
  // Prev / next arrow buttons on the header. Same keyboard / click
  // behaviour â€” the buttons exist so the user can navigate on a
  // touch device or with the mouse without using the keyboard.
  const prevBtn = el('button', { class: 'btn-mini image-overlay-prev', title: 'Previous (â†)' }, 'â€¹');
  const nextBtn = el('button', { class: 'btn-mini image-overlay-next', title: 'Next (â†’)' }, 'â€º');
  if (!navList || navList.paths.length <= 1) {
    // Single-image overlay â€” hide the nav controls so the user
    // doesn't think there's more to see.
    prevBtn.style.display = 'none';
    nextBtn.style.display = 'none';
  }
  const header = el('div', { class: 'image-overlay-header' }, [fname, pos, size, prevBtn, nextBtn, zoom, closeBtn]);
  // Content
  const img = el('img', { class: 'image-overlay-img zoom-100', src, alt: filename || '' });
  if (naturalWidth && naturalHeight) {
    // Hint the browser at the natural size for layout (CSS then scales
    // according to .zoom-100/75/50/25/fit).
    img.width = naturalWidth;
    img.height = naturalHeight;
  }
  const content = el('div', { class: 'image-overlay-content' }, [img]);
  overlay.append(header, content);
  document.body.appendChild(overlay);
  // Zoom on change
  zoom.addEventListener('change', () => {
    img.className = 'image-overlay-img zoom-' + zoom.value;
  });
  // Close on button click
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (_openImageOverlayClose === close) _openImageOverlayClose = null;
  };
  closeBtn.addEventListener('click', close);
  // Close on background click (not on the image)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  // The keyboard handler covers:
  //   Esc   â†’ close the overlay
  //   â† / â†’ â†’ step to the previous / next image (with wrap-around
  //           when the user reaches the ends, so the keyboard
  //           navigation matches what the user expects from a
  //           typical image viewer)
  // Other keys are ignored. We compute the nav list lazily on
  // each arrow press so a newly-shown multi-image batch is picked
  // up the moment the user opens the overlay (and so the list
  // stays accurate even if the user clicks into a different
  // thumbnail in the preview pane while the overlay is open â€”
  // which is currently not possible, but defensive code is cheap).
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const list = buildOverlayNavList(filePath);
    if (!list || list.paths.length <= 1) return;
    const delta = e.key === 'ArrowLeft' ? -1 : +1;
    // Wrap-around: at the end, â† jumps to the last; at the start,
    // â†’ jumps to the first. The preview-pane highlight + the
    // folder-explorer .selected row follow.
    const nextIdx = (list.index + delta + list.paths.length) % list.paths.length;
    navigateToOverlayImage(list.paths[nextIdx], { wrap: true });
  };
  document.addEventListener('keydown', onKey);
  // Wire the prev/next header buttons to the same navigateToOverlayImage
  // path so mouse-only users get the same behaviour.
  if (navList && navList.paths.length > 1) {
    prevBtn.addEventListener('click', () => {
      const list = buildOverlayNavList(filePath);
      if (!list || list.paths.length <= 1) return;
      const nextIdx = (list.index - 1 + list.paths.length) % list.paths.length;
      navigateToOverlayImage(list.paths[nextIdx], { wrap: true });
    });
    nextBtn.addEventListener('click', () => {
      const list = buildOverlayNavList(filePath);
      if (!list || list.paths.length <= 1) return;
      const nextIdx = (list.index + 1) % list.paths.length;
      navigateToOverlayImage(list.paths[nextIdx], { wrap: true });
    });
  }
  // Stop propagation on the image so clicking the image doesn't close
  // the overlay (the user is likely trying to interact with the image).
  img.addEventListener('click', (e) => e.stopPropagation());
  // Right-click on the overlay image: open the same
  // folder-browser context menu (Upscale / Crop / Convert /
  // Optimize / Remove background + file-level Copy / Cut /
  // Rename / Move / Delete). Mirrors the preview-pane-thumbnail
  // right-click behaviour so the user gets the same options
  // from either entry point.
  if (filePath) {
    img.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { showItemContextMenuForPath(filePath, e.clientX, e.clientY); }
      catch (_) { /* best-effort */ }
    });
    // Same right-click on the header filename (the "Image.png"
    // label in the overlay's top bar) — useful when the user
    // wants the context menu without aiming at the image.
    fname.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { showItemContextMenuForPath(filePath, e.clientX, e.clientY); }
      catch (_) { /* best-effort */ }
    });
  }
  // Hand the close function to the next open call so a re-open
  // disposes this one cleanly.
  _openImageOverlayClose = close;
}

// Open the next / previous image in the current overlay nav list.
// Called by the arrow-key / prev-next-button handlers inside
// openImageOverlay. Closes the current overlay, re-opens a new
// one for `path`, and updates the multi-image preview-pane
// highlight (if a batch is shown) + the folder-explorer's
// .selected row. The "wrap" option is accepted for future use
// (e.g. disabling wrap-around when the user explicitly clicks
// a thumbnail), but currently the keyboard always wraps.
function navigateToOverlayImage(path, opts) {
  if (!path) return;
  // Update the multi-image preview-pane highlight so the new
  // "current" thumbnail gets the .preview-active class. We
  // update _previewBatch.index even if the path is not in the
  // batch â€” buildOverlayNavList falls back to the folder list
  // in that case.
  if (state._previewBatch && Array.isArray(state._previewBatch.paths)) {
    const idx = state._previewBatch.paths.findIndex((p) => (p || '').toLowerCase() === path.toLowerCase());
    if (idx >= 0) state._previewBatch.index = idx;
  }
  // Folder-explorer's .selected row follows the user, so the
  // file they're navigating to is always the active row.
  markFbItemActive(path);
  // Re-render the preview-pane highlight (the .preview-active
  // class on the thumbnail). We do this by walking the
  // current grid and toggling the class.
  const grid = document.querySelector('#fb-preview-content .preview-pane-grid');
  if (grid) {
    let activeSlot = null;
    $$('.preview-pane-thumb', grid).forEach((slot) => {
      // The slot's `title` attribute is the filename, which is
      // not a reliable key. Instead, the click handler stores
      // the path on a data attribute when it binds; for the
      // public path we read it from the slot's stored state.
      // As a fallback, the slot's first child <img> has a
      // src that includes a cache-buster; we can't reverse
      // that into a path. So we just look up by data-path
      // if the slot has it (we set it below in
      // previewImagesFromFiles).
      const slotPath = slot.getAttribute('data-path');
      const isMatch = slotPath && slotPath.toLowerCase() === path.toLowerCase();
      slot.classList.toggle('preview-active', !!isMatch);
      if (isMatch) activeSlot = slot;
    });
    if (activeSlot) {
      try { activeSlot.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    }
  }
  // Close the current overlay (which also unregisters the
  // keyboard listener) and open a new one for the new path.
  // The close() inside openImageOverlay() handles the
  // _openImageOverlayClose cleanup; we then load the natural
  // size async so the new overlay's title shows the right
  // dimensions.
  const url = fileUrl(path) + '?t=' + Date.now();
  const filename = (path || '').split(/[\\/]/).pop() || 'image';
  const probe = new Image();
  probe.onload = () => {
    openImageOverlay(url, filename, probe.naturalWidth, probe.naturalHeight, path);
  };
  probe.onerror = () => {
    openImageOverlay(url, filename, 0, 0, path);
  };
  probe.src = url;
}

function safeStringify(o) {
  try { return JSON.stringify(o, null, 2).slice(0, 4000); } catch { return String(o); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ----------------- Image pipeline (Upscale / Crop / Convert) -----------------
// All three operations are pure browser/Electron â€” no external libraries,
// no network calls, fully open source. They all use the HTML5 Canvas
// API to read the source image into a canvas, then export it to the
// target format via canvas.toDataURL. The main process only handles
// persisting the resulting base64 blob to disk via the new fb:write IPC.

// Load a local file:// image as a usable Image object (resolves once
// it's fully decoded). Used by upscale / crop / convert.
function loadImageFromFile(filePath) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image: ' + filePath));
    img.src = fileUrl(filePath);
  });
}

// Pick a non-clashing output path for the upscale / crop pipeline.
// Tries `basePath`, `basePath (2)`, `basePath (3)`, ... via
// window.api.fbExists. Caps at 1000 attempts (which would only
// realistically happen if a script is bulk-renaming to the same
// stem â€” the user can still rename / move existing files). On
// exhaustion, falls back to a timestamp suffix so the operation
// never silently overwrites a file.
async function uniqueOutputPath(basePath) {
  const dot = basePath.lastIndexOf('.');
  const stem = dot > 0 ? basePath.slice(0, dot) : basePath;
  const ext = dot > 0 ? basePath.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? basePath : `${stem} (${i})${ext}`;
    if (!await window.api.fbExists(candidate)) return candidate;
  }
  return `${stem}_${Date.now()}${ext}`;
}

// Module-level re-render of the "ðŸ” Upscale 2Ã—" label in the image
// tab. The label is created (and its refreshUpscaleCheckboxUI
// closure is defined) inside the image tab's build(), so by the
// time the user opens the âš™ Settings â†’ Upscale popup, that
// closure is long gone. This module-level helper re-queries the
// DOM by class and updates the label + .active class on save
// and on every render-pass. (For "one-off" upscale/crop flows
// via the right-click menu, the in-tab function still runs
// because the build() closure is still in scope at that point.)
function refreshUpscaleLabel() {
  const label = document.querySelector('.upscale-checkbox');
  if (!label) return;
  const mult = label.querySelector('.upscale-mult');
  const m = (state.upscaleSettings && state.upscaleSettings.multiplier) || 2;
  if (mult) mult.textContent = state.upscaleEnabled ? ` (${m}Ã—)` : '';
  label.classList.toggle('active', !!state.upscaleEnabled);
}

// Derive the output MIME from a file extension. Used to export the
// canvas in the same format as the input. WebP is detected too (since
// the Canvas API supports exporting to image/webp in modern Chromium).
function mimeFromPath(p) {
  const ext = (p.split('.').pop() || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/png'; // GIF can't be exported from canvas;
                                        // we fall back to PNG (first frame)
  return 'image/png';
}

// Derive the output file extension from a MIME type. Used by the
// format-converter.
function extFromMime(mime) {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

// Pick a non-clobbering output path next to the source. Inserts a
// `_2x`, `_cropped_WxH`, or `_converted` infix between the stem and
// the extension. If the result already exists, a numeric suffix is
// appended to keep the original safe.
function derivedOutputPath(srcPath, infix) {
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const lastSep = srcPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : '';
  const lastDot = srcPath.lastIndexOf('.');
  const stem = lastDot > lastSep ? srcPath.slice(0, lastDot) : srcPath;
  const ext = lastDot > lastSep ? srcPath.slice(lastDot) : '';
  let candidate = `${dir}${sep}${stem.split(sep).pop()}${infix}${ext}`;
  // Append numeric suffix on collision
  let i = 1;
  // We don't have a direct "exists" IPC here in the renderer; the
  // fbWrite will succeed (overwrite) if the file doesn't exist or
  // will fail with EEXIST. To avoid clobbering, we just keep the
  // name as-is and trust the user (or rely on fbWrite rejecting
  // existing files in the future). For now: no auto-suffix.
  return candidate;
}

// One resize step. Prefers createImageBitmap with resizeQuality: 'high'
// â€” Chromium uses a Lanczos-style resampler for that, which is
// noticeably sharper than the default canvas drawImage path. Falls
// back to canvas drawImage with imageSmoothingQuality = 'high' for
// older runtimes that don't expose createImageBitmap.
async function upscaleStep(src, w, h) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(src, {
        resizeWidth: w,
        resizeHeight: h,
        resizeQuality: 'high',
      });
    } catch (_) { /* fall through to canvas path */ }
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

// Toast-once latch: don't re-spam the user with the "Real-ESRGAN
// missing" message on every upscale. Resetting it requires a restart
// of the app, which is what we want â€” a single reminder per session
// is enough.
let _reEsrganNotified = false;

// Cache the isnetbg availability probe. The IPC is cheap (just a
// `which` + an fs.stat on the binary + model) but the right-click
// context menu re-asks the main process every time it's opened, and
// probing 5 times / second when the user is hammering the menu adds
// up. One probe per session, refreshed only on user request
// (e.g. after a future "install isnetbg" flow that calls
// `resetCache()` on the main side).
let _isnetbgStatusCache = null;
async function probeIsnetbgStatus(forceRefresh = false) {
  if (!forceRefresh && _isnetbgStatusCache) return _isnetbgStatusCache;
  let st = { available: false, binaryPath: null, modelPath: null, modelPresent: false, version: '', checked: true };
  try { st = await window.api.isnetbgAvailable(); st.checked = true; }
  catch (_) { st.checked = false; }
  _isnetbgStatusCache = st;
  return st;
}

// Run the optional isnetbg binary on a local image and return the
// path to the transparent PNG it wrote. Refuses to do anything when
// the binary / model is missing â€” the caller is expected to probe
// via `probeIsnetbgStatus()` first and show a precise error.
//
// We never overwrite the source: the output is written to
// `<stem>_nobg.png` next to the input (with a numeric suffix on
// collision). The caller can then delete / rename the source or
// hand the new path to the preview pane.
async function removeBackgroundFile(srcPath, opts = {}) {
  const st = await probeIsnetbgStatus();
  if (!st.checked) throw new Error('Could not contact background-removal backend.');
  if (!st.available) {
    throw new Error('Background removal is not set up. Run `npm run setup` in the project root to download the IS-Net model into ./bin/models/. The Optional add-ons popup (âš™ Settings â†’ Image upscaling â†’ "Re-open add-ons") walks you through every install path.');
  }
  if (!st.modelPresent) throw new Error('Background-removal model file missing. Run `npm run setup` (or place isnet-general-use.onnx in ./bin/models/ by hand).');

  const useGpu = (opts.useGpu !== undefined) ? !!opts.useGpu : (state.removeBackgroundUseGpu !== false);
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const lastSep = srcPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : '';
  const lastDot = srcPath.lastIndexOf('.');
  // Same infix pattern as upscale (`_2x` â†’ `_nobg`). PNG is the
  // only sensible output for a transparent image; we keep the
  // input extension only for human-readability (the actual file is
  // always PNG inside, since the isnetbg binary writes a PNG).
  const baseName = lastDot > lastSep ? srcPath.slice(lastSep + 1, lastDot) : srcPath.slice(lastSep + 1);
  const target = await uniqueOutputPath(`${dir}${sep}${baseName}_nobg.png`);
  const r = await window.api.isnetbgRun(srcPath, target, { useGpu });
  if (!r || !r.ok) {
    const msg = (r && r.stderr) || (r && ('isnetbg exited with code ' + r.code)) || 'isnetbg failed';
    throw new Error(msg);
  }
  return r.outputPath || target;
}

// Upscale an image to multiplierÃ— its original size. If the
// realesrgan-ncnn-vulkan binary is installed (PATH or ./bin/), we
// run it to get a high-quality 4Ã— intermediate, then resize the
// result down to the requested multiplier (or do an extra 2Ã— step
// for 8Ã—). Real-ESRGAN's x4plus model is BSD-3-Clause licensed and
// produces noticeably more detail than the built-in
// multi-step createImageBitmap pipeline. If the binary is missing,
// we fall back to the multi-step pipeline so the tool is never
// blocked.
//
// Returns the output path on disk.
async function upscaleImageFile(srcPath, multiplier) {
  multiplier = Math.max(1, Math.min(8, Math.floor(Number(multiplier) || 2)));

  // Probe Real-ESRGAN availability. Cheap IPC (just a `which` /
  // bundled-file stat); the result is cached in the main process.
  let reStatus = null;
  try { reStatus = await window.api.realesrganAvailable(); } catch (_) {}

  if (reStatus && reStatus.available) {
    try {
      return await upscaleImageFileRealesrgan(srcPath, multiplier, reStatus);
    } catch (e) {
      // Real-ESRGAN is available but failed (corrupt model, GPU OOM,
      // etc.). Log the error and fall back to the built-in pipeline
      // so the user still gets a result.
      console.error('Real-ESRGAN upscale failed, falling back to built-in:', e);
      toast('Real-ESRGAN upscale failed (' + (e.message || e) + '). Using built-in upscale.', 'warn', 4000);
      // fall through to built-in
    }
  } else if (!_reEsrganNotified) {
    _reEsrganNotified = true;
    toast(
      'Real-ESRGAN not installed â€” using the built-in upscale. ' +
      'Drop the binary into ./bin/ (or add it to PATH) for noticeably higher-quality output. ' +
      'See README for the download link.',
      'info', 6000,
    );
  }

  // Built-in multi-step path.
  const srcImg = await loadImageFromFile(srcPath);
  const targetW = Math.max(1, Math.floor(srcImg.naturalWidth * multiplier));
  const targetH = Math.max(1, Math.floor(srcImg.naturalHeight * multiplier));
  let curW = srcImg.naturalWidth;
  let curH = srcImg.naturalHeight;
  let cur = srcImg;
  while (curW < targetW || curH < targetH) {
    const stepW = Math.min(targetW, curW * 2);
    const stepH = Math.min(targetH, curH * 2);
    cur = await upscaleStep(cur, stepW, stepH);
    curW = stepW;
    curH = stepH;
  }
  const mime = mimeFromPath(srcPath);
  const out = document.createElement('canvas');
  out.width = targetW;
  out.height = targetH;
  const octx = out.getContext('2d');
  if (mime === 'image/jpeg') {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, targetW, targetH);
  }
  octx.drawImage(cur, 0, 0);
  const dataUrl = out.toDataURL(mime, 0.95);
  const b64 = dataUrl.split(',')[1];
  // uniqueOutputPath appends " (2)", " (3)", ... to a clashing
  // name so re-running the same upscale twice doesn't silently
  // overwrite the previous output.
  const outPath = await uniqueOutputPath(derivedOutputPath(srcPath, `_${multiplier}x`));
  const r = await window.api.fbWrite(outPath, b64);
  if (!r.ok) throw new Error(r.error || 'fbWrite failed');
  return r.path;
}

// Whitelist of Real-ESRGAN model names we know about. The model
// becomes the `-n` flag value of the spawn, so this is also a
// defence against a corrupted state.json / compromised renderer
// injecting an arbitrary flag into the binary's argv. Update
// when a new model is added to ./bin/models/.
const REAL_ESRGAN_MODELS = new Set([
  'realesrgan-x4plus',
  'realesrgan-x4plus-anime',
  'realesrgan-animevideov3',
  'realesr-general-x4v3',
]);

// Real-ESRGAN path. The ncnn-vulkan binary always outputs at the
// model's native scale (4Ã— for x4plus). For multipliers other than
// 4Ã—, we resize the intermediate using the same createImageBitmap
// step the built-in path uses:
//   - 2Ã—: 4Ã— â†’ 2Ã—  (downscale)
//   - 3Ã—: 4Ã— â†’ 3Ã—  (downscale)
//   - 4Ã—: 4Ã— as-is
//   - 8Ã—: 4Ã— â†’ 8Ã—  (extra 2Ã— step)
async function upscaleImageFileRealesrgan(srcPath, multiplier, reStatus) {
  // Pick a model: prefer the user's saved choice, but only if it's on
  // the whitelist. Anything else (default, typo, exploit attempt)
  // falls back to the general-purpose 4Ã— BSD-3 model.
  const wanted = (state.realesrganModel || '').trim();
  const model = REAL_ESRGAN_MODELS.has(wanted) ? wanted : 'realesrgan-x4plus';

  // The Real-ESRGAN binary needs a writable output path. Write its
  // 4Ã— intermediate to a `.realesrgan_tmp.png` next to the source
  // (in output_dir, so it's already in the allowed roots) and
  // clean it up in `finally`.
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const dot = srcPath.lastIndexOf('.');
  const stem = dot > 0 ? srcPath.slice(0, dot) : srcPath;
  const tempOut = stem + '.realesrgan_tmp.png';

  let r;
  try {
    r = await window.api.realesrganRun(srcPath, tempOut, {
      model,
      scale: 4,
    });
  } catch (e) {
    throw new Error('Real-ESRGAN run threw: ' + (e.message || e));
  }
  if (!r || !r.ok) {
    const msg = (r && r.stderr) || 'Real-ESRGAN returned a non-zero exit';
    throw new Error(msg);
  }

  try {
    // Load the 4Ã— intermediate and resize to the user's multiplier.
    const reImg = await loadImageFromFile(tempOut);
    const naturalW = reImg.naturalWidth / 4;
    const naturalH = reImg.naturalHeight / 4;
    const targetW = Math.max(1, Math.floor(naturalW * multiplier));
    const targetH = Math.max(1, Math.floor(naturalH * multiplier));
    let cur = reImg;
    let curW = reImg.naturalWidth;
    let curH = reImg.naturalHeight;
    if (multiplier !== 4) {
      cur = await upscaleStep(cur, targetW, targetH);
      curW = targetW;
      curH = targetH;
    }

    const mime = mimeFromPath(srcPath);
    const out = document.createElement('canvas');
    out.width = curW;
    out.height = curH;
    const octx = out.getContext('2d');
    if (mime === 'image/jpeg') {
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, curW, curH);
    }
    octx.drawImage(cur, 0, 0);
    const dataUrl = out.toDataURL(mime, 0.95);
    const b64 = dataUrl.split(',')[1];
    const outPath = await uniqueOutputPath(derivedOutputPath(srcPath, `_${multiplier}x`));
    const w = await window.api.fbWrite(outPath, b64);
    if (!w.ok) throw new Error(w.error || 'fbWrite failed');
    return w.path;
  } finally {
    // Best-effort cleanup of the intermediate. If the user is
    // hammering the upscale button the file may already be
    // re-created; fbDelete tolerates ENOENT.
    window.api.fbDelete(tempOut).catch(() => {});
  }
}

// Crop an image to the given pixel rectangle (in image coordinates).
// Output file uses the same extension as the source.
async function cropImageFile(srcPath, x, y, w, h) {
  x = Math.max(0, Math.floor(Number(x) || 0));
  y = Math.max(0, Math.floor(Number(y) || 0));
  w = Math.max(1, Math.floor(Number(w) || 1));
  h = Math.max(1, Math.floor(Number(h) || 1));
  const img = await loadImageFromFile(srcPath);
  // Clamp to image bounds
  if (x + w > img.naturalWidth) w = img.naturalWidth - x;
  if (y + h > img.naturalHeight) h = img.naturalHeight - y;
  if (w <= 0 || h <= 0) throw new Error('Crop region is outside the image.');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  const mime = mimeFromPath(srcPath);
  const dataUrl = canvas.toDataURL(mime);
  const b64 = dataUrl.split(',')[1];
  // Same collision-avoidance as upscale: re-cropping the same file
  // to the same W Ã— H now produces " (2)" / " (3)" instead of
  // silently overwriting the previous output.
  const out = await uniqueOutputPath(derivedOutputPath(srcPath, `_cropped_${w}x${h}`));
  const r = await window.api.fbWrite(out, b64);
  if (!r.ok) throw new Error(r.error || 'fbWrite failed');
  return r.path;
}

// Convert an image to a different format (png / jpeg / webp). Returns
// the output path. The new file has the target extension.
async function convertImageFile(srcPath, targetFormat) {
  const targetMime = `image/${targetFormat}`;
  const img = await loadImageFromFile(srcPath);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  // JPEG: no alpha; flatten onto white background.
  if (targetMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  const dataUrl = canvas.toDataURL(targetMime, 0.95);
  const b64 = dataUrl.split(',')[1];
  const ext = extFromMime(targetMime);
  // Build the output path: same stem, new extension.
  const sep = srcPath.includes('\\') ? '\\' : '/';
  const lastSep = srcPath.lastIndexOf(sep);
  const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : '';
  const lastDot = srcPath.lastIndexOf('.');
  const stem = lastDot > lastSep ? srcPath.slice(0, lastDot) : srcPath;
  const out = `${dir}${sep}${stem.split(sep).pop()}_converted.${ext}`;
  const r = await window.api.fbWrite(out, b64);
  if (!r.ok) throw new Error(r.error || 'fbWrite failed');
  return r.path;
}

// ----------------- Image optimisation / compression -----------------
// Thin wrapper around the main-process `image:optimize` IPC. The
// actual Sharp / libvips work happens in src/imageOptimizer.js; the
// renderer just translates UI choices into the IPC envelope and
// returns a structured result.
//
// `opts`:
//   {
//     quality:       1..100,                  // default 82
//     format:        'keep'|'jpeg'|'png'|'webp'|'avif',
//                                            // default 'keep'
//     stripMetadata: boolean,                 // default true
//     // `overwriteSource: true` writes the optimised bytes
//     // back to `srcPath` (atomic temp-file + rename on the
//     // main side). The post-generation pipeline uses this so
//     // the file the user just paid API credits to generate
//     // ends up as the smaller, optimised file â€” no
//     // intermediate "_optimized" sibling cluttering the
//     // output folder. The folder-browser right-click overlay
//     // leaves this off and uses a sibling file instead so
//     // the user can A/B the original against the optimised
//     // version.
//     overwriteSource: boolean,               // default false
//   }
//
// Returns the IPC envelope (see src/imageOptimizer.js header for
// the full shape). Throws an Error on the rare `!ok` path so the
// caller's catch block can show a single toast; the envelope
// itself also carries the message in `.error` for callers that
// want to render it inline (e.g. a results block in the dialog).
async function optimizeImageFile(srcPath, opts) {
  opts = opts || {};
  // Defensive: derive the actual `format` to pass to the IPC
  // from the UI's `format: 'keep' | 'jpeg' | ...` value. The
  // 'keep' alias is renderer-side only â€” the IPC expects
  // either a real format string or null/undefined for
  // "preserve source format".
  const fmt = (opts.format === 'keep' || !opts.format) ? null : opts.format;
  const overwrite = !!opts.overwriteSource;
  const out = overwrite
    ? srcPath
    : await uniqueOutputPath(derivedOutputPath(srcPath, '_optimized' + (fmt ? ('.' + fmt) : '')));
  const r = await window.api.optimizeImage(srcPath, {
    quality: opts.quality,
    format: fmt,
    stripMetadata: opts.stripMetadata !== false,
    outputPath: out,
  });
  if (!r || !r.ok) {
    const msg = (r && r.error) || 'Image optimisation failed.';
    const err = new Error(msg);
    err.result = r;
    throw err;
  }
  return r;
}

// Apply the full post-processing chain (upscale â†’ auto-crop â†’ remove
// background â†’ optimize) to a single generated image. The previous
// implementation of this chain in the image-tab gen handler only
// applied the steps to the LAST variant, which silently dropped the
// upscale / crop / no-bg / optimise work for variants 1..N-1. This
// helper is the per-file version of the same chain, called once per
// generated file by the gen handler.
//
// Each step is wrapped in its own try/catch and falls back to the
// best-available path on failure. The chain returns the final path
// (which may equal `srcPath` if every step was a no-op or failed).
//
// Args:
//   srcPath: the generated file to process
//   opts:
//     label:    optional suffix to add to status messages (e.g. " (2/3)")
//     onStatus: optional callback (msg) => void for the
//               "Upscaling 2Ã—â€¦" / "Croppingâ€¦" / "Removing backgroundâ€¦"
//               / "Optimizingâ€¦" status lines. If absent, the helper
//               just calls setStatus() + updates the image-tab preview
//               pane (legacy single-file behaviour).
//     onRefresh: optional callback to call after a step that writes
//               a new file (so the folder explorer can update right
//               away). The legacy code called refreshBrowser() after
//               each successful step; this helper calls onRefresh()
//               instead so callers (the image-tab gen handler, the
//               right-click "Optimize" overlay, etc.) can decide when
//               to refresh.
async function runPostProcessChain(srcPath, opts) {
  opts = opts || {};
  const label = opts.label || '';
  const onStatus = opts.onStatus || ((msg) => {
    setStatus(msg, true);
    const preview = $(`#tab-${state.currentTab} .preview`);
    if (preview) preview.innerHTML = `<div class="empty"><span class="spinner"></span> ${escapeHtml(msg)}</div>`;
  });
  const onRefresh = opts.onRefresh || (() => { try { refreshBrowser(); } catch (_) {} });
  let displayFile = srcPath;
  // If the Upscale checkbox is on, run the generated image through
  // the local upscaler after the mmx call returns. The preview then
  // shows the upscaled version, and the file browser gets the
  // new "<name>_Nx.png" file next to the original.
  if (state.upscaleEnabled && state.upscaleSettings) {
    try {
      onStatus(`Upscaling ${state.upscaleSettings.multiplier}Ã—${label}â€¦`);
      displayFile = await upscaleImageFile(displayFile, state.upscaleSettings.multiplier);
      addLogEvent({
        category: 'upscale',
        result: 'ok',
        headline: `Upscaled ${state.upscaleSettings.multiplier}Ã—${label ? ' ' + label.trim() : ''} â†’ ${displayFile.split(/[\\/]/).pop()}`,
        details: [
          `Source: ${srcPath}`,
          `Output: ${displayFile}`,
          `Multiplier: ${state.upscaleSettings.multiplier}Ã—`,
        ],
      });
      toast(`Upscaled to ${state.upscaleSettings.multiplier}Ã— â†’ ${displayFile}`, 'ok', 3000);
      // If auto-crop is also on, apply it now. The flow mirrors
      // showUpscaleDirect: load the upscaled file, compute the
      // crop frame at the chosen anchor, write the cropped file
      // and delete the intermediate.
      if (state.upscaleSettings.autoCrop) {
        const a = state.upscaleSettings;
        const upImg = await loadImageFromFile(displayFile);
        const uW = upImg.naturalWidth;
        const uH = upImg.naturalHeight;
        const wantW = a.cropWidth || uW;
        const wantH = a.cropHeight || uH;
        const w = Math.min(wantW, uW);
        const h = Math.min(wantH, uH);
        const maxX = uW - w;
        const maxY = uH - h;
        let x, y;
        if (a.cropAnchorX === 'left')        x = 0;
        else if (a.cropAnchorX === 'right') x = maxX;
        else                                x = Math.floor(maxX / 2);
        if (a.cropAnchorY === 'top')         y = 0;
        else if (a.cropAnchorY === 'bottom') y = maxY;
        else                                y = Math.floor(maxY / 2);
        onStatus(`Cropping to ${w} Ã— ${h}${label}â€¦`);
        const cropped = await cropImageFile(displayFile, x, y, w, h);
        // Drop the intermediate (full-upscaled) file.
        window.api.fbDelete(displayFile).catch(() => {});
        displayFile = cropped;
        toast(`Upscaled ${state.upscaleSettings.multiplier}Ã— and cropped to ${w} Ã— ${h} â†’ ${cropped}`, 'ok', 4000);
      }
      onRefresh();
    } catch (e) {
      console.error('Upscale failed:', e);
      toast('Upscale failed (kept original): ' + (e && e.message || e), 'warn', 4000);
      displayFile = srcPath;
    }
  }
  // "Remove background" stage â€” runs after upscale (if any) so
  // the user gets the transparent version of their final
  // image, not the raw generated file. Runs even when Upscale
  // is off (in that case the input is the raw generated file).
  // A failure here is non-fatal â€” we keep the (possibly
  // upscaled) displayFile and surface a warning, so the user
  // never loses the image they just paid API credits to
  // generate.
  if (state.removeBackgroundEnabled && displayFile) {
    try {
      onStatus(`Removing background${label}â€¦`);
      const noBg = await removeBackgroundFile(displayFile);
      // The intermediate (upscaled / cropped / raw) is now
      // redundant â€” the transparent version is the user's
      // actual deliverable. Delete the intermediate to keep
      // the output folder tidy; the user can still find it
      // in the file browser's lastN listing if they need it
      // back, and the original API-generated file is
      // untouched.
      if (noBg !== displayFile) {
        window.api.fbDelete(displayFile).catch(() => {});
        displayFile = noBg;
      }
      addLogEvent({
        category: 'bg',
        result: 'ok',
        headline: `Background removed${label ? ' ' + label.trim() : ''} â†’ ${displayFile.split(/[\\/]/).pop()}`,
        details: [
          `Source: ${srcPath}`,
          `Output: ${displayFile}`,
        ],
      });
      toast(`Background removed â†’ ${displayFile}`, 'ok', 4000);
      onRefresh();
    } catch (e) {
      console.error('Remove background failed:', e);
      toast('Background removal failed (kept image): ' + (e && e.message || e), 'warn', 5000);
    }
  }
  // "Optimize / Compress" stage â€” runs as the LAST step of the
  // post-processing chain (generate â†’ upscale â†’ crop â†’ remove
  // background â†’ optimize) so the user's final deliverable
  // ends up in the smallest possible file. Uses the Sharp +
  // libvips pipeline in src/imageOptimizer.js, with
  // overwriteSource: true so the optimised bytes replace
  // the post-background-removal file in place (atomic
  // temp-file + rename on the main side). A failure here is
  // non-fatal â€” we keep the (possibly upscaled / no-bg)
  // displayFile and surface a warning, so the user never
  // loses the image they just paid API credits to generate.
  if (state.optimizeSettings && state.optimizeSettings.enabled && displayFile) {
    try {
      const oSet = state.optimizeSettings;
      const inFmt = (displayFile.split('.').pop() || '').toLowerCase();
      const fmtLbl = (oSet.format && oSet.format !== 'keep') ? oSet.format.toUpperCase() : inFmt.toUpperCase();
      onStatus(`Optimizing${label} (Q${oSet.quality} â†’ ${fmtLbl})â€¦`);
      const r = await optimizeImageFile(displayFile, {
        quality: oSet.quality,
        format: oSet.format,
        stripMetadata: oSet.stripMetadata !== false,
        overwriteSource: true,
      });
      // The Sharp wrapper always writes to outputPath; with
      // overwriteSource: true that's the same path as the
      // input. The renderer doesn't get a new path back, so
      // displayFile stays the same â€” the bytes behind it
      // are now the smaller, optimised version.
      const inSize = humanSize(r.inputSize);
      const outSize = humanSize(r.outputSize);
      const saved = r.savedPercent || 0;
      const tone = saved >= 1 ? 'ok' : 'info';
      const savedSuffix = saved >= 1 ? ` (âˆ’${saved}%)` : '';
      addLogEvent({
        category: 'optimize',
        result: 'ok',
        headline: `Optimized${label ? ' ' + label.trim() : ''} ${fmtLbl} ${inSize} â†’ ${outSize}${savedSuffix}`,
        details: [
          `File: ${displayFile}`,
          `Quality: ${oSet.quality}`,
          `Format: ${fmtLbl}`,
          `Strip metadata: ${oSet.stripMetadata !== false ? 'yes' : 'no'}`,
          `Size: ${inSize} â†’ ${outSize} (${saved >= 0 ? 'âˆ’' : '+'}${Math.abs(saved)}%)`,
        ],
      });
      toast(`Optimized ${fmtLbl} ${inSize} â†’ ${outSize}${savedSuffix}`, tone, 4000);
      onRefresh();
    } catch (e) {
      console.error('Optimize failed:', e);
      toast('Optimize failed (kept image): ' + (e && e.message || e), 'warn', 5000);
    }
  }
  return displayFile;
}

// =================== Image-pipeline overlays ===================
// All three (Upscale settings, Crop, Convert) are pure modals built on
// showModal(). They share the same panel layout: title, description,
// form fields, action button, cancel.

// Settings overlay used by the "Upscale" checkbox in the image tab.
// Saves the chosen multiplier to state.upscaleSettings and closes; the
// checkbox stays checked so the next generation is upscaled.
function showUpscaleSettings() {
  if (!state.upscaleSettings) {
    state.upscaleSettings = { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' };
  }
  // Defensive: also fill in any missing fields on old state.js that
  // pre-dated the auto-crop support.
  const s = state.upscaleSettings;
  if (typeof s.autoCrop !== 'boolean') s.autoCrop = false;
  if (typeof s.cropWidth !== 'number') s.cropWidth = 0;
  if (typeof s.cropHeight !== 'number') s.cropHeight = 0;
  if (typeof s.cropAnchorX !== 'string') s.cropAnchorX = 'center';
  if (typeof s.cropAnchorY !== 'string') s.cropAnchorY = 'center';

  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'ðŸ” Upscale settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'When the Upscale checkbox is on, every generated image is upscaled locally with the settings below before being shown. Pure browser Canvas â€” no API call, no network. The "auto-crop" options here are also picked up by the "Add" button on the image tab and applied to every entry in a batch.'));

    // Multiplier
    const multSel = el('select', {});
    for (const m2 of [2, 3, 4]) {
      const opt = el('option', { value: String(m2) }, `${m2}Ã— (larger)`);
      if (m2 === s.multiplier) opt.selected = true;
      multSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Multiplier'), multSel]));

    // auto-crop checkbox
    const autoCropCb = el('input', { type: 'checkbox', class: 'auto-crop-cb' });
    autoCropCb.checked = !!s.autoCrop;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [autoCropCb, ' auto-crop to resolution']),
    ]));

    // crop W/H inputs (hidden by default)
    const cropWInput = el('input', { type: 'number', min: '0', value: String(s.cropWidth || 0) });
    const cropHInput = el('input', { type: 'number', min: '0', value: String(s.cropHeight || 0) });
    const cropSizeRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', {}, 'Crop target W Ã— H (0 = use post-upscale target)'),
      cropWInput, el('span', {}, ' Ã— '), cropHInput,
    ]);
    cropSizeRow.style.display = s.autoCrop ? '' : 'none';
    m.appendChild(cropSizeRow);

    // 3Ã—3 anchor grid (hidden by default)
    const anchor = { x: s.cropAnchorX, y: s.cropAnchorY };
    const anchorGrid = el('div', { class: 'anchor-grid' });
    const cells = [];
    const GLYPHS = [
      ['â†–', 'top-left',     'left',    'top'],
      ['â†‘', 'top-center',   'center',  'top'],
      ['â†—', 'top-right',    'right',   'top'],
      ['â†', 'middle-left',  'left',    'center'],
      ['Â·', 'center',       'center',  'center'],
      ['â†’', 'middle-right', 'right',   'center'],
      ['â†™', 'bottom-left',  'left',    'bottom'],
      ['â†“', 'bottom-center','center',  'bottom'],
      ['â†˜', 'bottom-right', 'right',   'bottom'],
    ];
    for (let i = 0; i < GLYPHS.length; i++) {
      const [glyph, name, x, y] = GLYPHS[i];
      const cell = el('button', {
        type: 'button',
        class: 'anchor-cell' + (x === anchor.x && y === anchor.y ? ' selected' : ''),
        title: `Anchor: ${name} (crop keeps the ${name} corner)`,
        'data-x': x, 'data-y': y,
      }, glyph);
      cell.addEventListener('click', () => {
        for (const c of cells) c.classList.remove('selected');
        cell.classList.add('selected');
        anchor.x = x;
        anchor.y = y;
      });
      cells.push(cell);
      anchorGrid.appendChild(cell);
    }
    anchorGrid.style.display = s.autoCrop ? '' : 'none';
    m.appendChild(anchorGrid);

    function setAutoCropVisible(on) {
      cropSizeRow.style.display = on ? '' : 'none';
      anchorGrid.style.display = on ? '' : 'none';
    }
    autoCropCb.addEventListener('change', () => setAutoCropVisible(autoCropCb.checked));

    // ---- "Remove background" sub-section ----
    // Sits BELOW the upscale + auto-crop controls because it's the
    // last step in the pipeline (generate â†’ upscale â†’ crop â†’
    // background removal). The checkbox only saves the boolean
    // (and gates the whole section); the right-click "Remove
    // background" item still works regardless of this toggle.
    // We probe the isnetbg binary in the background so the UI can
    // show a precise "not installed" hint when needed (rather than
    // letting the user enable the toggle and only discover the
    // missing binary at generation time).
    const removeBgCb = el('input', { type: 'checkbox' });
    removeBgCb.checked = !!state.removeBackgroundEnabled;
    const removeBgStatus = el('span', { class: 'meta', style: 'color: var(--fg-2); font-size: 11px; margin-left: 8px;' }, '');
    const removeBgRow = el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [removeBgCb, ' âœ¨ Remove background after upscale']),
      removeBgStatus,
    ]);
    m.appendChild(removeBgRow);
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 11px; margin: 2px 0 0;' },
      'Runs the optional isnetbg binary on the upscaled (and optionally cropped) image and writes a transparent PNG. The original file is preserved as the input to this step.'));
    // GPU sub-toggle. Visible only when the main checkbox is on, so
    // we don't tease a knob the user can't currently act on.
    const useGpuCb = el('input', { type: 'checkbox' });
    useGpuCb.checked = state.removeBackgroundUseGpu !== false;
    const useGpuRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', { class: 'auto-crop-label' }, [useGpuCb, ' use GPU acceleration (DirectML / CUDA)']),
    ]);
    useGpuRow.style.display = removeBgCb.checked ? '' : 'none';
    m.appendChild(useGpuRow);
    function setRemoveBgVisible(on) {
      useGpuRow.style.display = on ? '' : 'none';
    }
    removeBgCb.addEventListener('change', () => setRemoveBgVisible(removeBgCb.checked));
    // Probe the binary in the background and surface a precise
    // status. We use a small helper so the right-click "Remove
    // background" action can reuse the same probe + status text.
    probeIsnetbgStatus().then((st) => {
      if (!st.checked) return;
      if (st.available && st.modelPresent) {
        // Same binary/node disambiguation as the add-ons popup.
        const isNode = st.version === 'node-onnxruntime';
        if (isNode) {
          removeBgStatus.textContent = '(IS-Net Node.js wrapper + model detected)';
        } else {
          const v = st.version ? ` v${st.version}` : '';
          removeBgStatus.textContent = `(isnetbg binary${v} + model detected)`;
        }
        removeBgStatus.style.color = 'var(--fg-2)';
      } else if (st.available && !st.modelPresent) {
        removeBgStatus.textContent = '(binary installed, model missing â€” see README)';
        removeBgStatus.style.color = 'var(--warn, #d9a300)';
      } else {
        removeBgStatus.textContent = '(not installed â€” see README)';
        removeBgStatus.style.color = 'var(--warn, #d9a300)';
      }
    });

    // "Re-open add-ons" link. The full install UI lives in
    // openOptionalAddons() and is shown as a first-run popup;
    // this link gives the user a one-click re-entry from the
    // settings popup without having to dig through the README.
    // Cached probe is invalidated inside openOptionalAddons
    // after every install, so the next time the user opens
    // THIS popup the new status is reflected.
    const reopenLink = el('button', {
      class: 'btn-mini',
      style: 'margin-top: 6px;',
      onclick: () => openOptionalAddons({ autoOpened: false }),
    }, 'ðŸ§© Re-open add-ons managerâ€¦');
    m.appendChild(reopenLink);

    // ---- Section 3: ðŸ—œ Optimize / Compress (post-generation) ----
    // Re-encodes every generated image with the Sharp + libvips
    // pipeline in src/imageOptimizer.js. Sits at the END of the
    // post-processing chain (generate â†’ upscale â†’ crop â†’ remove
    // background â†’ optimize) so the user's final deliverable
    // lands in the smallest possible file. The right-click
    // "Optimize / Compressâ€¦" entry in the folder browser uses
    // the same settings as defaults.
    if (!state.optimizeSettings) {
      state.optimizeSettings = { enabled: false, quality: 82, format: 'keep', stripMetadata: true };
    }
    const oSet = state.optimizeSettings;
    if (typeof oSet.enabled !== 'boolean') oSet.enabled = false;
    if (typeof oSet.quality !== 'number') oSet.quality = 82;
    if (typeof oSet.format !== 'string') oSet.format = 'keep';
    if (typeof oSet.stripMetadata !== 'boolean') oSet.stripMetadata = true;

    const optimizeCb = el('input', { type: 'checkbox' });
    optimizeCb.checked = !!oSet.enabled;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [optimizeCb, ' ðŸ—œ Optimize / compress the final image']),
    ]));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 11px; margin: 2px 0 0;' },
      'Re-encodes the final image with Sharp + libvips to shrink its file size while preserving best-possible visual quality. Runs as the LAST step of the post-generation pipeline so the output you end up with is the smallest version that still looks the same.'));

    // Quality slider (1..100, default 82 â€” the perceptual sweet
    // spot for JPEG / WebP). Visible only when the master
    // checkbox is on, so we don't tease a knob the user can't
    // currently act on.
    const qualityInput = el('input', { type: 'range', min: '1', max: '100', step: '1', value: String(oSet.quality) });
    const qualityLabel = el('span', { class: 'meta', style: 'min-width: 32px; text-align: right;' }, String(qualityInput.value));
    function syncQuality() { qualityLabel.textContent = String(qualityInput.value); }
    qualityInput.addEventListener('input', syncQuality);
    const qualityRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', {}, 'Quality'),
      qualityInput,
      qualityLabel,
    ]);
    qualityRow.style.display = optimizeCb.checked ? '' : 'none';
    m.appendChild(qualityRow);

    // Format dropdown (Keep / JPEG / PNG / WebP / AVIF). Same
    // shape as the right-click overlay; "Keep" preserves the
    // source format.
    const fmtSel = el('select', {});
    for (const [v, lbl] of [
      ['keep', 'Keep source format'],
      ['jpeg', 'JPEG (smallest lossy, no transparency)'],
      ['png',  'PNG  (lossless, supports transparency)'],
      ['webp', 'WebP (modern, ~30% smaller than JPEG)'],
      ['avif', 'AVIF (newest, smallest files, slow encode)'],
    ]) {
      const opt = el('option', { value: v }, lbl);
      if (oSet.format === v) opt.selected = true;
      fmtSel.appendChild(opt);
    }
    const fmtRow = el('div', { class: 'row auto-crop-only' }, [el('label', {}, 'Output format'), fmtSel]);
    fmtRow.style.display = optimizeCb.checked ? '' : 'none';
    m.appendChild(fmtRow);

    // Strip-metadata checkbox. On by default â€” drops EXIF
    // (camera model, GPS, software tag) but keeps the ICC
    // colour profile.
    const stripCb = el('input', { type: 'checkbox' });
    stripCb.checked = oSet.stripMetadata !== false;
    const stripRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', { class: 'auto-crop-label' }, [stripCb, ' Strip non-essential EXIF (keeps ICC colour profile)']),
    ]);
    stripRow.style.display = optimizeCb.checked ? '' : 'none';
    m.appendChild(stripRow);
    function setOptimizeVisible(on) {
      qualityRow.style.display = on ? '' : 'none';
      fmtRow.style.display = on ? '' : 'none';
      stripRow.style.display = on ? '' : 'none';
    }
    optimizeCb.addEventListener('change', () => setOptimizeVisible(optimizeCb.checked));

    // Save
    const saveBtn = el('button', { class: 'primary' }, 'Save');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    saveBtn.addEventListener('click', async () => {
      state.upscaleSettings = {
        multiplier: parseInt(multSel.value, 10) || 2,
        autoCrop: autoCropCb.checked,
        cropWidth: Math.max(0, parseInt(cropWInput.value, 10) || 0),
        cropHeight: Math.max(0, parseInt(cropHInput.value, 10) || 0),
        cropAnchorX: anchor.x,
        cropAnchorY: anchor.y,
      };
      state.removeBackgroundEnabled = !!removeBgCb.checked;
      state.removeBackgroundUseGpu = !!useGpuCb.checked;
      state.optimizeSettings = {
        enabled: !!optimizeCb.checked,
        quality: Math.max(1, Math.min(100, parseInt(qualityInput.value, 10) || 82)),
        format: ['keep', 'jpeg', 'png', 'webp', 'avif'].includes(fmtSel.value) ? fmtSel.value : 'keep',
        stripMetadata: !!stripCb.checked,
      };
      state.upscaleEnabled = true;
      await scheduleStateSave();
      if (typeof refreshUpscaleCheckboxUI === 'function') refreshUpscaleCheckboxUI();
      const extras = [];
      if (state.upscaleSettings.autoCrop) extras.push('auto-crop');
      if (state.removeBackgroundEnabled) extras.push('remove-background');
      if (state.optimizeSettings.enabled) {
        extras.push('optimize Q' + state.optimizeSettings.quality);
      }
      const extra = extras.length ? ' + ' + extras.join(' + ') : '';
      // The "ðŸ” Upscale 2Ã—" label in the image tab was updated by
      // a closure inside build(); that closure is long gone by
      // the time the user opens this modal. refreshUpscaleLabel
      // is the module-level re-render that picks up the new
      // multiplier + .active class via DOM query.
      if (typeof refreshUpscaleLabel === 'function') refreshUpscaleLabel();
      toast(`Upscale settings saved (${state.upscaleSettings.multiplier}Ã—${extra}).`, 'ok', 2000);
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, saveBtn]));
  });
}

// Direct upscale overlay used by the right-click menu on an image
// in the file browser. Shows the source resolution + the target
// resolution after upscaling, an "auto-crop to resolution" toggle,
// and (when that toggle is on) a 3Ã—3 anchor grid + W/H inputs so
// the user can upscale AND crop in one step. The flow:
//   1. upscaleImageFile() writes `<name>_Nx.png` to output_dir.
//   2. If auto-crop is on, cropImageFile() reads it back, places
//      the crop frame at the chosen anchor (top-left, center,
//      bottom-right, etc.), writes `<name>_Nx_cropped_WxH.png`,
//      and the intermediate `_Nx` file is deleted.
//   3. The cropped file is shown in the preview pane.
async function showUpscaleDirect(srcPath) {
  // We need the source's natural resolution to compute the target.
  // If the image is unreadable, surface the error and bail â€” the
  // dialog needs a known sourceW Ã— sourceH to do anything useful.
  let srcW = 0, srcH = 0;
  try {
    const img = await loadImageFromFile(srcPath);
    srcW = img.naturalWidth;
    srcH = img.naturalHeight;
    if (!srcW || !srcH) throw new Error('Image has no natural dimensions');
  } catch (e) {
    toast('Failed to load image: ' + (e && e.message || e), 'err', 6000);
    return;
  }
  // Pull defaults from the global upscale settings so the
  // right-click "Upscale" dialog and the tab's "Upscale Settings"
  // dialog are in sync. The user can still change anything for
  // this one-off run; the Save below updates state.upscaleSettings
  // if they do, so the next right-click / next generation sees
  // the new values.
  const us = state.upscaleSettings || { multiplier: 2, autoCrop: false, cropWidth: 0, cropHeight: 0, cropAnchorX: 'center', cropAnchorY: 'center' };
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'ðŸ” Upscale image'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      'Source: ' + srcPath));

    // Resolution row: source (immutable) + target after upscale (live).
    // The target updates whenever the multiplier or crop W/H changes.
    const targetText = el('div', { class: 'meta' }, '');
    function refreshTarget() {
      const mult = parseInt(multSel.value, 10) || 2;
      const tW = srcW * mult;
      const tH = srcH * mult;
      // 0 = use post-upscale target. Negative is impossible (the
      // min="0" attribute + Math.max in the save handler guard it).
      const wantCropW = parseInt(cropWInput.value, 10);
      const wantCropH = parseInt(cropHInput.value, 10);
      const cropW = (isNaN(wantCropW) || wantCropW <= 0) ? tW : wantCropW;
      const cropH = (isNaN(wantCropH) || wantCropH <= 0) ? tH : wantCropH;
      const w = Math.min(cropW, tW);
      const h = Math.min(cropH, tH);
      const cropNote = autoCropCb.checked ? ` Â· after auto-crop: ${w} Ã— ${h} px` : '';
      targetText.textContent = `Source ${srcW} Ã— ${srcH} px  â†’  after upscale: ${tW} Ã— ${tH} px${cropNote}`;
    }

    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Resolution'), targetText]));

    // Multiplier selector (2Ã— / 3Ã— / 4Ã— / 8Ã—).
    const multSel = el('select', {});
    for (const m2 of [2, 3, 4, 8]) {
      const opt = el('option', { value: String(m2) }, `${m2}Ã—`);
      if (m2 === (us.multiplier || 2)) opt.selected = true;
      multSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Multiplier'), multSel]));

    // auto-crop checkbox. Pre-checked from state.upscaleSettings.
    const autoCropCb = el('input', { type: 'checkbox', class: 'auto-crop-cb' });
    autoCropCb.checked = !!us.autoCrop;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [autoCropCb, ' auto-crop to resolution']),
    ]));

    // Crop W / H inputs. Hidden by default; revealed when auto-crop
    // is checked. Pre-filled from state.upscaleSettings (or 0 = use
    // post-upscale target).
    const cropWInput = el('input', { type: 'number', min: '0', value: String(us.cropWidth || 0) });
    const cropHInput = el('input', { type: 'number', min: '0', value: String(us.cropHeight || 0) });
    const cropSizeRow = el('div', { class: 'row auto-crop-only' }, [
      el('label', {}, 'Crop target W Ã— H (0 = use post-upscale target)'),
      cropWInput, el('span', {}, ' Ã— '), cropHInput,
    ]);
    cropSizeRow.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(cropSizeRow);

    // 3Ã—3 anchor grid. Each cell = an (x, y) anchor in {left,
    // center, right} Ã— {top, center, bottom}. The selected cell
    // comes from state.upscaleSettings.
    const anchor = { x: us.cropAnchorX || 'center', y: us.cropAnchorY || 'center' };
    const anchorGrid = el('div', { class: 'anchor-grid' });
    const cells = [];
    const GLYPHS = [
      ['â†–', 'top-left',     'left',    'top'],
      ['â†‘', 'top-center',   'center',  'top'],
      ['â†—', 'top-right',    'right',   'top'],
      ['â†', 'middle-left',  'left',    'center'],
      ['Â·', 'center',       'center',  'center'],
      ['â†’', 'middle-right', 'right',   'center'],
      ['â†™', 'bottom-left',  'left',    'bottom'],
      ['â†“', 'bottom-center','center',  'bottom'],
      ['â†˜', 'bottom-right', 'right',   'bottom'],
    ];
    for (let i = 0; i < GLYPHS.length; i++) {
      const [glyph, name, x, y] = GLYPHS[i];
      const cell = el('button', {
        type: 'button',
        class: 'anchor-cell' + (x === anchor.x && y === anchor.y ? ' selected' : ''),
        title: `Anchor: ${name} (crop keeps the ${name} corner)`,
        'data-x': x, 'data-y': y,
      }, glyph);
      cell.addEventListener('click', () => {
        for (const c of cells) c.classList.remove('selected');
        cell.classList.add('selected');
        anchor.x = x;
        anchor.y = y;
      });
      cells.push(cell);
      anchorGrid.appendChild(cell);
    }
    anchorGrid.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(anchorGrid);

    // A short explanation of the cropping section, so the user
    // doesn't have to guess what the 3Ã—3 grid + W Ã— H inputs
    // actually do. Uses inline <code> tags for the glyphs.
    const cropExplanation = el('div', { class: 'crop-explanation' }, [
      'When you click Upscale, the image is first scaled up by ',
      el('strong', {}, `${us.multiplier || 2}Ã—`),
      ' (using the Real-ESRGAN binary if installed, otherwise multi-step canvas upscaling), then ',
      el('strong', {}, 'cropped'),
      ' to the target W Ã— H at the chosen anchor. The 3Ã—3 grid above picks the anchor: ',
      el('code', {}, 'â†–'),
      ' keeps the ',
      el('strong', {}, 'top-left'),
      ' corner, ',
      el('code', {}, 'Â·'),
      ' keeps equal borders on all four sides, ',
      el('code', {}, 'â†˜'),
      ' keeps the ',
      el('strong', {}, 'bottom-right'),
      '.',
    ]);
    cropExplanation.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(cropExplanation);

    // Blank-image crop preview: a fixed 200Ã—150 "source" with a
    // green crop frame overlay that updates whenever the user
    // picks a different anchor (or changes the W Ã— H inputs).
    // The frame is sized proportionally to the post-upscale
    // target W Ã— H so the user can see how much of the image
    // is actually kept.
    const cropPreviewBlock = el('div', { class: 'crop-preview' });
    const stage = el('div', { class: 'crop-preview-stage' });
    const blank = el('div', { class: 'crop-preview-image' });
    const frame = el('div', { class: 'crop-preview-frame' });
    stage.append(blank, frame);
    cropPreviewBlock.appendChild(stage);
    const legend = el('div', { class: 'crop-preview-legend' });
    cropPreviewBlock.appendChild(legend);
    const ANCHOR_LABELS = {
      'left-top':       'top-left',
      'center-top':     'top-center',
      'right-top':      'top-right',
      'left-center':    'middle-left',
      'center-center':  'center',
      'right-center':   'middle-right',
      'left-bottom':    'bottom-left',
      'center-bottom':  'bottom-center',
      'right-bottom':   'bottom-right',
    };
    function refreshCropPreview() {
      const mult = parseInt(multSel.value, 10) || 2;
      const stageW = 200, stageH = 150;
      // The stage represents the post-upscale source. We scale
      // it to fit the stage keeping its real aspect ratio.
      const aspect = srcW / srcH;
      let dispSrcW, dispSrcH;
      if (aspect >= stageW / stageH) {
        dispSrcW = stageW;
        dispSrcH = stageW / aspect;
      } else {
        dispSrcH = stageH;
        dispSrcW = stageH * aspect;
      }
      const srcOffsetX = (stageW - dispSrcW) / 2;
      const srcOffsetY = (stageH - dispSrcH) / 2;
      // Frame size: use the user's W Ã— H if set, otherwise the
      // full post-upscale target.
      const tW = srcW * mult;
      const tH = srcH * mult;
      const wantW = parseInt(cropWInput.value, 10);
      const wantH = parseInt(cropHInput.value, 10);
      let cropW = (Number.isFinite(wantW) && wantW > 0) ? Math.min(wantW, tW) : tW;
      let cropH = (Number.isFinite(wantH) && wantH > 0) ? Math.min(wantH, tH) : tH;
      // Scale the frame to the displayed source size.
      const scale = dispSrcW / tW;
      const frameW = cropW * scale;
      const frameH = cropH * scale;
      const maxX = dispSrcW - frameW;
      const maxY = dispSrcH - frameH;
      let x, y;
      if (anchor.x === 'left')       x = 0;
      else if (anchor.x === 'right') x = maxX;
      else                            x = Math.floor(maxX / 2);
      if (anchor.y === 'top')         y = 0;
      else if (anchor.y === 'bottom') y = maxY;
      else                            y = Math.floor(maxY / 2);
      frame.style.width = frameW + 'px';
      frame.style.height = frameH + 'px';
      frame.style.left = (srcOffsetX + x) + 'px';
      frame.style.top = (srcOffsetY + y) + 'px';
      // Position the blank "image" to match the source size.
      blank.style.left = srcOffsetX + 'px';
      blank.style.top = srcOffsetY + 'px';
      blank.style.width = dispSrcW + 'px';
      blank.style.height = dispSrcH + 'px';
      // Legend.
      legend.innerHTML = '';
      const name = ANCHOR_LABELS[anchor.x + '-' + anchor.y] || 'center';
      legend.appendChild(document.createTextNode('Anchor: '));
      legend.appendChild(el('span', { class: 'crop-preview-anchor-name' }, name));
      legend.appendChild(document.createTextNode(' â€” the green frame shows what will be kept.'));
    }
    cropPreviewBlock.style.display = us.autoCrop ? '' : 'none';
    m.appendChild(cropPreviewBlock);

    // Toggle the auto-crop sub-UI. We do this in a single place so
    // the show / hide stays in sync and the target text always
    // reflects the current state.
    function setAutoCropVisible(on) {
      cropSizeRow.style.display = on ? '' : 'none';
      anchorGrid.style.display = on ? '' : 'none';
      cropExplanation.style.display = on ? '' : 'none';
      cropPreviewBlock.style.display = on ? '' : 'none';
      if (on) {
        // The preview depends on a few derived values; recompute
        // on show so the user sees the current W Ã— H + anchor.
        refreshCropPreview();
      }
      refreshTarget();
    }
    autoCropCb.addEventListener('change', () => setAutoCropVisible(autoCropCb.checked));
    multSel.addEventListener('change', refreshTarget);
    cropWInput.addEventListener('input', refreshTarget);
    cropHInput.addEventListener('input', refreshTarget);
    // The crop preview also re-renders on any input change.
    multSel.addEventListener('change', refreshCropPreview);
    cropWInput.addEventListener('input', refreshCropPreview);
    cropHInput.addEventListener('input', refreshCropPreview);
    // Each anchor cell already updates anchor.x/y; we also
    // re-render the crop preview on click.
    for (const cell of cells) cell.addEventListener('click', refreshCropPreview);
    setAutoCropVisible(!!us.autoCrop); // also primes the W/H inputs + target text
    if (us.autoCrop) refreshCropPreview();

    // ---- "Remove background" sub-section for the right-click dialog ----
    // Pre-checked from state.removeBackgroundEnabled (same default as
    // the in-tab flow). Lives BELOW the upscale + crop UI so it reads
    // as the final pipeline step. A status badge next to the checkbox
    // tells the user whether the binary + model are installed, so they
    // don't click "Upscale" expecting a transparent result and only
    // discover the missing binary halfway through.
    const noBgCb = el('input', { type: 'checkbox' });
    noBgCb.checked = !!state.removeBackgroundEnabled;
    const noBgStatus = el('span', { class: 'meta', style: 'color: var(--fg-2); font-size: 11px; margin-left: 8px;' }, '');
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [noBgCb, ' âœ¨ Remove background after upscale']),
      noBgStatus,
    ]));
    probeIsnetbgStatus().then((st) => {
      if (!st.checked) return;
      if (st.available && st.modelPresent) {
        // Same binary/node disambiguation as the add-ons popup.
        const isNode = st.version === 'node-onnxruntime';
        if (isNode) {
          noBgStatus.textContent = '(IS-Net Node.js wrapper + model detected)';
        } else {
          const v = st.version ? ` v${st.version}` : '';
          noBgStatus.textContent = `(isnetbg binary${v} + model detected)`;
        }
        noBgStatus.style.color = 'var(--fg-2)';
      } else if (st.available && !st.modelPresent) {
        noBgStatus.textContent = '(model missing â€” see README)';
        noBgStatus.style.color = 'var(--warn, #d9a300)';
      } else {
        noBgStatus.textContent = '(not installed)';
        noBgStatus.style.color = 'var(--warn, #d9a300)';
      }
    });

    const upscaleBtn = el('button', { class: 'primary' }, 'Upscale');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    upscaleBtn.addEventListener('click', async () => {
      const multiplier = parseInt(multSel.value, 10) || 2;
      // Persist whatever the user just configured so the next
      // right-click / next batch / next âš™ Settings visit sees
      // the same values. We don't scheduleStateSave() here
      // (the action is fire-and-forget and the user can cancel);
      // scheduleStateSave() is called below on success.
      state.upscaleSettings = {
        multiplier,
        autoCrop: !!autoCropCb.checked,
        cropWidth: Math.max(0, parseInt(cropWInput.value, 10) || 0),
        cropHeight: Math.max(0, parseInt(cropHInput.value, 10) || 0),
        cropAnchorX: anchor.x,
        cropAnchorY: anchor.y,
      };
      // Persist the background-removal toggle too. The right-click
      // dialog is the natural place for users to flip this on /
      // off; making it sticky avoids re-checking the same box on
      // the next image.
      state.removeBackgroundEnabled = !!noBgCb.checked;
      state.upscaleEnabled = true;
      upscaleBtn.disabled = true; upscaleBtn.textContent = 'Upscalingâ€¦';
      // `final` is the path to the file we want to preview at the
      // end of the pipeline. It gets reassigned by the optional
      // crop + background-removal steps, and is the only file
      // that should be left on disk for the user to see.
      let final = null;
      try {
        // Step 1: upscale.
        const upscaled = await upscaleImageFile(srcPath, multiplier);
        // Step 2: optionally crop.
        if (autoCropCb.checked) {
          upscaleBtn.textContent = 'Croppingâ€¦';
          const cropW = Math.max(1, parseInt(cropWInput.value, 10) || 1);
          const cropH = Math.max(1, parseInt(cropHInput.value, 10) || 1);
          // Need the actual upscaled dimensions to anchor correctly.
          const upImg = await loadImageFromFile(upscaled);
          const uW = upImg.naturalWidth;
          const uH = upImg.naturalHeight;
          // Clamp the crop to the upscaled size; anchor otherwise.
          const w = Math.min(cropW, uW);
          const h = Math.min(cropH, uH);
          const maxX = uW - w;
          const maxY = uH - h;
          let x, y;
          if (anchor.x === 'left')       x = 0;
          else if (anchor.x === 'right') x = maxX;
          else                            x = Math.floor(maxX / 2);
          if (anchor.y === 'top')         y = 0;
          else if (anchor.y === 'bottom') y = maxY;
          else                            y = Math.floor(maxY / 2);
          const cropped = await cropImageFile(upscaled, x, y, w, h);
          // Drop the intermediate (full-upscaled) file â€” the user
          // asked for the cropped one, not the raw intermediate.
          window.api.fbDelete(upscaled).catch(() => {});
          final = cropped;
        } else {
          final = upscaled;
        }
        // Step 3: optionally remove the background. Non-fatal: a
        // missing / failed binary keeps the upscaled (or cropped)
        // file as the deliverable and surfaces a warning toast,
        // so the user never loses the image they already paid
        // API credits to generate.
        if (noBgCb.checked) {
          upscaleBtn.textContent = 'Removing backgroundâ€¦';
          try {
            const noBg = await removeBackgroundFile(final);
            if (noBg !== final) {
              window.api.fbDelete(final).catch(() => {});
              final = noBg;
            }
            toast(`Upscaled ${multiplier}Ã— + background removed â†’ ${final}`, 'ok', 4500);
          } catch (e) {
            console.error('Remove background failed:', e);
            toast('Background removal failed (kept upscaled image): ' + (e && e.message || e), 'warn', 5000);
          }
        } else {
          toast(`Upscaled to ${multiplier}Ã— â†’ ${final}`, 'ok', 4000);
        }
        await refreshBrowser();
        if (typeof updatePreviewPane === 'function' && final) {
          try { previewImageFromFile(final); } catch (_) {}
        }
        // Persist the new upscale settings now that we know the
        // upscale succeeded. (The setting is also updated in-place
        // by the input listeners, but a state.json round-trip
        // through the debounced scheduleStateSave isn't guaranteed
        // to have fired yet.)
        try { await scheduleStateSave(); } catch (_) {}
        close();
      } catch (e) {
        toast('Upscale' + (autoCropCb.checked ? '+crop' : '') + ' failed: ' + (e && e.message || e), 'err', 6000);
        upscaleBtn.disabled = false;
        upscaleBtn.textContent = 'Upscale';
      }
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, upscaleBtn]));
  });
}

// Crop overlay. The image is rendered at its natural pixel size inside
// a scrollable container; the user enters W x H, clicks Apply, and a
// green-bordered draggable frame appears at the specified size. The
// user can drag the frame to position it; clicking Crop finalizes.
function showCropOverlay(srcPath) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'âœ‚ Crop image'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      'Source: ' + srcPath));

    // Inputs row: auto-size checkbox, Width, Height, Apply
    // The "auto-size" checkbox is on by default: when checked, the
    // image and the green crop frame are both scaled to fit inside the
    // stage so a 4K source doesn't overflow the modal. The W/H inputs
    // still describe the crop in image pixels (the scale only affects
    // the on-screen display).
    const autoSizeCb = el('input', { type: 'checkbox', class: 'auto-size-cb' });
    autoSizeCb.checked = true;
    const wInput = el('input', { type: 'number', min: '1', value: '1024' });
    const hInput = el('input', { type: 'number', min: '1', value: '1024' });
    const applyBtn = el('button', { class: 'btn-mini' }, 'Apply');
    const cropBtn = el('button', { class: 'primary' }, 'Crop');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    // The image stage: image + draggable frame overlay.
    const stage = el('div', { class: 'crop-stage' });
    const img = el('img', { class: 'crop-image' });
    // Hidden until we know the image's natural size.
    img.style.visibility = 'hidden';
    stage.appendChild(img);
    let frame = null;
    let frameX = 0, frameY = 0;
    // displayScale converts image pixels -> display pixels:
    //   displayW = imageW * displayScale
    //   displayH = imageH * displayScale
    // When auto-size is on and the image is bigger than the stage,
    // displayScale < 1 so the whole image + frame fit on screen. When
    // auto-size is off, displayScale = 1 (natural size, the original
    // behaviour). The drag handler uses this value to convert
    // display-pixel mouse deltas back into image-pixel positions.
    let displayScale = 1;

    m.appendChild(el('div', { class: 'crop-dim-row' }, [
      el('label', { class: 'auto-size-label' }, [autoSizeCb, ' auto-size']),
      el('label', {}, 'Width'), wInput, el('label', {}, 'Height'), hInput, applyBtn,
    ]));
    m.appendChild(stage);
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, cropBtn]));

    // Recompute the image's CSS size + the displayScale. Called when
    // the image finishes loading and when the user toggles the
    // checkbox. Reads the stage's actual client size (subtracting the
    // 4px padding on each side) so the math holds even after the
    // modal has been resized by the user.
    function applyAutoSize() {
      if (!img.naturalW) return;
      const stageW = stage.clientWidth || 1;
      const stageH = stage.clientHeight || 1;
      if (autoSizeCb.checked) {
        // Fit completely; never upscale beyond 1:1 (so we don't
        // bloat a small image to look pixelated).
        const s = Math.min(stageW / img.naturalW, stageH / img.naturalH, 1);
        displayScale = isFinite(s) && s > 0 ? s : 1;
      } else {
        displayScale = 1;
      }
      img.style.width = (img.naturalW * displayScale) + 'px';
      img.style.height = (img.naturalH * displayScale) + 'px';
    }
    autoSizeCb.addEventListener('change', () => {
      applyAutoSize();
      if (frame) showFrame();
    });

    // Load the image. Once decoded, show it and pre-fill W/H with the
    // natural size so the user can immediately Apply.
    loadImageFromFile(srcPath).then((loaded) => {
      img.naturalW = loaded.naturalWidth;
      img.naturalH = loaded.naturalHeight;
      img.src = loaded.src;
      img.style.visibility = '';
      wInput.value = String(loaded.naturalWidth);
      hInput.value = String(loaded.naturalHeight);
      applyAutoSize();
    }).catch((e) => {
      toast('Failed to load image: ' + e.message, 'err', 6000);
      close();
    });

    // Create / recreate the frame at the specified W x H, centered.
    // frameX/frameY are always in IMAGE pixels; the CSS left/top are
    // scaled by displayScale so the frame visually fits the image.
    function showFrame() {
      const w = Math.max(1, parseInt(wInput.value, 10) || 1);
      const h = Math.max(1, parseInt(hInput.value, 10) || 1);
      if (img.naturalW && (w > img.naturalW || h > img.naturalH)) {
        toast(`Frame size ${w}Ã—${h} exceeds image size ${img.naturalW}Ã—${img.naturalH}.`, 'warn', 4000);
        return;
      }
      if (frame) frame.remove();
      frame = el('div', { class: 'crop-frame', title: 'Drag to position' });
      // Display size = image size * scale
      frame.style.width = (w * displayScale) + 'px';
      frame.style.height = (h * displayScale) + 'px';
      // Center the frame initially
      frameX = Math.max(0, Math.floor((img.naturalW - w) / 2));
      frameY = Math.max(0, Math.floor((img.naturalH - h) / 2));
      // Display position = image position * scale
      frame.style.left = (frameX * displayScale) + 'px';
      frame.style.top = (frameY * displayScale) + 'px';
      stage.appendChild(frame);
      // Pass displayScale so the drag handler can convert
      // display-pixel mouse deltas to image-pixel positions.
      setupCropFrameDrag(frame, stage, () => img.naturalW, () => img.naturalH,
        (x, y) => { frameX = x; frameY = y; }, displayScale);
    }
    applyBtn.addEventListener('click', showFrame);

    cropBtn.addEventListener('click', async () => {
      if (!frame) { toast('Click Apply first to position the crop frame.', 'warn'); return; }
      const w = parseInt(wInput.value, 10) || 1;
      const h = parseInt(hInput.value, 10) || 1;
      cropBtn.disabled = true; cropBtn.textContent = 'Croppingâ€¦';
      try {
        const out = await cropImageFile(srcPath, frameX, frameY, w, h);
        toast(`Cropped to ${w}Ã—${h} â†’ ${out}`, 'ok', 4000);
        await refreshBrowser();
        if (typeof updatePreviewPane === 'function') {
          try { previewImageFromFile(out); } catch (_) {}
        }
        close();
      } catch (e) {
        toast('Crop failed: ' + (e && e.message || e), 'err', 6000);
        cropBtn.disabled = false; cropBtn.textContent = 'Crop';
      }
    });
  });
}

// Make the crop frame draggable, constrained to the image bounds.
// `displayScale` is the image-pixel-to-display-pixel ratio used by
// the parent overlay (1.0 = no scaling). When the image is rendered
// smaller than its natural size (because the auto-size checkbox is
// on and the source is larger than the stage), the frame's CSS
// width/height/left/top are in display pixels but the bounds checks
// and the position we report back to the caller are in image
// pixels. We convert at the boundary.
function setupCropFrameDrag(frame, stage, getImageW, getImageH, onMove, displayScale = 1) {
  let dragging = false;
  let startX, startY, frameStartImgX, frameStartImgY;
  function onDown(e) {
    e.preventDefault();
    dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX; startY = pt.clientY;
    // The frame's CSS left/top is in display pixels. Convert to
    // image pixels so the move deltas below are in the right space.
    frameStartImgX = Math.round((parseInt(frame.style.left, 10) || 0) / displayScale);
    frameStartImgY = Math.round((parseInt(frame.style.top, 10) || 0) / displayScale);
    document.addEventListener('mousemove', onMv);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMv, { passive: false });
    document.addEventListener('touchend', onUp);
  }
  function onMv(e) {
    if (!dragging) return;
    e.preventDefault && e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    // Frame size in image pixels = CSS size / displayScale.
    const w = Math.round((parseInt(frame.style.width, 10) || 1) / displayScale);
    const h = Math.round((parseInt(frame.style.height, 10) || 1) / displayScale);
    const iw = getImageW() || 1;
    const ih = getImageH() || 1;
    // Convert display-pixel mouse deltas to image pixels.
    const dImgX = Math.round(dx / displayScale);
    const dImgY = Math.round(dy / displayScale);
    let nx = Math.max(0, Math.min(frameStartImgX + dImgX, iw - w));
    let ny = Math.max(0, Math.min(frameStartImgY + dImgY, ih - h));
    // Write back as display pixels.
    frame.style.left = (nx * displayScale) + 'px';
    frame.style.top = (ny * displayScale) + 'px';
    if (onMove) onMove(nx, ny);
  }
  function onUp() {
    dragging = false;
    document.removeEventListener('mousemove', onMv);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMv);
    document.removeEventListener('touchend', onUp);
  }
  frame.addEventListener('mousedown', onDown);
  frame.addEventListener('touchstart', onDown, { passive: false });
}

// Format-converter overlay. Shows the source format and a dropdown of
// supported targets (PNG, JPEG, WebP). Output file uses the new
// extension; quality is fixed at 0.95.
function showConvertOverlay(srcPath) {
  const ext = (srcPath.split('.').pop() || '').toLowerCase();
  const srcFmt = ext.toUpperCase() || '?';
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'â‡„ Convert image format'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      'Source: ' + srcPath));
    const srcFmtLabel = el('input', { type: 'text', value: srcFmt, readonly: '' });
    const outSel = el('select', {});
    // Supported output targets. All three are written natively by
    // canvas.toDataURL (Chromium supports image/webp since v32).
    for (const [v, lbl] of [
      ['png',  'PNG  (lossless, supports transparency)'],
      ['jpeg', 'JPEG (smaller files, no transparency)'],
      ['webp', 'WebP (modern, smaller files)'],
    ]) {
      const opt = el('option', { value: v }, lbl);
      // Default to a different format than the source
      if (v !== ext) opt.selected = true;
      outSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Input format'), srcFmtLabel]));
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Output format'), outSel]));
    const convertBtn = el('button', { class: 'primary' }, 'Convert');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    convertBtn.addEventListener('click', async () => {
      const target = outSel.value;
      if (target === ext) {
        toast('Source and target format are the same â€” nothing to do.', 'warn', 3000);
        return;
      }
      convertBtn.disabled = true; convertBtn.textContent = 'Convertingâ€¦';
      try {
        const out = await convertImageFile(srcPath, target);
        toast(`Converted to ${target.toUpperCase()} â†’ ${out}`, 'ok', 4000);
        await refreshBrowser();
        if (typeof updatePreviewPane === 'function') {
          try { previewImageFromFile(out); } catch (_) {}
        }
        close();
      } catch (e) {
        toast('Convert failed: ' + (e && e.message || e), 'err', 6000);
        convertBtn.disabled = false; convertBtn.textContent = 'Convert';
      }
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, convertBtn]));
  });
}

// Image-optimisation overlay used by the folder-browser right-click
// menu ("ðŸ—œ Optimize / Compressâ€¦"). Lets the user re-encode a
// single image to shrink its file size while preserving best-
// possible visual quality, using the Sharp-backed `image:optimize`
// IPC.
//
// Three controls, matching the spec:
//   - Quality slider (1..100, default 82 â€” the perceptual sweet
//     spot for JPEG / WebP).
//   - Format dropdown (Keep / JPEG / PNG / WebP / AVIF). "Keep"
//     preserves the source format; the other four re-encode the
//     image to the target format (e.g. PNG â†’ WebP for ~30%
//     smaller files at the same Q).
//   - "Strip non-essential EXIF (keep ICC profile)" checkbox, on
//     by default â€” drops camera model / GPS / software tags but
//     keeps the colour profile so the image still renders
//     correctly on colour-managed displays.
//
// On success, the dialog stays open and shows a results block
// ("4.2 MB â†’ 612 KB Â· 85% smaller") with a one-click "Open
// folder" link. The user can keep clicking "Run" with different
// settings without re-opening the dialog (the slider
// reposition would otherwise re-trigger the action).
function showOptimizeOverlay(srcPath) {
  const ext = (srcPath.split('.').pop() || '').toLowerCase();
  const srcFmt = (ext === 'jpg' ? 'jpeg' : ext) || 'jpeg';
  // Pre-fill from the persisted settings so the user only has to
  // override the field they care about on a given run. The
  // settings dialog (Upscale settings â†’ "Optimize" sub-section)
  // shares the same state, so a user who picked Q=70 for
  // "all generated images" gets the same starting point here.
  const cfg = state.optimizeSettings || { quality: 82, format: 'keep', stripMetadata: true };
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'ðŸ—œ Optimize / Compress image'));
    m.appendChild(el('p', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px;' },
      'Source: ' + srcPath));

    // ---- Quality slider ----
    // The slider's range is 1..100. We display the current value
    // next to the slider so the user always knows the exact
    // number they're picking. Default 82 (perceptually lossless
    // on photographic content).
    const qualityInput = el('input', { type: 'range', min: '1', max: '100', step: '1', value: String(cfg.quality || 82) });
    const qualityLabel = el('span', { class: 'meta', style: 'min-width: 32px; text-align: right;' }, String(qualityInput.value));
    function syncQuality() { qualityLabel.textContent = String(qualityInput.value); }
    qualityInput.addEventListener('input', syncQuality);
    m.appendChild(el('div', { class: 'row' }, [
      el('label', {}, 'Quality'),
      qualityInput,
      qualityLabel,
    ]));
    // Tiny "presets" row so a user who's new to the concept can
    // jump to the canonical "sweet spot" with one click. The
    // explicit slider next to it is still the source of truth.
    const presetRow = el('div', { class: 'row', style: 'gap: 4px; flex-wrap: wrap;' });
    for (const [q, lbl] of [[60, 'small (60)'], [75, 'balanced (75)'], [82, 'max quality (82)'], [95, 'near-lossless (95)']]) {
      const b = el('button', { class: 'btn-mini', type: 'button' }, lbl);
      b.addEventListener('click', () => {
        qualityInput.value = String(q);
        syncQuality();
      });
      presetRow.appendChild(b);
    }
    m.appendChild(presetRow);

    // ---- Format dropdown ----
    // "Keep" preserves the source format; the other four re-encode
    // the image. We never show the current source format as a
    // separate "Same" option â€” that's exactly what "Keep" means.
    const fmtSel = el('select', {});
    const fmtDefs = [
      ['keep', `Keep source (${srcFmt.toUpperCase()})`],
      ['jpeg', 'JPEG (smallest lossy, no transparency)'],
      ['png',  'PNG  (lossless, supports transparency)'],
      ['webp', 'WebP (modern, ~30% smaller than JPEG)'],
      ['avif', 'AVIF (newest, smallest files, slow encode)'],
    ];
    for (const [v, lbl] of fmtDefs) {
      const opt = el('option', { value: v }, lbl);
      if ((cfg.format || 'keep') === v) opt.selected = true;
      fmtSel.appendChild(opt);
    }
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Output format'), fmtSel]));

    // ---- Strip-metadata checkbox ----
    // On by default. Drops EXIF (camera model, GPS, software
    // tag) but keeps the ICC colour profile (see
    // src/imageOptimizer.js for the exact pipeline).
    const stripCb = el('input', { type: 'checkbox' });
    stripCb.checked = cfg.stripMetadata !== false;
    m.appendChild(el('div', { class: 'row' }, [
      el('label', { class: 'auto-crop-label' }, [stripCb, ' Strip non-essential EXIF (keeps ICC colour profile)']),
    ]));

    // ---- Run / status / results block ----
    // The status row + results block live inside the same
    // container so the dialog can be re-used for multiple
    // consecutive runs (e.g. user picks a different Q, hits
    // Run again). Results are wiped on each click.
    const runBtn = el('button', { class: 'primary' }, 'ðŸ—œ Optimize');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    const status = el('div', { class: 'meta', style: 'color: var(--fg-2); font-size: 12px; min-height: 16px; margin: 4px 0;' }, '');
    const resultsBox = el('div', { style: 'margin: 8px 0; display: none;' });
    m.appendChild(status);
    m.appendChild(resultsBox);

    // Run handler. Catches failures into a single toast and
    // keeps the dialog open (with the Run button re-enabled) so
    // the user can fix a corrupt file or change settings and
    // retry without re-opening the dialog.
    runBtn.addEventListener('click', async () => {
      const quality = Math.max(1, Math.min(100, parseInt(qualityInput.value, 10) || 82));
      const format = fmtSel.value;
      const stripMetadata = stripCb.checked;
      // Persist the latest values so a subsequent "Optimize" run
      // from the right-click menu pre-fills the same settings.
      state.optimizeSettings = { quality, format, stripMetadata };
      await scheduleStateSave();

      runBtn.disabled = true;
      runBtn.textContent = 'Optimizingâ€¦';
      status.textContent = `Re-encoding at quality ${quality}â€¦`;
      resultsBox.style.display = 'none';
      resultsBox.innerHTML = '';
      try {
        const r = await optimizeImageFile(srcPath, { quality, format, stripMetadata });
        // Build a human-friendly results block. The exact bytes
        // and percent saved are shown so the user can see
        // whether the slider change was worth it. The link
        // re-selects the optimised file in the file browser
        // and opens its containing folder in Explorer.
        const fmtLbl = (r.format || '').toUpperCase() || '?';
        const inSize = humanSize(r.inputSize);
        const outSize = humanSize(r.outputSize);
        const saved = r.savedPercent || 0;
        const colorClass = saved >= 30 ? 'ok' : (saved >= 10 ? 'meta' : 'warn');
        const dimLbl = r.width && r.height ? `${r.width} Ã— ${r.height}` : '';
        resultsBox.innerHTML = '';
        resultsBox.style.display = '';
        resultsBox.appendChild(el('div', { class: 'fb-item-info' }, [
          el('div', { class: 'fb-info-row' }, [
            el('span', { class: 'fb-info-key' }, 'Result'),
            el('span', { style: 'color: var(--' + (saved >= 30 ? 'ok' : 'fg-1') + ');' },
              `${inSize} â†’ ${outSize}  (âˆ’${saved}%)`),
          ]),
          el('div', { class: 'fb-info-row' }, [
            el('span', { class: 'fb-info-key' }, 'Format'),
            el('span', {}, fmtLbl + (dimLbl ? ` Â· ${dimLbl}` : '')),
          ]),
          el('div', { class: 'fb-info-row' }, [
            el('span', { class: 'fb-info-key' }, 'Output'),
            el('span', { style: 'word-break: break-all;' }, r.outputPath),
          ]),
        ]));
        // "Reveal in Explorer" + "Preview" buttons, so the user
        // doesn't have to dig through the folder browser to
        // find the result.
        const revealBtn = el('button', { class: 'btn-mini', onclick: () => window.api.fbReveal(r.outputPath) }, 'â†— Reveal in Explorer');
        const previewBtn = el('button', { class: 'btn-mini', onclick: () => { try { previewImageFromFile(r.outputPath); } catch (_) {} } }, 'ðŸ–¼ Preview');
        resultsBox.appendChild(el('div', { class: 'row', style: 'margin-top: 6px; gap: 6px;' }, [revealBtn, previewBtn]));
        // Refresh the file browser so the new sibling shows up
        // in the listing.
        try { await refreshBrowser(); } catch (_) {}
        // Toast + status so the user gets a clear "it worked"
        // signal even if they missed the inline result block.
        const tone = saved >= 1 ? 'ok' : 'info';
        toast(`Optimized ${inSize} â†’ ${outSize} (âˆ’${saved}%) â†’ ${r.outputPath}`, tone, 4000);
        status.textContent = `Done. ${inSize} â†’ ${outSize} (âˆ’${saved}%).`;
        // Mark the saved settings as "the ones the user just
        // ran with" so a follow-up right-click on the optimised
        // file pre-fills the same choices.
        runBtn.disabled = false;
        runBtn.textContent = 'ðŸ—œ Optimize';
      } catch (e) {
        // Structured failure from the IPC. Show the precise
        // message in the status line (toast is redundant here
        // because the user is staring at the dialog).
        status.textContent = 'Failed: ' + (e && e.message || e);
        toast('Optimize failed: ' + (e && e.message || e), 'err', 6000);
        runBtn.disabled = false;
        runBtn.textContent = 'ðŸ—œ Optimize';
      }
    });
    m.appendChild(el('div', { class: 'footer' }, [cancelBtn, runBtn]));
  });
}

// ----------------- Long-hover tooltip -----------------

// ----------------- Long-hover tooltip -----------------
// The .lastcmd element shows a single line of the most recent mmx command,
// but the command is usually longer than the visible area (ellipsized). On
// hover >1s, show the full text in a floating popup. Event-delegated so it
// works for every tab's lastcmd without explicit setup per build().
function setupLastCmdTooltips() {
  let timer = null;
  let popup = null;
  let activeEl = null;
  let hideTimer = null;
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (popup) { popup.remove(); popup = null; }
    activeEl = null;
  };
  const scheduleHide = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(cancel, 250);
  };
  document.addEventListener('mouseover', (e) => {
    const t = e.target && e.target.closest && e.target.closest('.lastcmd');
    if (!t) return;
    if (t === activeEl) return;
    cancel();
    activeEl = t;
    const text = (t.textContent || '').trim();
    if (!text) return;
    timer = setTimeout(() => {
      if (activeEl !== t) return;
      popup = document.createElement('div');
      popup.className = 'long-hover-tooltip';
      popup.textContent = text;
      // Allow text selection inside the popup so the user can copy the
      // command. Also pause auto-hide while the pointer is over the popup.
      popup.addEventListener('mouseenter', () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } });
      popup.addEventListener('mouseleave', scheduleHide);
      document.body.appendChild(popup);
      const r = t.getBoundingClientRect();
      const pr = popup.getBoundingClientRect();
      let top = r.top - pr.height - 6;
      let left = r.left;
      if (top < 4) top = r.bottom + 6;
      // Right clamp
      if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
      // Left clamp
      if (left < 8) left = 8;
      popup.style.position = 'fixed';
      popup.style.top = top + 'px';
      popup.style.left = left + 'px';
      timer = null;
    }, 1000);
  });
  document.addEventListener('mouseout', (e) => {
    const t = e.target && e.target.closest && e.target.closest('.lastcmd');
    if (!t) return;
    // If the mouse is moving into the popup, keep it visible.
    if (popup && e.relatedTarget && (e.relatedTarget === popup || popup.contains(e.relatedTarget))) return;
    scheduleHide();
  });
  // Cancel on scroll/resize so the popup never drifts from its anchor
  window.addEventListener('scroll', cancel, true);
  window.addEventListener('resize', cancel);
  // Click anywhere dismisses the popup
  document.addEventListener('click', (e) => {
    if (popup && e.target !== popup && !popup.contains(e.target)) cancel();
  }, true);
}

// ----------------- File browser -----------------
async function refreshBrowser(opts = {}) {
  // Prefer the per-tab saved folder (set when the user last visited this
  // tab), then the current fbDir, then the output root.
  const saved = (state.currentTab && state.fbDirs[state.currentTab]) || '';
  let startDir = state.fbDir || saved || state.config.output_dir || '';
  let out = await window.api.fbList(startDir);
  // If the user had a per-tab folder persisted but it's gone (deleted,
  // drive removed, etc.) â€” fall back to the output root instead of just
  // showing an error and forcing the user to click "Refresh". Same
  // fallback if the live fbDir fails for the same reason.
  if (!out.ok && startDir && startDir !== (state.config.output_dir || '')) {
    if (state.currentTab && state.fbDirs[state.currentTab]) {
      state.fbDirs[state.currentTab] = '';
      scheduleStateSave();
    }
    state.fbDir = '';
    const fallback = state.config.output_dir || '';
    if (fallback) {
      startDir = fallback;
      out = await window.api.fbList(fallback);
    }
  }
  if (!out.ok) {
    $('#fb-list').innerHTML = '';
    $('#fb-path').textContent = out.error || '(no output dir)';
    return;
  }
  // For the file browser, default to current tab's subfolder if it exists.
  // Skip this when:
  //   - opts.keepCurrent is set (e.g. the Up button)
  //   - we already have a saved per-tab folder (the user has navigated
  //     within this tab before â€” respect their choice)
  let target = out;
  if (!opts.keepCurrent && !saved) {
    const sub = pathJoin(target.dir, state.currentTab);
    const subTry = await window.api.fbList(sub);
    if (subTry.ok) target = subTry;
  }
  state.fbDir = target.dir;
  // Keep the per-tab slot in sync with the actual browser location so
  // navigating within a tab (e.g. via the Up button) is remembered. Also
  // trigger an autosave so the new folder survives an app restart even
  // if the user never switches tabs afterwards.
  if (state.currentTab && state.fbDirs[state.currentTab] !== target.dir) {
    state.fbDirs[state.currentTab] = target.dir;
    scheduleStateSave();
  }
  $('#fb-path').textContent = target.dir;
  $('#fb-path').title = target.dir;
  // Apply the user's preferred sort before rendering so the DOM
  // is created in the right order on the first paint (avoids a
  // flicker of "server-side default" â†’ "user's sort" on every
  // refresh). sortFbItems never mutates the input array.
  const sorted = sortFbItems(target.items, state.fbSort);
  renderFbList(sorted);
  // Apply current search filter if any
  applyFileSearch();
}

// Whitelist of valid sort modes. The dropdown only ever offers one
// of these, but we re-validate on read so a corrupted state.json
// can't inject an arbitrary string into the comparator. The value
// `null` / `undefined` / unknown falls through to the default
// (name-asc, dirs-first).
const FB_SORT_MODES = new Set([
  'name-asc', 'name-desc',
  'size-desc', 'size-asc',
  'mtime-desc', 'mtime-asc',
  'created-desc', 'created-asc',
  'type-asc',
]);
function normalizeFbSort(mode) {
  return (typeof mode === 'string' && FB_SORT_MODES.has(mode)) ? mode : 'name-asc';
}
// "Natural" name comparison: file_2.png sorts before file_10.png.
// Plain String.localeCompare is lexicographic and would sort
// file_10.png before file_2.png. We split each name into runs of
// digits and non-digits, compare the non-digit runs as strings and
// the digit runs as numbers â€” close to what Windows Explorer does.
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const aParts = String(a || '').toLowerCase().match(re) || [];
  const bParts = String(b || '').toLowerCase().match(re) || [];
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const ap = aParts[i], bp = bParts[i];
    const an = /^\d/.test(ap), bn = /^\d/.test(bp);
    if (an && bn) {
      // Numeric compare â€” strip leading zeros so "001" and "1" tie.
      const an2 = parseInt(ap, 10), bn2 = parseInt(bp, 10);
      if (an2 !== bn2) return an2 - bn2;
    } else if (ap !== bp) {
      return ap.localeCompare(bp);
    }
  }
  return aParts.length - bParts.length;
}
// Re-sort an array of fs-items according to the user's preferred
// sort mode. Always returns a NEW array; the input is never
// mutated. The default is "name-asc, dirs-first" (the same order
// the main process returns), so a no-op call (mode === 'name-asc'
// on a list that was already sorted by name) is cheap.
function sortFbItems(items, mode) {
  const m = normalizeFbSort(mode);
  const arr = Array.isArray(items) ? items.slice() : [];
  // Directories always come first, regardless of the chosen sort.
  // (Windows Explorer behaviour: the user expects to find folders
  // at the top.) We honour this by sorting on the dir-flag first
  // and the user's chosen key second.
  const cmp = (a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    switch (m) {
      case 'name-desc':
        return naturalCompare(b.name, a.name);
      case 'size-desc':
        // Files only â€” directories have size 0 and shouldn't dominate.
        return (Number(b.size) || 0) - (Number(a.size) || 0);
      case 'size-asc':
        return (Number(a.size) || 0) - (Number(b.size) || 0);
      case 'mtime-desc':
        return (Number(b.mtimeMs) || 0) - (Number(a.mtimeMs) || 0);
      case 'mtime-asc':
        return (Number(a.mtimeMs) || 0) - (Number(b.mtimeMs) || 0);
      case 'created-desc': {
        // Fall back to mtimeMs when birthtime isn't available
        // (FAT32 / some non-NTFS volumes return 0).
        const av = Number(a.birthtimeMs) || Number(a.mtimeMs) || 0;
        const bv = Number(b.birthtimeMs) || Number(b.mtimeMs) || 0;
        return bv - av;
      }
      case 'created-asc': {
        const av = Number(a.birthtimeMs) || Number(a.mtimeMs) || 0;
        const bv = Number(b.birthtimeMs) || Number(b.mtimeMs) || 0;
        return av - bv;
      }
      case 'type-asc': {
        // Sort by extension (case-insensitive), then by name. Files
        // with no extension sort to the end.
        const ae = (a.ext || '').toLowerCase();
        const be = (b.ext || '').toLowerCase();
        if (ae !== be) return ae.localeCompare(be);
        return naturalCompare(a.name, b.name);
      }
      case 'name-asc':
      default:
        return naturalCompare(a.name, b.name);
    }
  };
  arr.sort(cmp);
  return arr;
}

// ----------------- File-browser columns -----------------
// Each column is a self-describing object that tells the renderer
//   1. its stable id (key into state.fbColumns),
//   2. its user-visible label (header + overlay checkbox),
//   3. the CSS grid template it occupies in the row,
//   4. a render(item) function that produces the cell's DOM
//      children (text + optional title for the full value).
// The "name" column is mandatory and is NOT in this list â€” the
// row always renders it. Adding it here would let the user turn
// it off, which would make the row unscannable.
const FB_COLUMNS = [
  {
    id: 'size',
    label: 'Size',
    // "auto" so the column shrinks to the longest byte-string
    // we have. The row uses min-width to keep the column from
    // collapsing to 0.
    gridTemplate: 'minmax(70px, auto)',
    render: (it) => {
      if (it.isDir) return ['', ''];
      const text = humanSize(it.size);
      return [text, String(it.size || 0)];
    },
  },
  {
    id: 'type',
    label: 'Type',
    gridTemplate: 'minmax(60px, auto)',
    render: (it) => {
      if (it.isDir) return ['â€”', 'folder'];
      const ext = (it.ext || '').replace(/^\./, '').toUpperCase();
      return [ext || 'â€”', ext];
    },
  },
  {
    id: 'mtime',
    label: 'Modified',
    gridTemplate: 'minmax(130px, auto)',
    render: (it) => {
      const ms = Number(it.mtimeMs) || 0;
      if (!ms) return ['â€”', ''];
      // Locale date + short time, e.g. "2024-03-15 14:30".
      // The full ISO is on the title so the user can inspect.
      const d = new Date(ms);
      const text = d.toLocaleString();
      return [text, d.toISOString()];
    },
  },
  {
    id: 'created',
    label: 'Created',
    gridTemplate: 'minmax(130px, auto)',
    render: (it) => {
      const ms = Number(it.birthtimeMs) || 0;
      if (!ms) return ['â€”', ''];
      const d = new Date(ms);
      const text = d.toLocaleString();
      return [text, d.toISOString()];
    },
  },
  {
    id: 'path',
    label: 'Path',
    // The path column is wide; allow it to grow to fit long
    // folder names but cap at a reasonable max so the row
    // doesn't always horizontally scroll.
    gridTemplate: 'minmax(220px, 1fr)',
    render: (it) => {
      return [it.path || '', it.path || ''];
    },
  },
];
// Sanitise state.fbColumns: coerce every known id to a boolean,
// and ignore any unknown id (corrupted state.json / future
// version). The "name" column is always implicitly on.
function normalizeFbColumns(cols) {
  const out = {};
  for (const c of FB_COLUMNS) {
    out[c.id] = !!(cols && cols[c.id]);
  }
  return out;
}
// Build the CSS grid-template-columns string for the file
// browser rows. Order: icon + name (mandatory), then the
// user-enabled columns in declaration order.
//
// The icon column is wider (40px) when the image-thumbnail
// toggle is on so a small thumbnail can be centered in the
// cell. The 16px default matches the old behaviour for plain
// icons â€” the change is invisible to the user unless they
// enable thumbnails.
function buildFbGridTemplate() {
  const iconW = state.fbThumbnails ? '44px' : '16px';
  const cols = [iconW, 'minmax(120px, 1fr)'];
  const fbCols = normalizeFbColumns(state.fbColumns);
  for (const c of FB_COLUMNS) {
    if (fbCols[c.id]) cols.push(c.gridTemplate);
  }
  return cols.join(' ');
}
// Helper: true if `ext` is one of the image formats the
// thumbnail renderer can preview. Duplicated from iconForFile
// so the two lists stay in sync at the call site; we do not
// import from iconForFile because that returns the unicode
// emoji and we need the extension list directly.
function _isImageExt(ext) {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes((ext || '').toLowerCase());
}
// Build the icon cell (the first column) for a file-browser row.
// Renders either a centered thumbnail of the actual image file or
// the regular text icon. The cell carries a CSS class
// ('fb-thumb' or 'fb-icon') so styles.css can pick the right
// alignment per mode.
function _buildFbIconCell(it) {
  if (state.fbThumbnails && !it.isDir && _isImageExt(it.ext)) {
    const wrap = el('span', { class: 'icon fb-thumb', title: it.name + ' â€” thumbnail' });
    const img = el('img', {
      src: fileUrl(it.path),
      alt: '',
      loading: 'lazy',
      // Decoding async keeps the list scroll smooth even when a
      // folder contains hundreds of images.
      decoding: 'async',
    });
    img.addEventListener('error', () => {
      // If the thumbnail can't load (deleted file, permission
      // problem) fall back to the regular icon so the row still
      // shows something. We replace the <img> in-place rather
      // than recreating the row so the row's click handlers stay
      // attached.
      wrap.classList.remove('fb-thumb');
      wrap.classList.add('fb-icon');
      wrap.textContent = iconForFile(it.ext);
      wrap.title = it.name;
    });
    wrap.appendChild(img);
    return wrap;
  }
  return el('span', { class: 'icon fb-icon', title: '' }, it.isDir ? 'ðŸ“' : iconForFile(it.ext));
}

// Open the folder-options overlay. Lists every optional column
// as a checkbox (the "name" column is shown but locked on), and
// the "Sort" dropdown. The user toggles a column, clicks
// "Apply" (or just sees the change live via the change event),
// and the folder explorer re-renders with the new layout. The
// overlay re-renders the folder explorer immediately on every
// change so the user can see the columns appear / disappear
// before closing the modal.
function openFolderOptions() {
  showModal((m, close) => {
    m.classList.add('folder-options-modal');
    m.appendChild(el('h2', {}, 'ðŸ“ Folder options'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Pick which columns the folder explorer shows. The file-name column is always visible â€” turning it off would make the list unscannable. The horizontal scroll bar at the bottom of the list appears automatically when the columns don\'t fit the available width. Changes apply immediately.'));

    // Image-thumbnail toggle. When on, image rows in the file
    // browser show a centered thumbnail of the actual file
    // instead of the ðŸ–¼ icon. Row heights grow automatically so
    // the thumbnail is fully visible even when every column is
    // enabled. Folder rows and non-image files are unaffected.
    const thumbCb = el('input', { type: 'checkbox', class: 'folder-options-thumbnail-cb' });
    thumbCb.checked = !!state.fbThumbnails;
    thumbCb.addEventListener('change', () => {
      state.fbThumbnails = !!thumbCb.checked;
      scheduleStateSave();
      if (Array.isArray(state._fbItems) && state._fbItems.length) {
        renderFbList(sortFbItems(state._fbItems, state.fbSort));
        applyFileSearch();
      }
    });
    const thumbLabel = el('label', { class: 'folder-options-thumbnail-label' }, [
      thumbCb,
      el('span', {}, 'Show image thumbnails in the folder list'),
    ]);
    m.appendChild(thumbLabel);

    // Column checkboxes
    const cols = normalizeFbColumns(state.fbColumns);
    const colGrid = el('div', { class: 'folder-options-cols' });
    for (const c of FB_COLUMNS) {
      const cb = el('input', { type: 'checkbox', class: 'folder-options-col-cb' });
      cb.checked = !!cols[c.id];
      cb.addEventListener('change', () => {
        state.fbColumns[c.id] = !!cb.checked;
        scheduleStateSave();
        // Re-render the live list so the user sees the column
        // appear / disappear immediately, without having to
        // close the modal first.
        if (Array.isArray(state._fbItems) && state._fbItems.length) {
          renderFbList(sortFbItems(state._fbItems, state.fbSort));
          applyFileSearch();
        }
      });
      const label = el('label', { class: 'folder-options-col-label' }, [
        cb,
        el('span', { class: 'folder-options-col-name' }, c.label),
      ]);
      colGrid.appendChild(label);
    }
    // "Name" column (mandatory) â€” shown but locked, so the user
    // knows the column order but can't accidentally remove it.
    {
      const cb = el('input', { type: 'checkbox', checked: 'checked', disabled: 'disabled' });
      const label = el('label', { class: 'folder-options-col-label folder-options-col-locked' }, [
        cb,
        el('span', { class: 'folder-options-col-name' }, 'File name (always shown)'),
      ]);
      colGrid.appendChild(label);
    }
    m.appendChild(colGrid);

    // Footer with Close.
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { class: 'primary', onclick: close }, 'Close'),
    ]));
  });
}

function parentDir(p) {
  if (!p) return '';
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\/]/).filter(Boolean);
  parts.pop();
  return parts.length ? parts.join(sep) : '';
}

function applyFileSearch() {
  const q = ($('#fb-search')?.value || '').toLowerCase();
  for (const item of $$('.fb-item')) {
    if (!q) { item.style.display = ''; continue; }
    const name = (item.dataset.name || item.querySelector('.name')?.textContent || '').toLowerCase();
    item.style.display = name.includes(q) ? '' : 'none';
  }
}

function pathJoin(a, b) {
  if (!a) return b;
  const sep = a.includes('\\') ? '\\' : '/';
  return a.replace(/[\\/]+$/, '') + sep + b;
}

// Mark an element as a drag-and-drop target. When a file from this list (or
// the ".." entry) is dropped on it, the file is moved to `destDir`. Highlights
// the element while a drag is hovering over it.
function _attachDropTarget(elNode, destDir) {
  if (!elNode || !destDir) return;
  elNode.addEventListener('dragover', (e) => {
    // Only accept our internal MIME type; ignore OS file drops.
    if (Array.from(e.dataTransfer.types || []).includes('application/x-minimax-fb')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      elNode.classList.add('fb-drop-target');
    }
  });
  elNode.addEventListener('dragleave', () => {
    elNode.classList.remove('fb-drop-target');
  });
  elNode.addEventListener('drop', async (e) => {
    e.preventDefault();
    elNode.classList.remove('fb-drop-target');
    const path = e.dataTransfer.getData('application/x-minimax-fb');
    if (!path) return;
    if (path.toLowerCase() === destDir.toLowerCase()) return;
    // Refuse to move a folder into itself or any descendant.
    const pLow = path.replace(/[\\/]+$/, '').toLowerCase();
    const dLow = destDir.replace(/[\\/]+$/, '').toLowerCase();
    if (dLow.startsWith(pLow + (destDir.includes('\\') ? '\\' : '/'))) {
      toast('Cannot move a folder into itself.', 'warn');
      return;
    }
    const r = await window.api.fbMove(path, destDir);
    if (r.ok) {
      toast('Moved.', 'ok');
      await refreshBrowser();
    } else {
      toast('Move failed: ' + (r.error || 'unknown error'), 'err');
    }
  });
}

function renderFbList(items) {
  const ul = $('#fb-list');
  ul.innerHTML = '';
  // v1.1.1 polish: empty-state hint. The previous version
  // rendered an empty <ul> with no message, which made a
  // new or empty folder look like a broken page. The hint
  // tells the user what to do next (pick a folder, or
  // generate an image) and dismisses itself as soon as a
  // file appears. Rendered inside the <ul> so the layout
  // flexes correctly with the splitter resizes.
  if (!items || items.length === 0) {
    const empty = el('li', { class: 'fb-empty' });
    const isOutput = state.fbDir && state.config.output_dir
      && state.fbDir.toLowerCase() === state.config.output_dir.toLowerCase();
    empty.appendChild(el('div', { class: 'fb-empty-title' }, isOutput ? 'This folder is empty' : 'No items'));
    empty.appendChild(el('div', { class: 'fb-empty-hint' },
      isOutput
        ? 'Click Generate on a tab above to create your first asset.'
        : 'Click ðŸ“‚ to pick a folder, or â†‘ to go up.'));
    ul.appendChild(empty);
    return;
  }
  // Apply the user's selected columns by setting a CSS
  // grid-template-columns on the <ul>. The column definitions in
  // FB_COLUMNS (see above) drive the template string. The
  // <ul> uses `min-width: max-content` so the grid expands
  // beyond the available width when necessary â€” the
  // overflow-x: auto on the list then kicks in to provide a
  // horizontal scroll bar (see styles.css). The "name" column
  // uses minmax(120px, 1fr) so the file name always gets at
  // least 120px, and the path column (when enabled) takes the
  // remaining 1fr.
  ul.style.gridTemplateColumns = buildFbGridTemplate();
  // Tag the <ul> so CSS knows which alignment to apply: thumbs
  // get a taller row + centered image; plain icons are
  // left-aligned (the user explicitly asked for left-alignment
  // when thumbnails are off). The class is also useful for the
  // zebra-striping rule which uses :nth-child(even) and would
  // otherwise re-paint the wrong row in the wider thumbnail
  // variant.
  ul.classList.toggle('fb-thumbs-on', !!state.fbThumbnails);
  ul.classList.toggle('fb-thumbs-off', !state.fbThumbnails);
  // Snapshot the rendered items on state so other helpers (e.g.
  // markFbItemActive when the user is shown a preview/overlay for a
  // path) can look up the full fs-item record (size, ext, mtime)
  // without re-fetching from the main process. This was previously
  // only available via DOM lookups, which limited context-menu code
  // to operations that only needed the path.
  state._fbItems = Array.isArray(items) ? items.slice() : [];
  // Show ".. (up)" whenever we're inside a real subdir of the output root.
  const outRoot = state.config.output_dir || '';
  if (state.fbDir && outRoot && state.fbDir.toLowerCase() !== outRoot.toLowerCase()) {
    const parent = el('li', { class: 'fb-item' }, [
      el('span', { class: 'icon fb-icon' }, 'â†©'),
      el('span', { class: 'name' }, '.. (up)'),
      // .. gets a "size" column so the row stays aligned with
      // the regular rows below it; the other columns (if any)
      // are not rendered for the parent row to keep the visual
      // noise down.
      el('span', { class: 'size' }, 'â€”'),
    ]);
    parent.addEventListener('click', () => {
      // Go up one level
      const sep = state.fbDir.includes('\\') ? '\\' : '/';
      const parts = state.fbDir.split(/[\\/]/).filter(Boolean);
      parts.pop();
      state.fbDir = parts.join(sep) || outRoot;
      refreshBrowser();
    });
    // Drop a file on ".." to move it into the parent dir.
    const _parentDir = parentDir(state.fbDir) || outRoot;
    _attachDropTarget(parent, _parentDir);
    ul.appendChild(parent);
  } else if (state.fbDir && outRoot && state.fbDir.toLowerCase() === outRoot.toLowerCase()) {
    // At the output root, but allow one "Open in Explorer" hint as a no-op row? Skip.
  }
  // Sanitise the column flags once per render so the inner loop
  // can read the booleans without re-checking the object shape.
  const fbCols = normalizeFbColumns(state.fbColumns);
  for (const it of items) {
    // Build the row's children. Icon + name are mandatory; the
    // rest of the cells come from FB_COLUMNS, in order, with a
    // CSS class matching the column id (so user styles can
    // target e.g. ".fb-item .col-size" without false-positives
    // on incidental matches).
    const cellEls = [
      _buildFbIconCell(it),
      el('span', { class: 'name', title: it.name }, it.name),
    ];
    for (const c of FB_COLUMNS) {
      if (!fbCols[c.id]) continue;
      const [text, title] = c.render(it);
      const cls = `col-${c.id}`;
      cellEls.push(el('span', { class: cls, title: title || '' }, text));
    }
    const li = el('li', {
      class: 'fb-item',
      'data-path': it.path,
      'data-isdir': it.isDir ? '1' : '0',
      'data-name': it.name,
      draggable: it.isDir ? 'false' : 'true',
    }, cellEls);
    li.addEventListener('click', (e) => {
      $$('.fb-item', ul).forEach((n) => n.classList.remove('selected'));
      li.classList.add('selected');
      state._selected = it;
      // Single-click on an image: also push it into the bottom-right
      // Picture preview pane so the user gets immediate visual feedback
      // without having to double-click first. Audio/text still need
      // double-click to open in the tab preview (they need a real
      // <audio> / <pre> element which lives inside a tab).
      if (!it.isDir && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext)) {
        previewImageFromFile(it.path);
      }
    });
    li.addEventListener('dblclick', () => openItem(it));
    // Drag-and-drop: dragging a file over a folder moves it there. We do NOT
    // expose the actual native file path (Electron doesn't allow it), so the
    // drag is internal to the app. We use a custom MIME type so external
    // drops are ignored.
    if (!it.isDir) {
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-minimax-fb', it.path);
        e.dataTransfer.effectAllowed = 'move';
      });
    }
    // Folders accept drops: dropping a file onto a folder moves it inside.
    if (it.isDir) {
      _attachDropTarget(li, it.path);
    }
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      $$('.fb-item', ul).forEach((n) => n.classList.remove('selected'));
      li.classList.add('selected');
      state._selected = it;
      showItemContextMenu(it, e.clientX, e.clientY);
    });
    ul.appendChild(li);
  }
}

function iconForFile(ext) {
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'ðŸ–¼';
  if (['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm'].includes(ext)) return 'ðŸŽµ';
  if (['.mp4', '.mov', '.webm', '.mkv'].includes(ext)) return 'ðŸŽ¬';
  if (['.srt', '.txt', '.json', '.md'].includes(ext)) return 'ðŸ“„';
  return 'ðŸ“„';
}

function humanSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

async function openItem(it) {
  // Defensive: items from the FS list always have {path, ext, isDir}, but
  // a future caller might pass a partial object. Bail out cleanly instead
  // of dereferencing undefined and getting a confusing stack trace.
  if (!it || !it.path) { toast('Invalid file item.', 'err'); return; }
  if (it.isDir) {
    state.fbDir = it.path;
    await refreshBrowser();
  } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext)) {
    previewImageFromFile(it.path);
  } else if (['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.pcm'].includes(it.ext)) {
    previewAudioFromFile(it.path);
  } else if (['.txt', '.srt', '.json', '.md', '.lrc'].includes(it.ext)) {
    previewTextFromFile(it.path);
  } else {
    await window.api.fbReveal(it.path);
  }
}

// Mark the file-browser row that corresponds to `path` as the
// currently-active item (the same `.selected` class that the click
// handler in renderFbList applies when the user clicks the row).
// Also scrolls the row into view if it's currently off-screen.
//
// The user's spec is: "the file clicked and shown last in the image
// preview element (and its full image viewer) should always be marked
// as active in the folder explorer". This helper is the single place
// that enforces that. Every preview path / overlay open should call
// it with the path the user is currently looking at, so the row in
// the file browser never lags behind the preview pane.
//
// `path` is matched case-insensitively (Windows paths are
// case-insensitive in practice) and against the `data-path` attribute
// set by renderFbList. We deliberately ignore the `..` (up) row
// because it has no data-path.
function markFbItemActive(path) {
  if (!path || typeof path !== 'string') return;
  const ul = $('#fb-list');
  if (!ul) return;
  // De-select all rows, then select the one matching `path`. The
  // pre-existing click handler also removes `.selected` from every
  // row first, so the behaviour is consistent.
  const target = path.toLowerCase();
  const rows = $$('.fb-item', ul);
  let match = null;
  for (const li of rows) {
    const isMatch = (li.getAttribute('data-path') || '').toLowerCase() === target;
    li.classList.toggle('selected', isMatch);
    if (isMatch) match = li;
  }
  if (match) {
    // Update state._selected so the right-click context menu operates
    // on the same item the user sees as "active" in the preview pane.
    // We only set _selected to a directory-shaped object if we have
    // an existing fs-item record; otherwise the context menu would
    // be missing the size/ext metadata. Look it up by path from the
    // last-rendered list (state._fbItems is populated by
    // refreshBrowser when we wired it up â€” see the read in the
    // helper below).
    if (Array.isArray(state._fbItems)) {
      const found = state._fbItems.find((it) => (it.path || '').toLowerCase() === target);
      if (found) state._selected = found;
    }
    // Scroll into view if needed. The "nearest" choice keeps the
    // current scroll position when the row is already visible, so
    // a click within the visible area doesn't jump the view.
    try { match.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
  }
}

function previewImageFromFile(p) {
  // Images from the file browser go to the new Picture preview pane
  // (bottom-right of the log bar), not the tab's generation preview.
  // The tab's generation preview is reserved for content that the user
  // just generated. We pre-load the image to grab the natural dimensions
  // so the overlay has the right size info, and so the title hint shows.
  if (!p) {
    // Defensive: a null/empty path used to silently render a broken
    // img with src="" (the <img> onerror fired and the pane got a
    // tiny invisible placeholder). Reset to the empty state instead
    // so the user sees the "Click an image" hint again.
    const content = $('#fb-preview-content');
    if (content) content.innerHTML = '<div class="preview-pane-empty">Click an image in the file browser to preview it here.</div>';
    state._lastPreviewPath = null;
    state._previewBatch = null;
    return;
  }
  // If the user clicks the same file twice, the preview is already
  // showing it â€” don't waste a re-decode + flicker on the redundant
  // click. We compare on the file path (the naturalWidth wouldn't
  // have changed since the file didn't change).
  if (state._lastPreviewPath === p) return;
  state._lastPreviewPath = p;
  // A single-image preview always replaces the multi-image grid (if
  // any was showing). Clear _previewBatch so the image-overlay's
  // arrow-key handler doesn't try to navigate the now-stale batch.
  state._previewBatch = null;
  // Per the user's spec, the file shown in the preview pane should
  // always be the active row in the folder explorer. We mark it
  // BEFORE the async image decode so the highlight is instant and
  // does not flicker after the image paints.
  markFbItemActive(p);
  const url = fileUrl(p);
  const filename = (p || '').split(/[\\/]/).pop() || 'image';
  const preLoad = new Image();
  preLoad.onload = () => updatePreviewPane(url, filename, preLoad.naturalWidth, preLoad.naturalHeight, p);
  preLoad.onerror = () => updatePreviewPane(url, filename, 0, 0, p);
  preLoad.src = url;
}

// Multi-file variant of previewImageFromFile. Used by the image tab's
// generate handler after a batch (or --n > 1) run completes, so the
// user can see ALL the generated images at once in the right-side
// folder-explorer's preview pane. Single-file runs delegate to
// previewImageFromFile (the one big image looks the same as before).
//
// For 1 file: show a single fit-to-pane image (no behaviour change).
// For N files: divide the pane into N equal-width slots. Each slot
// shows a small thumbnail + the filename; clicking any thumbnail
// opens the image overlay at 1:1 mode (same flow as the file browser).
// The pane scrolls horizontally if there are too many thumbs to fit
// at the current pane width.
function previewImagesFromFiles(paths) {
  const content = $('#fb-preview-content');
  if (!content) return;
  if (!Array.isArray(paths) || !paths.length) {
    previewImageFromFile(null);
    return;
  }
  // Filter out null / empty paths so a single bad file in a batch
  // doesn't break the whole preview pane.
  const valid = paths.filter((p) => p && typeof p === 'string');
  if (!valid.length) {
    previewImageFromFile(null);
    return;
  }
  if (valid.length === 1) {
    // Single image â†’ the old behaviour, no subdivision needed.
    return previewImageFromFile(valid[0]);
  }
  // N > 1 â†’ grid of thumbnails. Build the container once, then async-
  // resolve each path's natural dimensions for the title hint.
  content.innerHTML = '';
  // Stash the current batch on state so the image overlay's
  // arrow-key handler (added in a later feature) can navigate to
  // the previous / next thumbnail without re-fetching the list
  // from the DOM. The first item in the list is marked as the
  // "currently active" one in the folder explorer (and the
  // preview-pane highlight) until the user clicks a different
  // thumbnail or uses the arrow keys.
  state._previewBatch = {
    paths: valid.slice(),
    // Index of the path that is currently considered "selected"
    // (mirrors what the folder explorer's .selected row is). The
    // openImageOverlay handler updates this on every arrow press.
    index: 0,
  };
  // Per the user's spec, the file shown in the preview pane (or
  // its full image viewer) must always be the active row in the
  // folder explorer. The first image of a freshly-shown batch is
  // the natural default.
  markFbItemActive(valid[0]);
  const grid = el('div', { class: 'preview-pane-grid' });
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    const filename = (p || '').split(/[\\/]/).pop() || 'image';
    const url = fileUrl(p) + '?t=' + Date.now();
    // data-path stores the filesystem path the slot represents.
    // The overlay's arrow-key handler reads it (via
    // navigateToOverlayImage) so the user can step through the
    // multi-image preview-pane thumbnails without losing track of
    // which file is currently highlighted.
    const slot = el('div', {
      class: 'preview-pane-thumb',
      title: filename + ' â€” click to view 1:1',
      'data-path': p,
    });
    if (i === 0) slot.classList.add('preview-active');
    const img = el('img', { src: url, alt: filename, loading: 'lazy' });
    const caption = el('div', { class: 'preview-pane-thumb-caption' }, filename);
    slot.append(img, caption);
    // Flag the click handler attachment so the slow-disk fallback
    // below doesn't double-bind (the previous code used
    // `if (!slot.onclick)`, but addEventListener doesn't write to
    // `.onclick` â€” so both the onload path and the setTimeout path
    // attached a listener, and a single click opened the overlay
    // twice in a row).
    let clickBound = false;
    const bind = (w, h) => {
      if (clickBound) return;
      clickBound = true;
      const open = () => {
        // Update the "selected" thumbnail + folder-explorer's
        // active row so both stay in sync with the user's last
        // action. (The arrow-key handler in openImageOverlay
        // does the same thing on every keypress.) We look up
        // the index in `state._previewBatch.paths` (which is a
        // slice copy of `valid`) rather than comparing array
        // references â€” the previous `===` check was always false
        // because `valid` is created fresh and then sliced into
        // the batch, so the index update was silently dropped.
        if (state._previewBatch && Array.isArray(state._previewBatch.paths)) {
          const found = state._previewBatch.paths.findIndex((q) => (q || '').toLowerCase() === p.toLowerCase());
          if (found >= 0) state._previewBatch.index = found;
        }
        $$('.preview-pane-thumb', grid).forEach((n) => n.classList.remove('preview-active'));
        slot.classList.add('preview-active');
        markFbItemActive(p);
        if (w && h) openImageOverlay(url, filename, w, h, p);
        else openImageOverlay(url, filename, 0, 0, p);
      };
      slot.addEventListener('click', open, { once: true });
    };
    // Resolve the natural size async so the overlay can show it.
    const probe = new Image();
    probe.onload = () => {
      slot.title = `${filename} (${probe.naturalWidth}Ã—${probe.naturalHeight}) â€” click to view 1:1`;
      bind(probe.naturalWidth, probe.naturalHeight);
    };
    probe.onerror = () => bind(0, 0);
    probe.src = url;
    // Fallback: if the probe never resolves (slow disk), still allow a
    // click so the user isn't locked out of the overlay.
    setTimeout(() => bind(0, 0), 3000);
    grid.appendChild(slot);
  }
  content.appendChild(grid);
  // Below the grid, a small summary line so the user knows how many
  // images they got (and the click hint).
  const summary = el('div', { class: 'preview-pane-summary' },
    `${valid.length} image${valid.length === 1 ? '' : 's'} â€” click any thumbnail to open at 1:1.`);
  content.appendChild(summary);
}

// Render the file-browser image into the new Picture preview pane.
// The image is fit-to-content (object-fit: contain in the CSS) so a
// 4K screenshot is shown shrunken and a tiny icon stays at its natural
// size â€” both rendered completely, no cropping. Clicking the image
// (or the filename) opens the image overlay at 1:1 mode.
function updatePreviewPane(src, filename, naturalWidth, naturalHeight, filePath) {
  const content = $('#fb-preview-content');
  if (!content) return;
  content.innerHTML = '';
  const size = (naturalWidth && naturalHeight) ? ` (${naturalWidth}Ã—${naturalHeight})` : '';
  const img = el('img', {
    src,
    alt: filename || '',
    title: (filename || '') + size + ' â€” click to view 1:1',
  });
  img.addEventListener('click', () => {
    openImageOverlay(src, filename, naturalWidth, naturalHeight, filePath);
  });
  content.appendChild(img);
  const fname = el('div', { class: 'preview-pane-filename', title: filename || '' },
    (filename || '') + size);
  content.appendChild(fname);
}

// Track the paths that have already been pushed to the preview
// pane for the current multi-image batch (or single-image preview).
// Used by notifyImageGenerated() to dedupe â€” the same file can
// arrive via the gen handler's "variant complete" callback AND
// the 1s polling, so without this set we'd double-add thumbnails.
// Keyed on lowercase path so a Windows path-case change doesn't
// produce duplicates either.
let _previewedPaths = new Set();
function _resetPreviewedPaths() {
  _previewedPaths = new Set();
}

// Build a single thumbnail slot for the multi-image preview pane.
// Extracted from previewImagesFromFiles so notifyImageGenerated
// can use the same DOM shape when appending new variants. The
// returned slot is already wired up (click handler + data-path)
// and the "preview-active" class is applied if `isActive` is
// true.
function _buildPreviewThumb(p, options) {
  const opts = options || {};
  const filename = (p || '').split(/[\\/]/).pop() || 'image';
  const cacheBust = opts.cacheBust !== false ? ('?t=' + Date.now()) : '';
  const url = fileUrl(p) + cacheBust;
  const slot = el('div', {
    class: 'preview-pane-thumb',
    title: filename + ' â€” click to view 1:1',
    'data-path': p,
  });
  if (opts.isActive) slot.classList.add('preview-active');
  if (opts.isNew) slot.classList.add('preview-new');
  const img = el('img', { src: url, alt: filename, loading: 'lazy' });
  const caption = el('div', { class: 'preview-pane-thumb-caption' }, filename);
  slot.append(img, caption);
  let clickBound = false;
  const bind = (w, h) => {
    if (clickBound) return;
    clickBound = true;
    const open = () => {
      // Update active selection â€” the user's last action wins.
      $$('.preview-pane-thumb').forEach((n) => n.classList.remove('preview-active'));
      slot.classList.add('preview-active');
      if (state._previewBatch) {
        const i = state._previewBatch.paths.findIndex((q) => (q || '').toLowerCase() === p.toLowerCase());
        if (i >= 0) state._previewBatch.index = i;
      }
      markFbItemActive(p);
      if (w && h) openImageOverlay(url, filename, w, h, p);
      else openImageOverlay(url, filename, 0, 0, p);
    };
    slot.addEventListener('click', open, { once: true });
    // Right-click: open the full folder-browser context menu
    // for this path. The preview pane is just a shortcut to
    // the same actions (Upscale / Crop / Convert / Optimize /
    // Remove background + file-level Copy / Cut / Rename /
    // Move / Delete).
    slot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { showItemContextMenuForPath(p, e.clientX, e.clientY); }
      catch (_) { /* silent — context menu is best-effort */ }
    });
  };
  const probe = new Image();
  probe.onload = () => {
    slot.title = `${filename} (${probe.naturalWidth}Ã—${probe.naturalHeight}) â€” click to view 1:1`;
    bind(probe.naturalWidth, probe.naturalHeight);
  };
  probe.onerror = () => bind(0, 0);
  probe.src = url;
  setTimeout(() => bind(0, 0), 3000);
  return slot;
}

// Live-update hook: an image was just generated and the user
// wants the UI to react instantly (folder-explorer blink +
// preview-pane thumbnail + active-row mark) without waiting
// for the full generation run to finish. Called from:
//   1. The image tab's gen handler after each variant (when
//      the output path is known in advance â€” i.e. not
//      --out-dir runs).
//   2. The 1s polling timer in startGenPolling() that watches
//      the output directory for new files (catches --out-dir
//      runs, plus any variant the gen handler missed).
//
// Idempotent: if the same path is reported twice (e.g. both
// the gen handler AND the polling saw it), the second call
// is a no-op â€” we use the lowercased path as the dedup key
// via _previewedPaths.
function notifyImageGenerated(p) {
  if (!p || typeof p !== 'string') return;
  const key = p.toLowerCase();
  if (_previewedPaths.has(key)) return;
  _previewedPaths.add(key);
  // 1. Push the path to the multi-image batch so the thumbnail
  //    shows up in the preview pane. If no batch is currently
  //    active, we start one with just this file (the user can
  //    then continue to add more). The new thumbnail is marked
  //    with the "preview-new" class so the CSS can briefly
  //    highlight it.
  if (!state._previewBatch) {
    state._previewBatch = { paths: [p], index: 0 };
  } else if (!state._previewBatch.paths.includes(p)) {
    state._previewBatch.paths.push(p);
  }
  // 2. Re-render the preview pane. If a grid already exists,
  //    we APPEND a new slot instead of re-creating everything
  //    (preserves the existing thumbnails + their click
  //    handlers). If the grid doesn't exist yet (e.g. the
  //    user is on a non-image tab), this is a no-op â€” the
  //    next refreshBrowser() will pick up the file in the
  //    folder explorer.
  const content = $('#fb-preview-content');
  if (content) {
    let grid = content.querySelector('.preview-pane-grid');
    if (!grid) {
      // No grid yet â€” build one with just this file.
      content.innerHTML = '';
      grid = el('div', { class: 'preview-pane-grid' });
      content.appendChild(grid);
      const summary = el('div', { class: 'preview-pane-summary' }, '1 image â€” click any thumbnail to open at 1:1.');
      content.appendChild(summary);
    } else {
      // Grid already there â€” update the "N images" summary line
      // (if present) so the user can see the count grow.
      const summary = content.querySelector('.preview-pane-summary');
      if (summary) {
        const n = grid.querySelectorAll('.preview-pane-thumb').length + 1;
        summary.textContent = `${n} image${n === 1 ? '' : 's'} â€” click any thumbnail to open at 1:1.`;
      }
    }
    const slot = _buildPreviewThumb(p, { isActive: true, isNew: true });
    grid.appendChild(slot);
  }
  // 3. Mark the file as active in the folder explorer (and scroll
  //    the row into view if it's off-screen).
  markFbItemActive(p);
}

// Polling timer for "live" updates to the folder explorer while
// a generation is in flight. We poll every 1s instead of using
// a more reactive mechanism (chokidar / fs.watch) because:
//   - Polling is OS-agnostic and doesn't add a dependency.
//   - 1s is fast enough for the user to feel "live" but slow
//     enough to be invisible on the IPC channel.
//   - It gracefully handles the --out-dir case where the
//     renderer doesn't know the per-call output filenames and
//     so can't be told by the gen handler.
//
// The poll only runs while state.generating is set; we start
// it from startGenPolling() and stop it from stopGenPolling(),
// both called from armGenBtnWithCancel (start) and its cleanup
// (stop). The poller's main work is:
//   1. List the current fbDir.
//   2. Diff against the previous list (state._lastPolledItems).
//   3. For each new file, call notifyImageGenerated(path) +
//      add a ".fb-item-new" class to its row in the folder
//      explorer so the CSS blink animation runs.
//   4. Refresh the folder explorer's items snapshot.
let _genPollTimer = null;
let _genPollBusy = false;
async function startGenPolling() {
  // Defensive: never start two pollers at once.
  if (_genPollTimer) return;
  // Snapshot the current items so the first tick doesn't see
  // "everything is new" (the generation might have started
  // with files already in the folder).
  try {
    const r = await window.api.fbList(state.fbDir);
    if (r && r.ok) state._lastPolledItems = (r.items || []).map((it) => it.path);
  } catch (_) {
    state._lastPolledItems = [];
  }
  // Reset the dedup set so the polling starts fresh for this
  // run (the gen handler may have already pushed some files
  // before the poller started, which is fine â€” notifyImageGenerated
  // is idempotent and the polling won't see them as new).
  _resetPreviewedPaths();
  const tick = async () => {
    _genPollTimer = null;
    if (!state.generating) return;
    if (_genPollBusy) return; // skip overlapping ticks
    _genPollBusy = true;
    try {
      const r = await window.api.fbList(state.fbDir);
      if (!r || !r.ok) return;
      const newItems = r.items || [];
      const newPaths = newItems.map((it) => it.path);
      const prev = new Set((state._lastPolledItems || []).map((p) => p.toLowerCase()));
      const fresh = newPaths.filter((p) => !prev.has(p.toLowerCase()));
      // 1. Re-render the file-browser list so the new file is
      //    visible + get the new state._fbItems snapshot.
      const sorted = sortFbItems(newItems, state.fbSort);
      renderFbList(sorted);
      applyFileSearch();
      state._lastPolledItems = newPaths;
      // 2. For each newly-discovered file, run it through the
      //    same live-update pipeline the gen handler uses. This
      //    covers the --out-dir case (where the gen handler
      //    doesn't know the per-call output filenames).
      for (const p of fresh) {
        // Only push as a thumbnail if it's an image file â€”
        // the gen pipeline produces .png / .jpg / .jpeg / .webp.
        const ext = (p.split('.').pop() || '').toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
          notifyImageGenerated(p);
        }
        // Add the .fb-item-new class to the matching row so the
        // CSS blink animation runs. We look it up by data-path
        // because the re-render above just created fresh DOM
        // nodes (so the old node references are stale).
        const row = document.querySelector(`.fb-item[data-path="${CSS.escape(p)}"]`);
        if (row) row.classList.add('fb-item-new');
      }
    } catch (_) {
      // Don't let a transient IPC error kill the poller â€” just
      // try again on the next tick.
    } finally {
      _genPollBusy = false;
      // Schedule the next tick only if we're still generating.
      // The next tick is re-armed here (rather than via a
      // setInterval) so an error inside tick() doesn't queue
      // up overlapping polls.
      if (state.generating) _genPollTimer = setTimeout(tick, 1000);
    }
  };
  _genPollTimer = setTimeout(tick, 1000);
}
function stopGenPolling() {
  if (_genPollTimer) { clearTimeout(_genPollTimer); _genPollTimer = null; }
  state._lastPolledItems = null;
}

function previewAudioFromFile(p) {
  const root = $(`#tab-${state.currentTab} .preview`);
  if (!root) return;
  const url = fileUrl(p);
  root.innerHTML = '';
  root.appendChild(el('audio', { controls: '', src: url }));
  root.appendChild(el('div', { class: 'meta' }, p));
}

async function previewTextFromFile(p) {
  const root = $(`#tab-${state.currentTab} .preview`);
  if (!root) return;
  const r = await window.api.fbRead(p);
  root.innerHTML = '';
  if (!r.ok) { root.innerHTML = '<div class="empty">Cannot read: ' + escapeHtml(r.error) + '</div>'; return; }
  // Decode base64 â†’ binary string â†’ UTF-8 text. Plain `atob` only gives a
  // Latin-1 binary string, which mangles non-ASCII characters. TextDecoder
  // with {fatal: false} replaces invalid sequences with U+FFFD instead of
  // throwing, so partially-decodable files still display.
  let txt = '';
  try {
    const bin = atob(r.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    txt = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch (_) {
    // Fallback to the old (Latin-1-ish) decoding if TextDecoder is missing
    txt = atob(r.base64);
  }
  const pre = el('pre', { class: 'meta', style: 'white-space: pre-wrap; max-height: 60vh; overflow: auto;' }, txt);
  root.appendChild(pre);
  root.appendChild(el('div', { class: 'meta' }, p));
}

// In-app clipboard for the file browser. The OS clipboard is shared via the
// browser's native copy/paste (Ctrl+C / Ctrl+X / Ctrl+V on selected items),
// but the in-app file ops use this list so we can track cut vs. copy
// semantics and undo a paste on failure.
let _fbClipboard = null; // { op: 'copy' | 'cut', paths: string[] }

function fbClipboardCopy(paths) {
  _fbClipboard = { op: 'copy', paths: paths.slice() };
  toast(`Copied ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard.`, 'ok', 1500);
}
function fbClipboardCut(paths) {
  _fbClipboard = { op: 'cut', paths: paths.slice() };
  toast(`Cut ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard.`, 'ok', 1500);
}
async function fbClipboardPaste(destDir) {
  if (!_fbClipboard || !_fbClipboard.paths.length) {
    toast('Clipboard is empty.', 'warn'); return;
  }
  if (!destDir) { toast('No destination folder selected.', 'err'); return; }
  const op = _fbClipboard.op;
  const src = _fbClipboard.paths;
  let ok = 0, fail = 0, skipped = 0;
  for (const p of src) {
    // Refuse to copy/cut a folder into itself or any of its descendants.
    const pLow = p.replace(/[\\/]+$/, '').toLowerCase();
    const dLow = destDir.replace(/[\\/]+$/, '').toLowerCase();
    if (pLow === dLow || dLow.startsWith(pLow + (destDir.includes('\\') ? '\\' : '/'))) {
      toast('Skipped: cannot paste a folder into itself.', 'warn');
      skipped++;
      continue;
    }
    if (op === 'cut') {
      // Move: prefer fbMove (handles clobber auto-rename in the main process)
      const r = await window.api.fbMove(p, destDir);
      if (r.ok) ok++; else fail++;
    } else {
      // Copy: read + write via the main process. We don't have a fbCopy
      // yet; fall back to reading + writing a file at a time. For folders,
      // skip with a warning (the main process doesn't recurse-copy).
      const r = await window.api.fbCopy(p, destDir).catch(() => null);
      if (r && r.ok) ok++;
      else if (r && r.error) { toast(r.error, 'err'); fail++; }
      else { toast('Copy not supported for this item.', 'err'); fail++; }
    }
  }
  toast(`${op === 'cut' ? 'Moved' : 'Copied'} ${ok}${fail ? `, ${fail} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}.`,
        fail ? 'warn' : 'ok');
  if (op === 'cut' && ok) _fbClipboard = null;
  await refreshBrowser();
}

function showItemContextMenu(it, x, y) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, it.name));
    m.appendChild(el('div', { class: 'meta', style: 'margin-bottom: 8px; color: var(--fg-2);' }, it.path));

    // File-info block. Always shown. Lists the type, size, modified
    // time, and (for images) the natural resolution. Resolution
    // has to be decoded from the file, so we render a "detectingâ€¦"
    // placeholder first and fill it in once loadImageFromFile
    // resolves.
    const isImage = !it.isDir && ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(it.ext);
    // Same set the audio-cutter dialog + audio preview accept. The
    // list is duplicated on purpose so a future change here doesn't
    // silently drop a format the cutter would still handle (or vice
    // versa).
    const isAudio = !it.isDir && ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.opus', '.aac', '.wma', '.aif', '.aiff'].includes(it.ext);
    const info = el('div', { class: 'fb-item-info' });
    if (it.isDir) {
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Type'),
        el('span', {}, 'Folder'),
      ]));
    } else {
      const extLabel = (it.ext || '').replace('.', '').toUpperCase() || 'file';
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Type'),
        el('span', {}, extLabel),
      ]));
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Size'),
        el('span', {}, humanSize(it.size || 0)),
      ]));
      info.appendChild(el('div', { class: 'fb-info-row' }, [
        el('span', { class: 'fb-info-key' }, 'Modified'),
        el('span', {}, formatDate(it.mtimeMs)),
      ]));
      if (isImage) {
        const dimCell = el('div', { class: 'fb-info-row' }, [
          el('span', { class: 'fb-info-key' }, 'Dimensions'),
          el('span', { class: 'fb-info-dim' }, 'detectingâ€¦'),
        ]);
        info.appendChild(dimCell);
        loadImageFromFile(it.path).then((img) => {
          const dim = dimCell.querySelector('.fb-info-dim');
          if (!dim) return;
          if (img.naturalWidth && img.naturalHeight) {
            dim.textContent = `${img.naturalWidth} Ã— ${img.naturalHeight} px`;
          } else {
            dim.textContent = 'unknown';
          }
        }).catch(() => {
          const dim = dimCell.querySelector('.fb-info-dim');
          if (dim) dim.textContent = 'unreadable';
        });
      }
    }
    m.appendChild(info);

    const row1 = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await openItem(it); } }, 'Open / Preview'))]);
    const row2 = el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await window.api.fbReveal(it.path); } }, 'Reveal in Explorer'))]);
    // Image-pipeline items: Upscale / Crop / Convert / Remove
    // background. Only show for supported image types, in the order
    // the user expects (transform first, then format, then the
    // transparency tool). The "Remove background" action is always
    // shown when the binary is available, and surfaces a precise
    // install hint when it isn't (no silent no-op).
    let nextRow = 3;
    const rows = [];
    if (isImage) {
      // Each row gets a small help "?" button next to the
      // action button so the user can read a longer
      // explanation of what each pipeline step does before
      // they trigger it. This is the same helpButton factory
      // the form labels use â€” clicking the "?" opens the
      // help modal for the topic; the action button itself
      // still runs the action.
      const rU = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showUpscaleDirect(it.path); } }, 'ðŸ” Upscaleâ€¦'),
        helpButton('ctx.upscale'),
      ])]);
      const rC = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showCropOverlay(it.path); } }, 'âœ‚ Cropâ€¦'),
        helpButton('ctx.crop'),
      ])]);
      const rF = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showConvertOverlay(it.path); } }, 'â‡„ Convert formatâ€¦'),
        helpButton('ctx.convert'),
      ])]);
      // "Optimize / Compress" â€” re-encodes the image to shrink its
      // file size with Sharp / libvips while preserving the best-
      // possible visual quality. Sits between "Convert format" and
      // "Remove background" in the menu order because it's a
      // quality / size operation (similar to convert) and the user
      // typically runs the size-shrink BEFORE the more expensive
      // background-removal step. The dialog is always available
      // (no binary / model check needed) because Sharp is a hard
      // dep of the project â€” if it isn't installed the IPC will
      // return a precise "sharp is not installed" error.
      const rO = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); showOptimizeOverlay(it.path); } }, 'ðŸ—œ Optimize / Compressâ€¦'),
        helpButton('ctx.optimize'),
      ])]);
      const rB = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => { close(); runRemoveBackgroundOnItem(it); } }, 'âœ¨ Remove background'),
        helpButton('ctx.removeBackground'),
      ])]);
      rows.push(rU, rC, rF, rO, rB);
    }
    // Audio pipeline: trim / cut with a click-free waveform editor
    // (zero-crossing snap, micro-fade, auto-trim silence, format
    // conversion, smart naming). The dialog opens via the global
    // window.showAudioCutter() exposed by renderer/audioCutter.js.
    if (isAudio) {
      const rA = el('div', { class: 'row' }, [el('div', { class: 'row-flex' }, [
        el('button', { class: 'btn-mini', onclick: () => {
          close();
          try {
            if (typeof window.showAudioCutter === 'function') {
              window.showAudioCutter(it.path);
            } else {
              toast('Audio cutter module not loaded.', 'err');
            }
          } catch (e) {
            toast('Audio cutter failed: ' + (e && e.message || e), 'err', 5000);
          }
        } }, 'âœ‚ Audio cutâ€¦'),
        helpButton('ctx.audioCut'),
      ])]);
      rows.push(rA);
    }
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); fbClipboardCopy([it.path]); } }, 'Copy'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); fbClipboardCut([it.path]); } }, 'Cut'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); promptRename(it); } }, 'Renameâ€¦'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: () => { close(); promptMove(it); } }, 'Move toâ€¦'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini', onclick: async () => { close(); await fbClipboardPaste(state.fbDir); } }, 'Paste here'))]));
    rows.push(el('div', { class: 'row' }, [el('div', {}, el('button', { class: 'btn-mini danger', onclick: () => { close(); confirmDelete(it); } }, 'Delete'))]));
    m.append(...rows);
    const footer = el('div', { class: 'footer' }, el('button', { class: 'btn-mini', onclick: close }, 'Close'));
    m.appendChild(footer);
  });
}

// ----------------- Context menu for preview thumbnails + overlay -----------------
// Right-click context menu for image thumbnails in the picture
// preview pane and for the full-size image overlay. Mirrors the
// folder-browser context menu (showItemContextMenu) — the same
// Upscale / Crop / Convert / Optimize / Remove-background pipeline
// entries are available, plus the file-level Copy / Cut / Rename /
// Move / Delete actions. The same context menu is reused for both
// entry points so behaviour stays consistent.
//
// The helpers accept either:
//   - a full fs-item record (as returned by the main process and
//     cached in state._fbItems), or
//   - just a path string (for the preview pane / overlay where the
//     caller doesn't have the full record). When only a path is
//     given we synthesise a minimal item on the fly so the same
//     action handlers can be reused.
function buildItemFromPath(path) {
  if (!path || typeof path !== 'string') return null;
  const parts = path.split(/[\\/]/).filter(Boolean);
  const name = parts.length ? parts[parts.length - 1] : path;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return {
    path,
    name,
    ext,
    isDir: false,
    size: 0,
    mtimeMs: 0,
    birthtimeMs: 0,
    _synthesised: true,
  };
}
function showItemContextMenuForPath(path, x, y) {
  let it = (state._fbItems || []).find((it) => it.path === path);
  if (!it) it = buildItemFromPath(path);
  if (!it) return;
  showItemContextMenu(it, x, y);
}

// Standalone "Remove background" action triggered by the folder
// browser's right-click context menu. Unlike the in-tab flow
// (which is gated on the upscaling popup's checkbox) and the
// right-click "Upscale" dialog (which can chain upscale â†’
// crop â†’ background removal in one step), this is a single-shot
// "drop the alpha, write <name>_nobg.png next to it" â€” the user
// picks an existing image, the wrapper runs, the result appears
// in the preview pane + the file browser.
//
// We pre-flight the binary / model probe so the user sees a
// precise error message ("binary not installed" vs "model
// missing") instead of a generic failure toast.
async function runRemoveBackgroundOnItem(it) {
  let st = await probeIsnetbgStatus();
  if (!st.checked) {
    toast('Could not contact background-removal backend.', 'err', 5000);
    return;
  }
  if (!st.available) {
    toast('Background removal not set up. Run "npm run setup" to download the IS-Net model, or open the add-ons manager (âš™ Settings â†’ Image upscaling â†’ Re-open add-ons).', 'err', 8000);
    return;
  }
  if (!st.modelPresent) {
    toast('isnetbg model file missing â€” drop isnet-general-use.onnx into ./bin/models/.', 'err', 6000);
    return;
  }
  // Show a brief progress toast so the user knows the action was
  // received. The actual binary run can take a few seconds on CPU
  // (longer on large images), and the binary doesn't stream
  // progress â€” so we rely on a single "Workingâ€¦" toast and then a
  // final success / failure toast.
  setStatus('Removing backgroundâ€¦', true);
  toast('Removing backgroundâ€¦', 'info', 2000);
  try {
    const out = await removeBackgroundFile(it.path);
    setStatus('Background removed.', false);
    toast(`Background removed â†’ ${out}`, 'ok', 4000);
    try { await refreshBrowser(); } catch (_) {}
    if (typeof previewImageFromFile === 'function') {
      try { previewImageFromFile(out); } catch (_) {}
    }
  } catch (e) {
    console.error('Remove background failed:', e);
    setStatus('Background removal failed.', false);
    toast('Background removal failed: ' + (e && e.message || e), 'err', 6000);
  }
}

// Format a mtimeMs timestamp as a human-readable local string.
// Returns "â€”" for null / NaN / 0 (we treat 0 as "no timestamp",
// which happens for some FS drivers that don't expose mtime).
function formatDate(ms) {
  if (!ms || typeof ms !== 'number') return 'â€”';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return 'â€”';
  // YYYY-MM-DD HH:MM in the user's local timezone. Locale-agnostic
  // on purpose so two users in different regions see the same text
  // in a shared screenshot.
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
       + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function promptRename(it) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Rename'));
    const inp = el('input', { type: 'text', value: it.name });
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'New name'), inp]));
    const ok = el('button', { class: 'primary' }, 'Rename');
    const cancel = el('button', { onclick: close }, 'Cancel');
    ok.addEventListener('click', async () => {
      const newName = inp.value.trim();
      if (!newName) { toast('Name is required.', 'warn'); return; }
      if (newName === it.name) { close(); return; }
      const r = await window.api.fbRename(it.path, newName);
      if (!r.ok) { toast('Rename failed: ' + r.error, 'err'); return; }
      toast('Renamed.', 'ok');
      await refreshBrowser();
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancel, ok]));
  });
}

async function promptMove(it) {
  const dest = await window.api.pickFolder();
  if (!dest) return;
  const r = await window.api.fbMove(it.path, dest);
  if (!r.ok) toast(r.error, 'err'); else {
    toast('Moved.', 'ok');
    // Same as confirmDelete: if the moved file was being previewed,
    // the preview pane now has a broken file:// URL. Clear it.
    if (!it.isDir && state._selected && state._selected.path === it.path) {
      previewImageFromFile(null);
    }
    await refreshBrowser();
  }
}

async function confirmDelete(it) {
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'Delete ' + (it.isDir ? 'folder' : 'file') + '?'));
    m.appendChild(el('p', {}, it.path));
    if (it.isDir) m.appendChild(el('p', { style: 'color: var(--danger);' }, 'This will recursively delete the folder and all its contents.'));
    const ok = el('button', { class: 'danger' }, 'Delete');
    const cancel = el('button', { onclick: close }, 'Cancel');
    ok.addEventListener('click', async () => {
      const r = await window.api.fbDelete(it.path);
      if (!r.ok) toast(r.error, 'err'); else { toast('Deleted.', 'ok'); await refreshBrowser(); }
      // If the deleted file was the one being previewed, clear the
      // preview pane â€” the previous code left a broken <img> with an
      // invalid file:// URL, which Chromium would log as a console
      // error every time the user opened a different file.
      if (!it.isDir && state._selected && state._selected.path === it.path) {
        previewImageFromFile(null);
      }
      close();
    });
    m.appendChild(el('div', { class: 'footer' }, [cancel, ok]));
  });
}

async function promptNewFolder() {
  const dir = state.fbDir || state.config.output_dir || '';
  if (!dir) { toast('No output directory set. Configure in Settings.', 'warn'); return; }
  showModal((m, close) => {
    m.appendChild(el('h2', {}, 'New folder'));
    const inp = el('input', { type: 'text', value: 'New folder' });
    m.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Folder name'), inp]));
    m.appendChild(el('div', { class: 'footer' }, [
      el('button', { onclick: close }, 'Cancel'),
      el('button', { class: 'primary', onclick: async () => {
        const name = inp.value.trim();
        if (!name) { toast('Folder name is required.', 'warn'); return; }
        const r = await window.api.fbMkdir(dir, name);
        if (!r.ok) { toast('Create failed: ' + r.error, 'err'); return; }
        toast('Created.', 'ok');
        await refreshBrowser();
        close();
      } }, 'Create'),
    ]));
  });
}

// ----------------- Quota -----------------
// The mmx CLI quota endpoint returns a list of "model_remains" entries.
// Each model has BOTH a daily interval AND a weekly quota:
//   - current_interval_total_count / current_interval_usage_count
//   - current_interval_remaining_percent  (sometimes 100% when counts=0/0 even
//     when the model is not in plan â€” see MiniMax-AI/cli#173)
//   - current_interval_status   (1 = in plan, 3 = not in plan)
//   - current_weekly_total_count / current_weekly_usage_count
//   - current_weekly_remaining_percent
//   - current_weekly_status
//
// Old display logic showed "X% this week" and called anything with total=0
// "not in plan" â€” but the *_status field is the source of truth, AND for
// some models (e.g. video) the *daily* interval is what matters. We now:
//   - use *_status to decide plan inclusion
//   - show BOTH daily + weekly segments when both have non-zero totals
//   - compute used/total % ourselves (the API's *_remaining_percent is
//     unreliable, e.g. reports 100% remaining for 0/0 when status=3)
function _quotaSeg(name, used, total, label) {
  if (!total || total <= 0) return '';
  const remaining = Math.max(0, total - used);
  const usedPct = Math.round((used / total) * 100);
  const cls = usedPct >= 90 ? 'quota-low' : (usedPct >= 50 ? 'quota-warn' : '');
  return `<span class="${cls}" title="${escapeHtml(`${name} Â· ${label}: ${used}/${total} (${usedPct}% used)`)}">${used}/${total} ${label} <small>(${usedPct}%)</small></span>`;
}
function _formatQuotaModel(m) {
  const name = m.model_name || m.name || m.model || '?';
  // All values are rendered into innerHTML below â€” escape to avoid XSS via a
  // hostile model name returned by the API.
  const e = (s) => escapeHtml(String(s == null ? '' : s));
  // mmx quota fields have changed between versions. Read them with a few
  // aliases so we survive both old and new shapes.
  const iTotal = m.current_interval_total_count ?? m.interval_total ?? m.daily_total ?? 0;
  const iUsed  = m.current_interval_usage_count ?? m.interval_used ?? m.daily_used ?? 0;
  const iStatus = m.current_interval_status ?? m.interval_status ?? m.daily_status;
  const iPct    = m.current_interval_remaining_percent ?? m.interval_remaining_percent ?? m.daily_remaining_percent;
  const wTotal = m.current_weekly_total_count ?? m.weekly_total ?? 0;
  const wUsed  = m.current_weekly_usage_count ?? m.weekly_used ?? 0;
  const wStatus = m.current_weekly_status ?? m.weekly_status;
  const wPct    = m.current_weekly_remaining_percent ?? m.weekly_remaining_percent;
  // "Not in plan" only when BOTH statuses are explicitly 3. (The previous
  // version also matched `null`, which mis-classified every model that
  // didn't return a status field â€” that's why the user saw "general: not
  // in plan" even though generations worked.) The remaining_percent fields
  // are then used as a fallback so the user still sees *something* useful.
  const explicitlyNotInPlan =
    (iStatus === 3) && (wStatus === 3);
  if (explicitlyNotInPlan) {
    return `<span class="quota-not-in-plan">${e(name)}: not in plan</span>`;
  }
  const parts = [];
  // Daily interval (e.g. "today"): only when there's a non-zero total
  if (iTotal && iTotal > 0) parts.push(_quotaSeg(name, iUsed || 0, iTotal, 'today'));
  // Weekly: only when there's a non-zero total
  if (wTotal && wTotal > 0) parts.push(_quotaSeg(name, wUsed || 0, wTotal, 'week'));
  if (parts.length === 0) {
    // In plan but no counts (e.g. general returned 0/0 with status=1).
    // Fall back to the *_remaining_percent field (note: this is "remaining"
    // percent â€” invert it to show "used" percent, which the user expects).
    const segs = [];
    if (iPct != null) {
      const usedPct = 100 - iPct;
      const cls = usedPct >= 90 ? 'quota-low' : (usedPct >= 50 ? 'quota-warn' : '');
      segs.push(`<span class="${cls}">${iPct}% today <small>(${usedPct}% used)</small></span>`);
    }
    if (wPct != null) {
      const usedPct = 100 - wPct;
      const cls = usedPct >= 90 ? 'quota-low' : (usedPct >= 50 ? 'quota-warn' : '');
      segs.push(`<span class="${cls}">${wPct}% week <small>(${usedPct}% used)</small></span>`);
    }
    if (segs.length === 0) {
      // We have a model entry but no usable data. Show it as in-plan with
      // a hint so the user knows we got something, just no counters.
      return `<span class="quota-in-plan">${e(name)}: in plan</span>`;
    }
    return `<span class="quota-in-plan">${e(name)}:</span> ${segs.join(' Â· ')}`;
  }
  return parts.join(' Â· ');
}
async function refreshQuota() {
  const el2 = $('#quota-value');
  el2.innerHTML = '<span class="spinner"></span>';
  const r = await window.api.quota();
  if (!r.ok) { el2.textContent = r.error || 'â€”'; return; }
  // The mmx CLI has returned the quota in a few different shapes depending
  // on the version. Try the documented one first (`model_remains` at root
  // or under `data`), then fall back to other common shapes.
  const data = r.parsed;
  let models = null;
  if (data) {
    if (Array.isArray(data.model_remains)) models = data.model_remains;
    else if (Array.isArray(data.models)) models = data.models;
    else if (Array.isArray(data.data && data.data.model_remains)) models = data.data.model_remains;
    else if (Array.isArray(data.quota)) models = data.quota;
  }
  if (!models || !models.length) {
    // No recognizable models â€” log the raw response so the user can see
    // exactly what the API is returning (helps diagnose shape changes
    // between mmx-cli versions). Truncate to keep the log readable.
    try {
      const raw = JSON.stringify(data).slice(0, 4000);
      log(`[quota] unexpected response shape â€” raw: ${raw}${raw.length >= 4000 ? 'â€¦' : ''}`);
    } catch (_) { /* ignore circular refs etc. */ }
    el2.textContent = 'no data';
    return;
  }
  const parts = models.map(_formatQuotaModel);
  el2.innerHTML = parts.join(' Â· ');
}

// ----------------- Settings -----------------
// showSettingsAndSwitchTab(tabId) opens the Settings dialog and
// immediately switches to the named tab. Used by the legacy
// standalone helpers (showPopupSettings, showRealesrganSettings)
// that were replaced by inline tabs in the multi-tab layout.
// The function still uses the same `id: 'settings'` slot as
// openSettings() so the modal-stack dedup guarantees we don't
// open two settings dialogs.
function showSettingsAndSwitchTab(tabId) {
  // Close the existing settings dialog (if any) before opening
  // a new one with the requested tab active. We can't just
  // activate the existing dialog's tab from here because the
  // tab buttons live inside its DOM scope.
  for (let i = _modalStack.length - 1; i >= 0; i--) {
    if (_modalStack[i] && _modalStack[i].id === 'settings') {
      try { _modalStack[i].close(); } catch (_) {}
      break;
    }
  }
  openSettings();
  // The modal is rendered synchronously inside openSettings, so
  // the tab buttons are already in the DOM. Find the requested
  // one and click it (which fires the same activateSettingsTab
  // path a real user click would).
  setTimeout(() => {
    const btn = document.querySelector(`.settings-tab-button[data-tab-button="${tabId}"]`);
    if (btn) btn.click();
  }, 0);
}
function openSettings() {
  // Multi-tab settings dialog. The previous version was a
  // single big modal plus two layered modals on top (Real-ESRGAN
  // + Popups) that the user had to dismiss in order. That got
  // messy fast â€” closing the inner modal left an inconsistent
  // half-saved settings dialog, and the layered stack could
  // trap the focus on the wrong sub-section. The new layout is
  // one modal with a sidebar of tabs (General / Image /
  // Styles / Popups / Shortcuts). Switching tabs swaps the
  // pane content without ever stacking a second modal.
  showModal((m, close) => {
    m.classList.add('settings-modal');
    m.appendChild(el('h2', {}, 'âš™ Settings'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'All your settings (API key, output folder, region, theme, styles, image pipeline, popups) are stored in config.txt next to the executable. Your API key is never sent to the cloud by this tool, never embedded in the binary, and is masked in the log pane by default. Click any tab on the left to switch sections.'));

    // Build the tabbed layout. We render all panes up front
    // and toggle a hidden class so switching tabs is instant
    // (no re-render) and any half-filled inputs survive a
    // round trip between tabs.
    const layout = el('div', { class: 'settings-tabs' });
    const sidebar = el('div', { class: 'settings-tabs-sidebar' });
    const paneHost = el('div', { class: 'settings-tabs-panehost' });

    const tabDefs = [
      { id: 'general',  label: 'ðŸ”‘ General',     build: () => buildSettingsGeneralPane() },
      { id: 'image',    label: 'ðŸ–¼ Image',        build: () => buildSettingsImagePane() },
      { id: 'styles',   label: 'ðŸŽ¨ Style presets', build: () => buildSettingsStylesPane() },
      { id: 'popups',   label: 'ðŸ’¬ Popups',        build: () => buildSettingsPopupsPane() },
      { id: 'shortcuts',label: 'âŒ¨ Shortcuts',      build: () => buildSettingsShortcutsPane() },
    ];
    const panes = {};
    const tabButtons = {};
    for (const tdef of tabDefs) {
      const pane = el('div', { class: 'settings-tab-pane', 'data-tab-pane': tdef.id });
      const built = tdef.build();
      pane.appendChild(built.root);
      panes[tdef.id] = { el: pane, instance: built.instance };
      paneHost.appendChild(pane);
      const tabBtn = el('button', { class: 'settings-tab-button', 'data-tab-button': tdef.id, type: 'button' }, tdef.label);
      tabBtn.addEventListener('click', () => activateSettingsTab(tdef.id));
      tabButtons[tdef.id] = tabBtn;
      sidebar.appendChild(tabBtn);
    }
    layout.appendChild(sidebar);
    layout.appendChild(paneHost);
    m.appendChild(layout);

    // Save / cancel buttons act on every pane (whichever is
    // currently visible â€” we collect pending changes into a
    // single setConfig call on save so config.txt is updated
    // atomically, just like the old single-modal save).
    const saveBtn = el('button', { class: 'primary' }, 'Save');
    const cancelBtn = el('button', { onclick: close }, 'Cancel');
    saveBtn.addEventListener('click', async () => {
      const merged = { ...state.config };
      for (const tdef of tabDefs) {
        const inst = panes[tdef.id].instance;
        if (inst && typeof inst.collect === 'function') {
          Object.assign(merged, inst.collect());
        }
      }
      // CRITICAL: merge with the current config â€” do NOT replace it.
      // The previous version of this code built a fresh
      // {api_key,output_dir,region} object which silently dropped
      // `theme` and `styles` on every save. We preserve every
      // unknown key so future config fields aren't wiped.
      state.config = await window.api.setConfig(merged);
      toast('Saved.', 'ok');
      close();
      refreshQuota();
      refreshBrowser();
    });
    m.appendChild(el('div', { class: 'footer settings-footer' }, [cancelBtn, saveBtn]));

    function activateSettingsTab(id) {
      for (const tdef of tabDefs) {
        const isActive = tdef.id === id;
        tabButtons[tdef.id].classList.toggle('active', isActive);
        panes[tdef.id].el.classList.toggle('active', isActive);
      }
    }
    // Default to the General tab. The previous single-modal
    // design showed API key first so we keep that ordering.
    activateSettingsTab('general');
  }, { id: 'settings' });
}

// ----------------- Settings tab panes -----------------
// Each pane factory returns { root, instance }. The `instance`
// object carries a `collect()` method that returns the pane's
// pending changes as a partial config object â€” the parent
// `openSettings()` merges these into one setConfig call so the
// save button works regardless of which tab the user is on.
//
// Panes that have no pending state (e.g. Shortcuts) return
// { root, instance: null }.

function buildSettingsGeneralPane() {
  // API key (with reveal toggle), output dir, region, theme.
  const root = el('div', {});
  const apiKeyRow = showRevealableKey(state.config.api_key || '', {
    placeholder: 'sk-cp-xxxxxxxx  (or your PAYG key)',
    label: 'API key',
  });
  try {
    const lbl = apiKeyRow.row.querySelector('label');
    if (lbl) lbl.appendChild(helpButton('settings.apiKey'));
  } catch (_) {}
  const outInput = el('input', { type: 'text', value: state.config.output_dir || '', placeholder: '(default: ./generated/)' });
  const regInput = el('select', {});
  for (const r of ['global', 'cn']) regInput.appendChild(el('option', { value: r }, r));
  regInput.value = state.config.region || 'global';
  const themeSel = el('select', {});
  for (const [val, lbl] of [['dark', 'Dark'], ['light', 'Light']]) themeSel.appendChild(el('option', { value: val }, lbl));
  themeSel.value = state.theme || state.config.theme || 'dark';

  root.appendChild(apiKeyRow.row);
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, ['Output directory', helpButton('settings.outputDir')]),
    el('div', { class: 'combo' }, [outInput, el('button', { class: 'btn-mini', onclick: async () => { const p = await window.api.pickFolder(); if (p) outInput.value = p; } }, 'Browseâ€¦')]),
  ]));
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Region', helpButton('settings.region')]), regInput]));
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, ['Theme', helpButton('settings.theme')]), themeSel]));

  // Connection-test row (same behaviour as the old inline
  // buttons). Pushed to the bottom of the pane so the main
  // fields are visible without scrolling.
  const test = el('button', { class: 'btn-mini' }, 'Test connection');
  const diag = el('button', { class: 'btn-mini' }, 'Diagnose');
  test.addEventListener('click', async () => {
    test.disabled = true; test.innerHTML = '<span class="spinner"></span> Testingâ€¦';
    const r = await window.api.authStatus();
    test.disabled = false; test.textContent = 'Test connection';
    if (r.ok) {
      toast((r.message || 'Authentication OK.') + (r.command ? `  (via ${r.command})` : ''), 'ok', 4000);
    } else {
      toast('Auth failed: ' + (r.error || 'unknown error'), 'err', 6000);
    }
  });
  diag.addEventListener('click', () => { showDiagnose(); });
  root.appendChild(el('div', { class: 'settings-pane-actions' }, [test, diag]));

  // Config-file path row (read-only, shows the user where
  // the file lives on disk so they can back it up).
  const cp = el('div', { class: 'row' }, [el('label', {}, 'Config file'), el('input', { type: 'text', value: '', readonly: '' })]);
  root.appendChild(cp);
  window.api.configPath().then((p) => { cp.querySelector('input').value = p; });

  return {
    root,
    instance: {
      collect() {
        return {
          api_key: apiKeyRow.getValue().trim(),
          output_dir: outInput.value.trim(),
          region: regInput.value || 'global',
          theme: themeSel.value || 'dark',
        };
      },
    },
  };
}

function buildSettingsImagePane() {
  // Image pipeline: Real-ESRGAN upscaler status + model
  // selector, and (in a future change) IS-Net background-
  // removal status. Wrapped in a single scrollable section so
  // the pane layout matches the General pane.
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
    'The built-in pipeline is always available. Real-ESRGAN (BSD-3-Clause) gives noticeably better detail when the binary is installed.'));

  // ---- Real-ESRGAN status ----
  const statusText = el('div', { class: 're-status' }, 'Detectingâ€¦');
  const reBtn = el('button', { class: 'btn-mini' }, 'ðŸ”„ Re-detect');
  const installBtnStatus = el('button', { class: 'btn-mini' }, 'â¬‡ Download & install');
  installBtnStatus.style.display = 'none';
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'Real-ESRGAN upscaler'), statusText, installBtnStatus, reBtn,
  ]));

  // ---- Real-ESRGAN model selector ----
  const modelSel = el('select', {});
  for (const [val, lbl] of [
    ['realesrgan-x4plus', 'realesrgan-x4plus  (general-purpose 4Ã—, default)'],
    ['realesrgan-x4plus-anime', 'realesrgan-x4plus-anime  (anime / illustration)'],
    ['realesrgan-animevideov3', 'realesrgan-animevideov3  (video frames)'],
    ['realesr-general-x4v3', 'realesr-general-x4v3  (latest general, smaller)'],
  ]) {
    const opt = el('option', { value: val }, lbl);
    if (val === (state.realesrganModel || 'realesrgan-x4plus')) opt.selected = true;
    modelSel.appendChild(opt);
  }
  modelSel.addEventListener('change', () => {
    state.realesrganModel = modelSel.value;
    scheduleStateSave();
  });
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'Upscale model'), modelSel,
  ]));

  // ---- One-click installer ----
  const installBtn = el('button', { class: 'btn-mini' }, 'â¬‡ Download Real-ESRGAN');
  const installProgress = el('div', { class: 're-progress' });
  installProgress.style.display = 'none';
  installProgress.style.color = 'var(--fg-2)';
  installProgress.style.fontSize = '12px';
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'One-click install'),
    el('div', { style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap;' }, [installBtn, installProgress]),
  ]));

  async function refreshStatus() {
    statusText.textContent = 'Detectingâ€¦';
    try {
      const r = await window.api.realesrganAvailable();
      if (r && r.available) {
        const v = r.version ? '  (v' + r.version + ')' : '';
        statusText.textContent = 'Detected: ' + (r.binaryPath || '') + v;
        statusText.style.color = 'var(--success)';
        installBtnStatus.style.display = 'none';
      } else {
        statusText.textContent = 'Not found. Click "Download & install" to add it to ./bin/ automatically.';
        statusText.style.color = 'var(--fg-2)';
        installBtnStatus.style.display = '';
      }
    } catch (e) {
      statusText.textContent = 'Probe failed: ' + (e.message || e);
      statusText.style.color = 'var(--danger)';
      installBtnStatus.style.display = '';
    }
  }
  reBtn.addEventListener('click', () => { refreshStatus(); });
  refreshStatus();

  async function runInstall() {
    installBtn.disabled = true;
    reBtn.disabled = true;
    installBtnStatus.disabled = true;
    installProgress.style.display = '';
    installProgress.textContent = 'Starting downloadâ€¦';
    const offProgress = window.api.onRealesrganDownloadProgress((data) => {
      if (data.phase === 'download') {
        if (data.total > 0) {
          const pct = (data.downloaded / data.total) * 100;
          const mb = (data.downloaded / 1024 / 1024).toFixed(1);
          const totalMb = (data.total / 1024 / 1024).toFixed(1);
          installProgress.textContent = `Downloadingâ€¦ ${mb} / ${totalMb} MB (${pct.toFixed(0)}%)`;
        } else {
          installProgress.textContent = 'Downloadingâ€¦';
        }
      } else if (data.phase === 'extract') {
        installProgress.textContent = 'Extractingâ€¦';
      } else if (data.phase === 'done') {
        installProgress.textContent = 'Done. Refreshing statusâ€¦';
      }
    });
    try {
      const r = await window.api.realesrganDownload();
      offProgress();
      if (r && r.ok) {
        installProgress.textContent = 'Installed to ' + (r.binDir || './bin') + '. Re-detectingâ€¦';
        await refreshStatus();
      } else {
        installProgress.textContent = 'Download failed: ' + ((r && r.error) || 'unknown');
        installProgress.style.color = 'var(--danger)';
      }
    } catch (e) {
      offProgress();
      installProgress.textContent = 'Download failed: ' + (e && e.message || e);
      installProgress.style.color = 'var(--danger)';
    } finally {
      installBtn.disabled = false;
      reBtn.disabled = false;
      installBtnStatus.disabled = false;
    }
  }
  installBtn.addEventListener('click', runInstall);
  installBtnStatus.addEventListener('click', runInstall);

  // ---- Optional add-ons link (opens the addons popup so the
  // user can install IS-Net + the model file). Kept as a
  // separate popup because the addons install can stream
  // progress for minutes; embedding it in the settings pane
  // would freeze the rest of the dialog. ----
  const openAddonsBtn = el('button', { class: 'btn-mini' }, 'ðŸ§© Open add-ons installer');
  openAddonsBtn.addEventListener('click', () => openOptionalAddons({ force: true }).catch(() => {}));
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'Optional add-ons'),
    openAddonsBtn,
  ]));

  // The pane does not modify config.txt directly â€” its writes
  // go to state.json (realesrganModel), so collect() returns
  // an empty object. The save button still works.
  return { root, instance: { collect: () => ({}) } };
}

function buildSettingsStylesPane() {
  // The style-presets pane shows the existing list with
  // add/edit/delete + the "Save current prompt as style"
  // button. Implemented as a thin wrapper that calls the
  // existing openStyleSettings() modal â€” but here we render
  // the same UI inline so the user doesn't have to dismiss a
  // second modal to save settings.
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
    'Style presets are short text snippets (a genre, mood, camera hint) that get prepended to every prompt so you can keep the same look across many generations without retyping.'));

  // Render the list
  const list = el('ul', { class: 'style-list' });
  function renderList() {
    list.innerHTML = '';
    const styles = state.config.styles || [];
    if (!styles.length) {
      list.appendChild(el('li', { class: 'empty-row' }, 'No styles yet. Add one below, or click "Save current prompt as style".'));
      return;
    }
    styles.forEach((s, i) => {
      const actions = el('div', { class: 'sactions' }, [
        el('button', { class: 'btn-mini', onclick: () => { editStyle(i); } }, 'âœŽ'),
        el('button', { class: 'btn-mini danger', onclick: () => { deleteStyle(i, () => { renderList(); }); } }, 'âœ•'),
      ]);
      list.appendChild(el('li', {}, [
        el('div', {}, [
          el('div', { class: 'sname' }, s.name),
          el('div', { class: 'sval' }, s.value),
        ]),
        actions,
      ]));
    });
  }
  renderList();
  root.appendChild(list);

  const nameInput = el('input', { type: 'text', placeholder: 'Style name (e.g. "Pixel Art Berlin")' });
  const valInput = el('textarea', { placeholder: 'Style value â€” the text that gets prepended to your prompt (e.g. "Pixel art, neon red lighting, dramatic shadows")' });
  valInput.style.minHeight = '70px';
  const editingIdx = { value: -1 };
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Name'), nameInput]));
  root.appendChild(el('div', { class: 'row' }, [el('label', {}, 'Value (prepended to your prompt)'), valInput]));

  function editStyle(i) {
    const s = (state.config.styles || [])[i];
    if (!s) return;
    editingIdx.value = i;
    nameInput.value = s.name;
    valInput.value = s.value;
  }
  // (deleteStyle is shared with the standalone popup â€” it
  // already calls persistStyles on the renderer's state.)
  const saveBtn = el('button', { class: 'btn-mini' }, 'ðŸ’¾ Save style');
  const saveCurrentBtn = el('button', { class: 'btn-mini' }, 'âœš Save current prompt as styleâ€¦');
  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    const value = valInput.value.trim();
    if (!name) { toast('Name is required.', 'warn'); return; }
    if (!value) { toast('Value is required.', 'warn'); return; }
    if (name.includes('=')) { toast('Style name cannot contain "=" (would break config parsing).', 'err'); return; }
    const styles = state.config.styles || [];
    if (editingIdx.value >= 0) styles[editingIdx.value] = { name, value };
    else styles.push({ name, value });
    await persistStyles();
    _refreshAllStyleDropdowns();
    renderList();
    toast(`Saved "${name}".`, 'ok');
    nameInput.value = ''; valInput.value = '';
    editingIdx.value = -1;
  });
  saveCurrentBtn.addEventListener('click', () => {
    // Pull the active tab's manual prompt into the value
    // field. The standalone popup does the same.
    const cur = _currentManualText();
    if (!cur) { toast('Active tab has no prompt to save.', 'warn'); return; }
    valInput.value = cur;
    if (!nameInput.value.trim()) nameInput.value = 'My style';
    nameInput.focus();
  });
  root.appendChild(el('div', { class: 'settings-pane-actions' }, [saveBtn, saveCurrentBtn]));

  return { root, instance: null /* styles persist immediately on save */ };
}

function buildSettingsPopupsPane() {
  // Popups policy + reset history (was the standalone popup).
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
    'Control how often the optional popups appear: the welcome screen on every fresh launch, the first-time setup, the optional add-ons installer, and the per-tab intro messages.'));

  const polSel = el('select', { class: 'popup-policy-select' });
  for (const [val, lbl] of [
    ['once-fresh',  'Show once to fresh users, then never (default)'],
    ['per-session', 'Show first time each app start'],
    ['never',       'Never show these popups'],
    ['always',      'Always show (even after dismissal)'],
  ]) polSel.appendChild(el('option', { value: val }, lbl));
  polSel.value = state.popupPolicy || 'once-fresh';
  polSel.addEventListener('change', () => { state.popupPolicy = polSel.value; scheduleStateSave(); });
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, ['Popup behaviour', helpButton('settings.popupPolicy')]),
    polSel,
  ]));

  const resetBtn = el('button', { class: 'btn-mini' }, 'ðŸ”„ Reset popup history');
  resetBtn.addEventListener('click', async () => {
    if (!confirm('Reset all popup "seen" history? Every popup will fire again the next time it is triggered (until you dismiss it).')) return;
    resetPopupSeen();
    toast('Popup history reset.', 'ok');
    refreshSeenCount();
  });
  const seenSpan = el('span', { style: 'color: var(--fg-3); font-size: 11px;' }, '');
  function refreshSeenCount() {
    const seenCount = (state.seenPopups && typeof state.seenPopups === 'object') ? Object.keys(state.seenPopups).length : 0;
    seenSpan.textContent = `Currently remembers ${seenCount} popup${seenCount === 1 ? '' : 's'} as seen.`;
  }
  refreshSeenCount();
  root.appendChild(el('div', { class: 'row' }, [
    el('label', {}, 'Reset'),
    el('div', { style: 'display: flex; gap: 8px; align-items: center;' }, [resetBtn, seenSpan]),
  ]));

  return { root, instance: { collect: () => ({}) /* popupPolicy lives in state.json */ } };
}

function buildSettingsShortcutsPane() {
  // Read-only keyboard shortcut reference. Lives in the
  // settings dialog so the user doesn't have to dig through
  // the README.
  const root = el('div', {});
  root.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
    'Keyboard shortcuts work from anywhere in the app (no need to click into a specific tab first).'));
  const box = el('div', { class: 'shortcuts-box' });
  box.appendChild(el('h4', {}, 'âŒ¨ Keyboard shortcuts'));
  const shortcuts = [
    ['Ctrl+Enter', 'Generate on the active tab'],
    ['Ctrl+1 / 2 / 3 / 4', 'Switch to Image / Speech / Music / Video'],
    ['Ctrl+B', 'Open BatchGen for the active tab'],
    ['Ctrl+T', 'Open Style Settings (also in Settings â†’ Style presets)'],
    ['Ctrl+S', 'Open this Settings dialog'],
    ['Ctrl+L', 'Toggle dark / light mode'],
    ['Ctrl+F', 'Focus the file-browser filter'],
    ['Ctrl+R', 'Refresh quota'],
  ];
  for (const [keys, desc] of shortcuts) {
    box.appendChild(el('div', { class: 'shortcut-row' }, [
      el('kbd', {}, keys),
      el('span', {}, desc),
    ]));
  }
  root.appendChild(box);
  return { root, instance: null };
}

// ----------------- Popups settings -----------------
// Sub-modal inside âš™ Settings that lets the user change the popup
// display policy (which controls the startup / first-time-setup /
// optional-addons / tab-intro popups) and reset the "seen" history
// so every popup fires again on the next trigger. Persisted to
// state.json via scheduleStateSave â€” the policy itself is part of
// state.popupPolicy, and the seen record is state.seenPopups.
function showPopupSettings() {
  // Removed: the standalone Popups modal was replaced by the
  // Popups tab inside the new multi-tab Settings dialog
  // (buildSettingsPopupsPane). The function stub remains so
  // any stale references don't crash, but it just opens the
  // settings dialog and switches to the Popups tab.
  showSettingsAndSwitchTab('popups');
}

// ----------------- Diagnose dialog -----------------
// Read-only diagnostic dump that walks the user through what the
// app sees on their machine: platform, Electron + Node versions,
// the node.exe and CLI entry it found, API key presence, region.
// Opened from the "Diagnose" button in ⚙ Settings → General.
// Useful when "Test connection" fails and the user wants to know
// which prerequisite is missing (e.g. mmx-cli not installed,
// node.js not on PATH, wrong region).
function showDiagnose() {
  showModal(async (m, close) => {
    m.appendChild(el('h2', {}, 'Diagnose'));
    m.appendChild(el('p', { style: 'color: var(--fg-2); font-size: 12px; margin-top: 0;' },
      'Shows what the app sees on your machine. Useful when "Test connection" fails — copy the output and share it with support if you need help.'));
    const box = el('pre', { style: 'background: var(--bg-3); padding: 10px; border-radius: var(--radius); font-size: 12px; white-space: pre-wrap; max-height: 50vh; overflow: auto;' }, 'Loading…');
    m.appendChild(box);

    const d = await window.api.diagnose();
    const lines = [
      `Platform:               ${d.platform}`,
      `Electron version:       ${d.electronVersion}`,
      `Node version:           ${d.nodeVersion}`,
      `Detected node.exe:      ${d.nodePath || '(NOT FOUND)'}`,
      `Detected mmx-cli entry: ${d.mmxEntry || '(NOT FOUND)'}`,
      `Region:                 ${d.region || 'global'}`,
      `API key present:        ${d.apiKeyPresent ? 'yes' : 'no'}`,
      `API key length:         ${d.apiKeyLength} chars`,
      '',
      d.error ? '⚠ ' + d.error : '✓ All prerequisites found.',
    ];
    box.textContent = lines.join('\n');

    if (d.nodePath && d.mmxEntry) {
      const test = el('button', { class: 'btn-mini' }, 'Run real quota test');
      m.appendChild(el('div', { style: 'margin-top: 12px;' }, test));
      const out = el('pre', { style: 'background: var(--bg-3); padding: 10px; border-radius: var(--radius); font-size: 12px; white-space: pre-wrap; max-height: 200px; overflow: auto; margin-top: 8px; display: none;' });
      m.appendChild(out);
      test.addEventListener('click', async () => {
        test.disabled = true; test.innerHTML = '<span class="spinner"></span> Running…';
        out.style.display = 'block';
        out.textContent = 'Running quota check…\n';
        const r = await window.api.authStatus();
        out.textContent += `exit code: ${r.code ?? 'n/a'}\n`;
        out.textContent += `ok flag:   ${r.ok}\n`;
        out.textContent += `error:     ${r.error || '(none)'}\n`;
        out.textContent += `command:   ${r.command || '(none)'}\n`;
        if (r.argv) out.textContent += `argv:      ${r.argv.join(' ')}\n`;
        test.disabled = false; test.textContent = 'Run real quota test';
      });
    }

    m.appendChild(el('div', { class: 'footer' }, el('button', { onclick: close }, 'Close')));
  });
}
