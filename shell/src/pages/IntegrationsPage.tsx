import { useState } from "react";
import { IntegrationIcon } from "../browser/IntegrationIcon";
import {
  ALL_GOOGLE_SCOPES,
  INTEGRATIONS,
  type IntegrationId,
  type IntegrationState,
} from "../browser/integrationsCatalog";
import {
  connectGoogle,
  disconnectGoogle,
  googleAccountEmail,
  googleConfigured,
  googleIsConnected,
} from "../browser/googleAuth";
import {
  beginSpotifyConnect,
  disconnectSpotify,
  spotifyConfigured,
  spotifyIsConnected,
} from "../browser/spotifyAuth";

type Props = {
  connected: IntegrationState;
  onToggle: (id: IntegrationId, on: boolean) => void;
  coreOk: boolean;
  datahubOk: boolean;
  onCapture: () => void;
};

export default function IntegrationsPage({
  connected,
  onToggle,
  coreOk,
  datahubOk,
  onCapture,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [authMsg, setAuthMsg] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const handleConnectGoogle = async (id: string) => {
    setBusyId(id);
    setAuthMsg((m) => ({ ...m, [id]: "" }));
    try {
      const token = await connectGoogle(ALL_GOOGLE_SCOPES);
      setAuthMsg((m) => ({
        ...m,
        [id]: token.email ? `Connected as ${token.email}` : "Connected to Google",
      }));
    } catch (e) {
      setAuthMsg((m) => ({ ...m, [id]: String((e as Error).message || e) }));
    } finally {
      setBusyId(null);
      bump();
    }
  };

  const handleDisconnectGoogle = () => {
    disconnectGoogle();
    setAuthMsg({});
    bump();
  };

  const handleConnectSpotify = async (id: string) => {
    setBusyId(id);
    try {
      await beginSpotifyConnect();
    } catch (e) {
      setAuthMsg((m) => ({ ...m, [id]: String((e as Error).message || e) }));
      setBusyId(null);
    }
  };

  const handleDisconnectSpotify = () => {
    disconnectSpotify();
    bump();
  };

  return (
    <div className="rw-page">
      <p className="rw-crumb">RESIDENCE / INTEGRATIONS</p>
      <h1 className="rw-h1">Ten apps, one memory.</h1>
      <p className="rw-lead">
        Residence connects to the apps you already live in, reads what you capture, understands it,
        and writes the next step back to the right place — through your shared Fact graph on DataHub.
      </p>

      <div className="rw-steps">
        <div className="rw-step">
          <span>1</span>
          <div>
            <strong>CONNECT</strong>
            <p>Flip on the apps you live in. Claude stays on — it does the reading.</p>
          </div>
        </div>
        <div className="rw-step">
          <span>2</span>
          <div>
            <strong>CAPTURE</strong>
            <p>Type it, paste it, or grab the screen. One capture, any app, any genre.</p>
          </div>
        </div>
        <div className="rw-step">
          <span>3</span>
          <div>
            <strong>ACCEPT</strong>
            <p>Residence proposes the next step. You Accept — it writes back.</p>
          </div>
        </div>
      </div>

      <p className="rw-graph-status">
        Fact Broker {coreOk ? "online" : "offline"}
        {" · "}
        DataHub {datahubOk ? "connected" : "unreachable"}
      </p>

      <div className="rw-grid">
        {INTEGRATIONS.map((app) => {
          const on = !!connected[app.id];
          const isGoogle = app.authKind === "google";
          const isSpotify = app.authKind === "spotify";
          const googleReady = isGoogle && googleIsConnected(app.googleScopes || []);
          const spotifyReady = isSpotify && spotifyIsConnected();
          const needsSetup = (isGoogle && !googleConfigured()) || (isSpotify && !spotifyConfigured());
          const alwaysLive = app.authKind === "public" || app.authKind === "paste" || app.authKind === "core";
          const isLive = alwaysLive || googleReady || spotifyReady;

          let statusText = "LIVE · NO SIGN-IN";
          if (app.authKind === "core") statusText = "ALWAYS ON";
          else if (app.authKind === "paste") statusText = "PASTE-BASED · LIVE";
          else if (isGoogle) {
            statusText = needsSetup
              ? "NEEDS SETUP"
              : googleReady
                ? `CONNECTED${googleAccountEmail() ? ` · ${googleAccountEmail()}` : ""}`
                : "NOT CONNECTED";
          } else if (isSpotify) {
            statusText = needsSetup ? "NEEDS SETUP" : spotifyReady ? "CONNECTED" : "NOT CONNECTED";
          }

          return (
            <article key={app.id} className={`rw-card ${on ? "is-on" : ""}`}>
              <header className="rw-card-top">
                <IntegrationIcon icon={app.icon} />
                <label className="rw-switch">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!!app.core}
                    onChange={(e) => onToggle(app.id, e.target.checked)}
                  />
                  <span />
                </label>
              </header>
              <h2>
                {app.name}
                {app.core ? <em className="rw-core">CORE</em> : null}
              </h2>
              <p className="rw-platform">{app.platform}</p>
              <p className="rw-blurb">{app.blurb}</p>

              {(isGoogle || isSpotify) && (
                <div className="rw-auth-row">
                  {needsSetup ? (
                    <span className="rw-needs-setup">
                      Needs setup — see {isGoogle ? "shell/GOOGLE_SETUP.md" : "shell/SPOTIFY_SETUP.md"}
                    </span>
                  ) : googleReady || spotifyReady ? (
                    <button
                      type="button"
                      className="rw-text-btn"
                      onClick={isGoogle ? handleDisconnectGoogle : handleDisconnectSpotify}
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rw-btn ghost rw-connect-btn"
                      disabled={busyId === app.id}
                      onClick={() =>
                        void (isGoogle ? handleConnectGoogle(app.id) : handleConnectSpotify(app.id))
                      }
                    >
                      {busyId === app.id ? "Connecting…" : `Connect ${isGoogle ? "Google" : "Spotify"}`}
                    </button>
                  )}
                </div>
              )}
              {authMsg[app.id] ? <p className="rw-auth-msg">{authMsg[app.id]}</p> : null}

              <footer>
                <i className={isLive ? "on" : ""} />
                {statusText}
              </footer>
            </article>
          );
        })}
      </div>

      <div className="rw-footer-actions">
        <button type="button" className="rw-btn solid" onClick={onCapture}>
          Make your first capture →
        </button>
      </div>
    </div>
  );
}
