// Browser smoke tests against the running app. Read-only: nothing is added, changed or removed.
//   npm run e2e            (MAGO_URL=http://127.0.0.1:3010 by default)
import { chromium } from "playwright-core";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.MAGO_URL ?? "http://127.0.0.1:3010";

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), ".cache", "ms-playwright");
  const builds = existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("chromium-")).sort().reverse() : [];
  for (const build of builds) {
    for (const path of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
      if (existsSync(join(cache, build, path))) return join(cache, build, path);
    }
  }
  for (const path of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) if (existsSync(path)) return path;
  throw new Error("No Chrome or Chromium found. Set CHROME_PATH.");
}

const results = [];
async function check(name, run) {
  try {
    await run();
    results.push([true, name]);
  } catch (error) {
    results.push([false, `${name}: ${String(error.message ?? error).split("\n")[0]}`]);
  }
}
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const browser = await chromium.launch({ executablePath: findBrowser() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 160)));

// Ask the API from inside the page: the browser trusts the local certificate, Node on its own doesn't.
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
const api = (path) => page.evaluate((url) => fetch(url).then((response) => response.json()), `/api${path}`);
const sources = await api("/sources");
const done = (await api("/videos?status=done&limit=1&sort=longest")).items[0];
const channel = sources.find((source) => source.kind !== "video");

const screens = [
  ["Library", "/"],
  ["Search", "/search"],
  ["Highlights", "/highlights"],
  ["Activity", "/activity"],
  ["Statistics", "/stats"],
  ["Settings", "/settings"],
  ...(channel ? [[`Channel (${channel.title})`, `/c/${channel.id}`]] : []),
  ...(done ? [["Video", `/v/${done.id}`]] : []),
];

for (const [name, path] of screens) {
  await check(`${name} loads with a heading and its own tab title`, async () => {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(700);
    expect((await page.title()).endsWith("| Mago"), `tab title is "${await page.title()}"`);
  });
  for (const width of [390, 1024, 1440]) {
    await check(`${name} fits ${width}px without sideways scrolling`, async () => {
      await page.setViewportSize({ width, height: 850 });
      await page.waitForTimeout(250);
      const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(extra <= 0, `${extra}px wider than the screen`);
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

await check("Command palette opens with Ctrl K and lists places to go", async () => {
  await page.goto(BASE + "/");
  await page.locator("h1").first().waitFor();
  await page.keyboard.press("Control+k");
  await page.locator("[cmdk-input]").waitFor({ timeout: 5000 });
  expect((await page.locator("[cmdk-item]").count()) >= 4, "fewer than 4 items");
  await page.keyboard.press("Escape");
});

if (done) {
  const word = (await api(`/videos/${done.id}`)).segments.map((segment) => segment.text).join(" ").split(/\s+/).find((text) => /^[a-z]{6,}$/i.test(text));
  await check(`Search finds a word that was said ("${word}")`, async () => {
    await page.goto(`${BASE}/search?q=${encodeURIComponent(word)}`);
    await page.locator("ol li").first().waitFor({ timeout: 15000 });
    expect((await page.locator("mark").count()) > 0, "no highlighted match");
  });
  await check("Search by meaning returns results", async () => {
    await page.goto(`${BASE}/search?q=${encodeURIComponent(word)}&mode=meaning`);
    await page.locator("ol li").first().waitFor({ timeout: 30000 });
  });
  await check("Video page shows the transcript and a timestamp link opens at that moment", async () => {
    await page.goto(`${BASE}/v/${done.id}?t=30`);
    await page.locator("[data-line]").first().waitFor({ timeout: 15000 });
    expect((await page.locator("[data-line]").count()) > 3, "too few transcript lines");
    await page.waitForTimeout(1500);
    expect((await page.locator("[data-line].bg-murex-soft").count()) === 1, "no current line is highlighted");
  });
  await check("Transcript has few keyboard stops (one per paragraph, not per line)", async () => {
    const stops = await page.evaluate(() => document.querySelectorAll('#main a[href], #main button:not([tabindex="-1"]), #main input').length);
    const lines = await page.locator("[data-line]").count();
    expect(stops < lines / 2 + 60, `${stops} stops for ${lines} lines`);
  });
}

await check("Pages produced no script errors", async () => expect(pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ")));

await browser.close();
for (const [ok, name] of results) console.log(`${ok ? "pass" : "FAIL"}  ${name}`);
const failed = results.filter(([ok]) => !ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
