import { useEffect, useRef, useState } from "react";
import { api, type DesktopPermission } from "../api";
import { sourceFromLink, type IntegrationState } from "../browser/integrationsCatalog";
import { googleAccessToken } from "../browser/googleAuth";
import { listRecentGmail, type GmailThreadPreview } from "../browser/googleApi";

type Props = {
  connected: IntegrationState;
  onCaptured: (result: { operationId: string; queued: DesktopPermission[] }) => void;
};

type Mode = "type" | "screen";

export default function CapturePage({ connected, onCaptured }: Props) {
  const [mode, setMode] = useState<Mode>("type");
  const [transcript, setTranscript] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");
  const [screenNote, setScreenNote] = useState("");
  const [screenActive, setScreenActive] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [gmailThreads, setGmailThreads] = useState<GmailThreadPreview[] | null>(null);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailErr, setGmailErr] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopScreen = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScreenActive(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const startScreen = async () => {
    setErr("");
    setMode("screen");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      setScreenActive(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScreenNote("Screen shared — type or paste what matters below, then capture.");
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        setScreenActive(false);
        setScreenNote("Screen share ended.");
      });
    } catch {
      setErr("Screen capture cancelled or blocked by the browser.");
      setScreenActive(false);
    }
  };

  const capture = async () => {
    const text = [
      transcript.trim(),
      link.trim(),
      screenNote && mode === "screen" ? `(screen) ${screenNote}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (!transcript.trim()) {
      setErr("Type or paste what you want to capture first.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const source = sourceFromLink(link, connected);
      const res = await api.desktopCapture({
        text,
        source,
        capture_method: mode === "screen" ? "screen" : "text",
        consent_mode: "explicit",
      });
      const queued = res.queued || [];
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 900);
      setStatus(
        queued.length
          ? `Captured · ${queued.length} step${queued.length === 1 ? "" : "s"} ready to Accept.`
          : "Captured to the Fact graph."
      );
      setTranscript("");
      setLink("");
      onCaptured({ operationId: res.operationId, queued });
    } catch (e) {
      setErr(String((e as Error).message || e));
      setStatus("Core offline — start Core on :8700, then capture again.");
    } finally {
      setBusy(false);
    }
  };

  const pullGmail = async () => {
    setGmailErr("");
    setGmailLoading(true);
    try {
      const token = googleAccessToken(["gmail"]);
      if (!token) {
        setGmailErr("Connect Google (Gmail) in Integrations first.");
        return;
      }
      const threads = await listRecentGmail(token, 6);
      setGmailThreads(threads);
    } catch (e) {
      setGmailErr(String((e as Error).message || e));
    } finally {
      setGmailLoading(false);
    }
  };

  const useGmailThread = (t: GmailThreadPreview) => {
    setTranscript(`${t.subject}\nFrom: ${t.from}\n\n${t.snippet}`);
    setLink(t.link);
    setGmailThreads(null);
  };

  const clearAll = () => {
    setTranscript("");
    setLink("");
    setErr("");
    setStatus("");
    setScreenNote("");
    stopScreen();
  };

  return (
    <div className="rw-page">
      <p className="rw-crumb">RESIDENCE / CAPTURE</p>
      <h1 className="rw-h1">One capture, any app.</h1>
      <p className="rw-lead">
        Paste a chat, an email, a note — or share your screen for context. Residence turns it
        into a clean capture with the next step already figured out, then hands it to Accept.
      </p>

      {savedFlash && (
        <div className="rw-saved-flash" role="status" aria-live="polite">
          <span className="rw-saved-check">✓</span>
          <span>Saved to Fact Broker</span>
        </div>
      )}

      <div className="rw-capture">
        <div className="rw-capture-tabs">
          <button type="button" className={mode === "type" ? "on" : ""} onClick={() => setMode("type")}>
            Type / paste
          </button>
          <button
            type="button"
            className={mode === "screen" ? "on" : ""}
            onClick={() => void startScreen()}
          >
            Screen capture
          </button>
        </div>

        {mode === "screen" && (
          <div className="rw-screen-pad">
            <video ref={videoRef} className="rw-screen-video" muted playsInline />
            <p>{screenNote || "Share a window or tab, then type what matters below."}</p>
            {screenActive && (
              <button type="button" className="rw-text-btn" onClick={stopScreen}>
                Stop sharing
              </button>
            )}
          </div>
        )}

        {mode === "type" && (
          <div className="rw-gmail-pull">
            <button type="button" className="rw-text-btn" disabled={gmailLoading} onClick={() => void pullGmail()}>
              {gmailLoading ? "Reading Gmail…" : "✉ Pull from Gmail"}
            </button>
            {gmailErr ? <p className="rw-err">{gmailErr}</p> : null}
            {gmailThreads ? (
              <div className="rw-gmail-list">
                {gmailThreads.length === 0 ? (
                  <p className="rw-muted-note">Inbox looks empty.</p>
                ) : (
                  gmailThreads.map((t) => (
                    <button key={t.id} type="button" className="rw-gmail-item" onClick={() => useGmailThread(t)}>
                      <strong>{t.subject}</strong>
                      <span>{t.from}</span>
                      <em>{t.snippet}</em>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        )}

        <label className="rw-field">
          <span>Capture</span>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            rows={6}
            placeholder="Paste the WhatsApp chat, email, note — or describe what's on screen…"
          />
        </label>

        <label className="rw-field">
          <span>Source link (optional)</span>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://web.whatsapp.com/..."
          />
        </label>

        <div className="rw-capture-actions">
          <button type="button" className="rw-btn solid" disabled={busy} onClick={() => void capture()}>
            {busy ? "Capturing…" : "→ Capture with Claude"}
          </button>
          <button type="button" className="rw-text-btn" onClick={clearAll}>
            Clear
          </button>
        </div>
        {status ? <p className="rw-capture-status">{status}</p> : null}
        {err ? <p className="rw-err">{err}</p> : null}
      </div>
    </div>
  );
}
