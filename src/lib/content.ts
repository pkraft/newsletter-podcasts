import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EpisodeMeta, SeriesConfig, SiteConfig } from "../types.js";
import { assertValid, validateEpisode, validateSeries } from "./validate.js";

export const CONTENT_DIR = join(process.cwd(), "content", "series");

export function loadSiteConfig(): SiteConfig {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "site.config.json"), "utf8"));
  if (typeof raw.baseUrl !== "string" || raw.baseUrl.endsWith("/")) {
    throw new Error("site.config.json: baseUrl must be a string without a trailing slash");
  }
  return raw as SiteConfig;
}

export function seriesDir(seriesId: string): string {
  return join(CONTENT_DIR, seriesId);
}

export function episodeDir(seriesId: string, episodeId: string): string {
  return join(seriesDir(seriesId), "episodes", episodeId);
}

export function loadSeries(seriesId: string): SeriesConfig {
  const file = join(seriesDir(seriesId), "series.json");
  if (!existsSync(file)) {
    throw new Error(
      `Unknown series_id "${seriesId}" — series must be created by the admin before episodes can be ingested.`,
    );
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  assertValid(validateSeries, data, `series.json for "${seriesId}"`);
  const series = data as SeriesConfig;
  if (series.id !== seriesId) {
    throw new Error(`series.json id "${series.id}" does not match directory "${seriesId}"`);
  }
  return series;
}

export function loadAllSeries(): SeriesConfig[] {
  if (!existsSync(CONTENT_DIR)) return [];
  return readdirSync(CONTENT_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadSeries(d.name));
}

export function loadEpisodes(seriesId: string): EpisodeMeta[] {
  const dir = join(seriesDir(seriesId), "episodes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const data = JSON.parse(readFileSync(join(dir, d.name, "episode.json"), "utf8"));
      assertValid(validateEpisode, data, `episode.json for "${seriesId}/${d.name}"`);
      return data as EpisodeMeta;
    })
    .sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1));
}
