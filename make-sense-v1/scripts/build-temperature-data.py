#!/usr/bin/env python3
"""
Build local temperature assets for Make Sense.

- Series: NASA GISTEMP v4 LOTI Direct CSV (global monthly *anomalies*)
- Grid:   NCEP/NCAR Reanalysis monthly mean air temperature (*absolute* °C)

Writes:
  public/data/temperature.json
  public/data/temperature-grid.bin  (Int16 LE, °C × 100)
"""

from __future__ import annotations

import json
import sys
from datetime import timezone
from datetime import datetime
from pathlib import Path

import numpy as np
import netCDF4 as nc

try:
    from scipy.ndimage import zoom as ndi_zoom
except ImportError:
    ndi_zoom = None

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp" / "gistemp"
OUT_JSON = ROOT / "public" / "data" / "temperature.json"
OUT_BIN = ROOT / "public" / "data" / "temperature-grid.bin"

YEAR_START = 2000
YEAR_END = 2025
SCALE = 0.01
MISSING = 32767
# NCEP is already 2.5° — keep native for a smaller, faster local pack
UPSAMPLE = 1


def parse_gistemp_csv(path: Path) -> dict[str, float]:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
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


def upsample_field(filled: np.ndarray, factor: int) -> np.ndarray:
    if factor <= 1:
        return filled
    mask = np.isfinite(filled)
    if not mask.any():
        return np.full(
            (filled.shape[0] * factor, filled.shape[1] * factor),
            np.nan,
            dtype=np.float64,
        )
    work = filled.copy()
    mean = float(np.nanmean(filled))
    work[~mask] = mean
    if ndi_zoom is not None:
        up = ndi_zoom(work, zoom=factor, order=3, mode="nearest")
        mask_up = (
            ndi_zoom(mask.astype(np.float64), zoom=factor, order=0, mode="nearest")
            > 0.5
        )
        up[~mask_up] = np.nan
        return up
    return np.repeat(np.repeat(work, factor, axis=0), factor, axis=1)


def extract_ncep_absolute(path: Path) -> tuple[dict, bytes, list[str]]:
    ds = nc.Dataset(str(path))
    air = ds.variables["air"]
    lat = np.asarray(ds.variables["lat"][:], dtype=np.float64)
    lon = np.asarray(ds.variables["lon"][:], dtype=np.float64)
    times = nc.num2date(
        ds.variables["time"][:],
        ds.variables["time"].units,
        only_use_cftime_datetimes=False,
        only_use_python_datetimes=True,
    )

    # Lon 0..360 → -180..180, sorted
    lon_shifted = ((lon + 180.0) % 360.0) - 180.0
    lon_order = np.argsort(lon_shifted)
    lon = lon_shifted[lon_order]

    # Lat is N→S in NCEP; flip to S→N
    flip_lat = lat[0] > lat[-1]
    if flip_lat:
        lat = lat[::-1]

    keys: list[str] = []
    chunks: list[bytes] = []
    n_lat_out = n_lon_out = None

    for i, d in enumerate(times):
        if d.year < YEAR_START or d.year > YEAR_END:
            continue
        key = f"{d.year}-{d.month:02d}"
        arr = np.asarray(air[i], dtype=np.float64)
        arr = arr[:, lon_order]
        if flip_lat:
            arr = arr[::-1, :]

        up = upsample_field(arr, UPSAMPLE)
        if n_lat_out is None:
            n_lat_out, n_lon_out = up.shape

        scaled = np.full(up.shape, MISSING, dtype=np.int16)
        finite = np.isfinite(up)
        scaled[finite] = np.clip(np.rint(up[finite] / SCALE), -32000, 32000).astype(
            np.int16
        )
        keys.append(key)
        chunks.append(scaled.tobytes())

    if not keys:
        raise RuntimeError("No NCEP months extracted for requested years")

    dlat = float(np.median(np.diff(lat))) if len(lat) > 1 else 2.5
    dlon = float(np.median(np.diff(lon))) if len(lon) > 1 else 2.5
    lat_min = float(lat[0] - dlat / 2)
    lat_max = float(lat[-1] + dlat / 2)
    lon_min = float(lon[0] - dlon / 2)
    lon_max = float(lon[-1] + dlon / 2)

    meta = {
        "nLat": int(n_lat_out),
        "nLon": int(n_lon_out),
        "latMin": lat_min,
        "latMax": lat_max,
        "lonMin": lon_min,
        "lonMax": lon_max,
        "cellSize": abs(dlat) / UPSAMPLE,
        "scale": SCALE,
        "missing": MISSING,
        "rowOrder": "south_to_north",
        "colOrder": "west_to_east",
        "upsample": UPSAMPLE,
        "nativeCellSize": abs(dlat),
        "unit": "degC",
        "quantity": "absolute",
    }
    return meta, b"".join(chunks), keys


def main() -> int:
    csv_path = TMP / "GLB.Ts+dSST.csv"
    nc_path = TMP / "air.mon.mean.nc"
    if not csv_path.exists():
        print(f"Missing {csv_path}", file=sys.stderr)
        return 1
    if not nc_path.exists():
        print(f"Missing {nc_path}", file=sys.stderr)
        return 1

    series = parse_gistemp_csv(csv_path)
    grid_meta, blob, keys = extract_ncep_absolute(nc_path)

    payload = {
        "meta": {
            "seriesSource": "NASA GISTEMP v4 Land-Ocean Temperature Index (Direct CSV)",
            "seriesUrl": "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
            "seriesBaseline": "1951–1980",
            "seriesQuantity": "anomaly",
            "gridSource": "NCEP/NCAR Reanalysis monthly mean air temperature (absolute °C)",
            "gridUrl": "https://downloads.psl.noaa.gov/Datasets/ncep.reanalysis.derived/surface/air.mon.mean.nc",
            "gridQuantity": "absolute",
            "note": "Map colors use absolute air temperature (°C). The panel readout still shows GISTEMP global anomaly.",
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
            "encoding": "int16-le",
            "bin": "temperature-grid.bin",
        },
    }

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    OUT_BIN.write_bytes(blob)

    print(
        f"Wrote {OUT_JSON.name} ({OUT_JSON.stat().st_size / 1024:.1f} KB) + "
        f"{OUT_BIN.name} ({OUT_BIN.stat().st_size / (1024 * 1024):.2f} MB)"
    )
    print(
        f"Series months: {len(series)} · Grid months: {len(keys)} · "
        f"{grid_meta['nLat']}×{grid_meta['nLon']} (~{grid_meta['cellSize']}°) absolute °C"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
