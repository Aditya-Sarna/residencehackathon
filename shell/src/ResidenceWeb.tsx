import { useCallback, useEffect, useState } from "react";
import { api, type DesktopPermission } from "./api";
import {
  loadIntegrationState,
  saveIntegrationState,
  type IntegrationId,
  type IntegrationState,
} from "./browser/integrationsCatalog";
import { completeSpotifyRedirectIfPresent } from "./browser/spotifyAuth";
import IntegrationsPage from "./pages/IntegrationsPage";
import CapturePage from "./pages/CapturePage";
import AcceptPage from "./pages/AcceptPage";

export type WebPage = "integrations" | "capture" | "accept";
const PAGES: WebPage[] = ["integrations", "capture", "accept"];

function pageFromUrl(): WebPage {
  const t = new URLSearchParams(window.location.search).get("page");
  return (PAGES as string[]).includes(t || "") ? (t as WebPage) : "integrations";
}

export default function ResidenceWeb() {
  const [page, setPage] = useState<WebPage>(pageFromUrl);
  const [connected, setConnected] = useState<IntegrationState>(() => loadIntegrationState());
  const [coreOk, setCoreOk] = useState(false);
  const [datahubOk, setDatahubOk] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [queuedSeed, setQueuedSeed] = useState<DesktopPermission[]>([]);
  const [spotifyJustConnected, setSpotifyJustConnected] = useState(false);

  useEffect(() => {
    void completeSpotifyRedirectIfPresent().then((connected) => {
      if (connected) {
        setSpotifyJustConnected(true);
        window.setTimeout(() => setSpotifyJustConnected(false), 6000);
      }
    });
  }, []);

  const go = useCallback((next: WebPage) => {
    setPage(next);
    const url = new URL(window.location.href);
    url.searchParams.set("page", next);
    window.history.replaceState({}, "", url.toString());
  }, []);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("page");
    if (t && !(PAGES as string[]).includes(t)) go("integrations");
  }, [go]);

  const checkReady = useCallback(async () => {
    try {
      const ready = await api.ready();
      setCoreOk(!!ready.core);
      setDatahubOk(!!ready.datahub);
    } catch {
      setCoreOk(false);
      setDatahubOk(false);
    }
  }, []);

  const checkPending = useCallback(async () => {
    try {
      const res = await api.desktopPending("pending", 50);
      setPendingCount((res.pending || []).length);
    } catch {
      /* keep last known count — Core may be briefly unreachable */
    }
  }, []);

  useEffect(() => {
    void checkReady();
    void checkPending();
    const t1 = window.setInterval(() => void checkReady(), 20000);
    const t2 = window.setInterval(() => void checkPending(), 12000);
    return () => {
      window.clearInterval(t1);
      window.clearInterval(t2);
    };
  }, [checkReady, checkPending]);

  const onToggle = (id: IntegrationId, on: boolean) => {
    setConnected((prev) => {
      const next = { ...prev, [id]: on, claude: true };
      saveIntegrationState(next);
      return next;
    });
  };

  const onCaptured = (result: { operationId: string; queued: DesktopPermission[] }) => {
    if (result.queued.length) {
      setQueuedSeed((prev) => [...result.queued, ...prev]);
      setPendingCount((c) => c + result.queued.length);
    }
    go("accept");
  };

  return (
    <div className="rw-root">
      <header className="rw-nav">
        <div className="rw-brand">
          <span className="rw-logo">Residence</span>
        </div>
        <nav aria-label="Residence">
          {(
            [
              ["integrations", "Integrations"],
              ["capture", "Capture"],
              ["accept", pendingCount ? `Accept (${pendingCount})` : "Accept"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={page === id ? "on" : ""}
              onClick={() => go(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="rw-main">
        {spotifyJustConnected && (
          <div className="rw-toast-banner">Spotify connected — paste a track link and Accept to save it live.</div>
        )}
        {page === "integrations" && (
          <IntegrationsPage
            connected={connected}
            onToggle={onToggle}
            coreOk={coreOk}
            datahubOk={datahubOk}
            onCapture={() => go("capture")}
          />
        )}
        {page === "capture" && <CapturePage connected={connected} onCaptured={onCaptured} />}
        {page === "accept" && <AcceptPage seed={queuedSeed} onCountChange={setPendingCount} />}
      </main>
    </div>
  );
}
