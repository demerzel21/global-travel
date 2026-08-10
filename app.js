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

  // coverage scopes — continents and UN subregions — for unlocks & milestones
  const scopes = new Map(); // "continent|Europe" -> { kind, name, key, total, ccs }
  for (const [cc, c] of Object.entries(COUNTRIES)) {
    if (!c.un) continue;
    for (const [kind, name] of [["continent", c.continent], ["region", c.sub]]) {
      if (!name) continue;
      const key = `${kind}|${name}`;
      if (!scopes.has(key)) scopes.set(key, { kind, name, key, total: 0, ccs: [] });
      const s = scopes.get(key);
      s.total++;
      s.ccs.push(cc);
    }
  }
  // drop subregions that are identical to their continent (e.g. South America)
  for (const [key, s] of scopes) {
    if (s.kind !== "region") continue;
    const c = scopes.get(`continent|${s.name}`);
    if (c && c.total === s.total) scopes.delete(key);
  }

  /* ---------- header ---------- */
  if (typeof GROUP !== "undefined" && GROUP.name) {
    $("#group-name").textContent = GROUP.name;
    document.title = GROUP.name + " · The Group Passport";
  }
  $("#group-tagline").textContent = (typeof GROUP !== "undefined" && GROUP.tagline) || "";
  if (typeof GROUP !== "undefined" && GROUP.repo) {
    $("#edit-link").href = `https://github.com/${GROUP.repo}/edit/master/data/travelers.js`;
  }

  /* ---------- data warnings & fresh-passport welcome ---------- */
  if (warnings.length) {
    const box = $("#data-warnings");
    box.hidden = false;
    const w = el("div", "warn");
    w.appendChild(el("strong", null, "Heads up, a few country codes didn’t focus: "));
    w.appendChild(el("span", null, warnings.join(" · ")));
    box.appendChild(w);
  }
  if (N === 0) {
    const box = $("#data-warnings");
    box.hidden = false;
    const s = el("div", "starter");
    s.appendChild(el("strong", null, "🎞️ Fresh passport, blank map. "));
    const span = el("span", null, "Scroll to ");
    const a = el("a", null, "Update your stamps");
    a.href = "#editor";
    span.appendChild(a);
    span.appendChild(document.createTextNode(", pick ➕ New member…, tap your countries, hit Save — and watch the map light up."));
    s.appendChild(span);
    box.appendChild(s);
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
    const sx = wrap.scrollLeft;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = x - r.left + sx + 14;
    let topPos = y - r.top + 14;
    if (left + tw > sx + r.width - 4) left = x - r.left + sx - tw - 14;
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
  if (!members.length) lb.appendChild(el("p", "empty-note", "Nobody on the board yet — add yourself below 👇"));
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
    const done = r.got === r.total;
    const row = el("div", "ct-row" + (done ? " done" : ""));
    row.appendChild(el("span", null, r.c));
    const meter = el("div", "ct-meter");
    const fill = el("div", "ct-fill");
    fill.style.width = `${(r.got / r.total) * 100}%`;
    meter.appendChild(fill);
    row.appendChild(meter);
    row.appendChild(el("span", "ct-val", (done ? "🏆 " : "") + `${r.got} / ${r.total}`));
    ct.appendChild(row);
  }
  if (contVisited.has("Antarctica")) {
    const who = visitors.get("AQ").map((m) => m.name).join(", ");
    ct.appendChild(el("p", "ct-extra", `🐧 And yes — Antarctica: ${who} actually made it.`));
  }
  const unlockedSubs = [...scopes.values()]
    .filter((s) => s.kind === "region" && s.total >= 2 && s.ccs.every((cc) => visitors.has(cc)))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (unlockedSubs.length) {
    ct.appendChild(el("p", "sub-head", "Regions unlocked 🎖️"));
    const subWrap = el("div", "chips");
    for (const s of unlockedSubs) {
      const chip = el("span", "chip");
      chip.appendChild(el("span", null, `🎖️ ${s.name}`));
      chip.appendChild(el("span", "who", `· all ${s.total}`));
      subWrap.appendChild(chip);
    }
    ct.appendChild(subWrap);
  }

  /* ---------- full-house & gems ---------- */
  const overlap = $("#overlap");
  if (fullHouse.length) {
    for (const cc of fullHouse) {
      const chip = el("span", "chip");
      chip.appendChild(el("span", null, `${flag(cc)} ${cname(cc)}`));
      overlap.appendChild(chip);
    }
  } else if (N < 2) {
    overlap.appendChild(el("p", "empty-note",
      "This one needs at least two members — recruit the crew!"));
  } else {
    overlap.appendChild(el("p", "empty-note",
      `No country has all ${N} stamps yet — sounds like a group trip waiting to happen.`));
  }
  const gemsEl = $("#gems");
  if (gems.length) {
    const GEMS_SHOWN = 15;
    gems.forEach((cc, i) => {
      const m = visitors.get(cc)[0];
      const chip = el("span", "chip" + (i >= GEMS_SHOWN ? " chip-hidden" : ""));
      chip.appendChild(el("span", null, `${flag(cc)} ${cname(cc)}`));
      chip.appendChild(el("span", "who", `· ${m.name}`));
      gemsEl.appendChild(chip);
    });
    if (gems.length > GEMS_SHOWN) {
      const more = el("button", "chip chip-more", `show all ${gems.length} ▾`);
      more.type = "button";
      more.addEventListener("click", () => {
        gemsEl.querySelectorAll(".chip-hidden").forEach((c) => c.classList.remove("chip-hidden"));
        more.remove();
      });
      gemsEl.appendChild(more);
    }
  } else {
    gemsEl.appendChild(el("p", "empty-note", visited.length
      ? "No solo stamps — this crew travels as a pack."
      : "No stamps anywhere yet — a blank roll of film, endless possibilities."));
  }

  /* ---------- crossing paths: pairwise heatmap + fun facts ---------- */
  const soloCount = new Map(members.map((m) => [m.name, 0]));
  for (const cc of gems) {
    const m = visitors.get(cc)[0];
    soloCount.set(m.name, soloCount.get(m.name) + 1);
  }
  const pairStats = [];
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++) {
      const a = members[i], b = members[j];
      const shared = a.countries.filter((cc) => b.set.has(cc))
        .sort((x, y) => cname(x).localeCompare(cname(y)));
      const union = new Set([...a.countries, ...b.countries]).size;
      pairStats.push({ a, b, shared, union });
    }

  if (N < 2) $("#pairs-section").hidden = true;
  if (N >= 2) {
    const maxShared = Math.max(1, ...pairStats.map((p) => p.shared.length));
    const hmSize = maxShared > 5 ? Math.ceil(maxShared / 5) : 1;
    const hmBin = (c) => {
      if (maxShared <= 1) return 3;
      if (maxShared <= 5) return 1 + Math.round(((c - 1) * 4) / (maxShared - 1));
      return Math.min(5, Math.floor((c - 1) / hmSize) + 1);
    };
    const sharedOf = (a, b) =>
      pairStats.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

    const hm = el("table", "hm");
    const hmHead = el("thead");
    const hhr = el("tr");
    hhr.appendChild(el("th"));
    for (const m of members) {
      const th = el("th", null, m.emoji);
      th.title = m.name;
      hhr.appendChild(th);
    }
    hmHead.appendChild(hhr);
    hm.appendChild(hmHead);
    const hmBody = el("tbody");
    for (const a of members) {
      const tr = el("tr");
      tr.appendChild(el("th", "rowh", `${a.emoji} ${a.name}`));
      for (const b of members) {
        if (a === b) {
          const td = el("td", "self", String(a.countries.length));
          td.setAttribute("aria-label", `${a.name}: ${a.countries.length} countries total`);
          tr.appendChild(td);
          continue;
        }
        const s = sharedOf(a, b);
        const n = s.shared.length;
        const td = el("td", n ? `pair b${hmBin(n)}` : "pair", String(n));
        td.dataset.pair = `${members.indexOf(a)}:${members.indexOf(b)}`;
        td.setAttribute("tabindex", "0");
        td.setAttribute("aria-label",
          `${a.name} and ${b.name}: ${n} shared ${n === 1 ? "country" : "countries"}` +
          (n ? ` — ${s.shared.map(cname).join(", ")}` : ""));
        tr.appendChild(td);
      }
      hmBody.appendChild(tr);
    }
    hm.appendChild(hmBody);
    $("#heatmap").appendChild(hm);

    const hmLegend = $("#hm-legend");
    const hmKey = (bg, label) => {
      const k = el("span", "key");
      const sw = el("span", "swatch");
      sw.style.background = bg;
      k.appendChild(sw);
      k.appendChild(el("span", null, label));
      hmLegend.appendChild(k);
    };
    hmKey("var(--map-empty)", "no shared stamps");
    if (maxShared <= 5) {
      const seenB = new Set();
      for (let c = 1; c <= maxShared; c++) {
        const b = hmBin(c);
        if (seenB.has(b)) continue;
        seenB.add(b);
        hmKey(`var(--v${b})`, c === 1 ? "1 country" : `${c} countries`);
      }
    } else {
      for (let b = 1; b <= 5; b++) {
        const lo = (b - 1) * hmSize + 1;
        const hi = Math.min(maxShared, b * hmSize);
        if (lo > maxShared) break;
        hmKey(`var(--v${b})`, lo === hi ? `${lo} countries` : `${lo}–${hi} countries`);
      }
    }

    const hmWrap = $("#hm-wrap");
    const hmTip = $("#hm-tooltip");
    const fillHmTip = (a, b) => {
      const s = sharedOf(a, b);
      hmTip.textContent = "";
      hmTip.appendChild(el("div", "t-name", `${a.emoji} ${a.name} × ${b.emoji} ${b.name}`));
      if (s.shared.length) {
        hmTip.appendChild(el("div", "t-count",
          `${s.shared.length} shared ${s.shared.length === 1 ? "country" : "countries"}`));
        const shown = s.shared.slice(0, 10);
        hmTip.appendChild(el("div", "t-who",
          shown.map((cc) => `${flag(cc)} ${cname(cc)}`).join(", ") +
          (s.shared.length > shown.length ? ` +${s.shared.length - shown.length} more` : "")));
      } else {
        hmTip.appendChild(el("div", "t-count", "No overlap yet — two different planets 🪐"));
      }
    };
    const placeHmTip = (x, y) => {
      const r = hmWrap.getBoundingClientRect();
      const sx = hmWrap.scrollLeft;
      hmTip.hidden = false;
      const tw = hmTip.offsetWidth, th = hmTip.offsetHeight;
      let left = x - r.left + sx + 14, topPos = y - r.top + 14;
      if (left + tw > sx + r.width - 4) left = x - r.left + sx - tw - 14;
      if (topPos + th > r.height - 4) topPos = y - r.top - th - 14;
      hmTip.style.left = Math.max(4, left) + "px";
      hmTip.style.top = Math.max(4, topPos) + "px";
    };
    const pairFromCell = (t) => {
      const [ia, ib] = t.dataset.pair.split(":").map(Number);
      return [members[ia], members[ib]];
    };
    hm.addEventListener("pointermove", (e) => {
      const t = e.target.closest("td.pair");
      if (!t) { hmTip.hidden = true; return; }
      fillHmTip(...pairFromCell(t));
      placeHmTip(e.clientX, e.clientY);
    });
    hm.addEventListener("pointerleave", () => { hmTip.hidden = true; });
    hm.addEventListener("focusin", (e) => {
      const t = e.target.closest("td.pair");
      if (!t) return;
      fillHmTip(...pairFromCell(t));
      const b = t.getBoundingClientRect();
      placeHmTip(b.left + b.width / 2, b.top + b.height / 2);
    });
    hm.addEventListener("focusout", () => { hmTip.hidden = true; });

    /* fun facts */
    const facts = $("#facts");
    const fact = (emoji, title, text) => {
      const f = el("div", "fact");
      f.appendChild(el("span", "f-emoji", emoji));
      const body = el("div");
      body.appendChild(el("strong", null, title));
      body.appendChild(el("p", null, text));
      f.appendChild(body);
      facts.appendChild(f);
    };
    const twins = [...pairStats].sort((x, y) => y.shared.length - x.shared.length)[0];
    if (twins.shared.length) {
      const pctSame = Math.round((twins.shared.length / twins.union) * 100);
      fact("👯", "Travel twins",
        `${twins.a.name} & ${twins.b.name} share ${twins.shared.length} stamps — their passports are ${pctSame}% identical.`);
    }
    const opposites = [...pairStats].sort((x, y) => x.shared.length - y.shared.length)[0];
    if (opposites !== twins) {
      fact("🧲", "Opposite itineraries",
        opposites.shared.length === 0
          ? `${opposites.a.name} & ${opposites.b.name} don’t share a single country — two different planets.`
          : `${opposites.a.name} & ${opposites.b.name} overlap on just ${opposites.shared.length} ${opposites.shared.length === 1 ? "country" : "countries"} — swap itineraries, you two.`);
    }
    const dream = [...pairStats].sort((x, y) => y.union - x.union)[0];
    fact("🌍", "The dream team",
      `${dream.a.name} & ${dream.b.name} have covered ${dream.union} countries between them — the widest lens in the group.`);
    const wolf = [...members].sort((x, y) => soloCount.get(y.name) - soloCount.get(x.name))[0];
    if (soloCount.get(wolf.name) > 0)
      fact("🐺", "Lone wolf",
        `${wolf.name} holds ${soloCount.get(wolf.name)} solo stamps — countries no one else in the crew has seen.`);
    const partnersOf = (m) => members.filter((o) =>
      o !== m && sharedOf(m, o).shared.length > 0).length;
    const glue = [...members].sort((x, y) => partnersOf(y) - partnersOf(x))[0];
    if (partnersOf(glue) === N - 1 && members.every((m) => partnersOf(m) === N - 1)) {
      fact("🤝", "Fully entangled",
        "Every pair of us shares at least one country — a properly tangled crew.");
    } else {
      fact("🤝", "The connector",
        `${glue.name} has crossed paths with ${partnersOf(glue)} of the other ${N - 1} — the crew’s connective tissue.`);
    }
  }

  /* ---------- crew polaroids ---------- */
  const crew = $("#members");
  if (!members.length) crew.appendChild(el("p", "empty-note", "The crew shot is empty — be the first in the frame 📷"));
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

  /* ---------- toasts & confetti ---------- */
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let toastHolder = null;
  const showToast = (emoji, title, msg) => {
    if (!toastHolder) {
      toastHolder = el("div", "toast-holder");
      document.body.appendChild(toastHolder);
    }
    const t = el("div", "toast");
    t.setAttribute("role", "status");
    t.appendChild(el("span", "t-emoji", emoji));
    const body = el("div");
    body.appendChild(el("strong", null, title));
    if (msg) body.appendChild(el("p", null, msg));
    t.appendChild(body);
    toastHolder.appendChild(t);
    setTimeout(() => {
      t.classList.add("gone");
      setTimeout(() => t.remove(), 350);
    }, 4200);
  };
  const CONFETTI_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];
  const confetti = (n) => {
    if (reduceMotion || !document.body.animate) return;
    for (let i = 0; i < n; i++) {
      const p = el("span", "confetti");
      p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      p.style.left = (5 + Math.random() * 90) + "vw";
      if (i % 3 === 0) p.style.borderRadius = "50%";
      document.body.appendChild(p);
      p.animate(
        [
          { transform: "translateY(-6vh) rotate(0deg)", opacity: 1 },
          { transform: `translate(${(Math.random() - 0.5) * 40}vw, 106vh) rotate(${Math.round(Math.random() * 900 - 450)}deg)`, opacity: 1 },
        ],
        { duration: 2100 + Math.random() * 1900, delay: Math.random() * 350, easing: "cubic-bezier(.25,.45,.45,1)" }
      ).onfinish = () => p.remove();
    }
  };

  /* ---------- passport editor ---------- */
  (function editor() {
    const whoSel = $("#ed-who");
    const searchRow = $("#ed-search-row");
    const searchIn = $("#ed-search");
    const statusEl = $("#ed-status");
    const chipsEl = $("#ed-chips");
    const actions = $("#ed-actions");
    const output = $("#ed-output");
    const outText = $("#ed-text");
    const mapSvg = $("#map");
    const repo = (typeof GROUP !== "undefined" && GROUP.repo) || "";
    if (repo) $("#ed-open").href = `https://github.com/${repo}/edit/master/data/travelers.js`;

    // country name → code lookup + datalist for the search inputs
    const byName = new Map();
    const datalist = $("#country-list");
    for (const [cc, c] of Object.entries(COUNTRIES)) {
      byName.set(c.name.toLowerCase(), cc);
      const o = el("option");
      o.value = c.name;
      datalist.appendChild(o);
    }
    const resolveCountry = (q) => {
      q = String(q || "").trim();
      if (!q) return null;
      if (q.length === 2 && COUNTRIES[q.toUpperCase()]) return q.toUpperCase();
      return byName.get(q.toLowerCase()) || null;
    };

    // who am I
    const ph = el("option", null, "choose yourself…");
    ph.value = ""; ph.disabled = true; ph.selected = true;
    whoSel.appendChild(ph);
    members.forEach((m, i) => {
      const o = el("option", null, `${m.emoji} ${m.name}`);
      o.value = String(i);
      whoSel.appendChild(o);
    });
    const optNew = el("option", null, "➕ New member…");
    optNew.value = "new";
    whoSel.appendChild(optNew);

    let working = null;      // Set of ccs being edited
    let baseline = new Set();
    let isNew = false;

    const applyMine = () => {
      mapSvg.querySelectorAll(".mine").forEach((n) => n.classList.remove("mine"));
      mapSvg.querySelectorAll("[data-temp]").forEach((n) => n.remove());
      if (!working) return;
      for (const cc of working) {
        let n = mapSvg.querySelector(`[data-cc="${cc}"]`);
        if (!n) {
          const meta = COUNTRIES[cc];
          if (!meta || meta.x == null) continue;
          n = document.createElementNS(SVGNS, "circle");
          n.setAttribute("cx", meta.x);
          n.setAttribute("cy", meta.y);
          n.setAttribute("r", "4.5");
          n.setAttribute("class", "cdot");
          n.style.fill = "var(--map-empty)";
          n.dataset.cc = cc;
          n.dataset.temp = "1";
          mapSvg.appendChild(n);
        }
        n.classList.add("mine");
      }
    };
    const renderChips = () => {
      chipsEl.textContent = "";
      if (!working) return;
      for (const cc of [...working].sort((a, b) => cname(a).localeCompare(cname(b)))) {
        const chip = el("span", baseline.has(cc) ? "chip" : "chip added");
        chip.appendChild(el("span", null, `${flag(cc)} ${cname(cc)}`));
        const x = el("button", null, "✕");
        x.type = "button";
        x.setAttribute("aria-label", `Remove ${cname(cc)}`);
        x.addEventListener("click", () => toggle(cc));
        chip.appendChild(x);
        chipsEl.appendChild(chip);
      }
    };
    const renderStatus = (msg) => {
      if (msg != null) { statusEl.textContent = msg; return; }
      if (!working) { statusEl.textContent = ""; return; }
      const added = [...working].filter((cc) => !baseline.has(cc)).length;
      const removed = [...baseline].filter((cc) => !working.has(cc)).length;
      let delta = "";
      if (added) delta += ` · ${added} added`;
      if (removed) delta += ` · ${removed} removed`;
      statusEl.textContent = `${working.size} ${working.size === 1 ? "country" : "countries"}${delta}`;
    };
    /* local draft — your in-progress edits survive reloads on this device */
    const DRAFT_KEY = "group-passport-draft:" + repo;
    const newFieldIds = ["ed-name", "ed-emoji", "ed-home", "ed-camera", "ed-fav"];
    const saveDraft = () => {
      if (!working) return;
      const dirty = working.size !== baseline.size || [...working].some((cc) => !baseline.has(cc));
      const fields = isNew ? newFieldIds.map((id) => $("#" + id).value) : null;
      if (!dirty && !isNew) { localStorage.removeItem(DRAFT_KEY); return; }
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ who: whoSel.value, countries: [...working], fields }));
      } catch { /* storage full or blocked — drafts just won't persist */ }
    };
    const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} };
    const restoreDraft = () => {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch {}
      if (!d || !d.who || !Array.isArray(d.countries)) return;
      if (d.who !== "new") {
        const m = members[Number(d.who)];
        if (!m) { clearDraft(); return; }
        const saved = new Set(m.countries);
        // draft already matches saved data (e.g. the robot committed it) — nothing to restore
        if (d.countries.length === saved.size && d.countries.every((cc) => saved.has(cc))) { clearDraft(); return; }
      }
      selectWho(d.who);
      if (d.who === "new" && d.fields) newFieldIds.forEach((id, i) => { $("#" + id).value = d.fields[i] || ""; });
      working = new Set(d.countries.filter((cc) => COUNTRIES[cc]));
      achieved = achievedKeys(working);
      applyMine(); renderChips();
      renderStatus();
      statusEl.textContent += " · draft restored from your last visit";
    };

    const refresh = () => { applyMine(); renderChips(); renderStatus(); saveDraft(); };

    /* selection effects: ripple + floating flag + brightness pop on the country */
    const fx = (cc, adding, pt) => {
      if (reduceMotion) return;
      const node = mapSvg.querySelector(`[data-cc="${cc}"]`);
      const wr = wrap.getBoundingClientRect();
      let x, y;
      if (pt) { x = pt.x; y = pt.y; }
      else if (node) {
        const bb = node.getBoundingClientRect();
        x = bb.x + bb.width / 2;
        y = bb.y + bb.height / 2;
      } else return;
      const lx = x - wr.x + wrap.scrollLeft;
      const ly = y - wr.y;
      const rip = el("span", "fx-ripple" + (adding ? "" : " out"));
      rip.style.left = lx + "px";
      rip.style.top = ly + "px";
      wrap.appendChild(rip);
      setTimeout(() => rip.remove(), 700);
      const f = el("span", "fx-flag" + (adding ? "" : " out"), (adding ? "+" : "−") + flag(cc));
      f.style.left = lx + "px";
      f.style.top = ly + "px";
      wrap.appendChild(f);
      setTimeout(() => f.remove(), 950);
      if (node) {
        node.classList.add("fx-pop");
        setTimeout(() => node.classList.remove("fx-pop"), 500);
      }
    };

    /* milestones: fire when your selection crosses continent/region coverage */
    const scopeList = [...scopes.values()].filter((s) => s.kind === "continent" || s.total >= 2);
    const achievedKeys = (set) => {
      const out = new Set();
      for (const s of scopeList) {
        let got = 0;
        for (const cc of s.ccs) if (set.has(cc)) got++;
        if (s.kind === "continent" && s.total >= 6 && got >= s.total / 2) out.add(s.key + "|half");
        if (got === s.total) out.add(s.key + "|full");
      }
      return out;
    };
    let achieved = new Set();
    const pulseScope = (s) => {
      for (const cc of s.ccs) {
        const n = mapSvg.querySelector(`[data-cc="${cc}"]`);
        if (!n) continue;
        n.classList.add("celebrate");
        setTimeout(() => n.classList.remove("celebrate"), 1800);
      }
    };
    const fireMilestone = (key) => {
      const [kind, name, level] = key.split("|");
      const s = scopes.get(`${kind}|${name}`);
      if (!s) return;
      if (kind === "continent" && level === "full") {
        showToast("🏆", `${name} — COMPLETE!`, `Every UN country in ${name}. Absolute legend.`);
        confetti(140);
        pulseScope(s);
      } else if (kind === "continent" && level === "half") {
        showToast("🌗", `Halfway through ${name}!`, `Over half of ${name}’s ${s.total} countries are in your passport.`);
      } else if (kind === "region" && level === "full") {
        showToast("🎖️", `Region unlocked: ${name}`, `All ${s.total} countries — that’s a wrap.`);
        confetti(50);
        pulseScope(s);
      }
    };
    const checkMilestones = () => {
      const now = achievedKeys(working);
      for (const k of now) if (!achieved.has(k)) fireMilestone(k);
      achieved = now;
    };

    const toggle = (cc, pt) => {
      if (!working) return;
      const adding = !working.has(cc);
      adding ? working.add(cc) : working.delete(cc);
      refresh();
      fx(cc, adding, pt);
      checkMilestones();
    };

    const selectWho = (value) => {
      whoSel.value = value;
      isNew = value === "new";
      $("#ed-newfields").hidden = !isNew;
      const m = isNew ? null : members[Number(value)];
      baseline = new Set(m ? m.countries : []);
      working = new Set(baseline);
      achieved = achievedKeys(working); // what you already have doesn't re-fire
      searchRow.hidden = false;
      actions.hidden = false;
      $("#ed-more").hidden = false;
      output.hidden = true;
      mapSvg.classList.add("editing");
      refresh();
    };
    whoSel.addEventListener("change", () => selectWho(whoSel.value));
    mapSvg.addEventListener("click", (e) => {
      if (!working) return;
      const t = e.target.closest("[data-cc]");
      if (t) toggle(t.dataset.cc, { x: e.clientX, y: e.clientY });
    });
    const addFromSearch = () => {
      const cc = resolveCountry(searchIn.value);
      if (!cc) {
        renderStatus(`Hmm, “${searchIn.value.trim()}” isn’t focusing — try the full country name.`);
        return;
      }
      searchIn.value = "";
      if (working.has(cc)) { renderStatus(`${cname(cc)} is already in your list.`); return; }
      toggle(cc);
    };
    $("#ed-add").addEventListener("click", addFromSearch);
    searchIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addFromSearch(); }
    });

    // serialize the whole data file back out
    const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    const HEADER =
`// ✈️  THE GROUP PASSPORT — add yourself here!
//
// Easiest way: use the “Update your stamps ✍️” editor on the page itself —
// pick yourself (or “New member”), tap countries on the map, hit Copy, and
// paste the result over this whole file. This header and formatting are
// regenerated for you.
//
// Editing by hand also works: countries are two-letter ISO 3166-1 codes,
// the same letters as .fr / .jp internet domains. Typos are flagged in a
// banner at the top of the page.

`;
    const serialize = (list, g) => {
      g = g || (typeof GROUP !== "undefined" && GROUP) || { name: "The Group Passport", tagline: "", repo: "" };
      let out = HEADER;
      out += `const GROUP = {\n  name: ${q(g.name)},\n  tagline: ${q(g.tagline)},\n  repo: ${q(g.repo)},\n};\n\nconst TRAVELERS = [\n`;
      for (const m of list) {
        out += `  {\n    name: ${q(m.name)},\n    emoji: ${q(m.emoji)},\n    home: ${q(m.home)},\n    camera: ${q(m.camera)},\n    favorite: ${q(m.favorite)},\n    countries: [\n`;
        for (let i = 0; i < m.countries.length; i += 10)
          out += `      ${m.countries.slice(i, i + 10).map(q).join(", ")},\n`;
        out += `    ],\n  },\n`;
      }
      out += `];\n`;
      return out;
    };
    const myEntry = () => {
      const mine = [...working].sort();
      if (isNew) {
        return {
          name: $("#ed-name").value.trim() || "New Member",
          emoji: $("#ed-emoji").value.trim() || "📷",
          home: resolveCountry($("#ed-home").value) || "",
          camera: $("#ed-camera").value.trim(),
          favorite: resolveCountry($("#ed-fav").value) || "",
          countries: mine,
        };
      }
      const m = members[Number(whoSel.value)];
      return { name: m.name, emoji: m.emoji, home: m.home, camera: m.camera, favorite: m.favorite, countries: mine };
    };
    // apply my edit onto a traveler list (page-load data, or freshly fetched from GitHub)
    const mergeInto = (list) => {
      const cleaned = list.map((m) => ({
        name: String(m.name || ""),
        emoji: String(m.emoji || "📷"),
        home: String(m.home || "").toUpperCase(),
        camera: String(m.camera || ""),
        favorite: String(m.favorite || "").toUpperCase(),
        countries: [...new Set((m.countries || []).map((c) => String(c).trim().toUpperCase()).filter((c) => COUNTRIES[c]))],
      }));
      const me = myEntry();
      const idx = cleaned.findIndex((m) => m.name === me.name);
      if (idx >= 0) cleaned[idx] = { ...cleaned[idx], countries: me.countries };
      else cleaned.push(me);
      return cleaned;
    };
    const fileText = () => serialize(mergeInto(members));
    const showOutput = (text) => {
      outText.value = text;
      output.hidden = false;
      output.open = true;
    };
    $("#ed-copy").addEventListener("click", () => {
      const text = fileText();
      outText.value = text;
      output.hidden = false;
      const done = () => renderStatus("Copied ✓ — now paste it over the whole file on GitHub.");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => {
          showOutput(text);
          renderStatus("Clipboard blocked — copy it from the box below.");
        });
      } else {
        showOutput(text);
        renderStatus("Copy it from the box below.");
      }
    });
    $("#ed-download").addEventListener("click", () => {
      const blob = new Blob([fileText()], { type: "text/javascript" });
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = "travelers.js";
      a.click();
      URL.revokeObjectURL(a.href);
      renderStatus("Downloaded — replace data/travelers.js with it.");
    });
    $("#ed-reset").addEventListener("click", () => {
      if (!working) return;
      working = new Set(baseline);
      achieved = achievedKeys(working);
      clearDraft();
      refresh();
      renderStatus("Back to the last saved version.");
    });

    /* one-tap saving: a fine-grained GitHub token, stored only in this browser */
    const TOKEN_KEY = "group-passport-token";
    const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
    const saveBtn = $("#ed-save");
    const connectBtn = $("#ed-connect");
    const tokenPanel = $("#ed-token-panel");
    const updateAuthUI = () => {
      const has = !!getToken();
      saveBtn.hidden = false;
      connectBtn.textContent = has ? "🔗 GitHub connected (instant saves)" : "⚡ Instant saves: connect GitHub…";
      $("#ed-token-remove").hidden = !has;
    };
    connectBtn.addEventListener("click", () => { tokenPanel.hidden = !tokenPanel.hidden; });
    $("#ed-token-save").addEventListener("click", () => {
      const t = $("#ed-token").value.trim();
      if (!t) return;
      try { localStorage.setItem(TOKEN_KEY, t); } catch {
        renderStatus("This browser blocks local storage — the token can’t be remembered here.");
        return;
      }
      $("#ed-token").value = "";
      tokenPanel.hidden = true;
      updateAuthUI();
      renderStatus("GitHub connected on this device — 💾 Save to GitHub is live.");
    });
    $("#ed-token-remove").addEventListener("click", () => {
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
      tokenPanel.hidden = true;
      updateAuthUI();
      renderStatus("Disconnected — back to copy & paste.");
    });

    const b64encode = (str) => {
      const bytes = new TextEncoder().encode(str);
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin);
    };
    const b64decode = (b64) =>
      new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

    const ghSave = async () => {
      if (!working) return;
      const token = getToken();
      if (!token) { tokenPanel.hidden = false; return; }
      if (!repo) { renderStatus("Set GROUP.repo in data/travelers.js to enable saving."); return; }
      saveBtn.disabled = true;
      renderStatus("Saving to GitHub…");
      const H = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
      const path = `https://api.github.com/repos/${repo}/contents/data/travelers.js`;
      try {
        const rRepo = await fetch(`https://api.github.com/repos/${repo}`, { headers: H });
        if (rRepo.status === 401) throw new Error("GitHub didn’t accept the token — disconnect and reconnect with a fresh one.");
        if (!rRepo.ok) throw new Error(`Couldn’t reach ${repo} — does the token have access to it?`);
        const branch = (await rRepo.json()).default_branch;
        const attempt = async () => {
          const rFile = await fetch(`${path}?ref=${branch}`, { headers: H });
          if (!rFile.ok) throw new Error("Couldn’t read data/travelers.js from GitHub.");
          const file = await rFile.json();
          let remote;
          try {
            remote = new Function(b64decode(file.content) + "\n;return { g: typeof GROUP !== 'undefined' ? GROUP : null, t: TRAVELERS };")();
          } catch {
            throw new Error("The file on GitHub doesn’t parse — fix it by hand first, then save again.");
          }
          const content = serialize(mergeInto(remote.t || []), remote.g || undefined);
          return fetch(path, {
            method: "PUT",
            headers: { ...H, "Content-Type": "application/json" },
            body: JSON.stringify({
              message: `Update stamps: ${myEntry().name} (${working.size} countries)`,
              content: b64encode(content),
              sha: file.sha,
              branch,
            }),
          });
        };
        let res = await attempt();
        if (res.status === 409 || res.status === 422) res = await attempt(); // someone saved in between — remerge on the fresh file
        if (!res.ok) throw new Error(`GitHub rejected the save (HTTP ${res.status}). Check the token’s Contents permission.`);
        clearDraft();
        baseline = new Set(working);
        renderChips();
        renderStatus("Saved ✓");
        showToast("💾", "Saved to GitHub", "Your stamps are committed — the live site updates itself in about a minute.");
      } catch (e) {
        renderStatus(String((e && e.message) || e));
      } finally {
        saveBtn.disabled = false;
      }
    };
    /* zero-setup save: a pre-filled GitHub issue that a repo workflow applies */
    const ghIssueSave = () => {
      const me = myEntry();
      const title = `[stamps] ${me.name} — ${me.countries.length} ${me.countries.length === 1 ? "country" : "countries"}`;
      const bodyText =
        "This issue updates the group passport — just press **Submit new issue** below.\n" +
        "A workflow commits it automatically, closes this issue, and the site updates itself " +
        "about a minute later.\n\n```json\n" + JSON.stringify(me, null, 2) + "\n```\n";
      const url = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(bodyText)}`;
      const w = window.open(url, "_blank", "noopener");
      statusEl.textContent = "One more tap: press “Submit new issue” in the tab that opened — a robot does the rest. ";
      if (!w) {
        const a = el("a", null, "Open GitHub to finish saving ↗");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        statusEl.appendChild(a);
      }
    };
    saveBtn.addEventListener("click", () => (getToken() ? ghSave() : ghIssueSave()));

    newFieldIds.forEach((id) => $("#" + id).addEventListener("input", saveDraft));
    updateAuthUI();
    restoreDraft();
  })();

  /* ---------- footer ---------- */
  $("#foot-line").textContent = N
    ? `${N} photographer${N === 1 ? "" : "s"} · ${visited.length} countries · ${stamps} stamps — built with ♥ and too many memory cards. Updates itself from data/travelers.js.`
    : "A blank passport, waiting for its first stamp — built with ♥ and too many memory cards.";
})();
