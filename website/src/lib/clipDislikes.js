import { buildCloudAPIURL } from './appRuntime';

function dislikeEndpoint(clipId) {
  return buildCloudAPIURL(`/community-clips/${encodeURIComponent(String(clipId || '').trim())}/dislikes`);
}

export async function fetchClipDislikeSummary(clipId, websiteUserId = '') {
  const requestURL = new URL(dislikeEndpoint(clipId));
  if (websiteUserId) {
    requestURL.searchParams.set('websiteUserId', String(websiteUserId || '').trim());
  }

  const response = await fetch(requestURL.toString(), {
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Dislike summary request failed with ${response.status}`);
  }

  return response.json().catch(() => ({ clipId: String(clipId || '').trim(), dislikeCount: 0, disliked: false }));
}

export async function setClipDislikePreference(clipId, websiteUserId, shouldDislike) {
  const response = await fetch(dislikeEndpoint(clipId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      websiteUserId,
      shouldDislike
    })
  });

  if (!response.ok) {
    throw new Error(`Dislike update failed with ${response.status}`);
  }

  return response.json().catch(() => ({ clipId: String(clipId || '').trim(), dislikeCount: 0, disliked: false }));
}