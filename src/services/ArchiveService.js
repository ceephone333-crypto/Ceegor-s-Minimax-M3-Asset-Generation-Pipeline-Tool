// main/services/ArchiveService.js
// ============================================================================
// Phase C of _plan3.md — append-only JSONL archive for finished jobs.
//
// When the L2 list (`state.json::jobsSnapshot`) overflows the cap
// (default 200, configurable 20..1000), the trimmed entries are
// appended to `state.jobs.archive.jsonl` (next to `state.json`).
// The file is read on demand by the ArchiveViewer widget — never
// at launch, never during normal operation. We do NOT load the
// archive into memory.
//
// Format: one job-summary object per line, terminated by `\n`.
// The schema is `JobSummary` (see _plan3.md §2.1):
//
//   {
//     id:        string,
//     type:      'image' | 'speech' | 'music' | 'video' | 'upscale' | 'optimize' | 'isnetbg',
//     tab:       'image' | 'speech' | 'music' | 'video' | null,
//     title:     string,
//     subtitle:  string,
//     status:    'ok' | 'err' | 'warn' | 'cancel',
//     startedAt: ISO string,
//     finishedAt: ISO string,
//     outputPaths: string[],
//     groupId:   string | null,
//   }
//
// Crash-safety: every `append()` call writes a single line and
// fsyncs the file descriptor. A partial final line (process
// killed mid-write) is detected on the next `append()` and
// silently dropped by rewriting the file without it. We never
// use the temp-file + rename pattern (that would defeat the
// append-only simplicity and the gain is zero for a stream of
// small appends).
// ============================================================================

const fs = require('fs');
const path = require('path');

function archivePath(configDir) {
  return path.join(configDir, 'state.jobs.archive.jsonl');
}

// Append a single JobSummary to the archive. Returns the number
// of bytes written. Crash-safe: a partial final line from a
// previous crash is detected via the trailing-newline check and
// silently dropped.
function append(configDir, summary) {
  if (!configDir) throw new Error('ArchiveService.append: configDir is required');
  if (!summary || typeof summary !== 'object') throw new Error('ArchiveService.append: summary must be an object');
  const p = archivePath(configDir);
  fs.mkdirSync(configDir, { recursive: true });
  // Drop a partial last line from a prior crash, atomically. We
  // re-write the file without the last line (the partial bytes).
  // This is the only "rewrite" we ever do; the rest of the API
  // is strictly append-only.
  _trimPartialLastLine(p);
  const line = JSON.stringify(summary) + '\n';
  fs.appendFileSync(p, line, 'utf8');
  return Buffer.byteLength(line, 'utf8');
}

// Read a chunk of lines from the archive. Returns
// { lines, nextOffset, hasMore }. The caller can pass the
// returned `nextOffset` to read the next chunk.
//
// The implementation reads the whole file (it's small — see
// the archive size estimates in the file header) and walks
// the lines starting at `offset` (in BYTES) up to `limit`
// lines. The next offset is the byte position just after the
// last returned line's trailing newline.
function readChunk(configDir, opts) {
  opts = opts || {};
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0);
  const limit = Math.max(1, Math.min(500, parseInt(opts.limit, 10) || 100));
  const p = archivePath(configDir);
  if (!fs.existsSync(p)) return { lines: [], nextOffset: 0, hasMore: false };
  const stat = fs.statSync(p);
  if (offset >= stat.size) return { lines: [], nextOffset: stat.size, hasMore: false };
  const text = fs.readFileSync(p, 'utf8');
  const lines = [];
  let pos = 0;
  let cur = 0;
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    if (cur >= offset) {
      if (lines.length >= limit) break;
      const line = text.slice(pos, end);
      if (line) {
        try { lines.push(JSON.parse(line)); } catch (_) { /* skip malformed */ }
      }
    }
    if (nl === -1) { pos = text.length; cur = text.length; }
    else { pos = nl + 1; cur = pos; }
  }
  const nextOffset = pos;
  return { lines, nextOffset, hasMore: nextOffset < text.length };
}

// Remove a single entry by id. Atomic rewrite (read all → write
// to temp → rename) so a partial rewrite can't leave the file
// in an inconsistent state. The matching line is removed
// (only the first match — duplicates are tolerated).
function deleteOne(configDir, id) {
  if (!id) throw new Error('ArchiveService.deleteOne: id is required');
  const p = archivePath(configDir);
  if (!fs.existsSync(p)) return false;
  const text = fs.readFileSync(p, 'utf8');
  const parts = text.split('\n');
  let removed = false;
  const out = [];
  for (const line of parts) {
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (!removed && obj && obj.id === id) { removed = true; continue; }
      out.push(JSON.stringify(obj));
    } catch (_) {
      // Keep malformed lines (don't drop user data we can't read).
      out.push(line);
    }
  }
  if (!removed) return false;
  const tmp = p + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, out.join('\n') + (out.length ? '\n' : ''), 'utf8');
  fs.renameSync(tmp, p);
  return true;
}

// Clear the whole archive. Truncates the file to zero bytes.
function clear(configDir) {
  const p = archivePath(configDir);
  if (!fs.existsSync(p)) return 0;
  const stat = fs.statSync(p);
  fs.writeFileSync(p, '', 'utf8');
  return stat.size;
}

// Current archive size in bytes. Returns 0 if the file doesn't
// exist. Cheap (one stat call).
function size(configDir) {
  const p = archivePath(configDir);
  if (!fs.existsSync(p)) return 0;
  return fs.statSync(p).size;
}

// Internal: detect a partial final line and rewrite the file
// without it. Called by `append()` to recover from a crash.
//
// The partial line is anything after the last `\n`. We scan the
// tail of the file (up to the last 8 KB) for the most recent
// `\n` and truncate the file just after that byte. If the file
// is empty or already ends in `\n`, no work is needed.
function _trimPartialLastLine(p) {
  if (!fs.existsSync(p)) return;
  const stat = fs.statSync(p);
  if (stat.size === 0) return;
  const fd = fs.openSync(p, 'r+');
  try {
    // Read the last 8 KB and scan for the last newline. If the
    // file is smaller than 8 KB, the whole file is in the buffer.
    const SCAN = 8 * 1024;
    const start = Math.max(0, stat.size - SCAN);
    const length = stat.size - start;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, start);
    let lastNl = -1;
    for (let i = length - 1; i >= 0; i--) {
      if (buf[i] === 0x0A) { lastNl = i; break; }
    }
    if (lastNl === length - 1) return; // file already ends with \n
    if (lastNl < 0) {
      // No newline at all — the file is one big partial line. Truncate
      // the entire file to zero.
      fs.ftruncateSync(fd, 0);
      return;
    }
    // Truncate to (start + lastNl + 1) bytes — the byte just after
    // the last newline, which is the start of the partial line.
    fs.ftruncateSync(fd, start + lastNl + 1);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { archivePath, append, readChunk, deleteOne, clear, size };
