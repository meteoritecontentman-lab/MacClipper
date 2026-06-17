import admin from "firebase-admin";

let initialized = false;

export function initializeFirebaseAdmin(): admin.app.App {
  if (!initialized) {
    if (admin.apps.length === 0) {
      const projectId = resolvedFirebaseProjectID();
      const storageBucket = resolvedFirebaseStorageBucket(projectId);

      admin.initializeApp({
        ...(projectId ? { projectId } : {}),
        ...(storageBucket ? { storageBucket } : {})
      });
    }
    initialized = true;
  }

  return admin.app();
}

export function getFirestore(): admin.firestore.Firestore {
  initializeFirebaseAdmin();
  return admin.firestore();
}

export const Timestamp = admin.firestore.Timestamp;
export const FieldValue = admin.firestore.FieldValue;

function resolvedFirebaseProjectID(): string {
  const envProjectId = (process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "").trim();
  if (envProjectId) {
    return envProjectId;
  }

  const firebaseConfig = parsedFirebaseConfig();
  const configProjectId = typeof firebaseConfig?.projectId === "string"
    ? firebaseConfig.projectId.trim()
    : "";
  return configProjectId;
}

function resolvedFirebaseStorageBucket(projectId: string): string {
  const envBucket = (process.env.FIREBASE_STORAGE_BUCKET || "").trim();
  if (envBucket) {
    return envBucket;
  }

  const firebaseConfig = parsedFirebaseConfig();
  const configBucket = typeof firebaseConfig?.storageBucket === "string"
    ? firebaseConfig.storageBucket.trim()
    : "";
  if (configBucket) {
    return configBucket;
  }

  return projectId ? `${projectId}.firebasestorage.app` : "";
}

function parsedFirebaseConfig(): Record<string, unknown> | null {
  const rawValue = (process.env.FIREBASE_CONFIG || "").trim();
  if (!rawValue.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}