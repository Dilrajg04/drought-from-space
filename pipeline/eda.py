"""
Exploratory charts for the checkpoint video (6 static PNGs in eda/).
Run AFTER fetch_ndvi.py:   pip install matplotlib   then   python pipeline/eda.py
"""
import csv
import json
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import TwoSlopeNorm

ROOT = Path(__file__).resolve().parent.parent
DATA, OUT = ROOT / "data", ROOT / "eda"
OUT.mkdir(exist_ok=True)

plt.rcParams.update({
    "figure.dpi": 150, "font.size": 10, "axes.spines.top": False,
    "axes.spines.right": False, "axes.grid": True, "grid.color": "#e6e5e0",
    "grid.linewidth": 0.6, "axes.edgecolor": "#8a8984", "axes.titleweight": "bold",
})
BROWN, GREEN, GRAY = "#8c510a", "#01665e", "#52514e"
DROUGHTS = [(2002, 2003, "2002 drought"), (2012, 2016, "CA drought 2012-16"),
            (2020, 2022, "2020-22 megadrought")]

# ---------------------------------------------------------------- load
series = defaultdict(list)  # region -> [(year, month, ndvi, anom)]
with open(DATA / "states_monthly.csv") as f:
    for r in csv.DictReader(f):
        y, m = int(r["date"][:4]), int(r["date"][5:7])
        series[r["region"]].append((y, m, float(r["ndvi"]),
                                    float(r["anom"]) if r["anom"] else np.nan))
grid = json.loads((DATA / "grid.json").read_text())
years = grid["years"]
ndvi = np.array([[np.nan if v is None else v / grid["scale"] for v in row]
                 for row in grid["ndvi"]])
b0, b1 = grid["baseline"]
base_idx = [i for i, y in enumerate(years) if b0 <= y <= b1]
clim = np.nanmean(ndvi[base_idx], axis=0)
states = sorted(k for k in series if k != "WEST")


def t(rows):
    return np.array([y + (m - 0.5) / 12 for y, m, *_ in rows])


def shade(ax):
    for a, b, _ in DROUGHTS:
        ax.axvspan(a, b + 1, color="#f2e6d0", zorder=0, lw=0)


def save(fig, name):
    fig.tight_layout()
    fig.savefig(OUT / name, facecolor="white")
    plt.close(fig)
    print("wrote eda/" + name)


# 1. raw monthly NDVI for the whole West
w = series["WEST"]
fig, ax = plt.subplots(figsize=(9, 3.6))
shade(ax)
ax.plot(t(w), [r[2] for r in w], color=GREEN, lw=1.4)
ax.set(title="1. Monthly NDVI, all 11 western states (raw)", ylabel="Mean NDVI")
save(fig, "01_west_monthly_ndvi.png")

# 2. de-seasonalized anomaly, 12-month rolling mean
a = np.array([r[3] for r in w])
roll = np.convolve(np.nan_to_num(a), np.ones(12) / 12, mode="same")
fig, ax = plt.subplots(figsize=(9, 3.6))
shade(ax)
tt = t(w)
ax.fill_between(tt, 0, roll, where=roll < 0, color=BROWN, alpha=.85, lw=0, label="Browner than normal")
ax.fill_between(tt, 0, roll, where=roll >= 0, color=GREEN, alpha=.85, lw=0, label="Greener than normal")
ax.axhline(0, color=GRAY, lw=.8)
ax.set(title=f"2. NDVI anomaly vs {b0}-{b1} same-month average (12-mo rolling)", ylabel="NDVI anomaly")
ax.legend(frameon=False, loc="upper left")
save(fig, "02_west_anomaly.png")

# 3. seasonal cycle by state (baseline climatology)
fig, ax = plt.subplots(figsize=(7, 4.2))
cmap = plt.get_cmap("tab20")
ends = []
for i, s in enumerate(states):
    clm = [np.mean([r[2] for r in series[s] if r[1] == m and b0 <= r[0] <= b1]) for m in range(1, 13)]
    ax.plot(range(1, 13), clm, lw=1.6, color=cmap(i))
    ends.append([clm[-1], s, cmap(i)])
# spread end labels so they don't overlap
ends.sort()
gap = 0.018
for j in range(1, len(ends)):
    ends[j][0] = max(ends[j][0], ends[j - 1][0] + gap)
for y, s, col in ends:
    ax.text(12.2, y, s, fontsize=8, va="center", color=col, fontweight="bold")
ax.set_xlim(0.7, 12.8)
ax.set(title="3. Average seasonal NDVI cycle by state", xlabel="Month", ylabel="Mean NDVI",
       xticks=range(1, 13))
save(fig, "03_seasonal_cycle_by_state.png")


# 4 + 5. maps of growing-season anomaly
def grid_map(year, name, title):
    i = years.index(year)
    rows = max(c["r"] for c in grid["cells"]) + 1
    cols = max(c["c"] for c in grid["cells"]) + 1
    img = np.full((rows, cols), np.nan)
    for k, c in enumerate(grid["cells"]):
        img[c["r"], c["c"]] = ndvi[i, k] - clim[k]
    fig, ax = plt.subplots(figsize=(6, 5))
    lo, hi = grid["lon0"], grid["lon0"] + cols * grid["step"]
    la_hi, la_lo = grid["lat0"], grid["lat0"] - rows * grid["step"]
    im = ax.imshow(img, cmap="BrBG", norm=TwoSlopeNorm(0, -0.1, 0.1),
                   extent=[lo, hi, la_lo, la_hi], aspect=1.25)
    ax.grid(False)
    fig.colorbar(im, ax=ax, shrink=.75, label="NDVI anomaly")
    ax.set(title=title, xlabel="Longitude", ylabel="Latitude")
    save(fig, name)


if 2021 in years:
    grid_map(2021, "04_map_2021_anomaly.png", "4. Growing-season NDVI anomaly, 2021")
if 2023 in years:
    grid_map(2023, "05_map_2023_anomaly.png", "5. Growing-season NDVI anomaly, 2023 (wet year)")

# 6. state x year heatmap of growing-season anomaly
M = np.full((len(states), len(years)), np.nan)
for si, s in enumerate(states):
    for yi, y in enumerate(years):
        v = [r[3] for r in series[s] if r[0] == y and 4 <= r[1] <= 9]
        if v:
            M[si, yi] = np.nanmean(v)
fig, ax = plt.subplots(figsize=(9, 4))
lim = np.nanmax(np.abs(M))
im = ax.imshow(M, cmap="BrBG", vmin=-lim, vmax=lim, aspect="auto")
ax.grid(False)
ax.set_yticks(range(len(states)), states)
ax.set_xticks(range(0, len(years), 2), years[::2], rotation=45)
fig.colorbar(im, ax=ax, label="NDVI anomaly")
ax.set_title("6. Growing-season (Apr-Sep) NDVI anomaly by state and year")
save(fig, "06_state_year_heatmap.png")
