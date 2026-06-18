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
// Phase 3 Block 8: setupHelpDelegation() extrahiert nach
// renderer/components/HelpDelegation.js. Nutzt window.showHelp
// (gesetzt von app.js am File-Ende).
const { setupHelpDelegation } = window.HelpDelegation;

// Phase 3 Block 4: setupHoverHelpTooltips() extrahiert nach
// renderer/components/HelpTooltip.js. Shim-Alias unten.
const { setupHoverHelpTooltips } = window.HelpTooltip;

// ----------------- Utilities -----------------
// Phase 3: lokale el()-Definition entfernt. Verwendet jetzt
// window.createElement aus core/DomHelpers.js (semantisch
// identisch, inkl. Array-Children-Flatten via [].concat()).
const el = window.createElement;
// Phase 3 Block 28: SPEECH TAB + MUSIC TAB extrahiert nach
// renderer/tabs/speechTab.js + musicTab.js.


// Phase 3 Block 26: 3 Image-Overlays (showConvertOverlay,
// showCropOverlay, showOptimizeOverlay) extrahiert nach
// renderer/overlays/imageOverlays.js.
const {
  showConvertOverlay, showCropOverlay, showOptimizeOverlay,
} = window.ImageOverlays;


// Phase 3 Block 23: IMAGE TAB (732 Z.) extrahiert nach
// renderer/tabs/imageTab.js. window.ImageTab enthaelt den Tab.

// Phase 3 Block 22: buildParamRow + attachImageDimGuards extrahiert
// nach renderer/components/ParamRow.js. (helpButton bleibt in app.js
// weil es historisch eng mit helpTopics verkoppelt ist.)
const { buildParamRow, attachImageDimGuards } = window.ParamRow;


// Phase 3 Block 21: LOG-Section (addLogEvent, renderLogEvent,
// _logSelected, toggleLogSelection, clearLogSelection, selectLogRange,
// formatLogEventForCopy, collectLogCopyText, setupLogClicks, log) extrahiert
// nach renderer/services/logService.js.
const {
  addLogEvent, renderLogEvent, formatLogEventForCopy, collectLogCopyText,
  setupLogClicks, log, isLogSelected, toggleLogSelection, clearLogSelection, selectLogRange,
} = window.LogService;


// Phase 3 Block 20: loadImageFromFile + derivedOutputPath extrahiert
// nach renderer/utils/pureFuncs.js.
const { loadImageFromFile, derivedOutputPath } = window.PureFuncs;


// Phase 3 Block 19: FB_COLUMNS + normalizeFbColumns extrahiert
// nach renderer/utils/fbColumns.js. Drop-in-Aliase unten.
const { FB_COLUMNS, normalizeFbColumns } = window.FbColumns;


// Phase 3 Block 18: MODEL_SPECS + getRowSpec + validateTabAgainstSpec
// extrahiert nach renderer/specs/modelSpecs.js. Drop-in-Aliase unten.
const { MODEL_SPECS, getRowSpec, validateTabAgainstSpec } = window.ModelSpecs;


// Phase 3 Block 17: appendFlag + _flagForParam extrahiert nach
// renderer/utils/tinyUtils.js. Drop-in-Aliase unten.
const { appendFlag, _flagForParam } = window.TinyUtils;


// Phase 3 Block 16: mimeFromPath + isFlagVisibleForCurrentModel
// extrahiert nach renderer/utils/imageUtils.js.
const { mimeFromPath, isFlagVisibleForCurrentModel } = window.ImageUtils;


// Phase 3 Block 15: 4 pure helpers (parseAspect, humanSize,
// parentDir, iconForFile) extrahiert nach renderer/utils/pureFuncs.js.
const { parseAspect, humanSize, parentDir, iconForFile } = window.PureFuncs;


// Phase 3 Block 14: 5 tiny pure helpers extrahiert nach
// renderer/utils/tinyUtils.js. Drop-in-Aliase unten.
const { pathJoin, safeStringify, extFromMime, _isImageExt, appendBoolFlag } = window.TinyUtils;


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
// Phase 3 Block 3: extrahiert nach renderer/services/LogCategories.js
const { LOG_MAX_EVENTS, LOG_CATEGORIES } = window.LogCategories;

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

// Extract the --flag from a param's enclosing .row label (e.g. "--model (hd)"
// â†’ "--model"). The flag is the first "--xxx" token in the label. Returns
// null if the row is unlabeled (e.g. prompt, lyrics textarea, variants row).


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

// ----------------- Image pipeline (Upscale / Crop / Convert) -----------------
// All three operations are pure browser/Electron â€” no external libraries,
// no network calls, fully open source. They all use the HTML5 Canvas
// API to read the source image into a canvas, then export it to the
// target format via canvas.toDataURL. The main process only handles
// persisting the resulting base64 blob to disk via the new fb:write IPC.

// Load a local file:// image as a usable Image object (resolves once
// it's fully decoded). Used by upscale / crop / convert.

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

// Pick a non-clobbering output path next to the source. Inserts a
// `_2x`, `_cropped_WxH`, or `_converted` infix between the stem and
// the extension. If the result already exists, a numeric suffix is
// appended to keep the original safe.

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

// Phase 3 Block 9: setupCropFrameDrag() extrahiert nach
// renderer/components/CropFrameDrag.js. Pure Funktion, keine App-State-Coupling.
const { setupCropFrameDrag } = window.CropFrameDrag;


// Phase 3 Block 7: setupLastCmdTooltips() extrahiert nach
// renderer/components/LastCmdTooltip.js. Drop-in-Alias unten.
const { setupLastCmdTooltips } = window.LastCmdTooltip;

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
// Phase 3 Block 11: FB_SORT_MODES + normalizeFbSort + naturalCompare +
// sortFbItems extrahiert nach renderer/utils/fbSort.js. Pure Modul,
// 0 App-Coupling.
const { FB_SORT_MODES, normalizeFbSort, naturalCompare, sortFbItems } = window.FbSort;

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


function applyFileSearch() {
  const q = ($('#fb-search')?.value || '').toLowerCase();
  for (const item of $$('.fb-item')) {
    if (!q) { item.style.display = ''; continue; }
    const name = (item.dataset.name || item.querySelector('.name')?.textContent || '').toLowerCase();
    item.style.display = name.includes(q) ? '' : 'none';
  }
}
}

// Phase 3 Block 13: _attachDropTarget() extrahiert nach
// renderer/utils/dropTarget.js. Shim-Alias unten.
const { attachDropTarget: _attachDropTarget } = window.DropTarget;

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
// Phase 3 Block 5: formatDate() extrahiert nach FormatUtils.js
// als formatLocalShort(). Drop-in-Alias unten.
const { formatLocalShort: formatDate } = window.FormatUtils;

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
// Phase 3 Block 12: _quotaSeg() + _formatQuotaModel() extrahiert
// nach renderer/utils/quotaFormatter.js. Pure Format-Logik,
// 0 App-Coupling (nur escapeHtml über window).
const { quotaSeg: _quotaSeg, formatQuotaModel: _formatQuotaModel } = window.QuotaFormatter;
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

// Phase 3: exportiere showHelp auf window, damit
// components/HelpButton.js (und zukünftige Help-Module) es aufrufen
// können, ohne den Function-Scope zu verlassen.
window.showHelp = showHelp;
