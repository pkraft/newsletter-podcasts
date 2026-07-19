#!/usr/bin/env node
// Publish a newsletter issue as a podcast episode, then poll for the pipeline result.
// Usage: PODCAST_PUBLISH_TOKEN=... node publish-episode.mjs
// Adapt the episode object below into your newsletter system.

const REPO = "pkraft/newsletter-podcasts";
const TOKEN = process.env.PODCAST_PUBLISH_TOKEN;
if (!TOKEN) {
  console.error("PODCAST_PUBLISH_TOKEN is not set (fine-grained PAT for the podcast repo)");
  process.exit(1);
}

const episode = {
  series_id: "ai-news",
  external_id: "issue-2026-07-19",
  title: "Issue 42: The one about databases",
  summary: "Short description shown in podcast players.",
  publish_date: "2026-07-19T12:00:00Z",
  audio_url: "https://newsletter.example.com/issues/42/audio.mp3",
  transcript_url: "https://newsletter.example.com/issues/42/transcript.vtt",
  source_text_url: "https://newsletter.example.com/issues/42/body.md",
  auto_publish: true,
};

const gh = (path, init = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });

// 1. Pre-flight: asset URLs must be publicly reachable at dispatch time.
for (const key of ["audio_url", "transcript_url", "source_text_url"]) {
  const url = episode[key];
  if (!url) continue;
  const res = await fetch(url, { method: "HEAD" });
  if (!res.ok) {
    console.error(`${key} is not reachable (${res.status}): ${url}`);
    process.exit(1);
  }
}

// 2. Dispatch. 204 = accepted (NOT yet published). Safe to retry on 5xx/network
//    errors because external_id makes ingestion idempotent. Do not retry 4xx.
const dispatchedAt = new Date();
const res = await gh(`/repos/${REPO}/dispatches`, {
  method: "POST",
  body: JSON.stringify({ event_type: "publish-episode", client_payload: episode }),
});
if (res.status !== 204) {
  console.error(`Dispatch failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log("Dispatch accepted. Waiting for pipeline (~2-4 min)...");

// 3. Poll workflow runs for the one our dispatch created, then for its conclusion.
const findRun = async () => {
  const r = await gh(`/repos/${REPO}/actions/runs?event=repository_dispatch&per_page=10`);
  const { workflow_runs = [] } = await r.json();
  return workflow_runs.find((run) => new Date(run.created_at) >= dispatchedAt);
};

let run;
for (let i = 0; i < 20 && !run; i++) {
  await new Promise((s) => setTimeout(s, 6000));
  run = await findRun();
}
if (!run) {
  console.error("No pipeline run appeared within 2 minutes -- check the Actions tab.");
  process.exit(1);
}

while (run.status !== "completed") {
  await new Promise((s) => setTimeout(s, 15000));
  run = await (await gh(`/repos/${REPO}/actions/runs/${run.id}`)).json();
}

if (run.conclusion === "success") {
  console.log(`Published. Episode "${episode.title}" will appear in the feed after deploy.`);
} else {
  console.error(
    `Pipeline ${run.conclusion}: ${run.html_url}\nA pipeline-failure issue with details was opened on the repo.`,
  );
  process.exit(1);
}
