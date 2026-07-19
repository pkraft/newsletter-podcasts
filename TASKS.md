# Task Plan — Newsletter Podcast Publishing Service

Derived from [PRD.md](PRD.md). Tasks are ordered; each milestone ends in a working,
demonstrable state.

## M1 — Core pipeline (walking skeleton)

- [x] **1.1 Repo scaffold**: init git repo, Node 22 + TypeScript project, lint/format,
      directory layout per PRD §6, README.
- [x] **1.2 Series config schema**: JSON Schema for `series.json`; create the first
      series by hand with real branding values.
- [x] **1.3 Episode schema**: JSON Schema for `episode.json` (incl. `guid`,
      `external_id`, `status`).
- [x] **1.4 Ingest workflow** (`ingest.yml`): triggered by `repository_dispatch`
      (`publish-episode`); validates payload against schema; concurrency group per
      series; clear failure messages.
- [x] **1.5 Asset fetcher**: download audio/transcript/source text from payload URLs
      with size/type checks and retries.
- [x] **1.6 Audio processor**: verify MP3, write ID3v2 tags + embedded artwork, compute
      duration/bytes (ffprobe + node ID3 lib). Probe encoding: if VBR or off-spec
      (sample rate ≠ 44.1 kHz, extreme bitrate), re-encode to CBR 128 kbps / 44.1 kHz;
      otherwise pass through untouched (no generation loss on good files).
- [x] **1.7 Feed generator**: RSS 2.0 + `itunes:`/`podcast:` namespaces from content
      files; only `published` episodes; unit tests against known-good fixture.
- [x] **1.8 Build & deploy workflow**: generator builds `_site/`, deploy with
      `actions/deploy-pages`; ingest commits content then triggers build.
- [x] **1.9 Idempotency**: re-dispatch with same (`series_id`, `external_id`) updates
      in place; new `external_id` creates new episode with fresh permanent `guid`.
- [x] **1.10 Milestone check**: dispatch a real test episode end-to-end; feed passes
      podba.se / Cast Feed Validator; episode plays in a podcast app via feed URL.
      *Done 2026-07-19: e2e dispatch + idempotent re-dispatch verified; W3C feed
      validator passes; custom domain live (feed 200, audio 200, byte-range 206,
      OP3 chain 200); owner confirmed playback in a podcast app. **M1 complete.***

## M2 — Professional packaging

- [ ] **2.1 Transcript converter**: accept VTT/SRT/plain text → emit VTT + SRT + JSON;
      `podcast:transcript` tags in feed.
- [ ] **2.2 Show-notes renderer**: Markdown/HTML source text → sanitized episode-page
      HTML + limited-HTML `content:encoded` for RSS.
- [ ] **2.3 Artwork pipeline**: validate uploads (square, 1400–3000 px), derive sizes,
      embed in MP3, reference in feed/pages.
- [ ] **2.4 Series landing page**: artwork, description, subscribe buttons, episode
      list; responsive, theme color, light/dark.
- [ ] **2.5 Episode page**: audio player, show notes, collapsible transcript, share
      links, metadata.
- [ ] **2.6 Site index**: root page listing all active series.
- [ ] **2.7 Milestone check**: visual review of pages; feed re-validates; Lighthouse
      pass on public pages.

## M3 — Admin UI (SPA at /admin)

- [ ] **3.1 SPA scaffold** (Vite + React + TS) served from Pages at `/admin`; PAT login
      → `sessionStorage`; GitHub API client with error handling.
- [ ] **3.2 Dashboard**: series list, recent episodes, latest pipeline runs w/ status.
- [ ] **3.3 Series CRUD**: create/edit forms with validation, artwork upload (base64
      commit via API), archive toggle.
- [ ] **3.4 Episode management**: list w/ status; publish/unpublish toggle; edit
      title/summary/notes; delete with confirmation. Each action = commit + rebuild
      trigger, with progress feedback until deploy completes.
- [ ] **3.5 Settings page**: base URL/custom domain, OP3 toggle, series defaults.
- [ ] **3.6 Milestone check**: full admin walkthrough — create series, ingest via API,
      unpublish, republish, edit — without touching git directly.

## M4 — Analytics & distribution

- [ ] **4.1 OP3 integration**: enclosure URL prefixing in feed generator (toggleable);
      verify redirects and byte-range behavior.
- [ ] **4.2 Analytics view**: downloads per episode/series over time from OP3 API in
      the admin UI.
- [ ] **4.3 Distribution checklist**: per-series checklist UI (Apple, Spotify, Amazon,
      Podcast Index) storing accepted directory URLs → subscribe buttons.
- [ ] **4.4 Consumer docs**: API guide with payload reference, PAT creation/rotation
      steps, error handling, example scripts (curl + Node). The installable
      **`skills/podcast-publisher/`** agent skill (SKILL.md + payload schema +
      examples) already covers the contract — keep it as the single source of truth
      and verify it matches the implemented pipeline (schema, timings, error labels).
- [ ] **4.5 Milestone check**: submit first series to directories; stats appear in UI.

## M5 — Hardening

- [ ] **5.1 Failure alerting**: pipeline failure → GitHub issue labeled
      `pipeline-failure` with payload summary and remediation hints.
- [ ] **5.2 Edge-case tests**: oversized/corrupt audio, bad URLs, duplicate dispatches,
      concurrent dispatches to same series, malformed transcripts, HTML injection in
      source text.
- [ ] **5.3 Runbooks**: PAT rotation, unpublish-and-scrub, Pages limit monitoring,
      migration path for audio storage (Releases/R2).
- [ ] **5.4 End-to-end with real newsletter system**: wire up the first real consumer;
      publish a production episode.

## Decisions (resolved — see PRD §12)

1. ✅ Custom domain from day one: **`podcast-ai-news.petekraft.com`**.
2. ✅ OP3 for analytics.
3. ✅ Public repo (free Pages).
4. ✅ Asset delivery by public URL.

Added by decision 1:

- [x] **1.0 Custom domain setup**: `podcast-ai-news.petekraft.com` — DNS CNAME to the
      GitHub Pages host, custom-domain config in repo, enforce HTTPS. (OP3 needs no
      separate domain — it prefixes URLs on op3.dev.)
      *Done 2026-07-19. Setup note: the record is **proxied through Cloudflare**
      (orange cloud) — TLS terminates at Cloudflare's edge and HTTP→HTTPS is
      enforced there, so GitHub's own "Enforce HTTPS" stays off (its cert can't
      provision behind the proxy; that's expected). Cloudflare bot protection
      blocks generic agents like Python-urllib (including the W3C validator) but
      passes Apple/Spotify/podcast-app fetchers — if a directory submission fails
      oddly, check Cloudflare WAF/bot rules first or add a skip rule for this
      subdomain.*
