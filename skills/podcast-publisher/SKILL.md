---
name: podcast-publisher
description: How to publish a newsletter issue as a podcast episode via the newsletter-podcasts publishing service. Use when writing, reviewing, or debugging code that submits episodes (audio + transcript + source text) to the podcast publishing API, or when a task mentions publishing an episode, submitting to the podcast service, or the publish-episode dispatch.
---

# Podcast Publisher — API integration guide

This skill teaches you to correctly call the newsletter-podcasts publishing service.
The service turns a newsletter issue (source text + TTS audio + transcript) into a
published podcast episode: it tags the audio, generates transcripts and show notes,
rebuilds the RSS feed, and deploys — all triggered by a single API call.

## Configuration

| Setting | Value |
|---|---|
| Repository | `pkraft/newsletter-podcasts` |
| Auth | Fine-grained GitHub PAT in env var `PODCAST_PUBLISH_TOKEN` |
| Series ID | Assigned by the podcast admin per newsletter (e.g. `ai-news`) |

Never hardcode the PAT. Each consumer system gets its own PAT (scoped to only this
repo, `contents: read/write`) so it can be revoked independently.

## The API call

The service is serverless: the API is GitHub's `repository_dispatch` endpoint.

```
POST https://api.github.com/repos/pkraft/newsletter-podcasts/dispatches
Authorization: Bearer $PODCAST_PUBLISH_TOKEN
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

Body:

```json
{
  "event_type": "publish-episode",
  "client_payload": {
    "series_id": "ai-news",
    "external_id": "issue-2026-07-19",
    "title": "Issue 42: The one about databases",
    "summary": "Short description shown in podcast players (plain text, ~1-4 sentences).",
    "publish_date": "2026-07-19T12:00:00Z",
    "audio_url": "https://newsletter.example.com/issues/42/audio.mp3",
    "transcript_url": "https://newsletter.example.com/issues/42/transcript.vtt",
    "source_text_url": "https://newsletter.example.com/issues/42/body.md",
    "auto_publish": true
  }
}
```

See [references/payload.schema.json](references/payload.schema.json) for the full
JSON Schema. Working examples: [examples/publish-episode.sh](examples/publish-episode.sh)
(curl) and [examples/publish-episode.mjs](examples/publish-episode.mjs) (Node).

## Field rules

- **`series_id`** — must already exist in the service (created by the admin in the UI).
  Unknown IDs fail the pipeline; they are never auto-created.
- **`external_id`** — the newsletter's own stable ID for the issue. This is the
  **idempotency key**: re-sending the same (`series_id`, `external_id`) updates the
  existing episode instead of creating a duplicate. Always send it; never reuse one
  for a different issue.
- **`title`** — plain text, no HTML. Shown verbatim in podcast apps.
- **`summary`** — plain text. This becomes the episode description in players.
- **`publish_date`** — ISO 8601 with timezone. May be in the past; future dates do
  NOT schedule (the episode publishes on ingest with that date shown).
- **`audio_url` / `transcript_url` / `source_text_url`** — must be publicly fetchable
  **at the moment of the call** (HTTPS, no auth, no login redirect). The service
  copies the files into its own storage during ingest, so the source URLs may expire
  afterward. Do not send file contents inline — the payload is capped at ~64 KB total.
- **`auto_publish`** — `true` publishes immediately; `false` ingests as a draft for
  the admin to publish manually from the UI. Default: `true`.

## Audio requirements

- **Format: MP3 only.** No conversion needed on the consumer side — MP3 plays on
  every podcast app and device. Do not send WAV/OGG/FLAC/M4A.
- **Preferred encoding: CBR (constant bitrate) 96-128 kbps, 44.1 kHz.** VBR files and
  off-spec sample rates (e.g. 22.05/24 kHz from some TTS services) are accepted — the
  pipeline detects and re-encodes them — but sending spec-compliant CBR avoids a lossy
  re-encode generation.
- Do not bother setting ID3 tags or embedding artwork; the service overwrites tags
  and embeds the series artwork itself.

## Transcript & source text

- **Transcript**: VTT preferred; SRT and plain text also accepted. The service
  converts to all published formats.
- **Source text**: Markdown or HTML. It becomes the episode's show notes / web page.
  HTML is sanitized server-side (scripts, iframes, event handlers stripped) — don't
  rely on embedded scripts or styling surviving.

## Response handling — IMPORTANT

A successful dispatch returns **`204 No Content` with an empty body**. This means
"accepted", **not** "published" — processing takes roughly 2-4 minutes (pipeline +
site deploy). There is no synchronous result.

To confirm the outcome, poll the workflow runs:

```
GET https://api.github.com/repos/pkraft/newsletter-podcasts/actions/runs?event=repository_dispatch&per_page=5
```

Find the run created just after your dispatch (compare `created_at`); its
`conclusion` becomes `success` or `failure`. On failure, the service also opens a
GitHub issue labeled `pipeline-failure` with the reason. The Node example implements
this polling pattern.

Verification of final truth: the episode appears in the series RSS feed at
`https://podcast-ai-news.petekraft.com/{series_id}/feed.xml` (match on your
`external_id` to episode guid mapping, or title).

## Error responses at dispatch time

| Status | Meaning | Action |
|---|---|---|
| 204 | Accepted | Poll for pipeline result |
| 401 | Bad/expired PAT | Rotate `PODCAST_PUBLISH_TOKEN` |
| 404 | Wrong repo path, or PAT lacks access to the repo | Check config + PAT scope |
| 422 | Malformed body (e.g. missing `event_type`) | Fix the request shape |

Note that payload *content* errors (unknown `series_id`, unreachable `audio_url`,
bad date format) do NOT fail the dispatch — they surface as a failed pipeline run.
Validate locally before sending: the schema in `references/` is the same one the
pipeline enforces.

## Checklist for generated client code

1. PAT from env var, never hardcoded; fail fast with a clear message if unset.
2. All three asset URLs verified reachable (HEAD/GET 200) before dispatching.
3. `external_id` derived from the newsletter's stable issue ID.
4. Treat 204 as "accepted, pending" — poll or at least log that publication is async.
5. Retry the dispatch on 5xx/network errors (it's idempotent thanks to `external_id`);
   do NOT retry 4xx.
6. `publish_date` in ISO 8601 with explicit timezone.
