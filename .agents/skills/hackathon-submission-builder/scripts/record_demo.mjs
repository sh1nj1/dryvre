#!/usr/bin/env node
/* global URL, console, localStorage, process, sessionStorage */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateFixtures, validateScenario } from "./video_scenario.mjs";

const [playwrightRoot, baseUrl, scenarioPath, fixturesPath, outputDir] = process.argv.slice(2);
if (!playwrightRoot || !baseUrl || !scenarioPath || !outputDir) {
  throw new Error("usage: record_demo.mjs <playwright-root> <base-url> <scenario> <fixtures-or-empty> <output-dir>");
}

const scenario = JSON.parse(await fs.readFile(scenarioPath, "utf8"));
const fixtures = fixturesPath ? JSON.parse(await fs.readFile(fixturesPath, "utf8")) : {};
validateScenario(scenario);
validateFixtures(fixtures);
const { chromium } = await import(pathToFileURL(path.join(playwrightRoot, "index.mjs")).href);
const viewport = scenario.viewport ?? { width: 1440, height: 900 };
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(path.join(outputDir, "screenshots"), { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport,
  recordVideo: { dir: path.join(outputDir, "raw"), size: viewport },
});

if (fixtures.cookies?.length) await context.addCookies(fixtures.cookies);
await context.addInitScript((values) => {
  for (const [key, value] of Object.entries(values.localStorage ?? {})) localStorage.setItem(key, String(value));
  for (const [key, value] of Object.entries(values.sessionStorage ?? {})) sessionStorage.setItem(key, String(value));
}, { localStorage: fixtures.localStorage, sessionStorage: fixtures.sessionStorage });

for (const route of [...(fixtures.routes ?? [])].reverse()) {
  await context.route(route.url, async (requestRoute) => {
    if (route.method && requestRoute.request().method().toUpperCase() !== route.method.toUpperCase()) {
      await requestRoute.fallback();
      return;
    }
    let body = route.body;
    if (route.json !== undefined) body = JSON.stringify(route.json);
    if (route.bodyFile) {
      const bodyPath = path.isAbsolute(route.bodyFile) ? route.bodyFile : path.join(path.dirname(fixturesPath), route.bodyFile);
      body = await fs.readFile(bodyPath);
    }
    await requestRoute.fulfill({
      status: route.status ?? 200,
      contentType: route.contentType,
      headers: route.headers,
      body,
    });
  });
}

const page = await context.newPage();
const video = page.video();
const startedAt = Date.now();
const timeline = [];
const absoluteUrl = (value) => new URL(value, baseUrl).toString();
const safeName = (value) => String(value).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "frame";

async function perform(step) {
  const timeout = step.timeoutMs ?? 15_000;
  switch (step.action) {
    case "goto": await page.goto(step.url ?? absoluteUrl(step.path), { waitUntil: "domcontentloaded", timeout }); break;
    case "click": await page.locator(step.selector).click({ timeout }); break;
    case "fill": await page.locator(step.selector).fill(String(step.value), { timeout }); break;
    case "type": await page.locator(step.selector).pressSequentially(String(step.value), { delay: step.delayMs ?? 40, timeout }); break;
    case "press": await page.locator(step.selector).press(step.key, { timeout }); break;
    case "hover": await page.locator(step.selector).hover({ timeout }); break;
    case "check": await page.locator(step.selector).check({ timeout }); break;
    case "uncheck": await page.locator(step.selector).uncheck({ timeout }); break;
    case "select": await page.locator(step.selector).selectOption(step.value, { timeout }); break;
    case "wait": await page.waitForTimeout(step.durationMs); break;
    case "waitFor": await page.locator(step.selector).waitFor({ state: "visible", timeout }); break;
    case "assertText": {
      await page.locator(step.selector).filter({ hasText: String(step.text) }).waitFor({ state: "visible", timeout });
      break;
    }
    case "assertUrl": await page.waitForURL((url) => url.href.includes(String(step.pattern)), { timeout }); break;
    case "screenshot": await page.screenshot({ path: path.join(outputDir, "screenshots", `${safeName(step.name)}.png`), fullPage: Boolean(step.fullPage) }); break;
    default: throw new Error(`unsupported scenario action: ${step.action}`);
  }
}

let failure;
try {
  await page.goto(absoluteUrl(scenario.startPath ?? "/"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  for (let index = 0; index < (scenario.steps ?? []).length; index += 1) {
    const step = scenario.steps[index];
    const startMs = Date.now() - startedAt;
    await perform(step);
    const pause = step.pauseAfterMs ?? scenario.defaultPauseMs ?? 350;
    if (pause > 0 && step.action !== "wait") await page.waitForTimeout(pause);
    timeline.push({ index, action: step.action, subtitle: step.subtitle ?? null, startMs, endMs: Date.now() - startedAt });
  }
} catch (error) {
  failure = error;
  await page.screenshot({ path: path.join(outputDir, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  await context.close();
  await browser.close();
}

const recordedPath = await video.path();
await fs.copyFile(recordedPath, path.join(outputDir, "demo-raw.webm"));
await fs.writeFile(path.join(outputDir, "timeline.json"), JSON.stringify({ scenario: scenario.name, timeline }, null, 2) + "\n");
if (failure) throw failure;
console.log(JSON.stringify({ rawVideo: path.join(outputDir, "demo-raw.webm"), steps: timeline.length }));
