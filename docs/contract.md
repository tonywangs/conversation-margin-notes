# Supported document and anchoring contract (version 1)

The user explicitly activates the extension on a top-level HTTP(S) document.
Exactly one `[data-margin-notes-root]` element or, as a fallback, exactly one
`main` element must exist. Only static, visible light-DOM text inside that root
is supported. The bundled original synthetic conversations satisfy this contract.
Inline markup and preformatted code are supported. Inputs, editable regions,
hidden content, script/style/template, iframe, canvas, SVG, shadow DOM, virtualized
history, PDF, generated CSS content and live provider adapters are unsupported.
Selections must have text-node endpoints, remain in the root and include only
indexed text. Reload requires another explicit activation. Nothing runs on pages
before activation. Refresh anchors after changes; the panel invalidates highlights
on observed DOM changes and never navigates using stale ranges.

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
page highlights. At most 501 quote occurrences are counted. Document limits fail
closed; notes remain exportable. No automatic trimming or eviction.

Storage is a single versioned envelope in chrome.storage.local, written by a
serialized service-worker queue. Optimistic revisions reject concurrent stale
writes. UI state changes only after a successful write. Import validates the entire
envelope before merging: identical UUID+content is skipped; conflicting UUID or
any malformed record rejects the entire import. Export is deterministic (sorted
UUIDs, fixed property order, no changing export timestamp). Unknown fields are
rejected. Imported data is always rendered as text. This is a project-specific
versioned JSON format inspired by W3C selectors, not a JSON-LD implementation.
