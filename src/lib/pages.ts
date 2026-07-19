import type { EpisodeMeta, SeriesConfig, SiteConfig } from "../types.js";
import { enclosureUrl, episodeAudioUrl, feedUrl, seriesUrl } from "./feed.js";
import { esc } from "./xml.js";

interface PageOptions {
  title: string;
  description: string;
  themeColor: string;
  /** path prefix from this page back to the series root, e.g. "" or "../../" */
  faviconHref: string | null;
  body: string;
}

function layout(o: PageOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
${o.faviconHref ? `<link rel="icon" type="image/png" href="${esc(o.faviconHref)}">` : ""}
<style>
:root {
  --theme: ${o.themeColor};
  --bg: #f6f7f9; --surface: #ffffff; --text: #14181f; --muted: #5b6572;
  --border: #e4e7ec; --player-bg: #eef1f5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1117; --surface: #171c24; --text: #e8eaee; --muted: #9aa4b1;
    --border: #2a313c; --player-bg: #1f2630;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.65; -webkit-text-size-adjust: 100%;
}
a { color: var(--theme); }
.wrap { max-width: 46rem; margin: 0 auto; padding: 0 1.25rem 4rem; }
.banner { max-width: 1024px; margin: 0 auto; }
.banner img { width: 100%; height: auto; display: block; }
@media (min-width: 1060px) { .banner img { border-radius: 0 0 14px 14px; } }
header.series {
  display: flex; gap: 1.25rem; align-items: center; margin: 2rem 0 1rem;
  flex-wrap: wrap;
}
header.series img.cover {
  width: 140px; height: 140px; border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
}
header.series h1 { margin: 0; font-size: 1.8rem; letter-spacing: -0.02em; }
header.series .subtitle { color: var(--muted); margin-top: 0.25rem; }
.subscribe { display: flex; gap: 0.6rem; flex-wrap: wrap; margin: 1.25rem 0; }
.subscribe a {
  display: inline-block; padding: 0.5rem 1rem; border-radius: 999px;
  background: var(--theme); color: #fff; text-decoration: none;
  font-weight: 600; font-size: 0.9rem;
}
.subscribe a.alt { background: transparent; color: var(--theme); border: 2px solid var(--theme); }
.desc { color: var(--muted); max-width: 40rem; }
ul.episodes { list-style: none; padding: 0; margin: 2rem 0 0; }
ul.episodes li {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 1rem 1.25rem; margin-bottom: 0.9rem;
}
ul.episodes .date { color: var(--muted); font-size: 0.85rem; }
ul.episodes h2 { margin: 0.15rem 0 0.35rem; font-size: 1.15rem; }
ul.episodes h2 a { color: var(--text); text-decoration: none; }
ul.episodes h2 a:hover { color: var(--theme); }
ul.episodes p { margin: 0; color: var(--muted); font-size: 0.95rem; }
article.episode h1 { font-size: 1.6rem; letter-spacing: -0.02em; margin: 1.5rem 0 0.25rem; }
article.episode .meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 1.25rem; }
article.episode .meta a { color: var(--muted); }
audio { width: 100%; margin: 0.5rem 0 1.5rem; border-radius: 8px; background: var(--player-bg); }
.notes { border-top: 1px solid var(--border); padding-top: 1.25rem; }
.notes p { margin: 0.7rem 0; }
.notes a { font-weight: 600; text-decoration: none; }
.notes a:hover { text-decoration: underline; }
details.transcript {
  margin-top: 2rem; background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 0.9rem 1.25rem;
}
details.transcript summary { cursor: pointer; font-weight: 700; }
details.transcript .cue { margin: 0.7rem 0; }
details.transcript .t {
  color: var(--muted); font-size: 0.8rem; font-variant-numeric: tabular-nums;
  display: block;
}
.share { margin-top: 1.5rem; color: var(--muted); font-size: 0.9rem; }
footer.site {
  margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid var(--border);
  color: var(--muted); font-size: 0.85rem;
}
.serieslist { list-style: none; padding: 0; display: grid; gap: 1rem; margin-top: 2rem; }
.serieslist li {
  background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 1.25rem; display: flex; gap: 1rem; align-items: center;
}
.serieslist img { width: 84px; height: 84px; border-radius: 10px; }
.serieslist h2 { margin: 0 0 0.25rem; font-size: 1.2rem; }
.serieslist p { margin: 0; color: var(--muted); font-size: 0.92rem; }
</style>
</head>
<body>
${o.body}
</body>
</html>
`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 1 ? "<1 min" : `${m} min`;
}

function subscribeButtons(series: SeriesConfig, site: SiteConfig): string {
  const buttons: string[] = [];
  const dirs = series.directories ?? {};
  if (dirs.apple) buttons.push(`<a href="${esc(dirs.apple)}">Apple Podcasts</a>`);
  if (dirs.spotify) buttons.push(`<a href="${esc(dirs.spotify)}">Spotify</a>`);
  if (dirs.amazon) buttons.push(`<a href="${esc(dirs.amazon)}">Amazon Music</a>`);
  buttons.push(`<a class="alt" href="${esc(feedUrl(site, series.id))}">RSS Feed</a>`);
  return `<div class="subscribe">${buttons.join("")}</div>`;
}

const FOOTER = `<footer class="site">Powered by <a href="https://github.com/pkraft/newsletter-podcasts">newsletter-podcasts</a>.</footer>`;

export function seriesPage(
  series: SeriesConfig,
  episodes: EpisodeMeta[],
  site: SiteConfig,
  opts: { hasBanner: boolean; hasIcon: boolean },
): string {
  const list = episodes
    .map(
      (e) => `  <li>
    <span class="date">${fmtDate(e.publishDate)} · ${fmtDuration(e.audio.durationSeconds)}</span>
    <h2><a href="episodes/${e.id}/">${esc(e.title)}</a></h2>
    <p>${esc(e.summary)}</p>
  </li>`,
    )
    .join("\n");
  const banner = opts.hasBanner
    ? `<div class="banner"><img src="artwork/banner.jpg" alt="${esc(series.title)}"></div>`
    : "";
  return layout({
    title: series.title,
    description: series.description,
    themeColor: series.themeColor ?? "#1a56db",
    faviconHref: opts.hasIcon ? "artwork/icon.png" : null,
    body: `${banner}
<div class="wrap">
  <header class="series">
    <img class="cover" src="artwork/cover-small.jpg" alt="${esc(series.title)} cover art">
    <div>
      <h1>${esc(series.title)}</h1>
      ${series.subtitle ? `<div class="subtitle">${esc(series.subtitle)}</div>` : ""}
    </div>
  </header>
  ${subscribeButtons(series, site)}
  <p class="desc">${esc(series.description)}</p>
  <ul class="episodes">
${list}
  </ul>
  ${FOOTER}
</div>`,
  });
}

export interface EpisodePageInput {
  series: SeriesConfig;
  episode: EpisodeMeta;
  site: SiteConfig;
  notesHtml: string | null;
  transcriptCues: { start: number; text: string }[] | null;
  transcriptPlain: string | null;
  hasIcon: boolean;
}

function fmtCueTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function episodePage(i: EpisodePageInput): string {
  const { series, episode: e, site } = i;
  const pageUrl = `${seriesUrl(site, series.id)}/episodes/${e.id}/`;
  const audio = enclosureUrl(episodeAudioUrl(site, series.id, e.id), site.op3);

  let transcriptBlock = "";
  if (i.transcriptCues) {
    const cues = i.transcriptCues
      .map(
        (c) =>
          `<div class="cue"><span class="t">${fmtCueTime(c.start)}</span>${esc(c.text)}</div>`,
      )
      .join("\n");
    transcriptBlock = `<details class="transcript"><summary>Transcript</summary>\n${cues}\n</details>`;
  } else if (i.transcriptPlain) {
    transcriptBlock = `<details class="transcript"><summary>Transcript</summary><div class="cue">${esc(
      i.transcriptPlain,
    )}</div></details>`;
  }

  return layout({
    title: `${e.title} — ${series.title}`,
    description: e.summary,
    themeColor: series.themeColor ?? "#1a56db",
    faviconHref: i.hasIcon ? "../../artwork/icon.png" : null,
    body: `<div class="wrap">
<article class="episode">
  <h1>${esc(e.title)}</h1>
  <div class="meta">
    ${fmtDate(e.publishDate)} · ${fmtDuration(e.audio.durationSeconds)} ·
    <a href="../../">${esc(series.title)}</a>
  </div>
  <audio controls preload="metadata" src="${esc(audio)}"></audio>
  <p>${esc(e.summary)}</p>
  ${i.notesHtml ? `<div class="notes">${i.notesHtml}</div>` : ""}
  ${transcriptBlock}
  <p class="share">Share: <a href="${esc(pageUrl)}">episode page</a> · <a href="${esc(
    feedUrl(site, series.id),
  )}">subscribe via RSS</a></p>
</article>
${FOOTER}
</div>`,
  });
}

export function indexPage(allSeries: SeriesConfig[], site: SiteConfig): string {
  const items = allSeries
    .map(
      (s) => `  <li>
    <img src="${s.id}/artwork/cover-small.jpg" alt="">
    <div>
      <h2><a href="${s.id}/">${esc(s.title)}</a></h2>
      <p>${esc(s.description)}</p>
      <p><a href="${s.id}/feed.xml">RSS feed</a></p>
    </div>
  </li>`,
    )
    .join("\n");
  return layout({
    title: site.siteTitle,
    description: `Podcasts published by ${site.siteTitle}`,
    themeColor: "#1a56db",
    faviconHref: null,
    body: `<div class="wrap">
  <h1>${esc(site.siteTitle)}</h1>
  <ul class="serieslist">
${items}
  </ul>
  ${FOOTER}
</div>`,
  });
}
