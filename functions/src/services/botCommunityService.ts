import { getFirestore } from "../firestore";
import { ApiError } from "../middleware/errorHandler";

export const BOT_COMMUNITY_CAPABILITIES = [
  "tickets.open",
  "tickets.claim",
  "tickets.close",
  "tickets.lookup",
  "giveaways.create",
  "giveaways.enter",
  "giveaways.draw",
  "giveaways.lookup",
  "polls.create",
  "polls.vote",
  "polls.lookup"
] as const;

const BOT_TICKETS_COLLECTION = "botTickets";
const BOT_GIVEAWAYS_COLLECTION = "botGiveaways";
const BOT_POLLS_COLLECTION = "botPolls";

type TicketStatus = "open" | "claimed" | "closed";
type GiveawayStatus = "active" | "ended";
type PollStatus = "open" | "closed";

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nonEmpty(value: unknown, label: string): string {
  const normalized = text(value);
  if (!normalized) {
    throw new ApiError(400, `${label} is required.`);
  }

  return normalized;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(text(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function collection(name: string) {
  return getFirestore().collection(name);
}

function ticketReference(ticketChannelId: string) {
  return collection(BOT_TICKETS_COLLECTION).doc(ticketChannelId);
}

function giveawayReference(messageId: string) {
  return collection(BOT_GIVEAWAYS_COLLECTION).doc(messageId);
}

function pollReference(messageId: string) {
  return collection(BOT_POLLS_COLLECTION).doc(messageId);
}

function pickRandomWinners(userIds: string[], winnerCount: number): string[] {
  const pool = [...userIds];
  const winners: string[] = [];
  while (pool.length > 0 && winners.length < winnerCount) {
    const index = Math.floor(Math.random() * pool.length);
    const [picked] = pool.splice(index, 1);
    if (picked) {
      winners.push(picked);
    }
  }

  return winners;
}

export async function openBotTicket(input: Record<string, unknown>) {
  const ticketChannelId = nonEmpty(input.ticketChannelId, "ticketChannelId");
  const now = nowIso();
  const reference = ticketReference(ticketChannelId);
  const existing = await reference.get();

  if (existing.exists) {
    return {
      ticket: {
        id: existing.id,
        ...(existing.data() || {})
      }
    };
  }

  const payload = {
    guildId: nonEmpty(input.guildId, "guildId"),
    channelId: nonEmpty(input.channelId, "channelId"),
    categoryId: text(input.categoryId),
    ticketChannelId,
    ownerUserId: nonEmpty(input.ownerUserId, "ownerUserId"),
    ownerUsername: text(input.ownerUsername),
    createdByUserId: nonEmpty(input.createdByUserId, "createdByUserId"),
    subject: text(input.subject),
    status: "open" as TicketStatus,
    claimerUserId: "",
    claimerUsername: "",
    createdAt: now,
    updatedAt: now,
    closedAt: ""
  };

  await reference.set(payload);
  return {
    ticket: {
      id: reference.id,
      ...payload
    }
  };
}

export async function getBotTicketByChannel(input: Record<string, unknown>) {
  const ticketChannelId = nonEmpty(input.ticketChannelId, "ticketChannelId");
  const snapshot = await ticketReference(ticketChannelId).get();
  if (!snapshot.exists) {
    throw new ApiError(404, "Ticket not found.");
  }

  return {
    ticket: {
      id: snapshot.id,
      ...(snapshot.data() || {})
    }
  };
}

export async function claimBotTicket(input: Record<string, unknown>) {
  const ticketChannelId = nonEmpty(input.ticketChannelId, "ticketChannelId");
  const claimerUserId = nonEmpty(input.claimerUserId, "claimerUserId");
  const claimerUsername = text(input.claimerUsername);
  const reference = ticketReference(ticketChannelId);

  const ticket = await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) {
      throw new ApiError(404, "Ticket not found.");
    }

    const data = snapshot.data() || {};
    const status = text(data.status) as TicketStatus;
    const existingClaimer = text(data.claimerUserId);

    if (status === "closed") {
      throw new ApiError(409, "Ticket is already closed.");
    }

    if (existingClaimer && existingClaimer !== claimerUserId) {
      throw new ApiError(409, "Ticket is already claimed by another staff member.");
    }

    const updated = {
      ...data,
      status: "claimed" as TicketStatus,
      claimerUserId,
      claimerUsername,
      updatedAt: nowIso()
    };

    transaction.set(reference, updated, { merge: true });
    return {
      id: reference.id,
      ...updated
    };
  });

  return { ticket };
}

export async function closeBotTicket(input: Record<string, unknown>) {
  const ticketChannelId = nonEmpty(input.ticketChannelId, "ticketChannelId");
  const closedByUserId = nonEmpty(input.closedByUserId, "closedByUserId");
  const reference = ticketReference(ticketChannelId);

  const ticket = await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) {
      throw new ApiError(404, "Ticket not found.");
    }

    const data = snapshot.data() || {};
    const updated = {
      ...data,
      status: "closed" as TicketStatus,
      closedByUserId,
      closedByUsername: text(input.closedByUsername),
      closedReason: text(input.reason),
      closedAt: nowIso(),
      updatedAt: nowIso()
    };

    transaction.set(reference, updated, { merge: true });
    return {
      id: reference.id,
      ...updated
    };
  });

  return { ticket };
}

export async function createBotGiveaway(input: Record<string, unknown>) {
  const messageId = nonEmpty(input.messageId, "messageId");
  const winnerCount = Math.max(1, Math.min(10, positiveInt(input.winnerCount, 1)));
  const durationMinutes = Math.max(1, Math.min(60 * 24 * 14, positiveInt(input.durationMinutes, 60)));
  const now = Date.now();
  const endAt = new Date(now + (durationMinutes * 60 * 1000)).toISOString();
  const reference = giveawayReference(messageId);

  const payload = {
    guildId: nonEmpty(input.guildId, "guildId"),
    channelId: nonEmpty(input.channelId, "channelId"),
    messageId,
    prize: nonEmpty(input.prize, "prize"),
    winnerCount,
    durationMinutes,
    status: "active" as GiveawayStatus,
    createdByUserId: nonEmpty(input.createdByUserId, "createdByUserId"),
    createdByUsername: text(input.createdByUsername),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    endAt,
    winners: [] as string[]
  };

  await reference.set(payload, { merge: true });
  return { giveaway: { id: reference.id, ...payload }, participantCount: 0 };
}

export async function enterBotGiveaway(input: Record<string, unknown>) {
  const messageId = nonEmpty(input.messageId, "messageId");
  const userId = nonEmpty(input.userId, "userId");
  const reference = giveawayReference(messageId);
  const giveawaySnapshot = await reference.get();
  if (!giveawaySnapshot.exists) {
    throw new ApiError(404, "Giveaway not found.");
  }

  const giveaway = giveawaySnapshot.data() || {};
  if (text(giveaway.status) !== "active") {
    throw new ApiError(409, "Giveaway is no longer active.");
  }

  if (Date.now() >= new Date(text(giveaway.endAt)).getTime()) {
    throw new ApiError(409, "Giveaway has already ended.");
  }

  await reference.collection("entries").doc(userId).set({
    userId,
    username: text(input.username),
    joinedAt: nowIso()
  }, { merge: true });

  const entriesSnapshot = await reference.collection("entries").get();
  return {
    giveaway: {
      id: giveawaySnapshot.id,
      ...giveaway
    },
    participantCount: entriesSnapshot.size
  };
}

export async function getBotGiveaway(input: Record<string, unknown>) {
  const messageId = nonEmpty(input.messageId, "messageId");
  const reference = giveawayReference(messageId);
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    throw new ApiError(404, "Giveaway not found.");
  }

  const entriesSnapshot = await reference.collection("entries").get();
  return {
    giveaway: {
      id: snapshot.id,
      ...(snapshot.data() || {})
    },
    participantCount: entriesSnapshot.size
  };
}

export async function drawBotGiveawayWinners(input: Record<string, unknown>) {
  const messageId = nonEmpty(input.messageId, "messageId");
  const force = text(input.force) === "true" || input.force === true;
  const reference = giveawayReference(messageId);

  const result = await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) {
      throw new ApiError(404, "Giveaway not found.");
    }

    const giveaway = snapshot.data() || {};
    const status = text(giveaway.status) as GiveawayStatus;
    const alreadyWinners = Array.isArray(giveaway.winners)
      ? giveaway.winners.map((value) => text(value)).filter(Boolean)
      : [];

    if (status === "ended" && alreadyWinners.length > 0 && !force) {
      return {
        giveaway: {
          id: snapshot.id,
          ...giveaway
        },
        winners: alreadyWinners,
        participantCount: 0
      };
    }

    const entriesSnapshot = await reference.collection("entries").get();
    const participantIds = entriesSnapshot.docs
      .map((doc) => text(doc.data()?.userId || doc.id))
      .filter(Boolean);

    const winners = pickRandomWinners(participantIds, Math.max(1, positiveInt(giveaway.winnerCount, 1)));
    const updated = {
      ...giveaway,
      status: "ended" as GiveawayStatus,
      winners,
      endedByUserId: nonEmpty(input.endedByUserId, "endedByUserId"),
      endedByUsername: text(input.endedByUsername),
      endedAt: nowIso(),
      updatedAt: nowIso()
    };

    transaction.set(reference, updated, { merge: true });

    return {
      giveaway: {
        id: snapshot.id,
        ...updated
      },
      winners,
      participantCount: participantIds.length
    };
  });

  return result;
}

export async function createBotPoll(input: Record<string, unknown>) {
  const messageId = nonEmpty(input.messageId, "messageId");
  const options = Array.isArray(input.options)
    ? input.options.map((value) => text(value)).filter(Boolean)
    : [];

  if (options.length < 2) {
    throw new ApiError(400, "Poll requires at least two options.");
  }

  const reference = pollReference(messageId);
  const payload = {
    guildId: nonEmpty(input.guildId, "guildId"),
    channelId: nonEmpty(input.channelId, "channelId"),
    messageId,
    question: nonEmpty(input.question, "question"),
    options,
    status: "open" as PollStatus,
    createdByUserId: nonEmpty(input.createdByUserId, "createdByUserId"),
    createdByUsername: text(input.createdByUsername),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  await reference.set(payload, { merge: true });
  return {
    poll: {
      id: reference.id,
      ...payload
    },
    voteCounts: options.map(() => 0)
  };
}

async function pollVoteCounts(messageId: string, optionCount: number): Promise<number[]> {
  const snapshot = await pollReference(messageId).collection("votes").get();
  const counts = Array.from({ length: optionCount }, () => 0);
  snapshot.docs.forEach((documentSnapshot) => {
    const index = Number.parseInt(text(documentSnapshot.data()?.optionIndex), 10);
    if (Number.isFinite(index) && index >= 0 && index < counts.length) {
      counts[index] += 1;
    }
  });
  return counts;
}

export async function voteBotPoll(input: Record<string, unknown>) {
  const messageId = nonEmpty(input.messageId, "messageId");
  const userId = nonEmpty(input.userId, "userId");
  const optionIndex = Number.parseInt(nonEmpty(input.optionIndex, "optionIndex"), 10);
  const reference = pollReference(messageId);
  const pollSnapshot = await reference.get();

  if (!pollSnapshot.exists) {
    throw new ApiError(404, "Poll not found.");
  }

  const poll = pollSnapshot.data() || {};
  const options = Array.isArray(poll.options)
    ? poll.options.map((value: unknown) => text(value)).filter(Boolean)
    : [];

  if (text(poll.status) !== "open") {
    throw new ApiError(409, "Poll is closed.");
  }

  if (!Number.isFinite(optionIndex) || optionIndex < 0 || optionIndex >= options.length) {
    throw new ApiError(400, "Invalid poll option.");
  }

  await reference.collection("votes").doc(userId).set({
    userId,
    username: text(input.username),
    optionIndex,
    updatedAt: nowIso()
  }, { merge: true });

  const voteCounts = await pollVoteCounts(messageId, options.length);
  return {
    poll: {
      id: pollSnapshot.id,
      ...poll,
      options
    },
    voteCounts
  };
}

export async function getBotPoll(input: Record<string, unknown>) {
  const messageId = nonEmpty(input.messageId, "messageId");
  const reference = pollReference(messageId);
  const snapshot = await reference.get();

  if (!snapshot.exists) {
    throw new ApiError(404, "Poll not found.");
  }

  const poll = snapshot.data() || {};
  const options = Array.isArray(poll.options)
    ? poll.options.map((value: unknown) => text(value)).filter(Boolean)
    : [];
  const voteCounts = await pollVoteCounts(messageId, options.length);

  return {
    poll: {
      id: snapshot.id,
      ...poll,
      options
    },
    voteCounts
  };
}