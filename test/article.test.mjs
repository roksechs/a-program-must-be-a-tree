import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES } from "../site/js/i18n.js";
import { parseDirective, renderInline, renderMarkdown } from "../site/js/markdown.js";

const content = new URL("../site/content/", import.meta.url).pathname;

test("every chapter exists in every language, and nothing is unlisted", () => {
  const chapters = JSON.parse(readFileSync(join(content, "chapters.json"), "utf8"));
  assert.ok(chapters.length > 0);
  for (const { code } of LANGUAGES) {
    for (const id of chapters) assert.ok(existsSync(join(content, code, `${id}.md`)), `${code}/${id}.md is missing`);
    const listed = new Set(chapters.map((id) => `${id}.md`));
    for (const f of readdirSync(join(content, code))) assert.ok(listed.has(f), `${code}/${f} is not in chapters.json`);
  }
});

test("every chapter has a title and asks only for datasets that exist", () => {
  const chapters = JSON.parse(readFileSync(join(content, "chapters.json"), "utf8"));
  const datasets = new Set(JSON.parse(readFileSync(new URL("../site/data/index.json", import.meta.url), "utf8")).map((d) => d.id));
  for (const { code } of LANGUAGES) {
    for (const id of chapters) {
      const { html, directives } = renderMarkdown(readFileSync(join(content, code, `${id}.md`), "utf8"));
      assert.match(html, /^<h1>/, `${code}/${id}.md must start with a level-one heading`);
      for (const d of directives) if (d.graph) assert.ok(datasets.has(d.graph), `${code}/${id}.md asks for dataset ${d.graph}`);
    }
  }
});

test("markdown: blocks", () => {
  const { html, directives } = renderMarkdown(
    ["<!-- graph: sample-tree; view: 3d -->", "# Title", "", "One *two* **three** `a<b`.", "continued.", "", "```js", "x < y", "```", "> quoted", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "- one", "- two", "  more", "", "1. first"].join("\n"),
  );
  assert.deepEqual(directives, [{ graph: "sample-tree", view: "3d" }]);
  assert.match(html, /^<h1>Title<\/h1>/);
  assert.match(html, /<p>One <em>two<\/em> <strong>three<\/strong> <code>a&lt;b<\/code>\. continued\.<\/p>/);
  assert.match(html, /<pre><code class="language-js">x &lt; y<\/code><\/pre>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
  assert.match(html, /<ul><li>one<\/li><li>two more<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><\/ol>/);
});

test("markdown: no raw HTML passes through, comments without directives vanish", () => {
  const { html, directives } = renderMarkdown("<!-- just a note -->\n<script>alert(1)</script>\n\n[link](https://example.org) and <b>x</b>");
  assert.deepEqual(directives, []);
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="https:\/\/example.org">link<\/a> and &lt;b&gt;x&lt;\/b&gt;/);
});

test("markdown: inline code is left alone, directives parse loosely", () => {
  assert.equal(renderInline("`**not bold**` **bold**"), "<code>**not bold**</code> <strong>bold</strong>");
  assert.equal(renderInline("**bold with `a<b` inside** and *em*"), "<strong>bold with <code>a&lt;b</code> inside</strong> and <em>em</em>");
  assert.deepEqual(parseDirective(" graph : self-nested ;labels:all; pitch: 0.4 "), { graph: "self-nested", labels: "all", pitch: "0.4" });
  assert.equal(parseDirective("just words"), null);
});
