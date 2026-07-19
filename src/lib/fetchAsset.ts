import { setTimeout as sleep } from "node:timers/promises";

const MB = 1024 * 1024;

/** Pages caps individual files at 100 MB; leave headroom for the re-encode case. */
export const MAX_AUDIO_BYTES = 90 * MB;
export const MAX_TEXT_BYTES = 5 * MB;

/** An error that retrying cannot fix (4xx, oversized asset). */
class FatalFetchError extends Error {}

export interface FetchedAsset {
  bytes: Buffer;
  contentType: string;
}

export async function fetchAsset(
  url: string,
  { maxBytes, label, attempts = 3 }: { maxBytes: number; label: string; attempts?: number },
): Promise<FetchedAsset> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
      if (!res.ok) {
        const message = `${label}: HTTP ${res.status} fetching ${url}`;
        if (res.status >= 500 || res.status === 429) throw new Error(message);
        throw new FatalFetchError(message);
      }
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > maxBytes) {
        throw new FatalFetchError(`${label}: ${declared} bytes exceeds the ${maxBytes}-byte limit`);
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        throw new FatalFetchError(
          `${label}: ${bytes.byteLength} bytes exceeds the ${maxBytes}-byte limit`,
        );
      }
      if (bytes.byteLength === 0) throw new Error(`${label}: empty response from ${url}`);
      return { bytes, contentType: res.headers.get("content-type") ?? "" };
    } catch (e) {
      if (e instanceof FatalFetchError) throw e;
      lastError = e;
      if (attempt < attempts) await sleep(2000 * attempt);
    }
  }
  throw new Error(`${label}: failed after ${attempts} attempts fetching ${url}`, {
    cause: lastError,
  });
}
