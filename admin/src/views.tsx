import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  type EpisodeMeta,
  GhError,
  type LoadedEpisode,
  type LoadedSeries,
  REPO,
  type SeriesConfig,
  type WorkflowRun,
  deleteEpisode,
  encodeB64,
  getFile,
  listRuns,
  loadEpisodes,
  loadSeriesList,
  mintPodcastGuid,
  putFile,
  saveEpisode,
  saveSeries,
  setToken,
  triggerRebuild,
} from "./github";

// ---------- shared bits ----------

function errText(e: unknown): string {
  if (e instanceof GhError) {
    if (e.status === 401) return "Token rejected (401). Check the PAT and its expiry.";
    if (e.status === 403) return `Forbidden (403): ${e.message} — does the PAT cover this repo?`;
    if (e.status === 404) return `Not found (404): ${e.message}`;
    return `GitHub error ${e.status}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

function useLoad<T>(fn: () => Promise<T>): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errText(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

/** Shown after any action that commits: the site rebuilds asynchronously. */
function CommitNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="notice small">
      Change committed. The site is rebuilding — it goes live in about 1–2 minutes. Watch progress
      on the <a href="#/">dashboard</a>.
    </p>
  );
}

function RunChip({ run }: { run: WorkflowRun }) {
  const cls = run.status !== "completed" ? "warn" : run.conclusion === "success" ? "ok" : "err";
  const label = run.status !== "completed" ? run.status : (run.conclusion ?? "?");
  return <span className={`chip ${cls}`}>{label}</span>;
}

// ---------- login ----------

export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setToken(value.trim());
    try {
      await onLogin();
    } catch (err) {
      setToken(null);
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-box card">
      <h1>🎙 Podcast Admin</h1>
      <p className="muted small">
        Paste a fine-grained GitHub personal access token for <code>{REPO}</code> with{" "}
        <strong>Contents: read/write</strong> and <strong>Actions: read/write</strong>. The token
        stays in this browser tab (sessionStorage) and is sent only to api.github.com.
      </p>
      <form className="stack" onSubmit={submit}>
        <label htmlFor="pat">Personal access token</label>
        <input
          id="pat"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="github_pat_…"
          autoComplete="off"
          required
        />
        {error && <div className="error small">{error}</div>}
        <p>
          <button className="primary" type="submit" disabled={busy || !value.trim()}>
            {busy ? "Checking…" : "Log in"}
          </button>
        </p>
      </form>
      <p className="muted small">
        Create one at GitHub → Settings → Developer settings → Fine-grained tokens, limited to the{" "}
        <code>{REPO.split("/")[1]}</code> repository.
      </p>
    </div>
  );
}

// ---------- dashboard ----------

export function Dashboard() {
  const series = useLoad<LoadedSeries[]>(loadSeriesList);
  const runs = useLoad<WorkflowRun[]>(listRuns);
  const [rebuilt, setRebuilt] = useState(false);

  return (
    <div>
      <div className="row between">
        <h1>Dashboard</h1>
        <button
          type="button"
          onClick={async () => {
            await triggerRebuild();
            setRebuilt(true);
            setTimeout(runs.reload, 2500);
          }}
        >
          Trigger rebuild
        </button>
      </div>
      <CommitNotice show={rebuilt} />

      {series.error && <div className="error">{series.error}</div>}
      {series.loading && <p className="muted">Loading series…</p>}
      <div className="grid">
        {series.data?.map(({ config }) => (
          <div className="card" key={config.id}>
            <div className="row between">
              <strong>{config.title}</strong>
              <span className={`chip ${config.status === "active" ? "ok" : "muted"}`}>
                {config.status}
              </span>
            </div>
            <p className="muted small">
              {config.id} · {config.category}
            </p>
            <p>
              <a href={`#/series/${config.id}`}>Manage episodes & settings →</a>
            </p>
          </div>
        ))}
      </div>

      <h2>Recent pipeline runs</h2>
      {runs.error && <div className="error">{runs.error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {runs.data?.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={r.html_url} target="_blank" rel="noreferrer">
                    {r.name}
                  </a>
                </td>
                <td className="muted small">{r.display_title}</td>
                <td>
                  <RunChip run={r} />
                </td>
                <td className="muted small">{new Date(r.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">
          <button type="button" onClick={runs.reload}>
            Refresh
          </button>
        </p>
      </div>
    </div>
  );
}

// ---------- series detail: episodes + series settings ----------

const SERIES_FIELDS: {
  key: keyof SeriesConfig;
  label: string;
  kind: "text" | "textarea" | "email";
  required?: boolean;
}[] = [
  { key: "title", label: "Title", kind: "text", required: true },
  { key: "subtitle", label: "Subtitle", kind: "text" },
  { key: "description", label: "Description", kind: "textarea", required: true },
  { key: "author", label: "Author", kind: "text", required: true },
  { key: "ownerName", label: "Owner name", kind: "text", required: true },
  { key: "ownerEmail", label: "Owner email", kind: "email", required: true },
  { key: "language", label: "Language (e.g. en-us)", kind: "text", required: true },
  { key: "category", label: "Apple category", kind: "text", required: true },
  { key: "subcategory", label: "Apple subcategory", kind: "text" },
  { key: "themeColor", label: "Theme color (#rrggbb)", kind: "text" },
  { key: "link", label: "External site link", kind: "text" },
];

export function SeriesView({ seriesId }: { seriesId: string }) {
  const series = useLoad(
    useCallback(async () => {
      const all = await loadSeriesList();
      const found = all.find((s) => s.config.id === seriesId);
      if (!found) throw new Error(`Series "${seriesId}" not found`);
      return found;
    }, [seriesId]),
  );
  const episodes = useLoad(useCallback(() => loadEpisodes(seriesId), [seriesId]));
  const [committed, setCommitted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LoadedEpisode | null>(null);

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      setCommitted(true);
      episodes.reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusyId(null);
    }
  };

  const togglePublish = (ep: LoadedEpisode) =>
    act(ep.meta.id, () =>
      saveEpisode(
        seriesId,
        {
          ...ep.meta,
          status: ep.meta.status === "published" ? "unpublished" : "published",
          updatedAt: new Date().toISOString(),
        },
        ep.sha,
        ep.meta.status === "published" ? "unpublish" : "publish",
      ),
    );

  const remove = (ep: LoadedEpisode) => {
    if (
      !window.confirm(
        `Permanently delete "${ep.meta.title}" (${ep.meta.id})? Podcast apps that downloaded it keep their copies.`,
      )
    )
      return;
    return act(ep.meta.id, () => deleteEpisode(seriesId, ep.meta.id));
  };

  return (
    <div>
      <h1>{series.data?.config.title ?? seriesId}</h1>
      {series.error && <div className="error">{series.error}</div>}
      <CommitNotice show={committed} />
      {error && <div className="error">{error}</div>}

      <h2>Episodes</h2>
      {episodes.loading && <p className="muted">Loading episodes…</p>}
      {episodes.data && episodes.data.length === 0 && (
        <p className="muted">No episodes yet — they arrive via the publish API.</p>
      )}
      {episodes.data && episodes.data.length > 0 && (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Episode</th>
                <th>Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {episodes.data.map((ep) => (
                <tr key={ep.meta.id}>
                  <td>
                    <strong>{ep.meta.title}</strong>
                    <div className="muted small">
                      {ep.meta.id} · {Math.round(ep.meta.audio.durationSeconds / 60)} min
                    </div>
                  </td>
                  <td className="small">{new Date(ep.meta.publishDate).toLocaleDateString()}</td>
                  <td>
                    <span className={`chip ${ep.meta.status === "published" ? "ok" : "muted"}`}>
                      {ep.meta.status}
                    </span>
                  </td>
                  <td>
                    <div className="row">
                      <button
                        type="button"
                        disabled={busyId === ep.meta.id}
                        onClick={() => togglePublish(ep)}
                      >
                        {ep.meta.status === "published" ? "Unpublish" : "Publish"}
                      </button>
                      <button type="button" onClick={() => setEditing(ep)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger"
                        disabled={busyId === ep.meta.id}
                        onClick={() => remove(ep)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EpisodeEditDialog
          episode={editing}
          onClose={() => setEditing(null)}
          onSave={(meta) =>
            act(meta.id, () => saveEpisode(seriesId, meta, editing.sha, "edit")).then(() =>
              setEditing(null),
            )
          }
        />
      )}

      {series.data && (
        <SeriesForm
          initial={series.data.config}
          sha={series.data.sha}
          onSaved={() => {
            setCommitted(true);
            series.reload();
          }}
        />
      )}
    </div>
  );
}

function EpisodeEditDialog({
  episode,
  onClose,
  onSave,
}: {
  episode: LoadedEpisode;
  onClose: () => void;
  onSave: (meta: EpisodeMeta) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(episode.meta.title);
  const [summary, setSummary] = useState(episode.meta.summary);
  useEffect(() => ref.current?.showModal(), []);

  return (
    <dialog ref={ref} onClose={onClose}>
      <h2 style={{ marginTop: 0 }}>Edit episode</h2>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ ...episode.meta, title, summary, updatedAt: new Date().toISOString() });
        }}
      >
        <label htmlFor="ep-title">Title</label>
        <input
          id="ep-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <label htmlFor="ep-summary">Summary</label>
        <textarea
          id="ep-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          required
        />
        <p className="row">
          <button className="primary" type="submit">
            Save
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </p>
        <p className="muted small">
          Note: a re-send from the newsletter system overwrites title and summary with its own
          values.
        </p>
      </form>
    </dialog>
  );
}

function SeriesForm({
  initial,
  sha,
  onSaved,
}: {
  initial: SeriesConfig;
  sha?: string;
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<SeriesConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof SeriesConfig, value: unknown) =>
    setConfig((c) => ({ ...c, [key]: value === "" ? undefined : value }));

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await saveSeries(config, sha);
          onSaved();
        } catch (err) {
          setError(errText(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 style={{ marginTop: 0 }}>Series settings</h2>
      {SERIES_FIELDS.map((f) =>
        f.kind === "textarea" ? (
          <div key={f.key}>
            <label htmlFor={`sf-${f.key}`}>{f.label}</label>
            <textarea
              id={`sf-${f.key}`}
              value={(config[f.key] as string) ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              required={f.required}
            />
          </div>
        ) : (
          <div key={f.key}>
            <label htmlFor={`sf-${f.key}`}>{f.label}</label>
            <input
              id={`sf-${f.key}`}
              type={f.kind}
              value={(config[f.key] as string) ?? ""}
              onChange={(e) => set(f.key, e.target.value)}
              required={f.required}
            />
          </div>
        ),
      )}
      <h2>Distribution (subscribe links appear on the series page once set)</h2>
      {(["apple", "spotify", "amazon", "podcastIndex"] as const).map((dir) => (
        <div key={dir}>
          <label htmlFor={`sf-dir-${dir}`}>
            {dir === "podcastIndex" ? "Podcast Index" : dir[0]?.toUpperCase() + dir.slice(1)} URL
          </label>
          <input
            id={`sf-dir-${dir}`}
            type="url"
            value={config.directories?.[dir] ?? ""}
            onChange={(e) =>
              setConfig((c) => {
                const directories = { ...c.directories, [dir]: e.target.value || undefined };
                if (!e.target.value) delete directories[dir];
                return {
                  ...c,
                  directories: Object.keys(directories).length ? directories : undefined,
                };
              })
            }
            placeholder={
              dir === "apple"
                ? "https://podcasts.apple.com/…"
                : dir === "spotify"
                  ? "https://open.spotify.com/show/…"
                  : ""
            }
          />
        </div>
      ))}
      <div className="row" style={{ marginTop: "0.8rem" }}>
        <label className="row" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={config.explicit}
            onChange={(e) => set("explicit", e.target.checked)}
          />{" "}
          Explicit
        </label>
        <label className="row" style={{ margin: 0 }}>
          Status:{" "}
          <select
            value={config.status}
            onChange={(e) => set("status", e.target.value as SeriesConfig["status"])}
          >
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
        </label>
      </div>
      {error && <div className="error small">{error}</div>}
      <p>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : sha ? "Save series" : "Create series"}
        </button>
      </p>
    </form>
  );
}

// ---------- new series ----------

export function NewSeries() {
  const [id, setId] = useState("");
  const [artwork, setArtwork] = useState<{ b64: string; px: number } | null>(null);
  const [artError, setArtError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const idValid = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(id) && id !== "admin";

  const onArtwork = (file: File) => {
    setArtError(null);
    if (file.type !== "image/jpeg") {
      setArtError("Cover must be a JPEG (.jpg).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        if (img.width !== img.height) {
          setArtError(`Cover must be square (got ${img.width}×${img.height}).`);
        } else if (img.width < 1400 || img.width > 3000) {
          setArtError(`Cover must be 1400–3000 px square (got ${img.width}px).`);
        } else {
          setArtwork({ b64: dataUrl.split(",")[1] as string, px: img.width });
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const blank: SeriesConfig = {
    id,
    title: "",
    description: "",
    author: "",
    ownerName: "",
    ownerEmail: "",
    language: "en-us",
    category: "Technology",
    explicit: false,
    status: "active",
  };

  if (created) {
    return (
      <div>
        <h1>Series created</h1>
        <p className="notice">
          Series <strong>{id}</strong> is committed and the site is rebuilding. Point the newsletter
          system at <code>series_id: "{id}"</code>. <a href={`#/series/${id}`}>Open it →</a>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>New series</h1>
      <div className="card stack">
        <label htmlFor="ns-id">Series ID (permanent, lowercase, becomes the URL)</label>
        <input
          id="ns-id"
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="my-newsletter"
        />
        {id && !idValid && (
          <p className="error small">
            2–64 chars, a–z 0–9 and hyphens, no leading/trailing hyphen.
          </p>
        )}
        <label htmlFor="ns-art">Cover art (JPEG, square, 1400–3000 px)</label>
        <input
          id="ns-art"
          type="file"
          accept="image/jpeg"
          onChange={(e) => e.target.files?.[0] && onArtwork(e.target.files[0])}
        />
        {artError && <p className="error small">{artError}</p>}
        {artwork && <p className="small muted">✓ Cover accepted ({artwork.px}px square)</p>}
      </div>
      {idValid && artwork && (
        <NewSeriesForm
          id={id}
          artworkB64={artwork.b64}
          blank={blank}
          onDone={() => setCreated(true)}
        />
      )}
    </div>
  );
}

function NewSeriesForm({
  id,
  artworkB64,
  blank,
  onDone,
}: {
  id: string;
  artworkB64: string;
  blank: SeriesConfig;
  onDone: () => void;
}) {
  return (
    <SeriesFormCreate
      blank={{ ...blank, id }}
      onCreate={async (config) => {
        const site = JSON.parse((await getFile("site.config.json")).text) as {
          baseUrl: string;
        };
        config.podcastGuid = await mintPodcastGuid(`${site.baseUrl}/${id}/feed.xml`);
        await putFile(
          `content/series/${id}/artwork/cover.jpg`,
          artworkB64,
          `add cover art for ${id}`,
        );
        await saveSeries(config);
        onDone();
      }}
    />
  );
}

function SeriesFormCreate({
  blank,
  onCreate,
}: {
  blank: SeriesConfig;
  onCreate: (c: SeriesConfig) => Promise<void>;
}) {
  const [config, setConfig] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setConfig(blank), [blank.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await onCreate(config);
        } catch (err) {
          setError(errText(err));
          setBusy(false);
        }
      }}
    >
      {SERIES_FIELDS.map((f) =>
        f.kind === "textarea" ? (
          <div key={f.key}>
            <label htmlFor={`nc-${f.key}`}>{f.label}</label>
            <textarea
              id={`nc-${f.key}`}
              value={(config[f.key] as string) ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
              required={f.required}
            />
          </div>
        ) : (
          <div key={f.key}>
            <label htmlFor={`nc-${f.key}`}>{f.label}</label>
            <input
              id={`nc-${f.key}`}
              type={f.kind}
              value={(config[f.key] as string) ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
              required={f.required}
            />
          </div>
        ),
      )}
      {error && <div className="error small">{error}</div>}
      <p>
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create series"}
        </button>
      </p>
    </form>
  );
}

// ---------- analytics ----------

interface CfDay {
  requests: number;
  cachedRequests: number;
  bytes: number;
}
interface CfFile {
  updatedAt: string;
  days: Record<string, Record<string, CfDay>>;
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} kB`;
}

export function Analytics() {
  const cf = useLoad(
    useCallback(async () => {
      try {
        return JSON.parse((await getFile("content/analytics/cloudflare.json")).text) as CfFile;
      } catch (e) {
        if (e instanceof GhError && e.status === 404) return null;
        throw e;
      }
    }, []),
  );

  if (cf.loading) return <p className="muted">Loading analytics…</p>;
  if (cf.error) return <div className="error">{cf.error}</div>;
  if (!cf.data) {
    return (
      <div>
        <h1>Analytics</h1>
        <p className="notice">
          No data collected yet. The collector runs daily at 06:20 UTC (or trigger the "Collect
          analytics" workflow manually in GitHub Actions). Cloudflare cache metrics appear per
          episode; OP3 download stats appear once an <code>OP3_API_TOKEN</code> secret is configured
          and the show has real downloads.
        </p>
      </div>
    );
  }

  const perEpisode = new Map<string, CfDay>();
  const days = Object.keys(cf.data.days).sort().reverse();
  for (const day of days) {
    for (const [key, v] of Object.entries(cf.data.days[day] ?? {})) {
      const agg = perEpisode.get(key) ?? { requests: 0, cachedRequests: 0, bytes: 0 };
      agg.requests += v.requests;
      agg.cachedRequests += v.cachedRequests;
      agg.bytes += v.bytes;
      perEpisode.set(key, agg);
    }
  }
  const rows = [...perEpisode.entries()].sort((a, b) => b[1].requests - a[1].requests);

  return (
    <div>
      <h1>Analytics</h1>
      <p className="muted small">
        Cloudflare edge metrics for episode assets (all requests, including bots and feed probes —
        for listener downloads, OP3 is the truthful number). Last collected:{" "}
        {new Date(cf.data.updatedAt).toLocaleString()}.
      </p>

      <h2>Per episode (all collected days)</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Episode</th>
              <th>Requests</th>
              <th>Cache hit</th>
              <th>Bandwidth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, v]) => (
              <tr key={key}>
                <td>
                  <code className="small">{key}</code>
                </td>
                <td>{v.requests}</td>
                <td>
                  {v.requests ? `${Math.round((v.cachedRequests / v.requests) * 100)}%` : "—"}
                </td>
                <td>{fmtBytes(v.bytes)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No episode traffic in the collected window yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>By day</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Requests</th>
              <th>Cache hit</th>
              <th>Bandwidth</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const entries = Object.values(cf.data?.days[day] ?? {});
              const req = entries.reduce((s, v) => s + v.requests, 0);
              const hit = entries.reduce((s, v) => s + v.cachedRequests, 0);
              const bytes = entries.reduce((s, v) => s + v.bytes, 0);
              return (
                <tr key={day}>
                  <td>{day}</td>
                  <td>{req}</td>
                  <td>{req ? `${Math.round((hit / req) * 100)}%` : "—"}</td>
                  <td>{fmtBytes(bytes)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- settings ----------

export function Settings() {
  const file = useLoad(useCallback(() => getFile("site.config.json"), []));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ baseUrl: string; siteTitle: string; op3: boolean } | null>(
    null,
  );

  useEffect(() => {
    if (file.data && !form) setForm(JSON.parse(file.data.text));
  }, [file.data, form]);

  if (file.error) return <div className="error">{file.error}</div>;
  if (!form) return <p className="muted">Loading settings…</p>;

  return (
    <div>
      <h1>Settings</h1>
      <CommitNotice show={saved} />
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await putFile(
              "site.config.json",
              encodeB64(`${JSON.stringify(form, null, 2)}\n`),
              "update site settings",
              file.data?.sha,
            );
            setSaved(true);
          } catch (err) {
            setError(errText(err));
          }
        }}
      >
        <label htmlFor="st-title">Site title</label>
        <input
          id="st-title"
          type="text"
          value={form.siteTitle}
          onChange={(e) => setForm({ ...form, siteTitle: e.target.value })}
          required
        />
        <label htmlFor="st-base">Base URL (changing this changes ALL feed URLs — see PRD)</label>
        <input
          id="st-base"
          type="url"
          value={form.baseUrl}
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          required
        />
        <label className="row" style={{ marginTop: "0.8rem" }}>
          <input
            type="checkbox"
            checked={form.op3}
            onChange={(e) => setForm({ ...form, op3: e.target.checked })}
          />{" "}
          OP3 download analytics (prefix on audio URLs)
        </label>
        {error && <div className="error small">{error}</div>}
        <p>
          <button className="primary" type="submit">
            Save settings
          </button>
        </p>
      </form>
    </div>
  );
}
