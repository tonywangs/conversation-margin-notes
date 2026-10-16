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

Use the same host, port, path and query when returning to a source. Fragments do
not affect identity. **All sources** makes notes from other URLs reachable, with
source mismatch diagnostics. Imports never remap sources automatically.

Escape closes the panel; Tab and Shift+Tab move through its controls; Enter or
Space activates buttons. The panel is non-modal, with visible focus indicators and
an announcement region. At narrow widths it covers the page: close it to inspect
the selected passage. Drafts survive a failed save and a panel close, but are not
saved across a page reload. Export before uninstalling or clearing browser data.

## What an anchor status means

| Status | Behavior |
| --- | --- |
| Exact | Full normalized source fingerprint and saved position/quote agree. |
| Uniquely reanchored | Source changed; exactly one literal quotation remains. |
| Ambiguous | Source changed; quotation appears more than once. No highlight or jump. |
| Missing | No matching quotation, or inconsistent position in an unchanged source. |
| Source mismatch | This note belongs to another URL. No attachment. |
| Refresh required | DOM changed or indexing could not complete. No stale navigation. |

Context is saved for inspection but never used to guess between duplicates.
Uniqueness is textual evidence, not proof that a rewritten page preserves meaning.
There is no fuzzy matching. Refresh notes and anchors after editing the page.

## Supported pages and limits

Exactly one visible `[data-margin-notes-root]` or, as a fallback, one `main` element
is required. This milestone supports static light-DOM conversations, including
inline formatting, repeated passages, code and Unicode. It does **not** establish
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
without silently dropping stored notes.

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
[seeded mutation results](results/mutations.json), and [test design](docs/testing.md).
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
since you opened the panel, your save fails and retains your draft. Review changes
with **Refresh notes & anchors** before retrying. Failed writes never update the
visible saved notebook. If saved data is corrupt, the panel reports an error and
refuses to overwrite it; recovery requires a valid export or inspecting the local
extension storage through Chromium's extension developer tools.

The implementation builds on established annotation techniques; see
[prior work](docs/prior-art.md). This project makes no novelty claim.
