// Two people on one board, in two tabs of Chromium: they create a board, write notes,
// draw a rectangle, a line between the notes, and a pen stroke, add an image, color a
// shape, rename the board, and see each other's edits as they happen. The board then
// survives a reload, and its deletion closes it for the person who still has it open.
//
// Usage: node collaborate.mjs <base URL> <folder for screenshots>

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:5173";
const out = process.argv[3] ?? "out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const problems = [];

function watch(page, label) {
  page.on("pageerror", (error) => problems.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`${label}: ${message.text()}`);
  });
}

function step(name) {
  console.log(`- ${name}`);
}

async function shot(page, name) {
  await page.screenshot({ path: join(out, `${name}.png`) });
}

async function drag(page, from, to) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 5 });
  await page.mouse.move(to[0], to[1], { steps: 5 });
  await page.mouse.up();
}

const items = (page) => page.locator('[data-testid="board"] [data-item]');

async function waitForText(page, text) {
  await page.waitForFunction((wanted) => document.querySelector('[data-testid="board"]')?.textContent?.includes(wanted) === true, text, { timeout: 10_000 });
}

async function waitForItems(page, count) {
  await page.waitForFunction((wanted) => document.querySelectorAll('[data-testid="board"] [data-item]').length === wanted, count, { timeout: 10_000 });
}

/** A PNG of a flat color, made here so that the test needs no file of its own. */
function png(width, height, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}

try {
  const a = await context.newPage();
  watch(a, "tab A");

  step("A creates a board");
  await a.goto(base);
  await a.getByRole("button", { name: "New board" }).click();
  await a.getByRole("textbox", { name: "Name" }).fill("Planning");
  await a.getByRole("button", { name: "Create" }).click();
  await a.waitForURL(/\/boards\/[0-9a-z]{16}$/);
  await a.locator('[data-connection="open"]').waitFor();

  step("B opens the same board");
  const b = await context.newPage();
  watch(b, "tab B");
  await b.goto(a.url());
  await b.locator('[data-connection="open"]').waitFor();

  step("A writes a note, and B sees it");
  await a.keyboard.press("n");
  await a.mouse.click(400, 320);
  await a.locator("textarea").waitFor();
  await a.keyboard.type("Hello from A");
  await a.keyboard.press("Escape");
  await waitForText(b, "Hello from A");

  step("B writes a note in Japanese, and A sees it");
  await b.keyboard.press("n");
  await b.mouse.click(700, 320);
  await b.locator("textarea").waitFor();
  await b.keyboard.insertText("付箋をもう一枚");
  await b.keyboard.press("Escape");
  await waitForText(a, "付箋をもう一枚");

  step("B draws a rectangle and a line between the notes");
  await b.keyboard.press("r");
  await drag(b, [450, 520], [650, 620]);
  await b.keyboard.press("l");
  await drag(b, [400, 320], [700, 320]);
  await waitForItems(a, 4);

  step("A moves its note, and draws with the pen");
  await a.mouse.click(1000, 200);
  await drag(a, [400, 320], [380, 200]);
  await a.keyboard.press("p");
  await a.mouse.move(900, 520);
  await a.mouse.down();
  for (let x = 900; x <= 1100; x += 10) await a.mouse.move(x, 520 + Math.sin(x / 20) * 30);
  await a.mouse.up();
  await a.keyboard.press("v");
  await waitForItems(b, 5);

  step("A adds an image, and B sees it");
  await a.locator('input[type="file"]').setInputFiles({ name: "swatch.png", mimeType: "image/png", buffer: png(96, 60, [28, 126, 214]) });
  await b.waitForFunction(() => document.querySelectorAll('[data-testid="board"] image').length === 1, null, { timeout: 10_000 });
  await b.waitForFunction(() => {
    const image = document.querySelector('[data-testid="board"] image');
    return image !== null && image.getBBox().width > 0;
  });

  step("B gives the rectangle a fill");
  await b.mouse.click(550, 600);
  await b.getByRole("button", { name: "blue fill" }).click();
  await a.waitForTimeout(500);
  await shot(a, "board-a");
  await shot(b, "board-b");

  step("A renames the board, and B sees the new name");
  await a.getByRole("button", { name: "Planning" }).click();
  await a.getByRole("textbox", { name: "Name" }).fill("Roadmap");
  await a.getByRole("button", { name: "Rename" }).click();
  await b.getByText("Roadmap").first().waitFor();

  step("The board survives a reload");
  // The room saves a change two seconds after it.
  await a.waitForTimeout(3_000);
  await b.reload();
  await b.locator('[data-connection="open"]').waitFor();
  await waitForItems(b, 6);
  await waitForText(b, "Hello from A");
  await shot(b, "board-after-reload");

  step("The list of boards shows it");
  await a.goto(base);
  await a.getByText("Roadmap").waitFor();
  await shot(a, "boards");

  step("A deletes the board, which closes it for B");
  await a.getByRole("button", { name: "Actions for Roadmap" }).click();
  await a.getByRole("menuitem", { name: "Delete" }).click();
  await a.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await b.getByText("This board was deleted").waitFor();
  await shot(b, "deleted");

  if (problems.length > 0) throw new Error(`The pages reported errors:\n${problems.join("\n")}`);
  console.log("The browser test passed.");
} catch (error) {
  for (const [index, page] of context.pages().entries()) await page.screenshot({ path: join(out, `failure-${index}.png`) }).catch(() => undefined);
  console.error(problems.join("\n"));
  throw error;
} finally {
  await browser.close();
}
