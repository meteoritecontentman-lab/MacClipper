import { FieldValue, getFirestore } from '../firestore';

const CLIP_VIEWS_COLLECTION = 'communityClipViews';

function normalizeClipId(value: string): string {
  return String(value || '').trim();
}

export async function recordCommunityClipView(clipId: string): Promise<number> {
  const normalizedClipId = normalizeClipId(clipId);
  if (!normalizedClipId) {
    return 0;
  }

  const documentReference = getFirestore().collection(CLIP_VIEWS_COLLECTION).doc(normalizedClipId);
  await documentReference.set({
    clipId: normalizedClipId,
    viewCount: FieldValue.increment(1),
    updatedAt: new Date().toISOString()
  }, { merge: true });

  const snapshot = await documentReference.get();
  return Number(snapshot.data()?.viewCount || 0);
}

export async function getCommunityClipViewCount(clipId: string): Promise<number> {
  const normalizedClipId = normalizeClipId(clipId);
  if (!normalizedClipId) {
    return 0;
  }

  const snapshot = await getFirestore().collection(CLIP_VIEWS_COLLECTION).doc(normalizedClipId).get();
  return Number(snapshot.data()?.viewCount || 0);
}

export async function getCommunityClipViewCounts(clipIds: string[]): Promise<Record<string, number>> {
  const normalizedClipIds = Array.from(new Set((clipIds || []).map((clipId) => normalizeClipId(clipId)).filter(Boolean)));
  if (normalizedClipIds.length === 0) {
    return {};
  }

  const collection = getFirestore().collection(CLIP_VIEWS_COLLECTION);
  const snapshots = await getFirestore().getAll(...normalizedClipIds.map((clipId) => collection.doc(clipId)));

  return normalizedClipIds.reduce((viewCounts, clipId, index) => {
    viewCounts[clipId] = Number(snapshots[index]?.data()?.viewCount || 0);
    return viewCounts;
  }, {} as Record<string, number>);
}