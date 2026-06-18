// renderer/sections/section23_Centralized_help_system.js (Phase 3 Block 29)
// Extracted: Centralized help system
// Source: app.js L224..444

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

// Phase 4 Fix 6: export showHelp on window for HelpButton.js
// (and any other component that needs to invoke the help modal).
// section01 used to do this export but it lives before section23
// in index.html, so the bare `showHelp` reference would throw a
// ReferenceError at load time. Doing the export here where the
// function is actually defined is the correct fix.
window.showHelp = showHelp;

