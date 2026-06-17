import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import Busboy from "busboy";
import { type Request, Router } from "express";
import { botDiscordLinkedWebhookURL, botSharedSecret, macclipperDownloadURL, publicSiteURL } from "../config";
import { getFirestore } from "../firestore";
import { ApiError } from "../middleware/errorHandler";
import {
  createStripeCheckoutSession,
  createStripePortalSession,
  lookupBillingSubscription,
  processStripeWebhook,
  verifyAndFulfillCheckoutSession
} from "../services/billingService";
import {
  lookupAppUuidSummary, lookupAppLinkByWebsiteUserId, lookupEntitlements, registerAppLink, resolveAppInstallation, unlinkApp, linkDiscord
} from "../services/accountService";
import {
  createSharedClip,
  deleteSharedClip,
  getSharedClip,
  listSharedClips,
  resolveSharedClipLinksByVideoURLs,
  renderSharedClipPreviewPage,
  SHARED_CLIPS_COLLECTION
} from "../services/sharedClipService";
import { publishCommunityClip } from "../services/communityClipService";
import { getCommunityClipDislikeSummary, setCommunityClipDislike } from "../services/clipDislikeService";
import {
  assertAdminOwner,
  deleteAdminAccount,
  getAdminDashboardOverview,
  getAdminUnlistedClipsForAccount,
  setAdminAccountBanState
} from "../services/adminDashboardService";
import {
  createCommunityClipComment,
  getCommunityClipComments,
  getCommunityClipLikeSummary,
  setCommunityClipCommentReaction,
  setCommunityClipLike
} from "../services/clipSocialService";
import { getCommunityClipViewCount, recordCommunityClipView } from "../services/clipViewService";
import { getCommunityClipViewCounts } from "../services/clipViewService";
import { verifySupabaseAccessToken } from "../services/supabaseAuthService";
import { enforceSingleAccountPerEmail } from "../services/authAccountGuardService";

const MAX_SHARED_CLIP_FILE_SIZE = 200 * 1024 * 1024;
const DEFAULT_SHARED_CLIP_LIMIT = 48;

interface ParsedSharedClipUpload {
  fields: Record<string, unknown>;
  file?: {
    temporaryFilePath: string;
    originalName: string;
    mimeType: string;
    size: number;
  };
}

export function createPublicRoutes(): Router {
  const router = Router();

  router.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID");

    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }

    next();
  });

  router.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  router.post("/auth/enforce-single-account", async (request, response, next) => {
    try {
      const accessToken = extractBearerToken(request);
      const verifiedUser = await verifySupabaseAccessToken(accessToken);

      const result = await enforceSingleAccountPerEmail({
        userId: verifiedUser.id,
        email: verifiedUser.email
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/downloads/macclipper/latest", async (_request, response, next) => {
    try {
      const sourceURL = macclipperDownloadURL();
      if (!sourceURL) {
        throw new ApiError(503, "Download source is not configured.");
      }

      const upstream = await fetch(sourceURL);
      if (!upstream.ok) {
        throw new ApiError(upstream.status || 502, `Could not fetch app binary (HTTP ${upstream.status}).`);
      }

      const payload = Buffer.from(await upstream.arrayBuffer());
      const sourcePath = new URL(sourceURL).pathname;
      const fileName = sourcePath.split("/").pop() || "MacClipper.dmg";

      response.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
      response.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);
      response.setHeader("Cache-Control", "public, max-age=300");
      response.status(200).send(payload);
    } catch (error) {
      next(error);
    }
  });

  router.post("/billing/create-checkout-session", async (request, response, next) => {
    try {
      const websiteUserId = normalizeRequestText(request.body?.websiteUserId);
      const email = normalizeRequestText(request.body?.email);
      const result = await createStripeCheckoutSession({
        websiteUserId,
        email,
        origin: buildRequestOrigin(request)
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/billing/create-portal-session", async (request, response, next) => {
    try {
      const websiteUserId = normalizeRequestText(request.body?.websiteUserId);
      const result = await createStripePortalSession({
        websiteUserId,
        origin: buildRequestOrigin(request)
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/billing/webhook", async (request, response, next) => {
    try {
      const signatureHeader = normalizeRequestText(request.headers["stripe-signature"]);
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from("");

      const result = await processStripeWebhook(rawBody, signatureHeader);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/billing/verify-checkout", async (request, response, next) => {
    try {
      const sessionId = normalizeRequestText(request.body?.sessionId);
      const websiteUserId = normalizeRequestText(request.body?.websiteUserId);
      const result = await verifyAndFulfillCheckoutSession({ sessionId, websiteUserId });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/billing/subscription", async (request, response, next) => {
    try {
      const websiteUserId = normalizeRequestText(request.query?.websiteUserId as string);
      const result = await lookupBillingSubscription({ websiteUserId });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/app-installations/resolve", async (request, response, next) => {
    try {
      const result = await resolveAppInstallation(request.body as Record<string, unknown>);
      response.status(result.created ? 201 : 200).json({ installation: result.installation });
    } catch (error) {
      next(error);
    }
  });

  router.post("/app-link", async (request, response, next) => {
    try {
      await registerAppLink(request.body as Record<string, unknown>);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.delete("/app-link", async (request, response, next) => {
    try {
      await unlinkApp(request.body as Record<string, unknown>);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/app-link/unlink", async (request, response, next) => {
    try {
      await unlinkApp(request.body as Record<string, unknown>);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.post("/discord-link/start", async (request, response, next) => {
    try {
      const accessToken = extractBearerToken(request);
      if (!accessToken) {
        throw new ApiError(401, "Missing Supabase access token.");
      }

      const verifiedUser = await verifySupabaseAccessToken(accessToken);
      const discordUserId = String(request.body?.discordUserId || "").trim();
      const discordUsername = String(request.body?.discordUsername || "").trim();

      if (!discordUserId || !discordUsername) {
        throw new ApiError(400, "discordUserId and discordUsername are required.");
      }

      // Find the user's linked Mac app
      const linkStatus = await lookupAppLinkByWebsiteUserId({ websiteUserId: verifiedUser.id });
      const appUuid = linkStatus.appUuid;

      let result;
      if (!appUuid) {
        // No linked app yet — create a UserRecord from the Supabase user
        result = await linkDiscord({
          userId: verifiedUser.id,
          email: verifiedUser.email,
          discordUserId,
          discordUsername,
        });
      } else {
        // Link Discord to the app installation
        result = await linkDiscord({
          appUuid,
          discordUserId,
          discordUsername,
        });
      }

      // Notify the bot webhook so it sends a DM (non-blocking)
      const webhookUrl = botDiscordLinkedWebhookURL();
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${botSharedSecret()}`,
          },
          body: JSON.stringify({ discordUserId, discordUsername }),
        }).catch(() => {});
      }

      response.json({ ok: true, user: result.user });
    } catch (error) {
      next(error);
    }
  });

  router.get("/link-status", async (request, response, next) => {
    try {
      const result = await lookupAppLinkByWebsiteUserId(request.query as Record<string, unknown>);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/entitlements/by-user-id", async (request, response, next) => {
    try {
      const result = await lookupEntitlements(request.query as Record<string, unknown>);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/account-summary", async (request, response, next) => {
    try {
      const result = await lookupAppUuidSummary(request.query as Record<string, unknown>);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/shared-clips", async (request, response, next) => {
    try {
      const appUuid = normalizeQueryText(request.query.appUuid);
      const websiteUserId = normalizeQueryText(request.query.websiteUserId);

      if ((appUuid ? 1 : 0) + (websiteUserId ? 1 : 0) != 1) {
        response.status(400).json({ error: "Provide exactly one of appUuid or websiteUserId." });
        return;
      }

      const shares = await listSharedClips({
        appUuid: appUuid || undefined,
        websiteUserId: websiteUserId || undefined,
        ...buildSharedClipURLContext(request)
      });

      response.json({ shares });
    } catch (error) {
      next(error);
    }
  });

  router.post("/shared-clips", async (request, response, next) => {
    try {
      const parsedUpload = await parseSharedClipUpload(request);

      if (!parsedUpload.file) {
        response.status(400).json({ error: "Attach a clip file first." });
        return;
      }

      const share = await createSharedClip({
        fields: parsedUpload.fields,
        file: parsedUpload.file,
        ...buildSharedClipURLContext(request)
      });

      response.status(201).json({ share });
    } catch (error) {
      next(error);
    }
  });

  router.get("/shared-clips/stream", async (request, response, next) => {
    try {
      const appUuid = normalizeQueryText(request.query.appUuid);
      const websiteUserId = normalizeQueryText(request.query.websiteUserId);

      if ((appUuid ? 1 : 0) + (websiteUserId ? 1 : 0) != 1) {
        response.status(400).json({ error: "Provide exactly one of appUuid or websiteUserId." });
        return;
      }

      const urlContext = buildSharedClipURLContext(request);
      response.status(200);
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      if (typeof response.flushHeaders === "function") {
        response.flushHeaders();
      }

      let isClosed = false;
      let unsubscribe: (() => void) | undefined;

      const sendShares = async () => {
        if (isClosed) {
          return;
        }

        const shares = await listSharedClips({
          appUuid: appUuid || undefined,
          websiteUserId: websiteUserId || undefined,
          ...urlContext,
          limit: DEFAULT_SHARED_CLIP_LIMIT
        });

        response.write(`event: shares\ndata: ${JSON.stringify({ shares })}\n\n`);
      };

      const keepAliveId = setInterval(() => {
        if (!isClosed) {
          response.write("event: ping\ndata: {}\n\n");
        }
      }, 25000);

      const cleanup = () => {
        if (isClosed) {
          return;
        }

        isClosed = true;
        clearInterval(keepAliveId);
        unsubscribe?.();
        response.end();
      };

      request.on("close", cleanup);
      request.on("aborted", cleanup);
      response.on("close", cleanup);

      await sendShares();

      const query = buildSharedClipRealtimeQuery({
        appUuid: appUuid || undefined,
        websiteUserId: websiteUserId || undefined,
        limit: DEFAULT_SHARED_CLIP_LIMIT
      });

      unsubscribe = query.onSnapshot(() => {
        void sendShares();
      }, (error) => {
        if (!isClosed) {
          const message = error instanceof Error ? error.message : "Shared clip stream failed.";
          response.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        }
        cleanup();
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/shared-clips/wait", async (request, response, next) => {
    try {
      const appUuid = normalizeQueryText(request.query.appUuid);
      const websiteUserId = normalizeQueryText(request.query.websiteUserId);

      if ((appUuid ? 1 : 0) + (websiteUserId ? 1 : 0) != 1) {
        response.status(400).json({ error: "Provide exactly one of appUuid or websiteUserId." });
        return;
      }

      const knownIds = normalizeKnownIds(request.query.knownIds);
      const urlContext = buildSharedClipURLContext(request);
      const queryInput = {
        appUuid: appUuid || undefined,
        websiteUserId: websiteUserId || undefined,
        ...urlContext,
        limit: DEFAULT_SHARED_CLIP_LIMIT
      };

      const currentShares = await listSharedClips(queryInput);
      if (didSharedClipSetChange(currentShares, knownIds)) {
        response.json({ shares: currentShares, changed: true });
        return;
      }

      let finished = false;
      let unsubscribe: (() => void) | undefined;

      const finish = async (changed: boolean) => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeoutId);
        unsubscribe?.();

        const shares = await listSharedClips(queryInput);
        response.json({ shares, changed });
      };

      const timeoutId = setTimeout(() => {
        void finish(false);
      }, 55000);

      request.on("close", () => {
        if (finished) {
          return;
        }

        finished = true;
        clearTimeout(timeoutId);
        unsubscribe?.();
      });

      const query = buildSharedClipRealtimeQuery({
        appUuid: appUuid || undefined,
        websiteUserId: websiteUserId || undefined,
        limit: DEFAULT_SHARED_CLIP_LIMIT
      });

      unsubscribe = query.onSnapshot(async () => {
        const shares = await listSharedClips(queryInput);
        if (didSharedClipSetChange(shares, knownIds)) {
          void finish(true);
        }
      }, (error) => {
        if (!finished) {
          finished = true;
          clearTimeout(timeoutId);
          unsubscribe?.();
          next(error);
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/shared-clips/resolve-links", async (request, response, next) => {
    try {
      const rawVideoURLs = Array.isArray(request.body?.videoURLs)
        ? request.body.videoURLs
        : [];

      const videoURLs = rawVideoURLs
        .map((value: unknown) => normalizeRequestText(value))
        .filter(Boolean)
        .slice(0, 120);

      if (videoURLs.length === 0) {
        response.json({ linksByVideoURL: {} });
        return;
      }

      const linksByVideoURL = await resolveSharedClipLinksByVideoURLs({
        videoURLs,
        ...buildSharedClipURLContext(request)
      });

      response.json({ linksByVideoURL });
    } catch (error) {
      next(error);
    }
  });

  router.post("/community-clips/publish", async (request, response, next) => {
    try {
      const accessToken = extractBearerToken(request);
      if (!accessToken) {
        throw new ApiError(401, "Missing Supabase access token.");
      }

      const result = await publishCommunityClip({
        accessToken,
        userId: normalizeRequestText(request.body?.userId),
        content: normalizeRequestText(request.body?.content),
        title: normalizeRequestText(request.body?.title),
        description: normalizeRequestText(request.body?.description),
        gameTitle: normalizeRequestText(request.body?.gameTitle),
        categoryLabel: normalizeRequestText(request.body?.categoryLabel)
      });

      response.status(result.mode === "inserted" ? 201 : 200).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/community-overview", async (request, response, next) => {
    try {
      const accessToken = extractBearerToken(request);
      const verifiedUser = await verifySupabaseAccessToken(accessToken);
      assertAdminOwner(verifiedUser);
      const overview = await getAdminDashboardOverview();
      response.json(overview);
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/accounts/:accountId/ban", async (request, response, next) => {
    try {
      const accessToken = extractBearerToken(request);
      const verifiedUser = await verifySupabaseAccessToken(accessToken);
      assertAdminOwner(verifiedUser);

      const accountId = normalizeRequestText(request.params.accountId);
      const enabled = request.body?.enabled !== false;
      const accountType = normalizeRequestText(request.body?.accountType) === "app" ? "app" : "website";
      const appUuid = normalizeRequestText(request.body?.appUuid);
      const email = normalizeRequestText(request.body?.email);

      const result = await setAdminAccountBanState({
        accountId,
        accountType,
        enabled: Boolean(enabled),
        appUuid,
        email
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/accounts/:accountId", async (request, response, next) => {
    try {
      const accessToken = extractBearerToken(request);
      const verifiedUser = await verifySupabaseAccessToken(accessToken);
      assertAdminOwner(verifiedUser);

      const accountId = normalizeRequestText(request.params.accountId);
      const accountType = normalizeQueryText(request.query.accountType) === "app" ? "app" : "website";
      const appUuid = normalizeQueryText(request.query.appUuid);
      const email = normalizeQueryText(request.query.email);

      const result = await deleteAdminAccount({
        accountId,
        accountType,
        appUuid,
        email
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/accounts/:accountId/unlisted-clips", async (request, response, next) => {
    try {
      const accessToken = extractBearerToken(request);
      const verifiedUser = await verifySupabaseAccessToken(accessToken);
      assertAdminOwner(verifiedUser);

      const accountId = normalizeRequestText(request.params.accountId);
      const appUuid = normalizeQueryText(request.query.appUuid);
      const email = normalizeQueryText(request.query.email);

      const result = await getAdminUnlistedClipsForAccount({
        accountId,
        appUuid,
        email
      });

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/community-clips/:clipId/views", async (request, response, next) => {
    try {
      const clipId = normalizeRequestText(request.params.clipId);
      const viewCount = await getCommunityClipViewCount(clipId);
      response.json({ clipId, viewCount });
    } catch (error) {
      next(error);
    }
  });

  router.post("/community-clips/:clipId/views", async (request, response, next) => {
    try {
      const clipId = normalizeRequestText(request.params.clipId);
      const viewCount = await recordCommunityClipView(clipId);
      response.status(201).json({ clipId, viewCount });
    } catch (error) {
      next(error);
    }
  });

  router.post("/community-clips/views/batch", async (request, response, next) => {
    try {
      const clipIds = Array.isArray(request.body?.clipIds)
        ? request.body.clipIds.map((value: unknown) => normalizeRequestText(value)).filter(Boolean)
        : [];
      const viewCounts = await getCommunityClipViewCounts(clipIds);
      response.json({ viewCounts });
    } catch (error) {
      next(error);
    }
  });

  router.get("/community-clips/:clipId/dislikes", async (request, response, next) => {
    try {
      const clipId = normalizeRequestText(request.params.clipId);
      const websiteUserId = normalizeQueryText(request.query.websiteUserId);
      const summary = await getCommunityClipDislikeSummary(clipId, websiteUserId || "");
      response.json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.post("/community-clips/:clipId/dislikes", async (request, response, next) => {
    try {
      const clipId = normalizeRequestText(request.params.clipId);
      const websiteUserId = normalizeRequestText(request.body?.websiteUserId);
      if (!websiteUserId) {
        throw new ApiError(400, "websiteUserId is required.");
      }

      const shouldDislike = request.body?.shouldDislike !== false;
      const summary = await setCommunityClipDislike(clipId, websiteUserId, Boolean(shouldDislike));
      response.status(201).json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.get("/community-clips/:clipId/likes", async (request, response, next) => {
    try {
      const clipId = normalizeRequestText(request.params.clipId);
      const websiteUserId = normalizeQueryText(request.query.websiteUserId);
      const summary = await getCommunityClipLikeSummary(clipId, websiteUserId || "");
      response.json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.post("/community-clips/:clipId/likes", async (request, response, next) => {
    try {
      const clipId = normalizeRequestText(request.params.clipId);
      const accessToken = extractBearerToken(request);
      const verifiedUser = await verifySupabaseAccessToken(accessToken);
      const shouldLike = request.body?.shouldLike !== false;
      const summary = await setCommunityClipLike(clipId, verifiedUser.id, Boolean(shouldLike));
      response.status(201).json(summary);
    } catch (error) {
      next(error);
    }
  });

  router.get("/community-clips/:clipId/comments", async (request, response, next) => {
    try {
      const clipId = normalizeRequestText(request.params.clipId);
      const parsedLimit = Number.parseInt(normalizeQueryText(request.query.limit), 10);
      const websiteUserId = normalizeQueryText(request.query.websiteUserId);
      const comments = await getCommunityClipComments(clipId, Number.isFinite(parsedLimit) ? parsedLimit : 24, websiteUserId || "");
      response.json(comments);
    } catch (error) {
      next(error);
    }
  });

  router.post("/community-clips/:clipId/comments", async (request, response, next) => {
    try {
      const clipId = normalizeRequestText(request.params.clipId);
      const accessToken = extractBearerToken(request);
      const verifiedUser = await verifySupabaseAccessToken(accessToken);
      const body = normalizeRequestText(request.body?.body);
      const result = await createCommunityClipComment(clipId, verifiedUser.id, body);
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/community-clips/:clipId/comments/:commentId/reactions", async (request, response, next) => {
    try {
      const clipId = normalizeRequestText(request.params.clipId);
      const commentId = normalizeRequestText(request.params.commentId);
      const accessToken = extractBearerToken(request);
      const verifiedUser = await verifySupabaseAccessToken(accessToken);
      const reaction = normalizeRequestText(request.body?.reaction);
      const result = await setCommunityClipCommentReaction(clipId, commentId, verifiedUser.id, reaction);
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/shared-clips/:shareId", async (request, response, next) => {
    try {
      await deleteSharedClip({
        shareId: request.params.shareId,
        appUuid: normalizeQueryText(request.query.appUuid) || undefined,
        websiteUserId: normalizeQueryText(request.query.websiteUserId) || undefined
      });

      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/shared-clips/:shareId.json", async (request, response, next) => {
    try {
      const share = await getSharedClip(
        request.params.shareId,
        buildSharedClipURLContext(request)
      );
      if (!share) {
        response.status(404).json({ error: "Clip not found." });
        return;
      }

      response.json({ share });
    } catch (error) {
      next(error);
    }
  });

  router.get("/shared-clips/:shareId", async (request, response, next) => {
    try {
      const share = await getSharedClip(
        request.params.shareId,
        buildSharedClipURLContext(request)
      );
      if (!share) {
        response.status(404).type("text/html").send("<h1>Clip not found.</h1>");
        return;
      }

      if (shouldRedirectSharedClipBrowserRequest(request)) {
        response.redirect(302, share.pageURL);
        return;
      }

      response.status(200).type("text/html; charset=utf-8").send(renderSharedClipPreviewPage(share));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function normalizeQueryText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0].trim();
  }

  return "";
}

function normalizeKnownIds(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => typeof item === "string" ? item.split(",") : []).map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function buildRequestOrigin(request: Request): string {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || request.protocol || "https")
    .split(",")[0]
    .trim();
  const forwardedHost = String(request.headers["x-forwarded-host"] || request.get("host") || "")
    .split(",")[0]
    .trim();

  return `${forwardedProto}://${forwardedHost}`;
}

function buildSharedClipURLContext(_request: Request): { pageBaseURL: string; shareBaseURL: string } {
  const sharedPageBaseURL = `${publicSiteURL()}/shared`;
  const sharedPreviewBaseURL = `${publicSiteURL()}/api/shared-clips`;

  return {
    pageBaseURL: sharedPageBaseURL,
    shareBaseURL: sharedPreviewBaseURL
  };
}

function buildSharedClipRealtimeQuery(input: {
  appUuid?: string;
  websiteUserId?: string;
  limit: number;
}) {
  let query: FirebaseFirestore.Query = getFirestore().collection(SHARED_CLIPS_COLLECTION).limit(input.limit);

  if (input.websiteUserId) {
    query = query.where("websiteUserId", "==", input.websiteUserId).limit(input.limit);
  } else {
    query = query.where("appUuid", "==", input.appUuid || "").limit(input.limit);
  }

  return query;
}

function normalizeRequestText(value: unknown): string {
  return String(value ?? "").trim();
}

function extractBearerToken(request: Request): string {
  const authorizationHeader = normalizeRequestText(request.headers.authorization);
  if (!authorizationHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authorizationHeader.slice(7).trim();
}

function shouldRedirectSharedClipBrowserRequest(request: Request): boolean {
  if (normalizeQueryText(request.query.preview) === "1") {
    return false;
  }

  const userAgent = normalizeRequestText(request.headers["user-agent"]);
  if (!userAgent) {
    return false;
  }

  const botPattern = /(bot|crawler|spider|discordbot|twitterbot|slackbot|facebookexternalhit|linkedinbot|embedly|telegrambot|whatsapp|skypeuripreview|googlebot|bingbot|redditbot|pinterest|applebot)/i;
  return !botPattern.test(userAgent);
}

function didSharedClipSetChange(shares: Array<{ id: string }>, knownIds: string[]): boolean {
  const nextIds = shares.map((share) => share.id).filter(Boolean);
  if (nextIds.length !== knownIds.length) {
    return true;
  }

  return nextIds.some((shareId, index) => shareId !== knownIds[index]);
}

async function parseSharedClipUpload(request: Request): Promise<ParsedSharedClipUpload> {
  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("multipart/form-data")) {
    throw new ApiError(400, "Clip uploads must use multipart form data.");
  }

  return await new Promise((resolve, reject) => {
    const fields: Record<string, unknown> = {};
    let file: ParsedSharedClipUpload["file"];
    let didReceiveFile = false;
    let didSettle = false;

    const settle = (callback: () => void) => {
      if (didSettle) {
        return;
      }

      didSettle = true;
      callback();
    };

    const parser = Busboy({
      headers: request.headers,
      limits: {
        files: 1,
        fileSize: MAX_SHARED_CLIP_FILE_SIZE,
        fields: 12
      }
    });

    parser.on("field", (fieldName, value) => {
      if (!(fieldName in fields)) {
        fields[fieldName] = value;
      }
    });

    parser.on("file", (fieldName, fileStream, info) => {
      if (fieldName != "file") {
        fileStream.resume();
        return;
      }

      if (didReceiveFile) {
        fileStream.resume();
        return;
      }

      didReceiveFile = true;
      let size = 0;
      let didHitSizeLimit = false;
      const pathExtension = path.extname(info.filename || "clip.mp4") || ".mp4";
      const temporaryFilePath = path.join(os.tmpdir(), `macclipper-shared-clip-${randomUUID()}${pathExtension}`);
      const temporaryFileStream = fs.createWriteStream(temporaryFilePath);

      temporaryFileStream.on("error", (error) => {
        const message = error instanceof Error ? error.message : "Could not stage the clip upload.";
        settle(() => {
          reject(new ApiError(500, message));
        });
      });

      fileStream.on("limit", () => {
        didHitSizeLimit = true;
        temporaryFileStream.destroy();
        void fs.promises.unlink(temporaryFilePath).catch(() => undefined);
      });

      fileStream.on("data", (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (!didHitSizeLimit) {
          temporaryFileStream.write(buffer);
        }
      });

      fileStream.on("end", () => {
        temporaryFileStream.end();

        if (didHitSizeLimit) {
          settle(() => {
            reject(new ApiError(413, "Clip uploads are limited to 200 MB."));
          });
          return;
        }

        file = {
          temporaryFilePath,
          originalName: info.filename || "clip.mp4",
          mimeType: info.mimeType || "application/octet-stream",
          size
        };
      });
    });

    parser.on("filesLimit", () => {
      settle(() => {
        reject(new ApiError(400, "Attach one clip at a time."));
      });
    });

    parser.on("error", (error) => {
      const message = error instanceof Error ? error.message : "Could not read the clip upload.";
      settle(() => {
        reject(new ApiError(400, message));
      });
    });

    parser.on("close", () => {
      settle(() => {
        resolve({ fields, file });
      });
    });

    const requestWithRawBody = request as Request & { rawBody?: Buffer };
    if (Buffer.isBuffer(requestWithRawBody.rawBody) && requestWithRawBody.rawBody.length > 0) {
      parser.end(requestWithRawBody.rawBody);
      return;
    }

    request.pipe(parser);
  });
}