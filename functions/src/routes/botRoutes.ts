import { Router } from "express";
import { API_SERVICE_NAME } from "../config";
import { requireBotAuth } from "../middleware/authMiddleware";
import { lookupBillingOrderByOrderId } from "../services/billingService";
import {
  BOT_COMMUNITY_CAPABILITIES,
  claimBotTicket,
  closeBotTicket,
  createBotGiveaway,
  createBotPoll,
  drawBotGiveawayWinners,
  enterBotGiveaway,
  getBotGiveaway,
  getBotPoll,
  getBotTicketByChannel,
  openBotTicket,
  voteBotPoll
} from "../services/botCommunityService";
import {
  BOT_API_CAPABILITIES,
  linkDiscord,
  unlinkDiscord,
  listTrackedInstallations,
  lookupAccount,
  setAccountAdmin,
  setAccountStatus,
  setAccountSubscription,
  grantAccountFeature,
  revokeAccountFeature,
  getBotConfig,
  setBotConfig,
} from "../services/accountService";

export function createBotRoutes(): Router {
  const router = Router();

  router.get("/bot/health", (_request, response) => {
    response.json({
      ok: true,
      service: API_SERVICE_NAME,
      capabilities: [...BOT_API_CAPABILITIES, ...BOT_COMMUNITY_CAPABILITIES]
    });
  });

  router.get("/bot/session/validate", requireBotAuth, (_request, response) => {
    response.json({ ok: true });
  });

  router.get("/bot/config", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await getBotConfig(request.query as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/config", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await setBotConfig(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/installations", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await listTrackedInstallations(request.query as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/users/lookup", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await lookupAccount(request.query as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/orders/lookup", requireBotAuth, async (request, response, next) => {
    try {
      const orderId = String(request.query.orderId || "").trim();
      response.json(await lookupBillingOrderByOrderId({ orderId }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/users/link-discord", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await linkDiscord(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/users/admin", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await setAccountAdmin(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/users/status", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await setAccountStatus(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/users/subscription", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await setAccountSubscription(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/users/grant-feature", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await grantAccountFeature(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/users/revoke-feature", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await revokeAccountFeature(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/discord-link/start", requireBotAuth, async (request, response, next) => {
    try {
      const body = request.body as Record<string, unknown>;
      const discordUserId = String(body.discordUserId || "").trim();
      const discordUsername = String(body.discordUsername || "").trim();
      const appUuid = String(body.appUuid || "").trim();
      const email = String(body.email || "").trim();
      const userId = String(body.userId || "").trim();

      if (!discordUserId || !discordUsername) {
        response.status(400).json({ error: "discordUserId and discordUsername are required." });
        return;
      }

      const lookup: Record<string, unknown> = { discordUserId };
      if (appUuid) lookup.appUuid = appUuid;
      if (email) lookup.email = email;
      if (userId) lookup.userId = userId;

      const result = await linkDiscord({ ...lookup, discordUserId, discordUsername });
      response.json({ ok: true, linkURL: "", user: result.user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/unlink-discord", requireBotAuth, async (request, response, next) => {
    try {
      const body = request.body as Record<string, unknown>;
      const discordUserId = String(body.discordUserId || "").trim();
      if (!discordUserId) {
        response.status(400).json({ error: "discordUserId is required." });
        return;
      }
      const result = await unlinkDiscord({ discordUserId });
      response.json({ ok: true, user: result.user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/tickets/open", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await openBotTicket(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/tickets/by-channel", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await getBotTicketByChannel(request.query as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/tickets/claim", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await claimBotTicket(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/tickets/close", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await closeBotTicket(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/giveaways/create", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await createBotGiveaway(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/giveaways/enter", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await enterBotGiveaway(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/giveaways/draw", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await drawBotGiveawayWinners(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/giveaways/:messageId", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await getBotGiveaway({ messageId: request.params.messageId }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/polls/create", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await createBotPoll(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.post("/bot/polls/vote", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await voteBotPoll(request.body as Record<string, unknown>));
    } catch (error) {
      next(error);
    }
  });

  router.get("/bot/polls/:messageId", requireBotAuth, async (request, response, next) => {
    try {
      response.json(await getBotPoll({ messageId: request.params.messageId }));
    } catch (error) {
      next(error);
    }
  });

  return router;
}