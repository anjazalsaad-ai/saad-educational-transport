import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const publicHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const wranglerConfig = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .map(match => ({ attributes: match[1], code: match[2] }))
  .filter(script => script.code.trim().length > 0);
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const idSet = new Set(ids);
const moduleScript = scripts.find(script => /\btype=["']module["']/.test(script.attributes));

test("page uses Arabic RTL document structure and only unique element IDs", () => {
  assert.match(html, /<html\s+lang=["']ar["']\s+dir=["']rtl["']/i);
  assert.equal(idSet.size, ids.length, "HTML contains duplicate IDs");
  assert.ok(scripts.length >= 2, "expected the local demo and Firebase module scripts");
});

test("every literal getElementById reference points to an element in the page", () => {
  const referencedIds = [...html.matchAll(/getElementById\(["']([^"']+)["']\)/g)]
    .map(match => match[1]);
  assert.ok(referencedIds.length > 0, "no getElementById references were found");
  for (const id of referencedIds) {
    assert.ok(idSet.has(id), "missing HTML element for id: " + id);
  }
});

test("all inline JavaScript blocks pass Node syntax parsing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "saad-transport-js-check-"));
  try {
    for (let i = 0; i < scripts.length; i += 1) {
      const file = path.join(dir, "inline-" + i + ".mjs");
      await writeFile(file, scripts[i].code, "utf8");
      execFileSync(process.execPath, ["--check", file], { encoding: "utf8", stdio: "pipe" });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Firebase registration has an explicit profile-write rollback and separate event failure handling", () => {
  assert.ok(moduleScript, "Firebase module script is missing");
  assert.match(moduleScript.code, /createUserWithEmailAndPassword/);
  assert.match(moduleScript.code, /await setDoc\(doc\(db, ["']users["'], uid\), profile\)/);
  assert.match(moduleScript.code, /catch \(profileError\)[\s\S]*?await deleteUser\(credential\.user\)/);
  assert.match(moduleScript.code, /تعذر حذف حساب المصادقة التجريبي تلقائيًا/);
  assert.match(moduleScript.code, /catch \(eventError\)[\s\S]*?تعذر تسجيل حدث النشاط/);
});

test("browser bundle does not embed Firebase Admin service-account credentials or phone-auth flow", () => {
  assert.ok(moduleScript, "Firebase module script is missing");
  assert.match(moduleScript.code, /projectId:\s*["']saad-educational-transport["']/);
  assert.doesNotMatch(html, /-----BEGIN PRIVATE KEY-----/);
  assert.doesNotMatch(html, /firebase-admin/);
  assert.doesNotMatch(moduleScript.code, /signInWithPhoneNumber|PhoneAuthProvider/);
});

test("Cloudflare deploy config serves only the synchronized public index", () => {
  assert.equal(publicHtml, html, "public/index.html must stay byte-for-byte synchronized with root index.html");
  assert.equal(wranglerConfig.name, "saad-educational-transport");
  assert.equal(wranglerConfig.compatibility_date, "2026-10-28");
  assert.deepEqual(wranglerConfig.assets, { directory: "./public" });
  assert.equal(wranglerConfig.workers_dev, true);
  assert.equal(wranglerConfig.preview_urls, true);
});
