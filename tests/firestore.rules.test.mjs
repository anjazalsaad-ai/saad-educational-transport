import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  serverTimestamp
} from "firebase/firestore";

const projectId = "saad-educational-transport-rules-test";
let env;

before(async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules }
  });
});

beforeEach(async () => {
  await env.clearFirestore();
});

after(async () => {
  await env.cleanup();
});

async function seedProfile(uid, role = "guardian") {
  await env.withSecurityRulesDisabled(async context => {
    const profile = {
      uid,
      role,
      displayName: "مستخدم تجريبي",
      city: "جدة",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      demo: true,
      status: "demo_pending"
    };
    if (role === "captain") profile.availability = "unavailable";
    await setDoc(doc(context.firestore(), "users", uid), profile);
  });
}

function profile(uid, role = "guardian") {
  const data = {
    uid,
    role,
    displayName: "اسم تجريبي",
    city: "جدة",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    demo: true,
    status: "demo_pending"
  };
  if (role === "captain") data.availability = "unavailable";
  return data;
}

test("signed-in user can create their own valid demo profile", async () => {
  const db = env.authenticatedContext("guardian-1").firestore();
  await assertSucceeds(setDoc(doc(db, "users", "guardian-1"), profile("guardian-1")));
});

test("user cannot create an admin profile or another user's profile", async () => {
  const db = env.authenticatedContext("guardian-1").firestore();
  await assertFails(setDoc(doc(db, "users", "guardian-1"), profile("guardian-1", "admin")));
  await assertFails(setDoc(doc(db, "users", "guardian-2"), profile("guardian-2")));
});

test("guardian cannot read another user's profile", async () => {
  await seedProfile("guardian-2");
  const db = env.authenticatedContext("guardian-1").firestore();
  await assertFails(getDoc(doc(db, "users", "guardian-2")));
});

test("guardian can create a demo request only for their own profile", async () => {
  await seedProfile("guardian-1");
  const db = env.authenticatedContext("guardian-1").firestore();
  const request = {
    guardianUid: "guardian-1",
    captainUid: null,
    city: "جدة",
    destinationType: "مدرسة",
    serviceType: "ذهاب وعودة",
    priceMonthly: 1000,
    status: "new",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    demo: true
  };
  await assertSucceeds(addDoc(collection(db, "serviceRequests"), request));
  await assertFails(addDoc(collection(db, "serviceRequests"), { ...request, guardianUid: "guardian-2" }));
});

test("captain cannot create a guardian service request", async () => {
  await seedProfile("captain-1", "captain");
  const db = env.authenticatedContext("captain-1").firestore();
  await assertFails(addDoc(collection(db, "serviceRequests"), {
    guardianUid: "captain-1",
    captainUid: null,
    city: "جدة",
    destinationType: "مدرسة",
    serviceType: "ذهاب وعودة",
    priceMonthly: 1000,
    status: "new",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    demo: true
  }));
});

test("activity events are append-only for clients", async () => {
  await seedProfile("guardian-1");
  const db = env.authenticatedContext("guardian-1").firestore();
  const ref = await assertSucceeds(addDoc(collection(db, "activityEvents"), {
    actorUid: "guardian-1",
    actorRole: "guardian",
    eventType: "demo_account_created",
    targetType: "user",
    targetId: "guardian-1",
    summary: "حدث تجريبي",
    createdAt: serverTimestamp(),
    demo: true
  }));
  await assertFails(setDoc(ref, {
    actorUid: "guardian-1",
    actorRole: "guardian",
    eventType: "demo_account_created",
    targetType: "user",
    targetId: "guardian-1",
    summary: "تعديل غير مسموح",
    createdAt: serverTimestamp(),
    demo: true
  }));
});
