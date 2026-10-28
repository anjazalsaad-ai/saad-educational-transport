import { randomBytes, randomUUID } from "node:crypto";
import { chromium } from "playwright";

const appUrl = "https://saad-educational-transport.anjazalsaad.workers.dev/";
const marker = randomUUID().slice(0, 8);
const email = `saad-prod-smoke-${randomUUID()}@example.test`;
const password = `T-${randomBytes(24).toString("base64url")}-9!`;
const displayName = `اختبار إنتاجي آلي ${marker}`;

let browser;
let authInfo = null;
let phase = "start";
const pageErrors = [];

try {
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (response.url().includes("identitytoolkit.googleapis.com/v1/accounts:signUp")) {
      authInfo = response.json().then(body => ({
        uid: body.localId || null,
        email: body.email || email,
        error: body.error?.message || null
      })).catch(() => ({ uid: null, email, error: "response_parse_failed" }));
    }
  });

  phase = "load_production_site";
  const response = await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  if (!response || response.status() !== 200) {
    throw new Error("Production page did not return HTTP 200.");
  }

  await page.waitForFunction(() => {
    const text = document.querySelector("#cloudStatus")?.textContent || "";
    return text.includes("تمت تهيئة Firebase") || text.includes("تعذر تهيئة Firebase");
  }, { timeout: 30000 });
  const initStatus = (await page.locator("#cloudStatus").textContent()) || "";
  if (initStatus.includes("تعذر تهيئة Firebase")) {
    throw new Error("Firebase did not initialize in the production page.");
  }

  phase = "create_synthetic_firebase_account";
  await page.locator("#regRole").selectOption("guardian");
  await page.locator("#regName").fill(displayName);
  await page.locator("#regEmail").fill(email);
  await page.locator("#regPassword").fill(password);
  await page.locator("#registerForm button[type=submit]").click();

  await page.waitForFunction(() => {
    const text = document.querySelector("#cloudStatus")?.textContent || "";
    return text.includes("تم إنشاء الحساب التجريبي وحفظ ملفه السحابي وحدث النشاط بنجاح.")
      || text.includes("تعذر إكمال العملية")
      || text.includes("لم يكتمل التسجيل")
      || text.includes("تعذر حذف حساب المصادقة")
      || text.includes("فشل حفظ ملف الحساب")
      || text.includes("تعذر الاتصال بالشبكة")
      || text.includes("رفضت قواعد Firestore");
  }, { timeout: 60000 });
  const registrationStatus = ((await page.locator("#cloudStatus").textContent()) || "").trim();
  const registrationPassed = registrationStatus.includes("تم إنشاء الحساب التجريبي وحفظ ملفه السحابي وحدث النشاط بنجاح.");
  if (!registrationPassed) {
    throw new Error("Production registration/profile write did not complete; UI reported a failure.");
  }

  if (authInfo && typeof authInfo.then === "function") authInfo = await authInfo;
  if (!authInfo?.uid) {
    throw new Error("The auth response was not captured; registration may have succeeded but its UID could not be verified.");
  }

  phase = "verify_initial_firestore_read";
  await page.waitForFunction(name => {
    const text = document.querySelector("#cloudData")?.textContent || "";
    return text.includes(name) && text.includes("عدد الطلبات المعروضة: 0");
  }, displayName, { timeout: 30000 });

  phase = "verify_persistent_firestore_read_after_reload";
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(address => {
    const account = document.querySelector("#accountStatus")?.textContent || "";
    return account.includes(address);
  }, email, { timeout: 45000 });
  await page.waitForFunction(name => {
    const text = document.querySelector("#cloudData")?.textContent || "";
    return text.includes(name) && text.includes("عدد الطلبات المعروضة: 0");
  }, displayName, { timeout: 45000 });

  if (pageErrors.length) {
    throw new Error("Browser reported uncaught JavaScript errors: " + pageErrors.join(" | "));
  }

  console.log(JSON.stringify({
    result: "PASS",
    target: "production Cloudflare page + Firebase Authentication + Firestore",
    appHttpStatus: response.status(),
    syntheticAccountCreated: true,
    authUid: authInfo.uid,
    syntheticEmail: email,
    profileAndActivityWrites: "PASS",
    profileReadAndOwnedRequestQuery: "PASS",
    persistenceAfterPageReload: "PASS",
    createdAt: new Date().toISOString(),
    cleanupNote: "Synthetic Authentication account, users/{uid} profile, and activityEvents entry remain in production. Client rules do not permit self-deletion. No service request, child data, phone number, or payment was created."
  }, null, 2));
} catch (error) {
  if (authInfo && typeof authInfo.then === "function") {
    try { authInfo = await authInfo; } catch {}
  }
  console.error(JSON.stringify({
    result: "FAIL",
    phase,
    message: String(error?.message || error),
    syntheticEmail: email,
    authUid: authInfo?.uid || null,
    browserErrors: pageErrors,
    cleanupNote: "Do not infer that no production data was written if failure happened after account or profile creation. Check the synthetic email and auth UID in Firebase Console."
  }, null, 2));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
