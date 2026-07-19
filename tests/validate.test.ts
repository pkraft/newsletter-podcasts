import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { validatePayload, validateSeries } from "../src/lib/validate.js";

const goodPayload = {
  series_id: "ai-news",
  external_id: "issue-2026-07-19",
  title: "Issue 42",
  summary: "A summary.",
  publish_date: "2026-07-19T12:00:00Z",
  audio_url: "https://example.com/audio.mp3",
};

test("valid payload passes", () => {
  assert.equal(validatePayload(goodPayload), true);
});

test("payload rejects missing required fields", () => {
  for (const key of Object.keys(goodPayload)) {
    const broken: Record<string, unknown> = { ...goodPayload };
    delete broken[key];
    assert.equal(validatePayload(broken), false, `should reject payload missing ${key}`);
  }
});

test("payload rejects http (non-https) asset URLs", () => {
  assert.equal(
    validatePayload({ ...goodPayload, audio_url: "http://example.com/audio.mp3" }),
    false,
  );
});

test("payload rejects unknown properties", () => {
  assert.equal(validatePayload({ ...goodPayload, extra: true }), false);
});

test("payload rejects bad series_id characters", () => {
  assert.equal(validatePayload({ ...goodPayload, series_id: "AI News!" }), false);
});

test("first series config is valid", () => {
  const data = JSON.parse(
    readFileSync(join(process.cwd(), "content", "series", "ai-news", "series.json"), "utf8"),
  );
  assert.equal(validateSeries(data), true);
});

test("skill payload schema matches the pipeline's schema", () => {
  const strip = (s: Record<string, unknown>) => {
    const { $id, ...rest } = s;
    return rest;
  };
  const pipeline = JSON.parse(
    readFileSync(join(process.cwd(), "src", "schemas", "payload.schema.json"), "utf8"),
  );
  const skill = JSON.parse(
    readFileSync(
      join(process.cwd(), "skills", "podcast-publisher", "references", "payload.schema.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    strip(skill),
    strip(pipeline),
    "skills/podcast-publisher/references/payload.schema.json has drifted from src/schemas/payload.schema.json",
  );
});
