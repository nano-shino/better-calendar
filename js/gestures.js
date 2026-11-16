// Swipe a card sideways to mark it done (on the Completed tab, not done): the card
// follows the finger, mouse or trackpad over a coloured strip and flies off past
// the threshold. Works with touch, a mouse drag, and a two-finger trackpad swipe.
// A sideways touch swipe anywhere else (day headers, the time column, gaps) still
// moves between days, weeks or months.
import { h, ended } from "./util.js";

const LOCK = 10;      // px of movement before deciding sideways or scroll
const NAV_MIN = 70;   // px a navigation swipe must travel
const WHEEL_IDLE = 140; // ms without trackpad input that ends a trackpad swipe
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const UNDO = '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>';
function mark(d) {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  return t.content.firstChild;
}

export function setupGestures(stage, { nav, swiped }) {
  let busy = false; // a card is flying off; ignore input until the list re-renders

  // A drag ends with a release that can still click the card under it.
  let swallow = null;
  stage.addEventListener("click", (e) => {
    if (swallow && performance.now() < swallow.until && swallow.card.contains(e.target)) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  // ---- one card swipe, whatever drives it ----
  const threshold = (d) => Math.min(120, d.card.offsetWidth * 0.35);

  function begin(card) {
    const li = card.parentElement;
    const restore = stage.dataset.tab === "done";
    const under = h("span", { class: `sw-under${restore ? " sw-restore" : ""}`, "aria-hidden": "true",
      style: { left: `${card.offsetLeft}px`, top: `${card.offsetTop}px`, width: `${card.offsetWidth}px`, height: `${card.offsetHeight}px` } },
    h("span", { class: "sw-mark" }, mark(restore ? UNDO : CHECK), h("span", { text: restore ? "Not done" : "Done" })));
    li.classList.add("sw-on");
    li.insertBefore(under, card);
    return { card, under, dx: 0, v: 0, lastX: 0, lastT: performance.now() };
  }

  function follow(d, dx) {
    const now = performance.now();
    d.v = (dx - d.lastX) / Math.max(1, now - d.lastT);
    d.lastX = dx; d.lastT = now; d.dx = dx;
    d.card.style.transform = `translateX(${dx}px)`;
    d.under.classList.toggle("sw-right", dx > 0);
    d.under.classList.toggle("sw-armed", Math.abs(dx) > threshold(d));
  }

  function release(d) {
    swallow = { card: d.card, until: performance.now() + 400 };
    const { dx, v } = d;
    if (Math.abs(dx) > threshold(d) || (Math.abs(dx) > 48 && Math.abs(v) > 0.6 && Math.sign(v) === Math.sign(dx))) commit(d, Math.sign(dx));
    else settle(d);
  }

  // Back into place.
  function settle(d) {
    const { card, under } = d;
    const done = () => { card.style.transform = ""; card.style.transition = ""; under.remove(); card.parentElement?.classList.remove("sw-on"); };
    if (reduceMotion() || !d.dx) { done(); return; }
    card.style.transition = "transform 0.28s var(--spring)";
    card.style.transform = "translateX(0)";
    setTimeout(done, 300);
  }

  // Off the side, then hand over: the app folds the row away and re-renders.
  async function commit(d, dir) {
    busy = true;
    const { card, under } = d;
    if (!reduceMotion()) {
      await ended(card.animate([{ transform: `translateX(${d.dx}px)` }, { transform: `translateX(${dir * (card.parentElement.offsetWidth + 40)}px)` }],
        { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }));
      under.classList.add("sw-gone");
    }
    busy = false;
    swiped(card.dataset.id);
  }

  // ---- touch ----
  let t0 = null;
  stage.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || busy) { t0 = null; return; }
    const t = e.touches[0];
    t0 = { x: t.clientX, y: t.clientY, card: e.target.closest(".card[data-id]"), mode: null, d: null };
  }, { passive: true });
  stage.addEventListener("touchmove", (e) => {
    if (!t0 || !t0.card || t0.mode === "scroll") return;
    const t = e.touches[0];
    const dx = t.clientX - t0.x, dy = t.clientY - t0.y;
    if (!t0.mode) {
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
      t0.mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? "card" : "scroll";
      if (t0.mode === "card") t0.d = begin(t0.card);
    }
    if (t0.d) follow(t0.d, dx);
  }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (!t0) return;
    const s = t0; t0 = null;
    if (s.d) { release(s.d); return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (!s.card && Math.abs(dx) > NAV_MIN && Math.abs(dx) > Math.abs(dy) * 1.6) nav(dx < 0 ? 1 : -1);
  }, { passive: true });
  stage.addEventListener("touchcancel", () => { if (t0?.d) settle(t0.d); t0 = null; }, { passive: true });

  // ---- mouse: drag a card sideways ----
  let m0 = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || busy) return;
    const card = e.target.closest(".card[data-id]");
    if (card) m0 = { x: e.clientX, y: e.clientY, card, id: e.pointerId, d: null, off: false };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!m0 || m0.off || e.pointerId !== m0.id) return;
    const dx = e.clientX - m0.x, dy = e.clientY - m0.y;
    if (!m0.d) {
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
      if (Math.abs(dx) <= Math.abs(dy)) { m0.off = true; return; }
      m0.d = begin(m0.card);
      m0.card.setPointerCapture?.(e.pointerId);
      stage.classList.add("sw-dragging");
    }
    follow(m0.d, dx);
  });
  const mouseUp = (e) => {
    if (!m0 || e.pointerId !== m0.id) return;
    const s = m0; m0 = null;
    stage.classList.remove("sw-dragging");
    if (!s.d) return;
    if (e.type === "pointercancel") settle(s.d); else release(s.d);
  };
  stage.addEventListener("pointerup", mouseUp);
  stage.addEventListener("pointercancel", mouseUp);

  // ---- trackpad: a two-finger sideways swipe over a card ----
  // Commits as soon as it passes the threshold (the trackpad's momentum keeps
  // sending events after the fingers lift); otherwise settles once input stops.
  let w0 = null, wheelMute = 0;
  stage.addEventListener("wheel", (e) => {
    if (busy || performance.now() < wheelMute) {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
      return;
    }
    if (!w0) {
      const card = e.target.closest(".card[data-id]");
      if (!card || e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return;
      w0 = { d: begin(card), dx: 0, timer: 0 };
    }
    e.preventDefault(); // no sideways page scroll or browser back gesture
    const unit = e.deltaMode === 1 ? 16 : 1;
    w0.dx -= e.deltaX * unit;
    follow(w0.d, w0.dx);
    clearTimeout(w0.timer);
    const s = w0;
    if (Math.abs(s.dx) > threshold(s.d)) {
      w0 = null;
      wheelMute = performance.now() + 700;
      s.d.v = 0;
      release(s.d);
      return;
    }
    s.timer = setTimeout(() => { if (w0 === s) { w0 = null; settle(s.d); } }, WHEEL_IDLE);
  }, { passive: false });
}
