// A small Markdown renderer for the article chapters: headings, paragraphs,
// fenced code, blockquotes, tables, lists, inline code, emphasis and links.
// HTML comments of the form `<!-- key: value; key: value -->` are directives
// for the page (which live graph to mount beside the text) and are returned
// separately; every other comment is dropped. No dependency, no raw HTML
// pass-through: the text is always escaped.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escape text for HTML. */
export function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

/** Parse `key: value; key: value` (the body of a directive comment). */
export function parseDirective(body) {
  const out = {};
  for (const part of body.split(";")) {
    const m = part.match(/^\s*([a-zA-Z][\w-]*)\s*:\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Inline formatting. Code spans are lifted out first so their content is left
 * alone, and put back after links, bold and emphasis have been applied to the
 * rest, so `**bold with \`code\` inside**` works.
 */
export function renderInline(text) {
  const codes = [];
  const withHoles = text.replace(/`([^`]*)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  return escapeHtml(withHoles)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`)
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1<em>$2</em>")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/**
 * Render a Markdown document. Returns { html, directives } where `directives`
 * is the list of parsed directive comments in document order.
 */
export function renderMarkdown(src) {
  const directives = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const paragraph = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(paragraph.join(" ").trim())}</p>`);
    paragraph.length = 0;
  };
  while (i < lines.length) {
    const line = lines[i];
    // Comments: directives are kept, everything else vanishes.
    if (line.trimStart().startsWith("<!--")) {
      flush();
      let body = line;
      while (!body.includes("-->") && i + 1 < lines.length) body += "\n" + lines[++i];
      const inner = body.slice(body.indexOf("<!--") + 4, body.indexOf("-->"));
      const d = parseDirective(inner);
      if (d) directives.push(d);
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      flush();
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++; // closing fence
      out.push(`<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      const quote = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${renderMarkdown(quote.join("\n")).html}</blockquote>`);
      continue;
    }
    if (line.startsWith("|")) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      out.push(renderTable(rows));
      continue;
    }
    const item = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!m) break;
        let text = m[3];
        i++;
        // Continuation lines indented under the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i])) text += " " + lines[i++].trim();
        items.push(`<li>${renderInline(text)}</li>`);
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (line.trim() === "---") {
      flush();
      out.push("<hr>");
      i++;
      continue;
    }
    if (line.trim() === "") {
      flush();
      i++;
      continue;
    }
    paragraph.push(line);
    i++;
  }
  flush();
  return { html: out.join("\n"), directives };
}

function renderTable(rows) {
  const cells = (row) =>
    row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const header = cells(rows[0]);
  const body = rows.slice(rows[1] && /^\|?\s*:?-{2,}/.test(rows[1]) ? 2 : 1);
  const th = header.map((c) => `<th>${renderInline(c)}</th>`).join("");
  const trs = body.map((r) => `<tr>${cells(r).map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}
