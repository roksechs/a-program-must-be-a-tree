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
    self.postMessage({ type: "done", doc });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message });
  }
};
