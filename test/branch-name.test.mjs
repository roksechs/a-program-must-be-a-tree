import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LABEL, checkBranchName, previewAlias, workerNameFrom } from "../scripts/check-branch-name.mjs";

const worker = workerNameFrom(new URL("../wrangler.jsonc", import.meta.url));

test("the preview alias is the branch name lowercased with hyphens for everything else", () => {
  assert.equal(previewAlias("feature/Add_Thing.v2"), "feature-add-thing-v2");
  assert.equal(previewAlias("--weird__name--"), "weird-name");
  assert.equal(previewAlias("ch3-dry"), "ch3-dry");
});

test("a branch fits when alias + hyphen + worker name is within one DNS label", () => {
  assert.equal(worker, "a-program-must-be-a-tree");
  const allowed = MAX_LABEL - 1 - worker.length;
  assert.equal(allowed, 38);
  assert.equal(checkBranchName("a".repeat(allowed), worker).ok, true);
  assert.equal(checkBranchName("a".repeat(allowed + 1), worker).ok, false);
  assert.equal(checkBranchName("ch3-dry", worker).ok, true);
  // The branch this check was written on is the motivating failure.
  const r = checkBranchName("claude/diagnosis-scope-class-paradigms-9vkyut", worker);
  assert.equal(r.ok, false);
  assert.equal(r.alias, "claude-diagnosis-scope-class-paradigms-9vkyut");
  assert.match(r.reason, /at most 38 characters/);
});

test("the production branch needs no alias, and a name without letters or digits is rejected", () => {
  assert.equal(checkBranchName("main", worker).ok, true);
  assert.equal(checkBranchName("main", worker, { productionBranch: "main" }).alias, null);
  assert.equal(checkBranchName("___", worker).ok, false);
});
