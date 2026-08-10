/** Browser speech recognition — production path for voice → text. */

export type SpeechHandlers = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
};

type Rec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
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
  return Boolean(getCtor());
}

export function createSpeechSession(handlers: SpeechHandlers) {
  const Ctor = getCtor();
  if (!Ctor) {
    handlers.onError?.("Speech isn’t available in this browser. Type instead.");
    return null;
  }
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  let finalBuf = "";

  rec.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const piece = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalBuf += piece + " ";
      else interim += piece;
    }
    const live = (finalBuf + interim).trim();
    if (live) handlers.onPartial?.(live);
  };
  rec.onerror = (ev) => {
    if (ev.error === "aborted" || ev.error === "no-speech") return;
    handlers.onError?.(ev.error);
  };
  rec.onend = () => {
    const text = finalBuf.trim();
    if (text) handlers.onFinal?.(text);
  };

  return {
    start: () => {
      finalBuf = "";
      try {
        rec.start();
      } catch {
        /* already started */
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* */
      }
    },
    getTranscript: () => finalBuf.trim(),
  };
}
