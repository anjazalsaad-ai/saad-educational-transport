import { test } from "node:test";
import assert from "node:assert/strict";

const liveUrl = "https://saad-educational-transport.anjazalsaad.workers.dev/";

test("published Cloudflare Worker responds to a read-only HTTP smoke check", {
  timeout: 30000
}, async () => {
  let response;
  try {
    response = await fetch(liveUrl, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: { "user-agent": "Saad-Transport-ReadOnly-SmokeTest/1.0" }
    });
  } catch (error) {
    assert.fail("Could not reach the published Worker: " + (error?.message || String(error)));
  }

  const body = await response.text();
  const sourceBase = "https://raw.githubusercontent.com/anjazalsaad-ai/saad-educational-transport/";
  const [mainSourceResponse, featureSourceResponse] = await Promise.all([
    fetch(sourceBase + "main/index.html", { signal: AbortSignal.timeout(15000) }),
    fetch(sourceBase + "feature/demo-database-admin/index.html", { signal: AbortSignal.timeout(15000) })
  ]);
  assert.ok(mainSourceResponse.ok, "could not fetch read-only main/index.html for source comparison");
  assert.ok(featureSourceResponse.ok, "could not fetch read-only feature/index.html for source comparison");
  const [mainSource, featureSource] = await Promise.all([
    mainSourceResponse.text(),
    featureSourceResponse.text()
  ]);
  const diagnostics = {
    httpStatus: response.status,
    finalUrl: response.url,
    contentType: response.headers.get("content-type"),
    htmlBytes: Buffer.byteLength(body, "utf8"),
    matchesCurrentMainHtmlExactly: body === mainSource,
    matchesFeatureHtmlExactly: body === featureSource,
    mainSourceBytes: Buffer.byteLength(mainSource, "utf8"),
    featureSourceBytes: Buffer.byteLength(featureSource, "utf8"),
    platformTitlePresent: /<title[^>]*>[^<]*منصة السعد للنقل التعليمي[^<]*<\/title>/i.test(body),
    firebaseProjectConfigPresent: /projectId\s*:\s*["']saad-educational-transport["']/.test(body),
    cloudRegistrationUiPresent: /createUserWithEmailAndPassword/.test(body),
    firebaseAuthEmulatorSwitchPresent: /get\(["']emulator["']\)\s*===\s*["']1["']/.test(body)
  };

  // These observations diagnose the deployed version without creating accounts,
  // reading Firestore documents, or changing any production data.
  console.log("LIVE_WORKER_READ_ONLY_DIAGNOSTICS=" + JSON.stringify(diagnostics));
  assert.equal(response.status, 200, "published Worker must return HTTP 200 for GET /");
  assert.ok(
    diagnostics.platformTitlePresent,
    "published page should identify itself as the Saad educational transport platform"
  );
});
