# Conversation Margin Notes

A small, local Chromium extension for keeping thoughts beside conversation passages.
Select text, write a note, and return to it later. Export a portable JSON notebook
and import it into another browser profile. Changed or repeated passages are
explicitly marked **uniquely reanchored**, **ambiguous**, or **missing**.

No account, backend, remote inference, analytics, build step, or persistent host
permission. The extension asks only for `activeTab`, `scripting`, and `storage`.
It reads supported conversation text only after you activate it.

## Install and try it offline

1. Copy this repository to your computer. Open `chrome://extensions`, enable
   **Developer mode**, choose **Load unpacked**, and select the `extension/` folder.
2. From the repository directory run:
   ```sh
   python3 -m http.server 8771 --bind 127.0.0.1 --directory fixtures
   ```
3. Open `http://127.0.0.1:8771/conversation.html`. This is a local synthetic fixture;
   the server binds only to your computer. Internet access is unnecessary.
4. Pin **Conversation Margin Notes** and click its toolbar icon. Alternatively use
   **Alt+Shift+M** (configure conflicts at `chrome://extensions/shortcuts`).
5. Select a passage and click **Annotate selection**, type a note, and save it.
   Use **Edit**, **Delete → Confirm delete**, or **Go to passage** on a note.
6. Reload the page and activate the extension again. Notes remain saved locally.
7. **Export all notes** downloads `margin-notes-v1.json`. In a fresh browser profile,
   load the same extension, visit the same URL, activate it, and **Import JSON**.

Use the same host, port, path and query when returning to a source. Stored identities remain fragment-free. Nonempty fragments are detected but stay
unresolved because they might identify a different hash-routed conversation. **All sources** makes notes from other URLs reachable, with
source mismatch diagnostics. Imports never remap sources automatically.

Escape closes the panel; Tab and Shift+Tab move through its controls; Enter or
Space activates buttons. The panel is non-modal, with visible focus indicators and
an announcement region. At narrow widths it covers the page: close it to inspect
the selected passage. Drafts persist locally after 300 ms of quiet input. Wait for **Draft persisted**
before closing or reloading; pending edits can still be lost. Reload or restart the
browser, activate the extension, then choose **Recover persisted draft** on the
original source. Export before uninstalling or clearing browser data.

## Try a changing conversation

Open `http://127.0.0.1:8771/dynamic.html` using the same local server. Annotate the
gold-bordered passage, then try **Append**, **Duplicate**, **Remove**, **Replace
container**, and **Stream / stop**. Leave an edit open while streaming: its text,
focus and caret stay in place. **Restore original** returns the exact anchor.
**Toggle incomplete** models a document that reports unfinished loading.

Observed DOM changes and native same-tab navigation events invalidate anchors. CSSOM edits
and viewport-only style changes require manual refresh. Virtualized or
unloaded history is unsupported unless the page explicitly marks itself incomplete.
See the [dynamic document contract](docs/contract.md#dynamic-document-contract).

## What an anchor status means

| Status | Behavior |
| --- | --- |
| Exact | Full normalized source fingerprint and saved position/quote agree. |
| Uniquely reanchored | Source changed; exactly one literal quotation remains. |
| Ambiguous | Source changed; quotation appears more than once. No highlight or jump. |
| Missing | No matching quotation, or inconsistent position in an unchanged source. |
| Source mismatch | This note belongs to another URL. No attachment. |
| Pending | Page is changing; highlights are cleared until 150 ms of quiet. |
| Unresolved | URL and rendered identity disagree, a destination is unmarked, or a fragment route is unsupported. No attachment or writes. |
| Incomplete | Unsupported/unfinished document or processing limit. No attachment; manual refresh available. |

Context is saved for inspection but never used to guess between duplicates.
Uniqueness is textual evidence, not proof that a rewritten page preserves meaning.
There is no fuzzy matching. Observed DOM changes update anchors automatically.
**Refresh notes & anchors** retries incomplete documents and refreshes saved notes.

## Supported pages and limits

Exactly one visible `[data-margin-notes-root]` or, as a fallback, one `main` element
is required. This milestone supports changing light-DOM conversations: appended/edited messages,
moved/removed passages, container replacement, inline formatting, code and Unicode. It does **not** establish
compatibility with live ChatGPT, Claude, Grok or Gemini pages. Their changing DOMs,
virtualized histories, permissions and navigation have not been tested.

Hidden/editable content, forms, iframes, shadow DOM, PDFs, canvas, SVG and generated
CSS text are excluded. Do not select across excluded content. The complete
[document contract](docs/contract.md) defines normalization, code-point offsets,
source identity and rejection behavior.

Limits are 200,000 normalized code points, 400,000 raw UTF-16 units, 10,000 DOM
nodes within the root, 2,000 selected code points, 4,000 note-body code points,
500 total notes and 2 MiB JSON. The panel mounts at most 20 rows and 20 highlights;
all notes remain reachable through paging and search. Limits reject the operation
without silently dropping stored notes. Root discovery is capped at 20,000 document
nodes; nesting and ancestor walks at 128 levels. Automatic updates allow 8 indexes
and 120 mutation batches per 10 seconds, with at most 1,000 records inspected per
batch. Overflow shows **incomplete** until manual refresh. Continuous streaming
shows **pending** without repeatedly indexing the document.

This is local storage, not encrypted storage. Exports contain note text, quotations,
context, timestamps, fingerprints and full source URLs (including query strings).
Keep them private. The panel is injected into the page's DOM; a hostile page can
inspect or alter displayed panel content. Use it on trusted documents. It is not a
security boundary against the page or other extensions. No note text is executed
as HTML. Browser storage is restricted to trusted extension contexts, and page
scripts cannot directly call the worker's internal message interface.

## Reproduce verification

Requires Node.js 22+ and the Chromium dependencies for Playwright. Test dependencies
and a browser must be installed once while online (or copied from an offline cache):

```sh
npm ci
npx playwright install chromium
```

Then one command runs unit tests, the installed-extension workflow, seeded DOM
mutations and artifact limits, with external browser HTTP(S) blocked:

```sh
npm run verify
```

Use `PLAYWRIGHT_BROWSERS_PATH` for a non-default browser cache. In the managed build
environment, the verifier also recognizes `/tmp/margin-browsers`. Browser profiles
and XDG files live in temporary directories and are removed after testing.
No test browser uses your personal profile. Verification needs no credentials.

The harness uses Chromium's CDP `Extensions.triggerAction` on a real tab target,
which invokes the installed extension action and activeTab grant. It does not load
the panel as a standalone mock app. Selection ranges are constructed in the fixture;
buttons, downloads, file inputs and keyboard actions use browser automation. Storage
failure checks include a real quota exhaustion and separate injected write failures.
A denial proxy blocks external browser connections; Playwright routes also reject
non-fixture page requests. The extension itself has no network code.

See [verification evidence](results/verification.json), [test output](results/tests.log),
[static mutation results](results/mutations.json), [dynamic sequence results](results/dynamic.json), [navigation results](results/navigation.json), and [test design](docs/testing.md).
Screenshots are generated in `results/desktop.png` and `results/narrow.png`.
These checks cover synthetic compatibility, not a screen-reader audit, manual
OS-level toolbar/shortcut testing, or long-term browser storage durability.

## Data format and recovery

Version 1 JSON contains `{ "version": 1, "notes": [...] }`. A note includes its UUID,
source URL, text, ISO timestamps and a selector containing quote, prefix, suffix,
code-point offsets and a SHA-256 source fingerprint. See `extension/core.js` for the
bounded validator. Unknown fields and versions are rejected rather than ignored.

Import validates every record before committing one merged notebook. Identical
UUID/content duplicates are skipped. Any conflicting UUID rejects the entire import;
existing notes remain untouched. Export order and property order are deterministic.
Keep originals when manually resolving conflicts; changing an ID creates a separate
note. Source mismatches are retained, never automatically attached to this page.

Concurrent saves use a worker queue and revision checks. If another tab has saved
since the draft began, your save fails and retains your draft. **Refresh notes &
anchors** never resets its base revision. Export the draft, or choose **Start a
separate note**, review it, then save without overwriting the original. Failed writes never update the
visible saved notebook. If saved data is corrupt, the panel reports an error and
refuses to overwrite it; recovery requires a valid export or inspecting the local
extension storage through Chromium's extension developer tools.

The implementation builds on established annotation techniques; see
[prior work](docs/prior-art.md). This project makes no novelty claim.

Historical static-milestone evidence is preserved byte-for-byte in
[results/baseline-v1](results/baseline-v1/). Current evidence is regenerated by the
verification command; historical measurements are not claims about current code.

## Try same-tab conversation navigation

Open `http://127.0.0.1:8771/navigation.html?conversation=A` with the local server.
Annotate the shared passage in A, open **Edit**, and leave some text unsaved.
Click **Conversation B (delayed)**. A's highlights and current-source notes clear
immediately; its draft stays visible with its original source label and Save disabled.
When B finishes, only B's notes can attach, even though its quotation is identical.
Return to A and choose **Recover draft on this source** before saving. Cancel is
an explicit discard; the extension never transfers a draft to another source.

Try Back/Forward, Replace URL, Unmarked destination and Unsupported hash route.
A marked destination recovers automatically only when its root's absolute
`data-margin-notes-source` matches the current URL and the content is not marked
incomplete. After navigation, an unmarked page requires **Confirm displayed
conversation**: first verify that the rendered transcript belongs to the displayed
URL. **Refresh notes & anchors** retries loading without confirming identity.
Fragments remain unresolved; return to a fragment-free URL. No live-provider
compatibility is claimed. See the [navigation contract](docs/contract.md#same-tab-navigation-and-draft-recovery).

Draft recovery also covers reloads, tab closure and browser restarts after local
storage acknowledges the text. The panel distinguishes pending edits, persisted
drafts and saved notes. Pending edits can be lost if the page closes before an
acknowledgment; unload warnings and best-effort flushes are not durability guarantees.
A save sent before navigation may finish on its original note. Recovery rereads
storage and checks its original ID so a delayed new-note save is not duplicated.

The previous dynamic milestone's artifacts are retained byte-for-byte under
[results/baseline-dynamic](results/baseline-dynamic/), alongside the original static
baseline. They describe historical code; current evidence is regenerated by verification.


## Persistent drafts

Select a passage, type, and wait for **Draft persisted on this device**. You can
also choose **Persist draft now**. After reload or browser restart, activate the
extension and use **Recovery drafts**. Recovery is explicit and only available on
the original resolved source; another source can export or discard the recovery
copy but cannot attach it. Closing the panel retains the active editor.

Drafts are separate from notebook exports. **Export current draft** includes even
pending text in `margin-notes-draft-recovery.json`; **Export recovery** downloads
the selected persisted snapshot. This labeled JSON is for manual recovery and is
not accepted by notebook Import. It preserves text, quotation, original source,
target ID and base revision. Copy its `draft.body` into an editor if needed.
**Cancel draft** discards the active draft; **Discard persisted draft** removes a
listed recovery copy. Discard is version-checked and does not delete saved notes.

At most 32 drafts and 1 MiB of draft JSON are retained, without expiration or
silent eviction. Draft bodies support up to 8,000 code points in storage; the
textarea permits 8,000 UTF-16 units and saved notes still allow 4,000 code points.
On quota, capacity or storage failure, the editor retains its text and the last
acknowledged snapshot stays intact. Export pending text, free space by explicitly
discarding old drafts, then retry. Unsaved text above the saved-note limit can be
exported or shortened. Local drafts are not encrypted or synced to other devices.

Each tab can have an independent draft. Recovering the same draft in two tabs uses
version checks: the first write wins and the other editor retains its text for
export. Refresh the recovery list to see changes from other tabs. A notebook change
(including an unrelated note) makes older drafts conflict. They can be exported or
started as separate notes; they cannot silently overwrite newer or deleted notes.
Saving a separate note keeps the old recovery copy until explicitly discarded.
If a note saved but draft cleanup failed, both are retained with a diagnostic.

See the [draft contract](docs/drafts.md), [model results](results/drafts-model.json)
and [installed browser results](results/drafts-browser.json). Previous navigation
artifacts are preserved in [results/baseline-navigation](results/baseline-navigation/).
