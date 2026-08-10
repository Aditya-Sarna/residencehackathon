import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import App from "./App";
import ResidenceWeb from "./ResidenceWeb";

type Surface = "mac" | "browser";

const VIDEO_SRC = "/video/residence.mp4";
const PARAMS = new URLSearchParams(window.location.search);
/** Judge / smart: keep the phone demo shell for submission replay. */
const FORCE_PHONE = PARAMS.has("judge") || PARAMS.has("smart");
/** Skip film and open the browser Residence product. */
const FORCE_WEB =
  PARAMS.has("app") ||
  PARAMS.has("web") ||
  ["integrations", "capture", "accept"].includes(PARAMS.get("page") || "");

function initialSurface(): Surface {
  const t = PARAMS.get("tab");
  if (t === "browser" || t === "demo" || t === "illustration") return "browser";
  return "mac";
}

export default function Landing() {
  const [introDone, setIntroDone] = useState(FORCE_PHONE || FORCE_WEB);
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [enterHome, setEnterHome] = useState(FORCE_WEB);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [videoMuted, setVideoMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const downloadUrl = useMemo(() => {
    const host = window.location.hostname;
    const local = host === "localhost" || host === "127.0.0.1";
    if (local) return `${window.location.origin}/mac/Residence-mac.zip`;
    return (
      import.meta.env.VITE_MAC_ZIP_URL ||
      "https://github.com/Aditya-Sarna/residencehackathon/releases/download/mac-v1.0.0/Residence-mac.zip"
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(downloadUrl, {
      width: 360,
      margin: 2,
      color: { dark: "#0A0A0A", light: "#FFFFFF" },
      errorCorrectionLevel: "M",
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [downloadUrl]);

  useEffect(() => {
    if (introDone || FORCE_PHONE || FORCE_WEB) return;
    const el = videoRef.current;
    if (!el) return;
    el.defaultMuted = true;
    el.muted = true;
    el.playsInline = true;
    el.setAttribute("playsinline", "true");
    el.setAttribute("webkit-playsinline", "true");
    const tryPlay = () => {
      void el.play()?.catch(() => {});
    };
    tryPlay();
    el.addEventListener("loadeddata", tryPlay);
    el.addEventListener("canplay", tryPlay);
    return () => {
      el.removeEventListener("loadeddata", tryPlay);
      el.removeEventListener("canplay", tryPlay);
    };
  }, [introDone]);

  useEffect(() => {
    if (FORCE_PHONE || FORCE_WEB || !introDone || enterHome) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", surface);
    window.history.replaceState({}, "", url.toString());
  }, [surface, introDone, enterHome]);

  const enableVideoSound = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1;
    setVideoMuted(false);
    void el.play().catch(() => {});
  };

  const pickSurface = (next: Surface) => {
    setSurface(next);
    if (next === "browser") setEnterHome(true);
  };

  if (FORCE_PHONE) {
    return <App skipVideo />;
  }

  if (enterHome || FORCE_WEB) {
    return <ResidenceWeb />;
  }

  if (!introDone) {
    return (
      <div className="rw-root video-stage">
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          autoPlay
          muted
          playsInline
          preload="auto"
          controls={false}
          onEnded={() => setIntroDone(true)}
          onError={() => setIntroDone(true)}
        />
        {videoMuted && (
          <button className="rw-btn ghost video-sound" type="button" onClick={enableVideoSound}>
            Enable sound
          </button>
        )}
        <button
          className="rw-btn solid video-skip"
          type="button"
          onClick={() => setIntroDone(true)}
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="rw-root gate home-gate">
      <header className="rw-nav gate-nav-center">
        <div className="rw-brand">
          <span className="rw-logo">Residence</span>
        </div>
      </header>

      <div className="gate-hero">
        <div
          className="glass-toggle"
          role="tablist"
          aria-label="Residence surface"
        >
          <button
            type="button"
            role="tab"
            aria-selected={surface === "mac"}
            className={surface === "mac" ? "on" : ""}
            onClick={() => pickSurface("mac")}
          >
            Residence on desktop (Mac)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={surface === "browser"}
            className={surface === "browser" ? "on" : ""}
            onClick={() => pickSurface("browser")}
          >
            Residence on browser
          </button>
        </div>
      </div>

      {surface === "mac" && (
        <main className="rw-main gate-download">
          <div className="gate-copy">
            <p className="rw-crumb">RESIDENCE / MAC</p>
            <h1 className="rw-h1">On your Mac</h1>
            <p className="rw-lead">
              Scan the QR, unzip, open. Menu-bar agent for a shared Fact graph — capture,
              Accept, write back.
            </p>
            <a className="rw-btn solid gate-download-btn" href={downloadUrl} download>
              Download Residence-mac.zip
            </a>
            <ol className="gate-steps">
              <li>Unzip → open <code>Residence.app</code> (menu-bar agent)</li>
              <li>If blocked: Privacy &amp; Security → Open Anyway</li>
              <li>⌘⇧R capture · ⌘⇧A accept · ⌘⇧I inbox · Core :8700</li>
            </ol>
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
        </main>
      )}
    </div>
  );
}
