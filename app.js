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

  /* ---------- normalize traveler data (mutable — saves update it in place) ---------- */
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

  /* ---------- static reference data ---------- */
  const unTotal = Object.values(COUNTRIES).filter((c) => c.un).length;
  const continentsAll = ["Africa", "Asia", "Europe", "North America", "South America", "Oceania", "Antarctica"];
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

  /* ---------- identity: who this device belongs to ---------- */
  const ID_KEY = "group-passport-identity";
  const getIdentity = () => {
    try { return JSON.parse(localStorage.getItem(ID_KEY)); } catch { return null; }
  };
  const setIdentity = (v) => {
    try { v ? localStorage.setItem(ID_KEY, JSON.stringify(v)) : localStorage.removeItem(ID_KEY); } catch {}
  };
  let onSavedIdentity = null; // set by the identity module; called after a save creates you

  /* ---------- header ---------- */
  if (typeof GROUP !== "undefined" && GROUP.name) {
    $("#group-name").textContent = GROUP.name;
    document.title = GROUP.name + " · The Group Passport";
  }
  $("#group-tagline").textContent = (typeof GROUP !== "undefined" && GROUP.tagline) || "";

  /* ---------- data warnings & fresh-passport welcome ---------- */
  if (warnings.length) {
    const box = $("#data-warnings");
    box.hidden = false;
    const w = el("div", "warn");
    w.appendChild(el("strong", null, "Heads up, a few country codes didn’t focus: "));
    w.appendChild(el("span", null, warnings.join(" · ")));
    box.appendChild(w);
  }
  if (members.length === 0) {
    const box = $("#data-warnings");
    box.hidden = false;
    const s = el("div", "starter");
    s.appendChild(el("strong", null, "🎞️ Fresh passport, blank map. "));
    s.appendChild(el("span", null, "Hit ➕ Add yourself, tap your countries, save — and watch the map light up."));
    box.appendChild(s);
  }

  /* ---------- live view state (recomputed by renderData) ---------- */
  let visitors = new Map(); // cc -> array of member objects, for the current view
  let liveN = members.length;

  /* ---------- map: create geometry once, shade it on every render ---------- */
  const svg = $("#map");
  svg.setAttribute("viewBox", `0 0 ${WORLD_MAP.width} ${WORLD_MAP.height}`);
  let lastPointerType = "mouse"; // touch taps identify-then-confirm; mouse clicks act instantly
  svg.addEventListener("pointerdown", (e) => { lastPointerType = e.pointerType || "mouse"; }, true);
  const whoLine = (cc) => {
    const v = visitors.get(cc);
    return v ? v.map((m) => `${m.emoji} ${m.name}`).join(", ") : "";
  };
  for (const [cc, d] of Object.entries(WORLD_MAP.paths)) {
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d);
    p.setAttribute("class", "country");
    p.dataset.cc = cc;
    svg.appendChild(p);
  }
  // countries too small for the 110m map get a dot at their centroid (hidden until visited)
  for (const [cc, meta] of Object.entries(COUNTRIES)) {
    if (WORLD_MAP.paths[cc] || meta.x == null) continue;
    const dot = document.createElementNS(SVGNS, "circle");
    dot.setAttribute("cx", meta.x);
    dot.setAttribute("cy", meta.y);
    dot.setAttribute("r", "4.5");
    dot.setAttribute("class", "cdot off");
    dot.dataset.cc = cc;
    svg.appendChild(dot);
  }

  /* ---------- map zoom & pan ---------- */
  const mapView = (function () {
    const W = WORLD_MAP.width, H = WORLD_MAP.height;
    const MAXZ = 20; // deep enough to comfortably tap Jordan, Malta, the Caribbean…
    const vb = { x: 0, y: 0, w: W, h: H };
    let dragging = false;
    let suppressClick = false;
    const zoomLevel = () => W / vb.w;
    const syncUI = () => {
      const zoomed = zoomLevel() > 1.01;
      $("#zoom-reset").hidden = !zoomed;
      // at rest, one finger scrolls the page; zoomed in, it pans the map
      svg.style.touchAction = zoomed ? "none" : "pan-y";
      svg.classList.toggle("zoomed", zoomed);
    };
    const apply = () => {
      vb.w = Math.min(W, Math.max(W / MAXZ, vb.w));
      vb.h = vb.w * (H / W);
      vb.x = Math.min(W - vb.w, Math.max(0, vb.x));
      vb.y = Math.min(H - vb.h, Math.max(0, vb.y));
      svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
      // dots grow gently with zoom instead of ballooning linearly
      const rr = (4.5 / Math.sqrt(zoomLevel())).toFixed(2);
      svg.querySelectorAll(".cdot").forEach((d) => d.setAttribute("r", rr));
      syncUI();
    };
    const zoomAt = (cx, cy, f) => {
      const r = svg.getBoundingClientRect();
      const px = vb.x + ((cx - r.left) / r.width) * vb.w;
      const py = vb.y + ((cy - r.top) / r.height) * vb.h;
      const nw = Math.min(W, Math.max(W / MAXZ, vb.w / f));
      vb.x = px - ((px - vb.x) / vb.w) * nw;
      vb.y = py - ((py - vb.y) / vb.h) * (nw * (H / W));
      vb.w = nw;
      apply();
    };
    const center = () => {
      const r = svg.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    };
    $("#zoom-in").addEventListener("click", () => zoomAt(...center(), 1.5));
    $("#zoom-out").addEventListener("click", () => zoomAt(...center(), 1 / 1.5));
    $("#zoom-reset").addEventListener("click", () => {
      vb.x = 0; vb.y = 0; vb.w = W; vb.h = H;
      apply();
    });
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.3 : 1 / 1.3);
    }, { passive: false });

    // drag to pan (when zoomed) + two-finger pinch
    const pts = new Map();
    let moved = 0, lastMid = null, lastDist = 0;
    svg.addEventListener("pointerdown", (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) moved = 0;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        lastDist = Math.hypot(a.x - b.x, a.y - b.y);
        lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    });
    window.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        if (zoomLevel() <= 1.01) return;
        if (e.pointerType === "mouse" && !e.buttons) return;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4) dragging = true;
        const r = svg.getBoundingClientRect();
        vb.x -= dx * (vb.w / r.width);
        vb.y -= dy * (vb.h / r.height);
        apply();
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (lastDist > 0 && dist > 0) zoomAt(mid.x, mid.y, dist / lastDist);
        if (lastMid) {
          const r = svg.getBoundingClientRect();
          vb.x -= (mid.x - lastMid.x) * (vb.w / r.width);
          vb.y -= (mid.y - lastMid.y) * (vb.h / r.height);
          apply();
        }
        lastDist = dist;
        lastMid = mid;
        moved = 10;
        dragging = true;
      }
    });
    const endPt = (e) => {
      if (!pts.delete(e.pointerId)) return;
      if (pts.size < 2) { lastDist = 0; lastMid = null; }
      if (pts.size === 0) {
        if (moved > 4) {
          suppressClick = true; // the click right after a drag isn't a tap
          setTimeout(() => { suppressClick = false; }, 150);
        }
        dragging = false;
      }
    };
    window.addEventListener("pointerup", endPt);
    window.addEventListener("pointercancel", endPt);
    syncUI();
    return { isDragging: () => dragging, clickSuppressed: () => suppressClick };
  })();

  /* ---------- map tooltip ---------- */
  const wrap = $("#map-wrap");
  const tip = $("#map-tooltip");
  const fillTip = (cc) => {
    tip.textContent = "";
    const v = visitors.get(cc);
    tip.appendChild(el("div", "t-name", `${flag(cc)} ${cname(cc)}`));
    if (v) {
      tip.appendChild(el("div", "t-count", `${v.length} of ${liveN} have the stamp`));
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
    if (mapView.isDragging()) { tip.hidden = true; return; }
    // while editing on touch, the confirm callout does the identifying
    if (e.pointerType === "touch" && svg.classList.contains("editing")) { tip.hidden = true; return; }
    const t = e.target.closest("[data-cc]");
    if (!t) { tip.hidden = true; return; }
    fillTip(t.dataset.cc);
    placeTip(e.clientX, e.clientY);
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  // touch, outside editing: a tap pins the info card so you can identify a
  // country by name without selecting anything (mouse users just hover)
  svg.addEventListener("click", (e) => {
    if (svg.classList.contains("editing")) return; // the editor's callout owns taps there
    if (lastPointerType !== "touch" || mapView.clickSuppressed()) return;
    const t = e.target.closest("[data-cc]");
    if (!t) { tip.hidden = true; return; }
    fillTip(t.dataset.cc);
    placeTip(e.clientX, e.clientY - 34); // lift it clear of the finger
  });
  // tapping anywhere off the map dismisses the pinned card
  document.addEventListener("click", (e) => {
    if (!e.target.closest || !e.target.closest("#map-wrap")) tip.hidden = true;
  });
  svg.addEventListener("focusin", (e) => {
    const t = e.target.closest("[data-cc]");
    if (!t) return;
    fillTip(t.dataset.cc);
    const b = t.getBoundingClientRect();
    placeTip(b.left + b.width / 2, b.top + b.height / 2);
  });
  svg.addEventListener("focusout", () => { tip.hidden = true; });

  /* ---------- toasts & confetti ---------- */
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let toastHolder = null;
  const showToast = (emoji, title, msg, onTap) => {
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
    if (onTap) {
      t.style.cursor = "pointer";
      t.addEventListener("click", onTap);
    }
    toastHolder.appendChild(t);
    setTimeout(() => {
      t.classList.add("gone");
      setTimeout(() => t.remove(), 350);
    }, onTap ? 8000 : 4200);
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

  /* ---------- renderData: every stat on the page, as a function of a member list ----------
     Called with the saved members at load, and with the live edited list on every
     tap while editing — the whole page previews your changes in real time. */
  let gemsExpanded = false;
  let firstRender = true;
  const statPrev = new Map();  // stat label -> last value (for count-up)
  const lbPrev = new Map();    // member name -> last bar width %
  const ctPrev = new Map();    // continent -> last meter width %
  const animateNumber = (elm, from, to, suffix) => {
    if (reduceMotion || from === to) { elm.textContent = to + suffix; return; }
    const start = performance.now();
    const dur = 650;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      elm.textContent = Math.round(from + (to - from) * eased) + suffix;
      if (t < 1 && elm.isConnected) requestAnimationFrame(step);
      else if (elm.isConnected) elm.textContent = to + suffix;
    };
    requestAnimationFrame(step);
  };
  function renderData(list) {
    const n = list.length;
    liveN = n;

    // aggregates
    visitors = new Map();
    for (const m of list)
      for (const cc of m.countries) {
        if (!visitors.has(cc)) visitors.set(cc, []);
        visitors.get(cc).push(m);
      }
    const visited = [...visitors.keys()];
    const counts = [...visitors.values()].map((v) => v.length);
    const maxCount = counts.length ? Math.max(...counts) : 0;
    const unVisited = visited.filter((cc) => COUNTRIES[cc].un).length;
    const stamps = list.reduce((s, m) => s + m.countries.length, 0);
    const gems = visited.filter((cc) => visitors.get(cc).length === 1)
      .sort((a, b) => cname(a).localeCompare(cname(b)));
    const fullHouse = visited.filter((cc) => visitors.get(cc).length === n && n > 1)
      .sort((a, b) => cname(a).localeCompare(cname(b)));
    const meName = (() => {
      const id = getIdentity();
      return id && id.type === "member" ? id.name : null;
    })();

    /* KPI row */
    const kpis = $("#kpis");
    kpis.textContent = "";
    const stat = (label, value, note, hero) => {
      const s = el("div", "stat" + (hero ? " hero" : ""));
      s.appendChild(el("p", "label", label));
      const valEl = el("p", "value");
      const numM = String(value).match(/^(\d+)([\s\S]*)$/);
      const prev = statPrev.get(label);
      statPrev.set(label, value);
      if (numM && value !== prev) {
        const to = +numM[1];
        const suffix = numM[2];
        const prevM = prev != null ? String(prev).match(/^(\d+)/) : null;
        const from = prevM ? +prevM[1] : 0;
        animateNumber(valEl, from, to, suffix);
        if (!reduceMotion && from !== to) {
          valEl.classList.add("bump");
          setTimeout(() => valEl.classList.remove("bump"), 700);
        }
      } else {
        valEl.textContent = value;
      }
      s.appendChild(valEl);
      if (note) s.appendChild(el("p", "note", note));
      kpis.appendChild(s);
    };
    const pct = unTotal ? Math.round((unVisited / unTotal) * 100) : 0;
    const contVisited = new Set(visited.map((cc) => COUNTRIES[cc].continent));
    const top = [...list].sort((a, b) => b.countries.length - a.countries.length)[0];
    stat("Countries in the group passport", String(visited.length),
      `${pct}% of the world’s ${unTotal} UN countries`, true);
    stat("Passport stamps", String(stamps), "every member-visit, added up");
    stat("Continents", `${continentsAll.filter((c) => contVisited.has(c)).length} of 7`,
      contVisited.has("Antarctica") ? "including Antarctica — legends 🐧" : "Antarctica still awaits 🐧");
    if (top) stat("Most traveled", String(top.countries.length), `${top.emoji} ${top.name} leads the pack`);
    stat("Hidden gems", String(gems.length), "countries only one of us has seen");

    /* choropleth bins + legend */
    const binSize = maxCount > 5 ? Math.ceil(maxCount / 5) : 1;
    const binOf = (c) => {
      if (maxCount <= 1) return 3;
      if (maxCount <= 5) return 1 + Math.round(((c - 1) * 4) / (maxCount - 1));
      return Math.min(5, Math.floor((c - 1) / binSize) + 1);
    };
    const legend = $("#map-legend");
    legend.textContent = "";
    const legendKey = (bg, label) => {
      const k = el("span", "key");
      const sw = el("span", "swatch");
      sw.style.background = bg;
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

    /* map shading (geometry is static; classes carry the data) */
    for (const node of svg.querySelectorAll("[data-cc]")) {
      const cc = node.dataset.cc;
      const v = visitors.get(cc);
      const keepMine = node.classList.contains("mine");
      const keepPending = node.classList.contains("pending");
      if (node.tagName === "path") {
        node.setAttribute("class", v ? `country hit b${binOf(v.length)}` : "country");
      } else {
        node.setAttribute("class", v ? `cdot b${binOf(v.length)}` : "cdot off");
      }
      if (keepMine) node.classList.add("mine");
      if (keepPending) node.classList.add("pending");
      if (v) {
        node.setAttribute("tabindex", "0");
        node.setAttribute("role", "img");
        node.setAttribute("aria-label", `${cname(cc)}: ${v.length} of ${n} — ${v.map((m) => m.name).join(", ")}`);
      } else {
        node.removeAttribute("tabindex");
        node.removeAttribute("role");
        node.removeAttribute("aria-label");
      }
    }

    /* leaderboard */
    const lb = $("#leaderboard");
    lb.textContent = "";
    if (!list.length) lb.appendChild(el("p", "empty-note", "Nobody on the board yet — add yourself below 👇"));
    const lbMax = Math.max(1, ...list.map((m) => m.countries.length));
    for (const m of [...list].sort((a, b) => b.countries.length - a.countries.length)) {
      const row = el("div", "lb-row");
      const nameEl = el("span", "lb-name", `${m.emoji} ${m.name}`);
      if (meName && m.name === meName) nameEl.appendChild(el("span", "you-badge", "· you"));
      row.appendChild(nameEl);
      const track = el("div", "lb-track");
      const barEl = el("div", "lb-bar");
      const pctW = (m.countries.length / lbMax) * 100;
      barEl.style.width = `${pctW}%`;
      const prevW = lbPrev.has(m.name) ? lbPrev.get(m.name) : (firstRender ? 0 : null);
      lbPrev.set(m.name, pctW);
      if (!reduceMotion && barEl.animate && prevW != null && Math.abs(prevW - pctW) > 0.5)
        barEl.animate([{ width: prevW + "%" }, { width: pctW + "%" }], { duration: 500, easing: "ease-out" });
      track.appendChild(barEl);
      track.appendChild(el("span", "lb-val", String(m.countries.length)));
      row.appendChild(track);
      lb.appendChild(row);
    }

    /* continent checklist + unlocked regions */
    const ct = $("#continents");
    ct.textContent = "";
    const rows = continentsAll
      .filter((c) => c !== "Antarctica")
      .map((c) => {
        const scope = scopes.get(`continent|${c}`);
        const total = scope ? scope.total : 0;
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
      const pctW = (r.got / r.total) * 100;
      fill.style.width = `${pctW}%`;
      const prevW = ctPrev.has(r.c) ? ctPrev.get(r.c) : (firstRender ? 0 : null);
      ctPrev.set(r.c, pctW);
      if (!reduceMotion && fill.animate && prevW != null && Math.abs(prevW - pctW) > 0.1)
        fill.animate([{ width: prevW + "%" }, { width: pctW + "%" }], { duration: 500, easing: "ease-out" });
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

    /* full-house & hidden gems */
    const overlap = $("#overlap");
    overlap.textContent = "";
    if (fullHouse.length) {
      for (const cc of fullHouse) {
        const chip = el("span", "chip");
        chip.appendChild(el("span", null, `${flag(cc)} ${cname(cc)}`));
        overlap.appendChild(chip);
      }
    } else if (n < 2) {
      overlap.appendChild(el("p", "empty-note", "This one needs at least two members — recruit the crew!"));
    } else {
      overlap.appendChild(el("p", "empty-note",
        `No country has all ${n} stamps yet — sounds like a group trip waiting to happen.`));
    }
    const gemsEl = $("#gems");
    gemsEl.textContent = "";
    if (gems.length) {
      const GEMS_SHOWN = 15;
      gems.forEach((cc, i) => {
        const m = visitors.get(cc)[0];
        const chip = el("span", "chip" + (!gemsExpanded && i >= GEMS_SHOWN ? " chip-hidden" : ""));
        chip.appendChild(el("span", null, `${flag(cc)} ${cname(cc)}`));
        chip.appendChild(el("span", "who", `· ${m.name}`));
        gemsEl.appendChild(chip);
      });
      if (!gemsExpanded && gems.length > GEMS_SHOWN) {
        const more = el("button", "chip chip-more", `show all ${gems.length} ▾`);
        more.type = "button";
        more.addEventListener("click", () => {
          gemsExpanded = true;
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

    /* crossing paths: pairwise heatmap + fun facts */
    $("#pairs-section").hidden = n < 2;
    $("#heatmap").textContent = "";
    $("#hm-legend").textContent = "";
    $("#facts").textContent = "";
    if (n >= 2) {
      const soloCount = new Map(list.map((m) => [m.name, 0]));
      for (const cc of gems) {
        const m = visitors.get(cc)[0];
        soloCount.set(m.name, soloCount.get(m.name) + 1);
      }
      const pairStats = [];
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const a = list[i], b = list[j];
          const bSet = b.set || new Set(b.countries);
          const shared = a.countries.filter((cc) => bSet.has(cc))
            .sort((x, y) => cname(x).localeCompare(cname(y)));
          const union = new Set([...a.countries, ...b.countries]).size;
          pairStats.push({ a, b, shared, union });
        }
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
      for (const m of list) {
        const th = el("th", null, m.emoji);
        th.title = m.name;
        hhr.appendChild(th);
      }
      hmHead.appendChild(hhr);
      hm.appendChild(hmHead);
      const hmBody = el("tbody");
      for (const a of list) {
        const tr = el("tr");
        tr.appendChild(el("th", "rowh", `${a.emoji} ${a.name}`));
        for (const b of list) {
          if (a === b) {
            const td = el("td", "self", String(a.countries.length));
            td.setAttribute("aria-label", `${a.name}: ${a.countries.length} countries total`);
            tr.appendChild(td);
            continue;
          }
          const s = sharedOf(a, b);
          const cnt = s.shared.length;
          const td = el("td", cnt ? `pair b${hmBin(cnt)}` : "pair", String(cnt));
          td.dataset.pair = `${list.indexOf(a)}:${list.indexOf(b)}`;
          td.setAttribute("tabindex", "0");
          td.setAttribute("aria-label",
            `${a.name} and ${b.name}: ${cnt} shared ${cnt === 1 ? "country" : "countries"}` +
            (cnt ? ` — ${s.shared.map(cname).join(", ")}` : ""));
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
        return [list[ia], list[ib]];
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
      const wolf = [...list].sort((x, y) => soloCount.get(y.name) - soloCount.get(x.name))[0];
      if (soloCount.get(wolf.name) > 0)
        fact("🐺", "Lone wolf",
          `${wolf.name} holds ${soloCount.get(wolf.name)} solo stamps — countries no one else in the crew has seen.`);
      const partnersOf = (m) => list.filter((o) =>
        o !== m && sharedOf(m, o).shared.length > 0).length;
      const glue = [...list].sort((x, y) => partnersOf(y) - partnersOf(x))[0];
      if (partnersOf(glue) === n - 1 && list.every((m) => partnersOf(m) === n - 1)) {
        fact("🤝", "Fully entangled",
          "Every pair of us shares at least one country — a properly tangled crew.");
      } else {
        fact("🤝", "The connector",
          `${glue.name} has crossed paths with ${partnersOf(glue)} of the other ${n - 1} — the crew’s connective tissue.`);
      }
    }

    /* crew polaroids */
    const crew = $("#members");
    crew.textContent = "";
    if (!list.length) crew.appendChild(el("p", "empty-note", "The crew shot is empty — be the first in the frame 📷"));
    list.forEach((m, i) => {
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

    /* table view */
    const tableWrap = $("#table");
    tableWrap.textContent = "";
    const table = el("table");
    const thead = el("thead");
    const hr = el("tr");
    hr.appendChild(el("th", null, "Country"));
    hr.appendChild(el("th", null, "Continent"));
    for (const m of list) hr.appendChild(el("th", "center", `${m.emoji} ${m.name}`));
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
      for (const m of list) {
        const td = el("td", "center");
        const mset = m.set || new Set(m.countries);
        if (mset.has(cc)) td.appendChild(el("span", "tick", "✓"));
        tr.appendChild(td);
      }
      tr.appendChild(el("td", "num", String(visitors.get(cc).length)));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    /* footer */
    $("#foot-line").textContent = n
      ? `${n} photographer${n === 1 ? "" : "s"} · ${visited.length} countries · ${stamps} stamps — built with ♥ and too many memory cards. Updates itself from data/travelers.js.`
      : "A blank passport, waiting for its first stamp — built with ♥ and too many memory cards.";

    firstRender = false;
  }

  renderData(members);

  /* ---------- passport editor: modal onboarding + floating edit bar ---------- */
  const editorAPI = (function editor() {
    const bar = $("#edit-bar");
    const labelEl = $("#eb-label");
    const statusEl = $("#eb-status");
    const searchIn = $("#ed-search");
    const saveBtn = $("#ed-save");
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

    let working = null;      // Set of ccs being edited (null = not editing)
    let baseline = new Set();
    let isNew = false;
    let memberIdx = -1;
    const isDirty = () =>
      !!working && (working.size !== baseline.size || [...working].some((cc) => !baseline.has(cc)));

    // the member list with your in-progress edits applied — feeds the live page
    const effectiveList = () => {
      if (!working) return members;
      const mine = [...working].sort();
      if (isNew) {
        const e = myEntry();
        return [...members, { ...e, set: new Set(e.countries) }];
      }
      return members.map((m, i) =>
        i === memberIdx ? { ...m, countries: mine, set: new Set(mine) } : m);
    };

    const applyMine = () => {
      svg.querySelectorAll(".mine").forEach((n) => n.classList.remove("mine"));
      if (!working) return;
      for (const cc of working) {
        const n = svg.querySelector(`[data-cc="${cc}"]`);
        if (n) n.classList.add("mine");
      }
    };
    const renderStatus = (msg) => {
      saveBtn.classList.toggle("attn", isDirty());
      if (msg != null) { statusEl.textContent = msg; return; }
      if (!working) { statusEl.textContent = ""; return; }
      if (!working.size) { statusEl.textContent = "Tap the map to add your countries"; return; }
      const added = [...working].filter((cc) => !baseline.has(cc)).length;
      const removed = [...baseline].filter((cc) => !working.has(cc)).length;
      let delta = "";
      if (added) delta += ` · ${added} added`;
      if (removed) delta += ` · ${removed} removed`;
      if (!added && !removed && !isNew) delta = " · all saved ✓";
      statusEl.textContent = `${working.size} ${working.size === 1 ? "country" : "countries"}${delta}`;
    };
    const setLabel = () => {
      labelEl.textContent = isNew
        ? `✍️ Adding ${$("#ed-name").value.trim() || "you"}`
        : `✍️ ${members[memberIdx].emoji} ${members[memberIdx].name}`;
    };

    /* local draft — in-progress edits survive reloads on this device */
    const DRAFT_KEY = "group-passport-draft:" + repo;
    const newFieldIds = ["ed-name", "ed-emoji", "ed-home", "ed-camera", "ed-fav"];
    const saveDraft = () => {
      if (!working) return;
      const fields = isNew ? newFieldIds.map((id) => $("#" + id).value) : null;
      if (!isDirty() && !isNew) { localStorage.removeItem(DRAFT_KEY); return; }
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
          who: isNew ? "new" : String(memberIdx),
          countries: [...working],
          fields,
        }));
      } catch { /* storage blocked — drafts just won't persist */ }
    };
    const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} };

    // the whole page previews your edits live
    const refresh = () => { renderData(effectiveList()); applyMine(); renderStatus(); saveDraft(); };

    /* selection effects: ripple + floating flag + brightness pop on the country */
    const fx = (cc, adding, pt) => {
      if (reduceMotion) return;
      const node = svg.querySelector(`[data-cc="${cc}"]`);
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
      f.appendChild(el("span", "fx-name", cname(cc)));
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
        const n = svg.querySelector(`[data-cc="${cc}"]`);
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
      hideConfirm();
      const adding = !working.has(cc);
      adding ? working.add(cc) : working.delete(cc);
      if (adding) lastAdded = cc; // powers "near your last add" suggestions
      refresh();
      fx(cc, adding, pt);
      checkMilestones();
    };

    /* touch confirm callout: first tap names the country, second tap (or the
       button) toggles it — so you never commit to a shape you can't identify */
    let pendingCC = null;
    let confirmEl = null;
    const hideConfirm = () => {
      if (confirmEl) { confirmEl.remove(); confirmEl = null; }
      if (pendingCC) {
        const n = svg.querySelector(`[data-cc="${pendingCC}"]`);
        if (n) n.classList.remove("pending");
        pendingCC = null;
      }
    };
    const showConfirm = (cc, pt) => {
      hideConfirm();
      pendingCC = cc;
      const node = svg.querySelector(`[data-cc="${cc}"]`);
      if (node) node.classList.add("pending");
      const adding = !working.has(cc);
      confirmEl = el("div", "confirm-pop");
      const name = el("span", "cp-name");
      name.appendChild(el("span", "cp-flag", flag(cc)));
      name.appendChild(el("span", null, cname(cc)));
      confirmEl.appendChild(name);
      const act = el("button", "btn primary", adding ? "＋ Add" : "− Remove");
      act.type = "button";
      act.addEventListener("click", (e2) => { e2.stopPropagation(); toggle(cc, pt); });
      confirmEl.appendChild(act);
      const x = el("button", "cp-x", "✕");
      x.type = "button";
      x.setAttribute("aria-label", "Cancel");
      x.addEventListener("click", (e2) => { e2.stopPropagation(); hideConfirm(); });
      confirmEl.appendChild(x);
      const wr = wrap.getBoundingClientRect();
      wrap.appendChild(confirmEl);
      const half = confirmEl.offsetWidth / 2;
      const lx = Math.min(wr.width - half - 6, Math.max(half + 6, pt.x - wr.x + wrap.scrollLeft));
      const ly = Math.max(confirmEl.offsetHeight + 18, pt.y - wr.y);
      confirmEl.style.left = lx + "px";
      confirmEl.style.top = ly + "px";
      tip.hidden = true;
    };
    svg.addEventListener("wheel", hideConfirm, { passive: true });
    const confirmToggle = (cc, pt) => {
      if (lastPointerType !== "touch") { toggle(cc, pt); return; }
      if (pendingCC === cc) { toggle(cc, pt); return; } // second tap on the country confirms
      showConfirm(cc, pt);
    };

    /* enter / leave editing mode — the bar is the only editing chrome on screen */
    const enterEdit = (value) => {
      isNew = value === "new";
      memberIdx = isNew ? -1 : Number(value);
      const m = isNew ? null : members[memberIdx];
      baseline = new Set(m ? m.countries : []);
      working = new Set(baseline);
      achieved = achievedKeys(working);
      bar.hidden = false;
      document.body.classList.add("editing");
      svg.classList.add("editing");
      setLabel();
      $("#map-hint").textContent = "Tap countries to add or remove them.";
      refresh();
    };
    const exitEdit = () => {
      if (!working) return;
      const dirty = isDirty();
      working = null;
      baseline = new Set();
      isNew = false;
      memberIdx = -1;
      bar.hidden = true;
      document.body.classList.remove("editing");
      svg.classList.remove("editing");
      $("#map-hint").textContent = "";
      hideConfirm();
      closeSuggest();
      searchIn.value = "";
      renderData(members);
      applyMine();
      closeMenu();
      if (dirty) showToast("📝", "Draft kept", "Your unsaved changes are safe on this device — come back anytime.");
    };
    $("#eb-done").addEventListener("click", exitEdit);

    // after a confirmed save, fold your edits into the page's saved data
    const commitLocal = () => {
      const me = myEntry();
      if (isNew) {
        members.push({ ...me, set: new Set(me.countries) });
        memberIdx = members.length - 1;
        isNew = false;
      } else {
        members[memberIdx] = { ...members[memberIdx], countries: me.countries, set: new Set(me.countries) };
      }
      baseline = new Set(working);
      setLabel();
      if (onSavedIdentity) onSavedIdentity(me.name);
      refresh();
    };

    // fat-finger assist: a tap on empty water near a country snaps to the
    // closest one — probe rings of increasing radius, majority vote per ring
    const findNearby = (x, y) => {
      for (const rad of [6, 11, 17, 24]) {
        const hits = new Map();
        for (let a = 0; a < 12; a++) {
          const ang = (Math.PI / 6) * a;
          const hit = document.elementFromPoint(x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
          const n = hit && hit.closest && hit.closest("[data-cc]");
          if (n) hits.set(n, (hits.get(n) || 0) + 1);
        }
        if (hits.size) return [...hits.entries()].sort((a, b) => b[1] - a[1])[0][0];
      }
      return null;
    };
    svg.addEventListener("click", (e) => {
      if (!working || mapView.clickSuppressed()) return;
      const t = e.target.closest("[data-cc]") || findNearby(e.clientX, e.clientY);
      if (t) confirmToggle(t.dataset.cc, { x: e.clientX, y: e.clientY });
      else hideConfirm(); // tapped open water far from anything — dismiss
    });
    /* typeahead: suggestions populate as you type — names, codes, and whole
       regions ("Caribbean" lists every Caribbean country to tap through).
       Smart matching: aliases, diacritic-blind, typo-tolerant, and contextual
       suggestions (neighbors of your last add) when the box is empty. */
    const panel = $("#suggest-panel");
    let sgItems = [];
    let sgActive = -1;
    let lastAdded = null;
    const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const ALIASES = {
      "usa": "US", "america": "US", "united states of america": "US",
      "uk": "GB", "britain": "GB", "great britain": "GB", "england": "GB",
      "uae": "AE", "emirates": "AE",
      "holland": "NL",
      "korea": "KR",
      "burma": "MM",
      "czech republic": "CZ",
      "cote d'ivoire": "CI", "cote divoire": "CI",
      "cape verde": "CV",
      "swaziland": "SZ",
      "macedonia": "MK",
      "east timor": "TL",
      "vatican": "VA",
      "turkey": "TR",
      "drc": "CD", "congo kinshasa": "CD", "congo brazzaville": "CG",
      "brasil": "BR",
      "persia": "IR",
    };
    const NAME_INDEX = Object.entries(COUNTRIES).map(([cc, c]) => ({ cc, n: norm(c.name) }));
    // bounded edit distance for typo tolerance
    const lev = (a, b, max) => {
      if (Math.abs(a.length - b.length) > max) return max + 1;
      let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
          if (cur[j] < rowMin) rowMin = cur[j];
        }
        if (rowMin > max) return max + 1;
        prev = cur;
      }
      return prev[b.length];
    };
    const closeSuggest = () => {
      panel.hidden = true;
      panel.textContent = "";
      sgItems = [];
      sgActive = -1;
      searchIn.setAttribute("aria-expanded", "false");
    };
    const buildMatches = (qRaw) => {
      const q = norm(qRaw.trim());
      if (!q) {
        // empty box: contextual suggestions instead of silence
        const have = working || new Set();
        if (lastAdded && COUNTRIES[lastAdded]) {
          const sub = COUNTRIES[lastAdded].sub;
          const near = NAME_INDEX
            .filter((e) => COUNTRIES[e.cc].sub === sub && !have.has(e.cc))
            .map((e) => e.cc)
            .sort((a, b) => cname(a).localeCompare(cname(b)))
            .slice(0, 8);
          if (near.length) return { rows: [], region: null, context: { head: `Near ${cname(lastAdded)} — often the same trip`, ccs: near } };
        }
        const crew = [...visitors.entries()]
          .filter(([cc]) => !have.has(cc))
          .sort((a, b) => b[1].length - a[1].length || cname(a[0]).localeCompare(cname(b[0])))
          .map(([cc]) => cc)
          .slice(0, 8);
        if (crew.length) return { rows: [], region: null, context: { head: "The crew’s been here — you too?", ccs: crew } };
        return { rows: [], region: null, context: null };
      }
      const scores = new Map(); // cc -> best score
      const consider = (cc, score) => {
        if (working && working.has(cc)) score += 0.25; // surface un-added first
        if (!scores.has(cc) || scores.get(cc) > score) scores.set(cc, score);
      };
      if (q.length === 2 && COUNTRIES[q.toUpperCase()]) consider(q.toUpperCase(), -2);
      for (const [alias, cc] of Object.entries(ALIASES))
        if (alias.startsWith(q)) consider(cc, -1);
      for (const e of NAME_INDEX) {
        if (e.n.startsWith(q)) consider(e.cc, 0);
        else if (e.n.includes(" " + q)) consider(e.cc, 0.5);
        else if (e.n.includes(q)) consider(e.cc, 1);
      }
      if (!scores.size && q.length >= 4) {
        // nothing matched — allow a typo or two
        const max = q.length >= 6 ? 2 : 1;
        for (const e of NAME_INDEX) {
          if (lev(q, e.n.slice(0, q.length), max) <= max) consider(e.cc, 2);
          else if (Math.abs(e.n.length - q.length) <= max && lev(q, e.n, max) <= max) consider(e.cc, 2);
        }
      }
      const rows = [...scores.entries()]
        .sort((a, b) => a[1] - b[1] || cname(a[0]).localeCompare(cname(b[0])))
        .map(([cc]) => ({ cc }));
      let region = null;
      if (q.length >= 3) {
        for (const s of scopes.values()) {
          if (norm(s.name).startsWith(q)) { region = s; break; }
        }
      }
      return { rows: rows.slice(0, 8), region, context: null };
    };
    const markActive = () => {
      sgItems.forEach((it, i) => it.elm.classList.toggle("active", i === sgActive));
      searchIn.setAttribute("aria-activedescendant", sgActive >= 0 ? "sg-" + sgActive : "");
      if (sgActive >= 0) sgItems[sgActive].elm.scrollIntoView({ block: "nearest" });
    };
    const pickSuggest = (idx, viaEnter) => {
      const it = sgItems[idx];
      if (!it || !working) return;
      toggle(it.cc);
      if (viaEnter) {
        searchIn.value = "";
        closeSuggest();
      } else {
        searchIn.focus();   // stay open for multi-adding (e.g. a whole region)
        renderSuggest();
      }
    };
    const renderSuggest = () => {
      const { rows, region, context } = buildMatches(searchIn.value);
      panel.textContent = "";
      sgItems = [];
      if (!rows.length && !region && !context) { closeSuggest(); return; }
      const q = norm(searchIn.value.trim());
      const addRow = (cc) => {
        const idx = sgItems.length;
        const b = el("button", "sg-row");
        b.type = "button";
        b.setAttribute("role", "option");
        b.id = "sg-" + idx;
        b.appendChild(el("span", "sg-flag", flag(cc)));
        const nameSpan = el("span");
        const nm = cname(cc);
        const at = q ? norm(nm).indexOf(q) : -1;
        if (at >= 0) {
          nameSpan.appendChild(document.createTextNode(nm.slice(0, at)));
          nameSpan.appendChild(el("strong", null, nm.slice(at, at + q.length)));
          nameSpan.appendChild(document.createTextNode(nm.slice(at + q.length)));
        } else {
          nameSpan.textContent = nm;
        }
        b.appendChild(nameSpan);
        const meta = el("span", "sg-meta");
        if (working && working.has(cc)) meta.appendChild(el("span", "sg-in", "✓ in your list"));
        else meta.textContent = COUNTRIES[cc].continent;
        b.appendChild(meta);
        b.addEventListener("click", () => pickSuggest(idx));
        panel.appendChild(b);
        sgItems.push({ cc, elm: b });
      };
      rows.forEach((r) => addRow(r.cc));
      if (region) {
        panel.appendChild(el("div", "sg-head", `${region.name} — tap each one you’ve been to`));
        const already = new Set(rows.map((r) => r.cc));
        for (const cc of [...region.ccs].sort((a, b) => cname(a).localeCompare(cname(b))))
          if (!already.has(cc)) addRow(cc);
      }
      if (context) {
        panel.appendChild(el("div", "sg-head", context.head));
        for (const cc of context.ccs) addRow(cc);
      }
      sgActive = sgItems.length ? 0 : -1;
      markActive();
      panel.hidden = false;
      searchIn.setAttribute("aria-expanded", "true");
    };
    searchIn.addEventListener("input", renderSuggest);
    searchIn.addEventListener("focus", renderSuggest);
    searchIn.addEventListener("click", renderSuggest); // an already-focused input fires no focus event
    searchIn.addEventListener("blur", () => {
      setTimeout(() => { if (document.activeElement !== searchIn) closeSuggest(); }, 180);
    });
    searchIn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && sgItems.length) {
        e.preventDefault();
        sgActive = (sgActive + 1) % sgItems.length;
        markActive();
      } else if (e.key === "ArrowUp" && sgItems.length) {
        e.preventDefault();
        sgActive = (sgActive - 1 + sgItems.length) % sgItems.length;
        markActive();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (sgActive >= 0) pickSuggest(sgActive, true);
        else {
          const cc = resolveCountry(searchIn.value);
          if (cc) { toggle(cc); searchIn.value = ""; closeSuggest(); }
        }
      } else if (e.key === "Escape") {
        closeSuggest();
      }
    });

    /* the ⋯ menu */
    const menu = $("#eb-menu");
    const menuBtn = $("#eb-menu-btn");
    const closeMenu = () => { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); };
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
      menuBtn.setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("click", (e) => {
      if (!menu.hidden && !e.target.closest(".eb-menu-wrap")) closeMenu();
    });

    // serialize the whole data file back out
    const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    const HEADER =
`// ✈️  THE GROUP PASSPORT — add yourself here!
//
// Easiest way: use the site itself — “Add yourself”, tap countries on the
// map, hit Save, and a robot commits it for you. This header and formatting
// are regenerated automatically.
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
      const m = members[memberIdx];
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
    const fileDlg = $("#file-dialog");
    const showOutput = (text) => {
      $("#ed-text").value = text;
      if (fileDlg.showModal) fileDlg.showModal();
    };
    $("#file-close").addEventListener("click", () => fileDlg.close());
    $("#ed-copy").addEventListener("click", () => {
      closeMenu();
      const text = fileText();
      const done = () => renderStatus("Copied ✓ — paste it over data/travelers.js on GitHub.");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => showOutput(text));
      } else {
        showOutput(text);
      }
    });
    $("#ed-download").addEventListener("click", () => {
      closeMenu();
      const blob = new Blob([fileText()], { type: "text/javascript" });
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = "travelers.js";
      a.click();
      URL.revokeObjectURL(a.href);
      renderStatus("Downloaded — replace data/travelers.js with it.");
    });
    $("#ed-reset").addEventListener("click", () => {
      closeMenu();
      if (!working) return;
      working = new Set(baseline);
      achieved = achievedKeys(working);
      clearDraft();
      refresh();
      renderStatus("Back to the last saved version.");
    });

    /* instant saves: a fine-grained GitHub token, stored only in this browser */
    const TOKEN_KEY = "group-passport-token";
    const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
    const tokenDlg = $("#token-dialog");
    const updateAuthUI = () => {
      const has = !!getToken();
      $("#ed-connect").textContent = has ? "🔗 GitHub connected — manage…" : "⚡ Instant saves: connect GitHub…";
      $("#ed-token-remove").hidden = !has;
    };
    $("#ed-connect").addEventListener("click", () => {
      closeMenu();
      if (tokenDlg.showModal) tokenDlg.showModal();
    });
    $("#token-close").addEventListener("click", () => tokenDlg.close());
    $("#ed-token-save").addEventListener("click", () => {
      const t = $("#ed-token").value.trim();
      if (!t) return;
      try { localStorage.setItem(TOKEN_KEY, t); } catch {
        renderStatus("This browser blocks local storage — the token can’t be remembered here.");
        return;
      }
      $("#ed-token").value = "";
      tokenDlg.close();
      updateAuthUI();
      renderStatus("GitHub connected — saves are instant now ⚡");
    });
    $("#ed-token-remove").addEventListener("click", () => {
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
      tokenDlg.close();
      updateAuthUI();
      renderStatus("Disconnected — saves go via a GitHub issue again.");
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
      if (!repo) { renderStatus("Set GROUP.repo in data/travelers.js to enable saving."); return; }
      saveBtn.disabled = true;
      renderStatus("Saving to GitHub…");
      const H = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json" };
      const path = `https://api.github.com/repos/${repo}/contents/data/travelers.js`;
      try {
        const rRepo = await fetch(`https://api.github.com/repos/${repo}`, { headers: H });
        if (rRepo.status === 401) throw new Error("GitHub didn’t accept the token — reconnect with a fresh one (⋯ menu).");
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
        setIdentity({ type: "member", name: myEntry().name });
        commitLocal();
        renderStatus("Saved ✓ — live in about a minute");
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
      setIdentity({ type: "member", name: me.name });
      const title = `[stamps] ${me.name} — ${me.countries.length} ${me.countries.length === 1 ? "country" : "countries"}`;
      const bodyText =
        "This issue updates the group passport — just press **Submit new issue** below.\n" +
        "A workflow commits it automatically, closes this issue, and the site updates itself " +
        "about a minute later.\n\n```json\n" + JSON.stringify(me, null, 2) + "\n```\n";
      const url = `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(bodyText)}`;
      const w = window.open(url, "_blank", "noopener");
      statusEl.textContent = "One more tap: press “Submit new issue” in the tab that opened. ";
      if (!w) {
        const a = el("a", null, "Open GitHub to finish saving ↗");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        statusEl.appendChild(a);
      }
    };
    saveBtn.addEventListener("click", () => {
      if (!navigator.onLine) {
        renderStatus("📴 Offline — your changes are safe as a draft. Hit Save once you’re back online.");
        return;
      }
      getToken() ? ghSave() : ghIssueSave();
    });

    /* offline: edits keep working locally; saving syncs when you're back */
    window.addEventListener("offline", () => {
      showToast("📴", "You’re offline", "No worries — edits keep saving on this device.");
    });
    window.addEventListener("online", () => {
      let hasDraft = false;
      try { hasDraft = !!localStorage.getItem(DRAFT_KEY); } catch {}
      showToast("🌐", "Back online", hasDraft ? "Your draft is ready — hit 💾 Save to sync it." : "All caught up.");
    });

    /* profile fields (inside the who-dialog) */
    newFieldIds.forEach((id) => $("#" + id).addEventListener("input", saveDraft));
    $("#ed-name").addEventListener("input", () => { if (working && isNew) setLabel(); });
    const emojiRow = $("#emoji-row");
    for (const e of ["📷", "🎞️", "🏔️", "🌊", "🏜️", "🦁", "🌸", "🛩️", "🌋", "⛺", "🧭", "🌅"]) {
      const b = el("button", "emoji-btn", e);
      b.type = "button";
      b.setAttribute("aria-label", `Use ${e} as your emoji`);
      b.addEventListener("click", () => {
        $("#ed-emoji").value = e;
        emojiRow.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
        b.classList.add("sel");
        saveDraft();
      });
      emojiRow.appendChild(b);
    }
    updateAuthUI();

    /* restore an unsaved draft from the last visit */
    (function restoreDraft() {
      let d = null;
      try { d = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch {}
      if (!d || !d.who || !Array.isArray(d.countries)) return;
      if (d.who !== "new") {
        const m = members[Number(d.who)];
        if (!m) { clearDraft(); return; }
        const saved = new Set(m.countries);
        if (d.countries.length === saved.size && d.countries.every((cc) => saved.has(cc))) { clearDraft(); return; }
      }
      if (d.who === "new" && d.fields) newFieldIds.forEach((id, i) => { $("#" + id).value = d.fields[i] || ""; });
      enterEdit(d.who);
      working = new Set(d.countries.filter((cc) => COUNTRIES[cc]));
      achieved = achievedKeys(working);
      refresh();
      statusEl.textContent += " · draft restored";
    })();

    return {
      enterEdit,
      exitEdit,
      isEditing: () => !!working,
      focusName: () => $("#ed-name").focus(),
    };
  })();

  /* ---------- identity: ask on open unless we silently know you ---------- */
  (function identity() {
    const dlg = $("#who-dialog");
    if (!dlg || !dlg.showModal) return;
    if (typeof GROUP !== "undefined" && GROUP.name) $("#who-kicker").textContent = `📸 ${GROUP.name}`;
    const stepPick = $("#who-step-pick");
    const stepProfile = $("#who-step-profile");
    const showStep = (which) => {
      stepPick.hidden = which !== "pick";
      stepProfile.hidden = which !== "profile";
    };

    const scrollToMap = () =>
      document.querySelector(".map-card").scrollIntoView({ behavior: "smooth", block: "start" });

    const applyIdentityUI = (idx) => {
      const m = members[idx];
      const chip = $("#identity-chip");
      chip.hidden = false;
      chip.textContent = "";
      chip.appendChild(el("span", null, `📷 You’re ${m.emoji} ${m.name}`));
      const edit = el("button", "id-switch", "✏️ update my stamps");
      edit.type = "button";
      edit.addEventListener("click", () => {
        if (!editorAPI.isEditing()) editorAPI.enterEdit(String(idx));
        scrollToMap();
      });
      chip.appendChild(edit);
      const sw = el("button", "id-switch", "not you?");
      sw.type = "button";
      sw.addEventListener("click", () => {
        setIdentity(null);
        chip.hidden = true;
        editorAPI.exitEdit();
        showWhoDialog();
      });
      chip.appendChild(sw);
    };
    onSavedIdentity = (name) => {
      const i = members.findIndex((m) => m.name === name);
      if (i >= 0) applyIdentityUI(i);
    };

    const showWhoDialog = () => {
      showStep("pick");
      const grid = $("#who-members");
      grid.textContent = "";
      members.forEach((m, i) => {
        const b = el("button", "who-btn");
        b.type = "button";
        b.appendChild(el("span", "who-emoji", m.emoji));
        b.appendChild(el("span", null, m.name));
        b.addEventListener("click", () => {
          setIdentity({ type: "member", name: m.name });
          dlg.close();
          applyIdentityUI(i);
          editorAPI.enterEdit(String(i));
          scrollToMap();
        });
        grid.appendChild(b);
      });
      grid.hidden = !members.length;
      $("#who-sub").textContent = members.length
        ? "One tap and the page sets itself up for you — tap countries on the map, hit Save."
        : "Nobody’s aboard yet — be the first stamp in the passport.";
      dlg.showModal();
    };

    $("#who-new").addEventListener("click", () => showStep("profile"));
    $("#profile-back").addEventListener("click", () => showStep("pick"));
    $("#profile-go").addEventListener("click", () => {
      const nameIn = $("#ed-name");
      if (!nameIn.value.trim()) {
        nameIn.classList.add("invalid");
        nameIn.focus();
        return;
      }
      nameIn.classList.remove("invalid");
      dlg.close();
      editorAPI.enterEdit("new");
      scrollToMap();
    });
    $("#ed-name").addEventListener("input", (e) => e.target.classList.remove("invalid"));
    $("#who-guest").addEventListener("click", () => {
      setIdentity({ type: "guest" });
      dlg.close();
    });
    $("#join-cta").addEventListener("click", showWhoDialog);

    const id = getIdentity();
    const idx = id && id.type === "member" ? members.findIndex((m) => m.name === id.name) : -1;
    if (idx >= 0) applyIdentityUI(idx);           // silently known — clean page, edit is one tap away
    else if (!id || id.type !== "guest") showWhoDialog(); // unknown (or stale member) — ask
    // guests are remembered too: never nag them again
  })();

  /* ---------- offline support: cache the whole site for airplane mode ---------- */
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* not fatal */ });
    // the worker's background refresh found newer traveler data
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (!e.data || e.data.type !== "data-updated") return;
      if (document.body.classList.contains("editing")) return; // never disrupt an edit
      showToast("🆕", "Fresh stamps just landed", "Tap here to see the latest map.", () => location.reload());
    });
    // addEventListener alone leaves the message queue paused — release it
    if (navigator.serviceWorker.startMessages) navigator.serviceWorker.startMessages();
  }
})();
