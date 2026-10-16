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
