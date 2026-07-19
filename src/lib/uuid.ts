import { createHash } from "node:crypto";

/** Namespace for episode GUIDs, fixed for the lifetime of this service. Never change:
 *  podcast apps key episodes on their GUID. */
const EPISODE_NAMESPACE = "8dbf7a2b-3c41-4b6e-9f25-6a1d7c9e0b42";

/** Podcasting 2.0 namespace for <podcast:guid> (from the podcast-namespace spec). */
const PODCAST_NAMESPACE = "ead4c236-bf58-58c6-a2c6-a6b28d128cb6";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

export function uuidV5(name: string, namespace: string): string {
  const hash = createHash("sha1")
    .update(uuidToBytes(namespace))
    .update(name, "utf8")
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable episode GUID: same (seriesId, externalId) always yields the same GUID. */
export function episodeGuid(seriesId: string, externalId: string): string {
  return uuidV5(`${seriesId}:${externalId}`, EPISODE_NAMESPACE);
}

/** <podcast:guid> for a feed: UUIDv5 of the feed URL, scheme and trailing slashes stripped. */
export function podcastGuid(feedUrl: string): string {
  const normalized = feedUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return uuidV5(normalized, PODCAST_NAMESPACE);
}
