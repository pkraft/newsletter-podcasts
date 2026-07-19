import assert from "node:assert/strict";
import { test } from "node:test";
import { enclosureUrl, generateFeed } from "../src/lib/feed.js";
import { episodeGuid } from "../src/lib/uuid.js";
import type { EpisodeMeta, SeriesConfig, SiteConfig } from "../src/types.js";

const site: SiteConfig = {
  baseUrl: "https://podcast-ai-news.petekraft.com",
  op3: true,
  siteTitle: "Test",
};

const series: SeriesConfig = {
  id: "ai-news",
  title: "AI News & Views <Weekly>",
  description: "Test series",
  author: "Pete Kraft",
  ownerName: "Pete Kraft",
  ownerEmail: "pkraft@gmail.com",
  language: "en-us",
  category: "Technology",
  explicit: false,
  status: "active",
};

function episode(overrides: Partial<EpisodeMeta>): EpisodeMeta {
  return {
    id: "issue-1",
    guid: "11111111-2222-5333-8444-555555555555",
    externalId: "issue-1",
    title: "Episode one",
    summary: "Summary",
    publishDate: "2026-07-19T12:00:00Z",
    status: "published",
    audio: { file: "audio.mp3", bytes: 1234567, durationSeconds: 601.4, mimeType: "audio/mpeg" },
    ingestedAt: "2026-07-19T12:05:00Z",
    updatedAt: "2026-07-19T12:05:00Z",
    ...overrides,
  };
}

test("feed contains required channel elements", () => {
  const xml = generateFeed(series, [episode({})], site);
  for (const fragment of [
    '<rss version="2.0"',
    "xmlns:itunes=",
    "xmlns:podcast=",
    "<title>AI News &amp; Views &lt;Weekly&gt;</title>",
    "<language>en-us</language>",
    '<itunes:category text="Technology"/>',
    "<itunes:email>pkraft@gmail.com</itunes:email>",
    '<atom:link href="https://podcast-ai-news.petekraft.com/ai-news/feed.xml" rel="self"',
    '<itunes:image href="https://podcast-ai-news.petekraft.com/ai-news/artwork/cover.jpg"/>',
    "<podcast:guid>",
  ]) {
    assert.ok(xml.includes(fragment), `feed missing: ${fragment}`);
  }
});

test("items carry enclosure with OP3 prefix, guid, duration", () => {
  const xml = generateFeed(series, [episode({})], site);
  assert.ok(
    xml.includes(
      'url="https://op3.dev/e/podcast-ai-news.petekraft.com/ai-news/episodes/issue-1/audio.mp3"',
    ),
  );
  assert.ok(xml.includes('length="1234567"'));
  assert.ok(xml.includes('<guid isPermaLink="false">11111111-2222-5333-8444-555555555555</guid>'));
  assert.ok(xml.includes("<itunes:duration>601</itunes:duration>"));
  assert.ok(xml.includes("<pubDate>Sun, 19 Jul 2026 12:00:00 GMT</pubDate>"));
});

test("unpublished episodes are excluded", () => {
  const xml = generateFeed(
    series,
    [episode({}), episode({ id: "issue-2", title: "Hidden", status: "unpublished" })],
    site,
  );
  assert.ok(!xml.includes("Hidden"));
});

test("episodes sort newest first", () => {
  const xml = generateFeed(
    series,
    [
      episode({ id: "old", title: "Old", publishDate: "2026-01-01T00:00:00Z" }),
      episode({ id: "new", title: "New", publishDate: "2026-07-01T00:00:00Z" }),
    ],
    site,
  );
  assert.ok(xml.indexOf("New") < xml.indexOf("Old"));
});

test("OP3 prefix can be disabled", () => {
  assert.equal(
    enclosureUrl("https://example.com/a.mp3", false),
    "https://example.com/a.mp3",
  );
  assert.equal(
    enclosureUrl("https://example.com/a.mp3", true),
    "https://op3.dev/e/example.com/a.mp3",
  );
});

test("episode guid is stable and versioned", () => {
  const a = episodeGuid("ai-news", "issue-42");
  const b = episodeGuid("ai-news", "issue-42");
  const c = episodeGuid("ai-news", "issue-43");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
