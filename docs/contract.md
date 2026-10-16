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

Storage is a single versioned envelope in chrome.storage.local, written by a
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
No automatic update reads or writes the saved notebook. A source URL change detected
during indexing updates the source filter; notes retain their original identities.

Missing/multiple/hidden roots, marked incomplete content and exhausted document
limits produce **incomplete**, not a guessed missing anchor. `aria-busy="true"` or
`data-margin-notes-incomplete="true"` on the root, an ancestor, or a visited element
rejects the snapshot. Ordinary document failures retry after the next mutation;
processing-budget failures require manual refresh. Refresh also rereads storage,
without discarding an open draft. Export and editing saved notes remain available.

This is a text-DOM contract, not a guarantee of a complete provider transcript.
Virtualized/unloaded history that is not marked incomplete cannot be inferred.
A quiet pause in unmarked streaming text can yield a provisional complete snapshot;
later chunks invalidate it again. CSSOM `insertRule`, media-query/viewport changes,
font loading, animation, generated content and URL-only History API navigation may
change presentation/identity without emitting a mutation. Use manual refresh for
these cases; capture/navigation revalidate text and source, but idle highlights
cannot be guaranteed current for unobserved changes. Shadow/iframe content remains
excluded. Live provider behavior and human assistive-technology behavior have not
been validated.
