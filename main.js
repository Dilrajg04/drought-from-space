// Drought from Space: interactive NDVI explorer (D3 v7 only)
// Data files are produced by pipeline/fetch_ndvi.py

const WEST = ["WA", "OR", "CA", "NV", "ID", "MT", "WY", "UT", "CO", "AZ", "NM"];
const NAMES = {
  WA: "Washington", OR: "Oregon", CA: "California", NV: "Nevada", ID: "Idaho", MT: "Montana",
  WY: "Wyoming", UT: "Utah", CO: "Colorado", AZ: "Arizona", NM: "New Mexico", WEST: "Whole West",
};
const BANDS = [
  { from: 2002, to: 2003, label: "2002" },
  { from: 2012, to: 2016, label: "2012–16 CA drought" },
  { from: 2020, to: 2022, label: "2020–22 megadrought" },
];
const ANOM_LIM = 0.1;

const state = { measure: "anom", y0: 2021, y1: 2021, focus: null, timer: null };
const fmt = d3.format("+.3f");
const fmt2 = d3.format(".2f");
const tip = d3.select("#tooltip");

Promise.all([
  d3.json("data/grid.json"),
  d3.csv("data/states_monthly.csv", d3.autoType),
  d3.json("data/us-states-10m.json"),
]).then(([grid, monthly, us]) => init(grid, monthly, us))
  .catch((err) => {
    console.error(err);
    d3.select("#map").append("p").attr("class", "todo")
      .text("Data files not found. Run pipeline/fetch_ndvi.py to create data/grid.json and data/states_monthly.csv.");
  });

function init(grid, monthly, us) {
  // ---------- prepare grid
  const years = grid.years;
  const scale = grid.scale;
  const nCells = grid.cells.length;
  const ndvi = grid.ndvi.map((row) => row.map((v) => (v == null ? NaN : v / scale)));
  const baseYears = years.map((y, i) => [y, i]).filter(([y]) => y >= grid.baseline[0] && y <= grid.baseline[1]);
  const clim = new Float64Array(nCells);
  for (let k = 0; k < nCells; k++) {
    clim[k] = d3.mean(baseYears, ([, i]) => (isNaN(ndvi[i][k]) ? undefined : ndvi[i][k])) ?? NaN;
  }
  const yMin = years[0], yMax = years[years.length - 1];
  const slider = d3.select("#year").attr("min", yMin).attr("max", yMax);
  if (!years.includes(state.y0)) state.y0 = state.y1 = yMax;

  function cellValues() {
    const idx = years.map((y, i) => [y, i]).filter(([y]) => y >= state.y0 && y <= state.y1).map(([, i]) => i);
    const out = new Float64Array(nCells);
    for (let k = 0; k < nCells; k++) {
      const raw = d3.mean(idx, (i) => (isNaN(ndvi[i][k]) ? undefined : ndvi[i][k]));
      out[k] = raw == null ? NaN : state.measure === "anom" ? raw - clim[k] : raw;
    }
    return out;
  }

  const color = {
    anom: d3.scaleDiverging(d3.interpolateBrBG).domain([-ANOM_LIM, 0, ANOM_LIM]).clamp(true),
    ndvi: d3.scaleSequential(d3.interpolateYlGn).domain([0, 0.8]).clamp(true),
  };
  const noData = "url(#nodata-hatch)";

  // ---------- geography
  const states = topojson.feature(us, us.objects.states);
  const westFeatures = states.features.filter((f) => Object.values(NAMES).includes(f.properties.name) && f.properties.name !== "Whole West");
  const abbrOf = Object.fromEntries(Object.entries(NAMES).map(([a, n]) => [n, a]));
  westFeatures.forEach((f) => (f.properties.abbr = abbrOf[f.properties.name]));
  const westFC = { type: "FeatureCollection", features: westFeatures };

  // ================= MAP =================
  const MW = 760, MH = 640;
  const projection = d3.geoConicEqualArea().parallels([33, 45]).rotate([113.5, 0]).fitExtent([[8, 8], [MW - 8, MH - 8]], westFC);
  const path = d3.geoPath(projection);
  const mapSvg = d3.select("#map").append("svg").attr("viewBox", [0, 0, MW, MH])
    .attr("role", "img").attr("aria-label", "Map of western US vegetation greenness");
  const step = grid.step;
  const cellPath = grid.cells.map(({ r, c }) => {
    const lon = grid.lon0 + c * step, lat = grid.lat0 - r * step;
    const pts = [[lon, lat], [lon + step, lat], [lon + step, lat - step], [lon, lat - step]].map(projection);
    return "M" + pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join("L") + "Z";
  });
  const hatch = mapSvg.append("defs").append("pattern").attr("id", "nodata-hatch")
    .attr("width", 4).attr("height", 4).attr("patternUnits", "userSpaceOnUse").attr("patternTransform", "rotate(45)");
  hatch.append("rect").attr("width", 4).attr("height", 4).attr("fill", "var(--panel)");
  hatch.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 4).attr("stroke", "var(--ink-3)").attr("stroke-width", 1.2);
  const gCells = mapSvg.append("g");
  const cells = gCells.selectAll("path").data(grid.cells).join("path")
    .attr("class", "cell").attr("d", (_, k) => cellPath[k]);
  mapSvg.append("g").selectAll("path").data(westFeatures).join("path")
    .attr("class", "state").attr("d", path);
  const hoverOutline = mapSvg.append("path").attr("class", "hover-cell");

  let values = cellValues();

  gCells.on("pointermove", (event) => {
    const d = event.target.__data__;
    if (!d) return;
    const k = grid.cells.indexOf(d);
    hoverOutline.attr("d", cellPath[k]);
    const lon = grid.lon0 + (d.c + 0.5) * step, lat = grid.lat0 - (d.r + 0.5) * step;
    const v = values[k];
    const raw = state.measure === "anom" ? v + clim[k] : v;
    showTip(event, `<b>${NAMES[d.s]}</b> <span class="muted">${lat.toFixed(2)}°N, ${Math.abs(lon).toFixed(2)}°W</span><br>
      ${rangeLabel()} greenness: <b>${isNaN(raw) ? "no data" : fmt2(raw)}</b><br>
      2001–2020 normal: ${isNaN(clim[k]) ? "no data" : fmt2(clim[k])}<br>
      Change vs normal: <b>${isNaN(raw - clim[k]) ? "n/a" : fmt(raw - clim[k])}</b>
      <span class="muted">${isNaN(raw - clim[k]) ? "" : `(${d3.format("+.0%")((raw - clim[k]) / clim[k])})`}</span><br>
      <span class="muted">Click to ${state.focus === d.s ? "clear focus" : "focus " + d.s}</span>`);
  }).on("pointerleave", () => { hoverOutline.attr("d", null); hideTip(); })
    .on("click", (event) => {
      const d = event.target.__data__;
      if (d) setFocus(state.focus === d.s ? null : d.s);
    });

  // legend
  const legendSvg = d3.select("#legend").append("svg").attr("viewBox", [0, 0, 360, 46]);
  function drawLegend() {
    legendSvg.selectAll("*").remove();
    const sc = color[state.measure];
    const x = d3.scaleLinear().domain(state.measure === "anom" ? [-ANOM_LIM, ANOM_LIM] : [0, 0.8]).range([16, 340]);
    const id = "lg-" + state.measure;
    const grad = legendSvg.append("defs").append("linearGradient").attr("id", id);
    d3.range(0, 1.01, 0.1).forEach((t) => grad.append("stop").attr("offset", t).attr("stop-color", sc(x.invert(16 + t * 324))));
    legendSvg.append("rect").attr("x", 16).attr("y", 4).attr("width", 324).attr("height", 10).attr("rx", 2).attr("fill", `url(#${id})`);
    const ax = d3.axisBottom(x).ticks(5).tickSize(3).tickFormat(state.measure === "anom" ? d3.format("+.2f") : d3.format(".1f"));
    legendSvg.append("g").attr("class", "axis").attr("transform", "translate(0,15)").call(ax).call((g) => g.select(".domain").remove());
    if (state.measure === "anom") {
      legendSvg.append("text").attr("class", "lbl").attr("x", 16).attr("y", 44).text("◀ browner than normal");
      legendSvg.append("text").attr("class", "lbl").attr("x", 340).attr("y", 44).attr("text-anchor", "end").text("greener than normal ▶");
    } else {
      legendSvg.append("text").attr("class", "lbl").attr("x", 16).attr("y", 44).text("◀ bare / sparse");
      legendSvg.append("text").attr("class", "lbl").attr("x", 340).attr("y", 44).attr("text-anchor", "end").text("dense vegetation ▶");
    }
  }

  // ================= RANKING =================
  const RW = 300, RH = 360, rm = { t: 18, r: 44, b: 6, l: 92 };
  const rankSvg = d3.select("#rank").append("svg").attr("viewBox", [0, 0, RW, RH]);
  const ry = d3.scaleBand().range([rm.t, RH - rm.b]).padding(0.22);
  const rx = d3.scaleLinear().range([rm.l, RW - rm.r]);
  const rankAxis = rankSvg.append("g").attr("class", "axis").attr("transform", `translate(0,${rm.t})`);
  const rankZero = rankSvg.append("line").attr("class", "zero");
  const rankRows = rankSvg.append("g");

  function stateMeans() {
    const byState = d3.rollup(grid.cells.map((c, k) => [c.s, values[k]]).filter(([, v]) => !isNaN(v)),
      (v) => d3.mean(v, (d) => d[1]), (d) => d[0]);
    return WEST.map((s) => ({ s, v: byState.get(s) ?? NaN })).filter((d) => !isNaN(d.v))
      .sort((a, b) => d3.ascending(a.v, b.v));
  }

  function drawRank() {
    const data = stateMeans();
    const ext = state.measure === "anom"
      ? (() => { const m = Math.max(0.02, d3.max(data, (d) => Math.abs(d.v))); return [-m, m]; })()
      : [0, Math.max(0.1, d3.max(data, (d) => d.v))];
    rx.domain(ext).nice();
    ry.domain(data.map((d) => d.s));
    rankAxis.transition().duration(300).call(d3.axisTop(rx).ticks(4).tickSize(-(RH - rm.t - rm.b))
      .tickFormat(state.measure === "anom" ? d3.format("+.2f") : d3.format(".1f")))
      .call((g) => g.select(".domain").remove());
    rankAxis.selectAll(".tick line").attr("stroke", "var(--rule)");
    rankZero.attr("x1", rx(0)).attr("x2", rx(0)).attr("y1", rm.t).attr("y2", RH - rm.b);
    const sc = color[state.measure];
    const row = rankRows.selectAll("g.bar-row").data(data, (d) => d.s).join((enter) => {
      const g = enter.append("g").attr("class", "bar-row");
      g.append("rect").attr("class", "bar-bg");
      g.append("text").attr("class", "lbl bar-name").attr("text-anchor", "end").attr("dy", "0.35em");
      g.append("rect").attr("class", "bar").attr("rx", 2);
      g.append("text").attr("class", "lbl bar-val").attr("dy", "0.35em");
      return g;
    });
    row.classed("on", (d) => d.s === state.focus)
      .style("opacity", (d) => (state.focus && d.s !== state.focus ? 0.45 : 1))
      .on("click", (_, d) => setFocus(state.focus === d.s ? null : d.s))
      .on("pointermove", (event, d) => showTip(event, `<b>${NAMES[d.s]}</b><br>${state.measure === "anom" ? "Change vs normal" : "Mean greenness"}, ${rangeLabel()}: <b>${state.measure === "anom" ? fmt(d.v) : fmt2(d.v)}</b>`))
      .on("pointerleave", hideTip);
    row.transition().duration(400).attr("transform", (d) => `translate(0,${ry(d.s)})`);
    row.select(".bar-bg").attr("x", 0).attr("width", RW).attr("y", -ry.paddingInner() * ry.step() / 2).attr("height", ry.step());
    row.select(".bar-name").attr("x", rm.l - 8).attr("y", ry.bandwidth() / 2).text((d) => NAMES[d.s]);
    row.select(".bar").transition().duration(400)
      .attr("x", (d) => Math.min(rx(0), rx(d.v))).attr("width", (d) => Math.max(1, Math.abs(rx(d.v) - rx(0))))
      .attr("y", 0).attr("height", ry.bandwidth())
      // bar length carries the value; color only marks direction (or greenness), at a readable strength
      .attr("fill", (d) => (state.measure === "anom" ? sc(Math.sign(d.v) * ANOM_LIM * 0.7) : sc(d.v)));
    row.select(".bar-val").transition().duration(400)
      .attr("x", (d) => (d.v < 0 && state.measure === "anom" ? rx(0) + 4 : rx(d.v) + 4)).attr("y", ry.bandwidth() / 2)
      .text((d) => (state.measure === "anom" ? fmt(d.v) : fmt2(d.v)));
  }

  // ================= TIMELINE =================
  const TW = 1150, TH = 270, tm = { t: 26, r: 16, b: 26, l: 46 };
  const series = d3.group(monthly, (d) => d.region);
  const rolled = new Map();
  for (const [reg, rows] of series) {
    rows.sort((a, b) => a.date - b.date);
    const out = rows.map((d, i) => {
      const win = rows.slice(Math.max(0, i - 11), i + 1).filter((w) => w.anom != null && !isNaN(w.anom));
      return { date: d.date, v: win.length >= 9 ? d3.mean(win, (w) => w.anom) : NaN };
    });
    rolled.set(reg, out);
  }
  const allRolled = [...rolled.values()].flat().filter((d) => !isNaN(d.v));
  const tx = d3.scaleUtc().domain([new Date(Date.UTC(yMin, 0, 1)), new Date(Date.UTC(yMax + 1, 0, 1))]).range([tm.l, TW - tm.r]);
  const tyMax = Math.max(0.02, d3.max(allRolled, (d) => Math.abs(d.v)));
  const ty = d3.scaleLinear().domain([-tyMax, tyMax]).nice().range([TH - tm.b, tm.t]);
  const tlSvg = d3.select("#timeline").append("svg").attr("viewBox", [0, 0, TW, TH]);

  const bandG = tlSvg.append("g").attr("class", "band").selectAll("g").data(BANDS).join("g");
  bandG.append("rect").attr("x", (d) => tx(new Date(Date.UTC(d.from, 0, 1)))).attr("width", (d) => tx(new Date(Date.UTC(d.to + 1, 0, 1))) - tx(new Date(Date.UTC(d.from, 0, 1))))
    .attr("y", tm.t).attr("height", TH - tm.t - tm.b);
  bandG.append("text").attr("x", (d) => tx(new Date(Date.UTC(d.from, 0, 1))) + 4).attr("y", tm.t - 8).text((d) => d.label);

  tlSvg.append("g").attr("class", "axis grid").attr("transform", `translate(${tm.l},0)`)
    .call(d3.axisLeft(ty).ticks(5).tickSize(-(TW - tm.l - tm.r)).tickFormat(d3.format("+.2f")))
    .call((g) => g.select(".domain").remove());
  tlSvg.append("g").attr("class", "axis").attr("transform", `translate(0,${TH - tm.b})`)
    .call(d3.axisBottom(tx).ticks(d3.utcYear.every(2)).tickSizeOuter(0));
  tlSvg.append("text").attr("class", "lbl").attr("x", tm.l + 6).attr("y", ty(tyMax) + 12).text("▲ greener than normal");
  tlSvg.append("text").attr("class", "lbl").attr("x", tm.l + 6).attr("y", ty(-tyMax) - 6).text("▼ browner than normal");

  const selRect = tlSvg.append("rect").attr("y", tm.t).attr("height", TH - tm.t - tm.b).attr("fill", "var(--ink)").attr("fill-opacity", 0.07);
  const posArea = tlSvg.append("path").attr("fill", color.anom(ANOM_LIM * 0.75));
  const negArea = tlSvg.append("path").attr("fill", color.anom(-ANOM_LIM * 0.75));
  tlSvg.append("line").attr("class", "zero").attr("x1", tm.l).attr("x2", TW - tm.r).attr("y1", ty(0)).attr("y2", ty(0));
  const westLine = tlSvg.append("path").attr("class", "west-line");
  const tlKey = tlSvg.append("g").attr("transform", `translate(${TW - tm.r - 150},${tm.t + 12})`);
  tlKey.append("line").attr("class", "west-line").attr("x1", 0).attr("x2", 22).attr("y1", 0).attr("y2", 0);
  tlKey.append("text").attr("class", "lbl").attr("x", 28).attr("dy", "0.35em").text("Whole West, for comparison");
  const crosshair = tlSvg.append("line").attr("stroke", "var(--ink-3)").attr("y1", tm.t).attr("y2", TH - tm.b).style("display", "none");

  const areaPos = d3.area().defined((d) => !isNaN(d.v)).x((d) => tx(d.date)).y0(ty(0)).y1((d) => ty(Math.max(0, d.v)));
  const areaNeg = d3.area().defined((d) => !isNaN(d.v)).x((d) => tx(d.date)).y0(ty(0)).y1((d) => ty(Math.min(0, d.v)));
  const line = d3.line().defined((d) => !isNaN(d.v)).x((d) => tx(d.date)).y((d) => ty(d.v));

  function drawTimeline() {
    const reg = state.focus || "WEST";
    const data = rolled.get(reg) || [];
    posArea.datum(data).transition().duration(400).attr("d", areaPos);
    negArea.datum(data).transition().duration(400).attr("d", areaNeg);
    const west = rolled.get("WEST") || [];
    westLine.style("display", state.focus ? null : "none").datum(west).transition().duration(400).attr("d", line);
    tlKey.style("display", state.focus ? null : "none");
    d3.select("#tl-title").text(`Monthly greenness vs normal: ${NAMES[reg]}`);
    selRect.attr("x", tx(new Date(Date.UTC(state.y0, 0, 1))))
      .attr("width", tx(new Date(Date.UTC(state.y1 + 1, 0, 1))) - tx(new Date(Date.UTC(state.y0, 0, 1))));
  }

  // brush: drag = range of years, click = single year
  let brushing = false;
  const brush = d3.brushX().extent([[tm.l, tm.t], [TW - tm.r, TH - tm.b]])
    .on("end", (event) => {
      if (brushing || !event.sourceEvent) return;
      let y0, y1;
      if (!event.selection) {
        const [mx] = d3.pointer(event.sourceEvent, tlSvg.node());
        y0 = y1 = clampYear(tx.invert(mx).getUTCFullYear());
      } else {
        const [a, b] = event.selection.map(tx.invert);
        y0 = clampYear(a.getUTCFullYear());
        y1 = clampYear(new Date(b - 1).getUTCFullYear());
      }
      brushing = true;
      gBrush.call(brush.move, null);   // the gray band (selRect) shows the selection instead
      brushing = false;
      stop();
      setRange(y0, y1);
    });
  const gBrush = tlSvg.append("g").attr("class", "brush").call(brush);
  gBrush.on("pointermove.tip", (event) => {
    const [mx] = d3.pointer(event, tlSvg.node());
    const date = tx.invert(mx);
    const reg = state.focus || "WEST";
    const find = (r) => {
      const arr = rolled.get(r) || [];
      const i = d3.bisector((d) => d.date).center(arr, date);
      return arr[i];
    };
    const f = find(reg), w = find("WEST");
    if (!f) return;
    crosshair.style("display", null).attr("x1", tx(f.date)).attr("x2", tx(f.date));
    showTip(event, `<b>${d3.utcFormat("%b %Y")(f.date)}</b><br>
      ${NAMES[reg]}: <b>${isNaN(f.v) ? "n/a" : fmt(f.v)}</b>
      ${state.focus && w ? `<br><span class="muted">Whole West: ${isNaN(w.v) ? "n/a" : fmt(w.v)}</span>` : ""}
      <br><span class="muted">Click to map ${f.date.getUTCFullYear()}, drag for a range</span>`);
  }).on("pointerleave.tip", () => { crosshair.style("display", "none"); hideTip(); });

  // ================= CONTROLS & UPDATE =================
  function clampYear(y) { return Math.max(yMin, Math.min(yMax, y)); }
  function rangeLabel() { return state.y0 === state.y1 ? `${state.y0}` : `${state.y0}–${state.y1} avg`; }

  function update() {
    values = cellValues();
    const sc = color[state.measure];
    cells.attr("fill", (_, k) => (isNaN(values[k]) ? noData : sc(values[k])))
      .classed("dim", (d) => state.focus && d.s !== state.focus);
    mapSvg.selectAll(".state").classed("on", (d) => d.properties.abbr === state.focus).filter((d) => d.properties.abbr === state.focus).raise();
    const what = state.measure === "anom" ? "Growing-season greenness vs normal" : "Growing-season greenness (NDVI)";
    d3.select("#map-title").text(`${what}, ${state.y0 === state.y1 ? state.y0 : state.y0 + "–" + state.y1 + " average"}`);
    d3.select("#map-sub").text(state.measure === "anom"
      ? "Each square is ~25 km. Brown = less green than its own 2001–2020 average; teal = greener. Hover for details, click a state to focus it."
      : "Each square is ~25 km, colored by average April–September NDVI. Forests and irrigated farms are darkest; deserts are pale. Hover for details, click a state to focus it.");
    d3.select("#rank-sub").text(`${state.measure === "anom" ? "Average change vs normal" : "Average greenness"}, ${rangeLabel()}. Click a bar to focus a state.`);
    slider.property("value", state.y1);
    d3.select("#year-out").text(state.y0 === state.y1 ? state.y0 : `${state.y0}–${state.y1}`);
    drawLegend();
    drawRank();
    drawTimeline();
  }

  function setRange(y0, y1) { state.y0 = y0; state.y1 = y1; update(); }
  function setFocus(s) { state.focus = s; update(); }

  d3.selectAll(".seg button").on("click", function () {
    state.measure = this.dataset.measure;
    d3.selectAll(".seg button").attr("aria-checked", function () { return this.dataset.measure === state.measure; });
    update();
  });
  slider.on("input", function () { stop(); setRange(+this.value, +this.value); });

  function stop() {
    if (state.timer) { state.timer.stop(); state.timer = null; }
    d3.select("#play").html("&#9654;").attr("aria-label", "Play through years");
  }
  d3.select("#play").on("click", () => {
    if (state.timer) return stop();
    let y = state.y1 >= yMax ? yMin : state.y1 + 1;
    setRange(y, y);
    d3.select("#play").html("&#10074;&#10074;").attr("aria-label", "Pause");
    state.timer = d3.interval(() => {
      if (y >= yMax) return stop();
      y += 1;
      setRange(y, y);
    }, 900);
  });
  d3.select("#reset").on("click", () => {
    stop();
    state.focus = null; state.measure = "anom";
    d3.selectAll(".seg button").attr("aria-checked", function () { return this.dataset.measure === "anom"; });
    setRange(years.includes(2021) ? 2021 : yMax, years.includes(2021) ? 2021 : yMax);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.focus) setFocus(null);
  });

  update();
}

// ---------- tooltip helpers
function showTip(event, html) {
  tip.html(html).attr("hidden", null);
  const { width, height } = tip.node().getBoundingClientRect();
  let x = event.clientX + 14, y = event.clientY + 14;
  if (x + width > window.innerWidth - 8) x = event.clientX - width - 14;
  if (y + height > window.innerHeight - 8) y = event.clientY - height - 14;
  tip.style("left", x + "px").style("top", y + "px");
}
function hideTip() { tip.attr("hidden", true); }
