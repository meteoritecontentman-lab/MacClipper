import admin from "firebase-admin";
import { supabasePublishableKey, supabaseServiceRoleKey, supabaseURL } from "../config";
import { ApiError } from "../middleware/errorHandler";
import { getFirestore, initializeFirebaseAdmin } from "../firestore";
import {
  getCommunityClipCommentCounts,
  getCommunityClipLikeCounts,
  getRecentCommunityClipComments,
  getTotalCommunityClipCommentCount
} from "./clipSocialService";

const ADMIN_OWNER_EMAIL = "meteoritecontentman@gmail.com";
const SUPABASE_TIMEOUT_MS = 12000;
const ADMIN_PUBLIC_CLIP_LIMIT = 96;
const ADMIN_PROFILE_LIMIT = 500;
const ADMIN_RECENT_COMMENT_LIMIT = 24;
const VERIFICATION_FOLLOWER_THRESHOLD = 10000;

interface AdminDashboardUser {
  id: string;
  email: string;
}

interface SupabaseProfileRow {
  id?: unknown;
  email?: unknown;
  display_name?: unknown;
  avatar_url?: unknown;
  created_at?: unknown;
  last_seen_at?: unknown;
  follower_count?: unknown;
  verified?: unknown;
}

interface SupabaseAuthAdminUser {
  id?: unknown;
  email?: unknown;
  created_at?: unknown;
  last_sign_in_at?: unknown;
  user_metadata?: unknown;
}

interface SupabaseClipRow {
  id?: unknown;
  title?: unknown;
  visibility?: unknown;
  game_title?: unknown;
  created_at?: unknown;
  owner_profile_id?: unknown;
  user_id?: unknown;
}

interface AdminCreatorRow {
  id: string;
  accountType: "website" | "app";
  email: string;
  display_name: string;
  avatar_url: string;
  created_at: string;
  last_seen_at: string;
  follower_count: number;
  verified: boolean;
  role?: string;
  accountStatus?: string;
  subscriptionTier?: string;
  paidFeatures?: string[];
  source?: string;
  appUuid?: string;
  machineName?: string;
  machineIdentifier?: string;
  hasPublicProfile?: boolean;
  profileId?: string;
  isLinked?: boolean;
  linkedAccountId?: string;
  linkedAppUuid?: string;
}

interface AdminClipRow {
  id: string;
  title: string;
  visibility: string;
  game_title: string;
  created_at: string;
  owner_profile_id: string;
  user_id: string;
}

interface AdminCommentRow {
  id: string;
  clip_id: string;
  user_id: string;
  body: string;
  created_at: string;
  authorName: string;
  clipTitle: string;
}

interface AdminTopClipRow extends AdminClipRow {
  ownerName: string;
  likeCount: number;
  commentCount: number;
  score: number;
}

interface AdminUnlistedClipRow {
  id: string;
  title: string;
  uploadedAt: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  videoURL: string;
  pageURL: string;
  shareURL: string;
  appUuid: string;
  websiteUserId: string;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeNumber(value: unknown): number {
  const numericValue = Number(value || 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeTimestamp(value: unknown): string {
  return normalizeText(value);
}

function normalizeClipId(value: unknown): string {
  return normalizeText(value);
}

function uniqueIds(values: unknown[]): string[] {
  return Array.from(new Set((values || []).map((value) => normalizeText(value)).filter(Boolean)));
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function sortTimestampsDescending(leftValue: string, rightValue: string): number {
  return new Date(rightValue || 0).getTime() - new Date(leftValue || 0).getTime();
}

function creatorFallbackLabel(userId: string): string {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) {
    return "Unknown creator";
  }

  return `Creator ${normalizedUserId.slice(0, 8)}`;
}

function ownerIdForClip(clip: AdminClipRow): string {
  return normalizeText(clip.owner_profile_id || clip.user_id);
}

function mostRecentTimestamp(values: string[]): string {
  return values
    .map((value) => normalizeTimestamp(value))
    .filter(Boolean)
    .sort(sortTimestampsDescending)[0] || "";
}

function profileFromRow(row: SupabaseProfileRow): AdminCreatorRow {
  const id = normalizeText(row.id);
  const email = normalizeText(row.email);
  const displayName = normalizeText(row.display_name);

  return {
    id,
    accountType: "website",
    email,
    display_name: displayName || email || creatorFallbackLabel(id),
    avatar_url: normalizeText(row.avatar_url),
    created_at: normalizeTimestamp(row.created_at),
    last_seen_at: normalizeTimestamp(row.last_seen_at),
    follower_count: normalizeNumber(row.follower_count),
    verified: normalizeBoolean(row.verified),
    source: "supabase-profile",
    hasPublicProfile: true,
    profileId: id
  };
}

function profileFromAuthAdminUser(row: SupabaseAuthAdminUser): AdminCreatorRow {
  const id = normalizeText(row.id);
  const email = normalizeText(row.email);
  const metadata = typeof row.user_metadata === "object" && row.user_metadata !== null
    ? row.user_metadata as Record<string, unknown>
    : {};

  const metadataName = [
    normalizeText(metadata.full_name),
    normalizeText(metadata.name),
    normalizeText(metadata.user_name)
  ].find(Boolean) || "";

  const metadataAvatar = normalizeText(metadata.avatar_url || metadata.picture);
  const displayName = metadataName || (email.includes("@") ? email.split("@")[0] : email) || creatorFallbackLabel(id);

  return {
    id,
    accountType: "website",
    email,
    display_name: displayName,
    avatar_url: metadataAvatar,
    created_at: normalizeTimestamp(row.created_at),
    last_seen_at: normalizeTimestamp(row.last_sign_in_at),
    follower_count: 0,
    verified: false,
    source: "supabase-auth",
    hasPublicProfile: false,
    profileId: id
  };
}

function firestoreAccountFromRow(row: Record<string, unknown>, id: string, source: string): AdminCreatorRow {
  const email = normalizeText(row.email);
  const displayName = normalizeText(row.displayName || row.display_name);
  const createdAt = normalizeTimestamp(row.createdAt || row.created_at);
  const updatedAt = normalizeTimestamp(row.updatedAt || row.updated_at || row.lastSeenAt || row.last_seen_at || createdAt);
  const role = normalizeText(row.role).toLowerCase();
  const accountStatus = normalizeText(row.accountStatus || row.account_status).toLowerCase();
  const subscriptionTier = normalizeText(row.subscriptionTier || row.subscription_tier).toLowerCase();
  const paidFeatures = Array.isArray(row.paidFeatures)
    ? row.paidFeatures.map((value) => normalizeText(value)).filter(Boolean)
    : [];

  return {
    id,
    accountType: "website",
    email,
    display_name: displayName || email || creatorFallbackLabel(id),
    avatar_url: normalizeText(row.avatarUrl || row.avatar_url),
    created_at: createdAt,
    last_seen_at: updatedAt,
    follower_count: normalizeNumber(row.follower_count || row.followerCount),
    verified: normalizeBoolean(row.verified),
    role,
    accountStatus,
    subscriptionTier,
    paidFeatures,
    source,
    hasPublicProfile: false,
    profileId: id
  };
}

function accountFromFirebaseAuthUser(row: admin.auth.UserRecord): AdminCreatorRow {
  const id = normalizeText(row.uid);
  const email = normalizeText(row.email);
  const displayName = normalizeText(row.displayName || row.email || creatorFallbackLabel(id));
  const photoURL = normalizeText(row.photoURL);

  return {
    id,
    accountType: "website",
    email,
    display_name: displayName,
    avatar_url: photoURL,
    created_at: normalizeTimestamp(row.metadata?.creationTime),
    last_seen_at: normalizeTimestamp(row.metadata?.lastSignInTime || row.metadata?.creationTime),
    follower_count: 0,
    verified: Boolean(row.emailVerified),
    source: "firebase-auth",
    hasPublicProfile: false,
    profileId: id
  };
}

function accountFromInstallationRow(row: Record<string, unknown>, id: string): AdminCreatorRow {
  const appUuid = normalizeText(row.appUuid);
  const machineName = normalizeText(row.machineName || row.machine_name || "Mac") || "Mac";
  const displayName = normalizeText(row.displayName || row.display_name || machineName || creatorFallbackLabel(id));
  const createdAt = normalizeTimestamp(row.createdAt || row.created_at);
  const lastSeenAt = normalizeTimestamp(row.lastSeenAt || row.last_seen_at || row.updatedAt || row.updated_at || createdAt);

  return {
    id,
    accountType: "app",
    email: normalizeText(row.email),
    display_name: displayName,
    avatar_url: normalizeText(row.avatarUrl || row.avatar_url),
    created_at: createdAt,
    last_seen_at: lastSeenAt,
    follower_count: 0,
    verified: false,
    role: normalizeText(row.role).toLowerCase(),
    accountStatus: normalizeText(row.accountStatus || row.account_status).toLowerCase(),
    subscriptionTier: normalizeText(row.subscriptionTier || row.subscription_tier).toLowerCase(),
    paidFeatures: Array.isArray(row.paidFeatures) ? row.paidFeatures.map((value) => normalizeText(value)).filter(Boolean) : [],
    source: "firestore-installation",
    appUuid,
    machineName,
    machineIdentifier: normalizeText(row.machineIdentifier || row.machine_identifier),
    hasPublicProfile: false,
    profileId: appUuid || id
  };
}

function clipFromRow(row: SupabaseClipRow): AdminClipRow {
  return {
    id: normalizeClipId(row.id),
    title: normalizeText(row.title) || "Untitled clip",
    visibility: normalizeText(row.visibility) || "public",
    game_title: normalizeText(row.game_title),
    created_at: normalizeTimestamp(row.created_at),
    owner_profile_id: normalizeText(row.owner_profile_id),
    user_id: normalizeText(row.user_id)
  };
}

async function fetchFirestoreCollectionRows(collectionName: string): Promise<{ rows: Array<Record<string, unknown> & { id: string }>; count: number }> {
  initializeFirebaseAdmin();

  const snapshot = await getFirestore().collection(collectionName).get();

  return {
    rows: snapshot.docs.map((documentSnapshot) => ({ id: documentSnapshot.id, ...(documentSnapshot.data() || {}) })),
    count: snapshot.size
  };
}

async function fetchFirebaseAuthUsers(): Promise<{ rows: admin.auth.UserRecord[]; count: number }> {
  initializeFirebaseAdmin();

  const rows: admin.auth.UserRecord[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const page = await admin.auth().listUsers(1000, pageToken);
      rows.push(...page.users);
      pageToken = page.pageToken || undefined;
    } while (pageToken);

    return { rows, count: rows.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    console.warn("[ADMIN_DASHBOARD] Firebase Auth user listing unavailable; continuing without it.", message);
    return { rows: [], count: 0 };
  }
}

function mergeCreatorRows(base: AdminCreatorRow | undefined, incoming: AdminCreatorRow): AdminCreatorRow {
  if (!base) {
    return incoming;
  }

  if (base.accountType !== incoming.accountType) {
    return incoming;
  }

  const mergedPaidFeatures = Array.from(new Set([
    ...(Array.isArray(base.paidFeatures) ? base.paidFeatures : []),
    ...(Array.isArray(incoming.paidFeatures) ? incoming.paidFeatures : [])
  ])).filter(Boolean);

  return {
    ...base,
    ...incoming,
    accountType: base.accountType,
    email: incoming.email || base.email,
    display_name: incoming.display_name || base.display_name,
    avatar_url: incoming.avatar_url || base.avatar_url,
    created_at: mostRecentTimestamp([base.created_at, incoming.created_at]) === base.created_at ? base.created_at : incoming.created_at,
    last_seen_at: sortTimestampsDescending(base.last_seen_at, incoming.last_seen_at) >= 0 ? base.last_seen_at : incoming.last_seen_at,
    follower_count: Math.max(base.follower_count, incoming.follower_count),
    verified: base.verified || incoming.verified,
    role: incoming.role || base.role,
    accountStatus: incoming.accountStatus || base.accountStatus,
    subscriptionTier: incoming.subscriptionTier || base.subscriptionTier,
    paidFeatures: mergedPaidFeatures,
    source: `${base.source || ""},${incoming.source || ""}`,
    appUuid: incoming.appUuid || base.appUuid,
    machineName: incoming.machineName || base.machineName,
    machineIdentifier: incoming.machineIdentifier || base.machineIdentifier,
    hasPublicProfile: Boolean(base.hasPublicProfile || incoming.hasPublicProfile),
    profileId: incoming.profileId || base.profileId || base.id
  };
}

async function fetchSupabaseRows<T>(path: string, searchParams: Record<string, string>, options: { count?: boolean } = {}): Promise<{ rows: T[]; count: number }> {
  const requestURL = new URL(`/rest/v1${path}`, `${supabaseURL()}/`);
  Object.entries(searchParams || {}).forEach(([key, value]) => {
    if (!value) {
      return;
    }

    requestURL.searchParams.set(key, value);
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(requestURL.toString(), {
      method: "GET",
      headers: {
        apikey: supabasePublishableKey(),
        Authorization: `Bearer ${supabasePublishableKey()}`,
        Accept: "application/json",
        ...(options.count ? { Prefer: "count=exact" } : {})
      },
      signal: controller.signal
    });

    const payload = await response.json().catch(() => []);
    if (!response.ok) {
      throw new ApiError(response.status || 500, normalizeText((payload as Record<string, unknown>)?.message) || `Supabase request failed with ${response.status}`);
    }

    const contentRange = normalizeText(response.headers.get("content-range"));
    const countMatch = contentRange.match(/\/(\d+)$/);
    const count = countMatch ? Number.parseInt(countMatch[1], 10) : (Array.isArray(payload) ? payload.length : 0);

    return {
      rows: Array.isArray(payload) ? payload as T[] : [],
      count: Number.isFinite(count) ? count : 0
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, `Supabase request timed out after ${SUPABASE_TIMEOUT_MS}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function assertAdminOwner(user: AdminDashboardUser): void {
  if (normalizeEmail(user.email) !== normalizeEmail(ADMIN_OWNER_EMAIL)) {
    throw new ApiError(403, "Only the site owner can access admin dashboard data.");
  }
}

async function supabaseAdminRequest(path: string, options: { method?: string; body?: Record<string, unknown> } = {}): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const serviceRoleKey = supabaseServiceRoleKey();
  if (!serviceRoleKey) {
    return { ok: false, status: 503, payload: { message: "Supabase service role key is missing." } };
  }

  const requestURL = new URL(path, `${supabaseURL()}/`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(requestURL.toString(), {
      method: options.method || "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function collectFirestoreAccountTargets(input: { accountId: string; appUuid?: string; email?: string }): Promise<{
  userIds: Set<string>;
  installationIds: Set<string>;
  appUuids: Set<string>;
  emails: Set<string>;
}> {
  initializeFirebaseAdmin();

  const accountId = normalizeText(input.accountId);
  const appUuid = normalizeText(input.appUuid).toLowerCase();
  const email = normalizeEmail(input.email);

  const userIds = new Set<string>();
  const installationIds = new Set<string>();
  const appUuids = new Set<string>();
  const emails = new Set<string>();

  if (accountId) {
    userIds.add(accountId);
    installationIds.add(accountId);
    appUuids.add(accountId.toLowerCase());
  }

  if (appUuid) {
    appUuids.add(appUuid);
  }

  if (email) {
    emails.add(email);
  }

  const db = getFirestore();
  const usersCollection = db.collection("users");
  const installationsCollection = db.collection("appInstallations");

  if (accountId) {
    const [userDoc, installationDoc] = await Promise.all([
      usersCollection.doc(accountId).get(),
      installationsCollection.doc(accountId).get()
    ]);

    if (userDoc.exists) {
      const data = userDoc.data() || {};
      userIds.add(userDoc.id);
      const userAppUuid = normalizeText(data.appUuid).toLowerCase();
      if (userAppUuid) {
        appUuids.add(userAppUuid);
      }
      const userEmail = normalizeEmail(data.email);
      if (userEmail) {
        emails.add(userEmail);
      }
    }

    if (installationDoc.exists) {
      const data = installationDoc.data() || {};
      installationIds.add(installationDoc.id);
      const installationAppUuid = normalizeText(data.appUuid).toLowerCase();
      if (installationAppUuid) {
        appUuids.add(installationAppUuid);
      }
    }
  }

  if (emails.size > 0) {
    for (const knownEmail of emails) {
      const userByEmailSnapshot = await usersCollection.where("email", "==", knownEmail).get();
      for (const userDocument of userByEmailSnapshot.docs) {
        userIds.add(userDocument.id);
        const userData = userDocument.data() || {};
        const userAppUuid = normalizeText(userData.appUuid).toLowerCase();
        if (userAppUuid) {
          appUuids.add(userAppUuid);
        }
      }
    }
  }

  if (appUuids.size > 0) {
    for (const knownAppUuid of appUuids) {
      const [userByAppSnapshot, installationsByAppSnapshot] = await Promise.all([
        usersCollection.where("appUuid", "==", knownAppUuid).get(),
        installationsCollection.where("appUuid", "==", knownAppUuid).get()
      ]);

      for (const userDocument of userByAppSnapshot.docs) {
        userIds.add(userDocument.id);
        const userData = userDocument.data() || {};
        const userEmail = normalizeEmail(userData.email);
        if (userEmail) {
          emails.add(userEmail);
        }
      }

      for (const installationDocument of installationsByAppSnapshot.docs) {
        installationIds.add(installationDocument.id);
      }
    }
  }

  return {
    userIds,
    installationIds,
    appUuids,
    emails
  };
}

export async function setAdminAccountBanState(input: {
  accountId: string;
  accountType?: "website" | "app";
  enabled: boolean;
  appUuid?: string;
  email?: string;
}): Promise<{
  banned: boolean;
  updatedUsers: number;
  updatedInstallations: number;
  supabaseAuthUpdated: boolean;
}> {
  const accountId = normalizeText(input.accountId);
  if (!accountId) {
    throw new ApiError(400, "accountId is required.");
  }

  const accountType = input.accountType === "app" ? "app" : "website";

  const nextStatus = input.enabled ? "banned" : "active";
  const updatePayload = {
    accountStatus: nextStatus,
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };

  const db = getFirestore();
  if (accountType === "website") {
    await db.collection("users").doc(accountId).set(updatePayload, { merge: true });
  } else {
    await db.collection("appInstallations").doc(accountId).set(updatePayload, { merge: true });
  }

  let supabaseAuthUpdated = false;
  if (accountType === "website") {
    const supabaseBanResult = await supabaseAdminRequest(`/auth/v1/admin/users/${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: {
        ban_duration: input.enabled ? "876000h" : "none"
      }
    });
    if (supabaseBanResult.ok) {
      supabaseAuthUpdated = true;
    }
  }

  return {
    banned: input.enabled,
    updatedUsers: accountType === "website" ? 1 : 0,
    updatedInstallations: accountType === "app" ? 1 : 0,
    supabaseAuthUpdated
  };
}

export async function deleteAdminAccount(input: {
  accountId: string;
  accountType?: "website" | "app";
  appUuid?: string;
  email?: string;
}): Promise<{
  deletedUsers: number;
  deletedInstallations: number;
  deletedBillingCustomers: number;
  deletedBillingOrders: number;
  supabaseAuthDeleted: boolean;
}> {
  const accountId = normalizeText(input.accountId);
  if (!accountId) {
    throw new ApiError(400, "accountId is required.");
  }

  const accountType = input.accountType === "app" ? "app" : "website";
  const appUuid = normalizeText(input.appUuid).toLowerCase();

  const db = getFirestore();
  let deletedUsers = 0;
  let deletedInstallations = 0;
  let deletedBillingCustomers = 0;
  let deletedBillingOrders = 0;

  const deletePromises: Promise<unknown>[] = [];

  if (accountType === "website") {
    deletedUsers += 1;
    deletePromises.push(db.collection("users").doc(accountId).delete());
    deletePromises.push(db.collection("billingCustomers").doc(accountId).delete());
    deletedBillingCustomers += 1;

    const ordersByWebsiteUserSnapshot = await db.collection("billingOrders").where("websiteUserId", "==", accountId).get();
    for (const orderDocument of ordersByWebsiteUserSnapshot.docs) {
      deletedBillingOrders += 1;
      deletePromises.push(orderDocument.ref.delete());
    }
  } else {
    deletedInstallations += 1;
    deletePromises.push(db.collection("appInstallations").doc(accountId).delete());

    if (appUuid) {
      const [billingCustomersByAppSnapshot, billingOrdersByAppSnapshot] = await Promise.all([
        db.collection("billingCustomers").where("appUuid", "==", appUuid).get(),
        db.collection("billingOrders").where("appUuid", "==", appUuid).get()
      ]);

      for (const customerDocument of billingCustomersByAppSnapshot.docs) {
        deletedBillingCustomers += 1;
        deletePromises.push(customerDocument.ref.delete());
      }

      for (const orderDocument of billingOrdersByAppSnapshot.docs) {
        deletedBillingOrders += 1;
        deletePromises.push(orderDocument.ref.delete());
      }
    }
  }

  await Promise.all(deletePromises);

  let supabaseAuthDeleted = false;
  if (accountType === "website") {
    const supabaseDeleteResult = await supabaseAdminRequest(`/auth/v1/admin/users/${encodeURIComponent(accountId)}`, {
      method: "DELETE"
    });
    if (supabaseDeleteResult.ok) {
      supabaseAuthDeleted = true;
    }
  }

  return {
    deletedUsers,
    deletedInstallations,
    deletedBillingCustomers,
    deletedBillingOrders,
    supabaseAuthDeleted
  };
}

export async function getAdminUnlistedClipsForAccount(input: {
  accountId: string;
  appUuid?: string;
  email?: string;
}): Promise<{ clips: AdminUnlistedClipRow[] }> {
  const accountId = normalizeText(input.accountId);
  if (!accountId) {
    throw new ApiError(400, "accountId is required.");
  }

  const targets = await collectFirestoreAccountTargets({
    accountId,
    appUuid: input.appUuid,
    email: input.email
  });

  const db = getFirestore();
  const sharedClipsCollection = db.collection("sharedClips");
  const sharedClipById = new Map<string, AdminUnlistedClipRow>();

  for (const userIdChunk of chunkValues(Array.from(targets.userIds), 10)) {
    if (userIdChunk.length === 0) {
      continue;
    }

    const snapshot = await sharedClipsCollection.where("websiteUserId", "in", userIdChunk).get();
    for (const documentSnapshot of snapshot.docs) {
      const source = documentSnapshot.data() || {};
      const clipId = normalizeText(source.id || documentSnapshot.id);
      if (!clipId) {
        continue;
      }

      sharedClipById.set(clipId, {
        id: clipId,
        title: normalizeText(source.title) || "MacClipper Clip",
        uploadedAt: normalizeTimestamp(source.uploadedAt),
        fileName: normalizeText(source.fileName),
        fileType: normalizeText(source.fileType),
        fileSize: normalizeNumber(source.fileSize),
        videoURL: normalizeText(source.videoURL),
        pageURL: normalizeText(source.pageURL),
        shareURL: normalizeText(source.shareURL || source.pageURL),
        appUuid: normalizeText(source.appUuid),
        websiteUserId: normalizeText(source.websiteUserId)
      });
    }
  }

  for (const appUuidChunk of chunkValues(Array.from(targets.appUuids), 10)) {
    if (appUuidChunk.length === 0) {
      continue;
    }

    const snapshot = await sharedClipsCollection.where("appUuid", "in", appUuidChunk).get();
    for (const documentSnapshot of snapshot.docs) {
      const source = documentSnapshot.data() || {};
      const clipId = normalizeText(source.id || documentSnapshot.id);
      if (!clipId) {
        continue;
      }

      sharedClipById.set(clipId, {
        id: clipId,
        title: normalizeText(source.title) || "MacClipper Clip",
        uploadedAt: normalizeTimestamp(source.uploadedAt),
        fileName: normalizeText(source.fileName),
        fileType: normalizeText(source.fileType),
        fileSize: normalizeNumber(source.fileSize),
        videoURL: normalizeText(source.videoURL),
        pageURL: normalizeText(source.pageURL),
        shareURL: normalizeText(source.shareURL || source.pageURL),
        appUuid: normalizeText(source.appUuid),
        websiteUserId: normalizeText(source.websiteUserId)
      });
    }
  }

  const postedPublicVideoURLs = new Set<string>();
  for (const userId of targets.userIds) {
    const [ownerProfileRows, userRows] = await Promise.all([
      fetchSupabaseRows<Record<string, unknown>>("/clips", {
        select: "id,content,visibility,owner_profile_id,user_id,created_at,title",
        visibility: "eq.public",
        owner_profile_id: `eq.${userId}`,
        limit: "500"
      }),
      fetchSupabaseRows<Record<string, unknown>>("/clips", {
        select: "id,content,visibility,owner_profile_id,user_id,created_at,title",
        visibility: "eq.public",
        user_id: `eq.${userId}`,
        limit: "500"
      })
    ]);

    for (const clipRow of [...ownerProfileRows.rows, ...userRows.rows]) {
      const contentURL = normalizeText(clipRow.content);
      if (contentURL) {
        postedPublicVideoURLs.add(contentURL);
      }
    }
  }

  const clips = Array.from(sharedClipById.values())
    .filter((clip) => clip.videoURL && !postedPublicVideoURLs.has(clip.videoURL))
    .sort((leftClip, rightClip) => sortTimestampsDescending(leftClip.uploadedAt, rightClip.uploadedAt));

  return { clips };
}

async function fetchSupabaseAuthUsers(): Promise<{ rows: SupabaseAuthAdminUser[]; count: number }> {
  const serviceRoleKey = supabaseServiceRoleKey();
  if (!serviceRoleKey) {
    return { rows: [], count: 0 };
  }

  const requestURL = new URL("/auth/v1/admin/users", `${supabaseURL()}/`);
  requestURL.searchParams.set("page", "1");
  requestURL.searchParams.set("per_page", String(ADMIN_PROFILE_LIMIT));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(requestURL.toString(), {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(
        response.status || 500,
        normalizeText((payload as Record<string, unknown>)?.msg)
          || normalizeText((payload as Record<string, unknown>)?.message)
          || `Supabase auth admin request failed with ${response.status}`
      );
    }

    const users = Array.isArray((payload as Record<string, unknown>)?.users)
      ? (payload as { users: SupabaseAuthAdminUser[] }).users
      : [];
    const count = normalizeNumber((payload as Record<string, unknown>)?.total);

    return {
      rows: users,
      count: count || users.length
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, `Supabase auth admin request timed out after ${SUPABASE_TIMEOUT_MS}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getAdminDashboardOverview(): Promise<{
  stats: {
    creators: number;
    publicClips: number;
    comments: number;
    subscriptions: number;
    payments: number;
    verifiedCreators: number;
    proUsers: number;
    activeCreators: number;
    pendingVerification: number;
  };
  accounts: AdminCreatorRow[];
  recentProfiles: AdminCreatorRow[];
  recentClips: Array<AdminClipRow & { ownerName: string }>;
  verificationQueue: Array<AdminCreatorRow & { displayLabel: string }>;
  recentComments: AdminCommentRow[];
  topClips: AdminTopClipRow[];
}> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const sourceResults = await Promise.allSettled([
    fetchSupabaseRows<SupabaseProfileRow>("/profiles", {
      select: "id,email,display_name,avatar_url,created_at,last_seen_at,follower_count,verified",
      order: "created_at.desc",
      limit: String(ADMIN_PROFILE_LIMIT)
    }, { count: true }),
    fetchSupabaseAuthUsers(),
    fetchFirebaseAuthUsers(),
    fetchSupabaseRows<SupabaseClipRow>("/clips", {
      select: "id,title,visibility,game_title,created_at,owner_profile_id,user_id",
      visibility: "eq.public",
      order: "created_at.desc",
      limit: String(ADMIN_PUBLIC_CLIP_LIMIT)
    }, { count: true }),
    fetchSupabaseRows<Record<string, unknown>>("/profile_subscriptions", {
      select: "id",
      limit: "1"
    }, { count: true }),
    fetchFirestoreCollectionRows("users"),
    fetchFirestoreCollectionRows("appInstallations"),
    fetchFirestoreCollectionRows("billingCustomers"),
    fetchFirestoreCollectionRows("billingOrders"),
    getRecentCommunityClipComments(ADMIN_RECENT_COMMENT_LIMIT),
    getTotalCommunityClipCommentCount()
  ]);

  const profilesResult = sourceResults[0].status === "fulfilled"
    ? sourceResults[0].value
    : { rows: [], count: 0 };
  if (sourceResults[0].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] profiles source failed", sourceResults[0].reason);
  }

  const authUsersResult = sourceResults[1].status === "fulfilled"
    ? sourceResults[1].value
    : { rows: [], count: 0 };
  if (sourceResults[1].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] supabase auth-admin source failed", sourceResults[1].reason);
  }

  const firebaseAuthUsersResult = sourceResults[2].status === "fulfilled"
    ? sourceResults[2].value
    : { rows: [], count: 0 };
  if (sourceResults[2].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] firebase auth source failed", sourceResults[2].reason);
  }

  const publicClipsResult = sourceResults[3].status === "fulfilled"
    ? sourceResults[3].value
    : { rows: [], count: 0 };
  if (sourceResults[3].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] public clips source failed", sourceResults[3].reason);
  }

  const subscriptionsResult = sourceResults[4].status === "fulfilled"
    ? sourceResults[4].value
    : { rows: [], count: 0 };
  if (sourceResults[4].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] subscriptions source failed", sourceResults[4].reason);
  }

  const firestoreUsersResult = sourceResults[5].status === "fulfilled"
    ? sourceResults[5].value
    : { rows: [], count: 0 };
  if (sourceResults[5].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] firestore users source failed", sourceResults[5].reason);
  }

  const firestoreInstallationsResult = sourceResults[6].status === "fulfilled"
    ? sourceResults[6].value
    : { rows: [], count: 0 };
  if (sourceResults[6].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] firestore installations source failed", sourceResults[6].reason);
  }

  const firestoreBillingCustomersResult = sourceResults[7].status === "fulfilled"
    ? sourceResults[7].value
    : { rows: [], count: 0 };
  if (sourceResults[7].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] firestore billing customers source failed", sourceResults[7].reason);
  }

  const firestoreBillingOrdersResult = sourceResults[8].status === "fulfilled"
    ? sourceResults[8].value
    : { rows: [], count: 0 };
  if (sourceResults[8].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] firestore billing orders source failed", sourceResults[8].reason);
  }

  const recentFirebaseComments = sourceResults[9].status === "fulfilled"
    ? sourceResults[9].value
    : [];
  if (sourceResults[9].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] recent comments source failed", sourceResults[9].reason);
  }

  const totalFirebaseCommentCount = sourceResults[10].status === "fulfilled"
    ? sourceResults[10].value
    : 0;
  if (sourceResults[10].status === "rejected") {
    console.warn("[ADMIN_DASHBOARD] total comments source failed", sourceResults[10].reason);
  }

  const profileRows = profilesResult.rows.map((row) => profileFromRow(row));
  const authProfileRows = authUsersResult.rows
    .map((row) => profileFromAuthAdminUser(row))
    .filter((row) => row.id);
  const firebaseAuthProfileRows = firebaseAuthUsersResult.rows
    .map((row) => accountFromFirebaseAuthUser(row))
    .filter((row) => row.id);
  const firestoreUserRows = firestoreUsersResult.rows.map((row) => firestoreAccountFromRow(row, row.id, "firestore-user"));
  const firestoreInstallationRows = firestoreInstallationsResult.rows.map((row) => accountFromInstallationRow(row, row.id));
  const firestoreBillingCustomerRows = firestoreBillingCustomersResult.rows.map((row) => ({
    websiteUserId: normalizeText(row.websiteUserId),
    appUuid: normalizeText(row.appUuid),
    stripeSubscriptionStatus: normalizeText(row.stripeSubscriptionStatus).toLowerCase(),
    updatedAt: normalizeTimestamp(row.updatedAt)
  }));
  const publicClipRows = publicClipsResult.rows.map((row) => clipFromRow(row)).filter((clip) => clip.id);

  const accountById = new Map<string, AdminCreatorRow>();
  const accountByEmail = new Map<string, AdminCreatorRow>();
  const accountByAppUuid = new Map<string, AdminCreatorRow>();

  function typedKey(accountType: "website" | "app", value: string): string {
    const normalizedValue = normalizeText(value);
    return normalizedValue ? `${accountType}:${normalizedValue}` : "";
  }

  function indexAccount(account: AdminCreatorRow): void {
    const keys = uniqueIds([
      typedKey(account.accountType, account.id),
      typedKey(account.accountType, account.profileId || ""),
      typedKey(account.accountType, account.appUuid || ""),
      typedKey(account.accountType, account.email || ""),
      typedKey(account.accountType, account.machineIdentifier || "")
    ]);
    const existing = keys
      .map((key) => accountById.get(key) || accountByAppUuid.get(key) || accountByEmail.get(key))
      .find(Boolean);

    const merged = mergeCreatorRows(existing, account);

    for (const key of keys) {
      accountById.set(key, merged);
      if (merged.appUuid && key === typedKey(merged.accountType, merged.appUuid)) {
        accountByAppUuid.set(key, merged);
      }
      if (merged.email && key === typedKey(merged.accountType, normalizeEmail(merged.email))) {
        accountByEmail.set(key, merged);
      }
    }

    if (merged.appUuid) {
      accountByAppUuid.set(typedKey(merged.accountType, merged.appUuid), merged);
    }

    if (merged.email) {
      accountByEmail.set(typedKey(merged.accountType, normalizeEmail(merged.email)), merged);
    }
  }

  for (const row of profileRows) {
    indexAccount(row);
  }

  for (const row of authProfileRows) {
    indexAccount(row);
  }

  for (const row of firebaseAuthProfileRows) {
    indexAccount(row);
  }

  for (const row of firestoreUserRows) {
    indexAccount(row);
  }

  for (const row of firestoreInstallationRows) {
    indexAccount(row);
  }

  for (const billingCustomer of firestoreBillingCustomerRows) {
    const billingStatus = billingCustomer.stripeSubscriptionStatus;
    const proSubscription = billingStatus === "active" || billingStatus === "trialing" || billingStatus === "past_due";
    const resolvedId = billingCustomer.websiteUserId || billingCustomer.appUuid;
    const accountType: "website" | "app" = billingCustomer.websiteUserId ? "website" : "app";
    if (!resolvedId) {
      continue;
    }

    const existing = accountById.get(typedKey(accountType, resolvedId))
      || (billingCustomer.appUuid ? accountByAppUuid.get(typedKey(accountType, billingCustomer.appUuid)) : undefined);
    const account = existing || {
      id: resolvedId,
      accountType,
      email: "",
      display_name: creatorFallbackLabel(resolvedId),
      avatar_url: "",
      created_at: billingCustomer.updatedAt,
      last_seen_at: billingCustomer.updatedAt,
      follower_count: 0,
      verified: false,
      role: "user",
      accountStatus: "active",
      subscriptionTier: proSubscription ? "pro" : "free",
      paidFeatures: proSubscription ? ["4k-pro"] : [],
      source: "firestore-billing-customer",
      appUuid: billingCustomer.appUuid || undefined,
      hasPublicProfile: false,
      profileId: resolvedId
    } satisfies AdminCreatorRow;

    indexAccount(mergeCreatorRows(existing, {
      ...account,
      subscriptionTier: proSubscription ? "pro" : account.subscriptionTier || "free",
      paidFeatures: proSubscription ? Array.from(new Set([...(account.paidFeatures || []), "4k-pro"])) : account.paidFeatures,
      source: `${account.source || ""},firestore-billing-customer`
    }));
  }

  const accountRows = Array.from(new Set([
    ...accountById.values()
  ])).sort((leftCreator, rightCreator) => sortTimestampsDescending(
    mostRecentTimestamp([leftCreator.last_seen_at, leftCreator.created_at]),
    mostRecentTimestamp([rightCreator.last_seen_at, rightCreator.created_at])
  ));

  const websiteRowsByAppUuid = new Map(
    accountRows
      .filter((row) => row.accountType === "website" && row.appUuid)
      .map((row) => [normalizeText(row.appUuid), row] as const)
  );
  const appRowsByAppUuid = new Map(
    accountRows
      .filter((row) => row.accountType === "app" && row.appUuid)
      .map((row) => [normalizeText(row.appUuid), row] as const)
  );

  const enrichedAccountRows = accountRows.map((row) => {
    const normalizedAppUuid = normalizeText(row.appUuid);
    const linkedRow = normalizedAppUuid
      ? (row.accountType === "website" ? appRowsByAppUuid.get(normalizedAppUuid) : websiteRowsByAppUuid.get(normalizedAppUuid))
      : undefined;

    return {
      ...row,
      isLinked: Boolean(linkedRow),
      linkedAccountId: linkedRow?.id,
      linkedAppUuid: linkedRow?.appUuid || row.appUuid
    } satisfies AdminCreatorRow;
  });

  const profileById = new Map(enrichedAccountRows.map((row) => [row.id, row]));
  const activityByUserId = new Map<string, string[]>();

  for (const profile of profileById.values()) {
    activityByUserId.set(profile.id, [profile.last_seen_at, profile.created_at].filter(Boolean));
  }

  for (const clip of publicClipRows) {
    const ownerId = ownerIdForClip(clip);
    if (!ownerId) {
      continue;
    }

    const values = activityByUserId.get(ownerId) || [];
    values.push(clip.created_at);
    activityByUserId.set(ownerId, values);
  }

  for (const comment of recentFirebaseComments) {
    if (!comment.user_id) {
      continue;
    }

    const values = activityByUserId.get(comment.user_id) || [];
    values.push(comment.created_at);
    activityByUserId.set(comment.user_id, values);
  }

  const clipIds = publicClipRows.map((clip) => clip.id);
  const [likeCountsByClipId, commentCountsByClipId] = await Promise.all([
    getCommunityClipLikeCounts(clipIds),
    getCommunityClipCommentCounts(clipIds)
  ]);

  const clipTitleById = new Map(publicClipRows.map((clip) => [clip.id, clip.title]));

  const recentComments = recentFirebaseComments.map((comment) => ({
    id: comment.id,
    clip_id: comment.clip_id,
    user_id: comment.user_id,
    body: comment.body,
    created_at: comment.created_at,
    authorName: profileById.get(comment.user_id)?.display_name || creatorFallbackLabel(comment.user_id),
    clipTitle: clipTitleById.get(comment.clip_id) || `Clip #${comment.clip_id}`
  }));

  const recentClips = publicClipRows.slice(0, 24).map((clip) => ({
    ...clip,
    ownerName: profileById.get(ownerIdForClip(clip))?.display_name || creatorFallbackLabel(ownerIdForClip(clip))
  }));

  const topClips = publicClipRows
    .map((clip) => {
      const clipId = clip.id;
      const likeCount = Math.max(0, Number(likeCountsByClipId[clipId] || 0));
      const commentCount = Math.max(0, Number(commentCountsByClipId[clipId] || 0));

      return {
        ...clip,
        ownerName: profileById.get(ownerIdForClip(clip))?.display_name || creatorFallbackLabel(ownerIdForClip(clip)),
        likeCount,
        commentCount,
        score: (likeCount * 3) + (commentCount * 2)
      };
    })
    .sort((leftClip, rightClip) => {
      if (rightClip.score !== leftClip.score) {
        return rightClip.score - leftClip.score;
      }

      if (rightClip.likeCount !== leftClip.likeCount) {
        return rightClip.likeCount - leftClip.likeCount;
      }

      return sortTimestampsDescending(leftClip.created_at, rightClip.created_at);
    })
    .slice(0, 6);

  const verificationQueue = accountRows
    .filter((profile) => !profile.verified && profile.follower_count >= VERIFICATION_FOLLOWER_THRESHOLD)
    .sort((leftProfile, rightProfile) => rightProfile.follower_count - leftProfile.follower_count)
    .slice(0, 12)
    .map((profile) => ({
      ...profile,
      displayLabel: profile.display_name || profile.email || creatorFallbackLabel(profile.id)
    }));

  const activeCreators = accountRows.filter((creator) => {
    const activityAt = mostRecentTimestamp([creator.last_seen_at, creator.created_at]);
    return Boolean(activityAt) && new Date(activityAt).getTime() >= new Date(weekAgo).getTime();
  }).length;

  return {
    stats: {
      creators: Math.max(profilesResult.count, authUsersResult.count, firebaseAuthUsersResult.count, firestoreUsersResult.count, firestoreInstallationsResult.count, accountRows.length),
      publicClips: publicClipsResult.count,
      comments: totalFirebaseCommentCount,
      subscriptions: Math.max(subscriptionsResult.count, firestoreBillingCustomersResult.count),
      payments: firestoreBillingOrdersResult.count,
      verifiedCreators: accountRows.filter((profile) => profile.verified).length,
      proUsers: accountRows.filter((profile) => normalizeText(profile.subscriptionTier).toLowerCase() === "pro").length,
      activeCreators,
      pendingVerification: verificationQueue.length
    },
    accounts: enrichedAccountRows,
    recentProfiles: enrichedAccountRows,
    recentClips,
    verificationQueue,
    recentComments,
    topClips
  };
}