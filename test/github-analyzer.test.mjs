// site/js/githubAnalyzer.js's own imports touch vendor/analyzer-core.js only
// lazily (inside analyzeGithubRepo), specifically so this module can be
// imported in node:test without `npm run vendor` having run first — see its
// header comment. Only parseGithubSpec, a pure function, is exercised here;
// the fetch-driven half needs a real browser and is verified manually.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGithubSpec } from "../site/js/githubAnalyzer.js";

test("parseGithubSpec: owner/repo", () => {
  assert.deepEqual(parseGithubSpec("roksechs/a-program-must-be-a-tree"), { owner: "roksechs", repo: "a-program-must-be-a-tree", ref: null });
});

test("parseGithubSpec: owner/repo@ref", () => {
  assert.deepEqual(parseGithubSpec("roksechs/a-program-must-be-a-tree@main"), { owner: "roksechs", repo: "a-program-must-be-a-tree", ref: "main" });
});

test("parseGithubSpec: a github.com URL, with and without /tree/<ref>", () => {
  assert.deepEqual(parseGithubSpec("https://github.com/d3/d3-force"), { owner: "d3", repo: "d3-force", ref: null });
  assert.deepEqual(parseGithubSpec("https://github.com/d3/d3-force/tree/v3.0.0"), { owner: "d3", repo: "d3-force", ref: "v3.0.0" });
  assert.deepEqual(parseGithubSpec("https://github.com/d3/d3-force.git"), { owner: "d3", repo: "d3-force", ref: null });
});

test("parseGithubSpec: trims whitespace and a trailing slash", () => {
  assert.deepEqual(parseGithubSpec("  roksechs/a-program-must-be-a-tree/  "), { owner: "roksechs", repo: "a-program-must-be-a-tree", ref: null });
});

test("parseGithubSpec: rejects anything else", () => {
  assert.throws(() => parseGithubSpec("not a repo spec"), /could not parse/);
});
