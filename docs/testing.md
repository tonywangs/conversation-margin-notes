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


## Installed-extension dynamic verification

The original 280-case DOM experiment remains unchanged. A second experiment,
`tests/dynamic.mjs`, runs **256 seeded multi-step sequences** (32 each of streaming,
duplication, Unicode/whitespace, moving, container replacement, removal, text editing
and inline markup). Seed: `0x72ac19ef`. It uses the actual installed panel and one
persisted note, not direct calls to production anchoring functions.

Its reference consists of a separate array of expected paragraphs. It normalizes
that model according to the contract, compares full text for exactness, and searches
code-point arrays by an independent brute-force loop. It compares row statuses,
highlight counts, DOM range text and start positions. It checks **608 settled
intermediate/final anchors**, plus immediate pending states and cleared highlights
at each mutation. Streaming chunks are also checked while pending. A manual refresh
resets the budget between independent sequences; intermediate steps recover solely
through the observer. The suite retains a draft through all sequences, asserting
unchanged field value, focus, caret direction and mounted note row. A separate case
preserves a page selection and keyboard-focused jump control. Browser-driven
selection changes inside removed/edited host content are outside that guarantee.

`tests/dynamic-limits.mjs` covers continuous streaming with no intermediate indexes,
a 1,001-record flood, 125 small mutation batches, the 8-attempt rate budget,
missing/multiple/hidden/editable roots, busy markers, depth/raw/text/node/discovery
bounds, and automatic recovery when incomplete content becomes available. It checks
that automatic updates and cancelled/failed edits leave stored bytes unchanged.
For a deterministic asynchronous race, the native digest function is delayed in
the extension's isolated world without changing its result; the stale generation
must be discarded. The hook is restored after the test. Closing the panel must
suppress highlights during subsequent updates. Manual refresh recovers latched
processing limits.

Frozen workload measurements include five changes with 1,000 additional paragraphs,
35 stream chunks at nominal 30 ms intervals, and one automatic update of a full
500-note notebook (20 mounted rows). Actual update times, index attempts, commits,
visited/discovery nodes, panel DOM counts and Chromium version are recorded in
`results/dynamic.json` and `results/verification.json`. Latencies include debounce,
scheduling and, for Node-side measurements, automation round trips. These are local
measurements, not cross-device performance guarantees. The dynamic example's real
controls are also exercised in the network-blocked browser.

Historical artifacts under `results/baseline-v1/` are preserved copies of the
catalog baseline. They are not regenerated or relabeled as new measurements.
Current evidence is written only after successful browser verification; failures
are recorded in `results/tests.log`. Final artifact sizes include the regenerated
report and test log. No live-provider or human screen-reader validation is claimed.


Two expanded browser runs timed out waiting for panel activation on a new
synthetic tab or fresh profile. Another full run passed; the timeout's cause was
not established. The harness now waits for the service worker's action listener
to be registered before triggering the CDP action, since worker creation alone
does not establish listener readiness. The harness now includes extension-action
title diagnostics on activation failure. This work does not establish a browser
flakiness rate or claim that every development run passed. Missing Chromium in the
initial environment was resolved by installing the pinned Playwright browser into
temporary storage before the successful baseline rerun.


Counter interpretation: controller counters are cumulative for that panel instance.
The limits suite deliberately delays hashing by 250 ms, so its lifetime
`maxIndexMs` includes that injected wait; it is not a CPU benchmark of indexing.
Use the frozen workload's individual end-to-end `latenciesMs` and attempt/commit
deltas for that workload. The streaming case distinguishes `nominalDurationMs` (35 × 30 ms) from measured
`elapsedMs`; `quietToReadyMs` is measured by the controller. The frozen workload
also records mean index time over that workload alone. Two development retries could not launch Chromium due
to temporary thread-resource exhaustion after an interrupted verifier; those
attempts are not successful verification evidence.
