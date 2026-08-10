import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DesktopPermission } from "../api";
import { cardFromPermission, type ContextCard } from "../browser/cardModel";
import { performWriteBack, type WriteTarget } from "../browser/writeBack";
import { extractSpotifyTrackId, getTrack, saveTrackToLibrary } from "../browser/spotifyApi";
import { spotifyAccessToken, spotifyConfigured } from "../browser/spotifyAuth";

type Props = {
  seed: DesktopPermission[];
  onCountChange?: (count: number) => void;
};

const DEST_ORDER: WriteTarget[] = ["calendar", "docs", "tasks"];
const DEST_LABEL: Record<WriteTarget, string> = {
  calendar: "Calendar",
  docs: "Doc",
  tasks: "Task",
  "facts-only": "Facts only",
};

function truncate(text: unknown, n: number) {
  const t = String(text || "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

type AcceptedEntry = {
  factId: string;
  permissionId: string;
  operationId?: string;
  title: string;
};

export default function AcceptPage({ seed, onCountChange }: Props) {
  const [cards, setCards] = useState<ContextCard[]>([]);
  const [dest, setDest] = useState<Record<string, WriteTarget>>({});
  const [note, setNote] = useState<Record<string, { text: string; live: boolean; link?: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [spotifyBusyId, setSpotifyBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [acceptStack, setAcceptStack] = useState<AcceptedEntry[]>([]);
  const [undoing, setUndoing] = useState(false);
  const seenSeed = useRef(new Set<string>());

  const mergeItems = useCallback((items: DesktopPermission[]) => {
    setCards((prev) => {
      const byId = new Map(prev.map((c) => [c.id, c]));
      for (const item of items) {
        if (item.status && item.status !== "pending") {
          byId.delete(item.id);
          continue;
        }
        byId.set(item.id, cardFromPermission(item));
      }
      return Array.from(byId.values()).sort((a, b) => (a.id < b.id ? 1 : -1));
    });
  }, []);

  useEffect(() => {
    if (!seed.length) return;
    const fresh = seed.filter((s) => !seenSeed.current.has(s.id));
    if (!fresh.length) return;
    fresh.forEach((s) => seenSeed.current.add(s.id));
    mergeItems(fresh);
  }, [seed, mergeItems]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.desktopPending("pending", 50);
      mergeItems(res.pending || []);
      setErr("");
    } catch {
      setErr("Core unreachable — start Core on :8700 to load the inbox.");
    } finally {
      setLoading(false);
    }
  }, [mergeItems]);

  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    onCountChange?.(cards.length);
  }, [cards.length, onCountChange]);

  const destFor = (card: ContextCard): WriteTarget => dest[card.id] || card.preferredDestination;

  const resolveCard = async (card: ContextCard, accept: boolean) => {
    const isContradiction = card.raw?.kind === "contradiction";
    const writeTarget: WriteTarget = isContradiction ? "docs" : destFor(card);
    // The Fact graph only distinguishes calendar-family vs notes-family —
    // Docs/Tasks both persist as a notes-family Fact; the real Google write
    // (Doc vs Task) happens client-side right after.
    const backendDestination = writeTarget === "calendar" ? "calendar" : "notes";
    setBusyId(card.id);
    setErr("");
    try {
      const resolved = await api.desktopResolve({
        id: card.id,
        accept,
        destination: accept ? backendDestination : null,
      });
      if (accept && resolved.factId) {
        setAcceptStack((s) =>
          [{ factId: resolved.factId!, permissionId: card.id, operationId: card.raw?.operationId, title: card.title }, ...s].slice(
            0,
            8
          )
        );
      }
      if (accept) {
        const result = await performWriteBack(writeTarget, {
          title: card.title,
          body: card.aiReading,
          whenLabel: card.whenLabel,
          dateISO: card.dateISO,
          startHhmm: card.startHhmm,
          url: card.url,
        });
        setNote((n) => ({ ...n, [card.id]: { text: result.message, live: result.live, link: result.link } }));
      }
      window.setTimeout(
        () => {
          setCards((prev) => prev.filter((c) => c.id !== card.id));
          setNote((n) => {
            const rest = { ...n };
            delete rest[card.id];
            return rest;
          });
        },
        accept ? 1400 : 200
      );
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setBusyId(null);
    }
  };

  const undoLast = async () => {
    const last = acceptStack[0];
    if (!last) return;
    setUndoing(true);
    setErr("");
    try {
      await api.desktopUndo({
        fact_id: last.factId,
        permission_id: last.permissionId,
        operation_id: last.operationId,
      });
      setAcceptStack((s) => s.slice(1));
    } catch (e) {
      setErr(String((e as Error).message || e));
    } finally {
      setUndoing(false);
    }
  };

  const saveSpotify = async (card: ContextCard, trackId: string) => {
    setSpotifyBusyId(card.id);
    try {
      if (!spotifyConfigured()) {
        setNote((n) => ({
          ...n,
          [card.id]: { text: "Spotify isn't configured — add VITE_SPOTIFY_CLIENT_ID to enable this.", live: false },
        }));
        return;
      }
      const token = await spotifyAccessToken();
      if (!token) {
        setNote((n) => ({
          ...n,
          [card.id]: { text: "Connect Spotify in Integrations first.", live: false },
        }));
        return;
      }
      const track = await getTrack(token, trackId);
      await saveTrackToLibrary(token, trackId);
      setNote((n) => ({
        ...n,
        [card.id]: { text: `Saved "${track.name}" by ${track.artists} to Liked Songs`, live: true, link: track.url },
      }));
    } catch (e) {
      setNote((n) => ({ ...n, [card.id]: { text: String((e as Error).message || e), live: false } }));
    } finally {
      setSpotifyBusyId(null);
    }
  };

  return (
    <div className="rw-page">
      <p className="rw-crumb">RESIDENCE / ACCEPT</p>
      <h1 className="rw-h1">Review, then write back.</h1>
      <p className="rw-lead">
        Residence proposes the next step for everything you capture. Accept writes it to the
        real app it belongs in — a live Google Calendar event, Doc, or Task. Decline leaves your
        Fact graph untouched.
      </p>

      {!loading && cards.length > 0 ? (
        <p className="rw-accept-summary">
          {cards.length} pending · every Accept writes into the same shared Fact graph the Mac
          app and every connected app read from.
        </p>
      ) : null}

      {acceptStack.length > 0 ? (
        <div className="rw-undo-bar">
          <span>
            Accepted "{truncate(acceptStack[0].title, 44)}"
            {acceptStack.length > 1 ? ` · +${acceptStack.length - 1} more this session` : ""}
          </span>
          <button type="button" className="rw-text-btn" disabled={undoing} onClick={() => void undoLast()}>
            {undoing ? "Undoing…" : "↺ Undo"}
          </button>
        </div>
      ) : null}

      {err ? <p className="rw-err">{err}</p> : null}

      {loading ? (
        <p className="rw-lead">Loading inbox…</p>
      ) : cards.length === 0 ? (
        <div className="rw-empty">
          <p className="rw-empty-title">Inbox zero.</p>
          <p className="rw-muted-note">
            Nothing is waiting for a decision — make a capture and it'll land here to Accept or
            Decline.
          </p>
        </div>
      ) : (
        <div className="rw-accept-list">
          {cards.map((card) => {
            const isContradiction = card.raw?.kind === "contradiction";
            const busy = busyId === card.id;
            const spotifyTrackId = extractSpotifyTrackId(`${card.url || ""} ${card.yourMessage || ""}`);
            const cardNote = note[card.id];
            return (
              <article
                key={card.id}
                className={`rw-accept-card ${isContradiction ? "is-contradiction" : ""} ${busy ? "is-busy" : ""}`}
              >
                <header className="rw-accept-top">
                  <span className="rw-accept-source">{card.sourceLabel}</span>
                  <span className="rw-accept-badge">
                    {card.badge}
                    <em>{card.confidence}%</em>
                  </span>
                </header>

                <h2 className="rw-accept-title">{card.title}</h2>

                {isContradiction ? (
                  <p className="rw-accept-conflict">
                    Was <b>{truncate(card.raw?.payload?.existing, 60)}</b> → now{" "}
                    <b>{truncate(card.raw?.payload?.incoming, 60)}</b>
                  </p>
                ) : (
                  <p className="rw-accept-reading">{card.aiReading}</p>
                )}

                {card.whenLabel ? <p className="rw-accept-when">{card.whenLabel}</p> : null}

                {card.tags.length ? (
                  <div className="rw-accept-tags">
                    {card.tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                ) : null}

                {!isContradiction && (
                  <div className="rw-dest-row" role="radiogroup" aria-label="Write back to">
                    {DEST_ORDER.map((d) => (
                      <button
                        key={d}
                        type="button"
                        role="radio"
                        aria-checked={destFor(card) === d}
                        className={destFor(card) === d ? "on" : ""}
                        onClick={() => setDest((prev) => ({ ...prev, [card.id]: d }))}
                      >
                        {DEST_LABEL[d]}
                      </button>
                    ))}
                  </div>
                )}

                {spotifyTrackId ? (
                  <button
                    type="button"
                    className="rw-text-btn rw-spotify-btn"
                    disabled={spotifyBusyId === card.id}
                    onClick={() => void saveSpotify(card, spotifyTrackId)}
                  >
                    {spotifyBusyId === card.id ? "Saving to Spotify…" : "♪ Save to Spotify Liked Songs"}
                  </button>
                ) : null}

                <div className="rw-accept-actions">
                  <button
                    type="button"
                    className="rw-circle accept"
                    disabled={busy}
                    aria-label={isContradiction ? "Accept new" : "Accept"}
                    title={isContradiction ? "Accept new" : "Accept"}
                    onClick={() => void resolveCard(card, true)}
                  >
                    ✓
                  </button>
                  <button
                    type="button"
                    className="rw-circle decline"
                    disabled={busy}
                    aria-label={isContradiction ? "Keep saved" : "Decline"}
                    title={isContradiction ? "Keep saved" : "Decline"}
                    onClick={() => void resolveCard(card, false)}
                  >
                    ✕
                  </button>
                </div>
                {isContradiction ? (
                  <p className="rw-accept-hint">✓ accept new · ✕ keep saved</p>
                ) : null}
                {cardNote ? (
                  <p className={`rw-accept-note ${cardNote.live ? "is-live" : "is-fallback"}`}>
                    {cardNote.link ? (
                      <a href={cardNote.link} target="_blank" rel="noreferrer">
                        {cardNote.text}
                      </a>
                    ) : (
                      cardNote.text
                    )}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
