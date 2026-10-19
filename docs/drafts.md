# Persistent draft contract

The storage and conflict rules below also apply to the extension-owned editor.
Detailed in-page navigation controls and test histories describe the retired UI.
The protected editor provides recovery, discard and export, but no “Start a
separate note” shortcut. Export a conflicting draft before discarding and opening
a fresh edit. Its production recovery/conflict checks are recorded separately in
`results/secure-verification.json`.

Drafts are recoverable work, not saved notes.
The existing version-1 notebook and permission set remain unchanged.

Each editor has a random draft UUID, stable target note UUID, original source and
selector, creation time, base notebook revision and optional original note snapshot.
A separate versioned `drafts` storage key holds at most 32 records and 1 MiB of
UTF-8 JSON. Each record holds at most 8,000 Unicode code points of draft text (the
saved-note limit remains 4,000). Records never expire or evict automatically;
capacity rejection retains the editor and existing persisted records. Explicit
export/discard frees space. Removing the extension removes local data.

Input starts a 300 ms trailing debounce. Only one draft write is in flight per
editor; further input coalesces into its next snapshot. Pending text and acknowledged
text are distinguished. A successful storage promise is required before saying
“Draft persisted”. Failure leaves current text and the last persisted snapshot
intact, with retry and export actions. Reload/close/crash before acknowledgment can
lose recent edits. Lifecycle events are best-effort flush opportunities, not a
promise of persistence. Closing the panel keeps the editor alive.

Worker mutations are serialized. Each record has a monotonically increasing
version, compared before replacement or discard; missing/stale versions reject.
Concurrent tabs may have independent drafts for one note. Two recoveries of one
draft compete by version: a loser retains its editor for export, never overwrites
the winner. Original identity and base revision are immutable. Saving uses the
original notebook revision even after Refresh; a changed notebook is a conflict,
including unrelated changes. No automatic merge or overwrite is attempted.

Activation lists persisted drafts with source, text preview and explicit recovery,
export and discard. Recovery requires the original resolved source and rereads
storage. A conflict or deleted note remains recoverable for export or an explicit
save as a separate new note, preserving the old note. Recovery does not change
anchors. Same-document navigation suspends the editor; writes already accepted
still belong to the original source. Delayed acknowledgments must not mark newer
input persisted or clear a different editor. Draft cleanup happens only after a
successful note save; if cleanup fails, the saved note remains and the draft is
retained with a diagnostic. Exact already-saved content is recognized on recovery
so a late successful save is not duplicated.

Recovery JSON is a separate, labeled format containing original identity, base
revision, selector and text. It is not accepted as a saved notebook. It provides an
offline copy even when local storage is full. Notebook export/import stays version 1.


## Implementation details

`drafts.js` validates the bounded storage schema and checks record versions.
`draft-writer.js` coalesces changes, retains an acknowledged body separately from
current text, and exposes bounded timing/count diagnostics. The service worker
serializes draft and note operations on one queue and rereads persisted data for
every request. The panel requires a persisted snapshot before a note save.

Saving validates the draft version, source, body and original notebook revision
at the worker boundary. The note write precedes a separate draft cleanup write.
There is no claimed transaction across these keys: termination or cleanup failure
can leave a recovery copy next to a successfully saved note. Exact matching content
and identity are recognized during explicit recovery. A removed recovery record
can be discarded again harmlessly; an existing newer version cannot be discarded
using an old version. An old writer cannot recreate a removed record with a
nonzero version. The original version-1 notebook envelope is not migrated.

Recovery listings are snapshots refreshed on activation, notebook refresh, saves,
discards or **Refresh recovery drafts**; there is no cross-tab polling. Each action
rereads storage and/or compares a version. Export of a listed draft exports that
listed snapshot; export of the active editor includes its current pending text.
The export is for manual recovery, not automatic draft import.

Chrome's storage acknowledgment is the durability boundary used here; it is not
an fsync guarantee against power loss. No timer can preserve text that was never
sent or acknowledged. Browser suspension, crashes, extension reload/uninstall,
external data clearing and hardware failure remain limitations. All evidence uses
synthetic pages and isolated test profiles, without personal accounts.
