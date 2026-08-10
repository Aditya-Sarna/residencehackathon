import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  api,
  type Activity,
  type FactResult,
  type GraphNode,
  type GraphResponse,
  type InferNotification,
} from "./api";
import { MapsApp, NotesApp, WeatherApp, YouTubeApp } from "./ConnectedApps";
import {
  IconApps,
  IconCal,
  IconClaude,
  IconHeart,
  IconHome,
  IconMaps,
  IconNotes,
  IconShop,
  IconVoice,
  IconWallet,
  IconWeather,
  IconYouTube,
} from "./icons";
import { createSpeechSession, speechSupported } from "./speech";

type AppId =
  | "home"
  | "voice"
  | "calendar"
  | "wallet"
  | "shop"
  | "wellness"
  | "claude"
  | "maps"
  | "notes"
  | "weather"
  | "youtube";
type ChatMsg = { role: "user" | "assistant"; content: string };
type HomeTab = "today" | "apps" | "graph" | "listen";
type Banner = InferNotification & { id: string };

const VIDEO_SRC = "/video/residence.mp4";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const JUDGE_PARAMS = new URLSearchParams(window.location.search);
const IS_JUDGE = JUDGE_PARAMS.has("judge");
const IS_SMART = JUDGE_PARAMS.has("smart");
const AUTO_JUDGE = IS_JUDGE && JUDGE_PARAMS.has("auto");
const AUTO_SMART = IS_SMART && JUDGE_PARAMS.has("auto");
const MONTH = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
const DAYS_IN_MONTH = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
const MONTH_START_PAD = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getDay(); // Sun=0

type CatalogItem = {
  id: string;
  title: string;
  price: number;
  tags: string[];
  tone: string;
  blurb: string;
  image: string;
};

const CATALOG: CatalogItem[] = [
  {
    id: "sh-1",
    title: "Everyday Runners",
    price: 95,
    tags: ["shoes", "runners", "gift"],
    tone: "a",
    blurb: "Light daily trainers",
    image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=480&q=80&auto=format&fit=crop",
  },
  {
    id: "sh-2",
    title: "City Loafers",
    price: 140,
    tags: ["shoes", "loafers"],
    tone: "b",
    blurb: "Office-ready leather",
    image: "https://images.unsplash.com/photo-1533867617858-e7b97e060509?w=480&q=80&auto=format&fit=crop",
  },
  {
    id: "sh-3",
    title: "Studio Headphones",
    price: 79,
    tags: ["headphones"],
    tone: "c",
    blurb: "Closed-back focus",
    image: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=480&q=80&auto=format&fit=crop",
  },
  {
    id: "sh-4",
    title: "Paperback Bundle",
    price: 32,
    tags: ["books", "gift"],
    tone: "d",
    blurb: "Three quiet reads",
    image: "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=480&q=80&auto=format&fit=crop",
  },
  {
    id: "sh-5",
    title: "Nickel-free Watch",
    price: 110,
    tags: ["watch", "gift"],
    tone: "e",
    blurb: "Hypoallergenic steel",
    image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=480&q=80&auto=format&fit=crop",
  },
  {
    id: "sh-5b",
    title: "Nickel Chain Bracelet",
    price: 48,
    tags: ["gift", "jewelry", "nickel", "watch"],
    tone: "e",
    blurb: "Polished nickel-plated chain",
    image: "https://images.unsplash.com/photo-1611591437281-460bfbe1220a?w=480&q=80&auto=format&fit=crop",
  },
  {
    id: "sh-6",
    title: "Canvas Backpack",
    price: 68,
    tags: ["backpack", "gift"],
    tone: "a",
    blurb: "Daypack with laptop sleeve",
    image: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=480&q=80&auto=format&fit=crop",
  },
  {
    id: "sh-7",
    title: "Wool Hoodie",
    price: 88,
    tags: ["hoodie", "gift"],
    tone: "b",
    blurb: "Heavyweight everyday layer",
    image: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=480&q=80&auto=format&fit=crop",
  },
  {
    id: "sh-8",
    title: "Desk Lamp",
    price: 45,
    tags: ["lamp"],
    tone: "c",
    blurb: "Warm task light",
    image: "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?w=480&q=80&auto=format&fit=crop",
  },
];

const SHOP_CATS = ["All", "shoes", "gift", "headphones", "watch", "books", "hoodie", "backpack"] as const;
const WELL_CHIPS = ["allergic to nickel", "sensitive skin", "no caffeine after 2", "prefer walking"];
const WALLET_CHIPS = ["40", "60", "80", "120"];

const APPS: {
  id: Exclude<AppId, "home">;
  name: string;
  color: string;
  hint: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { id: "claude", name: "Claude", color: "#0c0c0c", hint: "Real Claude · API key.", Icon: IconClaude },
  { id: "youtube", name: "YouTube", color: "#0c0c0c", hint: "Watch · no API key.", Icon: IconYouTube },
  { id: "maps", name: "Maps", color: "#0c0c0c", hint: "Places · no API key.", Icon: IconMaps },
  { id: "notes", name: "Notes", color: "#0c0c0c", hint: "On-device library.", Icon: IconNotes },
  { id: "weather", name: "Weather", color: "#0c0c0c", hint: "Live forecast.", Icon: IconWeather },
  { id: "voice", name: "Voice", color: "#0c0c0c", hint: "Speak once.", Icon: IconVoice },
  { id: "calendar", name: "Calendar", color: "#0c0c0c", hint: "Dates that matter.", Icon: IconCal },
  { id: "wallet", name: "Wallet", color: "#0c0c0c", hint: "Weekly spend.", Icon: IconWallet },
  { id: "shop", name: "Shop", color: "#0c0c0c", hint: "Buys that fit.", Icon: IconShop },
  { id: "wellness", name: "Wellness", color: "#0c0c0c", hint: "Kept private.", Icon: IconHeart },
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
function fmt(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

type AppProps = {
  /** When true, skip the hero film (Landing already played it, or judge path). */
  skipVideo?: boolean;
};

export default function App({ skipVideo = false }: AppProps) {
  const [showVideo, setShowVideo] = useState(() => !skipVideo && !IS_JUDGE);
  const [videoMuted, setVideoMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [app, setApp] = useState<AppId>("home");
  const [homeTab, setHomeTab] = useState<HomeTab>("today");
  const [banners, setBanners] = useState<Banner[]>([]);
  const [toast, setToast] = useState("");
  const [lastInfer, setLastInfer] = useState("");
  const [coreOk, setCoreOk] = useState<boolean | null>(null);
  const [readyMsg, setReadyMsg] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoDone, setDemoDone] = useState(false);
  const [briefing, setBriefing] = useState<{
    headline: string;
    summary: string;
    budget?: number | null;
    allergens: string[];
    pendingCount: number;
    clashes: Array<{ kind?: string; calendar?: string; facts?: string[] }>;
    today: {
      calendar: Array<{ title?: string; dateISO?: string; startHhmm?: string }>;
      commitments: Array<{ title?: string; dayOfMonth?: number; dateISO?: string }>;
    };
  } | null>(null);
  const [story, setStory] = useState<
    Array<{ id: string; title: string; detail: string; tone?: "good" | "warn" }>
  >([]);
  const [why, setWhy] = useState<{ headline: string; because: string } | null>(null);
  const [closing, setClosing] = useState<{
    headline: string;
    bullets: string[];
    say: string;
  } | null>(null);
  const [datahubOk, setDatahubOk] = useState<boolean | null>(null);
  const stageReady = coreOk === true && datahubOk === true;
  const [activity, setActivity] = useState<Activity | null>(null);
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);
  const [graphErr, setGraphErr] = useState("");
  const autoStarted = useRef(false);
  const smartBtnRef = useRef<HTMLButtonElement | null>(null);

  const [eventTitle, setEventTitle] = useState("");
  const [eventDay, setEventDay] = useState(String(Math.min(15, DAYS_IN_MONTH)));
  const [eventWho, setEventWho] = useState("");
  const [calComposer, setCalComposer] = useState(false);
  const [events, setEvents] = useState<FactResult[]>([]);
  const [shopQ, setShopQ] = useState("");
  const [shopCat, setShopCat] = useState<(typeof SHOP_CATS)[number]>("All");
  const [shopBusy, setShopBusy] = useState(false);
  const [shopPick, setShopPick] = useState<{
    id: string;
    title: string;
    price: number;
    blocked: boolean;
    reason: string;
  } | null>(null);
  const [ceiling, setCeiling] = useState("50");
  const [walletView, setWalletView] = useState<FactResult[]>([]);
  const [healthNote, setHealthNote] = useState("");
  const [healthRows, setHealthRows] = useState<FactResult[]>([]);
  const [giftContext, setGiftContext] = useState("");

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [typedVoice, setTypedVoice] = useState("");
  const [inferBusy, setInferBusy] = useState(false);
  const [claudeIn, setClaudeIn] = useState(false);
  const [claudeConnected, setClaudeConnected] = useState(false);
  const [claudeKey, setClaudeKey] = useState("");
  const [claudeMsgs, setClaudeMsgs] = useState<ChatMsg[]>([]);
  const [claudeInput, setClaudeInput] = useState("");
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeErr, setClaudeErr] = useState("");
  const tickRef = useRef<number | null>(null);
  const speechRef = useRef<ReturnType<typeof createSpeechSession> | null>(null);
  const demoBtnRef = useRef<HTMLButtonElement | null>(null);
  const claudeEndRef = useRef<HTMLDivElement | null>(null);

  const refreshActivity = useCallback(async () => {
    try {
      const a = await api.activity();
      setActivity(a);
    } catch {
      /* keep last */
    }
  }, []);

  const loadGraph = useCallback(async () => {
    setGraphBusy(true);
    setGraphErr("");
    try {
      const g = await api.graph();
      setGraphData(g);
    } catch (e) {
      setGraphErr(String(e).replace(/^Error:\s*/i, ""));
    } finally {
      setGraphBusy(false);
    }
  }, []);

  const refreshReady = useCallback(async () => {
    try {
      const r = await api.ready();
      setCoreOk(r.core !== false);
      setDatahubOk(!!r.datahub);
      setReadyMsg(r.message || "");
      return !!r.ok;
    } catch {
      setCoreOk(false);
      setDatahubOk(false);
      setReadyMsg("Core offline — run uvicorn on :8700");
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshReady();
    const t = window.setInterval(() => {
      void refreshReady();
    }, 6000);
    return () => window.clearInterval(t);
  }, [refreshReady]);

  useEffect(() => {
    if (!IS_JUDGE || showVideo) return;
    const id = window.setTimeout(() => {
      demoBtnRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 350);
    return () => window.clearTimeout(id);
  }, [showVideo]);

  useEffect(() => {
    if (!recording) {
      if (tickRef.current) window.clearInterval(tickRef.current);
      return;
    }
    tickRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [recording]);

  const heat = useMemo(() => {
    if (activity?.cells?.length) {
      return activity.cells.map((c) => c.intensity);
    }
    return Array.from({ length: 28 }, () => 0);
  }, [activity]);

  const summaryLine = useMemo(() => {
    if (story.length) {
      return "YOUR APPS JUST SHARED ONE MEMORY. WALLET SET THE LIMIT. SHOP LISTENED. WELLNESS STAYED PRIVATE.";
    }
    if (!IS_JUDGE && !IS_SMART && briefing?.headline) {
      return briefing.headline.toUpperCase();
    }
    if (lastInfer) {
      return `LAST HEARD: “${lastInfer.toUpperCase()}”. CALENDAR, WALLET, AND SHOP ALL CAUGHT UP.`;
    }
    if (activity && activity.total > 0) {
      return `YOU HAVE ${activity.total} LIVE FACTS ACROSS ${activity.activeDays} DAYS. ONE MEMORY — NOT FIVE PRIVATE SILOS.`;
    }
    return "YOUR WEEK IS STILL OPEN. SPEAK ONCE — CALENDAR, WALLET, AND SHOP WILL CATCH UP.";
  }, [story.length, lastInfer, activity, briefing]);

  useEffect(() => {
    if (IS_JUDGE || IS_SMART) return;
    let cancelled = false;
    const load = () => {
      api
        .briefing()
        .then((b) => {
          if (!cancelled && b?.ok) setBriefing(b);
        })
        .catch(() => {});
    };
    load();
    const t = window.setInterval(load, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [stageReady]);

  const pushBanners = useCallback((notes: InferNotification[], cap = 10) => {
    notes.forEach((n, i) => {
      window.setTimeout(() => {
        const id = uid();
        setBanners((prev) => [{ ...n, id }, ...prev].slice(0, cap));
      }, i * 280);
    });
  }, []);

  const wipeLocalHistory = useCallback(() => {
    localStorage.removeItem("residence-notes-v1");
    localStorage.removeItem("residence-yt-watched-v1");
    setEvents([]);
    setWalletView([]);
    setHealthRows([]);
    setShopPick(null);
    setGiftContext("");
    setStory([]);
    setWhy(null);
    setClaudeMsgs([]);
    setLastInfer("");
    setBanners([]);
    setActivity(null);
    setDemoDone(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      wipeLocalHistory();
      try {
        await api.clearHistory();
      } catch {
        /* offline — still empty local */
      }
      if (!cancelled) {
        setHistoryReady(true);
        void refreshActivity();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wipeLocalHistory, refreshActivity]);

  const onConnectedResidence = useCallback(
    (notes: InferNotification[], text: string) => {
      setLastInfer(text);
      if (notes.length) pushBanners(notes);
      for (const n of notes) {
        const p = n.payload || {};
        if (n.actionApp === "calendar") {
          if (p.title) setEventTitle(p.title);
          if (p.dayOfMonth) setEventDay(String(p.dayOfMonth));
          if (p.person) setEventWho(p.person);
        }
        if (n.actionApp === "wellness" && p.note) setHealthNote(p.note);
      }
    },
    [pushBanners]
  );

  const refreshAppFacts = useCallback(async () => {
    try {
      const [cal, wal, wel] = await Promise.all([
        api.queryFacts("Commitment", "calendar-health-agent", "Commitment"),
        api.queryFacts("Budget", "finance-agent", "Budget"),
        api.queryFacts("Health", "mentor-user", "Health Condition"),
      ]);
      setEvents(cal.results);
      setWalletView(wal.results);
      setHealthRows(wel.results);
    } catch {
      /* non-fatal */
    }
  }, []);

  const runJudgeDemo = async () => {
    if (demoRunning) return;
    setDemoRunning(true);
    setToast("");
    setStory([]);
    setWhy(null);
    setClosing(null);
    setBanners([]);
    setHomeTab("today");
    setApp("home");
    setDemoDone(false);

    const ok = await refreshReady();
    if (!ok) {
      setToast(readyMsg || "Core offline — start the Fact Broker first.");
      setDemoRunning(false);
      return;
    }

    try {
      let result: Awaited<ReturnType<typeof api.judgeDemo>>;
      try {
        result = await api.judgeDemo();
      } catch {
        await sleep(500);
        result = await api.judgeDemo();
      }

      if (!result.ok || !result.blocked || result.leaked) {
        throw new Error("Demo did not complete the winning path — retry.");
      }

      setLastInfer(result.utterance);
      setCeiling("40");
      setShopQ("shoes");
      setGiftContext("Sam's birthday");
      setShopPick({
        id: "sh-1",
        title: "Everyday Runners",
        price: 95,
        blocked: result.blocked,
        reason: "Over your $40 weekly spend.",
      });
      setStory(
        result.steps.map((s) => ({
          id: s.id,
          title: s.title,
          detail: s.detail,
          tone:
            s.id === "shop" && s.blocked
              ? "warn"
              : s.id === "wellness" && s.leaked
                ? "warn"
                : "good",
        }))
      );
      if (result.why?.ok) setWhy({ headline: result.why.headline, because: result.why.because });
      if (result.closing) setClosing(result.closing);
      if (result.notifications?.length) pushBanners(result.notifications, 6);
      setToast("Shared memory won — Shop blocked, health stayed private.");
      setDemoDone(true);
      await Promise.all([refreshAppFacts(), refreshActivity()]);
      // Absolute closer: land on the live DataHub graph after the story settles
      if (result.closing?.openGraph !== false) {
        window.setTimeout(() => {
          setHomeTab("graph");
          void loadGraph();
        }, 2200);
      }
    } catch (e) {
      setToast(String(e));
      void refreshReady(); // re-check instead of assuming Core died
    } finally {
      setDemoRunning(false);
    }
  };

  // Judge: Space clicks the demo CTA; ?auto=1 fires once when stage is green + history wiped
  useEffect(() => {
    if (!IS_JUDGE && !IS_SMART) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || demoRunning || !stageReady) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (IS_SMART) smartBtnRef.current?.click();
      else demoBtnRef.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demoRunning, stageReady]);

  useEffect(() => {
    if (!AUTO_JUDGE || autoStarted.current || showVideo || demoRunning || demoDone) return;
    if (!stageReady || !historyReady) return;
    autoStarted.current = true;
    const t = window.setTimeout(() => demoBtnRef.current?.click(), 700);
    return () => window.clearTimeout(t);
  }, [stageReady, historyReady, showVideo, demoRunning, demoDone]);

  useEffect(() => {
    if (!AUTO_SMART || autoStarted.current || showVideo || demoRunning || demoDone) return;
    if (!stageReady || !historyReady) return;
    autoStarted.current = true;
    const t = window.setTimeout(() => smartBtnRef.current?.click(), 700);
    return () => window.clearTimeout(t);
  }, [stageReady, historyReady, showVideo, demoRunning, demoDone]);

  const runSmartMemoryDemo = async () => {
    if (demoRunning) return;
    setDemoRunning(true);
    setToast("");
    setStory([]);
    setWhy(null);
    setClosing(null);
    setBanners([]);
    setHomeTab("today");
    setApp("home");

    const ok = await refreshReady();
    if (!ok) {
      setToast(readyMsg || "Core offline — start the Fact Broker first.");
      setDemoRunning(false);
      return;
    }

    try {
      const result = await api.smartMemoryDemo();
      if (!result.ok) throw new Error("Smart memory demo failed");
      setCeiling("40");
      setLastInfer("Using saved memory across apps…");
      setStory(
        result.steps.map((s) => ({
          id: s.id,
          title: s.title,
          detail: s.detail,
          tone:
            s.id === "contradiction" ||
            s.id === "allergy_shop" ||
            s.id === "budget_guard" ||
            s.id === "meal_allergy" ||
            s.id === "ride"
              ? "warn"
              : "good",
        }))
      );
      if (result.notifications?.length) pushBanners(result.notifications, 10);
      const cov = result.coverage;
      setToast(
        cov
          ? `Smart memory — ${cov.hit}/${cov.scenarios} scenarios hit${
              cov.missing?.length ? ` · missing: ${cov.missing.join(", ")}` : ""
            }`
          : "Smart inference — Accept any prompt to write into shared Facts."
      );
      setDemoDone(true);
      await Promise.all([refreshAppFacts(), refreshActivity()]);
    } catch (e) {
      setToast(String(e));
    } finally {
      setDemoRunning(false);
    }
  };

  const runInfer = useCallback(
    async (text: string, source_app: string, persist = true) => {
      const cleaned = text.trim();
      if (!cleaned) return null;
      setInferBusy(true);
      try {
        const result = await api.infer({
          text: cleaned,
          source_app,
          persist,
          agent_id: "mentor-user",
        });
        setLastInfer(cleaned);
        if (result.notifications?.length) pushBanners(result.notifications);
        for (const intent of result.intents || []) {
          const p = intent.payload || {};
          const target = intent.target_app as AppId;
          if (target === "calendar") {
            if (typeof p.title === "string") setEventTitle(p.title);
            if (p.dayOfMonth != null && p.dayOfMonth !== "") setEventDay(String(p.dayOfMonth));
            if (typeof p.person === "string" && p.person) setEventWho(p.person);
          }
          if (target === "wallet" && p.ceilingWeeklyUsd != null && p.ceilingWeeklyUsd !== "") {
            setCeiling(String(p.ceilingWeeklyUsd));
          }
          if (target === "shop") {
            if (typeof p.q === "string" && p.q) setShopQ(p.q);
            if (typeof p.title === "string" && p.title) setGiftContext(p.title);
          }
          if (target === "wellness" && typeof p.note === "string") setHealthNote(p.note);
        }
        void refreshActivity();
        return result;
      } catch (e) {
        setToast(String(e));
        return null;
      } finally {
        setInferBusy(false);
      }
    },
    [pushBanners, refreshActivity]
  );

  const dismiss = (id: string) => setBanners((prev) => prev.filter((x) => x.id !== id));

  const openApp = async (id: AppId) => {
    setApp(id);
    setToast("");
    try {
      if (id === "calendar") {
        const r = await api.queryFacts("Commitment", "calendar-health-agent", "Commitment");
        setEvents(r.results);
      }
      if (id === "wallet") {
        const r = await api.queryFacts("Budget", "finance-agent", "Budget");
        setWalletView(r.results);
      }
      if (id === "wellness") {
        const r = await api.queryFacts("Health", "mentor-user", "Health Condition");
        setHealthRows(r.results);
      }
      if (id === "claude") {
        const s = await api.claudeStatus();
        setClaudeIn(s.loggedIn);
        setClaudeConnected(s.residenceConnected);
        setClaudeErr("");
        if (s.loggedIn && claudeMsgs.length === 0) {
          setClaudeMsgs([
            {
              role: "assistant",
              content:
                "Hi — I’m Claude, connected to Residence. Tell me what’s on your mind. If you mention an exam or plan, Calendar can offer to save a note.",
            },
          ]);
        }
      }
    } catch (e) {
      setToast(String(e));
    }
  };

  const loginClaude = async () => {
    setClaudeErr("");
    try {
      const s = await api.claudeLogin(claudeKey.trim() || undefined);
      setClaudeIn(s.loggedIn);
      setClaudeConnected(s.residenceConnected);
      setClaudeKey("");
      setClaudeMsgs([
        {
          role: "assistant",
          content:
            "You’re in. Residence is connected — try “I have an exam tomorrow” and watch for a Calendar notification.",
        },
      ]);
    } catch (e) {
      setClaudeErr(String(e).replace(/^Error:\s*/i, ""));
      setClaudeIn(false);
      setClaudeConnected(false);
    }
  };

  const sendClaude = async () => {
    const text = claudeInput.trim();
    if (!text || claudeBusy) return;
    setClaudeBusy(true);
    setClaudeErr("");
    setClaudeInput("");
    const history = claudeMsgs.map((m) => ({ role: m.role, content: m.content }));
    setClaudeMsgs((prev) => [...prev, { role: "user", content: text }]);
    try {
      const out = await api.claudeChat(text, history);
      setClaudeMsgs((prev) => [...prev, { role: "assistant", content: out.reply }]);
      setClaudeConnected(!!out.residenceConnected);
      setLastInfer(text);
      if (out.notifications?.length) pushBanners(out.notifications);
      for (const intent of out.intents || []) {
        const p = intent.payload || {};
        if (intent.target_app === "calendar") {
          if (typeof p.title === "string") setEventTitle(p.title);
          if (p.dayOfMonth != null && p.dayOfMonth !== "") setEventDay(String(p.dayOfMonth));
        }
      }
      window.setTimeout(() => claudeEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/i, "");
      setClaudeErr(msg);
      if (msg.includes("not_logged_in") || msg.includes("invalid_api_key")) {
        setClaudeIn(false);
        setClaudeConnected(false);
      }
      setClaudeMsgs((prev) => prev.slice(0, -1));
      setClaudeInput(text);
    } finally {
      setClaudeBusy(false);
    }
  };

  const setTab = (tab: HomeTab) => {
    if (tab === "listen") {
      void openApp("voice");
      return;
    }
    if (tab === "graph") void loadGraph();
    setHomeTab(tab);
    setApp("home");
  };

  const declineBanner = (id: string) => dismiss(id);

  const acceptBanner = async (b: Banner) => {
    // Dismiss only after the write succeeds — a failed Accept keeps the banner.
    const p = b.payload || {};
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    try {
      if (b.actionApp === "shop" || !b.actionApp) {
        dismiss(b.id);
      }
      if (b.actionApp === "calendar") {
        const title = (p.title || p.text || "New note").slice(0, 80);
        const day = Number(p.dayOfMonth) || tomorrow.getDate();
        const who = p.person || "";
        await api.assertFact({
          agent_id: "calendar-health-agent",
          glossary_term: "Commitment",
          confidence: 1,
          fact: {
            value: JSON.stringify({
              title,
              dayOfMonth: day,
              person: who || null,
              sourceText: p.text || title,
            }),
            certificationStatus: "user_confirmed",
          },
        });
        dismiss(b.id);
        setEventTitle(title);
        setEventDay(String(day));
        if (who) setEventWho(who);
        setCalComposer(false);
        const r = await api.queryFacts("Commitment", "calendar-health-agent", "Commitment");
        setEvents(r.results);
        setApp("calendar");
        setToast("Accepted — saved to Calendar.");
        void refreshActivity();
        return;
      }
      if (b.actionApp === "wallet") {
        const fromIncoming = (p.incoming || p.text || "").match(/\$\s?(\d+(?:\.\d+)?)/);
        const amt = p.ceilingWeeklyUsd || fromIncoming?.[1] || ceiling;
        setCeiling(String(amt));
        await api.assertFact({
          agent_id: "mentor-user",
          glossary_term: "Budget",
          sensitivity_tag: "financial",
          confidence: 1,
          fact: {
            value: JSON.stringify({ ceilingWeeklyUsd: Number(amt), currency: "USD" }),
            certificationStatus: "user_confirmed",
            ttlSeconds: 7 * 24 * 3600,
          },
        });
        dismiss(b.id);
        const r = await api.queryFacts("Budget", "finance-agent", "Budget");
        setWalletView(r.results);
        setApp("wallet");
        setToast(
          b.type === "memory.contradiction"
            ? "Accepted — Wallet updated from the newer number."
            : "Accepted — Wallet updated."
        );
        void refreshActivity();
        return;
      }
      if (b.actionApp === "wellness") {
        const note = p.note || p.incoming || p.text || b.body;
        await api.assertFact({
          agent_id: "mentor-user",
          glossary_term: "Health Condition",
          sensitivity_tag: "health",
          confidence: 1,
          fact: {
            value: JSON.stringify({ note }),
            certificationStatus: "user_confirmed",
          },
        });
        dismiss(b.id);
        setHealthNote(note);
        const r = await api.queryFacts("Health", "mentor-user", "Health Condition");
        setHealthRows(r.results);
        setApp("wellness");
        setToast(
          b.type === "memory.contradiction"
            ? "Accepted — Wellness updated (old note superseded)."
            : "Accepted — saved privately."
        );
        void refreshActivity();
        return;
      }
      if (b.actionApp === "shop") {
        if (p.q) setShopQ(p.q);
        if (p.who) setGiftContext(`${p.who}${p.title ? ` · ${p.title}` : ""}`);
        else if (p.title) setGiftContext(p.title);
        setApp("shop");
        setToast(
          b.type?.startsWith("memory.")
            ? "Accepted — Shop opened from saved memory."
            : "Accepted — opened Shop."
        );
        return;
      }
      if (b.actionApp) {
        dismiss(b.id);
        void openApp(b.actionApp as AppId);
      }
    } catch (e) {
      setToast(`Accept failed — ${String(e).replace(/^Error:\s*/i, "")}. The prompt is still here.`);
    }
  };

  const startVoice = () => {
    setElapsed(0);
    setTranscript("");
    setRecording(true);
    if (!speechSupported()) {
      setToast("Mic isn’t available — type below, then Understand.");
      return;
    }
    speechRef.current = createSpeechSession({
      onPartial: (t) => setTranscript(t),
      onFinal: (t) => setTranscript(t),
      onError: (m) => setToast(m),
    });
    speechRef.current?.start();
  };

  const stopAndUnderstand = async () => {
    setRecording(false);
    speechRef.current?.stop();
    const text = (speechRef.current?.getTranscript() || transcript || typedVoice).trim();
    if (!text) {
      setToast("I didn’t catch anything — try again or type it.");
      return;
    }
    setTranscript(text);
    const result = await runInfer(text, "voice", true);
    if (result?.ok) {
      setToast(
        result.notifications.length
          ? `Understood — ${result.notifications.length} apps reached out.`
          : "Heard you. Try a date, amount, or health note."
      );
    }
  };

  const createCalendarEvent = async () => {
    const title = eventTitle.trim() || "Something coming up";
    const who = eventWho.trim();
    const day = Number(eventDay) || 1;
    const label = who ? `${who}'s ${title}` : title;
    const utterance = [label, `on the ${day}`, who ? `for ${who}` : ""].filter(Boolean).join(" ");
    await api.assertFact({
      agent_id: "calendar-health-agent",
      glossary_term: "Commitment",
      confidence: 0.95,
      fact: {
        value: JSON.stringify({ title: label, dayOfMonth: day, person: who || null }),
        certificationStatus: "user_confirmed",
      },
    });
    const r = await api.queryFacts("Commitment", "calendar-health-agent", "Commitment");
    setEvents(r.results);
    setEventTitle("");
    setEventWho("");
    setCalComposer(false);
    await runInfer(utterance, "calendar", true);
    setToast("Saved.");
  };

  const setWeeklySpend = async () => {
    await api.assertFact({
      agent_id: "mentor-user",
      glossary_term: "Budget",
      sensitivity_tag: "financial",
      confidence: 1,
      fact: {
        value: JSON.stringify({ ceilingWeeklyUsd: Number(ceiling), currency: "USD" }),
        certificationStatus: "user_confirmed",
        ttlSeconds: 7 * 24 * 3600,
      },
    });
    const r = await api.queryFacts("Budget", "finance-agent", "Budget");
    setWalletView(r.results);
    await runInfer(
      `my weekly budget is $${ceiling}${Number(ceiling) < 80 ? ", balance isn't much" : ""}`,
      "wallet",
      false
    );
    setToast("Updated.");
  };

  const saveHealth = async () => {
    if (!healthNote.trim()) return;
    await runInfer(healthNote.trim(), "wellness", true);
    setHealthNote("");
    const mentor = await api.queryFacts("Health", "mentor-user", "Health Condition");
    setHealthRows(mentor.results);
    setToast("Saved privately.");
  };

  const shopItems = useMemo(() => {
    const q = shopQ.trim().toLowerCase();
    return CATALOG.filter((p) => {
      const catOk = shopCat === "All" || p.tags.includes(shopCat);
      const qOk =
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.tags.some((t) => t.includes(q) || q.includes(t)) ||
        (giftContext && p.tags.includes("gift"));
      return catOk && qOk;
    });
  }, [shopQ, shopCat, giftContext]);

  const calEvents = useMemo(() => {
    return events
      .map((e) => {
        try {
          const v = JSON.parse(e.fact.value);
          return {
            id: e.fact.factId,
            title: String(v.title || "Event"),
            day: Number(v.dayOfMonth) || 0,
            person: v.person ? String(v.person) : "",
          };
        } catch {
          return { id: e.fact.factId, title: e.fact.value, day: 0, person: "" };
        }
      })
      .filter((e) => e.day > 0)
      .sort((a, b) => a.day - b.day);
  }, [events]);

  const eventDaySet = useMemo(() => new Set(calEvents.map((e) => e.day)), [calEvents]);

  const healthNotes = useMemo(() => {
    return healthRows.map((r) => {
      try {
        return {
          id: r.fact.factId,
          note: String(JSON.parse(r.fact.value).note || r.fact.value),
          provenance: r.provenance,
        };
      } catch {
        return { id: r.fact.factId, note: r.fact.value, provenance: r.provenance };
      }
    });
  }, [healthRows]);

  const runShop = async (productId?: string) => {
    setShopBusy(true);
    try {
      const budgets = await api.queryFacts("Budget", "shopping-agent", "Budget");
      const live = budgets.results.find((b) => !b.stale);
      const ceil = live ? JSON.parse(live.fact.value).ceilingWeeklyUsd : null;
      const list = shopItems.length ? shopItems : [...CATALOG];
      const pick =
        (productId ? list.find((p) => p.id === productId) || CATALOG.find((p) => p.id === productId) : null) ||
        [...list].sort((a, b) => a.price - b.price)[0];
      if (!pick) {
        setShopPick(null);
        setToast("Nothing matched.");
        return;
      }

      // Mentor-owned health — Shop agent cannot read it; UI uses Accept-path context
      let allergenHit: string | null = null;
      try {
        const health = await api.queryFacts("Health", "mentor-user", "Health Condition");
        const blob = `${pick.title} ${(pick.tags || []).join(" ")} ${pick.blurb || ""}`.toLowerCase();
        for (const row of health.results) {
          if (row.stale) continue;
          let note = row.fact.value;
          try {
            const v = JSON.parse(row.fact.value);
            note = v.note || note;
          } catch {
            /* raw */
          }
          const m = String(note).toLowerCase().match(/allergic to ([a-z0-9\-]+)/);
          const token = m?.[1];
          if (!token) continue;
          if (blob.includes(token) && !blob.includes(`${token}-free`) && !blob.includes(`free ${token}`)) {
            allergenHit = token;
            break;
          }
        }
      } catch {
        /* ignore */
      }

      const overBudget = ceil != null && pick.price > Number(ceil);
      const blocked = overBudget || !!allergenHit;
      const decision = await api.assertFact({
        agent_id: "shopping-agent",
        glossary_term: "Intent",
        confidence: 0.85,
        decision_label: `${blocked ? "blocked" : "approved"}-purchase:${pick.id}`,
        fact: {
          value: JSON.stringify({
            productId: pick.id,
            title: pick.title,
            price: pick.price,
            blocked,
            ceiling: ceil,
            allergen: allergenHit,
          }),
        },
      });
      if (live) {
        await fetch(
          `${import.meta.env.VITE_CORE_URL || "/api"}/facts/${decision.fact.factId}/link/${live.fact.factId}`,
          { method: "POST" }
        );
      }
      const reason = allergenHit
        ? `Blocked — Wellness remembers allergy to ${allergenHit}.`
        : ceil == null
          ? "Set a weekly spend in Wallet first."
          : overBudget
            ? `Over your $${ceil} weekly spend.`
            : `Fits under $${ceil}.`;
      setShopPick({
        id: pick.id,
        title: pick.title,
        price: pick.price,
        blocked: !!blocked,
        reason,
      });
      await runInfer(
        allergenHit
          ? `I tried to buy ${pick.title} but I'm allergic to ${allergenHit}`
          : blocked
            ? `I tried to buy ${pick.title} for $${pick.price} but my balance isn't enough under $${ceil}`
            : `I want to buy ${pick.title} for $${pick.price}`,
        "shop",
        false
      );
      void refreshActivity();
    } finally {
      setShopBusy(false);
    }
  };

  const now = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const iconFor = (id: string) => APPS.find((a) => a.id === id)?.Icon || IconVoice;

  // Browsers block autoplay-with-sound — start muted, then unlock on tap.
  useEffect(() => {
    if (!showVideo) return;
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    el.playsInline = true;
    const p = el.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        /* wait for user gesture via Enable sound / Enter */
      });
    }
  }, [showVideo]);

  const enableVideoSound = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = 1;
    setVideoMuted(false);
    void el.play().catch(() => {});
  };

  return (
    <>
      <div className={`video-stage ${showVideo ? "" : "is-gone"}`}>
        <video
          ref={videoRef}
          src={VIDEO_SRC}
          autoPlay
          muted
          playsInline
          preload="auto"
          controls={false}
          onEnded={() => setShowVideo(false)}
        />
        {videoMuted && (
          <button className="video-sound" type="button" onClick={enableVideoSound}>
            Enable sound
          </button>
        )}
        <button className="video-skip" type="button" onClick={() => setShowVideo(false)}>
          Enter Residence
        </button>
      </div>

      {!showVideo && (
        <div className="device-wrap">
          <div className="phone">
            <div className="island" />
            <div className="status">
              <span>{now}</span>
              <span>●●● ▮</span>
            </div>

            <div className="banner-stack">
              {banners.map((b) => {
                const I = iconFor(b.fromApp);
                return (
                  <div key={b.id} className="perm-banner">
                    <div className="perm-top">
                      <div className="perm-icon">
                        <I />
                      </div>
                      <div className="perm-app">
                        {b.fromLabel} · {b.fromMemory || b.type?.startsWith("memory.") ? "from memory" : "permission"}
                      </div>
                    </div>
                    <div className="perm-ask">{b.title}</div>
                    <div className="perm-body">{b.body}</div>
                    <div className="perm-actions">
                      <button type="button" className="btn-ghost" onClick={() => declineBanner(b.id)}>
                        Decline
                      </button>
                      <button type="button" className="btn-solid" onClick={() => void acceptBanner(b)}>
                        Accept
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="phone-body">
              {app === "home" && (
                <div className="scroll home">
                  <div className="brand-block">
                    <h1>Residence.</h1>
                    <p className="mono-line">Personal context · shared memory</p>
                  </div>
                  {IS_JUDGE && (
                    <p className="thesis-line">
                      Apps stop lying to each other — Facts live in DataHub, not private silos.
                    </p>
                  )}
                  <div className="live-row">
                    <span className={coreOk ? "ok" : coreOk === false ? "bad" : ""}>
                      Core {coreOk === null ? "…" : coreOk ? "live" : "down"}
                    </span>
                    <span className={datahubOk ? "ok" : datahubOk === false ? "bad" : ""}>
                      DataHub {datahubOk === null ? "…" : datahubOk ? "live" : "down"}
                    </span>
                    <span>{now}</span>
                  </div>
                  <nav className="home-nav" aria-label="Home">
                    <button
                      type="button"
                      className={homeTab === "today" ? "on" : ""}
                      onClick={() => setTab("today")}
                    >
                      Activity
                    </button>
                    <button
                      type="button"
                      className={homeTab === "graph" ? "on" : ""}
                      onClick={() => setTab("graph")}
                    >
                      Graph
                    </button>
                    <button
                      type="button"
                      className={homeTab === "apps" ? "on" : ""}
                      onClick={() => setTab("apps")}
                    >
                      Apps
                    </button>
                    <button type="button" onClick={() => setTab("listen")}>
                      Voice
                    </button>
                  </nav>

                  {toast && homeTab !== "apps" && <p className="toast home-toast">{toast}</p>}

                  {homeTab === "today" && (
                    <>
                      <div className="frame">
                        <div className="eyebrow">
                          {IS_JUDGE || IS_SMART ? "Summary" : "Today"}
                        </div>
                        <p className="headline">{summaryLine}</p>
                        {!IS_JUDGE && !IS_SMART && (
                          <div className="today-brief">
                            {briefing ? (
                              <>
                                <ul className="brief-list">
                                  {(briefing.today?.commitments || []).slice(0, 4).map((c, i) => (
                                    <li key={`c-${i}`}>
                                      {c.title || "Commitment"}
                                      {c.dateISO ? ` · ${c.dateISO}` : ""}
                                    </li>
                                  ))}
                                  {!briefing.today?.commitments?.length && (
                                    <li className="muted">
                                      No Residence commitments today — capture with Voice or Mac ⌘⇧R
                                    </li>
                                  )}
                                </ul>
                                <div className="brief-meta">
                                  {briefing.budget != null && (
                                    <span>Budget ${briefing.budget}/wk</span>
                                  )}
                                  {!!briefing.allergens?.length && (
                                    <span>Avoid {briefing.allergens.slice(0, 2).join(", ")}</span>
                                  )}
                                  {briefing.pendingCount > 0 && (
                                    <span>{briefing.pendingCount} Accept pending</span>
                                  )}
                                  {!!briefing.clashes?.length && (
                                    <span className="warn">{briefing.clashes.length} clash</span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <p className="brief-wait">
                                {stageReady
                                  ? "Loading today’s Facts…"
                                  : readyMsg || "Waiting for Core + DataHub…"}
                              </p>
                            )}
                            <button
                              type="button"
                              className="demo-cta secondary"
                              style={{ marginTop: 12 }}
                              onClick={() => setTab("listen")}
                            >
                              <div>
                                <strong>Speak a plan</strong>
                                <span>Voice → shared Facts · Calendar / Wallet / Shop catch up</span>
                              </div>
                              <em>→</em>
                            </button>
                          </div>
                        )}
                        {(IS_JUDGE || IS_SMART) && (
                          <>
                            <button
                              ref={demoBtnRef}
                              className={`demo-cta ${IS_JUDGE && !demoDone ? "pulse" : ""} ${demoDone ? "done" : ""}`}
                              type="button"
                              disabled={demoRunning || !stageReady}
                              onClick={runJudgeDemo}
                            >
                              <div>
                                <strong>
                                  {demoRunning
                                    ? "Running…"
                                    : demoDone
                                      ? "Demo complete"
                                      : "Play 30s demo"}
                                </strong>
                                <span>
                                  {!stageReady
                                    ? readyMsg || "Waiting for Core + DataHub…"
                                    : AUTO_JUDGE && !demoDone
                                      ? "Auto-starting… (or press Space)"
                                      : "Wallet → infer → Shop block → Why · Space"}
                                </span>
                              </div>
                              <em>→</em>
                            </button>
                            <button
                              ref={smartBtnRef}
                              className={`demo-cta secondary ${IS_SMART && !demoDone ? "pulse" : ""}`}
                              type="button"
                              disabled={demoRunning || !stageReady}
                              onClick={runSmartMemoryDemo}
                              style={{ marginTop: 10 }}
                            >
                              <div>
                                <strong>Smart memory</strong>
                                <span>
                                  {AUTO_SMART && !demoDone
                                    ? "Auto-starting breadth demo…"
                                    : "22 scenarios · clash · Maps · LinkedIn · GitHub · Uber · allergy"}
                                </span>
                              </div>
                              <em>→</em>
                            </button>
                          </>
                        )}
                      </div>

                      {(story.length > 0 || why || closing) && (
                        <div className="story-rail">
                          {story.map((s) => (
                            <div key={s.id} className={`story-item ${s.tone || ""}`}>
                              <strong>{s.title}</strong>
                              <p>{s.detail}</p>
                            </div>
                          ))}
                          {why && (
                            <div className="story-item why">
                              <strong>{why.headline}</strong>
                              <p>{why.because}</p>
                            </div>
                          )}
                          {closing && (
                            <div className="story-item closing">
                              <strong>{closing.headline}</strong>
                              <ul>
                                {closing.bullets.map((b) => (
                                  <li key={b}>{b}</li>
                                ))}
                              </ul>
                              <p className="say">{closing.say}</p>
                              <button
                                type="button"
                                className="text-btn graph-cta"
                                onClick={() => setTab("graph")}
                              >
                                See the live graph →
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="frame">
                        <div className="eyebrow">Activity · 28 days</div>
                        <div className="heat-wrap">
                          <div className="heat-days">
                            {DAYS.map((d) => (
                              <span key={d}>{d.slice(0, 2)}</span>
                            ))}
                          </div>
                          <div className="heat">
                            {heat.map((v, i) => {
                              const cell = activity?.cells?.[i];
                              const size = v <= 0 ? 0 : 5 + v * 18;
                              return (
                                <div className="cell" key={cell?.date || i}>
                                  <div
                                    className="dot"
                                    style={{ width: `${size}px`, height: `${size}px` }}
                                  />
                                </div>
                              );
                            })}
                          </div>
                          <p className="heat-meta">
                            {activity
                              ? `${activity.total} facts · ${activity.activeDays} active days`
                              : "Empty — start fresh"}
                          </p>
                        </div>
                        {lastInfer && <p className="whisper">Last heard: “{lastInfer}”</p>}
                      </div>
                    </>
                  )}

                  {homeTab === "graph" && (
                    <GraphView
                      data={graphData}
                      busy={graphBusy}
                      err={graphErr}
                      onRefresh={() => void loadGraph()}
                    />
                  )}

                  {homeTab === "apps" && (
                    <div className="frame" style={{ padding: 0 }}>
                      <div className="eyebrow" style={{ padding: "1rem 1rem 0.5rem" }}>
                        Apps
                      </div>
                      <div className="app-rows" style={{ border: 0 }}>
                        {APPS.map(({ id, name, hint, Icon }) => (
                          <button
                            key={id}
                            type="button"
                            className="app-row"
                            onClick={() => openApp(id)}
                          >
                            <span className="mark">
                              <Icon />
                            </span>
                            <span>
                              <div className="name">{name}</div>
                              <div className="hint">{hint}</div>
                            </span>
                            <span className="chev">→</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {app === "voice" && (
                <div className="app-screen voice">
                  <div className="scroll voice-body">
                    <div className="app-bar">
                      <div>
                        <h1>Voice</h1>
                        <p className="sub">Speak once — Calendar, Wallet, Shop, and Wellness catch up.</p>
                      </div>
                      <button
                        className="back"
                        type="button"
                        onClick={() => {
                          setRecording(false);
                          speechRef.current?.stop();
                          setApp("home");
                        }}
                      >
                        ˅
                      </button>
                    </div>

                    <div className={`wave ${recording ? "on" : ""}`} aria-hidden>
                      {Array.from({ length: 16 }, (_, i) => (
                        <span key={i} style={{ animationDelay: `${i * 0.05}s` }} />
                      ))}
                    </div>

                    <div className="voice-timer">
                      <span className="big">{fmt(elapsed)}</span>
                      <span className="small">
                        {recording ? "listening" : inferBusy ? "thinking" : "ready"}
                      </span>
                    </div>

                    {(transcript || typedVoice) && (
                      <div className="note">
                        <strong>Heard</strong>
                        {transcript || typedVoice}
                      </div>
                    )}

                    <textarea
                      className="field"
                      rows={3}
                      placeholder='Try: "Sam birthday on the 15th, balance isn’t much, only $40"'
                      value={typedVoice}
                      onChange={(e) => setTypedVoice(e.target.value)}
                    />

                    <div className="voice-actions">
                      <button
                        className="btn"
                        type="button"
                        onClick={() => (recording ? stopAndUnderstand() : startVoice())}
                        disabled={inferBusy}
                      >
                        {recording ? "Stop & understand" : "Record"}
                      </button>
                      <button
                        className="btn soft"
                        type="button"
                        disabled={inferBusy || (!typedVoice.trim() && !transcript.trim())}
                        onClick={async () => {
                          await runInfer(typedVoice.trim() || transcript.trim(), "voice", true);
                          setToast("Understood.");
                        }}
                      >
                        Understand
                      </button>
                    </div>
                    {toast && <p className="toast">{toast}</p>}
                  </div>
                </div>
              )}

              {app === "maps" && (
                <MapsApp onBack={() => setApp("home")} onResidence={onConnectedResidence} />
              )}
              {app === "notes" && (
                <NotesApp onBack={() => setApp("home")} onResidence={onConnectedResidence} />
              )}
              {app === "weather" && (
                <WeatherApp onBack={() => setApp("home")} onResidence={onConnectedResidence} />
              )}
              {app === "youtube" && (
                <YouTubeApp onBack={() => setApp("home")} onResidence={onConnectedResidence} />
              )}

              {app === "claude" && (
                <div className="app-screen skin-claude">
                  <div className="scroll app-pad claude-screen">
                    <div className="app-nav">
                      <div>
                        <p className="app-kicker">Claude</p>
                        <h1 className="app-title">Chat</h1>
                      </div>
                      <button className="back" type="button" onClick={() => setApp("home")}>
                        ˅
                      </button>
                    </div>

                    {!claudeIn ? (
                      <div className="claude-login">
                        <div className="claude-mark">
                          <IconClaude />
                        </div>
                        <h2>Sign in to Claude</h2>
                        <p>
                          Opens here on Residence — powered by the real Anthropic API. After login,
                          Residence stays connected.
                        </p>
                        <input
                          className="field"
                          type="password"
                          autoComplete="off"
                          placeholder="Anthropic API key (sk-ant-…)"
                          value={claudeKey}
                          onChange={(e) => setClaudeKey(e.target.value)}
                        />
                        <button className="btn" type="button" onClick={loginClaude}>
                          Continue with Residence
                        </button>
                        <button
                          className="btn soft"
                          type="button"
                          style={{ marginTop: "0.5rem" }}
                          onClick={async () => {
                            setClaudeErr("");
                            try {
                              const s = await api.claudeLogin();
                              setClaudeIn(s.loggedIn);
                              setClaudeConnected(s.residenceConnected);
                              setClaudeMsgs([
                                {
                                  role: "assistant",
                                  content:
                                    "You’re in via the server key. Residence is connected — try “I have an exam tomorrow”.",
                                },
                              ]);
                            } catch (e) {
                              setClaudeErr(String(e).replace(/^Error:\s*/i, ""));
                            }
                          }}
                        >
                          Use server key (.env)
                        </button>
                        <a
                          className="claude-ext"
                          href="https://claude.ai"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open claude.ai ↗
                        </a>
                        {claudeErr && <p className="toast">{claudeErr}</p>}
                      </div>
                    ) : (
                      <>
                        <div className="claude-status">
                          <span className={`dot ${claudeConnected ? "on" : ""}`} />
                          {claudeConnected ? "Residence connected" : "Connecting…"}
                          <button
                            type="button"
                            className="text-btn"
                            onClick={async () => {
                              await api.claudeLogout();
                              setClaudeIn(false);
                              setClaudeConnected(false);
                              setClaudeMsgs([]);
                            }}
                          >
                            Log out
                          </button>
                        </div>

                        <div className="claude-thread">
                          {claudeMsgs.map((m, i) => (
                            <div key={`${m.role}-${i}`} className={`bubble ${m.role}`}>
                              {m.role === "assistant" && <span className="who">Claude</span>}
                              <p>{m.content}</p>
                            </div>
                          ))}
                          {claudeBusy && (
                            <div className="bubble assistant">
                              <span className="who">Claude</span>
                              <p className="typing">Thinking…</p>
                            </div>
                          )}
                          <div ref={claudeEndRef} />
                        </div>

                        <div className="claude-composer">
                          <textarea
                            rows={2}
                            placeholder='Try: "I have an exam tomorrow"'
                            value={claudeInput}
                            onChange={(e) => setClaudeInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                void sendClaude();
                              }
                            }}
                          />
                          <button
                            className="btn"
                            type="button"
                            disabled={claudeBusy || !claudeInput.trim()}
                            onClick={sendClaude}
                          >
                            Send
                          </button>
                        </div>
                        {claudeErr && <p className="toast">{claudeErr}</p>}
                      </>
                    )}
                  </div>
                </div>
              )}

              {app === "calendar" && (
                <div className="app-screen skin-cal">
                  <div className="scroll app-pad">
                    <div className="app-nav">
                      <div>
                        <p className="app-kicker">Calendar</p>
                        <h1 className="app-title">{MONTH}.</h1>
                      </div>
                      <button className="back" type="button" onClick={() => setApp("home")}>
                        ˅
                      </button>
                    </div>

                    <div className="cal-grid" role="grid" aria-label="Month">
                      {DAYS.map((d) => (
                        <span className="cal-dow" key={d}>
                          {d.slice(0, 1)}
                        </span>
                      ))}
                      {Array.from({ length: MONTH_START_PAD }, (_, i) => (
                        <span className="cal-empty" key={`pad-${i}`} />
                      ))}
                      {Array.from({ length: DAYS_IN_MONTH }, (_, i) => {
                        const day = i + 1;
                        const on = String(day) === eventDay;
                        const has = eventDaySet.has(day);
                        return (
                          <button
                            key={day}
                            type="button"
                            className={`cal-day ${on ? "on" : ""} ${has ? "has" : ""}`}
                            onClick={() => {
                              setEventDay(String(day));
                              setCalComposer(true);
                            }}
                          >
                            {day}
                            {has && <i />}
                          </button>
                        );
                      })}
                    </div>

                    <div className="section-head">
                      <h2>Upcoming</h2>
                      <button type="button" className="text-btn" onClick={() => setCalComposer(true)}>
                        + Add
                      </button>
                    </div>

                    <div className="agenda">
                      {calEvents.length === 0 && (
                        <p className="empty-hint">Tap a day to add something — Shop can pick up gifts later.</p>
                      )}
                      {calEvents.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className="agenda-item"
                          onClick={() => {
                            setEventDay(String(e.day));
                            setEventTitle(e.title);
                            setEventWho(e.person);
                            setCalComposer(true);
                          }}
                        >
                          <span className="agenda-date">
                            <strong>{e.day}</strong>
                            <small>{MONTH.split(" ")[0].slice(0, 3)}</small>
                          </span>
                          <span>
                            <span className="agenda-title">{e.title}</span>
                            {e.person && <span className="agenda-meta">For {e.person}</span>}
                          </span>
                        </button>
                      ))}
                    </div>

                    {calComposer && (
                      <div className="composer">
                        <div className="composer-top">
                          <strong>New event · day {eventDay}</strong>
                          <button type="button" onClick={() => setCalComposer(false)}>
                            Close
                          </button>
                        </div>
                        <input
                          className="field"
                          placeholder="What’s the occasion?"
                          value={eventTitle}
                          onChange={(e) => setEventTitle(e.target.value)}
                        />
                        <input
                          className="field"
                          placeholder="Who’s it for?"
                          value={eventWho}
                          onChange={(e) => setEventWho(e.target.value)}
                        />
                        <button className="btn" type="button" onClick={createCalendarEvent}>
                          Save to calendar
                        </button>
                      </div>
                    )}
                    {toast && <p className="toast">{toast}</p>}
                  </div>
                </div>
              )}

              {app === "wallet" && (
                <div className="app-screen skin-wallet">
                  <div className="scroll app-pad">
                    <div className="app-nav">
                      <div>
                        <p className="app-kicker">Wallet</p>
                        <h1 className="app-title">This week</h1>
                      </div>
                      <button className="back" type="button" onClick={() => setApp("home")}>
                        ˅
                      </button>
                    </div>

                    <div className="wallet-card">
                      <p className="wallet-label">Weekly spend limit</p>
                      <div className="wallet-amount">
                        <span>$</span>
                        <input
                          value={ceiling}
                          onChange={(e) => setCeiling(e.target.value.replace(/[^\d]/g, ""))}
                          inputMode="numeric"
                          aria-label="Weekly limit"
                        />
                      </div>
                      <div className="wallet-bar">
                        <div
                          className="wallet-fill"
                          style={{
                            width: `${Math.min(100, (Number(ceiling) / 150) * 100 || 0)}%`,
                          }}
                        />
                      </div>
                      <p className="wallet-hint">
                        Shop checks this before checkout. Tight weeks stay honest.
                      </p>
                    </div>

                    <div className="chip-row">
                      {WALLET_CHIPS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={ceiling === c ? "on" : ""}
                          onClick={() => setCeiling(c)}
                        >
                          ${c}
                        </button>
                      ))}
                    </div>

                    <button className="btn" type="button" onClick={setWeeklySpend}>
                      Set weekly limit
                    </button>

                    <div className="section-head" style={{ marginTop: "1.25rem" }}>
                      <h2>Recent limits</h2>
                    </div>
                    <div className="ledger">
                      {walletView.length === 0 && (
                        <p className="empty-hint">No limit set yet — pick an amount above.</p>
                      )}
                      {walletView.map((r) => {
                        let amt = r.fact.value;
                        try {
                          amt = `$${JSON.parse(r.fact.value).ceilingWeeklyUsd}`;
                        } catch {
                          /* */
                        }
                        return (
                          <div className="ledger-row" key={r.fact.factId}>
                            <span className="ledger-mark" />
                            <span>
                              <strong>{amt} / week</strong>
                              <small>{r.stale ? "Expired — refresh" : "Active · shared with Shop"}</small>
                              <small className="prov">{r.provenance}</small>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {toast && <p className="toast">{toast}</p>}
                  </div>
                </div>
              )}

              {app === "shop" && (
                <div className="app-screen skin-shop">
                  <div className="scroll app-pad">
                    <div className="app-nav">
                      <div>
                        <p className="app-kicker">Shop</p>
                        <h1 className="app-title">Browse</h1>
                      </div>
                      <button className="back" type="button" onClick={() => setApp("home")}>
                        ˅
                      </button>
                    </div>

                    <div className="search-bar">
                      <span aria-hidden>⌕</span>
                      <input
                        value={shopQ}
                        onChange={(e) => setShopQ(e.target.value)}
                        placeholder="Search shoes, gifts…"
                      />
                    </div>

                    {giftContext && (
                      <div className="gift-banner">
                        <strong>For {giftContext}</strong>
                        <span>From your calendar / voice</span>
                      </div>
                    )}

                    <div className="chip-row shop-cats">
                      {SHOP_CATS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={shopCat === c ? "on" : ""}
                          onClick={() => setShopCat(c)}
                        >
                          {c}
                        </button>
                      ))}
                    </div>

                    <div className="product-grid">
                      {shopItems.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`product-tile ${shopPick?.id === p.id ? "picked" : ""}`}
                          disabled={shopBusy}
                          onClick={() => runShop(p.id)}
                        >
                          <div className="product-visual">
                            <img src={p.image} alt="" loading="lazy" />
                          </div>
                          <div className="product-info">
                            <strong>{p.title}</strong>
                            <span>{p.blurb}</span>
                            <em>${p.price}</em>
                          </div>
                        </button>
                      ))}
                      {shopItems.length === 0 && (
                        <p className="empty-hint" style={{ gridColumn: "1 / -1" }}>
                          No matches — try another category.
                        </p>
                      )}
                    </div>

                    {shopPick && (
                      <div className={`checkout-sheet ${shopPick.blocked ? "blocked" : "ok"}`}>
                        <div className="checkout-head">
                          <strong>{shopPick.title}</strong>
                          <span>${shopPick.price}</span>
                        </div>
                        <p>{shopPick.blocked ? "Purchase held" : "Looks good"} — {shopPick.reason}</p>
                        {shopPick.blocked && (
                          <button
                            className="btn soft"
                            type="button"
                            onClick={async () => {
                              try {
                                const a = await api.analyticsAsk(
                                  "Why was Everyday Runners blocked?"
                                );
                                if (a.ok || a.answer) {
                                  setWhy({
                                    headline: a.headline || "Analytics Agent",
                                    because: `${a.answer || ""}${
                                      a.skills?.length
                                        ? ` · skills: ${a.skills.join(", ")}`
                                        : ""
                                    }${a.via ? ` · via ${a.via}` : ""}`,
                                  });
                                  return;
                                }
                              } catch {
                                /* fall through to lineage explain */
                              }
                              const e = await api.explainLatestBlock();
                              if (e.ok) setWhy({ headline: e.headline, because: e.because });
                              else setToast(e.because);
                            }}
                          >
                            Why was this blocked?
                          </button>
                        )}
                        {why && shopPick.blocked && (
                          <div className="why-inline">
                            <strong>{why.headline}</strong>
                            <p>{why.because}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {toast && <p className="toast">{toast}</p>}
                  </div>
                </div>
              )}

              {app === "wellness" && (
                <div className="app-screen skin-well">
                  <div className="scroll app-pad">
                    <div className="app-nav">
                      <div>
                        <p className="app-kicker">Wellness</p>
                        <h1 className="app-title">Private</h1>
                      </div>
                      <button className="back" type="button" onClick={() => setApp("home")}>
                        ˅
                      </button>
                    </div>

                    <div className="privacy-banner">
                      <span className="lock" aria-hidden>
                        ●
                      </span>
                      <div>
                        <strong>Only you — and apps you allow</strong>
                        <p>Shop cannot read these notes unless you open the door.</p>
                      </div>
                    </div>

                    <div className="well-compose">
                      <textarea
                        rows={3}
                        placeholder="How are you feeling? Allergies, routines…"
                        value={healthNote}
                        onChange={(e) => setHealthNote(e.target.value)}
                      />
                      <div className="chip-row">
                        {WELL_CHIPS.map((c) => (
                          <button key={c} type="button" onClick={() => setHealthNote(c)}>
                            {c}
                          </button>
                        ))}
                      </div>
                      <button className="btn" type="button" onClick={saveHealth} disabled={!healthNote.trim()}>
                        Save privately
                      </button>
                    </div>

                    <div className="section-head">
                      <h2>Your notes</h2>
                      <span className="count-pill">{healthNotes.length}</span>
                    </div>
                    <div className="well-list">
                      {healthNotes.length === 0 && (
                        <p className="empty-hint">Nothing saved yet. Tap a chip or write a note.</p>
                      )}
                      {healthNotes.map((n) => (
                        <div className="well-note" key={n.id}>
                          <p>{n.note}</p>
                          <span>Private</span>
                          <small className="prov">{n.provenance}</small>
                        </div>
                      ))}
                    </div>
                    {toast && <p className="toast">{toast}</p>}
                  </div>
                </div>
              )}
            </div>

            <div className="home-bar">
              <button
                type="button"
                aria-label="Home"
                className={app === "home" && homeTab === "today" ? "on" : ""}
                onClick={() => {
                  setApp("home");
                  setHomeTab("today");
                }}
              >
                <IconHome />
              </button>
              <button
                type="button"
                aria-label="Apps"
                className={app === "home" && homeTab === "apps" ? "on" : ""}
                onClick={() => {
                  setApp("home");
                  setHomeTab("apps");
                }}
              >
                <IconApps />
              </button>
              <button
                type="button"
                aria-label="Voice"
                className={app === "voice" ? "on" : ""}
                onClick={() => void openApp("voice")}
              >
                <IconVoice />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------------ */
/* Live Fact Graph — everything Residence has written into DataHub,   */
/* rendered as agents → facts → lineage with sensitivity gates.       */
/* ------------------------------------------------------------------ */

const TERM_ORDER = ["Budget", "Health Condition", "Commitment", "Intent", "Location"];
const G_W = 336;
const G_FACT_X = 132;
const G_FACT_W = 196;
const G_AGENT_X = 4;
const G_AGENT_W = 112;
const G_NODE_H = 30;
const G_GAP = 8;

type GraphPos = { x: number; y: number; w: number; h: number };

function graphLayout(data: GraphResponse) {
  const facts = data.nodes.filter((n) => n.kind === "fact");
  const agents = data.nodes.filter((n) => n.kind === "agent");
  const pos = new Map<string, GraphPos>();
  const termLabels: Array<{ term: string; y: number; count: number }> = [];

  let y = 8;
  for (const term of TERM_ORDER) {
    const group = facts
      .filter((f) => f.glossaryTerm === term)
      .sort((a, b) => (a.assertedAt || "").localeCompare(b.assertedAt || ""));
    if (group.length === 0) continue;
    termLabels.push({ term, y: y + 10, count: group.length });
    y += 18;
    for (const f of group) {
      pos.set(f.id, { x: G_FACT_X, y, w: G_FACT_W, h: G_NODE_H });
      y += G_NODE_H + G_GAP;
    }
    y += 10;
  }
  const height = Math.max(y + 4, agents.length * (G_NODE_H + 26) + 16);
  agents.forEach((a, i) => {
    const ay = 12 + (i * (height - 60)) / Math.max(1, agents.length - 1 || 1);
    pos.set(a.id, { x: G_AGENT_X, y: ay, w: G_AGENT_W, h: G_NODE_H + 8 });
  });
  return { facts, agents, pos, termLabels, height };
}

function GraphView({
  data,
  busy,
  err,
  onRefresh,
}: {
  data: GraphResponse | null;
  busy: boolean;
  err: string;
  onRefresh: () => void;
}) {
  const [sel, setSel] = useState<GraphNode | null>(null);
  const [history, setHistory] = useState<Awaited<
    ReturnType<typeof api.factHistory>
  > | null>(null);
  const [glossary, setGlossary] = useState<
    Array<{ name: string; activeCount: number; factCount: number }>
  >([]);

  useEffect(() => {
    api
      .glossary()
      .then((g) => {
        if (g.ok) setGlossary(g.terms.map((t) => ({ name: t.name, activeCount: t.activeCount, factCount: t.factCount })));
      })
      .catch(() => {});
  }, [data?.generatedAt]);

  useEffect(() => {
    setHistory(null);
    if (!sel || sel.kind !== "fact") return;
    let alive = true;
    api
      .factHistory(sel.id)
      .then((h) => {
        if (alive && h.ok) setHistory(h);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sel]);

  const layout = useMemo(() => (data ? graphLayout(data) : null), [data]);

  if (busy && !data) {
    return (
      <div className="frame graph-frame">
        <div className="eyebrow">Context graph</div>
        <p className="empty-hint">Reading the graph from DataHub…</p>
      </div>
    );
  }
  if (err && !data) {
    return (
      <div className="frame graph-frame">
        <div className="eyebrow">Context graph</div>
        <p className="empty-hint">Couldn’t load the graph — {err}</p>
        <button className="btn soft" type="button" onClick={onRefresh}>
          Retry
        </button>
      </div>
    );
  }
  if (!data || !layout) return null;

  const { facts, agents, pos, termLabels, height } = layout;
  const lineage = data.edges.filter((e) => e.type === "lineage");
  const ownership = data.edges.filter((e) => e.type === "ownership");
  const healthReaders = agents.filter((a) => (a.readScopes || []).includes("health"));

  const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  return (
    <>
      <div className="frame graph-frame">
        <div className="graph-head">
          <div>
            <div className="eyebrow">Context graph · live from DataHub</div>
            <p className="graph-meta">
              {data.meta.factCount} facts · {data.meta.lineageEdgeCount} lineage edges ·{" "}
              {data.meta.agentCount} agents · Personal Context domain
            </p>
          </div>
          <button className="text-btn" type="button" onClick={onRefresh} disabled={busy}>
            {busy ? "…" : "Refresh"}
          </button>
        </div>

        {glossary.length > 0 && (
          <div className="gloss-strip" aria-label="Glossary">
            {glossary.map((t) => (
              <span key={t.name}>
                <strong>{t.name}</strong>
                <em>{t.activeCount}</em>
              </span>
            ))}
          </div>
        )}

        {facts.length === 0 ? (
          <p className="empty-hint">
            No facts yet — run the 30s demo or speak to Voice, then come back.
          </p>
        ) : (
          <svg
            className="graph-svg"
            viewBox={`0 0 ${G_W} ${height}`}
            width="100%"
            role="img"
            aria-label="Fact graph"
          >
            <defs>
              <marker
                id="garrow"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="#0c0c0c" />
              </marker>
            </defs>

            {/* ownership: agent → fact */}
            {ownership.map((e) => {
              const a = pos.get(e.source);
              const f = pos.get(e.target);
              if (!a || !f) return null;
              const x1 = a.x + a.w;
              const y1 = a.y + a.h / 2;
              const x2 = f.x;
              const y2 = f.y + f.h / 2;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={e.id}
                  className="gedge own"
                  d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                />
              );
            })}

            {/* lineage: fact → fact, bulge right */}
            {lineage.map((e) => {
              const s = pos.get(e.source);
              const t = pos.get(e.target);
              if (!s || !t) return null;
              const x1 = s.x + s.w;
              const y1 = s.y + s.h / 2;
              const x2 = t.x + t.w;
              const y2 = t.y + t.h / 2;
              const bulge = G_W - 2;
              return (
                <path
                  key={e.id}
                  className={`gedge lin ${e.subtype === "SUPERSEDES" ? "sup" : ""}`}
                  markerEnd="url(#garrow)"
                  d={`M${x1},${y1} C${bulge},${y1} ${bulge},${y2} ${x2},${y2}`}
                />
              );
            })}

            {termLabels.map((t) => (
              <text key={t.term} className="gterm" x={G_FACT_X} y={t.y}>
                {t.term.toUpperCase()} · {t.count}
              </text>
            ))}

            {agents.map((a, i) => {
              const p = pos.get(a.id);
              if (!p) return null;
              return (
                <g
                  key={a.id}
                  className="gnode gagent"
                  style={{ animationDelay: `${i * 60}ms` }}
                  onClick={() => setSel(a)}
                >
                  <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="2" />
                  <text x={p.x + 7} y={p.y + 15}>
                    {short(a.label, 15)}
                  </text>
                  <text className="gsub" x={p.x + 7} y={p.y + 28}>
                    reads: {(a.readScopes || []).join(", ") || "none"}
                  </text>
                </g>
              );
            })}

            {facts.map((f, i) => {
              const p = pos.get(f.id);
              if (!p) return null;
              const superseded = f.certificationStatus === "superseded";
              return (
                <g
                  key={f.id}
                  className={`gnode gfact ${superseded ? "old" : ""} ${
                    sel?.id === f.id ? "sel" : ""
                  } ${f.sensitivityTag === "health" ? "sens-health" : ""} ${
                    f.sensitivityTag === "financial" ? "sens-fin" : ""
                  }`}
                  style={{ animationDelay: `${i * 45}ms` }}
                  onClick={() => setSel(f)}
                >
                  <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="2" />
                  <text x={p.x + 8} y={p.y + 13}>
                    {short(f.label)}
                  </text>
                  <text className="gsub" x={p.x + 8} y={p.y + 25}>
                    {f.agentId} · {f.certificationStatus}
                    {f.stale ? " · stale" : ""}
                  </text>
                  {(f.sensitivityTag === "health" || f.sensitivityTag === "financial") && (
                    <rect
                      className="gsens"
                      x={p.x + p.w - 12}
                      y={p.y + 5}
                      width="7"
                      height="7"
                    />
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {sel && (
        <div className="frame graph-detail">
          <div className="graph-head">
            <div className="eyebrow">
              {sel.kind === "agent" ? "Agent" : sel.glossaryTerm || "Fact"}
            </div>
            <button className="text-btn" type="button" onClick={() => setSel(null)}>
              Close
            </button>
          </div>
          <p className="graph-sel-label">{sel.label}</p>
          {sel.kind === "agent" ? (
            <p className="mono-line">
              reads: {(sel.readScopes || []).join(", ") || "none"} · writes:{" "}
              {(sel.writeScopes || []).join(", ") || "none"}
            </p>
          ) : (
            <>
              <p className="mono-line">
                {sel.certificationStatus} · confidence {(sel.confidence ?? 0).toFixed(2)} ·{" "}
                {sel.sensitivityTag === "none" ? "public" : sel.sensitivityTag}
              </p>
                              <p className="mono-line urn">{sel.urn}</p>
              {sel.datahubUrl && (
                <a
                  className="text-btn dh-link"
                  href={sel.datahubUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in DataHub →
                </a>
              )}
              {history && history.chain.length > 1 && (
                <div className="hist">
                  <div className="eyebrow">History · supersede chain</div>
                  {history.chain.map((h) => (
                    <div key={h.factId} className={`hist-row ${h.isCurrent ? "cur" : ""}`}>
                      <span className="hist-dot" />
                      <span>
                        <strong>{short(h.decisionLabel || h.value, 34)}</strong>
                        <small>
                          {h.assertedBy} · {h.certificationStatus} ·{" "}
                          {new Date(h.assertedAt).toLocaleString()}
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="frame privacy-matrix">
        <div className="eyebrow">Sensitivity gate · who can read Health</div>
        <p className="graph-meta">
          {healthReaders.length} of {agents.length} agents can read health facts. The rest are
          blocked by DataHub read scopes — not by app promises.
        </p>
        <div className="pm-rows">
          {agents.map((a) => {
            const canHealth = (a.readScopes || []).includes("health");
            const canFin = (a.readScopes || []).includes("financial");
            return (
              <div className="pm-row" key={a.id}>
                <strong>{a.label}</strong>
                <span className={canFin ? "yes" : "no"}>financial {canFin ? "✓" : "✕"}</span>
                <span className={canHealth ? "yes" : "no"}>health {canHealth ? "✓" : "✕"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
