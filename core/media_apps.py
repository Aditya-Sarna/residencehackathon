"""No-API-key media: YouTube search via public Invidious/Piped mirrors."""

from __future__ import annotations

import logging
from typing import Any, Optional
from urllib.parse import quote

import httpx

log = logging.getLogger("residence.media")

UA = {"User-Agent": "ResidenceHackathon/1.0 (personal context demo)"}

INVIDIOUS = [
    "https://invidious.flokinet.to",
    "https://invidious.projectsegfau.lt",
    "https://invidious.slipfox.xyz",
    "https://inv.tux.pizza",
    "https://invidious.protokolla.fi",
    "https://yewtu.be",
    "https://inv.nadeko.net",
    "https://invidious.privacyredirect.com",
]

PIPED = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://pipedapi.syncpundit.io",
]


def _thumb(thumbs: Any) -> str:
    if isinstance(thumbs, list) and thumbs:
        # prefer medium quality
        best = sorted(
            thumbs,
            key=lambda t: int(t.get("width") or t.get("quality") or 0),
            reverse=True,
        )
        for t in best:
            if t.get("url"):
                return t["url"]
    if isinstance(thumbs, str):
        return thumbs
    return ""


def _from_invidious(query: str, limit: int) -> Optional[list[dict[str, Any]]]:
    for base in INVIDIOUS:
        try:
            r = httpx.get(
                f"{base}/api/v1/search",
                params={"q": query, "type": "video"},
                headers=UA,
                timeout=12,
                follow_redirects=True,
            )
            if r.status_code >= 400 or not r.content:
                continue
            try:
                rows = r.json()
            except Exception:
                continue
            if not isinstance(rows, list) or not rows:
                continue
            out = []
            for row in rows:
                if row.get("type") and row.get("type") != "video":
                    continue
                vid = row.get("videoId")
                if not vid:
                    continue
                out.append(
                    {
                        "id": vid,
                        "title": row.get("title") or "Video",
                        "author": row.get("author") or row.get("authorId") or "YouTube",
                        "views": row.get("viewCount") or row.get("viewCountText") or 0,
                        "length": row.get("lengthSeconds") or 0,
                        "published": row.get("publishedText") or "",
                        "thumbnail": _thumb(row.get("videoThumbnails"))
                        or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                        "embedUrl": f"https://www.youtube-nocookie.com/embed/{vid}?rel=0",
                        "watchUrl": f"https://www.youtube.com/watch?v={vid}",
                        "channelUrl": f"https://www.youtube.com/channel/{row.get('authorId')}"
                        if row.get("authorId")
                        else f"https://www.youtube.com/results?search_query={quote(str(row.get('author') or ''))}",
                    }
                )
                if len(out) >= limit:
                    break
            if out:
                return out
        except Exception as e:
            log.debug("invidious %s failed: %s", base, e)
    return None


def _from_piped(query: str, limit: int) -> Optional[list[dict[str, Any]]]:
    for base in PIPED:
        try:
            r = httpx.get(
                f"{base}/search",
                params={"q": query, "filter": "videos"},
                headers=UA,
                timeout=12,
                follow_redirects=True,
            )
            if r.status_code >= 400:
                continue
            data = r.json()
            items = data.get("items") if isinstance(data, dict) else data
            if not isinstance(items, list):
                continue
            out = []
            for row in items:
                if row.get("type") and "stream" not in str(row.get("type")).lower() and row.get("type") != "video":
                    # piped uses type "stream"
                    if row.get("type") != "stream":
                        continue
                vid = row.get("url", "").replace("/watch?v=", "").split("/")[-1] or row.get("id")
                if not vid or len(vid) < 6:
                    continue
                thumbs = row.get("thumbnail") or row.get("thumbnails")
                thumb = thumbs if isinstance(thumbs, str) else _thumb(thumbs)
                out.append(
                    {
                        "id": vid,
                        "title": row.get("title") or "Video",
                        "author": row.get("uploaderName") or row.get("uploader") or "YouTube",
                        "views": row.get("views") or 0,
                        "length": row.get("duration") or 0,
                        "published": row.get("uploadedDate") or "",
                        "thumbnail": thumb or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                        "embedUrl": f"https://www.youtube-nocookie.com/embed/{vid}?rel=0",
                        "watchUrl": f"https://www.youtube.com/watch?v={vid}",
                        "channelUrl": row.get("uploaderUrl")
                        or f"https://www.youtube.com/results?search_query={quote(str(row.get('uploaderName') or ''))}",
                    }
                )
                if len(out) >= limit:
                    break
            if out:
                return out
        except Exception as e:
            log.debug("piped %s failed: %s", base, e)
    return None


def youtube_search(query: str, limit: int = 12) -> dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"ok": False, "error": "empty_query", "results": []}
    limit = max(1, min(limit, 24))
    results = _from_invidious(q, limit) or _from_piped(q, limit)
    if not results:
        # Last-resort: structured deep links (still usable; UI shows open-on-YouTube cards)
        return {
            "ok": True,
            "query": q,
            "source": "youtube-web",
            "residenceConnected": True,
            "results": [
                {
                    "id": f"web-{i}",
                    "title": f"Search YouTube for “{q}”",
                    "author": "YouTube",
                    "views": 0,
                    "length": 0,
                    "published": "",
                    "thumbnail": "https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/hqdefault.webp",
                    "embedUrl": f"https://www.youtube.com/embed?listType=search&list={quote(q)}",
                    "watchUrl": f"https://www.youtube.com/results?search_query={quote(q)}",
                    "channelUrl": "https://www.youtube.com",
                }
                for i in range(1)
            ],
        }
    return {
        "ok": True,
        "query": q,
        "source": "youtube",
        "residenceConnected": True,
        "results": results,
    }


def fmt_duration(seconds: int) -> str:
    try:
        s = int(seconds)
    except Exception:
        return ""
    if s <= 0:
        return ""
    m, sec = divmod(s, 60)
    h, m = divmod(m, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"
