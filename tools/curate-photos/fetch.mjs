// Step 1 of curating automatic photos: fetch Openverse candidates per theme and
// write contact sheets to review by eye.
//
//   node tools/curate-photos/fetch.mjs            -> refetch every theme (rewrites all candidate indexes!)
//   node tools/curate-photos/fetch.mjs pizza dog  -> fetch only these themes, merged into candidates.json
//
// Output:
//   tools/curate-photos/candidates.json   (committed: PICKS in build.mjs index into it)
//   tools/curate-photos/out/sheet*.html   (git-ignored contact sheets; open in a browser)
//
// A theme key here must match a `key` in THEMES in js/photos.js.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const HERE = new URL("./", import.meta.url);
const CANDIDATES = new URL("candidates.json", HERE);
const OUT = new URL("out/", HERE);

// Search phrase per theme. Concrete objects or places give the most reliable photos.
export const QUERIES = {
  meeting: "meeting room table", gym: "gym dumbbells", run: "running shoes", yoga: "yoga mat",
  swim: "swimming pool lanes", flight: "airplane wing clouds", train: "train station platform", hike: "mountain hiking trail",
  beach: "tropical beach", coffee: "latte art", lunch: "lunch bowl food", dinner: "dinner table restaurant",
  birthday: "birthday cake candles", dentist: "dentist chair", doctor: "stethoscope", concert: "concert stage lights",
  movie: "cinema popcorn", study: "library books", market: "farmers market vegetables", soccer: "soccer ball grass",
  tennis: "tennis court", basketball: "basketball hoop", travel: "suitcase travel", haircut: "barber shop",
  cycling: "road cycling", wedding: "wedding flowers", games: "board game", cooking: "cooking kitchen", dog: "dog walk park",
};

const only = process.argv.slice(2);
for (const k of only) if (!QUERIES[k]) { console.error(`Add a search phrase for "${k}" to QUERIES first.`); process.exit(1); }
const keys = only.length ? only : Object.keys(QUERIES);
const all = only.length && existsSync(CANDIDATES) ? JSON.parse(readFileSync(CANDIDATES, "utf8")) : {};

for (const k of keys) {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.search = new URLSearchParams({ q: QUERIES[k], page_size: "16", aspect_ratio: "wide", mature: "false", category: "photograph", size: "large" });
  const j = await (await fetch(url)).json();
  all[k] = (j.results || []).map((x) => ({ url: x.url, thumb: x.thumbnail, by: x.creator || "Unknown", license: x.license, lv: x.license_version, link: x.foreign_landing_url, title: x.title }));
  console.log(k, all[k].length);
  await new Promise((r) => setTimeout(r, 700)); // Openverse rate-limits anonymous clients
}
writeFileSync(CANDIDATES, JSON.stringify(all, null, 1));

// Contact sheets: five themes per page, each thumbnail labelled with its index.
mkdirSync(OUT, { recursive: true });
for (let p = 0; p * 5 < keys.length; p++) {
  const rows = keys.slice(p * 5, p * 5 + 5).map((k) => `<h2>${k}</h2><div class=row>${all[k].map((c, i) => `<figure><img src="${c.thumb}"><figcaption>${i}</figcaption></figure>`).join("")}</div>`).join("");
  writeFileSync(new URL(`sheet${p}.html`, OUT), `<!doctype html><meta charset=utf-8><style>body{margin:8px;font:14px sans-serif}h2{margin:6px 0 2px;font-size:15px}.row{display:grid;grid-template-columns:repeat(8,1fr);gap:4px}figure{margin:0;position:relative}img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block}figcaption{position:absolute;top:2px;left:2px;background:#000;color:#fff;font:bold 13px sans-serif;padding:1px 5px}</style>${rows}`);
}
console.log(`Review tools/curate-photos/out/sheet0..${Math.ceil(keys.length / 5) - 1}.html, then put the good indexes in PICKS in build.mjs.`);
