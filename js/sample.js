// Sample events for the signed-out preview. Generated for any date range.
import { addDays, startOfDay, dayKey, hash } from "./util.js";

const CALS = {
  work: { key: "sample|work", name: "Work", color: "#4f6bed", account: "sample" },
  life: { key: "sample|life", name: "Personal", color: "#1f9d75", account: "sample" },
  home: { key: "sample|home", name: "Family", color: "#e2703a", account: "sample" },
};
export const sampleCalendars = Object.values(CALS).map((c) => ({ ...c, id: c.key, primary: c.name === "Work" }));

function ev(cal, title, day, sh, sm, eh, em, extra = {}) {
  const start = new Date(day); start.setHours(sh, sm, 0, 0);
  const end = new Date(day); end.setHours(eh, em, 0, 0);
  return {
    id: `s-${hash(title + dayKey(day))}`, uid: `s-${hash(title + dayKey(day))}`, seriesId: extra.series || null,
    title, description: extra.description || "", location: extra.location || "",
    start, end, allDay: false, calKey: cal.key, calName: cal.name, account: "sample", color: cal.color,
    link: null, meet: null, attendees: extra.attendees || 0,
  };
}
function allDay(cal, title, day, days) {
  return {
    id: `s-${hash(title + dayKey(day))}`, uid: `s-${hash(title)}`, seriesId: null, title, description: "", location: "",
    start: startOfDay(day), end: addDays(startOfDay(day), days), allDay: true,
    calKey: cal.key, calName: cal.name, account: "sample", color: cal.color, link: null, meet: null, attendees: 0,
  };
}

export function sampleEvents(from, to) {
  const today = startOfDay(new Date());
  const out = [];
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) {
    const wd = d.getDay();
    const offset = Math.round((d - today) / 86400000);
    if (wd >= 1 && wd <= 5) out.push(ev(CALS.work, "Team standup", d, 9, 30, 9, 45, { series: "s-standup", attendees: 6 }));
    if (wd === 1 || wd === 3 || wd === 5) out.push(ev(CALS.life, "Gym", d, 18, 0, 19, 0, { series: "s-gym", location: "Riverside Fitness" }));
    if (wd === 2) out.push(ev(CALS.work, "1:1 with Sam", d, 14, 0, 14, 30, { series: "s-11", attendees: 2 }));
    if (wd === 4) out.push(ev(CALS.work, "Design review", d, 15, 0, 16, 0, { series: "s-dr", attendees: 5 }));
    if (wd === 6) out.push(ev(CALS.life, "Farmers market", d, 9, 0, 10, 30, { series: "s-market" }));
    if (wd === 0) out.push(ev(CALS.home, "Family dinner", d, 18, 30, 20, 30, { series: "s-fam" }));

    if (offset === 0) out.push(ev(CALS.life, "Coffee with Alex", d, 15, 0, 16, 0, { location: "Corner Café" }));
    if (offset === 1) out.push(ev(CALS.work, "Quarterly planning", d, 10, 0, 12, 0, { attendees: 9 }), ev(CALS.work, "Lunch with the team", d, 12, 0, 13, 0));
    if (offset === 2) out.push(ev(CALS.life, "Dentist", d, 8, 0, 8, 45, { location: "Smile Dental Clinic" }));
    if (offset === 4) out.push(
      ev(CALS.home, "Flight to Lisbon", d, 7, 15, 13, 40, { location: "City Airport" }),
      ev(CALS.home, "Seafood dinner", d, 19, 0, 21, 0, { location: "Lisbon" }),
      allDay(CALS.home, "Trip to Portugal", d, 4),
    );
    if (offset === 5) out.push(ev(CALS.home, "Hiking in Sintra", d, 8, 0, 14, 0, { location: "Sintra" }));
    if (offset === 9) out.push(ev(CALS.life, "Concert", d, 20, 0, 22, 30, { location: "City Park" }));
    if (offset === 12) out.push(allDay(CALS.home, "Mom's birthday", d, 1));
    if (offset === -3) out.push(ev(CALS.life, "Yoga class", d, 7, 0, 8, 0));
  }
  return out;
}
