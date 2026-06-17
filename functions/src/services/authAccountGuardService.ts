import { supabaseServiceRoleKey, supabaseURL } from "../config";
import { ApiError } from "../middleware/errorHandler";

const SUPABASE_TIMEOUT_MS = 12000;
const OWNER_EMAIL = "meteoritecontentman@gmail.com";

interface ProfileRow {
  id?: unknown;
  email?: unknown;
  created_at?: unknown;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

async function supabaseAdminRequest(path: string, options: { method?: string } = {}): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const serviceRoleKey = supabaseServiceRoleKey();
  if (!serviceRoleKey) {
    return { ok: false, status: 503, payload: { message: "Supabase service role key is missing." } };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(new URL(path, `${supabaseURL()}/`).toString(), {
      method: options.method || "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
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

async function fetchProfilesByEmail(email: string): Promise<Array<{ id: string; email: string; created_at: string }>> {
  const serviceRoleKey = supabaseServiceRoleKey();
  if (!serviceRoleKey) {
    throw new ApiError(503, "Supabase service role key is missing.");
  }

  const requestURL = new URL("/rest/v1/profiles", `${supabaseURL()}/`);
  requestURL.searchParams.set("select", "id,email,created_at");
  requestURL.searchParams.set("email", `eq.${email}`);
  requestURL.searchParams.set("order", "created_at.asc");
  requestURL.searchParams.set("limit", "100");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

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

    const payload = await response.json().catch(() => []);
    if (!response.ok) {
      throw new ApiError(response.status || 500, "Could not query profile duplicates.");
    }

    return (Array.isArray(payload) ? payload : [])
      .map((row) => ({
        id: normalizeText((row as ProfileRow).id),
        email: normalizeEmail((row as ProfileRow).email),
        created_at: normalizeText((row as ProfileRow).created_at)
      }))
      .filter((row) => row.id && row.email);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function enforceSingleAccountPerEmail(input: { userId: string; email: string }): Promise<{
  checked: boolean;
  ownerSkipped: boolean;
  duplicateCount: number;
  deletedAccountIds: string[];
  currentDeleted: boolean;
  keeperAccountId: string;
}> {
  const userId = normalizeText(input.userId);
  const email = normalizeEmail(input.email);
  if (!userId || !email) {
    throw new ApiError(400, "userId and email are required.");
  }

  if (email === normalizeEmail(OWNER_EMAIL)) {
    return {
      checked: true,
      ownerSkipped: true,
      duplicateCount: 0,
      deletedAccountIds: [],
      currentDeleted: false,
      keeperAccountId: userId
    };
  }

  const profiles = await fetchProfilesByEmail(email);
  if (profiles.length <= 1) {
    return {
      checked: true,
      ownerSkipped: false,
      duplicateCount: 0,
      deletedAccountIds: [],
      currentDeleted: false,
      keeperAccountId: profiles[0]?.id || userId
    };
  }

  const sortedProfiles = profiles.sort((leftProfile, rightProfile) => {
    return new Date(leftProfile.created_at || 0).getTime() - new Date(rightProfile.created_at || 0).getTime();
  });
  const keeper = sortedProfiles.find((profile) => profile.id === userId) ? sortedProfiles[0] : sortedProfiles[0];
  const toDelete = sortedProfiles.filter((profile) => profile.id !== keeper.id);
  const deletedAccountIds: string[] = [];

  for (const profile of toDelete) {
    const deleteProfileResult = await supabaseAdminRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
      method: "DELETE"
    });
    if (deleteProfileResult.ok) {
      deletedAccountIds.push(profile.id);
    }

    await supabaseAdminRequest(`/auth/v1/admin/users/${encodeURIComponent(profile.id)}`, {
      method: "DELETE"
    });
  }

  return {
    checked: true,
    ownerSkipped: false,
    duplicateCount: toDelete.length,
    deletedAccountIds,
    currentDeleted: toDelete.some((profile) => profile.id === userId),
    keeperAccountId: keeper.id
  };
}