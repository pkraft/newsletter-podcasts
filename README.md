# newsletter-podcasts

Turns newsletter issues (source text + TTS audio + transcript) into professionally
packaged podcast episodes, hosted entirely on GitHub Pages at
**https://podcast-ai-news.petekraft.com**.

- **Publish an episode:** the newsletter system sends a `repository_dispatch`
  (`publish-episode`) — see [skills/podcast-publisher/SKILL.md](skills/podcast-publisher/SKILL.md)
  for the full consumer contract and examples.
- **Pipeline:** [.github/workflows/ingest.yml](.github/workflows/ingest.yml) validates the
  payload, fetches assets, normalizes/tags the MP3, commits the episode, and triggers
  [build-deploy.yml](.github/workflows/build-deploy.yml), which regenerates feeds + pages
  and deploys to Pages.
- **Content model:** `content/series/{series}/series.json` and
  `content/series/{series}/episodes/{episode}/` — see [PRD.md](PRD.md) §6.
- **Docs:** [PRD.md](PRD.md) (requirements & architecture), [TASKS.md](TASKS.md) (plan).

## Development

```
npm ci
npm test          # unit tests (node:test)
npm run build     # generate _site/ (feeds + pages)
npm run ingest -- --payload-file payload.json   # run pipeline locally (needs ffmpeg)
npm run typecheck
```

Feeds are served at `/{series-id}/feed.xml`; only episodes with
`"status": "published"` appear in feeds and on the site.
