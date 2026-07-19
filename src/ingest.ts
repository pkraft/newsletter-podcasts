import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  needsReencode,
  probe,
  reencode,
  writeTags,
} from "./lib/audio.js";
import { episodeDir, loadSeries, seriesDir } from "./lib/content.js";
import { fetchAsset, MAX_AUDIO_BYTES, MAX_TEXT_BYTES } from "./lib/fetchAsset.js";
import { episodeGuid } from "./lib/uuid.js";
import { assertValid, validateEpisode, validatePayload } from "./lib/validate.js";
import type { EpisodeMeta, PublishPayload } from "./types.js";

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 128);
  return slug.length >= 2 ? slug : `ep-${slug || "0"}`;
}

function transcriptExtension(url: string, contentType: string): string {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".vtt") || contentType.includes("text/vtt")) return "vtt";
  if (path.endsWith(".srt")) return "srt";
  return "txt";
}

function readPayload(): PublishPayload {
  const fileArg = process.argv.indexOf("--payload-file");
  const raw =
    fileArg !== -1
      ? readFileSync(process.argv[fileArg + 1] as string, "utf8")
      : process.env.PAYLOAD;
  if (!raw) {
    throw new Error("No payload: set the PAYLOAD env var or pass --payload-file <path>");
  }
  const payload = JSON.parse(raw);
  assertValid(validatePayload, payload, "publish-episode payload");
  return payload as PublishPayload;
}

async function main(): Promise<void> {
  const payload = readPayload();
  const series = loadSeries(payload.series_id);
  if (series.status === "archived") {
    throw new Error(`Series "${series.id}" is archived and does not accept new episodes.`);
  }

  const episodeId = slugify(payload.external_id);
  const dir = episodeDir(series.id, episodeId);
  const existingFile = join(dir, "episode.json");
  const existing: EpisodeMeta | null = existsSync(existingFile)
    ? (JSON.parse(readFileSync(existingFile, "utf8")) as EpisodeMeta)
    : null;
  const now = new Date().toISOString();
  mkdirSync(dir, { recursive: true });

  const tmpDir = join(process.cwd(), ".tmp");
  mkdirSync(tmpDir, { recursive: true });

  // Audio: fetch → probe → conditional re-encode → tag.
  const audio = await fetchAsset(payload.audio_url, {
    maxBytes: MAX_AUDIO_BYTES,
    label: "audio",
  });
  const rawAudio = join(tmpDir, `${episodeId}-raw.mp3`);
  writeFileSync(rawAudio, audio.bytes);
  const probed = await probe(rawAudio);
  const finalAudio = join(dir, "audio.mp3");
  let reencoded = false;
  if (needsReencode(probed)) {
    await reencode(rawAudio, finalAudio);
    reencoded = true;
  } else {
    writeFileSync(finalAudio, audio.bytes);
  }
  writeTags(finalAudio, {
    title: payload.title,
    artist: series.author,
    album: series.title,
    year: String(new Date(payload.publish_date).getUTCFullYear()),
    artworkFile: join(seriesDir(series.id), "artwork", "cover.jpg"),
  });
  const finalProbe = await probe(finalAudio);
  const finalBytes = readFileSync(finalAudio).byteLength;
  rmSync(rawAudio, { force: true });

  if (payload.transcript_url) {
    const transcript = await fetchAsset(payload.transcript_url, {
      maxBytes: MAX_TEXT_BYTES,
      label: "transcript",
    });
    const ext = transcriptExtension(payload.transcript_url, transcript.contentType);
    writeFileSync(join(dir, `transcript.${ext}`), transcript.bytes);
  }

  if (payload.source_text_url) {
    const source = await fetchAsset(payload.source_text_url, {
      maxBytes: MAX_TEXT_BYTES,
      label: "source text",
    });
    writeFileSync(join(dir, "notes.md"), source.bytes);
  }

  // Idempotent update: guid and ingestedAt survive re-ingest; a manual admin
  // publish/unpublish decision also survives (admin wins over auto_publish on update).
  const meta: EpisodeMeta = {
    id: episodeId,
    guid: existing?.guid ?? episodeGuid(series.id, payload.external_id),
    externalId: payload.external_id,
    title: payload.title,
    summary: payload.summary,
    publishDate: payload.publish_date,
    status: existing ? existing.status : payload.auto_publish === false ? "unpublished" : "published",
    audio: {
      file: "audio.mp3",
      bytes: finalBytes,
      durationSeconds: finalProbe.durationSeconds,
      mimeType: "audio/mpeg",
    },
    ingestedAt: existing?.ingestedAt ?? now,
    updatedAt: now,
  };
  assertValid(validateEpisode, meta, "generated episode.json");
  writeFileSync(existingFile, `${JSON.stringify(meta, null, 2)}\n`);

  const summary = [
    `## Episode ${existing ? "updated" : "ingested"}: ${payload.title}`,
    `- Series: ${series.id}`,
    `- Episode ID: ${episodeId} (external: ${payload.external_id})`,
    `- Status: ${meta.status}`,
    `- Duration: ${Math.round(finalProbe.durationSeconds)}s, ${finalBytes} bytes`,
    `- Audio: ${reencoded ? "re-encoded to CBR 128 kbps / 44.1 kHz (was off-spec)" : "passed through unchanged"}`,
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
