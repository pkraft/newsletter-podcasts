import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { episodeDir, loadAllSeries, loadEpisodes, seriesDir } from "./lib/content.js";
import { feedUrl, generateFeed } from "./lib/feed.js";
import { loadSiteConfig } from "./lib/content.js";
import { esc } from "./lib/xml.js";
import type { EpisodeMeta, SeriesConfig, SiteConfig } from "./types.js";

const OUT = join(process.cwd(), "_site");

/** Minimal M1 pages — replaced with designed templates in M2. */
function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  a { color: #1a56db; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function buildSeries(series: SeriesConfig, episodes: EpisodeMeta[], site: SiteConfig): void {
  const outDir = join(OUT, series.id);
  mkdirSync(outDir, { recursive: true });

  const published = episodes.filter((e) => e.status === "published");
  writeFileSync(join(outDir, "feed.xml"), generateFeed(series, episodes, site));

  const artworkSrc = join(seriesDir(series.id), "artwork");
  if (existsSync(artworkSrc)) {
    cpSync(artworkSrc, join(outDir, "artwork"), { recursive: true });
  }

  const list = published
    .map(
      (e) =>
        `<li><a href="episodes/${e.id}/">${esc(e.title)}</a> — ${new Date(e.publishDate).toDateString()}</li>`,
    )
    .join("\n");
  writeFileSync(
    join(outDir, "index.html"),
    page(
      series.title,
      `<h1>${esc(series.title)}</h1>
<p>${esc(series.description)}</p>
<p><a href="feed.xml">RSS feed</a></p>
<ul>${list}</ul>`,
    ),
  );

  for (const e of published) {
    const epOut = join(outDir, "episodes", e.id);
    mkdirSync(epOut, { recursive: true });
    cpSync(join(episodeDir(series.id, e.id), "audio.mp3"), join(epOut, "audio.mp3"));
    writeFileSync(
      join(epOut, "index.html"),
      page(
        `${e.title} — ${series.title}`,
        `<h1>${esc(e.title)}</h1>
<p>${new Date(e.publishDate).toDateString()} · ${esc(series.title)}</p>
<audio controls preload="none" src="audio.mp3"></audio>
<p>${esc(e.summary)}</p>
<p><a href="../../">← ${esc(series.title)}</a></p>`,
      ),
    );
  }
}

function main(): void {
  const site = loadSiteConfig();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, ".nojekyll"), "");
  writeFileSync(join(OUT, "CNAME"), `${new URL(site.baseUrl).hostname}\n`);

  const allSeries = loadAllSeries();
  for (const series of allSeries) {
    buildSeries(series, loadEpisodes(series.id), site);
  }

  const active = allSeries.filter((s) => s.status === "active");
  writeFileSync(
    join(OUT, "index.html"),
    page(
      site.siteTitle,
      `<h1>${esc(site.siteTitle)}</h1>
<ul>${active
        .map((s) => `<li><a href="${s.id}/">${esc(s.title)}</a> — <a href="${s.id}/feed.xml">RSS</a></li>`)
        .join("\n")}</ul>`,
    ),
  );

  console.log(
    `Built ${allSeries.length} series (${allSeries
      .map((s) => `${s.id}: ${loadEpisodes(s.id).filter((e) => e.status === "published").length} published`)
      .join(", ")}) → _site/  feeds: ${allSeries.map((s) => feedUrl(site, s.id)).join(" ")}`,
  );
}

main();
