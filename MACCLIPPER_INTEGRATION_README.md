# MacClipper Base44 Integration Setup

This guide explains how to integrate MacClipper screen recording uploads with your Base44 application.

## Prerequisites

- Base44 account with **Builder+ plan** (required for backend functions)
- MacClipper desktop application
- Your Base44 app ID and authentication token

## Step 1: Create Backend Function

1. In your Base44 dashboard, go to **Backend Functions**
2. Create a new function named `macClipperUpload`
3. Copy the code from `macClipperUpload.js` into the function editor
4. Implement the three helper functions:
   - `validateApiToken()` - Check tokens against your user database
   - `uploadFileToStorage()` - Handle file storage (Base44 storage or external)
   - `createClipRecord()` - Create Clip entity records

## Step 2: Set Up API Token System

### Option A: Add API Token to User Entity

1. Go to your Base44 **Data** tab
2. Edit the **User** entity
3. Add a new field:
   - **Field Name**: `apiToken`
   - **Type**: `Text`
   - **Required**: No

### Option B: Create Separate API Tokens Entity

1. Create a new entity called **ApiTokens**
2. Fields:
   - `token` (Text, required, unique)
   - `userId` (Reference to User, required)
   - `createdAt` (DateTime, required)
   - `lastUsedAt` (DateTime, optional)

## Step 3: Implement Helper Functions

Update the backend function with your actual implementations:

### validateApiToken()
```javascript
async function validateApiToken(token) {
  // If using User entity field:
  const users = await base44.entities.User.list();
  return users.find(user => user.apiToken === token);

  // If using separate ApiTokens entity:
  const tokens = await base44.entities.ApiTokens.list();
  const tokenRecord = tokens.find(t => t.token === token);
  if (tokenRecord) {
    // Update last used time
    await base44.entities.ApiTokens.update(tokenRecord.id, {
      lastUsedAt: new Date().toISOString()
    });
    // Return associated user
    return await base44.entities.User.get(tokenRecord.userId);
  }
  return null;
}
```

### uploadFileToStorage()
```javascript
async function uploadFileToStorage(file, filename) {
  // Using Base44 built-in storage:
  const storage = base44.storage;
  const result = await storage.upload(file, {
    filename,
    contentType: file.type
  });
  return result.url;

  // Using external storage (AWS S3, etc.):
  // const s3Url = await uploadToS3(file, filename);
  // return s3Url;
}
```

### createClipRecord()
```javascript
async function createClipRecord(clipData) {
  const clip = await base44.entities.Clip.create({
    content: clipData.content,
    clip_type: clipData.clip_type,
    source_app: clipData.source_app,
    is_favorite: false,
    is_pinned: false,
    tags: [],
    created_date: clipData.created_date,
    // Add any other Clip entity fields as needed
  });
  return clip;
}
```

## Step 4: Deploy and Test

1. **Deploy** the backend function in Base44
2. **Test** the endpoint:
   ```bash
   curl -X POST https://your-app.base44.com/api/macclipper/upload \
     -H "Authorization: Bearer YOUR_API_TOKEN" \
     -F "video=@/path/to/test/video.mp4" \
     -F "title=Test Recording" \
     -F "game=Screen Recording"
   ```
3. **Check** that clips appear in your Base44 dashboard

## Step 5: Configure MacClipper

1. Open MacClipper on your Mac
2. Go to **Settings → Share + Storage → API Token**
3. Enter your Base44 API token
4. Click the cloud icon on any recorded clip to upload

## API Endpoint Details

- **URL**: `https://your-app.base44.com/api/macclipper/upload`
- **Method**: `POST`
- **Authentication**: `Authorization: Bearer <token>`
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `video` (file): The video file
  - `title` (string, optional): Clip title
  - `game` (string, optional): Game/app name
  - `description` (string, optional): Description
  - `visibility` (string, optional): 'Public' or 'Private'

## Troubleshooting

### Common Issues:

1. **"Invalid API token"**
   - Check that the token exists in your user/ApiTokens entity
   - Verify token format (should be a secure random string)

2. **"File must be a video"**
   - Ensure MacClipper is sending MP4 files
   - Check file type validation in backend function

3. **"Video is too large"**
   - Current limit is 512MB, adjust in backend function if needed

4. **Clips not appearing in dashboard**
   - Check that `createClipRecord()` is working correctly
   - Verify Clip entity schema matches the data being created

### Debug Tips:

- Add console.log statements in the backend function
- Check Base44 function logs in your dashboard
- Test with curl commands before integrating with MacClipper

## Security Notes

- API tokens should be treated like passwords
- Implement token rotation/expiration if needed
- Consider rate limiting for upload endpoints
- Validate file types and sizes to prevent abuse

## Support

If you encounter issues:
1. Check Base44 function logs
2. Verify all helper functions are implemented
3. Test with curl before using MacClipper
4. Contact Base44 support for backend function issues