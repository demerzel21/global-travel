# 🌍 The Group Passport

A zero-backend travel map for our photography crew. One static page shows every
country we've collectively set foot in — a shaded world map, a leaderboard,
continent coverage, the countries *all* of us share, and the hidden gems only
one of us has seen.

**No build step, no database, no server.** It's plain HTML/CSS/JS, so it hosts
for free on GitHub Pages, and adding yourself is a one-file edit.

## ✨ Add yourself (the only thing you ever need to do)

1. Open [`data/travelers.js`](data/travelers.js) on GitHub and click the ✏️ pencil.
2. Copy an existing block and make it yours:

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

3. Commit (or open a PR if the repo requires it). The page rebuilds itself on
   every load — no deploy step.

Country codes are [ISO 3166-1 alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)
— the same two letters as `.fr` / `.jp` internet domains. Typos are caught and
listed in a banner at the top of the page, and the full code list is visible in
the page's table view.

You can also rename the group: edit `GROUP.name` and `GROUP.tagline` at the top
of the same file.

## 🚀 Hosting on GitHub Pages

One-time setup by a repo admin:

1. **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: **master**, folder **/ (root)** → Save

The site appears at `https://<owner>.github.io/<repo>/` a minute later, and
every merged change to `data/travelers.js` redeploys it automatically.

## 🗺️ What's on the page

- **World map** — countries shaded by how many of us have been (hover for who);
  countries too small for the map (Singapore, Malta, the Maldives…) show as dots
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
