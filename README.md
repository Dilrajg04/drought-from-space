# Drought from Space: vegetation health across the American West
DSC 106 Project 3 · Kyle Shiroma, Dilraj Grewal, Roberto Echeverria Sosa, Yue Hu

Interactive D3 visualization of MODIS/Terra monthly NDVI (NASA GIBS), 2001–2025, for the 11 western states.

## Quick start
```bash
pip install requests numpy pillow matplotlib
python pipeline/fetch_ndvi.py        # ~300 requests to NASA GIBS, ~5-15 min, cached in pipeline/cache/
python pipeline/eda.py               # 6 exploratory charts -> eda/
python -m http.server 8000           # open http://localhost:8000
```
Quick test first: `python pipeline/fetch_ndvi.py --start 2019 --end 2023`

## Deploy (GitHub Pages)
1. Create a **public** repo, push everything (pipeline/cache is git-ignored; `data/` must be committed).
2. Settings → Pages → Deploy from branch → `main` / root.
3. Submit the Pages URL on Gradescope by **Wed 11/11, 11:59 PM**.

## Files
| Path | What |
|---|---|
| `index.html`, `style.css`, `main.js` | The site (D3 v7 only, no other plotting libraries) |
| `data/grid.json` | Apr–Sep mean NDVI per 0.25° cell per year (generated) |
| `data/states_monthly.csv` | Monthly NDVI + anomaly per state and whole West (generated) |
| `data/us-states-10m.json` | State boundaries (us-atlas) |
| `pipeline/fetch_ndvi.py` | Downloads GIBS imagery, decodes NDVI, builds data files |
| `pipeline/eda.py` | Static exploratory charts for the checkpoint |
| `CHECKPOINT_SCRIPT.md` | 2-min video script |
| `WRITEUP_NOTES.md` | Design facts to write the write-up from |

## If the pipeline breaks
- **Colormap error:** open the GIBS colormap URL printed in the script in a browser and check the XML entry format; adjust `load_colormap()`.
- **All images "not available":** confirm the layer name in NASA Worldview (Add layers → "NDVI" → Terra Monthly) and update `LAYER`.
- **Map looks noisy/blank:** check a cached PNG in `pipeline/cache/` opens and shows the West.
