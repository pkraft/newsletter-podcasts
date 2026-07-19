import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import NodeID3 from "node-id3";

const run = promisify(execFile);

export interface AudioProbe {
  codec: string;
  sampleRate: number;
  /** Stream-level bitrate in bps; missing for most VBR MP3s (our VBR heuristic). */
  streamBitRate: number | null;
  durationSeconds: number;
}

export async function probe(file: string): Promise<AudioProbe> {
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_name,sample_rate,bit_rate",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    file,
  ]);
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  if (!stream) throw new Error(`No audio stream found in ${file}`);
  const duration = Number(data.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Could not determine audio duration for ${file}`);
  }
  return {
    codec: String(stream.codec_name ?? ""),
    sampleRate: Number(stream.sample_rate ?? 0),
    streamBitRate: stream.bit_rate ? Number(stream.bit_rate) : null,
    durationSeconds: duration,
  };
}

/** Podcast-standard target: CBR 128 kbps, 44.1 kHz MP3. */
export function needsReencode(p: AudioProbe): boolean {
  if (p.codec !== "mp3") return true;
  if (p.sampleRate !== 44100) return true;
  if (p.streamBitRate === null) return true; // VBR heuristic
  if (p.streamBitRate < 64_000 || p.streamBitRate > 192_000) return true;
  return false;
}

export async function reencode(input: string, output: string): Promise<void> {
  await run("ffmpeg", [
    "-y",
    "-i",
    input,
    "-vn",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-write_xing",
    "1",
    output,
  ]);
}

export interface TagInput {
  title: string;
  artist: string;
  album: string;
  year: string;
  artworkFile?: string;
}

export function writeTags(file: string, tags: TagInput): void {
  const id3: NodeID3.Tags = {
    title: tags.title,
    artist: tags.artist,
    album: tags.album,
    year: tags.year,
    genre: "Podcast",
  };
  if (tags.artworkFile && existsSync(tags.artworkFile)) {
    id3.image = tags.artworkFile;
  }
  const result = NodeID3.write(id3, file);
  if (result !== true) {
    throw result instanceof Error ? result : new Error(`Failed to write ID3 tags to ${file}`);
  }
}
