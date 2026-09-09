// Runs a local-folder or GitHub-repo analysis off the main thread: building
// a ts.Program and walking it with the type checker is heavy enough (a few
// hundred thousand lines can block the page for 10+ seconds — see
// docs/DESIGN.md) that doing it on the main thread would freeze the UI for
// the duration. app.js creates one of these per analysis and terminates it
// when done.
//
// A classic (non-module) worker on purpose: importScripts() — needed to load
// vendor/typescript.js's plain `var ts = {}` the same way a classic <script>
// tag does on the main thread (see browserAnalyzer.js's loadTypeScript) — is
// not available inside a module worker. Dynamic import() of the real ES
// modules that do the actual work is available in a classic script too, so
// nothing here is duplicated: analyzeLocalFolder/analyzeGithubRepo run
// exactly the code they would on the main thread.
self.onmessage = async (event) => {
  const { kind, payload, options } = event.data;
  const onProgress = (...args) => self.postMessage({ type: "progress", args });
  const onPhase = (phase, detail) => self.postMessage({ type: "phase", phase, detail });
  try {
    let doc;
    if (kind === "local") {
      const localAnalyzer = await import("./localAnalyzer.js");
      doc = await localAnalyzer.analyzeLocalFolder(payload.dirHandle, { ...options, onProgress, onPhase });
    } else if (kind === "github") {
      const githubAnalyzer = await import("./githubAnalyzer.js");
      doc = await githubAnalyzer.analyzeGithubRepo(payload.spec, { ...options, onProgress, onPhase });
    } else {
      throw new Error(`unknown analysis kind: ${kind}`);
    }
    // Lay the result out before handing it back. The alternative is for the
    // page to do it on the main thread, which is ~22ms a tick at 2,100 nodes
    // for the ~1,200 the layout needs — half a minute of a page that cannot
    // be scrolled, every time a folder is opened. Here it is off the main
    // thread, behind the progress the analysis was already reporting, and
    // stored with the analysis, so it happens once and never again for this
    // folder (site/js/layout.js).
    //
    // `d3.min.js` is a classic script defining the `d3` global that
    // simulation.js reads; importScripts is how a classic worker loads one,
    // and `self.location` is this script's own URL — `import.meta` is not
    // available here, and a bare relative path would resolve against the
    // page.
    importScripts(new URL("../vendor/d3.min.js", self.location.href).href);
    // Imported as a namespace rather than destructured, like localAnalyzer
    // above: the analyzer resolves a member read off a dynamic import's
    // namespace but not a binding destructured out of one, so the
    // destructured form makes `layOutDocument` look uncalled in this
    // project's own graph (test/dead-code.test.mjs finds it).
    const layout = await import("./layout.js");
    const laidOut = layout.layOutDocument(doc, { onProgress: ({ ticks }) => onPhase("layout", ticks) });
    self.postMessage({ type: "done", doc, layout: laidOut });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message });
  }
};
