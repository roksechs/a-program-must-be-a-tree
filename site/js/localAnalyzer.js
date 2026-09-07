// Analyzes a local folder, chosen with the File System Access API's
// showDirectoryPicker(), entirely client-side — no server round trip, no
// pre-generated JSON file. See browserAnalyzer.js for the shared part (a
// custom ts.CompilerHost over an in-memory file map, fed to the same
// analyzers/ts/core.mjs the Node CLI uses); this file only reads the picked
// directory into that map. vendor/analyzer-core.js is imported lazily (see
// browserAnalyzer.js's own comment on why): a static import of it here would
// break loading this module before `npm run vendor` has run.
import { analyzeFiles } from "./browserAnalyzer.js";

export function localFolderSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/**
 * Recursively read every source file under a picked directory into a Map of
 * absolute-style path ("/src/app.ts") -> text, skipping the same directory
 * names and extensions analyzers/ts/analyze.mjs's listSourceFiles does (no
 * glob-pattern excludes here — those are a CLI-only convenience).
 */
async function readDirectory(dirHandle, prefix, files, exclude, extensions, onProgress) {
  for await (const [name, handle] of dirHandle.entries()) {
    const path = `${prefix}/${name}`;
    if (handle.kind === "directory") {
      if (exclude.includes(name)) continue;
      await readDirectory(handle, path, files, exclude, extensions, onProgress);
    } else {
      const dot = name.lastIndexOf(".");
      const ext = dot === -1 ? "" : name.slice(dot);
      if (!extensions.has(ext) || name.endsWith(".d.ts")) continue;
      const file = await handle.getFile();
      files.set(path, await file.text());
      onProgress?.(files.size);
    }
  }
}

/**
 * Analyze a directory picked with showDirectoryPicker(). `onProgress(count)`
 * is called as files are read (before analysis itself starts — reading is
 * the part whose duration depends on the folder's size).
 */
export async function analyzeLocalFolder(dirHandle, { name, nested, onProgress } = {}) {
  const { DEFAULT_EXCLUDES, EXTENSIONS } = await import("../vendor/analyzer-core.js");
  const files = new Map();
  await readDirectory(dirHandle, "", files, DEFAULT_EXCLUDES, EXTENSIONS, onProgress);
  return analyzeFiles(files, { name, nested, rootLabel: name ?? dirHandle.name });
}
