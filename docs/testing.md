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

## Installed-extension navigation verification

`tests/navigation.mjs` adds 256 seeded sequences (seed `0xc019a71e`, 32 each of
URL-first delayed push, content-first replace, rapid A→B→A, back/forward, hash
routing, repeated quotations, Unicode/container replacement and unmarked manual
confirmation). Both fixture sources contain an identical quotation but have
different saved IDs. The oracle compares the actual mounted note ID, status,
CSS Highlight range text and current-container paragraph position against its own
paragraph arrays. Every case has a seeded Unicode prefix; the seed also varies
return-page content, rapid burst length, delayed-render duration and duplicate
placement. It does not call production identity or anchoring functions.
Unresolved and ambiguous outcomes are expected successes only when they produce no
attachment. Every return to A must retain its original unsaved draft and require
explicit recovery. No sequence writes notebook data. Refresh resets the processing
budget between independent sequences, not between their intermediate transitions.

Additional native storage fault injection exercises 32 delayed snapshot replies,
A→B→A stale-read rejection, accepted delayed writes and rejected writes, and read
failure during draft recovery. A latch holds each delayed snapshot until after
navigation, so stale-response assertions do not depend on a timer winning a race.
Diagnostics count stale read/write replies actually discarded. Native storage
methods are bound to their StorageArea before delaying them; the worker queue and
stored envelope are real. Navigation during digest and selection capture exercises
separate anchoring and composer races. New drafts use stable IDs: a delayed create
followed by recovery/save must update that original record without duplication.

The same installed extension is exercised through reload, export download and
fresh-profile import, then navigated between the two source identities. The
exported notebook remains deterministic. `tests/navigation-edges.mjs` also checks
mismatched/hostile markers, incomplete content, same-URL entries, explicit draft
cancellation, and the distinction between refresh and identity confirmation.
The existing original and dynamic suites remain in the same verification command.
The old dynamic unsupported-URL regression now explicitly confirms its unmarked
source on return, as required by the stricter navigation contract.

`results/navigation.json` records per-sequence end-to-end destination/return latency,
anchor checks, controller processing counts and panel/main DOM counts. These
include debounce and automation scheduling; they are not CPU-only benchmarks or
live-provider latency measurements. Browser version and artifact sizes appear in
`results/verification.json`. Historical dynamic artifacts are preserved under
`results/baseline-dynamic/` and are never regenerated by the verifier.

For diagnosis only, the browser module accepts `{navigationOnly:true}` and
`MARGIN_NAV_TRIALS` can reduce the sequence loop. The complete verification command
uses 32 trials per kind and must not be run with that diagnostic variable set.
Only a full run is milestone evidence. Independent edge cases refresh between
cases; production processing limits remain unchanged. Install Chromium completely
before launching the verifier. Run browser suites serially: a parallel diagnostic
launch hit the managed environment's thread limit (`pthread_create: Resource
temporarily unavailable`) and produced no test evidence.


Navigation traversal tests wait for the actual destination URL and observer delivery,
not a fixed delay: scheduling can otherwise leave B visible before Back commits A. Initial-marker removal is a separate regression:
a page that declared identity cannot silently fall back to unmarked compatibility.
Queued writes and delayed file reads are tested across page changes. A burst of
200 same-URL replacements must coalesce to one index with at most three controller
notifications. Fresh-profile Chromium instances run serially to bound test-process
resource use.

## Persistent draft verification

The same `npm run verify` command also runs four draft unit groups, 320 seeded
lifecycle histories and an installed-extension draft suite. The unit groups check
schema/Unicode/count/byte bounds, compare-and-swap versions, immutable identity,
base revision conflicts, coalesced acknowledgment and failure retry. These are in
addition to the six existing core groups, not replacements for them.

`tests/drafts-model.mjs` executes the production worker in a VM with a simulated
Chrome storage boundary and uses the production coalescing writer. An independent
ledger tracks editor text, acknowledged text/version, note contents and notebook
revision. It does not call the production draft reducer to calculate expectations.
All 320 histories exercise a delayed acknowledgment with intervening edits,
navigation while pending, a failed write, worker/renderer recreation from the
persisted snapshot, explicit recovery, and a stale competing writer. Seeded bursts
vary text, Unicode, edit counts and failures. Half then change/delete the saved
note externally, verify conflict rejection and discard; half save and verify
cleanup. The seed, processing counts and each history's outcome are recorded in
`results/drafts-model.json`. This is a simulated lifecycle model, not a claim of
320 browser crashes or installed-extension navigation histories.

`tests/drafts-browser.mjs` uses the installed extension, native local storage,
real action activation and network-blocked Chromium. It checks reload and a new
browser process using the same on-disk profile (no injected storage reconstruction),
explicit source-locked recovery, keyboard activation and visible focus, hostile
text, separate-note conflict resolution, concurrent tabs, deleted notes, delayed
native writes, discard/navigation during pending writes, quota exhaustion, failed
reads and post-save cleanup failure, recovery JSON downloads, the 32-record bound,
320px layout, and existing notebook export/import in a fresh profile.

Native storage hooks delay or reject individual API operations; they do not replace
the database. Real quota exhaustion is a separate check. Pending edits are never
reported persisted before acknowledgment. A note save and its draft cleanup are
separate writes: a test explicitly fails the second and verifies the recovery copy
and saved note coexist without automatic duplication. The older navigation write
hooks now target notebook writes specifically, so they still exercise an accepted
note write rather than accidentally delaying the new prerequisite draft write.
Navigation recovery checks wait for both anchor readiness and storage refresh.
The failed-read recovery regression also waits for the explicit recovery result
before checking Save: an initial full run exposed an immediate-click assertion
that could observe the button while asynchronous recovery was still in progress.

`results/drafts-browser.json` records input-to-visible-confirmation latency,
writer-side input-to-acknowledgment and RPC timing samples, bounded writer counts,
native `getBytesInUse` measurements and browser version. UI timings include the
300 ms debounce, IPC, storage and automation scheduling; they are not fsync latency
or a CPU benchmark. Model counts are synthetic, while browser measurements use
native extension storage. Historical navigation evidence is preserved under
`results/baseline-navigation/` and is never regenerated by the verifier.

Limitations: restart coverage uses a graceful fresh browser process, not power-loss
or disk-corruption simulation. No live-provider, personal-account, human keyboard
usability or human screen-reader audit has been performed. Automated checks inspect
focus styling, keyboard actions and live-region attributes; they do not establish
how every assistive technology announces changes. A draft not acknowledged before
page destruction can lose recent text. Recovery exports are manual copies, not a
new automatic import format. Refreshing the list is needed to see other tabs' work.
