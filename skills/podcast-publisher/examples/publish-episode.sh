#!/usr/bin/env bash
# Publish a newsletter issue as a podcast episode.
# Usage: PODCAST_PUBLISH_TOKEN=... ./publish-episode.sh
set -euo pipefail

: "${PODCAST_PUBLISH_TOKEN:?Set PODCAST_PUBLISH_TOKEN to a fine-grained PAT for the podcast repo}"

REPO="pkraft/newsletter-podcasts"

# Dispatch returns 204 No Content on acceptance. This does NOT mean "published" --
# the pipeline takes ~2-4 minutes. See SKILL.md "Response handling".
curl --fail-with-body -sS \
  -X POST "https://api.github.com/repos/${REPO}/dispatches" \
  -H "Authorization: Bearer ${PODCAST_PUBLISH_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d @- <<'JSON'
{
  "event_type": "publish-episode",
  "client_payload": {
    "series_id": "ai-news",
    "external_id": "issue-2026-07-19",
    "title": "Issue 42: The one about databases",
    "summary": "Short description shown in podcast players.",
    "publish_date": "2026-07-19T12:00:00Z",
    "audio_url": "https://newsletter.example.com/issues/42/audio.mp3",
    "transcript_url": "https://newsletter.example.com/issues/42/transcript.vtt",
    "source_text_url": "https://newsletter.example.com/issues/42/body.md",
    "auto_publish": true
  }
}
JSON

echo "Dispatch accepted (204). Pipeline result: https://github.com/${REPO}/actions"
