import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTranscript, toJson, toPlainText, toSrt, toVtt } from "../src/lib/transcript.js";

const VTT = `WEBVTT

00:00:00.000 --> 00:00:05.000
Hello and welcome.

00:00:05.000 --> 00:01:10.500 align:start
Second cue text
on two lines.
`;

const SRT = `1
00:00:00,000 --> 00:00:05,000
Hello and welcome.

2
00:00:05,000 --> 00:01:10,500
Second cue text
on two lines.
`;

test("parses VTT including cue settings and multiline text", () => {
  const t = parseTranscript(VTT, "vtt");
  assert.equal(t.cues.length, 2);
  assert.equal(t.cues[0]?.start, 0);
  assert.equal(t.cues[1]?.end, 70.5);
  assert.equal(t.cues[1]?.text, "Second cue text\non two lines.");
  assert.equal(t.untimed, false);
});

test("parses SRT with numeric indexes", () => {
  const t = parseTranscript(SRT, "srt");
  assert.equal(t.cues.length, 2);
  assert.equal(t.cues[1]?.start, 5);
});

test("VTT -> SRT -> VTT round trip preserves cues", () => {
  const t = parseTranscript(VTT, "vtt");
  const t2 = parseTranscript(toSrt(t), "srt");
  assert.deepEqual(t2.cues, t.cues);
  const t3 = parseTranscript(toVtt(t2), "vtt");
  assert.deepEqual(t3.cues, t.cues);
});

test("JSON output follows podcast-namespace segment shape", () => {
  const data = JSON.parse(toJson(parseTranscript(VTT, "vtt")));
  assert.equal(data.version, "1.0.0");
  assert.equal(data.segments.length, 2);
  assert.deepEqual(Object.keys(data.segments[0]), ["startTime", "endTime", "body"]);
});

test("plain text source becomes an untimed transcript", () => {
  const t = parseTranscript("Just a wall of text.", "txt");
  assert.equal(t.untimed, true);
  assert.equal(toPlainText(t).trim(), "Just a wall of text.");
});

test("empty subtitle input throws", () => {
  assert.throws(() => parseTranscript("WEBVTT\n\n", "vtt"), /No cues/);
});
