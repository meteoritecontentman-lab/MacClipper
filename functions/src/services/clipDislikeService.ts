import { FieldValue, getFirestore } from '../firestore';

const CLIP_DISLIKES_COLLECTION = 'communityClipDislikes';
const CLIP_DISLIKE_SUMMARIES_COLLECTION = 'communityClipDislikeSummaries';

function normalizeClipId(value: string): string {
  return String(value || '').trim();
}

function normalizeWebsiteUserId(value: string): string {
  return String(value || '').trim();
}

function reactionDocumentId(clipId: string, websiteUserId: string): string {
  return `${clipId}__${websiteUserId}`;
}

export async function getCommunityClipDislikeCount(clipId: string): Promise<number> {
  const normalizedClipId = normalizeClipId(clipId);
  if (!normalizedClipId) {
    return 0;
  }

  const snapshot = await getFirestore().collection(CLIP_DISLIKE_SUMMARIES_COLLECTION).doc(normalizedClipId).get();
  return Math.max(0, Number(snapshot.data()?.dislikeCount || 0));
}

export async function getCommunityClipDislikedState(clipId: string, websiteUserId: string): Promise<boolean> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedWebsiteUserId = normalizeWebsiteUserId(websiteUserId);
  if (!normalizedClipId || !normalizedWebsiteUserId) {
    return false;
  }

  const snapshot = await getFirestore()
    .collection(CLIP_DISLIKES_COLLECTION)
    .doc(reactionDocumentId(normalizedClipId, normalizedWebsiteUserId))
    .get();

  return snapshot.exists;
}

export async function getCommunityClipDislikeSummary(clipId: string, websiteUserId = ''): Promise<{ clipId: string; dislikeCount: number; disliked: boolean }> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedWebsiteUserId = normalizeWebsiteUserId(websiteUserId);
  const [dislikeCount, disliked] = await Promise.all([
    getCommunityClipDislikeCount(normalizedClipId),
    getCommunityClipDislikedState(normalizedClipId, normalizedWebsiteUserId)
  ]);

  return {
    clipId: normalizedClipId,
    dislikeCount,
    disliked
  };
}

export async function setCommunityClipDislike(clipId: string, websiteUserId: string, shouldDislike: boolean): Promise<{ clipId: string; dislikeCount: number; disliked: boolean }> {
  const normalizedClipId = normalizeClipId(clipId);
  const normalizedWebsiteUserId = normalizeWebsiteUserId(websiteUserId);
  if (!normalizedClipId || !normalizedWebsiteUserId) {
    return {
      clipId: normalizedClipId,
      dislikeCount: 0,
      disliked: false
    };
  }

  const firestore = getFirestore();
  const reactionReference = firestore.collection(CLIP_DISLIKES_COLLECTION).doc(reactionDocumentId(normalizedClipId, normalizedWebsiteUserId));
  const summaryReference = firestore.collection(CLIP_DISLIKE_SUMMARIES_COLLECTION).doc(normalizedClipId);
  const existingReaction = await reactionReference.get();
  const alreadyDisliked = existingReaction.exists;
  const now = new Date().toISOString();

  if (shouldDislike && !alreadyDisliked) {
    const batch = firestore.batch();
    batch.set(reactionReference, {
      clipId: normalizedClipId,
      websiteUserId: normalizedWebsiteUserId,
      createdAt: now,
      updatedAt: now
    });
    batch.set(summaryReference, {
      clipId: normalizedClipId,
      dislikeCount: FieldValue.increment(1),
      updatedAt: now
    }, { merge: true });
    await batch.commit();
  }

  if (!shouldDislike && alreadyDisliked) {
    const batch = firestore.batch();
    batch.delete(reactionReference);
    batch.set(summaryReference, {
      clipId: normalizedClipId,
      dislikeCount: FieldValue.increment(-1),
      updatedAt: now
    }, { merge: true });
    await batch.commit();
  }

  return getCommunityClipDislikeSummary(normalizedClipId, normalizedWebsiteUserId);
}