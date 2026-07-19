import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { renderNotes, sniffSourceKind } from "../src/lib/notes.js";

const REAL_NEWSLETTER = "C:/dev/daily-newsletters/output/ai-news/2026-07-19.html";

test("markdown renders to sanitized HTML", () => {
  const n = renderNotes("# Title\n\nSome **bold** text and a [link](https://example.com).", "md");
  assert.ok(n.pageHtml.includes("<h1>Title</h1>"));
  assert.ok(n.pageHtml.includes("<strong>bold</strong>"));
  assert.ok(n.pageHtml.includes('<a href="https://example.com">link</a>'));
});

test("scripts, styles, and event handlers are stripped", () => {
  const n = renderNotes(
    `<p onclick="evil()">hi</p><script>alert(1)</script><style>body{}</style><iframe src="x"></iframe>`,
    "html",
  );
  assert.ok(!n.pageHtml.includes("script"));
  assert.ok(!n.pageHtml.includes("onclick"));
  assert.ok(!n.pageHtml.includes("iframe"));
  assert.ok(!n.pageHtml.includes("alert"));
  assert.ok(!n.pageHtml.includes("body{}"));
  assert.ok(n.pageHtml.includes("hi"));
});

test("email-table newsletter flattens to linear content with links intact", () => {
  const email = `<table><tr><td style="padding:1px">
    <div style="font-size:19px"><a href="https://example.com/story" style="color:#000">Big headline</a></div>
    <div style="color:#333">Story body text.</div>
  </td></tr></table>`;
  const n = renderNotes(email, "html");
  assert.ok(!n.pageHtml.includes("<table"));
  assert.ok(!n.pageHtml.includes("<td"));
  assert.ok(!n.pageHtml.includes("style="));
  assert.ok(n.pageHtml.includes('<a href="https://example.com/story">Big headline</a>'));
  assert.ok(n.pageHtml.includes("Story body text."));
});

test("real newsletter HTML produces clean notes", { skip: !existsSync(REAL_NEWSLETTER) }, () => {
  const html = readFileSync(REAL_NEWSLETTER, "utf8");
  const n = renderNotes(html, "html");
  assert.ok(!n.pageHtml.includes("<table"));
  assert.ok(!n.pageHtml.includes("style="));
  assert.ok(n.pageHtml.includes("Chip stocks post worst week"));
  assert.ok(n.pageHtml.includes('href="https://www.bloomberg.com/'));
  assert.ok(n.plainText.length > 500);
});

test("nested email divs never produce nested paragraphs", () => {
  const n = renderNotes("<div>outer <div>inner</div> tail</div>", "html");
  let depth = 0;
  let maxDepth = 0;
  for (const m of n.pageHtml.matchAll(/<(\/?)p>/g)) {
    depth += m[1] ? -1 : 1;
    maxDepth = Math.max(maxDepth, depth);
    assert.ok(depth >= 0, "unbalanced </p>");
  }
  assert.equal(depth, 0, "unbalanced <p>");
  assert.equal(maxDepth, 1, `nested <p> found in: ${n.pageHtml}`);
  assert.ok(n.plainText.includes("outer"));
  assert.ok(n.plainText.includes("inner"));
});

test("plain text strips entities and tags", () => {
  const n = renderNotes("<p>A &amp; B &mdash; C</p>", "html");
  assert.ok(n.plainText.startsWith("A & B"));
});

test("sniffSourceKind detects by extension, content-type, then body", () => {
  assert.equal(sniffSourceKind("https://x.com/a.md", "", ""), "md");
  assert.equal(sniffSourceKind("https://x.com/a.html", "", ""), "html");
  assert.equal(sniffSourceKind("https://x.com/a", "text/html; charset=utf-8", ""), "html");
  assert.equal(sniffSourceKind("https://x.com/a", "", "<!DOCTYPE html><html>"), "html");
  assert.equal(sniffSourceKind("https://x.com/a", "", "# Heading\n\ntext"), "md");
});
