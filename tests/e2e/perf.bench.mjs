// Not a test: prints load and switch timings against the realistic signed-in fake.
//   npm run bench
import { launch, sleep } from "./browser.mjs";
import { signedIn } from "./fixtures/signed-in.mjs";
import { startServer } from "../serve.mjs";

const server = await startServer(0);
process.env.BASE_URL = server.url;
const out = {};
for (let run = 0; run < 3; run++) {
  const fake = signedIn();
  const page = await launch({ routes: fake.routes });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: fake.setup });
  await page.goto("#week", { ready: "document.querySelectorAll('.card').length > 3" });
  const load = await page.eval("performance.now()");
  // Reload: session + tokens are remembered now (a returning user).
  await page.send("Page.reload", {});
  await sleep(50);
  await page.waitFor("document.querySelectorAll('.card').length > 3", { interval: 5, timeout: 10000 });
  const reload = await page.eval("performance.now()");
  await sleep(1500); // idle prefetch
  const sw = async (key, ready) => {
    await page.eval(`window.__a = document.querySelector("#stage > *"); window.__t = performance.now(); 0`);
    await page.key(key);
    await page.waitFor(`document.querySelector("#stage > *") !== __a && (${ready})`, { interval: 5 });
    return Math.round(await page.eval("performance.now() - __t"));
  };
  const r = {
    load: Math.round(load), reload: Math.round(reload),
    month: await sw("m", "document.getElementById('stage').dataset.view === 'month' && !document.body.classList.contains('loading')"),
    day: await sw("d", "document.getElementById('stage').dataset.view === 'day'"),
    week: await sw("w", "document.getElementById('stage').dataset.view === 'week'"),
    next: await sw("k", "true"),
    done: await sw("c", "document.getElementById('stage').dataset.tab === 'done'"),
    plan: await sw("c", "document.getElementById('stage').dataset.tab === 'plan'"),
  };
  for (const [k, v] of Object.entries(r)) (out[k] ||= []).push(v);
  await page.close();
}
console.log(out);
await server.close();
