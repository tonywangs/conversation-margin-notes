# Verification design

`npm run verify` runs Node's built-in test runner and a persistent Playwright
Chromium context with the actual unpacked extension. Test dependencies are pinned
in `package-lock.json`. No web application server or network account is required;
a temporary loopback server supplies only bundled synthetic fixture routes.

The browser workflow checks no injection before activation, real extension action,
creation, edit, reload, export download, import file input in a fresh profile,
duplicate handling, navigation, source mismatch, ambiguity, removed passages,
Unicode, code, hostile text, keyboard activation and Escape, a 320px viewport,
concurrent tabs, failed imports and writes, all 500 reachable notes, deletion and
bounded mounted rows/highlights. Real storage quota exhaustion tests browser failure
semantics. Deliberate monkeypatching of the native write boundary additionally tests
delete/import failures, with the production worker and UI otherwise unchanged.

The mutation experiment uses xorshift32 with seed `0x5eedc0de`. Forty trials of each
of seven transformations produce 280 cases. Each case begins with a constructed
three-paragraph source; tokenized quotes contain an astral character and accented
text. The oracle constructs expected normalized text, status and code-point start
independently of production search. Every resolved range is mapped back to DOM text
and selected again. Cases include inserted text, moved passages, duplicated quote
and context, whitespace runs, Unicode prefixes, removed passages and inline markup
split around individual Unicode code points. Expected ambiguous and missing cases
are first-class successes; they must not produce positions.

Exact cases are whitespace/markup changes that preserve canonical text. Reanchored
cases change text before or around a still-unique quote. Duplicate cases append a
whole copy of quote and context. Removed cases eliminate the selected paragraph.
Negative DOM checks cover malformed selections, hidden regions, unsupported content,
missing/multiple roots and raw/normalized/node/selection bounds. This is a bounded
synthetic oracle, not a benchmark of arbitrary website recovery quality.

Recorded evidence contains actual runtimes, browser version, artifact sizes,
maximum panel element/row/highlight counts, seed and per-case results, and SHA-256
hashes of source/tests/fixtures. Measurements vary by machine. Tests create and
remove temporary profiles; exported test data is synthetic. Screenshots and JSON
are normal reproducible test artifacts, not session transcripts.

The denial proxy and page routing are checked with deliberate external fetches
from both a page and the extension worker. The harness does not claim an OS-level
network namespace; browser background features are disabled by Playwright and
external HTTP(S) is denied through Chromium's proxy configuration.

Not covered: live conversation providers, accessibility with an actual screen
reader, all OS keyboard shortcut conflicts, malicious host-page UI spoofing,
browser crashes mid-write, storage corruption repair, arbitrary CSS visual ordering,
closed shadow roots, virtualized content, and unlimited histories. No precision or
recall measurement beyond the stated synthetic construction is claimed.
