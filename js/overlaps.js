// How a day's events overlap, for drawing them with depth. Events that start
// together stack into a deck (the longest in front); an event that starts later
// but before the one above it ends is tucked over that card.
// Pure: no DOM, so the unit tests run it in Node.

// Events starting this close together count as starting together.
export const DECK_WINDOW = 15 * 60000;

// `list` is one day's events in eventsOn() order (all-day first, then by start,
// longer first). Returns units in the same order:
//   { evs, head, tucked, under }
//   evs:    the events in this card, front first (more than one = a deck)
//   head:   the first unit of a run of overlapping events
//   tucked: lies over the unit before it
//   under:  the next unit is tucked over this one
export function overlapUnits(list, day) {
  const from = +day, to = +nextDay(day);
  const start = (e) => Math.max(+e.start, from);
  const end = (e) => Math.max(start(e), Math.min(+e.end, to));
  const units = [];
  let cur = null, runEnd = -Infinity;
  for (const ev of list) {
    if (ev.allDay) {
      units.push({ evs: [ev], head: true, tucked: false, under: false });
      cur = null; runEnd = -Infinity;
      continue;
    }
    const s = start(ev);
    // Strictly before: back-to-back events (one ends at 12:00, the next starts then) don't overlap.
    const overlaps = cur && s < runEnd;
    if (overlaps && s - start(cur.evs[0]) < DECK_WINDOW) cur.evs.push(ev);
    else if (overlaps) {
      cur.under = true;
      cur = { evs: [ev], head: false, tucked: true, under: false };
      units.push(cur);
    } else {
      cur = { evs: [ev], head: true, tucked: false, under: false };
      units.push(cur);
    }
    runEnd = overlaps ? Math.max(runEnd, end(ev)) : end(ev);
  }
  // The longest event of a deck goes in front; ties keep start order.
  for (const u of units) if (u.evs.length > 1) u.evs.sort((a, b) => (end(b) - start(b)) - (end(a) - start(a)) || start(a) - start(b));
  return units;
}

function nextDay(d) { const x = new Date(d); x.setDate(x.getDate() + 1); return x; }
