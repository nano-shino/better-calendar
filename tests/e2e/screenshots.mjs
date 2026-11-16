// Captures the main screens at desktop, tablet and phone sizes into tests/.artifacts/
// for a visual review (they are not compared automatically).
//   npm run screenshots
import { startServer } from "../serve.mjs";
import { launch, sleep, VIEWPORTS } from "./browser.mjs";

const server = await startServer(0);
process.env.BASE_URL = server.url;
const shots = [];
for (const viewport of Object.keys(VIEWPORTS)) {
  const page = await launch({ viewport });
  for (const view of ["day", "week", "month"]) {
    await page.goto(`?mock#${view}`);
    await sleep(800);
    shots.push(await page.screenshot(`${viewport}-${view}`));
  }
  await page.goto("?mock#week");
  await page.click(".card.photo");
  await sleep(900);
  shots.push(await page.screenshot(`${viewport}-panel`));
  await page.key("Escape");
  await sleep(400);
  await page.click("#acctBtn");
  await sleep(400);
  shots.push(await page.screenshot(`${viewport}-accounts`));
  await page.goto("#week");
  await sleep(800);
  shots.push(await page.screenshot(`${viewport}-signed-out`));
  await page.click("#welcome .wc-demo");
  await sleep(800);
  shots.push(await page.screenshot(`${viewport}-demo`));
  if (page.errors.length) console.error(viewport, "console errors:", page.errors);
  await page.close();
}
await server.close();
console.log(shots.join("\n"));
