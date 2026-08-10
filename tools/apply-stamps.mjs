// Applies a "[stamps]" issue to data/travelers.js. Run by .github/workflows/save-stamps.yml.
// The issue body is untrusted input: everything is validated, length-clamped, and
// treated as data — never executed.
import fs from "node:fs";

const setOut = (k, v) =>
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${String(v).replace(/[\r\n]+/g, " ")}\n`);
const fail = (msg) => {
  setOut("ok", "false");
  setOut("msg", msg);
  console.error(msg);
  process.exit(0); // soft-fail: the workflow comments the reason on the issue
};

const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const body = (ev.issue && ev.issue.body) || "";
const fence = body.match(/```json\s*([\s\S]*?)```/);
if (!fence) fail("I couldn’t find the JSON block in the issue body. Use the Save button on the site — it fills everything in.");
let me;
try {
  me = JSON.parse(fence[1]);
} catch {
  fail("The JSON block doesn’t parse. Use the Save button on the site — it fills everything in.");
}

// repo-trusted files
const load = (path, ret) => new Function(fs.readFileSync(path, "utf8") + `;return ${ret};`)();
const COUNTRIES = load("assets/countries.js", "COUNTRIES");
const { g, t } = load("data/travelers.js", "{ g: typeof GROUP !== 'undefined' ? GROUP : null, t: TRAVELERS }");

const clamp = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const asCC = (v) => {
  const cc = clamp(v, 2).toUpperCase();
  return COUNTRIES[cc] ? cc : "";
};
const entry = {
  name: clamp(me.name, 40).replace(/[^\p{L}\p{N}\p{M} .,'’\-]/gu, "") || "New Member",
  emoji: clamp(me.emoji, 8) || "📷",
  home: asCC(me.home),
  camera: clamp(me.camera, 60),
  favorite: asCC(me.favorite),
  countries: [...new Set((Array.isArray(me.countries) ? me.countries : []).slice(0, 300).map(asCC).filter(Boolean))].sort(),
};
if (!entry.countries.length) fail("No valid country codes in the request.");

const list = t.map((m) => ({
  name: String(m.name || ""),
  emoji: String(m.emoji || "📷"),
  home: String(m.home || "").toUpperCase(),
  camera: String(m.camera || ""),
  favorite: String(m.favorite || "").toUpperCase(),
  countries: [...new Set((m.countries || []).map(asCC).filter(Boolean))],
}));
const idx = list.findIndex((m) => m.name === entry.name);
if (idx >= 0) list[idx] = { ...list[idx], countries: entry.countries };
else list.push(entry);

const q = (s) => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
const HEADER = `// ✈️  THE GROUP PASSPORT — add yourself here!
//
// Easiest way: use the “Update your stamps ✍️” editor on the page itself —
// pick yourself (or “New member”), tap countries on the map, hit Save, and
// a workflow commits it for you. This header and formatting are
// regenerated automatically.
//
// Editing by hand also works: countries are two-letter ISO 3166-1 codes,
// the same letters as .fr / .jp internet domains. Typos are flagged in a
// banner at the top of the page.

`;
const grp = g || { name: "The Group Passport", tagline: "", repo: "" };
let outSrc = HEADER;
outSrc += `const GROUP = {\n  name: ${q(grp.name)},\n  tagline: ${q(grp.tagline)},\n  repo: ${q(grp.repo)},\n};\n\nconst TRAVELERS = [\n`;
for (const m of list) {
  outSrc += `  {\n    name: ${q(m.name)},\n    emoji: ${q(m.emoji)},\n    home: ${q(m.home)},\n    camera: ${q(m.camera)},\n    favorite: ${q(m.favorite)},\n    countries: [\n`;
  for (let i = 0; i < m.countries.length; i += 10)
    outSrc += `      ${m.countries.slice(i, i + 10).map(q).join(", ")},\n`;
  outSrc += `    ],\n  },\n`;
}
outSrc += `];\n`;
fs.writeFileSync("data/travelers.js", outSrc);

setOut("ok", "true");
setOut("name", entry.name);
setOut("count", entry.countries.length);
console.log(`Applied: ${entry.name}, ${entry.countries.length} countries`);
