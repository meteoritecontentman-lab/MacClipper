import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';

const { appId, token, functionsVersion, appBaseUrl } = appParams;

//Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl: '',
  requiresAuth: false,
  appBaseUrl
});

// MacClipper upload functionality
export const macClipperUpload = {
  // Upload a video clip from MacClipper
  async uploadClip(formData, metadata = {}) {
    const response = await fetch(`${appBaseUrl}/api/macclipper/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-App-Id': appId
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Upload failed' }));
      throw new Error(error.message || `Upload failed: ${response.status}`);
    }

    return response.json();
  },

  // Get upload URL for direct upload (alternative approach)
  async getUploadUrl(filename, contentType = 'video/mp4') {
    const response = await fetch(`${appBaseUrl}/api/macclipper/upload-url`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-App-Id': appId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ filename, contentType })
    });

    if (!response.ok) {
      throw new Error('Failed to get upload URL');
    }

    return response.json();
  }
};