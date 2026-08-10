/** Browser speech recognition — mic permission first, then lasting transcript. */

export type SpeechHandlers = {
  onPartial?: (text: string) => void;
  onFinalChunk?: (text: string) => void;
  onListeningChange?: (listening: boolean) => void;
  onError?: (message: string) => void;
};

type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function getCtor(): (new () => Rec) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Rec;
    webkitSpeechRecognition?: new () => Rec;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechSupported(): boolean {
  return Boolean(getCtor()) && !!navigator.mediaDevices?.getUserMedia;
}

function friendlyError(code: string): string {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Microphone blocked. Allow mic for this site in the browser address bar, then try again.";
  }
  if (code === "network") {
    return "Speech service unreachable. Check network, or type in the transcript box.";
  }
  if (code === "audio-capture") {
    return "No microphone found. Plug one in or type instead.";
  }
  if (code === "no-speech") {
    return "Didn’t catch that — tap the mic and speak again.";
  }
  return `Speech error: ${code}`;
}

/**
 * Ask for mic access (required on Safari / Chrome before recognition works),
 * then run continuous recognition. Transcript updates stay until the user stops.
 */
export async function createSpeechSession(handlers: SpeechHandlers) {
  const Ctor = getCtor();
  if (!Ctor) {
    handlers.onError?.("Speech isn’t available in this browser. Type instead.");
    return null;
  }
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    handlers.onError?.("Microphone needs HTTPS (or localhost).");
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Keep the track briefly so permission sticks, then release — recognition opens its own path.
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    handlers.onError?.(
      "Microphone permission denied. Click the lock icon in the address bar → allow Microphone."
    );
    return null;
  }

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US";

  let finalBuf = "";
  let wantListen = false;

  rec.onstart = () => {
    handlers.onListeningChange?.(true);
  };

  rec.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const piece = ev.results[i][0]?.transcript || "";
      if (ev.results[i].isFinal) {
        finalBuf = `${finalBuf} ${piece}`.replace(/\s+/g, " ").trim();
        handlers.onFinalChunk?.(finalBuf);
      } else {
        interim += piece;
      }
    }
    const live = [finalBuf, interim].filter(Boolean).join(" ").trim();
    if (live) handlers.onPartial?.(live);
  };

  rec.onerror = (ev) => {
    const code = ev.error || "error";
    if (code === "aborted") return;
    if (code === "no-speech" && wantListen) return;
    handlers.onError?.(friendlyError(code));
    if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
      wantListen = false;
      handlers.onListeningChange?.(false);
    }
  };

  rec.onend = () => {
    if (wantListen) {
      // Chrome ends sessions periodically — restart while user still wants mic on.
      window.setTimeout(() => {
        if (!wantListen) return;
        try {
          rec.start();
        } catch {
          wantListen = false;
          handlers.onListeningChange?.(false);
        }
      }, 120);
      return;
    }
    handlers.onListeningChange?.(false);
  };

  return {
    start: () => {
      wantListen = true;
      try {
        rec.start();
      } catch {
        try {
          rec.stop();
        } catch {
          /* */
        }
        window.setTimeout(() => {
          try {
            rec.start();
          } catch (e) {
            wantListen = false;
            handlers.onError?.(String((e as Error).message || e));
            handlers.onListeningChange?.(false);
          }
        }, 200);
      }
    },
    stop: () => {
      wantListen = false;
      try {
        rec.stop();
      } catch {
        /* */
      }
      try {
        rec.abort?.();
      } catch {
        /* */
      }
      handlers.onListeningChange?.(false);
    },
    getTranscript: () => finalBuf.trim(),
    reset: () => {
      finalBuf = "";
    },
  };
}
