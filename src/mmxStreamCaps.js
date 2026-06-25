// src/mmxStreamCaps.js
// v1.1 (audit H3 + AUDIT-09): the stdout/stderr buffer cap and
// the truncation-marker logic. Extracted from src/mmx.js so
// the main file stays under the 500-line HARD limit (the lint
// SIZE rule).
//
// The mmx child process can produce unbounded output (verbose
// logs, embedded base64, runaway progress). At ~1.5 GB
// accumulated string data V8 crashes. We cap each stream at
// a generous limit and emit a single "[output truncated at N
// bytes]" marker the first time we drop data, regardless of
// whether the cap is reached by a single straddle chunk or by
// an aligned-chunk sequence (the pre-v1.1 implementation only
// fired the marker on a straddle, missing the aligned case).

const MAX_STDOUT_BYTES = 16 * 1024 * 1024;  // 16 MB
const MAX_STDERR_BYTES = 4 * 1024 * 1024;   // 4 MB

function makeCappedAppender() {
  const truncated = { stdout: false, stderr: false };
  return function append(stream, buf, s, max) {
    if (buf.length >= max) {
      // Already capped. Emit the marker ONCE on the first drop
      // so the user knows the output was truncated, then drop
      // the new data silently.
      if (!truncated[stream]) {
        truncated[stream] = true;
        return buf + '\n[output truncated at ' + max + ' bytes]\n';
      }
      return buf;
    }
    if (buf.length + s.length <= max) return buf + s;
    // Single-chunk straddle: truncate the new data so the final
    // error message (usually at the END of stderr) isn't the
    // part we drop. Keep the head + the marker.
    truncated[stream] = true;
    return buf + s.slice(0, Math.max(0, max - buf.length)) + '\n[output truncated at ' + max + ' bytes]\n';
  };
}

module.exports = { MAX_STDOUT_BYTES, MAX_STDERR_BYTES, makeCappedAppender };
