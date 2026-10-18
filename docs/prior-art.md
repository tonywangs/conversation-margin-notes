# Existing work reviewed

Reviewed 2026-10-16 before implementation:

- [W3C Web Annotation Data Model, text quote and text position selectors](https://www.w3.org/TR/annotation-model/#selectors): quote/context and position are complementary descriptions. Position offsets refer to Unicode code points and are brittle under edits. This project specifies its normalization and stores both plus a source digest.
- [Hypothesis HTML anchoring](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/html.ts): resolves range, position and quote selectors in sequence and checks quote consistency. This project instead refuses multiple literal matches after source changes; it does not reproduce Hypothesis's mature cross-site support.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): explicit action or keyboard invocation grants temporary tab access. No persistent host permission is necessary here.
- [Chrome local storage](https://developer.chrome.com/docs/extensions/reference/api/storage): asynchronous writes can fail; the worker serializes writes and the panel retains drafts on failure.

Passage annotation and quote anchoring are established techniques. No novelty claim
is made. The useful scope here is an offline, bounded, inspectable workflow with
explicit uncertainty and a reproducible synthetic mutation suite.


Dynamic-page milestone review (2026-10-16):

- [WHATWG DOM mutation observers](https://dom.spec.whatwg.org/#mutation-observers)
  specifies queued record delivery and observation registration. This controller
  treats delivered mutations as invalidating an epoch, then drains queued records
  before committing asynchronous work.
- [MDN observe()](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe)
  documents subtree options and continued observation of removed descendants until
  removal delivery. Observing the Document here also covers body/root replacement;
  bounded callback work avoids rewalking the document for every streaming chunk.
- [Hypothesis HTML anchoring implementation](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/html.ts)
  was reviewed again: it tries several selector types and checks quotes. This
  project's dynamic controller retains its narrower literal-uniqueness policy.
  It does not claim to improve on Hypothesis's general anchoring or reproduce its
  complete dynamic-page behavior.

Mutation observation, debouncing and annotation recovery are established patterns.
The contribution here is a small bounded implementation with explicit incomplete
states and a reproducible installed-extension mutation oracle, not novelty.

## Same-tab navigation review (2026-10-18)

- [Chrome Navigation API overview](https://developer.chrome.com/docs/web-platform/navigation-api)
  describes native navigation notifications, History API integration, and the gap
  between a committed URL and asynchronously updated content. A URL event alone
  does not establish that the rendered transcript belongs to the destination.
- [WHATWG Navigation API](https://html.spec.whatwg.org/multipage/nav-history-apis.html#the-navigation-api)
  defines navigation and current-entry events. The extension observes these events
  without intercepting/cancelling the page's navigation or replacing History methods.
- [Chrome isolated content-script worlds](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#work_in_isolated_worlds)
  explains why patching `history.pushState` in an isolated extension world does not
  patch the site's JavaScript environment. Native events avoid a page-script bridge,
  injected MAIN-world hooks and new host permissions.
- [Hypothesis Guest implementation](https://github.com/hypothesis/client/blob/main/src/annotator/guest.ts)
  accepts a content-ready promise and listens to its integration's `uriChanged`
  notification. This reinforces the distinction between location and content
  readiness. This project does not reproduce its adapters or claim a new technique.

The chosen scope is fragment-free same-document HTTP(S) transitions in Chromium,
with explicit identity markers for automatic recovery and a manual confirmation
path for unmarked destinations. Hash routes are detected but deliberately remain
unresolved because the existing portable schema identifies fragment-free sources.
