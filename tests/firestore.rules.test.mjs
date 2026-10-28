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
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
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

async function seedProfile(uid, role = "guardian", overrides = {}) {
  await env.withSecurityRulesDisabled(async context => {
    const profile = {
      uid,
      role,
      displayName: "مستخدم تجريبي",
      city: "جدة",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      demo: true,
      status: "demo_pending",
      ...(role === "captain" ? { availability: "unavailable" } : {}),
      ...overrides
    };
    await setDoc(doc(context.firestore(), "users", uid), profile);
  });
}


async function seedServiceRequest(requestId, overrides = {}) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "serviceRequests", requestId), {
      guardianUid: "guardian-1",
      captainUid: "captain-1",
      city: "جدة",
      destinationType: "مدرسة",
      serviceType: "ذهاب وعودة",
      priceMonthly: 1000,
      status: "new",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      demo: true,
      ...overrides
    });
  });
}

async function seedActivityEvent(eventId, overrides = {}) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "activityEvents", eventId), {
      actorUid: "guardian-1",
      actorRole: "guardian",
      eventType: "demo_account_created",
      targetType: "user",
      targetId: "guardian-1",
      summary: "حدث تجريبي",
      createdAt: serverTimestamp(),
      demo: true,
      ...overrides
    });
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

test("unauthenticated clients cannot read private profiles or create profiles", async () => {
  await seedProfile("guardian-1");
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "users", "guardian-1")));
  await assertFails(setDoc(doc(db, "users", "anonymous"), profile("anonymous")));
});

test("users may update allowed profile fields but cannot change protected role, status, or demo flag", async () => {
  await seedProfile("guardian-1");
  const db = env.authenticatedContext("guardian-1").firestore();
  const ownProfile = doc(db, "users", "guardian-1");

  await assertSucceeds(updateDoc(ownProfile, {
    displayName: "اسم معدّل تجريبي",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(ownProfile, {
    role: "captain",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(ownProfile, {
    status: "active",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(ownProfile, {
    demo: false,
    updatedAt: serverTimestamp()
  }));
});

test("captains can set only the permitted availability values", async () => {
  await seedProfile("captain-1", "captain");
  const db = env.authenticatedContext("captain-1").firestore();
  const ownProfile = doc(db, "users", "captain-1");

  await assertSucceeds(updateDoc(ownProfile, {
    availability: "available",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(ownProfile, {
    availability: "on_break",
    updatedAt: serverTimestamp()
  }));

  await seedProfile("guardian-1", "guardian");
  const guardianDb = env.authenticatedContext("guardian-1").firestore();
  await assertFails(updateDoc(doc(guardianDb, "users", "guardian-1"), {
    availability: "available",
    updatedAt: serverTimestamp()
  }));
});

test("users cannot delete their own profile", async () => {
  await seedProfile("guardian-1");
  const db = env.authenticatedContext("guardian-1").firestore();
  await assertFails(deleteDoc(doc(db, "users", "guardian-1")));
});

test("only the request's guardian and assigned captain may read a service request", async () => {
  await seedServiceRequest("request-1", {
    guardianUid: "guardian-1",
    captainUid: "captain-1"
  });

  const guardian = env.authenticatedContext("guardian-1").firestore();
  const assignedCaptain = env.authenticatedContext("captain-1").firestore();
  const otherGuardian = env.authenticatedContext("guardian-2").firestore();
  const otherCaptain = env.authenticatedContext("captain-2").firestore();

  await assertSucceeds(getDoc(doc(guardian, "serviceRequests", "request-1")));
  await assertSucceeds(getDoc(doc(assignedCaptain, "serviceRequests", "request-1")));
  await assertFails(getDoc(doc(otherGuardian, "serviceRequests", "request-1")));
  await assertFails(getDoc(doc(otherCaptain, "serviceRequests", "request-1")));
});

test("only the assigned captain can update an allowed request status and no pricing fields", async () => {
  await seedProfile("captain-1", "captain");
  await seedProfile("captain-2", "captain");
  await seedProfile("guardian-1", "guardian");
  await seedServiceRequest("assigned", { guardianUid: "guardian-1", captainUid: "captain-1" });
  await seedServiceRequest("unassigned", { guardianUid: "guardian-1", captainUid: null });

  const captain = env.authenticatedContext("captain-1").firestore();
  const otherCaptain = env.authenticatedContext("captain-2").firestore();
  const guardian = env.authenticatedContext("guardian-1").firestore();

  await assertSucceeds(updateDoc(doc(captain, "serviceRequests", "assigned"), {
    status: "accepted",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(captain, "serviceRequests", "assigned"), {
    priceMonthly: 1150,
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(guardian, "serviceRequests", "assigned"), {
    status: "cancelled",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(otherCaptain, "serviceRequests", "assigned"), {
    status: "declined",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(captain, "serviceRequests", "unassigned"), {
    status: "accepted",
    updatedAt: serverTimestamp()
  }));
});

test("service requests reject unsupported cities, prices, and initial statuses", async () => {
  await seedProfile("guardian-1");
  const db = env.authenticatedContext("guardian-1").firestore();
  const validRequest = {
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

  await assertFails(addDoc(collection(db, "serviceRequests"), {
    ...validRequest,
    city: "مدينة غير معتمدة"
  }));
  await assertFails(addDoc(collection(db, "serviceRequests"), {
    ...validRequest,
    priceMonthly: 999
  }));
  await assertFails(addDoc(collection(db, "serviceRequests"), {
    ...validRequest,
    status: "accepted"
  }));
});


test("assigned user must have a valid demo captain profile to update a request", async () => {
  await seedProfile("captain-1", "captain");
  await seedProfile("guardian-1", "guardian");
  await seedProfile("suspended-captain", "captain", { status: "suspended" });

  await seedServiceRequest("valid-captain-request", {
    guardianUid: "guardian-1",
    captainUid: "captain-1"
  });
  await seedServiceRequest("guardian-role-request", {
    guardianUid: "guardian-1",
    captainUid: "guardian-1"
  });
  await seedServiceRequest("suspended-captain-request", {
    guardianUid: "guardian-1",
    captainUid: "suspended-captain"
  });
  await seedServiceRequest("missing-profile-request", {
    guardianUid: "guardian-1",
    captainUid: "no-profile-user"
  });

  const captain = env.authenticatedContext("captain-1").firestore();
  const guardian = env.authenticatedContext("guardian-1").firestore();
  const suspended = env.authenticatedContext("suspended-captain").firestore();
  const noProfile = env.authenticatedContext("no-profile-user").firestore();

  await assertSucceeds(updateDoc(doc(captain, "serviceRequests", "valid-captain-request"), {
    status: "accepted",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(guardian, "serviceRequests", "guardian-role-request"), {
    status: "accepted",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(suspended, "serviceRequests", "suspended-captain-request"), {
    status: "accepted",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(noProfile, "serviceRequests", "missing-profile-request"), {
    status: "accepted",
    updatedAt: serverTimestamp()
  }));
});

test("captain request status transitions follow the allowed lifecycle", async () => {
  await seedProfile("captain-1", "captain");

  for (const [requestId, status] of [
    ["from-new", "new"],
    ["from-accepted", "accepted"],
    ["from-in-service", "in_service"],
    ["from-completed", "completed"],
    ["from-declined", "declined"]
  ]) {
    await seedServiceRequest(requestId, {
      guardianUid: "guardian-1",
      captainUid: "captain-1",
      status
    });
  }

  const captain = env.authenticatedContext("captain-1").firestore();

  await assertSucceeds(updateDoc(doc(captain, "serviceRequests", "from-new"), {
    status: "accepted",
    updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(captain, "serviceRequests", "from-accepted"), {
    status: "in_service",
    updatedAt: serverTimestamp()
  }));
  await assertSucceeds(updateDoc(doc(captain, "serviceRequests", "from-in-service"), {
    status: "completed",
    updatedAt: serverTimestamp()
  }));

  await assertFails(updateDoc(doc(captain, "serviceRequests", "from-new"), {
    status: "completed",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(captain, "serviceRequests", "from-accepted"), {
    status: "completed",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(captain, "serviceRequests", "from-completed"), {
    status: "cancelled",
    updatedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(captain, "serviceRequests", "from-declined"), {
    status: "accepted",
    updatedAt: serverTimestamp()
  }));
});

test("activity events cannot be read by other users or deleted by their creator", async () => {
  await seedActivityEvent("event-1", { actorUid: "guardian-1" });
  const owner = env.authenticatedContext("guardian-1").firestore();
  const other = env.authenticatedContext("guardian-2").firestore();

  await assertSucceeds(getDoc(doc(owner, "activityEvents", "event-1")));
  await assertFails(getDoc(doc(other, "activityEvents", "event-1")));
  await assertFails(deleteDoc(doc(owner, "activityEvents", "event-1")));
});

test("a trusted admin claim can read the administrative collections", async () => {
  await seedProfile("guardian-1");
  await seedServiceRequest("request-1");
  await seedActivityEvent("event-1");

  const admin = env.authenticatedContext("trusted-admin", { admin: true }).firestore();
  const [users, requests, events] = await Promise.all([
    getDocs(collection(admin, "users")),
    getDocs(collection(admin, "serviceRequests")),
    getDocs(collection(admin, "activityEvents"))
  ]);

  assert.equal(users.size, 1);
  assert.equal(requests.size, 1);
  assert.equal(events.size, 1);
});

