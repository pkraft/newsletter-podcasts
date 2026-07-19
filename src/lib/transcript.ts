/** Transcript conversion: accept VTT, SRT, or plain text; emit VTT + SRT + JSON.
 *  JSON shape follows the podcast-namespace transcript JSON convention. */

export interface Cue {
  start: number; // seconds
  end: number;
  text: string;
}

export interface Transcript {
  cues: Cue[];
  /** true when the source had no timing (plain text) — only text formats are meaningful */
  untimed: boolean;
}

const TIME_RE = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function parseTime(raw: string): number {
  const m = TIME_RE.exec(raw.trim());
  if (!m) throw new Error(`Unparseable timestamp: "${raw}"`);
  const [, h, min, s, ms] = m;
  return (
    Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + Number((ms ?? "0").padEnd(3, "0")) / 1000
  );
}

function formatTime(seconds: number, sep: "." | ","): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

/** Parse cue-based subtitle text (shared VTT/SRT shape). */
function parseCues(body: string): Cue[] {
  const cues: Cue[] = [];
  // Normalize newlines, split into blocks on blank lines.
  const blocks = body.replaceAll("\r\n", "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const arrowIdx = lines.findIndex((l) => l.includes("-->"));
    if (arrowIdx === -1) continue; // header, NOTE, STYLE, bare index blocks
    const line = lines[arrowIdx] as string;
    const [startRaw, endRaw] = line.split("-->");
    if (!startRaw || !endRaw) continue;
    const text = lines
      .slice(arrowIdx + 1)
      .join("\n")
      .trim();
    if (!text) continue;
    // parseTime regex-matches the first timestamp, so VTT cue settings after the
    // end time (e.g. "align:start") are ignored naturally.
    cues.push({ start: parseTime(startRaw), end: parseTime(endRaw), text });
  }
  return cues;
}

export function parseTranscript(raw: string, kind: "vtt" | "srt" | "txt"): Transcript {
  if (kind === "txt") {
    return { cues: [{ start: 0, end: 0, text: raw.trim() }], untimed: true };
  }
  const cues = parseCues(raw);
  if (cues.length === 0) {
    throw new Error(`No cues found in ${kind} transcript`);
  }
  return { cues, untimed: false };
}

export function toVtt(t: Transcript): string {
  const body = t.cues
    .map((c) => `${formatTime(c.start, ".")} --> ${formatTime(c.end, ".")}\n${c.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

export function toSrt(t: Transcript): string {
  return `${t.cues
    .map((c, i) => `${i + 1}\n${formatTime(c.start, ",")} --> ${formatTime(c.end, ",")}\n${c.text}`)
    .join("\n\n")}\n`;
}

export function toJson(t: Transcript): string {
  return `${JSON.stringify(
    {
      version: "1.0.0",
      segments: t.cues.map((c) => ({ startTime: c.start, endTime: c.end, body: c.text })),
    },
    null,
    2,
  )}\n`;
}

export function toPlainText(t: Transcript): string {
  return `${t.cues.map((c) => c.text).join("\n")}\n`;
}
