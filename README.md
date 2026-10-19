# Conversation Margin Notes

A local Chromium extension for annotating passages in shared AI conversations.
Select a passage, keep a private note, return after reloading, and export a portable
JSON notebook. Repeated or changed passages have explicit anchor statuses; the
extension never guesses between duplicate quotations.

## Install and launch

1. Download or copy this repository. Open `chrome://extensions`, enable **Developer
   mode**, choose **Load unpacked**, and select the `extension/` folder. No build,
   account, server, or API key is required.
2. Open a public shared conversation, for example this [ChatGPT instrument-control
   conversation](https://chatgpt.com/share/8d523f18-86c8-44af-8002-a5bcf45ffbb5) or
   [Gemini logic puzzle](https://gemini.google.com/share/37ac58221046). Let its
   transcript finish loading.
3. Pin **Conversation Margin Notes** and click its toolbar icon, or use
   **Alt+Shift+M**. A separate **Margin Notes — private editor** window opens.
4. Select a passage in the conversation tab, return to the editor, and choose
   **Annotate selection**. Type your note and **Save note**. If the page is still
   changing, refresh and select again.
5. Reload the conversation tab, then choose **Refresh source & notes** in the
   editor. Your saved notes remain; their anchor status is recomputed.
6. Use **Edit**, **Go to passage**, or **Delete → Confirm delete**. **Export all
   notes** downloads `margin-notes-v1.json`; **Import JSON** merges a notebook
   without overwriting conflicting records.

Keep the source tab open. Closing it disconnects that editor. Reopen the source
and activate the extension to create another editor. Cross-origin navigation can
revoke the browser's activeTab grant; activate the extension again on the new page.
For same-tab routes, verify the displayed conversation and use **Confirm displayed
conversation** when requested. Fragment routes remain unsupported.

To try it offline:

```sh
python3 -m http.server 8771 --bind 127.0.0.1 --directory fixtures
```

Open `http://127.0.0.1:8771/conversation.html` and follow the same steps. This is
clearly labeled synthetic sample data. The private editor is used for localhost
as well as online pages. A packaging helper is available:

```sh
python3 tests/package-extension.py
```

Extract `dist/conversation-margin-notes.zip`, then load its `extension/` folder.
The unpacked directory and ZIP contain the same runtime files.

## Privacy

Permissions remain exactly `activeTab`, `scripting`, and `storage`. There are no
persistent host permissions, web-accessible editor resources, external messaging
interfaces, analytics, network clients, account integration, or synchronization.
Page access starts only after you activate the extension.

Note bodies, recovery previews, search text, and exports stay in an extension-owned
window. The provider page receives neither that UI nor private text. Its adapter
reads the public transcript and selection and can select a public passage when you
choose **Go to passage**. Only the extension-owned editor can request notebook and
draft operations. The page cannot access the editor DOM or directly call its
message interface. Notes use `chrome.storage.local`, restricted to trusted
extension contexts. They are not encrypted against access to your browser profile.

The conversation provider still controls its own content and can observe your
selection and navigation there. Protect exported JSON files; they contain note
text, quotations, timestamps, and full source URLs including query strings.
Export before uninstalling or clearing browser data.

## Drafts and anchors

Drafts persist after 300 ms of quiet input. Wait for **Draft persisted on this
device** before closing the editor; pending keystrokes may be lost. **Recovery
drafts** offers explicit recovery on the original source, export, and discard.
Draft exports are labeled recovery JSON, separate from notebook imports.
Concurrent/stale edits fail without overwriting existing notes; export the draft
before discarding it and opening a fresh edit. An unrelated notebook change can
also make an older draft conflict.

| Status | Meaning |
| --- | --- |
| exact | Full normalized source fingerprint and quotation agree. |
| uniquely reanchored | The source changed and one literal quotation remains. |
| ambiguous | Multiple matches; no jump or attachment. |
| missing | No valid match; no jump or attachment. |
| source mismatch | This note belongs to another URL. |
| pending / incomplete / unresolved | Source is changing, unsupported, or its identity needs confirmation. |

Status updates are polled while the editor is open. **Go to passage** rechecks the
current source before selecting it. Unique text is evidence, not proof of unchanged
meaning. There is no fuzzy matching. The extension requires one visible `main` or
`[data-margin-notes-root]`. Virtualized/unloaded history, iframes, shadow-DOM
transcripts, PDFs, canvas, and CSS-generated text are unsupported. Limits include
200,000 normalized source code points, 10,000 root DOM nodes, 2,000 quotation code
points, 4,000 saved-note code points, 500 notes, and 2 MiB notebook JSON. Recovery
holds at most 32 drafts / 1 MiB. Nothing is silently evicted.

## Verification and live access

Install test dependencies (Node.js 22+):

```sh
npm ci
npx playwright install chromium
node tests/secure-browser.mjs
node tests/secure-browser.mjs --live
```

The first command after setup tests the actual production extension against local
intercepted HTTPS and loopback fixtures, including privacy boundaries and ambiguous
anchors. The `--live` command uses the two public URLs above, a fresh browser
profile, real provider networking, and the installed toolbar action. It performs
create, reload, edit and export. It requires those links and providers to remain
accessible; a challenge, unavailable link, or changed DOM fails rather than falling
back to fixtures. Selection is constructed by browser automation on real transcript
text. This is not a human toolbar or accessibility audit.

See [production privacy results](results/secure-verification.json),
[live results](results/live-verification.json), the
[ChatGPT editor demo](results/live-chatgpt.png), and the
[Gemini editor demo](results/live-gemini.png).
A successful earlier probe is not evidence that a later build passed; the JSON
records `complete` and per-case checks for the latest run.

The 2026-10-19 production run completed create, reload, edit and export on both
pages. ChatGPT reattached exactly. Gemini's selected quotation appeared twice
after reload: the editor preserved the note, explicitly marked it **ambiguous**,
disabled passage jumping, and still allowed editing and export. That is a verified
uncertainty result, not a claim of successful reattachment on that page.

Observed inaccessible inputs on 2026-10-19:

| Provider / public URL | Observed result |
| --- | --- |
| [Claude shared conversation](https://claude.ai/share/9581bb8e-5cdf-40c8-b173-3d311fb6ee37) | Direct HTTP returned 403; Chromium reached a Cloudflare security-verification page instead of a transcript. Workflow untested. Requires access from a browser/network where this public page is available. |
| [Gemini earlier sample](https://gemini.google.com/share/fb7b79067427) | Redirected to the app and reported “Link doesn't exist.” This URL cannot establish compatibility. The live suite uses the separately discovered public logic-puzzle link above. |

Grok has not been evaluated; no compatibility claim is made. Provider DOMs and
public links can change. The first ChatGPT access probe showed only the navigation
shell after seven seconds; a separate published research conversation rendered
successfully. The live suite allows hydration before selection.

`npm run verify` also runs unit/model checks and the historical in-page UI
regression suite. That suite now uses an explicit **test-only worker adapter**;
it does not validate the production editor or its privacy boundary. Its seeded
mutation/navigation/draft results retain their narrower scope. Historical artifacts
remain under `results/baseline-*`. Source indexing and data-format contracts are in
[docs/contract.md](docs/contract.md), [docs/drafts.md](docs/drafts.md), and
[prior work](docs/prior-art.md). No novelty claim is made.
