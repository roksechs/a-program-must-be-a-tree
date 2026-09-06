#!/usr/bin/env node
// Fails when a branch name cannot get a Cloudflare preview URL of its own.
//
// Cloudflare Workers Builds gives every non-production branch a preview alias
// `<alias>-<worker name>.<account>.workers.dev`, where the alias is the branch
// name lowercased with runs of anything but a-z and 0-9 replaced by hyphens.
// A DNS label is at most 63 characters, so a long branch name silently gets no
// alias at all, and the branch is reachable only through a version id. This
// check runs in CI so that a branch learns this when it is created, not when
// somebody looks for its preview.
//
// Usage: node scripts/check-branch-name.mjs [branch]
// The branch defaults to GITHUB_HEAD_REF, then GITHUB_REF_NAME, then git HEAD.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const MAX_LABEL = 63;

/** The preview alias Cloudflare derives from a branch name. */
export function previewAlias(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Check a branch name against the worker name. Returns { ok, alias, label,
 * allowed, reason }: `allowed` is the longest alias that still fits.
 */
export function checkBranchName(branch, workerName, { productionBranch = "main" } = {}) {
  const allowed = MAX_LABEL - 1 - workerName.length;
  if (branch === productionBranch) return { ok: true, alias: null, label: null, allowed, reason: "production branch, no alias needed" };
  const alias = previewAlias(branch);
  const label = `${alias}-${workerName}`;
  if (alias.length === 0) return { ok: false, alias, label, allowed, reason: "the branch name has no letters or digits" };
  if (label.length > MAX_LABEL) {
    return { ok: false, alias, label, allowed, reason: `"${label}" is ${label.length} characters; a hostname label holds ${MAX_LABEL}, so the alias may be at most ${allowed} characters and "${alias}" is ${alias.length}` };
  }
  return { ok: true, alias, label, allowed, reason: `preview alias "${alias}" fits` };
}

/** The worker name from wrangler.jsonc (comments allowed). */
export function workerNameFrom(path) {
  const text = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(text).name;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const branch = process.argv[2] || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const workerName = workerNameFrom(resolve(root, "wrangler.jsonc"));
  const result = checkBranchName(branch, workerName);
  if (result.ok) {
    console.log(`branch "${branch}": ${result.reason}`);
  } else {
    const message = `branch "${branch}" gets no Cloudflare preview alias: ${result.reason}. Use a branch name whose alias is at most ${result.allowed} characters, e.g. "${result.alias.slice(0, result.allowed).replace(/-+$/, "")}".`;
    // A GitHub Actions error annotation when running there, a plain line otherwise.
    console.error(process.env.GITHUB_ACTIONS ? `::error::${message}` : message);
    process.exit(1);
  }
}
