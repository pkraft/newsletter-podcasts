import type { EpisodeMeta, SeriesConfig, SiteConfig } from "../types.js";
import { podcastGuid } from "./uuid.js";
import { esc } from "./xml.js";

function rfc2822(iso: string): string {
  return new Date(iso).toUTCString();
}

/** OP3 measurement prefix: scheme is dropped from the wrapped URL per OP3 convention. */
export function enclosureUrl(audioUrl: string, op3: boolean): string {
  if (!op3) return audioUrl;
  return `https://op3.dev/e/${audioUrl.replace(/^https?:\/\//, "")}`;
}

export function seriesUrl(site: SiteConfig, seriesId: string): string {
  return `${site.baseUrl}/${seriesId}`;
}

export function feedUrl(site: SiteConfig, seriesId: string): string {
  return `${seriesUrl(site, seriesId)}/feed.xml`;
}

export function episodeAudioUrl(site: SiteConfig, seriesId: string, episodeId: string): string {
  return `${seriesUrl(site, seriesId)}/episodes/${episodeId}/audio.mp3`;
}

export function generateFeed(
  series: SeriesConfig,
  episodes: EpisodeMeta[],
  site: SiteConfig,
): string {
  const link = series.link ?? seriesUrl(site, series.id);
  const self = feedUrl(site, series.id);
  const artwork = `${seriesUrl(site, series.id)}/artwork/cover.jpg`;
  const published = episodes
    .filter((e) => e.status === "published")
    .sort((a, b) => (a.publishDate < b.publishDate ? 1 : -1));

  const category = series.subcategory
    ? `<itunes:category text="${esc(series.category)}"><itunes:category text="${esc(series.subcategory)}"/></itunes:category>`
    : `<itunes:category text="${esc(series.category)}"/>`;

  const items = published
    .map((e) => {
      const pageUrl = `${seriesUrl(site, series.id)}/episodes/${e.id}/`;
      const audio = episodeAudioUrl(site, series.id, e.id);
      const numbering = [
        e.season !== undefined ? `<itunes:season>${e.season}</itunes:season>` : "",
        e.episodeNumber !== undefined
          ? `<itunes:episode>${e.episodeNumber}</itunes:episode>`
          : "",
      ]
        .filter(Boolean)
        .join("\n      ");
      return `    <item>
      <title>${esc(e.title)}</title>
      <guid isPermaLink="false">${esc(e.guid)}</guid>
      <link>${esc(pageUrl)}</link>
      <pubDate>${rfc2822(e.publishDate)}</pubDate>
      <description>${esc(e.summary)}</description>
      <enclosure url="${esc(enclosureUrl(audio, site.op3))}" length="${e.audio.bytes}" type="audio/mpeg"/>
      <itunes:duration>${Math.round(e.audio.durationSeconds)}</itunes:duration>
      <itunes:explicit>${series.explicit}</itunes:explicit>${numbering ? `\n      ${numbering}` : ""}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:podcast="https://podcastindex.org/namespace/1.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(series.title)}</title>
    <link>${esc(link)}</link>
    <description>${esc(series.description)}</description>
    <language>${esc(series.language)}</language>
    <atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>
    <generator>newsletter-podcasts</generator>
    <lastBuildDate>${published[0] ? rfc2822(published[0].publishDate) : rfc2822(new Date(0).toISOString())}</lastBuildDate>
    <podcast:guid>${podcastGuid(self)}</podcast:guid>
    <itunes:type>episodic</itunes:type>
    <itunes:author>${esc(series.author)}</itunes:author>
    <itunes:owner>
      <itunes:name>${esc(series.ownerName)}</itunes:name>
      <itunes:email>${esc(series.ownerEmail)}</itunes:email>
    </itunes:owner>
    <itunes:explicit>${series.explicit}</itunes:explicit>
    ${category}
    <itunes:image href="${esc(artwork)}"/>
    <image>
      <url>${esc(artwork)}</url>
      <title>${esc(series.title)}</title>
      <link>${esc(link)}</link>
    </image>
${items}
  </channel>
</rss>
`;
}
