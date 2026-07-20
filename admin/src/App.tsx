import { type ReactElement, useEffect, useState } from "react";
import { getToken, setToken, whoami } from "./github";
import { Analytics, Dashboard, Login, NewSeries, SeriesView, Settings } from "./views";

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(Boolean(getToken()));

  useEffect(() => {
    if (getToken()) {
      whoami()
        .then(setUser)
        .catch(() => setToken(null))
        .finally(() => setChecking(false));
    }
  }, []);

  if (checking) return <div className="wrap muted">Checking access…</div>;
  if (!user) {
    return (
      <Login
        onLogin={async () => {
          setUser(await whoami());
        }}
      />
    );
  }

  const seriesMatch = /^#\/series\/([a-z0-9-]+)$/.exec(route);
  let view: ReactElement;
  if (seriesMatch) view = <SeriesView key={seriesMatch[1]} seriesId={seriesMatch[1] as string} />;
  else if (route === "#/new-series") view = <NewSeries />;
  else if (route === "#/analytics") view = <Analytics />;
  else if (route === "#/settings") view = <Settings />;
  else view = <Dashboard />;

  const navLink = (href: string, label: string, active: boolean) => (
    <a href={href} className={active ? "active" : ""}>
      {label}
    </a>
  );

  return (
    <div className="wrap">
      <nav className="top">
        <span className="brand">🎙 Podcast Admin</span>
        {navLink("#/", "Dashboard", route === "#/" || route.startsWith("#/series/"))}
        {navLink("#/new-series", "New series", route === "#/new-series")}
        {navLink("#/analytics", "Analytics", route === "#/analytics")}
        {navLink("#/settings", "Settings", route === "#/settings")}
        <span className="spacer" />
        <span className="user">{user}</span>
        <button
          type="button"
          onClick={() => {
            setToken(null);
            setUser(null);
          }}
        >
          Log out
        </button>
      </nav>
      {view}
    </div>
  );
}
