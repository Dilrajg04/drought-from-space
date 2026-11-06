"""
Drought from Space: data pipeline
=================================
Pulls monthly MODIS/Terra NDVI imagery for the American West from NASA GIBS
(the access method listed in the DSC 106 Project 3 spec), converts pixel colors
back to NDVI values using the layer's official colormap, and writes the small
static files the D3 site loads.

Run from the repo root:
    pip install requests numpy pillow
    python pipeline/fetch_ndvi.py                 # full run, 2001-2025
    python pipeline/fetch_ndvi.py --start 2019 --end 2023   # quick test

Outputs (in data/):
    grid.json            growing-season (Apr-Sep) mean NDVI per 0.25 deg cell per year
    states_monthly.csv   monthly mean NDVI + anomaly per state and for the whole West
Raw PNGs are cached in pipeline/cache/ so re-runs are fast.
"""
import argparse
import io
import json
import re
import sys
import warnings
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
warnings.filterwarnings("ignore", category=RuntimeWarning)
import requests
from PIL import Image, ImageDraw

LAYER = "MODIS_Terra_L3_NDVI_Monthly"
WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
# GIBS shares one colormap file across all MODIS L3 NDVI layers
COLORMAP_URLS = [
    "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml",
    "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDVI.xml",
    f"https://gibs.earthdata.nasa.gov/colormaps/v1.3/{LAYER}.xml",
]

# Study area: the 11 western states
LON_MIN, LON_MAX = -125.0, -102.0
LAT_MIN, LAT_MAX = 31.0, 49.0
FINE = 0.05     # download resolution (deg), close to the source's native CMG grid
COARSE = 0.25   # grid cell size shown on the map (deg)
GROWING = [4, 5, 6, 7, 8, 9]   # Apr-Sep
BASELINE = (2001, 2020)        # anomaly reference period

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "pipeline" / "cache"
DATA = ROOT / "data"
STATES_GEOJSON = ROOT / "pipeline" / "west_states.geojson"
ABBR = {"Washington": "WA", "Oregon": "OR", "California": "CA", "Nevada": "NV",
        "Idaho": "ID", "Montana": "MT", "Wyoming": "WY", "Utah": "UT",
        "Colorado": "CO", "Arizona": "AZ", "New Mexico": "NM"}

REJECTED = [0, 0]  # [pixels with off-colormap colors, opaque pixels seen]
W = int(round((LON_MAX - LON_MIN) / FINE))
H = int(round((LAT_MAX - LAT_MIN) / FINE))


# ---------------------------------------------------------------- colormap
def _num(s):
    return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?(?:[eE]-?\d+)?", s or "")]


def load_colormap():
    """Return (rgb array Nx3, value array N) for the layer's data entries."""
    last = None
    for url in COLORMAP_URLS:
        try:
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            root = ET.fromstring(r.content)
            break
        except Exception as e:  # try the next version
            last = e
    else:
        sys.exit(f"Could not download the GIBS colormap: {last}")

    rgbs, vals = [], []
    for el in root.iter():
        if not el.tag.endswith("ColorMapEntry"):
            continue
        if el.get("transparent", "false").lower() == "true":
            continue
        label = (el.get("label") or "").lower()
        if "no data" in label or "fill" in label:
            continue
        nums = _num(el.get("value")) or _num(el.get("label"))
        nums = [n for n in nums if abs(n) < 1e6]  # drop +/-INF style bounds
        if not nums or not el.get("rgb"):
            continue
        rgbs.append([int(c) for c in el.get("rgb").split(",")[:3]])
        vals.append(sum(nums[:2]) / len(nums[:2]))   # bin midpoint
    print(f"Using colormap: {url}")
    if not rgbs:
        sys.exit("Colormap parsed but no data entries found; check the XML format.")
    vals = np.array(vals, dtype=float)
    print(f"Colormap: {len(vals)} bins, NDVI {vals.min():.2f} to {vals.max():.2f}")
    return np.array(rgbs, dtype=float), vals


def decode(img, cm_rgb, cm_val):
    """Map each RGBA pixel to the NDVI value of its nearest colormap color."""
    a = np.asarray(img.convert("RGBA"), dtype=float)
    rgb, alpha = a[..., :3].reshape(-1, 3), a[..., 3].reshape(-1)
    out = np.full(rgb.shape[0], np.nan)
    ok = alpha > 0
    if ok.any():
        # unique colors first: images use few distinct colors, so this is fast
        uniq, inv = np.unique(rgb[ok], axis=0, return_inverse=True)
        d = ((uniq[:, None, :] - cm_rgb[None, :, :]) ** 2).sum(-1)
        nearest = d.argmin(1)
        good = d.min(1) <= 30  # reject colors that don't belong to the colormap
        REJECTED[0] += int((~good[inv.reshape(-1)]).sum())
        REJECTED[1] += int(ok.sum())
        v = np.where(good, cm_val[nearest], np.nan)
        out[ok] = v[inv.reshape(-1)]
    return out.reshape(a.shape[0], a.shape[1])


# ---------------------------------------------------------------- download
def fetch_month(year, month):
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{year}-{month:02d}.png"
    if path.exists() and path.stat().st_size > 0:
        return year, month, path
    params = {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0",
        "LAYERS": LAYER, "STYLES": "", "CRS": "EPSG:4326",
        # WMS 1.3.0 + EPSG:4326 uses lat,lon axis order
        "BBOX": f"{LAT_MIN},{LON_MIN},{LAT_MAX},{LON_MAX}",
        "WIDTH": W, "HEIGHT": H, "FORMAT": "image/png", "TRANSPARENT": "TRUE",
        "TIME": f"{year}-{month:02d}-01",
    }
    try:
        r = requests.get(WMS, params=params, timeout=60)
    except requests.RequestException as e:
        return year, month, f"network error: {e}"
    if r.status_code != 200 or not r.headers.get("Content-Type", "").startswith("image"):
        return year, month, f"HTTP {r.status_code}: {r.text[:300]}"
    path.write_bytes(r.content)
    return year, month, path


# ---------------------------------------------------------------- state mask
def state_mask():
    """Rasterize the 11 state polygons onto the fine grid (0 = outside)."""
    gj = json.loads(STATES_GEOJSON.read_text())
    names = sorted(ABBR)                       # id 1..11
    img = Image.new("I", (W, H), 0)
    draw = ImageDraw.Draw(img)

    def px(lon, lat):
        return ((lon - LON_MIN) / FINE, (LAT_MAX - lat) / FINE)

    for f in gj["features"]:
        sid = names.index(f["properties"]["name"]) + 1
        geom = f["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            draw.polygon([px(*c) for c in poly[0]], fill=sid)
            for hole in poly[1:]:
                draw.polygon([px(*c) for c in hole], fill=0)
    return np.asarray(img), names


# ---------------------------------------------------------------- gap fill
def fill_gaps(arr, inside, passes=2):
    """Fill empty cells (e.g. image seams) with the mean of their valid neighbors.
    Only fills cells with at least 3 valid neighbors, so real data holes stay empty."""
    a = arr.copy()
    for _ in range(passes):
        holes = np.argwhere(np.isnan(a) & inside)
        if not len(holes):
            break
        new = a.copy()
        for r, c in holes:
            nb = a[max(r - 1, 0):r + 2, max(c - 1, 0):c + 2]
            v = nb[~np.isnan(nb)]
            if v.size >= 3:
                new[r, c] = v.mean()
        a = new
    return a


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=2001)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    years = list(range(args.start, args.end + 1))

    cm_rgb, cm_val = load_colormap()
    mask, names = state_mask()

    jobs = [(y, m) for y in years for m in range(1, 13)]
    print(f"Downloading {len(jobs)} monthly images ({W}x{H}px each)...")
    cube = {}  # (year, month) -> fine NDVI array
    with ThreadPoolExecutor(args.workers) as ex:
        futs = [ex.submit(fetch_month, y, m) for y, m in jobs]
        for i, fu in enumerate(as_completed(futs), 1):
            y, m, p = fu.result()
            if isinstance(p, str):
                print(f"  {y}-{m:02d}: not available, skipped ({p})")
                continue
            arr = decode(Image.open(io.BytesIO(p.read_bytes())), cm_rgb, cm_val)
            arr[mask == 0] = np.nan
            cube[(y, m)] = arr
            if i % 24 == 0:
                print(f"  {i}/{len(jobs)} done")

    if not cube:
        sys.exit("No images downloaded. Paste the messages above to Claude.")
    print(f"Downloaded {len(cube)} months.")

    # ---- state + West monthly series
    rows = []
    for (y, m), arr in sorted(cube.items()):
        for sid, name in enumerate(names, 1):
            v = arr[mask == sid]
            v = v[~np.isnan(v)]
            if v.size > 50:
                rows.append((ABBR[name], y, m, float(v.mean())))
        v = arr[~np.isnan(arr)]
        if v.size:
            rows.append(("WEST", y, m, float(v.mean())))

    # anomaly = value minus that region's mean for the same calendar month in BASELINE
    base = {}
    for reg, y, m, v in rows:
        if BASELINE[0] <= y <= BASELINE[1]:
            base.setdefault((reg, m), []).append(v)
    base = {k: float(np.mean(v)) for k, v in base.items()}
    DATA.mkdir(exist_ok=True)
    with open(DATA / "states_monthly.csv", "w") as f:
        f.write("region,date,ndvi,anom\n")
        for reg, y, m, v in rows:
            b = base.get((reg, m))
            a = "" if b is None else f"{v - b:.4f}"
            f.write(f"{reg},{y}-{m:02d}-01,{v:.4f},{a}\n")

    # ---- growing-season grid at COARSE resolution
    k = int(round(COARSE / FINE))
    cw, ch = W // k, H // k
    # majority state per coarse cell
    m4 = mask[:ch * k, :cw * k].reshape(ch, k, cw, k).transpose(0, 2, 1, 3).reshape(ch, cw, -1)
    cell_state = np.zeros((ch, cw), dtype=int)
    for r in range(ch):
        for c in range(cw):
            ids, cnt = np.unique(m4[r, c][m4[r, c] > 0], return_counts=True)
            if ids.size and cnt.max() >= (k * k) / 3:
                cell_state[r, c] = ids[cnt.argmax()]

    cells = [(r, c) for r in range(ch) for c in range(cw) if cell_state[r, c]]
    yearly = {}
    filled_total, gap_cols = [0], {}
    for y in years:
        stack = [cube[(y, m)] for m in GROWING if (y, m) in cube]
        if len(stack) < 4:   # need most of the season
            continue
        with np.errstate(all="ignore"):
            gs = np.nanmean(np.stack(stack), axis=0)
            blocks = gs[:ch * k, :cw * k].reshape(ch, k, cw, k)
            coarse = np.nanmean(blocks, axis=(1, 3))
        coarse[cell_state == 0] = np.nan
        gaps_before = int(np.isnan(coarse[cell_state > 0]).sum())
        coarse = fill_gaps(coarse, cell_state > 0)
        gaps_after = int(np.isnan(coarse[cell_state > 0]).sum())
        filled_total[0] += gaps_before - gaps_after
        if gaps_before:
            bad = np.isnan(np.nanmean(blocks, axis=(1, 3))) & (cell_state > 0)
            for col in np.where(bad.any(0))[0]:
                gap_cols[col] = gap_cols.get(col, 0) + int(bad[:, col].sum())
        yearly[y] = [None if np.isnan(coarse[r, c]) else int(round(coarse[r, c] * 1000))
                     for r, c in cells]

    out = {
        "source": f"NASA GIBS {LAYER} (MODIS/Terra monthly NDVI)",
        "lon0": LON_MIN, "lat0": LAT_MAX, "step": COARSE,
        "season": "Apr-Sep mean", "baseline": list(BASELINE), "scale": 1000,
        "cells": [{"r": r, "c": c, "s": ABBR[names[cell_state[r, c] - 1]]} for r, c in cells],
        "years": sorted(yearly),
        "ndvi": [yearly[y] for y in sorted(yearly)],
    }
    (DATA / "grid.json").write_text(json.dumps(out, separators=(",", ":")))
    if REJECTED[1]:
        print(f"Pixels not matching the colormap: {100 * REJECTED[0] / REJECTED[1]:.2f}%")
    print(f"Empty map cells filled from neighbors: {filled_total[0]} (all years)")
    if gap_cols:
        worst = sorted(gap_cols.items(), key=lambda kv: -kv[1])[:5]
        print("Most gaps at longitudes: " + ", ".join(
            f"{LON_MIN + (c + 0.5) * COARSE:.2f} ({n})" for c, n in worst))
    print(f"Wrote data/grid.json ({len(cells)} cells x {len(yearly)} years) "
          f"and data/states_monthly.csv ({len(rows)} rows)")


if __name__ == "__main__":
    main()
