// Analyzes a public GitHub repository, fetched entirely client-side via the
// GitHub REST API and raw.githubusercontent.com — no clone, no server. See
// browserAnalyzer.js for the shared analysis pipeline; this file only turns
// a repo spec into the same Map<path, text> localAnalyzer.js builds from a
// local folder. vendor/analyzer-core.js is imported lazily (see
// browserAnalyzer.js's own comment on why): a static import of it here would
// break loading this module before `npm run vendor` has run.
import { analyzeFiles } from "./browserAnalyzer.js";

const API = "https://api.github.com";
const CONCURRENCY = 8;

/** "owner/repo", "owner/repo@ref", or a github.com URL -> { owner, repo, ref } (ref null: the repo's default branch). */
export function parseGithubSpec(spec) {
  const s = spec.trim().replace(/\/+$/, "");
  const url = s.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/tree\/(\S+))?$/);
  if (url) return { owner: url[1], repo: url[2], ref: url[3] ?? null };
  const short = s.match(/^([^/\s@]+)\/([^/\s@]+?)(?:\.git)?(?:@(\S+))?$/);
  if (short) return { owner: short[1], repo: short[2], ref: short[3] ?? null };
  throw new Error(`could not parse "${spec}" as owner/repo, owner/repo@ref, or a github.com URL`);
}

async function githubJson(path) {
  const res = await fetch(`${API}${path}`, { headers: { Accept: "application/vnd.github+json" } });
  if (res.ok) return res.json();
  if (res.status === 403 || res.status === 429) throw new Error("GitHub API rate limit reached (60 requests/hour without signing in) — try again later");
  if (res.status === 404) throw new Error(`not found on GitHub: ${path}`);
  throw new Error(`GitHub API error ${res.status} for ${path}`);
}

function hasSourceExtension(path, extensions) {
  const name = path.split("/").pop();
  const dot = name.lastIndexOf(".");
  return extensions.has(dot === -1 ? "" : name.slice(dot)) && !name.endsWith(".d.ts");
}

/** Same directory-name exclusions as analyzers/ts/analyze.mjs's listSourceFiles, applied to a tree path's directory segments. */
function pathExcluded(path, exclude) {
  const segments = path.split("/");
  return segments.slice(0, -1).some((seg) => exclude.includes(seg));
}

/** The file entries of a repo tree worth analyzing (docs/DATA_FORMAT.md-relevant source, not vendored/build output). */
async function fetchTree(owner, repo, ref, exclude, extensions) {
  const data = await githubJson(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`);
  if (data.truncated) throw new Error(`${owner}/${repo}@${ref} has too many files for GitHub's recursive tree API in one request`);
  return data.tree.filter((e) => e.type === "blob" && hasSourceExtension(e.path, extensions) && !pathExcluded(e.path, exclude));
}

/** Fetch every entry's raw content, `CONCURRENCY` requests at a time. */
async function fetchBlobs(owner, repo, ref, entries, onProgress) {
  const files = new Map();
  const queue = [...entries];
  let done = 0;
  const worker = async () => {
    while (queue.length > 0) {
      const entry = queue.shift();
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${entry.path}`);
      if (res.ok) files.set(`/${entry.path}`, await res.text());
      onProgress?.(++done, entries.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return files;
}

/**
 * Analyze a public GitHub repository. `onProgress(done, total)` is called as
 * files are fetched; `onPhase` as analysis moves past that (see
 * browserAnalyzer.js's analyzeFiles).
 */
export async function analyzeGithubRepo(spec, { nested, onProgress, onPhase } = {}) {
  const { DEFAULT_EXCLUDES, EXTENSIONS } = await import("../vendor/analyzer-core.js");
  const { owner, repo, ref: givenRef } = parseGithubSpec(spec);
  const ref = givenRef ?? (await githubJson(`/repos/${owner}/${repo}`)).default_branch;
  const entries = await fetchTree(owner, repo, ref, DEFAULT_EXCLUDES, EXTENSIONS);
  const files = await fetchBlobs(owner, repo, ref, entries, onProgress);
  return analyzeFiles(files, { name: `${owner}/${repo}`, nested, rootLabel: `${owner}/${repo}@${ref}`, onPhase });
}

/**
 * A small, fixed set of well-known JavaScript/TypeScript repositories, shown
 * as suggestions before the user has typed a search query — GitHub's search
 * API needs a real query string (there is no "most popular" query for an
 * empty one), and this doubles as a demo of what the feature is for without
 * spending any of its own, much stricter rate limit (10 requests/minute
 * unauthenticated, versus 60/hour for the rest of the GitHub API).
 */
export const POPULAR_REPOS = [
  { full_name: "expressjs/express", description: "Fast, unopinionated, minimalist web framework for node." },
  { full_name: "axios/axios", description: "Promise based HTTP client for the browser and node.js." },
  { full_name: "date-fns/date-fns", description: "Modern JavaScript date utility library." },
  { full_name: "chartjs/Chart.js", description: "Simple HTML5 Charts using the canvas element." },
  { full_name: "preactjs/preact", description: "Fast 3kb React alternative with the same modern API." },
  { full_name: "sindresorhus/got", description: "Human-friendly and powerful HTTP request library for Node.js." },
];

/**
 * Search public repositories by name/description (GitHub's search API, not
 * the same endpoint or rate limit as analyzeGithubRepo's — 10 requests per
 * minute unauthenticated, so callers should debounce). Restricted to
 * JavaScript/TypeScript/Svelte repositories, the kinds this analyzer can
 * read; ranked by stars.
 */
export async function searchGithubRepos(query, limit = 8) {
  const q = `${query} language:javascript OR language:typescript OR language:svelte`;
  const data = await githubJson(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${limit}`);
  return (data.items ?? []).map((r) => ({ full_name: r.full_name, description: r.description, stars: r.stargazers_count }));
}
