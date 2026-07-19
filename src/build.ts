import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  episodeDir,
  loadAllSeries,
  loadEpisodes,
  loadSiteConfig,
  seriesDir,
} from "./lib/content.js";
import { type EpisodeExtras, feedUrl, generateFeed } from "./lib/feed.js";
import { validateCoverArt } from "./lib/imageSize.js";
import { type ShowNotes, renderNotes } from "./lib/notes.js";
import { episodePage, indexPage, seriesPage } from "./lib/pages.js";
import {
  type Transcript,
  parseTranscript,
  toJson,
  toPlainText,
  toSrt,
  toVtt,
} from "./lib/transcript.js";
import type { EpisodeMeta, SeriesConfig, SiteConfig } from "./types.js";

const OUT = join(process.cwd(), "_site");
const run = promisify(execFile);

/** Downscale cover for page use; falls back to a copy when ffmpeg is unavailable
 *  (e.g. local dev without ffmpeg — CI installs it). */
async function makeSmallCover(src: string, dest: string): Promise<void> {
  try {
    await run("ffmpeg", ["-y", "-i", src, "-vf", "scale=500:500:flags=lanczos", "-q:v", "4", dest]);
  } catch {
    cpSync(src, dest);
  }
}

interface EpisodeAssets {
  notes: ShowNotes | null;
  transcript: Transcript | null;
}

function loadEpisodeAssets(seriesId: string, episodeId: string): EpisodeAssets {
  const dir = episodeDir(seriesId, episodeId);

  let notes: ShowNotes | null = null;
  for (const [file, kind] of [
    ["source.html", "html"],
    ["source.md", "md"],
    ["notes.md", "md"], // pre-M2 ingests stored raw source as notes.md
  ] as const) {
    const path = join(dir, file);
    if (existsSync(path)) {
      notes = renderNotes(readFileSync(path, "utf8"), kind);
      break;
    }
  }

  let transcript: Transcript | null = null;
  for (const ext of ["vtt", "srt", "txt"] as const) {
    const path = join(dir, `transcript.${ext}`);
    if (existsSync(path)) {
      transcript = parseTranscript(readFileSync(path, "utf8"), ext);
      break;
    }
  }

  return { notes, transcript };
}

async function buildSeries(
  series: SeriesConfig,
  episodes: EpisodeMeta[],
  site: SiteConfig,
): Promise<void> {
  const outDir = join(OUT, series.id);
  mkdirSync(join(outDir, "artwork"), { recursive: true });

  // Artwork: validate the master, publish only the derived/known files.
  const artDir = join(seriesDir(series.id), "artwork");
  const coverSrc = join(artDir, "cover.jpg");
  if (!existsSync(coverSrc)) {
    throw new Error(`Series "${series.id}" has no artwork/cover.jpg`);
  }
  validateCoverArt(coverSrc);
  cpSync(coverSrc, join(outDir, "artwork", "cover.jpg"));
  await makeSmallCover(coverSrc, join(outDir, "artwork", "cover-small.jpg"));
  const hasBanner = existsSync(join(artDir, "banner.jpg"));
  if (hasBanner) cpSync(join(artDir, "banner.jpg"), join(outDir, "artwork", "banner.jpg"));
  const hasIcon = existsSync(join(artDir, "icon.png"));
  if (hasIcon) cpSync(join(artDir, "icon.png"), join(outDir, "artwork", "icon.png"));

  const published = episodes.filter((e) => e.status === "published");
  const extras: Record<string, EpisodeExtras> = {};

  for (const e of published) {
    const epOut = join(outDir, "episodes", e.id);
    mkdirSync(epOut, { recursive: true });
    cpSync(join(episodeDir(series.id, e.id), "audio.mp3"), join(epOut, "audio.mp3"));

    const assets = loadEpisodeAssets(series.id, e.id);
    const extra: EpisodeExtras = {};

    if (assets.transcript) {
      const t = assets.transcript;
      extra.transcripts = {};
      if (!t.untimed) {
        writeFileSync(join(epOut, "transcript.vtt"), toVtt(t));
        writeFileSync(join(epOut, "transcript.srt"), toSrt(t));
        writeFileSync(join(epOut, "transcript.json"), toJson(t));
        extra.transcripts = { vtt: true, srt: true, json: true };
      }
      writeFileSync(join(epOut, "transcript.txt"), toPlainText(t));
      extra.transcripts.txt = true;
    }
    if (assets.notes) {
      extra.rssHtml = assets.notes.rssHtml;
    }
    extras[e.id] = extra;

    writeFileSync(
      join(epOut, "index.html"),
      episodePage({
        series,
        episode: e,
        site,
        notesHtml: assets.notes?.pageHtml ?? null,
        transcriptCues:
          assets.transcript && !assets.transcript.untimed ? assets.transcript.cues : null,
        transcriptPlain:
          assets.transcript?.untimed === true ? toPlainText(assets.transcript).trim() : null,
        hasIcon,
      }),
    );
  }

  writeFileSync(join(outDir, "feed.xml"), generateFeed(series, episodes, site, extras));
  writeFileSync(
    join(outDir, "index.html"),
    seriesPage(series, published, site, { hasBanner, hasIcon }),
  );
}

async function main(): Promise<void> {
  const site = loadSiteConfig();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, ".nojekyll"), "");
  writeFileSync(join(OUT, "CNAME"), `${new URL(site.baseUrl).hostname}\n`);

  const allSeries = loadAllSeries();
  const counts: string[] = [];
  for (const series of allSeries) {
    const episodes = loadEpisodes(series.id);
    await buildSeries(series, episodes, site);
    counts.push(
      `${series.id}: ${episodes.filter((e) => e.status === "published").length} published`,
    );
  }

  writeFileSync(
    join(OUT, "index.html"),
    indexPage(
      allSeries.filter((s) => s.status === "active"),
      site,
    ),
  );

  console.log(
    `Built ${allSeries.length} series (${counts.join(", ")}) → _site/  feeds: ${allSeries
      .map((s) => feedUrl(site, s.id))
      .join(" ")}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
