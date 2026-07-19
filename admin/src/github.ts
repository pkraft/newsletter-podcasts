/** GitHub REST client for the admin SPA. The admin's fine-grained PAT lives in
 *  sessionStorage only — it is never committed or sent anywhere but api.github.com. */

export const REPO = "pkraft/newsletter-podcasts";
const API = "https://api.github.com";
const TOKEN_KEY = "np-admin-pat";

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export class GhError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${getToken() ?? ""}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new GhError(res.status, body.message ?? res.statusText);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

// --- unicode-safe base64 ---
export function encodeB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
export function decodeB64(b64: string): string {
  const bin = atob(b64.replaceAll("\n", ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// --- core repo operations ---

export async function whoami(): Promise<string> {
  return (await gh<{ login: string }>("/user")).login;
}

export interface DirEntry {
  name: string;
  type: "file" | "dir";
  sha: string;
  path: string;
}

export async function listDir(path: string): Promise<DirEntry[]> {
  return gh<DirEntry[]>(`/repos/${REPO}/contents/${path}?ref=main`);
}

export interface TextFile {
  text: string;
  sha: string;
}

export async function getFile(path: string): Promise<TextFile> {
  const data = await gh<{ content: string; sha: string }>(
    `/repos/${REPO}/contents/${path}?ref=main`,
  );
  return { text: decodeB64(data.content), sha: data.sha };
}

/** Create or update a file on main. Every call is one commit; pushes made with
 *  the admin PAT trigger the build-deploy workflow automatically. */
export async function putFile(
  path: string,
  base64Content: string,
  message: string,
  sha?: string,
): Promise<void> {
  await gh(`/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `admin: ${message}`,
      content: base64Content,
      branch: "main",
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function deleteFile(path: string, message: string, sha: string): Promise<void> {
  await gh(`/repos/${REPO}/contents/${path}`, {
    method: "DELETE",
    body: JSON.stringify({ message: `admin: ${message}`, sha, branch: "main" }),
  });
}

// --- pipeline visibility ---

export interface WorkflowRun {
  id: number;
  name: string;
  display_title: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  html_url: string;
}

export async function listRuns(): Promise<WorkflowRun[]> {
  const data = await gh<{ workflow_runs: WorkflowRun[] }>(
    `/repos/${REPO}/actions/runs?per_page=10`,
  );
  return data.workflow_runs;
}

export async function triggerRebuild(): Promise<void> {
  await gh(`/repos/${REPO}/actions/workflows/build-deploy.yml/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main" }),
  });
}

// --- content model ---

export interface SeriesConfig {
  id: string;
  podcastGuid?: string;
  title: string;
  subtitle?: string;
  description: string;
  author: string;
  ownerName: string;
  ownerEmail: string;
  language: string;
  category: string;
  subcategory?: string;
  explicit: boolean;
  themeColor?: string;
  link?: string;
  status: "active" | "archived";
  directories?: { apple?: string; spotify?: string; amazon?: string; podcastIndex?: string };
}

export interface EpisodeMeta {
  id: string;
  guid: string;
  externalId: string;
  title: string;
  summary: string;
  publishDate: string;
  status: "published" | "unpublished";
  audio: { file: string; bytes: number; durationSeconds: number; mimeType: string };
  ingestedAt: string;
  updatedAt: string;
}

export interface LoadedSeries {
  config: SeriesConfig;
  sha: string;
}

export interface LoadedEpisode {
  meta: EpisodeMeta;
  sha: string;
}

export async function loadSeriesList(): Promise<LoadedSeries[]> {
  const dirs = await listDir("content/series");
  const all = await Promise.all(
    dirs
      .filter((d) => d.type === "dir")
      .map(async (d) => {
        const f = await getFile(`content/series/${d.name}/series.json`);
        return { config: JSON.parse(f.text) as SeriesConfig, sha: f.sha };
      }),
  );
  return all.sort((a, b) => a.config.title.localeCompare(b.config.title));
}

export async function loadEpisodes(seriesId: string): Promise<LoadedEpisode[]> {
  let dirs: DirEntry[];
  try {
    dirs = await listDir(`content/series/${seriesId}/episodes`);
  } catch (e) {
    if (e instanceof GhError && e.status === 404) return []; // no episodes yet
    throw e;
  }
  const all = await Promise.all(
    dirs
      .filter((d) => d.type === "dir")
      .map(async (d) => {
        const f = await getFile(`content/series/${seriesId}/episodes/${d.name}/episode.json`);
        return { meta: JSON.parse(f.text) as EpisodeMeta, sha: f.sha };
      }),
  );
  return all.sort((a, b) => (a.meta.publishDate < b.meta.publishDate ? 1 : -1));
}

export async function saveSeries(config: SeriesConfig, sha?: string): Promise<void> {
  await putFile(
    `content/series/${config.id}/series.json`,
    encodeB64(`${JSON.stringify(config, null, 2)}\n`),
    `${sha ? "update" : "create"} series ${config.id}`,
    sha,
  );
}

export async function saveEpisode(
  seriesId: string,
  meta: EpisodeMeta,
  sha: string,
  action: string,
): Promise<void> {
  await putFile(
    `content/series/${seriesId}/episodes/${meta.id}/episode.json`,
    encodeB64(`${JSON.stringify(meta, null, 2)}\n`),
    `${action} ${seriesId}/${meta.id}`,
    sha,
  );
}

/** Delete an episode entirely (one commit per file — contents API limitation). */
export async function deleteEpisode(seriesId: string, episodeId: string): Promise<void> {
  const dir = `content/series/${seriesId}/episodes/${episodeId}`;
  const files = await listDir(dir);
  for (const f of files) {
    if (f.type === "file") {
      await deleteFile(f.path, `delete episode ${seriesId}/${episodeId}`, f.sha);
    }
  }
}

// --- podcast:guid minting (UUIDv5 over the feed URL, per podcasting 2.0 spec) ---

const PODCAST_NS = "ead4c236-bf58-58c6-a2c6-a6b28d128cb6";

export async function mintPodcastGuid(feedUrl: string): Promise<string> {
  const name = feedUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const ns = Uint8Array.from(
    (PODCAST_NS.replaceAll("-", "").match(/../g) ?? []).map((h) => Number.parseInt(h, 16)),
  );
  const data = new Uint8Array([...ns, ...new TextEncoder().encode(name)]);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  hash[6] = ((hash[6] as number) & 0x0f) | 0x50;
  hash[8] = ((hash[8] as number) & 0x3f) | 0x80;
  const hex = [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
