import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import App from "./App";

type Tab = "download" | "demo";

const VIDEO_SRC = "/video/residence.mp4";
const PARAMS = new URLSearchParams(window.location.search);
/** Judge / smart / explicit demo: skip film + gate chrome, open phone shell. */
const FORCE_SHELL = PARAMS.has("judge") || PARAMS.has("smart");

function initialTab(): Tab {
  const t = PARAMS.get("tab");
  return t === "demo" ? "demo" : "download";
}

export default function Landing() {
  const [introDone, setIntroDone] = useState(FORCE_SHELL);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [videoMuted, setVideoMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const downloadUrl = useMemo(() => {
    // Bundled copy for reliability; Release URL is documented in README for GitHub.
    return `${window.location.origin}/mac/Residence-mac.zip`;
  }, []);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(downloadUrl, {
      width: 360,
      margin: 2,
      color: { dark: "#0c0c0c", light: "#f3efe6" },
      errorCorrectionLevel: "M",
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [downloadUrl]);

  // Autoplay film muted (browsers block sound until a gesture)
  useEffect(() => {
    if (introDone || FORCE_SHELL) return;
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    el.playsInline = true;
    void el.play()?.catch(() => {});
  }, [introDone]);

  useEffect(() => {
    if (FORCE_SHELL || !introDone) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
  }, [tab, introDone]);

  const enableVideoSound = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1;
    setVideoMuted(false);
    void el.play().catch(() => {});
  };

  // Direct shell for judges
  if (FORCE_SHELL) {
    return <App skipVideo />;
  }

  // Default entry: hero film
  if (!introDone) {
    return (
      <div className="video-stage">
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          autoPlay
          muted
          playsInline
          preload="auto"
          controls={false}
          onEnded={() => setIntroDone(true)}
        />
        {videoMuted && (
          <button className="video-sound" type="button" onClick={enableVideoSound}>
            Enable sound
          </button>
        )}
        <button className="video-skip" type="button" onClick={() => setIntroDone(true)}>
          Continue
        </button>
      </div>
    );
  }

  // Central page: QR download · mobile demo
  return (
    <div className="gate">
      <header className="gate-top">
        <p className="gate-brand">RESIDENCE</p>
        <nav className="gate-tabs" aria-label="Residence">
          <button
            type="button"
            className={tab === "download" ? "on" : ""}
            onClick={() => setTab("download")}
          >
            Download
          </button>
          <button
            type="button"
            className={tab === "demo" ? "on" : ""}
            onClick={() => setTab("demo")}
          >
            App demo
          </button>
        </nav>
      </header>

      {tab === "download" && (
        <section className="gate-download">
          <div className="gate-copy">
            <h1>Get Residence for Mac</h1>
            <p>Scan the QR, unzip, open. Menu-bar agent for a shared personal Fact graph.</p>
            <a className="gate-link" href={downloadUrl} download>
              Download Residence-mac.zip
            </a>
            <p className="gate-note">
              Apple Silicon · unsigned build · System Settings → Privacy &amp; Security → Open Anyway
              if prompted. Core on :8700.
            </p>
          </div>
          <div className="gate-qr">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR code to download Residence for Mac"
                width={360}
                height={360}
              />
            ) : (
              <div className="gate-qr-wait">Generating QR…</div>
            )}
            <span>Scan on your Mac</span>
          </div>
        </section>
      )}

      {tab === "demo" && (
        <div className="gate-demo">
          <App skipVideo />
        </div>
      )}
    </div>
  );
}
