import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import App from "./App";

type Tab = "mac" | "illustration";

const VIDEO_SRC = "/video/residence.mp4";
const PARAMS = new URLSearchParams(window.location.search);
/** Judge / smart / explicit demo: skip film + gate chrome, open phone shell. */
const FORCE_SHELL = PARAMS.has("judge") || PARAMS.has("smart");

function initialTab(): Tab {
  const t = PARAMS.get("tab");
  if (t === "demo" || t === "illustration") return "illustration";
  return "mac";
}

export default function Landing() {
  const [introDone, setIntroDone] = useState(FORCE_SHELL);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [enterHome, setEnterHome] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [videoMuted, setVideoMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const downloadUrl = useMemo(
    () => `${window.location.origin}/mac/Residence-mac.zip`,
    []
  );

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(downloadUrl, {
      width: 360,
      margin: 2,
      color: { dark: "#0C0C0C", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [downloadUrl]);

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
    url.searchParams.set("tab", tab === "illustration" ? "illustration" : "mac");
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

  if (FORCE_SHELL || enterHome) {
    return <App skipVideo />;
  }

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

  return (
    <div className="gate home-gate">
      <header className="gate-top">
        <p className="gate-brand" aria-label="Home">
          Home
        </p>
        <nav className="gate-tabs" aria-label="Home">
          <button
            type="button"
            className={tab === "mac" ? "on" : ""}
            onClick={() => setTab("mac")}
          >
            Residence on Mac
          </button>
          <button
            type="button"
            className={tab === "illustration" ? "on" : ""}
            onClick={() => setTab("illustration")}
          >
            Conceptual illustration
          </button>
        </nav>
      </header>

      {tab === "mac" && (
        <section className="gate-download">
          <div className="gate-copy">
            <p className="gate-kicker">Residence / Home</p>
            <h1>On your Mac</h1>
            <p>
              Scan the QR, unzip, open. Menu-bar Home for a shared personal Fact graph —
              capture, Accept, write back.
            </p>
            <a className="gate-link" href={downloadUrl} download>
              Download Residence-mac.zip
            </a>
            <ol className="gate-steps">
              <li>Unzip → open <code>Residence.app</code></li>
              <li>If blocked: Privacy &amp; Security → Open Anyway</li>
              <li>Core on :8700 · ⌘⇧R capture · ⌘⇧I inbox</li>
            </ol>
            <p className="gate-note">
              Apple Silicon · unsigned build · Open Anyway if prompted
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

      {tab === "illustration" && (
        <section className="gate-illustration">
          <div className="gate-illu-copy">
            <p className="gate-script">Residence / Home</p>
            <p className="gate-illu-line">
              One shared personal context graph — so your apps stop lying to each other.
            </p>
            <button
              type="button"
              className="gate-link"
              onClick={() => setEnterHome(true)}
            >
              Enter Home
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
