// Persists local-folder and GitHub-repo analysis results in IndexedDB, so
// reopening a folder or repo the browser already analyzed doesn't mean
// reading every file and rebuilding the ts.Program again — the whole point
// of the "Recently opened" list in panel.js. Bundled datasets
// (site/data/*.json) are never stored here: this is only for analyses the
// browser itself ran, not the pre-generated examples the panel's Dataset
// dropdown already lists.
const DB_NAME = "a-program-must-be-a-tree";
const DB_VERSION = 1;
const STORE = "analyses";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("analyzedAt", "analyzedAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const idFor = (kind, key) => `${kind}:${key}`;

/**
 * Save (or overwrite) one analysis. `key` identifies it within `kind`:
 * "owner/repo@ref" for a GitHub repo; an opaque id (the caller's choice,
 * e.g. crypto.randomUUID()) for a local folder, which has no name stable
 * or unique enough to key by — `dirHandle` (a real FileSystemDirectoryHandle,
 * itself IndexedDB-storable) is how a local entry is reopened later, via a
 * fresh permission request, not by matching names.
 */
export async function saveAnalysis({ kind, key, label, doc, dirHandle }) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      id: idFor(kind, key),
      kind,
      key,
      label,
      doc,
      dirHandle: dirHandle ?? null,
      fileCount: doc.meta?.files ?? null,
      analyzedAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Most recently analyzed entries, newest first. */
export async function listRecentAnalyses(limit = 10) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction(STORE, "readonly").objectStore(STORE).index("analyzedAt").openCursor(null, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) {
        resolve(out);
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAnalysis(kind, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(idFor(kind, key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
