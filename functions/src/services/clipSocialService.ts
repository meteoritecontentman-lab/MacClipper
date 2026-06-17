import { FieldValue, getFirestore } from "../firestore";
import { ApiError } from "../middleware/errorHandler";

const CLIP_LIKES_COLLECTION = "communityClipLikes";
const CLIP_LIKE_SUMMARIES_COLLECTION = "communityClipLikeSummaries";
const CLIP_COMMENTS_COLLECTION = "communityClipComments";
const CLIP_COMMENT_SUMMARIES_COLLECTION = "communityClipCommentSummaries";
const CLIP_COMMENT_REACTIONS_COLLECTION = "communityClipCommentReactions";
const CLIP_COMMENT_REACTION_SUMMARIES_COLLECTION = "communityClipCommentReactionSummaries";
const DEFAULT_COMMENT_LIMIT = 24;
const MAX_COMMENT_LIMIT = 50;
const MAX_COMMENT_LENGTH = 1500;

type CommentReaction = "like" | "dislike" | "none";

export interface CommunityClipComment {
  id: string;
  clip_id: string;
  user_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  like_count: number;
  dislike_count: number;
  liked: boolean;
  disliked: boolean;
}

export interface CommunityClipCommentListResult {
  clipId: string;
  commentCount: number;
  comments: CommunityClipComment[];
}

function uniqueNormalizedIds(values: string[]): string[] {
  return Array.from(new Set((values || []).map((value) => normalizeClipId(value)).filter(Boolean)));
}

function normalizeClipId(value: string): string {
  return String(value || "").trim();
}

function normalizeWebsiteUserId(value: string): string {
  return String(value || "").trim();
}

function normalizeCommentBody(value: string): string {
  return String(value || "").trim();
}

function normalizeCommentLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_COMMENT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_COMMENT_LIMIT, Math.round(value)));
}

function likeReactionsCollection(clipId: string) {
  return getFirestore().collection(CLIP_LIKES_COLLECTION).doc(clipId).collection("reactions");
}

function likeSummaryReference(clipId: string) {
  return getFirestore().collection(CLIP_LIKE_SUMMARIES_COLLECTION).doc(clipId);
}

function commentItemsCollection(clipId: string) {
  return getFirestore().collection(CLIP_COMMENTS_COLLECTION).doc(clipId).collection("items");
}

function commentSummaryReference(clipId: string) {
  return getFirestore().collection(CLIP_COMMENT_SUMMARIES_COLLECTION).doc(clipId);
}

function commentReactionItemsCollection(clipId: string, commentId: string) {
  return getFirestore().collection(CLIP_COMMENT_REACTIONS_COLLECTION).doc(clipId).collection(commentId);
}

function commentReactionSummaryReference(clipId: string, commentId: string) {
  return getFirestore().collection(CLIP_COMMENT_REACTION_SUMMARIES_COLLECTION).doc(`${clipId}__${commentId}`);
}

function normalizeReaction(value: string): CommentReaction {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === "like" || normalizedValue === "dislike") {
    return normalizedValue;
  }

  return "none";
}

function mapCommentDocument(documentId: string, data: Record<string, unknown>, reactionSummary?: Record<string, unknown>, viewerReaction: CommentReaction = "none"): CommunityClipComment {
  return {
    id: documentId,
    clip_id: normalizeClipId(String(data.clipId || "")),
    user_id: normalizeWebsiteUserId(String(data.userId || "")),
    body: normalizeCommentBody(String(data.body || "")),
    created_at: String(data.createdAt || "").trim(),
    updated_at: String(data.updatedAt || data.createdAt || "").trim(),
    like_count: Math.max(0, Number(reactionSummary?.likeCount || 0)),
    dislike_count: Math.max(0, Number(reactionSummary?.dislikeCount || 0)),
    liked: viewerReaction === "like",
    disliked: viewerReaction === "dislike"
  };
}

async function getCommentReactionDetails(clipId: string, commentIds: string[], websiteUserId = ""): Promise<{
  summaryByCommentId: Map<string, Record<string, unknown>>;
  viewerReactionByCommentId: Map<string, CommentReaction>;
}> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedWebsiteUserId = normalizeWebsiteUserId(websiteUserId);
  if (!normalizedClipId || commentIds.length === 0) {
    return {
      summaryByCommentId: new Map(),
      viewerReactionByCommentId: new Map()
    };
  }

  const summaryEntries = await Promise.all(commentIds.map(async (commentId) => {
    const snapshot = await commentReactionSummaryReference(normalizedClipId, commentId).get();
    return [commentId, snapshot.data() || {}] as const;
  }));

  const viewerReactionEntries = normalizedWebsiteUserId
    ? await Promise.all(commentIds.map(async (commentId) => {
        const snapshot = await commentReactionItemsCollection(normalizedClipId, commentId).doc(normalizedWebsiteUserId).get();
        return [commentId, normalizeReaction(String(snapshot.data()?.reaction || "none"))] as const;
      }))
    : [];

  return {
    summaryByCommentId: new Map(summaryEntries),
    viewerReactionByCommentId: new Map(viewerReactionEntries)
  };
}

export async function getCommunityClipLikeCount(clipId: string): Promise<number> {
  const normalizedClipId = normalizeClipId(clipId);
  if (!normalizedClipId) {
    return 0;
  }

  const snapshot = await likeSummaryReference(normalizedClipId).get();
  return Math.max(0, Number(snapshot.data()?.likeCount || 0));
}

export async function getCommunityClipLikedState(clipId: string, websiteUserId: string): Promise<boolean> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedWebsiteUserId = normalizeWebsiteUserId(websiteUserId);
  if (!normalizedClipId || !normalizedWebsiteUserId) {
    return false;
  }

  const snapshot = await likeReactionsCollection(normalizedClipId).doc(normalizedWebsiteUserId).get();
  return snapshot.exists;
}

export async function getCommunityClipLikeSummary(clipId: string, websiteUserId = ""): Promise<{ clipId: string; likeCount: number; liked: boolean }> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedWebsiteUserId = normalizeWebsiteUserId(websiteUserId);
  const [likeCount, liked] = await Promise.all([
    getCommunityClipLikeCount(normalizedClipId),
    getCommunityClipLikedState(normalizedClipId, normalizedWebsiteUserId)
  ]);

  return {
    clipId: normalizedClipId,
    likeCount,
    liked
  };
}

export async function getCommunityClipLikeCounts(clipIds: string[]): Promise<Record<string, number>> {
  const normalizedClipIds = uniqueNormalizedIds(clipIds);
  if (normalizedClipIds.length === 0) {
    return {};
  }

  const snapshots = await getFirestore().getAll(...normalizedClipIds.map((clipId) => likeSummaryReference(clipId)));
  return normalizedClipIds.reduce((likeCounts, clipId, index) => {
    likeCounts[clipId] = Math.max(0, Number(snapshots[index]?.data()?.likeCount || 0));
    return likeCounts;
  }, {} as Record<string, number>);
}

export async function setCommunityClipLike(clipId: string, websiteUserId: string, shouldLike: boolean): Promise<{ clipId: string; likeCount: number; liked: boolean }> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedWebsiteUserId = normalizeWebsiteUserId(websiteUserId);
  if (!normalizedClipId || !normalizedWebsiteUserId) {
    return {
      clipId: normalizedClipId,
      likeCount: 0,
      liked: false
    };
  }

  const firestore = getFirestore();
  const reactionReference = likeReactionsCollection(normalizedClipId).doc(normalizedWebsiteUserId);
  const summaryReference = likeSummaryReference(normalizedClipId);
  const existingReaction = await reactionReference.get();
  const alreadyLiked = existingReaction.exists;
  const now = new Date().toISOString();

  if (shouldLike && !alreadyLiked) {
    const batch = firestore.batch();
    batch.set(reactionReference, {
      clipId: normalizedClipId,
      userId: normalizedWebsiteUserId,
      createdAt: now,
      updatedAt: now
    });
    batch.set(summaryReference, {
      clipId: normalizedClipId,
      likeCount: FieldValue.increment(1),
      updatedAt: now
    }, { merge: true });
    await batch.commit();
  }

  if (!shouldLike && alreadyLiked) {
    const batch = firestore.batch();
    batch.delete(reactionReference);
    batch.set(summaryReference, {
      clipId: normalizedClipId,
      likeCount: FieldValue.increment(-1),
      updatedAt: now
    }, { merge: true });
    await batch.commit();
  }

  return getCommunityClipLikeSummary(normalizedClipId, normalizedWebsiteUserId);
}

export async function getCommunityClipCommentCount(clipId: string): Promise<number> {
  const normalizedClipId = normalizeClipId(clipId);
  if (!normalizedClipId) {
    return 0;
  }

  const snapshot = await commentSummaryReference(normalizedClipId).get();
  return Math.max(0, Number(snapshot.data()?.commentCount || 0));
}

export async function getCommunityClipComments(clipId: string, limit = DEFAULT_COMMENT_LIMIT, websiteUserId = ""): Promise<CommunityClipCommentListResult> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedLimit = normalizeCommentLimit(limit);
  if (!normalizedClipId) {
    return {
      clipId: normalizedClipId,
      commentCount: 0,
      comments: []
    };
  }

  const [commentCount, snapshot] = await Promise.all([
    getCommunityClipCommentCount(normalizedClipId),
    commentItemsCollection(normalizedClipId)
      .orderBy("createdAt", "desc")
      .limit(normalizedLimit)
      .get()
  ]);

  const commentIds = snapshot.docs.map((documentSnapshot) => documentSnapshot.id);
  const reactionDetails = await getCommentReactionDetails(normalizedClipId, commentIds, websiteUserId);

  return {
    clipId: normalizedClipId,
    commentCount,
    comments: snapshot.docs.map((documentSnapshot) => mapCommentDocument(
      documentSnapshot.id,
      documentSnapshot.data() || {},
      reactionDetails.summaryByCommentId.get(documentSnapshot.id),
      reactionDetails.viewerReactionByCommentId.get(documentSnapshot.id) || "none"
    ))
  };
}

export async function getCommunityClipCommentCounts(clipIds: string[]): Promise<Record<string, number>> {
  const normalizedClipIds = uniqueNormalizedIds(clipIds);
  if (normalizedClipIds.length === 0) {
    return {};
  }

  const snapshots = await getFirestore().getAll(...normalizedClipIds.map((clipId) => commentSummaryReference(clipId)));
  return normalizedClipIds.reduce((commentCounts, clipId, index) => {
    commentCounts[clipId] = Math.max(0, Number(snapshots[index]?.data()?.commentCount || 0));
    return commentCounts;
  }, {} as Record<string, number>);
}

export async function getTotalCommunityClipCommentCount(): Promise<number> {
  const snapshot = await getFirestore().collection(CLIP_COMMENT_SUMMARIES_COLLECTION).get();
  return snapshot.docs.reduce((totalCount, documentSnapshot) => {
    return totalCount + Math.max(0, Number(documentSnapshot.data()?.commentCount || 0));
  }, 0);
}

export async function getRecentCommunityClipComments(limit = DEFAULT_COMMENT_LIMIT): Promise<CommunityClipComment[]> {
  const normalizedLimit = normalizeCommentLimit(limit);
  try {
    const snapshot = await getFirestore()
      .collectionGroup("items")
      .orderBy("createdAt", "desc")
      .limit(normalizedLimit)
      .get();

    return snapshot.docs
      .map((documentSnapshot) => mapCommentDocument(documentSnapshot.id, documentSnapshot.data() || {}))
      .filter((comment) => comment.clip_id);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || "");
    const isMissingIndex = errorMessage.includes("FAILED_PRECONDITION") || errorMessage.includes("requires a COLLECTION_GROUP_DESC index");
    if (!isMissingIndex) {
      throw error;
    }

    console.warn("[CLIP_SOCIAL] Missing index for recent comment query; using unordered fallback.");
    const fallbackSnapshot = await getFirestore()
      .collectionGroup("items")
      .limit(normalizedLimit)
      .get();

    return fallbackSnapshot.docs
      .map((documentSnapshot) => mapCommentDocument(documentSnapshot.id, documentSnapshot.data() || {}))
      .filter((comment) => comment.clip_id)
      .sort((leftComment, rightComment) => {
        return new Date(rightComment.created_at || 0).getTime() - new Date(leftComment.created_at || 0).getTime();
      })
      .slice(0, normalizedLimit);
  }
}

export async function createCommunityClipComment(clipId: string, websiteUserId: string, body: string): Promise<{ clipId: string; commentCount: number; comment: CommunityClipComment }> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedWebsiteUserId = normalizeWebsiteUserId(websiteUserId);
  const normalizedBody = normalizeCommentBody(body);

  if (!normalizedClipId) {
    throw new ApiError(400, "clipId is required.");
  }

  if (!normalizedWebsiteUserId) {
    throw new ApiError(400, "websiteUserId is required.");
  }

  if (!normalizedBody) {
    throw new ApiError(400, "Comment body is required.");
  }

  if (normalizedBody.length > MAX_COMMENT_LENGTH) {
    throw new ApiError(400, `Comment body must be ${MAX_COMMENT_LENGTH} characters or less.`);
  }

  const firestore = getFirestore();
  const now = new Date().toISOString();
  const commentReference = commentItemsCollection(normalizedClipId).doc();
  const summaryReference = commentSummaryReference(normalizedClipId);

  const payload = {
    clipId: normalizedClipId,
    userId: normalizedWebsiteUserId,
    body: normalizedBody,
    createdAt: now,
    updatedAt: now
  };

  const batch = firestore.batch();
  batch.set(commentReference, payload);
  batch.set(summaryReference, {
    clipId: normalizedClipId,
    commentCount: FieldValue.increment(1),
    updatedAt: now
  }, { merge: true });
  await batch.commit();

  const commentCount = await getCommunityClipCommentCount(normalizedClipId);
  return {
    clipId: normalizedClipId,
    commentCount,
    comment: mapCommentDocument(commentReference.id, payload)
  };
}

export async function setCommunityClipCommentReaction(clipId: string, commentId: string, websiteUserId: string, reaction: string): Promise<{ commentId: string; likeCount: number; dislikeCount: number; liked: boolean; disliked: boolean }> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedCommentId = normalizeClipId(commentId);
  const normalizedWebsiteUserId = normalizeWebsiteUserId(websiteUserId);
  const normalizedReaction = normalizeReaction(reaction);

  if (!normalizedClipId) {
    throw new ApiError(400, "clipId is required.");
  }

  if (!normalizedCommentId) {
    throw new ApiError(400, "commentId is required.");
  }

  if (!normalizedWebsiteUserId) {
    throw new ApiError(400, "websiteUserId is required.");
  }

  const commentSnapshot = await commentItemsCollection(normalizedClipId).doc(normalizedCommentId).get();
  if (!commentSnapshot.exists) {
    throw new ApiError(404, "Comment not found.");
  }

  const firestore = getFirestore();
  const reactionReference = commentReactionItemsCollection(normalizedClipId, normalizedCommentId).doc(normalizedWebsiteUserId);
  const summaryReference = commentReactionSummaryReference(normalizedClipId, normalizedCommentId);
  const existingReactionSnapshot = await reactionReference.get();
  const previousReaction = normalizeReaction(String(existingReactionSnapshot.data()?.reaction || "none"));

  if (previousReaction === normalizedReaction) {
    const summarySnapshot = await summaryReference.get();
    const summaryData = summarySnapshot.data() || {};
    return {
      commentId: normalizedCommentId,
      likeCount: Math.max(0, Number(summaryData.likeCount || 0)),
      dislikeCount: Math.max(0, Number(summaryData.dislikeCount || 0)),
      liked: normalizedReaction === "like",
      disliked: normalizedReaction === "dislike"
    };
  }

  const now = new Date().toISOString();
  const summaryUpdate: Record<string, unknown> = {
    clipId: normalizedClipId,
    commentId: normalizedCommentId,
    updatedAt: now
  };

  if (previousReaction === "like") {
    summaryUpdate.likeCount = FieldValue.increment(-1);
  }
  if (previousReaction === "dislike") {
    summaryUpdate.dislikeCount = FieldValue.increment(-1);
  }
  if (normalizedReaction === "like") {
    summaryUpdate.likeCount = FieldValue.increment((previousReaction === "like" ? 0 : 1) + (summaryUpdate.likeCount ? 0 : 0));
  }
  if (normalizedReaction === "dislike") {
    summaryUpdate.dislikeCount = FieldValue.increment((previousReaction === "dislike" ? 0 : 1) + (summaryUpdate.dislikeCount ? 0 : 0));
  }

  const batch = firestore.batch();
  if (normalizedReaction === "none") {
    batch.delete(reactionReference);
  } else {
    batch.set(reactionReference, {
      clipId: normalizedClipId,
      commentId: normalizedCommentId,
      userId: normalizedWebsiteUserId,
      reaction: normalizedReaction,
      updatedAt: now,
      createdAt: String(existingReactionSnapshot.data()?.createdAt || now)
    });
  }
  batch.set(summaryReference, summaryUpdate, { merge: true });
  await batch.commit();

  const summarySnapshot = await summaryReference.get();
  const summaryData = summarySnapshot.data() || {};
  return {
    commentId: normalizedCommentId,
    likeCount: Math.max(0, Number(summaryData.likeCount || 0)),
    dislikeCount: Math.max(0, Number(summaryData.dislikeCount || 0)),
    liked: normalizedReaction === "like",
    disliked: normalizedReaction === "dislike"
  };
}