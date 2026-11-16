// How a day's events overlap, for drawing them with depth: an event that starts
// before the one above it ends is tucked over that card, as far down it as its
// start is into that event. Events that start together tuck too, at the same
// height, the longer one underneath.
// Pure: no DOM, so the unit tests run it in Node.

// Cards stack at most this many deep; deeper ones line up with the last.
export const MAX_DEPTH = 2;

// `list` is one day's events in eventsOn() order (all-day first, then by start,
// longer first). Returns one unit per event, in the same order:
//   { ev, run, tucked, under, at, depth, sameStart }
//   run:       index of the run of overlapping events it belongs to (shared by the run)
//   tucked:    lies over the card before it
//   under:     the next card is tucked over this one
//   at:        how far into the card before it this one starts, 0 to 1 (0 when not tucked)
//   depth:     0 for a card on the list, 1 for one tucked over it, and so on
//   sameStart: starts when the card before it starts
export function overlapUnits(list, day) {
  const from = +day, to = +nextDay(day);
  const start = (e) => Math.max(+e.start, from);
  const end = (e) => Math.max(start(e), Math.min(+e.end, to));
  const units = [];
  let prev = null, runEnd = -Infinity, run = -1;
  for (const ev of list) {
    // Strictly before: back-to-back events (one ends at 12:00, the next starts then) don't overlap.
    const overlaps = !ev.allDay && prev && start(ev) < runEnd;
    if (!overlaps) run++;
    else prev.under = true;
    const unit = { ev, run, tucked: !!overlaps, under: false, at: 0, depth: 0, sameStart: false };
    if (overlaps) {
      const p = prev.ev;
      unit.at = Math.min(1, (start(ev) - start(p)) / Math.max(1, end(p) - start(p)));
      unit.depth = Math.min(MAX_DEPTH, prev.depth + 1);
      unit.sameStart = start(ev) === start(p);
    }
    units.push(unit);
    if (ev.allDay) { prev = null; runEnd = -Infinity; continue; }
    prev = unit;
    runEnd = overlaps ? Math.max(runEnd, end(ev)) : end(ev);
  }
  return units;
}

function nextDay(d) { const x = new Date(d); x.setDate(x.getDate() + 1); return x; }
