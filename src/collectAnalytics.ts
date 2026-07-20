/** Nightly analytics collector (runs in CI, not in the browser — Cloudflare's
 *  API has no CORS). Pulls per-episode request/cache/bandwidth stats from
 *  Cloudflare GraphQL and (optionally) download counts from OP3, merging them
 *  into content/analytics/*.json. The admin UI reads those files via the
 *  GitHub contents API, so no site rebuild is needed.
 *
 *  Free-plan Cloudflare retains per-path (adaptive) data ~7 days; each run
 *  re-collects the trailing window so daily runs accumulate full history. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "content", "analytics");

interface CfDay {
  requests: number;
  cachedRequests: number;
  bytes: number;
}
interface CfFile {
  updatedAt: string;
  /** days["2026-07-19"]["ai-news/ai-news-2026-07-19"] = {requests, cachedRequests, bytes} */
  days: Record<string, Record<string, CfDay>>;
}

interface CfGroup {
  count: number;
  dimensions: { date: string; clientRequestPath: string; cacheStatus: string };
  sum: { edgeResponseBytes: number };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function collectCloudflare(): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zone) {
    throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID must be set");
  }

  const today = new Date();
  // Free-plan zones cap adaptive queries at a 1-day range, so query each of the
  // trailing 7 days separately; days beyond retention just log and skip.
  const query = `
    query($zone: String!, $day: String!) {
      viewer {
        zones(filter: { zoneTag: $zone }) {
          httpRequestsAdaptiveGroups(
            filter: { date: $day, clientRequestPath_like: "%/episodes/%" }
            limit: 10000
          ) {
            count
            dimensions { date clientRequestPath cacheStatus }
            sum { edgeResponseBytes }
          }
        }
      }
    }`;

  const groups: CfGroup[] = [];
  for (let i = 0; i <= 6; i++) {
    const day = isoDate(new Date(today.getTime() - i * 24 * 3600 * 1000));
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { zone, day } }),
    });
    const data = (await res.json()) as {
      data?: { viewer?: { zones?: { httpRequestsAdaptiveGroups?: CfGroup[] }[] } };
      errors?: { message: string }[];
    };
    if (data.errors?.length) {
      const messages = data.errors.map((e) => e.message).join("; ");
      if (messages.includes("Zone not found")) {
        throw new Error(
          `Cloudflare GraphQL: ${messages} (check CLOUDFLARE_ZONE_ID is the Zone ID from the zone overview page — not the Account ID — and that the token has Zone→Analytics→Read on that zone)`,
        );
      }
      console.log(`cloudflare: ${day} skipped (${messages})`);
      continue;
    }
    groups.push(...(data.data?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups ?? []));
  }

  const file = join(OUT_DIR, "cloudflare.json");
  const existing: CfFile = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as CfFile)
    : { updatedAt: "", days: {} };

  // Rebuild the trailing window from scratch (idempotent), keep older days as-is.
  for (let i = 0; i <= 6; i++) {
    const day = isoDate(new Date(today.getTime() - i * 24 * 3600 * 1000));
    delete existing.days[day];
  }
  let matched = 0;
  for (const g of groups) {
    const m = /^\/([a-z0-9-]+)\/episodes\/([a-z0-9-]+)\//.exec(g.dimensions.clientRequestPath);
    if (!m) continue;
    matched++;
    const key = `${m[1]}/${m[2]}`;
    const day = (existing.days[g.dimensions.date] ??= {});
    const entry = (day[key] ??= { requests: 0, cachedRequests: 0, bytes: 0 });
    entry.requests += g.count;
    if (g.dimensions.cacheStatus === "hit") entry.cachedRequests += g.count;
    entry.bytes += g.sum.edgeResponseBytes;
  }
  existing.updatedAt = new Date().toISOString();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`cloudflare: ${groups.length} groups, ${matched} episode-path groups merged`);
}

/** OP3 downloads (optional — needs OP3_API_TOKEN secret; free at op3.dev/api/keys).
 *  Best-effort: failures are logged, never fatal, so Cloudflare collection always lands. */
async function collectOp3(): Promise<void> {
  const token = process.env.OP3_API_TOKEN;
  if (!token) {
    console.log("op3: OP3_API_TOKEN not set, skipping");
    return;
  }
  try {
    const { readdirSync } = await import("node:fs");
    const auth = { Authorization: `Bearer ${token}` };
    const out: { updatedAt: string; shows: Record<string, unknown> } = {
      updatedAt: new Date().toISOString(),
      shows: {},
    };
    for (const dir of readdirSync(join(process.cwd(), "content", "series"))) {
      const cfg = JSON.parse(
        readFileSync(join(process.cwd(), "content", "series", dir, "series.json"), "utf8"),
      ) as { id: string; podcastGuid?: string };
      if (!cfg.podcastGuid) continue;
      const showRes = await fetch(
        `https://op3.dev/api/1/shows?podcastGuid=${encodeURIComponent(cfg.podcastGuid)}`,
        { headers: auth },
      );
      if (!showRes.ok) {
        console.log(`op3: show lookup for ${cfg.id} -> HTTP ${showRes.status}, skipping`);
        continue;
      }
      out.shows[cfg.id] = await showRes.json();
    }
    writeFileSync(join(OUT_DIR, "op3.json"), `${JSON.stringify(out, null, 2)}\n`);
    console.log("op3: wrote op3.json");
  } catch (e) {
    console.log(`op3: skipped (${e instanceof Error ? e.message : e})`);
  }
}

await collectCloudflare();
await collectOp3();
