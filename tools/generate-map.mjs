import fs from "node:fs";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import * as topojson from "topojson-client";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const world = require("world-atlas/countries-110m.json");
const wc = require("world-countries");

const countries = topojson.feature(world, world.objects.countries).features
  .filter(f => f.properties.name !== "Antarctica");

// Index world-countries by ccn3 and by common name for fallback matching
const byCcn3 = new Map(wc.filter(c => c.ccn3).map(c => [c.ccn3, c]));
const byName = new Map(wc.map(c => [c.name.common.toLowerCase(), c]));
const nameOverrides = new Map(Object.entries({
  "dem. rep. congo": "cd", "congo": "cg", "central african rep.": "cf",
  "s. sudan": "ss", "côte d'ivoire": "ci", "eq. guinea": "gq",
  "w. sahara": "eh", "somaliland": null, "bosnia and herz.": "ba",
  "macedonia": "mk", "north macedonia": "mk", "czechia": "cz", "kosovo": "xk",
  "dominican rep.": "do", "falkland is.": "fk", "fr. s. antarctic lands": "tf",
  "timor-leste": "tl", "n. cyprus": null, "solomon is.": "sb",
  "united states of america": "us", "eswatini": "sz",
}));
const byCca2 = new Map(wc.map(c => [c.cca2.toLowerCase(), c]));

const projection = geoNaturalEarth1();
const geo = { type: "FeatureCollection", features: countries };
projection.fitWidth(1000, geo);
const path = geoPath(projection);
const [[x0, y0], [x1, y1]] = path.bounds(geo);
const W = 1000, H = Math.ceil(y1 - y0);

function round1(d) {
  return d.replace(/(\d+\.\d\d+)/g, m => (+m).toFixed(1));
}

const paths = {};
let unmatched = [];
for (const f of countries) {
  let entry = f.id ? byCcn3.get(f.id) : null;
  if (!entry) {
    const n = (f.properties.name || "").toLowerCase();
    if (nameOverrides.has(n)) {
      const cc = nameOverrides.get(n);
      entry = cc ? byCca2.get(cc) : null;
      if (!entry) continue; // deliberately skipped (disputed, no ISO code)
    } else {
      entry = byName.get(n);
    }
  }
  if (!entry) { unmatched.push(f.properties.name); continue; }
  if (entry.cca2 === "AQ") continue; // skip Antarctica landmass
  const d = path(f);
  if (!d) continue;
  const cc = entry.cca2;
  paths[cc] = paths[cc] ? paths[cc] + round1(d) : round1(d);
}
if (unmatched.length) console.error("UNMATCHED:", unmatched);

const continentOf = (c) => {
  if (c.region === "Americas")
    return c.subregion === "South America" ? "South America" : "North America";
  if (c.region === "Antarctic") return "Antarctica";
  return c.region;
};

// Countries list: all ISO entries, with centroid for dot-rendering when no polygon
const meta = {};
for (const c of wc) {
  const cc = c.cca2;
  const [lat, lng] = c.latlng || [];
  const pt = lat != null && cc !== "AQ" ? projection([lng, lat]) : null;
  meta[cc] = {
    name: c.name.common,
    continent: continentOf(c),
    sub: c.subregion || c.region || "",
    un: !!c.unMember && cc !== "VA", // world-countries mislabels Vatican City (UN observer, not member)
    flag: c.flag,
    ...(paths[cc] ? {} : pt ? { x: +pt[0].toFixed(1), y: +pt[1].toFixed(1) } : {}),
  };
}

const unTotal = wc.filter(c => c.unMember).length;
const missingUn = wc.filter(c => c.unMember && !paths[c.cca2]).map(c => c.cca2);
console.error(`Map paths: ${Object.keys(paths).length}, UN members: ${unTotal}, UN without polygon (dot fallback): ${missingUn.length}`, missingUn.join(","));

fs.writeFileSync("world-map.js",
  `// Generated from world-atlas countries-110m + world-countries. Do not edit by hand.\n` +
  `const WORLD_MAP = ${JSON.stringify({ width: W, height: H, paths })};\n`);
fs.writeFileSync("countries.js",
  `// Generated from world-countries (ISO 3166-1). Do not edit by hand.\n` +
  `// cc -> { name, continent, sub: UN subregion, un: UN member, flag, x/y: map dot for countries too small for the 110m map }\n` +
  `const COUNTRIES = ${JSON.stringify(meta)};\n`);
console.error("sizes:", fs.statSync("world-map.js").size, fs.statSync("countries.js").size);
