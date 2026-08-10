# 🌍 The Group Passport

A zero-backend travel map for our photography crew. One static page shows every
country we've collectively set foot in — a shaded world map, a leaderboard,
continent coverage, the countries *all* of us share, and the hidden gems only
one of us has seen.

**No build step, no database, no server.** It's plain HTML/CSS/JS, so it hosts
for free on GitHub Pages, and adding yourself is a one-file edit.

## ✨ Add yourself (no code needed)

The page has a built-in editor — **Update your stamps ✍️**, right under the map:

1. Pick yourself from the dropdown, or **➕ New member…** and fill in your
   name, emoji, and camera.
2. **Tap countries on the map** to add or remove them (or type a country name
   in the search box — that's also how you add countries too small to tap,
   like Singapore). Your selection glows with an orange outline, and your
   in-progress edits auto-save as a draft on your device.
3. Save it — three tiers, least friction first:
   - **Default (any GitHub login, zero setup):** hit **💾 Save to GitHub** —
     it opens a pre-filled GitHub issue; press *Submit new issue* and a
     workflow (`.github/workflows/save-stamps.yml`) validates it, commits it,
     deploys, and closes the issue. No repo access or tokens needed.
   - **⚡ Instant saves (optional):** connect a
     [fine-grained token](https://github.com/settings/personal-access-tokens/new)
     once (scoped to just this repo, *Contents: read & write*, stored only in
     your browser). Saves then commit directly, merged against the latest
     file so simultaneous edits don't overwrite each other. Requires push
     access to the repo.
   - **No GitHub at all:** **📋 Copy updated travelers.js** and send it to
     someone in the crew, or paste it over the file on GitHub yourself.

Anyone with a GitHub account can save via the issue path on a public repo —
handy for a friends group, and every change is an attributed commit you can
revert. If that's ever too open, require approval by adding an allowlist
check to `save-stamps.yml`.

Prefer editing by hand? [`data/travelers.js`](data/travelers.js) is plain
JavaScript — copy an existing block and make it yours:

```js
{
  name: "Ansel",
  emoji: "🏔️",                    // your avatar
  home: "US",                      // ISO code of home country
  camera: "Hasselblad 500C/M",
  favorite: "IS",                  // favorite country to shoot
  countries: ["US", "CA", "IS", "JP" /* … */],
},
```

Country codes are [ISO 3166-1 alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
— the same two letters as `.fr` / `.jp` internet domains. Typos are caught and
listed in a banner at the top of the page, and the full code list is visible in
the page's table view.

You can also rename the group: edit `GROUP.name` and `GROUP.tagline` at the top
of the same file.

## 🚀 Hosting on GitHub Pages

Deployment is automatic: `.github/workflows/pages.yml` mirrors every push to
`master` onto the `gh-pages` branch, which GitHub Pages serves. The site lives
at `https://<owner>.github.io/<repo>/`, and every merged change to
`data/travelers.js` redeploys it within a minute or two.

If Actions are disabled for the repo, the manual alternative still works:
**Settings → Pages → Deploy from a branch → gh-pages / (root)**.

## 🗺️ What's on the page

- **World map** — countries shaded by how many of us have been (hover for who);
  countries too small for the map (Singapore, Malta, the Maldives…) show as dots;
  on phones the map stays large and pans sideways so countries remain tappable
- **Update your stamps** — the in-page editor: tap countries on the map or
  search by name to add/remove, then copy the regenerated data file to GitHub
- **Group stats** — countries visited, % of the world's 193 UN countries,
  continents covered, total stamps, most-traveled member
- **Leaderboard** — countries per member
- **Continent checklist** — coverage meters per continent
- **Full-house stamps** — countries every member has visited
- **Hidden gems** — countries exactly one member has visited
- **Crossing paths** — a member × member heatmap of shared countries (hover a
  cell for the list) plus auto-computed fun facts: travel twins, opposite
  itineraries, the dream team, the lone wolf, and the crew's connector
- **The crew** — a polaroid card per member
- **Table view** — the full country × member matrix (also the accessible,
  screen-reader-friendly twin of the map)

Light and dark mode both supported — the page follows your OS setting.

## 🔧 Repo layout

```
index.html            the page
styles.css            all styling (design tokens at the top)
app.js                stats + rendering, no dependencies
data/travelers.js     ← the file everyone edits
assets/world-map.js   generated SVG paths (world-atlas 110m, Natural Earth projection)
assets/countries.js   generated ISO country metadata (names, continents, flags)
tools/generate-map.mjs  regenerates the two assets above
```

### Regenerating the map assets

Only needed if you want a different projection or map resolution:

```sh
npm install d3-geo topojson-client world-atlas world-countries
node tools/generate-map.mjs   # writes world-map.js + countries.js in cwd
```

Map data: [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth,
public domain) and [world-countries](https://github.com/mledoze/countries) (ODbL).
