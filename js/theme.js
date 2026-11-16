// Color themes. css/app.css holds each theme's colors under html[data-theme]; this
// picks one, remembers it on this device only (it's a display choice, like the view),
// and follows the system for Auto. The inline script in index.html applies the saved
// theme before the first paint, so it uses the same key and the same Auto rule.
import { loadJSON, saveJSON } from "./util.js";

// paper / ink / accent only draw the swatches in the menu; the CSS has the full sets.
export const THEMES = [
  { id: "auto", name: "Auto" },
  { id: "light", name: "Light", paper: "#ffffff", ink: "#15171c", accent: "#ef5b4c" },
  { id: "dark", name: "Dark", paper: "#121317", ink: "#eceef2", accent: "#ff6b5b" },
  { id: "solarized", name: "Solarized", paper: "#fdf6e3", ink: "#073642", accent: "#268bd2" },
  { id: "nord", name: "Nord", paper: "#2e3440", ink: "#eceff4", accent: "#88c0d0" },
  { id: "dracula", name: "Dracula", paper: "#282a36", ink: "#f8f8f2", accent: "#ff79c6" },
  { id: "gruvbox", name: "Gruvbox", paper: "#282828", ink: "#ebdbb2", accent: "#fabd2f" },
];

const KEY = "bd:theme";
const DEFAULT = "light";
const systemDark = matchMedia("(prefers-color-scheme: dark)");

export function currentTheme() {
  const id = loadJSON(KEY, DEFAULT);
  return THEMES.some((t) => t.id === id) ? id : DEFAULT;
}

const resolve = (id) => (id === "auto" ? (systemDark.matches ? "dark" : "light") : id);

export function applyTheme(id = currentTheme()) {
  const t = THEMES.find((x) => x.id === resolve(id));
  document.documentElement.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.paper);
}

export function setTheme(id) {
  saveJSON(KEY, id);
  applyTheme(id);
}

// Immersive cards (Advanced): photo cards as dark slabs over a blurred copy of their
// photo, instead of paper. Also a display choice on this device, applied before the
// first paint by the same inline script, as html[data-cards="immersive"].
const CARDS_KEY = "bd:immersive";

export const immersiveCards = () => loadJSON(CARDS_KEY, false) === true;

export function applyCards(on = immersiveCards()) {
  if (on) document.documentElement.dataset.cards = "immersive";
  else delete document.documentElement.dataset.cards;
}

export function setImmersiveCards(on) {
  saveJSON(CARDS_KEY, !!on);
  applyCards(!!on);
}

systemDark.addEventListener("change", () => { if (currentTheme() === "auto") applyTheme(); });
// Another tab changed it: follow along.
addEventListener("storage", (e) => {
  if (e.key === KEY) applyTheme();
  if (e.key === CARDS_KEY) applyCards();
});
