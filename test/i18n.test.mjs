import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES, detectLanguage, getLanguage, kindLabel, missingKeys, onLanguageChange, setLanguage, t } from "../site/js/i18n.js";

test("every language defines exactly the English keys", () => {
  assert.deepEqual(missingKeys(), {});
});

test("every listed language is translatable", () => {
  for (const l of LANGUAGES) {
    setLanguage(l.code);
    assert.equal(getLanguage(), l.code);
    assert.notEqual(t("section.data"), "section.data");
  }
  setLanguage("en");
});

test("interpolation and fallbacks", () => {
  setLanguage("en");
  assert.equal(t("app.status", { nodes: 3, edges: 2 }), "3 declarations · 2 edges");
  assert.equal(t("app.status", { nodes: 3 }), "3 declarations · {edges} edges");
  assert.equal(t("does.not.exist"), "does.not.exist");
  setLanguage("ja");
  assert.equal(t("app.status", { nodes: 3, edges: 2 }), "宣言 3 · エッジ 2");
  assert.equal(kindLabel("function"), "関数");
  assert.equal(kindLabel("weird"), "weird");
  setLanguage("en");
});

test("language detection order: query, saved, browser, default", () => {
  assert.equal(detectLanguage("?lang=ja", "en", "en-US"), "ja");
  assert.equal(detectLanguage("?lang=xx", "ja", "en-US"), "ja");
  assert.equal(detectLanguage("", null, "ja-JP"), "ja");
  assert.equal(detectLanguage("", null, "fr-FR"), "en");
  assert.equal(detectLanguage("", null, undefined), "en");
});

test("listeners fire on change only", () => {
  setLanguage("en");
  const seen = [];
  const off = onLanguageChange((code) => seen.push(code));
  setLanguage("en");
  setLanguage("ja");
  setLanguage("xx");
  off();
  setLanguage("en");
  assert.deepEqual(seen, ["ja"]);
});
