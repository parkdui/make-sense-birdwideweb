#!/usr/bin/env python3
"""
Build local temperature assets for Make Sense.

- Series: NASA GISTEMP v4 LOTI Direct CSV (global monthly anomalies)
- Grid:   HadCRUT5 analysis ensemble mean (5° × 5°) for the map layer

Writes:
  public/data/temperature.json
"""

from __future__ import annotations

import base64
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import netCDF4 as nc

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp" / "gistemp"
OUT = ROOT / "public" / "data" / "temperature.json"

YEAR_START = 2000
YEAR_END = 2025
MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]
SCALE = 0.01
MISSING = 32767


def parse_gistemp_csv(path: Path) -> dict[str, float]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    # Skip title row; find header with Year,Jan,...
    header_idx = next(
        (i for i, ln in enumerate(lines) if ln.startswith("Year,") and "Jan" in ln),
        None,
    )
    if header_idx is None:
        raise RuntimeError("GISTEMP CSV header not found")

    series: dict[str, float] = {}
    for ln in lines[header_idx + 1 :]:
        parts = ln.split(",")
        if len(parts) < 13:
            continue
        try:
            year = int(parts[0])
        except ValueError:
            continue
        if year < YEAR_START or year > YEAR_END:
            continue
        for month, raw in enumerate(parts[1:13], start=1):
            raw = raw.strip()
            if not raw or raw == "***":
                continue
            series[f"{year}-{month:02d}"] = round(float(raw), 2)
    return series


def extract_hadcrut_grid(path: Path) -> tuple[dict, bytes, list[str]]:
    ds = nc.Dataset(str(path))
    tas = ds.variables["tas_mean"]
    time = ds.variables["time"][:]
    lat = np.asarray(ds.variables["latitude"][:], dtype=np.float64)
    lon = np.asarray(ds.variables["longitude"][:], dtype=np.float64)

    origin = datetime(1850, 1, 1)
    keys: list[str] = []
    chunks: list[bytes] = []

    for i, t in enumerate(time):
        d = origin + timedelta(days=float(t))
        if d.year < YEAR_START or d.year > YEAR_END:
            continue
        key = f"{d.year}-{d.month:02d}"
        arr = np.ma.array(tas[i, :, :])
        filled = np.ma.filled(arr, np.nan).astype(np.float64)

        # Encode as Int16 ×0.01; missing → 32767
        scaled = np.full(filled.shape, MISSING, dtype=np.int16)
        finite = np.isfinite(filled)
        scaled[finite] = np.clip(
            np.rint(filled[finite] / SCALE), -32000, 32000
        ).astype(np.int16)
        keys.append(key)
        chunks.append(scaled.tobytes())

    if not keys:
        raise RuntimeError("No HadCRUT months extracted for requested years")

    # Cell centers → geographic extents for equirectangular image overlay
    dlat = float(np.median(np.diff(lat))) if len(lat) > 1 else 5.0
    dlon = float(np.median(np.diff(lon))) if len(lon) > 1 else 5.0
    lat_min = float(lat[0] - dlat / 2)
    lat_max = float(lat[-1] + dlat / 2)
    lon_min = float(lon[0] - dlon / 2)
    lon_max = float(lon[-1] + dlon / 2)

    meta = {
        "nLat": int(lat.shape[0]),
        "nLon": int(lon.shape[0]),
        "latMin": lat_min,
        "latMax": lat_max,
        "lonMin": lon_min,
        "lonMax": lon_max,
        "cellSize": 5,
        "scale": SCALE,
        "missing": MISSING,
        "rowOrder": "south_to_north",
        "colOrder": "west_to_east",
    }
    return meta, b"".join(chunks), keys


def main() -> int:
    csv_path = TMP / "GLB.Ts+dSST.csv"
    nc_path = TMP / "HadCRUT5.nc"
    if not csv_path.exists():
        print(f"Missing {csv_path}", file=sys.stderr)
        return 1
    if not nc_path.exists():
        print(f"Missing {nc_path}", file=sys.stderr)
        return 1

    series = parse_gistemp_csv(csv_path)
    grid_meta, blob, keys = extract_hadcrut_grid(nc_path)

    payload = {
        "meta": {
            "seriesSource": "NASA GISTEMP v4 Land-Ocean Temperature Index (Direct CSV)",
            "seriesUrl": "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
            "seriesBaseline": "1951–1980",
            "gridSource": "HadCRUT.5.0.2.0 analysis anomalies ensemble mean",
            "gridUrl": "https://www.metoffice.gov.uk/hadobs/hadcrut5/",
            "gridBaseline": "1961–1990",
            "note": "Series drives the global anomaly readout; HadCRUT5 5° grid paints the map layer. Baselines differ slightly between products.",
            "yearStart": YEAR_START,
            "yearEnd": YEAR_END,
            "monthCount": len(keys),
            "seriesMonthCount": len(series),
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
        },
        "series": series,
        "grid": {
            **grid_meta,
            "keys": keys,
            "encoding": "int16-le-base64",
            "data": base64.b64encode(blob).decode("ascii"),
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    size_mb = OUT.stat().st_size / (1024 * 1024)
    print(f"Wrote {OUT} ({size_mb:.2f} MB)")
    print(f"Series months: {len(series)} · Grid months: {len(keys)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
