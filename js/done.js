// Events you marked as completed. Only a key per occurrence is saved (the iCalUID
// and start time), never the title or other calendar data: the same key that
// dedupes a meeting shared by several accounts, so it is done in all of them.
import { getProfile, update } from "./store.js";

const KEEP = 400 * 86400000; // older marks are dropped on the next change, so the document stays small

export const doneKey = (ev) => `${ev.uid}|${+ev.start}`;
export const isDone = (ev) => Object.hasOwn(getProfile().done, doneKey(ev));

export function setDone(ev, on) {
  return update((p) => {
    const cutoff = Date.now() - KEEP;
    for (const k of Object.keys(p.done)) if (+k.slice(k.lastIndexOf("|") + 1) < cutoff) delete p.done[k];
    if (on) p.done[doneKey(ev)] = Date.now();
    else delete p.done[doneKey(ev)];
  });
}
