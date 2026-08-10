"use strict";
(function () {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const SVGNS = "http://www.w3.org/2000/svg";
  const flag = (cc) => (COUNTRIES[cc] && COUNTRIES[cc].flag) || "🏳️";
  const cname = (cc) => (COUNTRIES[cc] && COUNTRIES[cc].name) || cc;

  /* ---------- normalize traveler data ---------- */
  const warnings = [];
  const members = TRAVELERS.map((t) => {
    const seen = new Set();
    const countries = [];
    for (const raw of t.countries || []) {
      const cc = String(raw).trim().toUpperCase();
      if (!COUNTRIES[cc]) {
        warnings.push(`“${raw}” in ${t.name}’s list isn’t a country code we know — check the table for the right two letters.`);
        continue;
      }
      if (!seen.has(cc)) {
        seen.add(cc);
        countries.push(cc);
      }
    }
    return { name: t.name, emoji: t.emoji || "📷", home: (t.home || "").toUpperCase(), camera: t.camera || "", favorite: (t.favorite || "").toUpperCase(), countries, set: seen };
  });
  const N = members.length;

  /* ---------- shared aggregates ---------- */
  const visitors = new Map(); // cc -> array of members
  for (const m of members)
    for (const cc of m.countries) {
      if (!visitors.has(cc)) visitors.set(cc, []);
      visitors.get(cc).push(m);
    }
  const visited = [...visitors.keys()];
  const counts = [...visitors.values()].map((v) => v.length);
  const maxCount = counts.length ? Math.max(...counts) : 0;
  const unTotal = Object.values(COUNTRIES).filter((c) => c.un).length;
  const unVisited = visited.filter((cc) => COUNTRIES[cc].un).length;
  const stamps = members.reduce((s, m) => s + m.countries.length, 0);
  const gems = visited.filter((cc) => visitors.get(cc).length === 1)
    .sort((a, b) => cname(a).localeCompare(cname(b)));
  const fullHouse = visited.filter((cc) => visitors.get(cc).length === N && N > 1)
    .sort((a, b) => cname(a).localeCompare(cname(b)));

  /* ---------- header ---------- */
  if (typeof GROUP !== "undefined" && GROUP.name) {
    $("#group-name").textContent = GROUP.name;
    document.title = GROUP.name + " · The Group Passport";
  }
  $("#group-tagline").textContent = (typeof GROUP !== "undefined" && GROUP.tagline) || "";
  if (typeof GROUP !== "undefined" && GROUP.repo) {
    $("#edit-link").href = `https://github.com/${GROUP.repo}/edit/main/data/travelers.js`;
  }

  /* ---------- data warnings ---------- */
  if (warnings.length) {
    const box = $("#data-warnings");
    box.hidden = false;
    const w = el("div", "warn");
    w.appendChild(el("strong", null, "Heads up, a few country codes didn’t focus: "));
    w.appendChild(el("span", null, warnings.join(" · ")));
    box.appendChild(w);
  }

  /* ---------- KPI row ---------- */
  const kpis = $("#kpis");
  const stat = (label, value, note, hero) => {
    const s = el("div", "stat" + (hero ? " hero" : ""));
    s.appendChild(el("p", "label", label));
    s.appendChild(el("p", "value", value));
    if (note) s.appendChild(el("p", "note", note));
    kpis.appendChild(s);
  };
  const pct = unTotal ? Math.round((unVisited / unTotal) * 100) : 0;
  const continentsAll = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania", "Antarctica"];
  const contVisited = new Set(visited.map((cc) => COUNTRIES[cc].continent));
  const top = [...members].sort((a, b) => b.countries.length - a.countries.length)[0];
  stat("Countries in the group passport", String(visited.length),
    `${pct}% of the world’s ${unTotal} UN countries`, true);
  stat("Passport stamps", String(stamps), "every member-visit, added up");
  stat("Continents", `${continentsAll.filter((c) => contVisited.has(c)).length} of 7`,
    contVisited.has("Antarctica") ? "including Antarctica — legends 🐧" : "Antarctica still awaits 🐧");
  if (top) stat("Most traveled", String(top.countries.length), `${top.emoji} ${top.name} leads the pack`);
  stat("Hidden gems", String(gems.length), "countries only one of us has seen");

  /* ---------- choropleth bins ---------- */
  // 1..maxCount mapped onto the 5-step validated ramp (b1 lightest … b5 deepest)
  const binSize = maxCount > 5 ? Math.ceil(maxCount / 5) : 1;
  const binOf = (c) => {
    if (maxCount <= 1) return 3;
    if (maxCount <= 5) return 1 + Math.round(((c - 1) * 4) / (maxCount - 1));
    return Math.min(5, Math.floor((c - 1) / binSize) + 1);
  };
  const legend = $("#map-legend");
  const legendKey = (swatchClassOrVar, label) => {
    const k = el("span", "key");
    const sw = el("span", "swatch");
    sw.style.background = swatchClassOrVar;
    k.appendChild(sw);
    k.appendChild(el("span", null, label));
    legend.appendChild(k);
  };
  legendKey("var(--map-empty)", "no stamps yet");
  if (maxCount <= 5) {
    const seenBins = new Set();
    for (let c = 1; c <= maxCount; c++) {
      const b = binOf(c);
      if (seenBins.has(b)) continue;
      seenBins.add(b);
      legendKey(`var(--v${b})`, c === 1 ? "1 person" : `${c} people`);
    }
  } else {
    for (let b = 1; b <= 5; b++) {
      const lo = (b - 1) * binSize + 1;
      const hi = Math.min(maxCount, b * binSize);
      if (lo > maxCount) break;
      legendKey(`var(--v${b})`, lo === hi ? `${lo} people` : `${lo}–${hi} people`);
    }
  }

  /* ---------- map ---------- */
  const svg = $("#map");
  svg.setAttribute("viewBox", `0 0 ${WORLD_MAP.width} ${WORLD_MAP.height}`);
  const whoLine = (cc) => {
    const v = visitors.get(cc);
    return v ? v.map((m) => `${m.emoji} ${m.name}`).join(", ") : "";
  };
  for (const [cc, d] of Object.entries(WORLD_MAP.paths)) {
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d);
    const v = visitors.get(cc);
    p.setAttribute("class", v ? `country hit b${binOf(v.length)}` : "country");
    p.dataset.cc = cc;
    if (v) {
      p.setAttribute("tabindex", "0");
      p.setAttribute("role", "img");
      p.setAttribute("aria-label", `${cname(cc)}: ${v.length} of ${N} — ${v.map((m) => m.name).join(", ")}`);
    }
    svg.appendChild(p);
  }
  // countries too small for the 110m map get a dot at their centroid
  for (const cc of visited) {
    if (WORLD_MAP.paths[cc]) continue;
    const meta = COUNTRIES[cc];
    if (meta.x == null) continue;
    const v = visitors.get(cc);
    const dot = document.createElementNS(SVGNS, "circle");
    dot.setAttribute("cx", meta.x);
    dot.setAttribute("cy", meta.y);
    dot.setAttribute("r", "4.5");
    dot.setAttribute("class", `cdot b${binOf(v.length)}`);
    dot.dataset.cc = cc;
    dot.setAttribute("tabindex", "0");
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", `${cname(cc)}: ${v.length} of ${N} — ${v.map((m) => m.name).join(", ")}`);
    svg.appendChild(dot);
  }

  /* ---------- map tooltip ---------- */
  const wrap = $("#map-wrap");
  const tip = $("#map-tooltip");
  const fillTip = (cc) => {
    tip.textContent = "";
    const v = visitors.get(cc);
    tip.appendChild(el("div", "t-name", `${flag(cc)} ${cname(cc)}`));
    if (v) {
      tip.appendChild(el("div", "t-count", `${v.length} of ${N} have the stamp`));
      tip.appendChild(el("div", "t-who", whoLine(cc)));
    } else {
      tip.appendChild(el("div", "t-count", "No stamps yet — first one there wins 🏁"));
    }
  };
  const placeTip = (x, y) => {
    const r = wrap.getBoundingClientRect();
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x - r.left + 14;
    let topPos = y - r.top + 14;
    if (left + tw > r.width - 4) left = x - r.left - tw - 14;
    if (topPos + th > r.height - 4) topPos = y - r.top - th - 14;
    tip.style.left = Math.max(4, left) + "px";
    tip.style.top = Math.max(4, topPos) + "px";
  };
  svg.addEventListener("pointermove", (e) => {
    const t = e.target.closest("[data-cc]");
    if (!t) { tip.hidden = true; return; }
    fillTip(t.dataset.cc);
    placeTip(e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  svg.addEventListener("focusin", (e) => {
    const t = e.target.closest("[data-cc]");
    if (!t) return;
    fillTip(t.dataset.cc);
    const b = t.getBoundingClientRect();
    placeTip(b.left + b.width / 2, b.top + b.height / 2);
  });
  svg.addEventListener("focusout", () => { tip.hidden = true; });

  /* ---------- leaderboard ---------- */
  const lb = $("#leaderboard");
  const lbMax = Math.max(1, ...members.map((m) => m.countries.length));
  for (const m of [...members].sort((a, b) => b.countries.length - a.countries.length)) {
    const row = el("div", "lb-row");
    row.appendChild(el("span", "lb-name", `${m.emoji} ${m.name}`));
    const track = el("div", "lb-track");
    const bar = el("div", "lb-bar");
    bar.style.width = `${(m.countries.length / lbMax) * 100}%`;
    track.appendChild(bar);
    track.appendChild(el("span", "lb-val", String(m.countries.length)));
    row.appendChild(track);
    lb.appendChild(row);
  }

  /* ---------- continent checklist ---------- */
  const ct = $("#continents");
  const unByContinent = {};
  for (const c of Object.values(COUNTRIES))
    if (c.un) unByContinent[c.continent] = (unByContinent[c.continent] || 0) + 1;
  const rows = continentsAll
    .filter((c) => c !== "Antarctica")
    .map((c) => {
      const total = unByContinent[c] || 0;
      const got = visited.filter((cc) => COUNTRIES[cc].un && COUNTRIES[cc].continent === c).length;
      return { c, got, total };
    })
    .sort((a, b) => b.got / b.total - a.got / a.total);
  for (const r of rows) {
    const row = el("div", "ct-row");
    row.appendChild(el("span", null, r.c));
    const meter = el("div", "ct-meter");
    const fill = el("div", "ct-fill");
    fill.style.width = `${(r.got / r.total) * 100}%`;
    meter.appendChild(fill);
    row.appendChild(meter);
    row.appendChild(el("span", "ct-val", `${r.got} / ${r.total}`));
    ct.appendChild(row);
  }
  if (contVisited.has("Antarctica")) {
    const who = visitors.get("AQ").map((m) => m.name).join(", ");
    ct.appendChild(el("p", "ct-extra", `🐧 And yes — Antarctica: ${who} actually made it.`));
  }

  /* ---------- full-house & gems ---------- */
  const overlap = $("#overlap");
  if (fullHouse.length) {
    for (const cc of fullHouse) {
      const chip = el("span", "chip");
      chip.appendChild(el("span", null, `${flag(cc)} ${cname(cc)}`));
      overlap.appendChild(chip);
    }
  } else {
    overlap.appendChild(el("p", "empty-note",
      `No country has all ${N} stamps yet — sounds like a group trip waiting to happen.`));
  }
  const gemsEl = $("#gems");
  if (gems.length) {
    for (const cc of gems) {
      const m = visitors.get(cc)[0];
      const chip = el("span", "chip");
      chip.appendChild(el("span", null, `${flag(cc)} ${cname(cc)}`));
      chip.appendChild(el("span", "who", `· ${m.name}`));
      gemsEl.appendChild(chip);
    }
  } else {
    gemsEl.appendChild(el("p", "empty-note", "No solo stamps — this crew travels as a pack."));
  }

  /* ---------- crew polaroids ---------- */
  const crew = $("#members");
  members.forEach((m, i) => {
    const card = el("article", "polaroid");
    const photo = el("div", `p-photo g${i % 4}`, m.emoji);
    card.appendChild(photo);
    const nameRow = el("div", "p-name");
    nameRow.appendChild(el("span", null, `${m.name} ${m.home ? flag(m.home) : ""}`));
    nameRow.appendChild(el("span", "p-count", `${m.countries.length} countries`));
    card.appendChild(nameRow);
    if (m.camera) card.appendChild(el("p", "p-line", `📷 ${m.camera}`));
    if (m.favorite && COUNTRIES[m.favorite])
      card.appendChild(el("p", "p-line", `❤️ Favorite shoot: ${flag(m.favorite)} ${cname(m.favorite)}`));
    const flags = el("p", "p-flags");
    const shown = m.countries.slice(0, 14);
    flags.appendChild(el("span", null, shown.map(flag).join("")));
    if (m.countries.length > shown.length)
      flags.appendChild(el("span", "more", ` +${m.countries.length - shown.length} more`));
    card.appendChild(flags);
    crew.appendChild(card);
  });

  /* ---------- table view ---------- */
  const tableWrap = $("#table");
  const table = el("table");
  const thead = el("thead");
  const hr = el("tr");
  hr.appendChild(el("th", null, "Country"));
  hr.appendChild(el("th", null, "Continent"));
  for (const m of members) hr.appendChild(el("th", "center", `${m.emoji} ${m.name}`));
  hr.appendChild(el("th", "center", "Total"));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el("tbody");
  const sorted = [...visited].sort((a, b) =>
    visitors.get(b).length - visitors.get(a).length || cname(a).localeCompare(cname(b)));
  for (const cc of sorted) {
    const tr = el("tr");
    tr.appendChild(el("td", null, `${flag(cc)} ${cname(cc)}`));
    tr.appendChild(el("td", null, COUNTRIES[cc].continent));
    for (const m of members) {
      const td = el("td", "center");
      if (m.set.has(cc)) td.appendChild(el("span", "tick", "✓"));
      tr.appendChild(td);
    }
    tr.appendChild(el("td", "num", String(visitors.get(cc).length)));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);

  /* ---------- footer ---------- */
  $("#foot-line").textContent =
    `${N} photographers · ${visited.length} countries · ${stamps} stamps — built with ♥ and too many memory cards. ` +
    `Updates itself from data/travelers.js.`;
})();
