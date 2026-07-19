# PRD — Newsletter Podcast Publishing Service

**Status:** Draft for review
**Owner:** pkraft
**Date:** 2026-07-19
**Working name:** `newsletter-podcasts`

---

## 1. Overview

A service that turns newsletter issues into professionally packaged podcast episodes. An
upstream newsletter system already produces the raw materials for each issue: source text,
a TTS-generated audio file, and a transcript. This service accepts those materials via an
API call, combines them with designer-managed podcast series configuration, generates all
required podcast artifacts (RSS feed, episode pages, tagged audio, transcripts in standard
formats), publishes them, and makes the result available to podcast directories (Apple
Podcasts, Spotify, etc.).

The whole system is hosted on GitHub — GitHub Pages for the public site/feed, GitHub
Actions for processing, and the GitHub REST API as the ingestion endpoint. There is no
server to run or pay for.

## 2. Goals

1. **API-driven episode publishing.** The newsletter system calls one API with episode
   data and a series ID; everything downstream is automatic.
2. **Multi-series from day one.** The first newsletter is one series; new topics become
   new series without code changes — just new series configuration created in the UI.
3. **Professional output.** Feeds validate against Apple/Spotify requirements, episodes
   have proper ID3 tags and artwork, episode pages look polished, and transcripts are
   published in standard formats (`podcast:transcript` tag).
4. **Designer/admin control via UI.** Create and brand series, publish/unpublish
   episodes, adjust settings, and monitor downloads — without touching git.
5. **Directory distribution.** Feeds are accepted by Apple Podcasts, Spotify, Amazon
   Music, and the Podcast Index (which feeds most smaller apps).
6. **Zero-cost hosting** appropriate for the current scale (2–3 consumers, low episode
   volume).

## 3. Non-goals (for now)

- Generating audio or transcripts (the newsletter system owns TTS and transcription).
- Dynamic ad insertion, paid subscriptions, or private feeds.
- High-scale hosting. GitHub Pages soft limits (~100 GB/month bandwidth, ~1 GB site
  size) are accepted; a migration path is documented in §10.
- Real-time analytics. Download stats come from a measurement prefix (see §7.7) and are
  directional, not IAB-certified.

## 4. Users

| User | Needs |
|---|---|
| **Newsletter system** (machine) | A stable, authenticated API to submit episode data and get it published reliably. |
| **Designer / app owner** (admin) | UI to create series, brand them, publish/unpublish episodes, change settings, see downloads. |
| **Listeners** | Find the show in their podcast app; a clean episode web page with show notes and transcript. |

## 5. Architecture

```
┌──────────────────┐   repository_dispatch    ┌─────────────────────────────┐
│ Newsletter system │ ───────────────────────▶ │ GitHub Actions (pipeline)   │
│  (2–3 consumers)  │   POST /repos/../dispatches │  ingest → validate → fetch │
└──────────────────┘   + fine-grained PAT     │  assets → process → build   │
                                              │  site → commit → deploy     │
┌──────────────────┐   GitHub REST API        └──────────────┬──────────────┘
│ Admin UI (SPA on  │ ◀──────────────────────────────────────┘ commits to repo
│ Pages, /admin)    │   reads/writes content, triggers workflows
└──────────────────┘
                                              ┌─────────────────────────────┐
┌──────────────────┐   HTTPS (RSS + MP3 +     │ GitHub Pages (static site)  │
│ Podcast apps &    │ ◀── episode pages) ───── │  /{series}/feed.xml         │
│ directories       │   via OP3 prefix for MP3 │  /{series}/episodes/...     │
└──────────────────┘                          │  /admin (SPA)               │
                                              └─────────────────────────────┘
```

**Key design decisions**

- **Ingestion API = `repository_dispatch`.** GitHub's REST API is the API surface.
  Consumers authenticate with a fine-grained PAT scoped to this repo. No custom server.
- **Assets by URL, not payload.** The dispatch payload carries metadata plus **URLs** for
  the audio file and (optionally) transcript/source text. The pipeline downloads them.
  This avoids the ~64 KB dispatch payload limit; short text fields may also be inlined.
- **Content lives in the repo as files.** Each series and episode is a JSON file plus
  assets. Git history is the audit log; publish/unpublish is a data change + rebuild.
- **Site built by a generator script** (Node 22 + TypeScript) that renders the RSS feed
  and episode/series pages from content files. Deployed with `actions/deploy-pages`
  (no `gh-pages` branch).
- **Admin UI is a static SPA** served from the same Pages site at `/admin`. It talks
  directly to the GitHub REST API using a PAT the admin pastes at login (kept in
  `sessionStorage`, never committed). Edits become commits; the pipeline rebuilds.
- **Download stats via OP3** (op3.dev), a free open-source measurement service: enclosure
  URLs in the feed are prefixed (`https://op3.dev/e/<audio-url>`), OP3 logs the request
  and 302-redirects to the real file. The admin UI charts stats from the OP3 API.

## 6. Data model (repo layout)

```
content/
  series/
    {series-id}/
      series.json          # title, description, author, category, language,
                           # explicit flag, artwork ref, owner email, site links
      artwork/cover.jpg    # 3000×3000 master; generator derives sizes
      episodes/
        {episode-id}/
          episode.json     # title, summary, pubDate, duration, status
                           # (published|unpublished), external_id, guid,
                           # season/episode numbers
          audio.mp3        # processed audio (tagged, artwork embedded)
          transcript.vtt   # + transcript.srt, transcript.json
          notes.md         # show notes derived from source text
site/                      # generator + templates + admin SPA source
.github/workflows/         # ingest.yml, build-deploy.yml
docs/                      # consumer API guide, runbooks
```

- **`guid`** is generated once at ingest and never changes (podcast apps key on it).
- **`external_id`** (e.g., newsletter issue ID) makes ingestion idempotent: re-submitting
  the same `external_id` for a series updates the episode instead of duplicating it.

## 7. Functional requirements

### 7.1 Series management (admin UI)
- Create/edit series: title, subtitle, description, author, owner email, language,
  Apple category/subcategory, explicit flag, artwork upload (validated: square,
  1400–3000 px, JPG/PNG), theme color, links.
- Each series gets its own feed at `/{series-id}/feed.xml` and landing page.
- Series can be marked `active` / `archived` (archived: feed stays up, no new episodes).

### 7.2 Ingestion API (consumer contract)

`POST https://api.github.com/repos/{owner}/newsletter-podcasts/dispatches`
Headers: `Authorization: Bearer <PAT>`, `Accept: application/vnd.github+json`

```json
{
  "event_type": "publish-episode",
  "client_payload": {
    "series_id": "my-newsletter",
    "external_id": "issue-2026-07-19",
    "title": "Issue 42: The one about databases",
    "summary": "Short episode description for players.",
    "publish_date": "2026-07-19T12:00:00Z",
    "audio_url": "https://newsletter.example.com/issues/42/audio.mp3",
    "transcript_url": "https://newsletter.example.com/issues/42/transcript.vtt",
    "source_text_url": "https://newsletter.example.com/issues/42/body.md",
    "auto_publish": true
  }
}
```

- Unknown `series_id` → pipeline fails with a clear error (see 7.6).
- `auto_publish: false` ingests the episode as a draft for the admin to publish manually.
- Asset URLs must be publicly reachable at ingest time only (files are copied into the
  repo; the source can expire afterward).

### 7.3 Processing pipeline (GitHub Actions)
1. **Validate** payload against a JSON Schema; resolve series config.
2. **Fetch** audio, transcript, source text.
3. **Process audio:** verify MP3 integrity; write ID3v2 tags (title, artist=author,
   album=series, year, artwork); compute duration and byte size for the feed.
4. **Transcripts:** accept VTT/SRT/plain; convert to VTT + SRT + JSON.
5. **Show notes:** convert source text (Markdown/HTML) into sanitized episode-page HTML
   and a plain-text/limited-HTML version for the RSS `description`/`content:encoded`.
6. **Persist** episode files, **rebuild** feeds + site, **commit**, **deploy** Pages.
7. Pipeline is idempotent per (`series_id`, `external_id`) and safe under concurrent
   dispatches (queued via Actions concurrency group).

### 7.4 Feed generation
- RSS 2.0 with `itunes:` and `podcast:` (podcasting 2.0) namespaces.
- Includes: channel artwork, categories, explicit, language, `itunes:owner`,
  per-episode enclosure (OP3-prefixed URL, length, type), `guid` (isPermaLink=false),
  duration, episode/season numbers, `podcast:transcript` links, `podcast:guid`.
- Must pass Apple Podcasts validation and podba.se/Cast Feed Validator cleanly.
- Only `status: published` episodes appear in feeds and site listings.

### 7.5 Public site
- Per-series landing page: artwork, description, subscribe links (Apple/Spotify/RSS),
  episode list.
- Per-episode page: audio player, show notes, transcript, publish date, share links.
- Clean responsive design, series theme color, light/dark support. No JS frameworks
  needed on the public pages.

### 7.6 Admin operations
- **Publish/unpublish** any episode (toggle → rebuild; unpublished episodes drop out of
  the feed; apps that cached them may retain copies — documented behavior).
- **Edit** episode metadata (title, summary, notes) post-ingest.
- **Delete** an episode entirely (with confirmation).
- **Monitor pipeline:** recent workflow runs with status surfaced in the UI; failures
  also raise a GitHub issue on the repo labeled `pipeline-failure` (email notification
  comes free via GitHub notifications).
- **Settings:** site title, base URL/custom domain, OP3 on/off, defaults for new series.

### 7.7 Analytics
- OP3 prefix on all enclosure URLs; admin UI shows downloads per episode/series over
  time via the OP3 API (free tier, public stats).
- Noted limitation: stats begin only once the prefix is live; not IAB-certified.

### 7.8 Distribution
- One-time per series (manual, but guided): submit feed URL to Apple Podcasts Connect,
  Spotify for Creators, Amazon Music, and Podcast Index. Most other apps sync from
  Apple/Podcast Index.
- Admin UI shows a per-series distribution checklist where the admin records the
  directory URLs once accepted; those become the subscribe buttons on the landing page.

## 8. Security & auth

- **Consumers:** fine-grained PAT with only `contents:read/write` (or metadata +
  actions) on this single repo. One PAT per consumer so they can be revoked
  independently. Rotation documented.
- **Admin UI:** admin's own PAT pasted at login, held in `sessionStorage` only.
- Repo is **public** (required for free Pages) — content is public anyway (it's a
  podcast), but PATs/secrets never live in the repo. Sanitize all HTML from source text.

## 9. Constraints & limits (accepted)

- GitHub Pages: ~1 GB site, ~100 GB/month bandwidth soft limits, 100 MB max file size.
  At ~20 MB/episode weekly per series, roughly a year of headroom per GB.
- `repository_dispatch` payload ≤ ~64 KB → assets by URL (§7.2).
- Pages deploys take ~1–2 min; publishing is near-real-time, not instant.
- No server-side redirects on Pages: unpublished episode pages return 404 after rebuild.

## 10. Risks & future migration

| Risk | Mitigation |
|---|---|
| Repo/site outgrows Pages limits | Move audio to GitHub Releases assets (2 GB/file, doesn't count against Pages size) or object storage (R2/S3); only enclosure URLs change, feed URL stays stable. |
| Feed URL changes later break subscribers | Prefer a custom domain from day one; RSS supports `itunes:new-feed-url` as escape hatch. |
| OP3 unavailability | Prefix failure = redirect failure; OP3 has strong uptime, and the setting can be toggled off (stats gap, no outage for new fetches after rebuild). |
| GitHub Actions outage delays publishing | Acceptable at this scale; dispatches can be re-sent. |

## 11. Milestones

- **M1 — Core pipeline (walking skeleton):** repo scaffold, series config (hand-edited),
  ingest workflow, audio processing, feed generation, Pages deploy. Exit: a real test
  episode plays in a podcast app via the feed URL, feed passes validators.
- **M2 — Professional packaging:** episode/series pages, transcripts (VTT/SRT +
  `podcast:transcript`), show-notes rendering, artwork pipeline, polish.
- **M3 — Admin UI:** login, series CRUD, episode publish/unpublish/edit/delete,
  pipeline status, settings.
- **M4 — Analytics & distribution:** OP3 integration + charts, distribution checklist,
  consumer API documentation, PAT setup guide.
- **M5 — Hardening:** idempotency/concurrency tests, failure alerting, validation
  edge cases, runbooks, end-to-end test with the real newsletter system.

## 12. Decisions (resolved 2026-07-19)

1. **Custom domain: `podcasts.petekraft.com`.** All public assets (feeds,
   audio, episode pages, admin UI) are served from this domain from day one, before
   the first directory submission. DNS: CNAME to the GitHub Pages host.
   *(Renamed from `podcast-ai-news.petekraft.com` on 2026-07-19, pre-directory-
   submission, to be series-neutral — the site hosts multiple series.)*
2. **Analytics: OP3 confirmed.** Enclosure URLs use the op3.dev prefix
   (`https://op3.dev/e/podcasts.petekraft.com/...`); OP3 needs no domain of
   its own. Stats are public and directional.
3. **Repo visibility: public.** Free Pages tier; no secrets in the repo.
4. **Asset delivery: public URLs.** The newsletter system exposes audio/transcript/
   source text at fetchable URLs at publish time; the pipeline copies them into the repo.
