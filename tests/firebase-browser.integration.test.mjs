import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("browser registration, Firestore persistence, request creation, and role separation use local emulators", {
  timeout: 120000
}, async () => {
  let server;
  let browser;
  const pageErrors = [];
  try {
    server = createServer((req, res) => {
      if ((req.url || "").split("?")[0] !== "/") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const origin = "http://127.0.0.1:" + address.port;

    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", error => pageErrors.push(error.message));

    await page.goto(origin + "/?emulator=1", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() =>
      document.querySelector("#cloudStatus")?.textContent.includes("المحاكيات المحلية فقط")
    );

    const guardianEmail = "guardian-" + randomUUID() + "@example.test";
    await page.locator("#regRole").selectOption("guardian");
    await page.locator("#regName").fill("ولي أمر تكامل تجريبي");
    await page.locator("#regEmail").fill(guardianEmail);
    await page.locator("#regPassword").fill("Demo-Only-Password-2026!");
    await page.locator("#registerForm button[type=submit]").click();
    await page.waitForFunction(() =>
      document.querySelector("#cloudStatus")?.textContent.includes("بنجاح.")
    );
    await page.waitForFunction(() =>
      document.querySelector("#accountStatus")?.textContent.includes("ولي أمر")
    );

    await page.locator("#createCloudRequest").click();
    await page.waitForFunction(() =>
      document.querySelector("#cloudStatus")?.textContent.includes("تم حفظ الطلب التجريبي في Firestore.")
    );
    await page.waitForFunction(() =>
      document.querySelector("#cloudData")?.textContent.includes("عدد الطلبات المعروضة: 1")
    );
    const guardianData = await page.locator("#cloudData").textContent();
    assert.ok(guardianData.includes("ولي أمر تكامل تجريبي"));
    assert.ok(guardianData.includes("1000 ريال"));

    // Reload proves that auth persistence and Firestore reads work across page loads.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() =>
      document.querySelector("#accountStatus")?.textContent.includes("ولي أمر")
    );
    await page.waitForFunction(() =>
      document.querySelector("#cloudData")?.textContent.includes("عدد الطلبات المعروضة: 1")
    );

    // A separate captain account must save with the captain role and must not see
    // the guardian's unassigned request.
    const captainEmail = "captain-" + randomUUID() + "@example.test";
    await page.locator("#regRole").selectOption("captain");
    await page.locator("#regName").fill("كابتن تكامل تجريبي");
    await page.locator("#regEmail").fill(captainEmail);
    await page.locator("#regPassword").fill("Demo-Only-Password-2026!");
    await page.locator("#registerForm button[type=submit]").click();
    await page.waitForFunction(() =>
      document.querySelector("#cloudStatus")?.textContent.includes("بنجاح.")
    );
    await page.waitForFunction(() =>
      document.querySelector("#accountStatus")?.textContent.includes("كابتن")
    );
    await page.waitForFunction(() =>
      document.querySelector("#cloudData")?.textContent.includes("عدد الطلبات المعروضة: 0")
    );

    assert.deepEqual(pageErrors, [], "browser reported uncaught JavaScript errors");
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
