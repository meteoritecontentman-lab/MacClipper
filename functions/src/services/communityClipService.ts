import { supabasePublishableKey, supabaseURL } from "../config";
import { ApiError } from "../middleware/errorHandler";

const SUPABASE_TIMEOUT_MS = 10000;

interface PublishCommunityClipInput {
  accessToken: string;
  userId: string;
  content: string;
  title: string;
  description: string;
  gameTitle: string;
  categoryLabel: string;
}

interface PublishCommunityClipResult {
  mode: "inserted" | "updated" | "already-public";
  clip: Record<string, unknown> | null;
}

interface SupabaseRESTResult {
  ok: boolean;
  status: number;
  payload: unknown;
}

export async function publishCommunityClip(input: PublishCommunityClipInput): Promise<PublishCommunityClipResult> {
  const duplicateSearch = new URLSearchParams();
  duplicateSearch.set("select", "id,visibility,owner_profile_id");
  duplicateSearch.set("user_id", `eq.${input.userId}`);
  duplicateSearch.set("content", `eq.${input.content}`);
  duplicateSearch.set("order", "created_at.desc");
  duplicateSearch.set("limit", "1");

  const duplicateResult = await performSupabaseRESTRequest({
    accessToken: input.accessToken,
    method: "GET",
    path: `/clips?${duplicateSearch.toString()}`
  });

  if (!duplicateResult.ok) {
    throw toApiError(duplicateResult, "Could not check for an existing community clip.");
  }

  const duplicateRows = Array.isArray(duplicateResult.payload) ? duplicateResult.payload : [];
  const duplicate = (duplicateRows[0] ?? null) as Record<string, unknown> | null;

  if (duplicate) {
    const visibility = normalizeText(duplicate.visibility);
    if (visibility === "public") {
      return {
        mode: "already-public",
        clip: duplicate
      };
    }

    const duplicateId = normalizeText(duplicate.id);
    const updatePayload: Record<string, unknown> = {
      title: input.title,
      description: input.description,
      visibility: "public",
      game_title: input.gameTitle,
      category_label: input.categoryLabel
    };

    const ownerProfileId = normalizeText(duplicate.owner_profile_id);
    if (ownerProfileId) {
      updatePayload.owner_profile_id = ownerProfileId;
    }

    const updateResult = await performSupabaseRESTRequest({
      accessToken: input.accessToken,
      method: "PATCH",
      path: `/clips?id=eq.${encodeURIComponent(duplicateId)}&user_id=eq.${encodeURIComponent(input.userId)}`,
      body: updatePayload,
      returnRepresentation: true
    });

    if (!updateResult.ok && isSchemaError(updateResult.payload)) {
      const fallbackUpdateResult = await performSupabaseRESTRequest({
        accessToken: input.accessToken,
        method: "PATCH",
        path: `/clips?id=eq.${encodeURIComponent(duplicateId)}&user_id=eq.${encodeURIComponent(input.userId)}`,
        body: { visibility: "public" },
        returnRepresentation: true
      });

      if (!fallbackUpdateResult.ok) {
        throw toApiError(fallbackUpdateResult, "Could not publish the existing community clip.");
      }

      return {
        mode: "updated",
        clip: Array.isArray(fallbackUpdateResult.payload)
          ? ((fallbackUpdateResult.payload[0] as Record<string, unknown> | undefined) ?? duplicate)
          : duplicate
      };
    }

    if (!updateResult.ok) {
      throw toApiError(updateResult, "Could not publish the existing community clip.");
    }

    return {
      mode: "updated",
      clip: Array.isArray(updateResult.payload)
        ? ((updateResult.payload[0] as Record<string, unknown> | undefined) ?? duplicate)
        : duplicate
    };
  }

  const insertPayload: Record<string, unknown> = {
    content: input.content,
    user_id: input.userId,
    title: input.title,
    description: input.description,
    visibility: "public",
    game_title: input.gameTitle,
    category_label: input.categoryLabel
  };

  const primaryInsertResult = await performSupabaseRESTRequest({
    accessToken: input.accessToken,
    method: "POST",
    path: "/clips",
    body: [insertPayload],
    returnRepresentation: true
  });

  if (!primaryInsertResult.ok && isSchemaError(primaryInsertResult.payload)) {
    const minimalInsertResult = await performSupabaseRESTRequest({
      accessToken: input.accessToken,
      method: "POST",
      path: "/clips",
      body: [{ content: input.content, user_id: input.userId, visibility: "public" }],
      returnRepresentation: true
    });

    if (!minimalInsertResult.ok) {
      const bareInsertResult = await performSupabaseRESTRequest({
        accessToken: input.accessToken,
        method: "POST",
        path: "/clips",
        body: [{ content: input.content, user_id: input.userId }],
        returnRepresentation: true
      });

      if (!bareInsertResult.ok) {
        throw toApiError(bareInsertResult, "Could not create the community clip.");
      }

      return {
        mode: "inserted",
        clip: Array.isArray(bareInsertResult.payload)
          ? ((bareInsertResult.payload[0] as Record<string, unknown> | undefined) ?? null)
          : null
      };
    }

    return {
      mode: "inserted",
      clip: Array.isArray(minimalInsertResult.payload)
        ? ((minimalInsertResult.payload[0] as Record<string, unknown> | undefined) ?? null)
        : null
    };
  }

  if (!primaryInsertResult.ok) {
    throw toApiError(primaryInsertResult, "Could not create the community clip.");
  }

  return {
    mode: "inserted",
    clip: Array.isArray(primaryInsertResult.payload)
      ? ((primaryInsertResult.payload[0] as Record<string, unknown> | undefined) ?? null)
      : null
  };
}

async function performSupabaseRESTRequest(input: {
  accessToken: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
  returnRepresentation?: boolean;
}): Promise<SupabaseRESTResult> {
  const requestURL = new URL(`/rest/v1${input.path}`, `${supabaseURL()}/`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(requestURL.toString(), {
      method: input.method,
      headers: {
        apikey: supabasePublishableKey(),
        Authorization: `Bearer ${input.accessToken}`,
        Accept: "application/json",
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(input.returnRepresentation ? { Prefer: "return=representation" } : {})
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal
    });

    const rawBody = await response.text();
    const payload = rawBody ? safeParseJSON(rawBody) : null;

    return {
      ok: response.ok,
      status: response.status,
      payload
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        status: 504,
        payload: {
          message: `Supabase request timed out after ${SUPABASE_TIMEOUT_MS}ms.`,
          code: "request_timeout"
        }
      };
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toApiError(result: SupabaseRESTResult, fallbackMessage: string): ApiError {
  const payload = result.payload && typeof result.payload === "object"
    ? result.payload as Record<string, unknown>
    : {};
  const message = normalizeText(payload.message) || normalizeText(payload.error) || fallbackMessage;

  return new ApiError(result.status || 500, message, payload);
}

function isSchemaError(payload: unknown): boolean {
  const body = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const message = normalizeText(body.message).toLowerCase();
  const code = normalizeText(body.code).toLowerCase();

  return code === "42703"
    || code === "42p01"
    || message.includes("column")
    || message.includes("does not exist")
    || message.includes("could not find the table");
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