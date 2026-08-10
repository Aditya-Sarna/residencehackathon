"""No-API-key real-world services: OpenStreetMap/Nominatim + Open-Meteo."""

from __future__ import annotations

import logging
from typing import Any, Optional
from urllib.parse import quote

import httpx

log = logging.getLogger("residence.public_apps")

UA = {"User-Agent": "ResidenceHackathon/1.0 (personal context demo)"}


def search_places(query: str, limit: int = 6) -> dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"ok": False, "error": "empty_query", "results": []}
    try:
        r = httpx.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": q, "format": "json", "limit": limit, "addressdetails": 1},
            headers=UA,
            timeout=15,
        )
        r.raise_for_status()
        rows = r.json() if isinstance(r.json(), list) else []
        results = []
        for row in rows:
            lat = float(row["lat"])
            lon = float(row["lon"])
            name = row.get("display_name") or q
            short = name.split(",")[0]
            results.append(
                {
                    "id": str(row.get("place_id") or f"{lat},{lon}"),
                    "name": short,
                    "label": name,
                    "lat": lat,
                    "lon": lon,
                    "kind": (row.get("type") or row.get("class") or "place"),
                    "embedUrl": (
                        "https://www.openstreetmap.org/export/embed.html?"
                        f"bbox={lon - 0.02}%2C{lat - 0.015}%2C{lon + 0.02}%2C{lat + 0.015}"
                        f"&layer=mapnik&marker={lat}%2C{lon}"
                    ),
                    "openStreetMapUrl": f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=15/{lat}/{lon}",
                    "googleMapsUrl": f"https://www.google.com/maps/search/?api=1&query={quote(name)}",
                    "appleMapsUrl": f"https://maps.apple.com/?q={quote(name)}&ll={lat},{lon}",
                }
            )
        return {"ok": True, "query": q, "results": results, "residenceConnected": True}
    except Exception as e:
        log.warning("maps search failed: %s", e)
        return {"ok": False, "error": str(e), "results": []}


def weather_for(lat: float, lon: float, place: Optional[str] = None) -> dict[str, Any]:
    try:
        r = httpx.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
                "timezone": "auto",
                "forecast_days": 5,
            },
            headers=UA,
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        current = data.get("current") or {}
        daily = data.get("daily") or {}
        code = int(current.get("weather_code") or 0)
        days = []
        times = daily.get("time") or []
        for i, day in enumerate(times[:5]):
            days.append(
                {
                    "date": day,
                    "code": (daily.get("weather_code") or [0])[i],
                    "label": _wmo_label((daily.get("weather_code") or [0])[i]),
                    "high": (daily.get("temperature_2m_max") or [None])[i],
                    "low": (daily.get("temperature_2m_min") or [None])[i],
                    "precip": (daily.get("precipitation_sum") or [0])[i],
                }
            )
        return {
            "ok": True,
            "place": place or f"{lat:.2f}, {lon:.2f}",
            "lat": lat,
            "lon": lon,
            "current": {
                "temp": current.get("temperature_2m"),
                "humidity": current.get("relative_humidity_2m"),
                "wind": current.get("wind_speed_10m"),
                "code": code,
                "label": _wmo_label(code),
            },
            "daily": days,
            "source": "Open-Meteo",
            "residenceConnected": True,
        }
    except Exception as e:
        log.warning("weather failed: %s", e)
        return {"ok": False, "error": str(e)}


def weather_for_query(query: str) -> dict[str, Any]:
    places = search_places(query, limit=1)
    if not places.get("results"):
        return {"ok": False, "error": places.get("error") or "place_not_found"}
    p = places["results"][0]
    return weather_for(p["lat"], p["lon"], place=p["name"])


def _wmo_label(code: int) -> str:
    if code == 0:
        return "Clear"
    if code in (1, 2, 3):
        return "Partly cloudy"
    if code in (45, 48):
        return "Fog"
    if code in (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82):
        return "Rain"
    if code in (71, 73, 75, 77, 85, 86):
        return "Snow"
    if code in (95, 96, 99):
        return "Storm"
    return "Cloudy"
