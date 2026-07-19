import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

/** Rendered show notes for one episode. */
export interface ShowNotes {
  /** Sanitized HTML for the episode web page. */
  pageHtml: string;
  /** Same content, safe for RSS <content:encoded> (CDATA-wrapped by the feed). */
  rssHtml: string;
  /** Plain text fallback (RSS <description> when no explicit summary is wanted). */
  plainText: string;
}

/** Tags allowed in rendered notes. Email layout tags (table/tr/td, style, head)
 *  are dropped but their text content survives, which flattens email newsletters
 *  into linear content. */
const ALLOWED_TAGS = [
  "a",
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "strong",
  "b",
  "em",
  "i",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "hr",
];

function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["https", "http", "mailto"],
    // Email newsletters wrap everything in tables and styled divs; keep the text,
    // drop the chrome entirely for these:
    nonTextTags: ["style", "script", "head", "title", "textarea", "option"],
    transformTags: {
      // Styled divs become paragraphs so flattened email content keeps line structure.
      // (spans and other unlisted tags unwrap automatically, keeping their text)
      div: "p",
    },
  });
}

/** Nested email divs each become <p>, producing invalid nested paragraphs.
 *  Linearize them into siblings: <p>a<p>b</p>c</p> → <p>a</p><p>bc</p>.
 *  Safe because sanitize() emits only bare <p> tags (no attributes). */
function flattenParagraphs(html: string): string {
  let out = "";
  let last = 0;
  let depth = 0;
  const re = /<(\/?)p>/g;
  let m = re.exec(html);
  while (m !== null) {
    out += html.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] === "") {
      depth++;
      out += depth === 1 ? "<p>" : "</p><p>";
    } else if (depth > 0) {
      depth--;
      out += depth === 0 ? "</p>" : "";
    }
    m = re.exec(html);
  }
  return out + html.slice(last);
}

/** Collapse the empty paragraphs and whitespace runs that email-table flattening leaves. */
function tidy(html: string): string {
  return flattenParagraphs(html)
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/(\r?\n)[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toPlainText(html: string): string {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return text
    .replace(
      /&(amp|lt|gt|quot|#39|apos|nbsp);/g,
      (m) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&#39;": "'",
          "&apos;": "'",
          "&nbsp;": " ",
        })[m] ?? m,
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function renderNotes(source: string, kind: "md" | "html"): ShowNotes {
  const rawHtml = kind === "md" ? (marked.parse(source, { async: false }) as string) : source;
  const clean = tidy(sanitize(rawHtml));
  return {
    pageHtml: clean,
    rssHtml: clean,
    plainText: toPlainText(clean),
  };
}

/** Sniff whether fetched source text is HTML or Markdown. */
export function sniffSourceKind(url: string, contentType: string, body: string): "md" | "html" {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "md";
  if (path.endsWith(".html") || path.endsWith(".htm")) return "html";
  if (contentType.includes("text/html")) return "html";
  if (contentType.includes("markdown")) return "md";
  return /^\s*(<!doctype|<html|<table|<div|<p[ >])/i.test(body) ? "html" : "md";
}
