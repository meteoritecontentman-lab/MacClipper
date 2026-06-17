// Base44 Backend Function: macClipperUpload
// This function handles video uploads from the MacClipper macOS app
// Requires Builder+ plan in Base44

export async function macClipperUpload(request) {
  try {
    // Authenticate the request using Bearer token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return Response.json({
        error: 'Missing or invalid authorization header'
      }, { status: 401 });
    }

    const token = authHeader.substring(7);

    // Validate the token against your user database
    // This should check if the token exists and belongs to a valid user
    const user = await validateApiToken(token);
    if (!user) {
      return Response.json({
        error: 'Invalid API token'
      }, { status: 401 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('video'); // MacClipper sends as 'video' field

    if (!file || !file.size) {
      return Response.json({
        error: 'No video file provided'
      }, { status: 400 });
    }

    // Validate file type (should be video)
    if (!file.type.startsWith('video/')) {
      return Response.json({
        error: 'File must be a video'
      }, { status: 400 });
    }

    // Check file size (512MB limit like the original backend)
    const maxSize = 512 * 1024 * 1024; // 512MB
    if (file.size > maxSize) {
      return Response.json({
        error: `Video is too large. Max upload is 512 MB.`
      }, { status: 400 });
    }

    // Generate unique filename
    const fileExtension = file.name.split('.').pop() || 'mp4';
    const uniqueFilename = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExtension}`;

    // Upload file to Base44 storage
    const fileUrl = await uploadFileToStorage(file, uniqueFilename);

    // Get metadata from form
    const title = formData.get('title') || `MacClipper Recording - ${new Date().toLocaleDateString()}`;
    const game = formData.get('game') || 'Screen Recording';
    const description = formData.get('description') || 'Uploaded from MacClipper';
    const visibility = formData.get('visibility') || 'Public';

    // Create clip record in Base44
    const clip = await createClipRecord({
      content: fileUrl,
      clip_type: 'macclipper',
      source_app: 'MacClipper',
      title: title,
      game: game,
      description: description,
      visibility: visibility,
      uploaderId: user.id,
      uploaderName: user.displayName || user.email,
      fileName: file.name,
      storedName: uniqueFilename,
      fileType: file.type,
      fileSize: file.size,
      created_date: new Date().toISOString()
    });

    return Response.json({
      success: true,
      clip: {
        id: clip.id,
        content: fileUrl,
        clip_type: 'macclipper',
        source_app: 'MacClipper',
        created_date: clip.created_date
      },
      message: 'MacClipper clip uploaded successfully'
    });

  } catch (error) {
    console.error('MacClipper upload error:', error);
    return Response.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
}

// Helper function to validate API tokens
async function validateApiToken(token) {
  // TODO: Implement token validation against your user database
  // This should check if the token exists in your users table
  // Return user object if valid, null if invalid

  // Example implementation:
  // const users = await base44.entities.User.list();
  // return users.find(user => user.apiToken === token);

  return null; // Placeholder - implement this
}

// Helper function to upload file to storage
async function uploadFileToStorage(file, filename) {
  // TODO: Implement file upload to your storage system
  // This could be Base44's built-in storage or external storage like AWS S3

  // Example for Base44 built-in storage:
  // const storage = base44.storage;
  // const result = await storage.upload(file, { filename });
  // return result.url;

  // Placeholder - implement this
  return `https://your-base44-storage.com/uploads/${filename}`;
}

// Helper function to create clip record
async function createClipRecord(clipData) {
  // TODO: Create a new Clip entity record in Base44
  // This should use the Base44 SDK to create a new clip

  // Example:
  // const clip = await base44.entities.Clip.create(clipData);
  // return clip;

  // Placeholder - implement this
  return {
    id: crypto.randomUUID(),
    ...clipData
  };
}