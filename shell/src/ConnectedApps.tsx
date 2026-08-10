import { useEffect, useState } from "react";
import { api, type InferNotification } from "./api";
import { IconMaps, IconNotes, IconWeather, IconYouTube } from "./icons";

type Place = Awaited<ReturnType<typeof api.mapsSearch>>["results"][number];
type Weather = Awaited<ReturnType<typeof api.weather>>;
type Note = { id: string; title: string; body: string; updatedAt: number };

const NOTES_KEY = "residence-notes-v1";

function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? (JSON.parse(raw) as Note[]) : [];
  } catch {
    return [];
  }
}

function saveNotes(notes: Note[]) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function ConnectedPill({ detail = "Residence connected" }: { detail?: string }) {
  return (
    <div className="conn-pill">
      <span className="dot on" />
      {detail}
    </div>
  );
}

function Nav({
  kicker,
  title,
  onBack,
}: {
  kicker: string;
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="app-nav">
      <div>
        <p className="app-kicker">{kicker}</p>
        <h1 className="app-title">{title}</h1>
      </div>
      <button className="back" type="button" onClick={onBack} aria-label="Back">
        ←
      </button>
    </div>
  );
}

export function MapsApp({
  onBack,
  onResidence,
}: {
  onBack: () => void;
  onResidence: (notes: InferNotification[], text: string) => void;
}) {
  const [q, setQ] = useState("coffee shop");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [picked, setPicked] = useState<Place | null>(null);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const out = await api.mapsSearch(q.trim());
      setResults(out.results);
      setPicked(out.results[0] || null);
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/i, ""));
    } finally {
      setBusy(false);
    }
  };

  const handoff = async (place: Place) => {
    setPicked(place);
    const text = `I'm going to ${place.name} tomorrow`;
    try {
      const out = await api.appsListen(text, "maps");
      const notes = (out.notifications || []).map((n) =>
        n.actionApp === "calendar"
          ? {
              ...n,
              title: "Add this place to Calendar?",
              body: place.name,
              payload: {
                ...n.payload,
                title: `Visit ${place.name}`,
                text: place.label,
              },
            }
          : n
      );
      onResidence(
        notes.length
          ? notes
          : [
              {
                fromApp: "calendar",
                fromLabel: "Calendar",
                color: "#0c0c0c",
                title: "Add this place to Calendar?",
                body: place.name,
                actionApp: "calendar",
                payload: {
                  title: `Visit ${place.name}`,
                  dayOfMonth: "",
                  text: place.label,
                },
                confidence: 0.85,
                type: "calendar.place",
              },
            ],
        text
      );
    } catch {
      onResidence(
        [
          {
            fromApp: "calendar",
            fromLabel: "Calendar",
            color: "#0c0c0c",
            title: "Add this place to Calendar?",
            body: place.name,
            actionApp: "calendar",
            payload: {
              title: `Visit ${place.name}`,
              dayOfMonth: "",
              text: place.label,
            },
            confidence: 0.85,
            type: "calendar.place",
          },
        ],
        text
      );
    }
  };

  return (
    <div className="app-screen skin-maps">
      <div className="scroll app-pad">
        <Nav kicker="Maps" title="Explore." onBack={onBack} />
        <ConnectedPill detail="OpenStreetMap · Residence connected" />
        <div className="search-bar">
          <span aria-hidden>
            <IconMaps />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search real places…"
            onKeyDown={(e) => e.key === "Enter" && void search()}
          />
        </div>
        <button className="btn" type="button" disabled={busy} onClick={search}>
          {busy ? "Searching…" : "Search"}
        </button>
        {picked && (
          <div className="map-frame">
            <iframe title={picked.name} src={picked.embedUrl} loading="lazy" />
            <div className="map-caption">
              <strong>{picked.name}</strong>
              <span>{picked.kind}</span>
            </div>
            <div className="map-actions">
              <button type="button" className="btn" onClick={() => handoff(picked)}>
                Ask Residence
              </button>
              <a className="btn soft" href={picked.googleMapsUrl} target="_blank" rel="noreferrer">
                Open Google Maps
              </a>
            </div>
          </div>
        )}
        <div className="place-list">
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`place-row ${picked?.id === p.id ? "on" : ""}`}
              onClick={() => setPicked(p)}
            >
              <IconMaps />
              <span>
                <strong>{p.name}</strong>
                <small>{p.label}</small>
              </span>
            </button>
          ))}
        </div>
        {err && <p className="toast">{err}</p>}
      </div>
    </div>
  );
}

export function NotesApp({
  onBack,
  onResidence,
}: {
  onBack: () => void;
  onResidence: (notes: InferNotification[], text: string) => void;
}) {
  const [notes, setNotes] = useState<Note[]>(() => loadNotes());
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    saveNotes(notes);
  }, [notes]);

  const select = (n: Note) => {
    setActiveId(n.id);
    setTitle(n.title);
    setBody(n.body);
  };

  const save = async () => {
    const t = title.trim() || "Untitled";
    const b = body.trim();
    if (!b && !title.trim()) return;
    const id = activeId || `${Date.now()}`;
    const next: Note = { id, title: t, body: b, updatedAt: Date.now() };
    setNotes((prev) => {
      const rest = prev.filter((x) => x.id !== id);
      return [next, ...rest].sort((a, c) => c.updatedAt - a.updatedAt);
    });
    setActiveId(id);
    setBusy(true);
    try {
      const text = [t, b].filter(Boolean).join(". ");
      const out = await api.appsListen(text, "notes");
      if (out.notifications?.length) onResidence(out.notifications, text);
    } catch {
      /* local only */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-screen skin-notes">
      <div className="scroll app-pad">
        <Nav kicker="Notes" title="Library." onBack={onBack} />
        <ConnectedPill detail="On-device · Residence listens" />
        <div className="section-head">
          <h2>Editor</h2>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setActiveId(null);
              setTitle("");
              setBody("");
            }}
          >
            + New
          </button>
        </div>
        <div className="notes-editor">
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea
            rows={5}
            placeholder='e.g. "Study for exam tomorrow"'
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button className="btn" type="button" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        <div className="section-head">
          <h2>Yours</h2>
          <span className="count-pill">{notes.length}</span>
        </div>
        <div className="notes-list">
          {notes.length === 0 && <p className="empty-hint">No notes yet.</p>}
          {notes.map((n) => (
            <button key={n.id} type="button" className="note-row" onClick={() => select(n)}>
              <IconNotes />
              <span>
                <strong>{n.title}</strong>
                <small>{n.body.slice(0, 72) || "Empty"}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WeatherApp({
  onBack,
  onResidence,
}: {
  onBack: () => void;
  onResidence: (notes: InferNotification[], text: string) => void;
}) {
  const [q, setQ] = useState("San Francisco");
  const [data, setData] = useState<Weather | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async (opts?: { q?: string; lat?: number; lon?: number }) => {
    setBusy(true);
    setErr("");
    try {
      const out = await api.weather(opts || { q });
      setData(out);
      const rainy =
        out.current.label.toLowerCase().includes("rain") ||
        out.current.label.toLowerCase().includes("storm");
      if (rainy) {
        onResidence(
          [
            {
              fromApp: "wellness",
              fromLabel: "Wellness",
              color: "#0c0c0c",
              title: "Save a weather note?",
              body: `${out.place}: ${out.current.label}, ${Math.round(out.current.temp)}°`,
              actionApp: "wellness",
              payload: { note: `Weather: ${out.current.label} in ${out.place}` },
              confidence: 0.8,
              type: "wellness.weather",
            },
          ],
          `weather ${out.current.label} in ${out.place}`
        );
      }
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/i, ""));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!navigator.geolocation) {
      void load({ q: "San Francisco" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => void load({ lat: pos.coords.latitude, lon: pos.coords.longitude, q: "Near you" }),
      () => void load({ q: "San Francisco" }),
      { timeout: 5000 }
    );
  }, []);

  return (
    <div className="app-screen skin-weather">
      <div className="scroll app-pad">
        <Nav kicker="Weather" title={`${data?.place || "Forecast"}.`} onBack={onBack} />
        <ConnectedPill detail="Open-Meteo · Residence connected" />
        <div className="search-bar">
          <span aria-hidden>
            <IconWeather />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="City…"
            onKeyDown={(e) => e.key === "Enter" && void load({ q })}
          />
        </div>
        <button className="btn" type="button" disabled={busy} onClick={() => load({ q })}>
          {busy ? "Updating…" : "Refresh"}
        </button>
        {data && (
          <>
            <div className="weather-hero">
              <div className="weather-temp">{Math.round(data.current.temp)}°</div>
              <div>
                <strong>{data.current.label}</strong>
                <p>
                  Humidity {Math.round(data.current.humidity)}% · Wind {Math.round(data.current.wind)}{" "}
                  km/h
                </p>
                <small>{data.source} · no API key</small>
              </div>
            </div>
            <div className="weather-days">
              {data.daily.map((d) => (
                <div className="weather-day" key={d.date}>
                  <strong>
                    {new Date(d.date + "T12:00:00").toLocaleDateString(undefined, {
                      weekday: "short",
                    })}
                  </strong>
                  <span>{d.label}</span>
                  <em>
                    {Math.round(d.high)}° / {Math.round(d.low)}°
                  </em>
                </div>
              ))}
            </div>
          </>
        )}
        {err && <p className="toast">{err}</p>}
      </div>
    </div>
  );
}

const YT_CHIPS = ["lofi study", "exam tips", "cooking basics", "indie playlist"];
type YtVideo = Awaited<ReturnType<typeof api.youtubeSearch>>["results"][number];
const YT_WATCHED_KEY = "residence-yt-watched-v1";

function loadWatched(): YtVideo[] {
  try {
    const raw = localStorage.getItem(YT_WATCHED_KEY);
    return raw ? (JSON.parse(raw) as YtVideo[]) : [];
  } catch {
    return [];
  }
}

export function YouTubeApp({
  onBack,
  onResidence,
}: {
  onBack: () => void;
  onResidence: (notes: InferNotification[], text: string) => void;
}) {
  const [q, setQ] = useState("lofi study");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<YtVideo[]>([]);
  const [active, setActive] = useState<YtVideo | null>(null);
  const [watched, setWatched] = useState<YtVideo[]>(() => loadWatched());
  const [source, setSource] = useState("");

  const search = async (query: string) => {
    const qq = query.trim();
    if (!qq) return;
    setQ(qq);
    setBusy(true);
    setErr("");
    try {
      const out = await api.youtubeSearch(qq, 10);
      setResults(out.results);
      setSource(out.source);
      setActive(out.results[0] || null);
      if (out.results[0]) remember(out.results[0]);
    } catch (e) {
      setErr(String(e).replace(/^Error:\s*/i, ""));
    } finally {
      setBusy(false);
    }
  };

  const remember = (v: YtVideo) => {
    setWatched((prev) => {
      const next = [v, ...prev.filter((x) => x.id !== v.id)].slice(0, 12);
      localStorage.setItem(YT_WATCHED_KEY, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    void search("lofi study");
  }, []);

  const askResidence = () => {
    if (!active) return;
    const text = `Watch “${active.title}” tomorrow evening`;
    onResidence(
      [
        {
          fromApp: "calendar",
          fromLabel: "Calendar",
          color: "#0c0c0c",
          title: "Add watch time to Calendar?",
          body: active.title,
          actionApp: "calendar",
          payload: {
            title: `Watch: ${active.title.slice(0, 48)}`,
            dayOfMonth: "",
            text,
          },
          confidence: 0.86,
          type: "calendar.watch",
        },
      ],
      text
    );
  };

  return (
    <div className="app-screen skin-yt">
      <div className="scroll app-pad">
        <Nav kicker="YouTube" title="Watch." onBack={onBack} />
        <ConnectedPill detail="Live results · no API key" />
        <div className="search-bar">
          <span aria-hidden>
            <IconYouTube />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search real videos…"
            onKeyDown={(e) => e.key === "Enter" && void search(q)}
          />
        </div>
        <button className="btn" type="button" disabled={busy} onClick={() => search(q)}>
          {busy ? "Searching…" : "Search"}
        </button>
        <div className="chip-row">
          {YT_CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              className={q === c ? "on" : ""}
              onClick={() => void search(c)}
            >
              {c}
            </button>
          ))}
        </div>

        {active && (
          <div className="map-frame yt-frame yt-player">
            <iframe
              title={active.title}
              src={active.embedUrl}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
            <div className="map-caption">
              <strong>{active.title}</strong>
              <span>
                {active.author}
                {active.lengthLabel ? ` · ${active.lengthLabel}` : ""}
                {source ? ` · ${source}` : ""}
              </span>
            </div>
            <div className="map-actions">
              <button type="button" className="btn" onClick={askResidence}>
                Ask Residence
              </button>
              <a className="btn soft" href={active.watchUrl} target="_blank" rel="noreferrer">
                Open on YouTube
              </a>
            </div>
          </div>
        )}

        <div className="section-head">
          <h2>Results</h2>
          <span className="count-pill">{results.length}</span>
        </div>
        <div className="yt-grid">
          {results.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`yt-card ${active?.id === v.id ? "on" : ""}`}
              onClick={() => {
                setActive(v);
                remember(v);
              }}
            >
              <img className="yt-thumb" src={v.thumbnail} alt="" loading="lazy" />
              <div className="yt-meta">
                <strong>{v.title}</strong>
                <small>
                  {v.author}
                  {v.lengthLabel ? ` · ${v.lengthLabel}` : ""}
                  {v.published ? ` · ${v.published}` : ""}
                </small>
              </div>
            </button>
          ))}
          {results.length === 0 && !busy && <p className="empty-hint">No results yet.</p>}
        </div>

        {watched.length > 0 && (
          <>
            <div className="section-head">
              <h2>Continue</h2>
              <span className="count-pill">{watched.length}</span>
            </div>
            <div className="yt-grid">
              {watched.slice(0, 4).map((v) => (
                <button
                  key={`w-${v.id}`}
                  type="button"
                  className="yt-card"
                  onClick={() => setActive(v)}
                >
                  <img className="yt-thumb" src={v.thumbnail} alt="" loading="lazy" />
                  <div className="yt-meta">
                    <strong>{v.title}</strong>
                    <small>{v.author}</small>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        {err && <p className="toast">{err}</p>}
      </div>
    </div>
  );
}
