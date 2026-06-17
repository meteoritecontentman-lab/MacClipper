import { supabasePublishableKey, supabaseURL } from "../config";
import { ApiError } from "../middleware/errorHandler";

const SUPABASE_AUTH_TIMEOUT_MS = 5000;

interface SupabaseAuthUserPayload {
  id?: unknown;
  email?: unknown;
}

export interface VerifiedSupabaseUser {
  id: string;
  email: string;
}

export async function verifySupabaseAccessToken(accessToken: string): Promise<VerifiedSupabaseUser> {
  const normalizedAccessToken = String(accessToken || "").trim();
  if (!normalizedAccessToken) {
    throw new ApiError(401, "Missing Supabase access token.");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, SUPABASE_AUTH_TIMEOUT_MS);

  try {
    const response = await fetch(new URL("/auth/v1/user", `${supabaseURL()}/`).toString(), {
      method: "GET",
      headers: {
        apikey: supabasePublishableKey(),
        Authorization: `Bearer ${normalizedAccessToken}`,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const rawBody = await response.text();
    const payload = rawBody ? safeParseJSON(rawBody) : {};

    if (!response.ok) {
      const body = payload && typeof payload === "object"
        ? payload as Record<string, unknown>
        : {};
      const message = normalizeText(body.msg) || normalizeText(body.message) || normalizeText(body.error) || "Supabase authentication failed.";
      throw new ApiError(response.status || 401, message, body);
    }

    const user = payload && typeof payload === "object"
      ? payload as SupabaseAuthUserPayload
      : {};
    const userId = normalizeText(user.id);

    if (!userId) {
      throw new ApiError(401, "Supabase authentication failed.");
    }

    return {
      id: userId,
      email: normalizeText(user.email)
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, `Supabase authentication timed out after ${SUPABASE_AUTH_TIMEOUT_MS}ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function safeParseJSON(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { error: value };
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}