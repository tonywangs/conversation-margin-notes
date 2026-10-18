# Supported document and anchoring contract (version 1)

The user explicitly activates the extension on a top-level HTTP(S) document.
Exactly one `[data-margin-notes-root]` element or, as a fallback, exactly one
`main` element must exist. Visible light-DOM text inside that root is supported, including
appended messages, text/attribute edits, moves, removals and container replacement. The bundled original synthetic conversations satisfy this contract.
Inline markup and preformatted code are supported. Inputs, editable regions,
hidden content, script/style/template, iframe, canvas, SVG, shadow DOM, virtualized
history, PDF, generated CSS content and live provider adapters are unsupported.
Selections must have text-node endpoints, remain in the root and include only
indexed text. Reload requires another explicit activation. Nothing runs on pages
before activation. After observed changes the panel invalidates highlights and recomputes anchors
automatically when the document settles. Reload still requires activation.

Text is the concatenation of supported text nodes in DOM order, with a separator
between block elements and at BR. All Unicode whitespace runs become one ASCII
space; leading/trailing whitespace is removed. No case folding, NFC normalization
or punctuation correction is performed. Offsets count Unicode code points, not
UTF-16 units; DOM mappings retain UTF-16 boundaries. Cross-block selections include
the synthetic spaces. Split surrogate pairs are rejected.

Document identity is the full HTTP(S) URL without fragment (query retained).
No site-provided canonical URL is trusted. Moving a file, changing a port or query,
or using a different origin produces a different source. Imports retain all source
identities; the panel offers All sources and reports mismatches, but does not attach
other-source notes. A SHA-256 fingerprint covers normalized full source text.

Each note stores quote, up to 32 code points of context on each side, code-point
start/end, source URL and source fingerprint. If the full fingerprint matches,
the position and quote must match to be exact. Otherwise, zero literal quote
matches means missing, one means uniquely reanchored, and multiple means ambiguous.
Context is evidence for human review, not a tie-breaker. No fuzzy search or guessed
attachment. Even a repeated quotation whose original position is intact becomes
ambiguous after any source change. This deliberately accepts false uncertainty.
A unique textual match cannot prove semantic identity after a replacement.

Limits: 200,000 normalized code points, 400,000 raw UTF-16 units, 10,000 visited DOM
nodes, 2,000 code points per selection, 4,000 code points per note body, 500 total
notes, 2 MiB UTF-8 import/export/storage payload, 20 mounted note rows, 20 current
page highlights. Literal matching stops at the second occurrence. Document limits fail
closed; notes remain exportable. No automatic trimming or eviction.

Saved-note storage is a single versioned envelope in chrome.storage.local, written by a
serialized service-worker queue. Optimistic revisions reject concurrent stale
writes. UI state changes only after a successful write. Import validates the entire
envelope before merging: identical UUID+content is skipped; conflicting UUID or
any malformed record rejects the entire import. Export is deterministic (sorted
UUIDs, fixed property order, no changing export timestamp). Unknown fields are
rejected. Imported data is always rendered as text. This is a project-specific
versioned JSON format inspired by W3C selectors, not a JSON-LD implementation.


## Dynamic document contract

A MutationObserver watches `document` for subtree child-list, character-data and
attribute changes, including changes outside the current conversation. This
conservative scope catches removed/replaced roots or bodies, additional candidate
roots, ancestor visibility and stylesheet DOM changes. Any non-extension mutation
may affect root discovery or CSS, so it invalidates the whole text snapshot. The
panel host and its highlight stylesheet are excluded by object identity; shadow
panel edits and CSS Highlight API updates do not produce observed mutations.

At observer delivery, highlights are removed and mounted rows show **pending**.
No synchronous observer can run before the page's own mutation task finishes.
After 150 ms without relevant mutations, a bounded index and fingerprint are
computed. An epoch check and queued-record drain discard a result if the document
changed during hashing. Capture and navigation additionally reindex and check the
epoch before using ranges. Pending/incomplete rows have no highlight or attachment;
the jump control uses `aria-disabled` so disabling navigation preserves keyboard
focus. Its handler independently rejects unavailable anchors and source mismatches.

Continuous changes remain pending without repeated full indexes. One automatic
window allows 8 indexing attempts and 120 relevant mutation batches per 10 seconds.
A batch exceeding 1,000 records is not scanned. Overflow latches **incomplete**
until manual refresh resets the budget. The browser itself allocates mutation
records; these limits bound this extension's processing, not browser allocations
or a host script's work. Ignored extension changes do not consume the relevant
batch budget. A callback scans at most 1,000 records and stops at the first relevant
one. Only the first pending transition updates rows; subsequent streaming callbacks
reset one timer. Processing counters are bounded scalars, not an accumulating log.

Root discovery visits at most 20,000 document nodes, including outside the root.
Indexing visits at most 10,000 nodes, 128 nested levels and 128 ancestor levels;
raw and normalized text bounds above still apply. Only 20 visible notes are anchored
per update; other pages are resolved on demand. Automatic updates change tags and
jump availability in place, leaving note controls, draft text, caret and page
selection intact. The host browser may itself move a selection when its selected
DOM is edited or removed; the extension does not reconstruct such selections.
Ordinary DOM updates do not read or write the saved notebook. Navigation clears
the source filter immediately and requires destination identity resolution as
described below; notes retain their original identities.

Missing/multiple/hidden roots, marked incomplete content and exhausted document
limits produce **incomplete**, not a guessed missing anchor. `aria-busy="true"` or
`data-margin-notes-incomplete="true"` on the root, an ancestor, or a visited element
rejects the snapshot. Ordinary document failures retry after the next mutation;
processing-budget failures require manual refresh. Refresh also rereads storage,
without discarding an open draft. Export remains available; writes require a ready,
resolved current source.

This is a text-DOM contract, not a guarantee of a complete provider transcript.
Virtualized/unloaded history that is not marked incomplete cannot be inferred.
A quiet pause in unmarked streaming text can yield a provisional complete snapshot;
later chunks invalidate it again. CSSOM `insertRule`, media-query/viewport changes,
font loading, animation and generated content may change presentation without
emitting a mutation. History API navigation is handled separately below. Use manual refresh for
these cases; capture/navigation revalidate text and source, but idle highlights
cannot be guaranteed current for unobserved changes. Shadow/iframe content remains
excluded. Live provider behavior and human assistive-technology behavior have not
been validated.

## Same-tab navigation and draft recovery

The Navigation API is required. Native `navigate` and `currententrychange` events
invalidate the session for pushState, replaceState (including same-URL entries),
and same-document back/forward. `popstate`/`hashchange` and checks before actions
provide additional URL checks. No history methods are patched and no MAIN-world
bridge, polling timer, webNavigation permission or host permission is added.
Synthetic events cannot establish identity. A browser without the Navigation API
fails closed. Only the explicitly activated top-level document is supported.

At native event delivery, previous highlights and the current-source list are
cleared synchronously. Writes are suspended. The page session increases even for
A→B→A, so a late A response cannot be mistaken for the new A session. DOM epochs
separately invalidate asynchronous fingerprints. Ordinary mutations still preserve
mounted rows and focus; navigation intentionally changes the source list.

Automatic destination recovery requires exactly one supported root with
`data-margin-notes-source` equal to the full canonical, fragment-free current URL.
The attribute must be an absolute URL, with query retained, not a canonical-link
hint. An adapter must mark content `aria-busy="true"` or
`data-margin-notes-incomplete="true"` **before** changing identity/content, and
publish the destination marker only with its complete rendered content. Once a
marker has been observed, removing it requires explicit confirmation; it does not
restore initial unmarked compatibility. It must
also cancel obsolete rendering jobs. URL-first transitions keep the old marker;
content-first transitions mismatch the old URL; neither attaches notes. Container
replacement follows the same rules. A marker is the trusted page's assertion,
not proof of semantic identity or a security boundary against hostile pages.

Initial explicit activation accepts an unmarked document as before. After any
navigation, an unmarked destination remains **unresolved** even if quiet or if its
quotation matches. **Refresh notes & anchors** retries discovery and reads storage;
it does not assert identity. **Confirm displayed conversation** is offered only
for an unmarked, fragment-free destination. The user must verify the displayed
conversation and URL before confirming. It cannot override a mismatched marker,
unsupported URL, busy root or ambiguous root. Unmarked content-first changes
before a URL event cannot be distinguished from ordinary transcript edits; adapters
must mark incomplete before such changes. No live-provider adapter is validated.

All nonempty fragments are treated conservatively as unresolved, including ordinary
in-page anchors: a generic extension cannot tell an anchor from an application
router key. Return to a fragment-free URL to recover. Version 1 stored sources and
exports remain fragment-free; historical notes are never migrated or silently
merged. Same-URL History API navigation is invalidated, but two distinct conversations
that share a canonical URL cannot be represented by this schema. Such applications
need an adapter and an explicit future data-format design.

One active editor is retained across same-document transitions, including its
original source, original edit ID (or stable new-note UUID), selector and text. It
stays visible and selectable but suspended; destination navigation cannot change
its source. A second draft cannot replace it. Return to its original source and
choose **Recover draft on this source** to reread storage and explicitly resume.
Recovery checks the original ID, including a create that completed after navigation;
it will not duplicate that note. A deleted original edit remains retained with a
conflict diagnostic and export/separate-note recovery actions. **Cancel draft** is explicit discard. Closing the panel
retains the draft. Full reload, tab close or cross-document navigation destroys the active editor;
acknowledged drafts remain in local storage for explicit recovery. Edits not yet
acknowledged can be lost. A beforeunload warning is requested for pending edits
but is subject to browser policy. See the [persistent draft contract](drafts.md).

Read replies are committed only to their originating page session. Stale replies
trigger a fresh read. The worker serializes writes, checks revision and the exact
sending tab URL at acceptance, and enforces the immutable note/source pairing for
create, edit and delete. A queued operation whose URL has changed is rejected.
An already-accepted atomic storage write cannot be cancelled by navigation: it may
finish on its **original** note/source. Its stale UI reply cannot install data,
clear the draft or repaint anchors in the destination session; the panel rereads
storage and retains the draft for explicit review. The design makes no claim of
transactional cancellation across a browser navigation and chrome.storage.
All-sources rows label other-source notes and cannot attach or save/delete them
from the current source. Notebook imports remain global, atomic and source-preserving.
An import file read that crosses sessions is cancelled before dispatch.
