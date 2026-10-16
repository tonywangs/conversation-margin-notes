# Existing work reviewed

Reviewed 2026-10-16 before implementation:

- [W3C Web Annotation Data Model, text quote and text position selectors](https://www.w3.org/TR/annotation-model/#selectors): quote/context and position are complementary descriptions. Position offsets refer to Unicode code points and are brittle under edits. This project specifies its normalization and stores both plus a source digest.
- [Hypothesis HTML anchoring](https://github.com/hypothesis/client/blob/main/src/annotator/anchoring/html.ts): resolves range, position and quote selectors in sequence and checks quote consistency. This project instead refuses multiple literal matches after source changes; it does not reproduce Hypothesis's mature cross-site support.
- [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab): explicit action or keyboard invocation grants temporary tab access. No persistent host permission is necessary here.
- [Chrome local storage](https://developer.chrome.com/docs/extensions/reference/api/storage): asynchronous writes can fail; the worker serializes writes and the panel retains drafts on failure.

Passage annotation and quote anchoring are established techniques. No novelty claim
is made. The useful scope here is an offline, bounded, inspectable workflow with
explicit uncertainty and a reproducible synthetic mutation suite.
