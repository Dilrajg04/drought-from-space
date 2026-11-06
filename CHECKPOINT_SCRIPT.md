# Checkpoint video: script + shot list
**Due Thu 11/05, 11:59 PM on Gradescope. One mp4, max 2:00, with voiceover. Add all 4 members to the submission.**

Target ~280 spoken words (about 1:50). Record with Zoom / QuickTime screen share over the 6 PNGs in `eda/` and the local site.

| Time | On screen | Voiceover (edit into your own words) |
|---|---|---|
| 0:00–0:12 | Title card: "Drought from Space" + 4 names | We're Kyle Shiroma, Dilraj Grewal, Roberto Echeverria Sosa, and Yue Hu. Our project is "Drought from Space: vegetation health across the American West." |
| 0:12–0:30 | NASA Worldview with the MODIS NDVI layer on | We're using NASA MODIS from the Terra satellite, specifically the monthly NDVI layer from GIBS. NDVI measures how green the land is, from about zero for bare ground up to 0.9 for dense forest. We pulled 2001 to 2025 for the 11 western states. |
| 0:30–0:42 | `01_west_monthly_ndvi.png` | First, the raw monthly series for the whole West. It's dominated by the seasonal cycle, so drought is hard to see. |
| 0:42–0:52 | `03_seasonal_cycle_by_state.png` | Each state also has a very different baseline and seasonal shape, so comparing raw values across states is misleading. |
| 0:52–1:04 | `02_west_anomaly.png` | So we compared each month to its own 2001–2020 average. Now the drought years stand out clearly. *(Describe what your real chart shows: which dips are biggest.)* |
| 1:04–1:16 | `06_state_year_heatmap.png` | Breaking that out by state and year shows drought isn't uniform: *(name the states/years that stand out).* |
| 1:16–1:30 | `04_map_2021_anomaly.png` then `05_map_2023_anomaly.png` | And spatially, the browning in 2021 vs the green-up in 2023 is concentrated in *(describe where).* |
| 1:30–1:40 | Text card with the question | That led to our question: **Where did the West's vegetation brown during two decades of drought, and how fast did it recover?** |
| 1:40–1:58 | Screen recording of the site: slider, play, hover, click a state, drag on timeline | Here's our current D3 prototype: a map of growing-season change vs normal with a year slider and play button, a state ranking, and a timeline you can brush to average years. Next we'll polish annotations and write up our design rationale. |

## Recording checklist
- [ ] Real data run done (`python pipeline/fetch_ndvi.py`, then `python pipeline/eda.py`)
- [ ] Fill in the *(italic)* parts from what your real charts show
- [ ] Voiceover audible, video under 2:00, exported as .mp4
- [ ] Upload once on Gradescope and add all 4 teammates
