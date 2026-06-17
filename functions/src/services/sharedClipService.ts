import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import admin from "firebase-admin";
import { z } from "zod";
import { ApiError } from "../middleware/errorHandler";
import { getFirestore, initializeFirebaseAdmin } from "../firestore";

export const SHARED_CLIPS_COLLECTION = "sharedClips";

const sharedClipUploadSchema = z.object({
  appUuid: z.string().trim().min(1).max(128),
  websiteUserId: z.string().trim().min(1).max(128).optional(),
  title: z.string().trim().min(1).max(160).default("MacClipper Clip"),
  orientation: z.enum(["horizontal", "vertical"]).default("horizontal")
});

type SharedClipOrientation = z.infer<typeof sharedClipUploadSchema>["orientation"];

interface SharedClipFileInput {
  temporaryFilePath: string;
  originalName: string;
  mimeType: string;
  size: number;
}

interface StoredSharedClipRecord {
  id: string;
  appUuid: string;
  websiteUserId?: string;
  title: string;
  orientation: SharedClipOrientation;
  uploadedAt: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
  videoURL: string;
  pageURL: string;
  shareURL?: string;
}

export interface SharedClipRecord {
  id: string;
  title: string;
  orientation: SharedClipOrientation;
  uploadedAt: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  videoURL: string;
  pageURL: string;
  shareURL: string;
}

interface SharedClipURLContext {
  pageBaseURL?: string;
  shareBaseURL?: string;
}

export function parseSharedClipUpload(fields: Record<string, unknown>): {
  appUuid: string;
  websiteUserId?: string;
  title: string;
  orientation: SharedClipOrientation;
} {
  const title = normalizeTextField(fields.title);
  const orientation = normalizeTextField(fields.orientation);
  const websiteUserId = normalizeTextField(fields.websiteUserId);

  return sharedClipUploadSchema.parse({
    appUuid: normalizeTextField(fields.appUuid),
    websiteUserId: websiteUserId || undefined,
    title: title || undefined,
    orientation: orientation || undefined
  });
}

export async function createSharedClip(input: {
  fields: Record<string, unknown>;
  file: SharedClipFileInput;
  pageBaseURL: string;
  shareBaseURL: string;
}): Promise<SharedClipRecord> {
  initializeFirebaseAdmin();

  const metadata = parseSharedClipUpload(input.fields);
  const shareId = randomUUID();
  const uploadedAt = new Date().toISOString();
  const pageURL = buildSharedClipPageURL(input.pageBaseURL, shareId);
  const shareURL = buildSharedClipPreviewURL(input.shareBaseURL, shareId);
  const originalExtension = resolveFileExtension(input.file.originalName, input.file.mimeType);
  const safeBaseName = sanitizeFilenameFragment(metadata.title);
  const storedFileName = `${safeBaseName}-${shareId}.${originalExtension}`;
  const storagePath = path.posix.join("shared-clips", shareId, storedFileName);
  const downloadToken = randomUUID();

  const bucket = admin.storage().bucket();
  try {
    await bucket.upload(input.file.temporaryFilePath, {
      destination: storagePath,
      resumable: false,
      validation: false,
      metadata: {
        contentType: input.file.mimeType,
        cacheControl: "public, max-age=31536000, immutable",
        metadata: {
          firebaseStorageDownloadTokens: downloadToken
        }
      }
    });
  } finally {
    void fs.promises.unlink(input.file.temporaryFilePath).catch(() => undefined);
  }

  const videoURL = buildStorageDownloadURL(bucket.name, storagePath, downloadToken);
  const record: StoredSharedClipRecord = {
    id: shareId,
    appUuid: metadata.appUuid,
    websiteUserId: metadata.websiteUserId || undefined,
    title: metadata.title,
    orientation: metadata.orientation,
    uploadedAt,
    fileName: input.file.originalName,
    fileType: input.file.mimeType,
    fileSize: input.file.size,
    storagePath,
    videoURL,
    pageURL,
    shareURL
  };

  await getFirestore().collection(SHARED_CLIPS_COLLECTION).doc(shareId).set(record);

  return publicSharedClip(record);
}

export async function listSharedClips(input: {
  appUuid?: string;
  websiteUserId?: string;
  pageBaseURL?: string;
  shareBaseURL?: string;
  limit?: number;
}): Promise<SharedClipRecord[]> {
  initializeFirebaseAdmin();

  const normalizedAppUuid = sanitizeLookupField(input.appUuid);
  const normalizedWebsiteUserId = sanitizeLookupField(input.websiteUserId);
  const limit = Math.min(Math.max(input.limit ?? 48, 1), 120);

  if ((normalizedAppUuid ? 1 : 0) + (normalizedWebsiteUserId ? 1 : 0) != 1) {
    return [];
  }

  let query = getFirestore().collection(SHARED_CLIPS_COLLECTION).limit(limit);

  if (normalizedWebsiteUserId) {
    query = query.where("websiteUserId", "==", normalizedWebsiteUserId).limit(limit);
  } else {
    query = query.where("appUuid", "==", normalizedAppUuid).limit(limit);
  }

  const snapshot = await query.get();

  return snapshot.docs
    .map((document) => hydrateSharedClipRecord(document.id, document.data(), {
      pageBaseURL: input.pageBaseURL,
      shareBaseURL: input.shareBaseURL
    }))
    .filter((record): record is StoredSharedClipRecord => Boolean(record))
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
    .map(publicSharedClip);
}

export async function resolveSharedClipLinksByVideoURLs(input: {
  videoURLs: string[];
  pageBaseURL?: string;
  shareBaseURL?: string;
}): Promise<Record<string, SharedClipRecord>> {
  initializeFirebaseAdmin();

  const normalizedVideoURLs = Array.from(new Set(
    input.videoURLs
      .map((value) => normalizeTextField(value))
      .filter(Boolean)
  )).slice(0, 120);

  if (normalizedVideoURLs.length === 0) {
    return {};
  }

  const resolvedLinks = new Map<string, SharedClipRecord>();

  for (const chunk of chunkArray(normalizedVideoURLs, 10)) {
    const snapshot = await getFirestore()
      .collection(SHARED_CLIPS_COLLECTION)
      .where("videoURL", "in", chunk)
      .get();

    for (const document of snapshot.docs) {
      const record = hydrateSharedClipRecord(document.id, document.data(), {
        pageBaseURL: input.pageBaseURL,
        shareBaseURL: input.shareBaseURL
      });

      if (!record || !record.videoURL || resolvedLinks.has(record.videoURL)) {
        continue;
      }

      resolvedLinks.set(record.videoURL, publicSharedClip(record));
    }
  }

  return Object.fromEntries(resolvedLinks.entries());
}

export async function getSharedClip(shareId: string, urlContext: SharedClipURLContext = {}): Promise<SharedClipRecord | null> {
  const snapshot = await getFirestore().collection(SHARED_CLIPS_COLLECTION).doc(shareId).get();
  if (!snapshot.exists) {
    return null;
  }

  const record = hydrateSharedClipRecord(
    snapshot.id,
    snapshot.data() as Partial<StoredSharedClipRecord> | undefined,
    urlContext
  );
  if (!record) {
    return null;
  }

  return publicSharedClip(record);
}

export async function deleteSharedClip(input: {
  shareId: string;
  websiteUserId?: string;
  appUuid?: string;
}): Promise<void> {
  initializeFirebaseAdmin();

  const shareId = normalizeTextField(input.shareId);
  const websiteUserId = sanitizeLookupField(input.websiteUserId);
  const appUuid = sanitizeLookupField(input.appUuid);

  if (!shareId) {
    throw new ApiError(400, "Missing shared clip ID.");
  }

  if ((websiteUserId ? 1 : 0) + (appUuid ? 1 : 0) != 1) {
    throw new ApiError(400, "Provide exactly one of websiteUserId or appUuid.");
  }

  const documentReference = getFirestore().collection(SHARED_CLIPS_COLLECTION).doc(shareId);
  const snapshot = await documentReference.get();
  if (!snapshot.exists) {
    throw new ApiError(404, "Clip not found.");
  }

  const record = hydrateSharedClipRecord(
    snapshot.id,
    snapshot.data() as Partial<StoredSharedClipRecord> | undefined,
    {}
  );

  if (!record) {
    throw new ApiError(404, "Clip not found.");
  }

  if (websiteUserId && record.websiteUserId !== websiteUserId) {
    throw new ApiError(403, "You cannot delete this clip.");
  }

  if (appUuid && record.appUuid !== appUuid) {
    throw new ApiError(403, "You cannot delete this clip.");
  }

  if (record.storagePath) {
    await admin.storage().bucket().file(record.storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
  }

  await documentReference.delete();
}

export function renderSharedClipPreviewPage(share: SharedClipRecord): string {
  const dimensions = share.orientation === "vertical"
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: 1080 };
  const title = escapeHTML(share.title);
  const description = escapeHTML("Watch this unlisted MacClipper clip in a page that opens fast, previews cleanly, and feels intentional when the link lands in Discord, DMs, or a browser.");
  const shareURL = escapeAttribute(share.shareURL || share.pageURL);
  const videoURL = escapeAttribute(share.videoURL);
  const homeURL = escapeAttribute(resolveSharedClipHomeURL(share.pageURL));
  const uploadedAt = escapeHTML(formatSharedClipDate(share.uploadedAt));
  const fileSize = escapeHTML(formatSharedClipSize(share.fileSize));
  const orientationLabel = share.orientation === "vertical" ? "Vertical clip" : "Landscape clip";
  const aspectRatioLabel = share.orientation === "vertical" ? "9:16" : "16:9";
  const brandMark = buildSharedClipBrandMark();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} | MacClipper</title>
  <meta name="theme-color" content="#11171d">
  <meta name="description" content="${description}">
  <link rel="icon" href="https://media.base44.com/images/public/user_69840c94143af1fbc044bd6f/cf2d115fa_AppIcon_1024x1024x32.png">
  <meta property="og:site_name" content="MacClipper">
  <meta property="og:type" content="video.other">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${shareURL}">
  <meta property="og:video" content="${videoURL}">
  <meta property="og:video:secure_url" content="${videoURL}">
  <meta property="og:video:type" content="${escapeAttribute(share.fileType)}">
  <meta property="og:video:width" content="${dimensions.width}">
  <meta property="og:video:height" content="${dimensions.height}">
  <meta property="og:image" content="${videoURL}">
  <meta name="twitter:card" content="player">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:player" content="${shareURL}">
  <meta name="twitter:player:width" content="${dimensions.width}">
  <meta name="twitter:player:height" content="${dimensions.height}">
  <style>
    :root {
      color-scheme: dark;
      --bg: #070b0f;
      --bg-deep: #0f151b;
      --panel: rgba(15, 21, 28, 0.86);
      --panel-strong: rgba(17, 23, 29, 0.94);
      --panel-border: rgba(247, 237, 221, 0.12);
      --text: #f7edde;
      --muted: #c9bead;
      --soft: #efe2cf;
      --accent: #e6ca8f;
      --accent-strong: #db6b3d;
      --accent-cool: #2e6d61;
      --shadow: 0 36px 100px rgba(0, 0, 0, 0.4);
    }

    * {
      box-sizing: border-box;
    }

    html {
      min-height: 100%;
      background: var(--bg);
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Avenir Next", "SF Pro Display", "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(46, 109, 97, 0.2), transparent 34%),
        radial-gradient(circle at 82% 10%, rgba(219, 107, 61, 0.18), transparent 24%),
        linear-gradient(180deg, #10161c 0%, #070b0f 58%, #040608 100%);
      padding: 28px 18px 44px;
      overflow-x: hidden;
    }

    body::before,
    body::after {
      content: "";
      position: fixed;
      inset: auto;
      width: 320px;
      height: 320px;
      border-radius: 50%;
      filter: blur(80px);
      opacity: 0.28;
      pointer-events: none;
      z-index: 0;
    }

    body::before {
      top: 32px;
      left: -96px;
      background: rgba(46, 109, 97, 0.32);
    }

    body::after {
      right: -80px;
      bottom: 12%;
      background: rgba(219, 107, 61, 0.24);
    }

    .shell {
      width: min(1240px, 100%);
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    main {
      border: 1px solid var(--panel-border);
      border-radius: 30px;
      background: linear-gradient(180deg, rgba(18, 24, 31, 0.96) 0%, rgba(10, 15, 20, 0.94) 100%);
      backdrop-filter: blur(26px);
      overflow: hidden;
      box-shadow: var(--shadow);
    }

    .hero {
      padding: 28px 30px 22px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 22px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .brand {
      display: flex;
      align-items: flex-start;
      gap: 16px;
    }

    .brand-mark {
      width: 54px;
      height: 54px;
      border-radius: 17px;
      display: grid;
      place-items: center;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.02));
      border: 1px solid rgba(247, 237, 221, 0.1);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 16px 34px rgba(0, 0, 0, 0.24);
      overflow: hidden;
    }

    .brand-mark svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    .eyebrow {
      margin: 0 0 4px;
      font-size: 11px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--accent);
    }

    h1 {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", serif;
      font-size: clamp(28px, 4vw, 44px);
      line-height: 1.05;
      max-width: 14ch;
    }

    .subtitle {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 15px;
      max-width: 62ch;
    }

    .hero-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.04);
      color: var(--soft);
      font-size: 12px;
      letter-spacing: 0.02em;
    }

    .pill-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: linear-gradient(180deg, var(--accent), var(--accent-strong));
      box-shadow: 0 0 0 4px rgba(230, 202, 143, 0.14);
    }

    .signal-strip {
      padding: 20px 30px 0;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .signal-card {
      border-radius: 22px;
      padding: 16px 18px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.02));
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    .signal-label {
      display: inline-block;
      margin: 0;
      color: var(--accent);
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }

    .signal-title {
      margin: 10px 0 0;
      color: var(--text);
      font-size: 18px;
      font-weight: 700;
    }

    .signal-copy {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }

    .stage {
      display: grid;
      grid-template-columns: minmax(0, 1.65fr) minmax(300px, 0.95fr);
      gap: 0;
      margin-top: 20px;
    }

    .player-column {
      padding: 28px;
      border-right: 1px solid rgba(255, 255, 255, 0.06);
    }

    .video-shell {
      border-radius: 28px;
      padding: 16px;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015)),
        linear-gradient(180deg, rgba(9, 15, 22, 0.94), rgba(7, 11, 16, 0.98));
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 26px 54px rgba(0, 0, 0, 0.28);
    }

    video {
      width: 100%;
      aspect-ratio: ${share.orientation === "vertical" ? "9 / 16" : "16 / 9"};
      max-height: min(74vh, 980px);
      border-radius: 20px;
      background: #020507;
      display: block;
      object-fit: contain;
    }

    .player-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-top: 18px;
    }

    .meta-cluster {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .meta-chip {
      padding: 9px 12px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.045);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--soft);
      font-size: 12px;
    }

    .meta-chip strong {
      color: var(--text);
      font-weight: 700;
      margin-right: 5px;
    }

    .sidebar {
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background:
        linear-gradient(180deg, rgba(16, 22, 28, 0.94), rgba(10, 14, 19, 0.98));
    }

    .card {
      border-radius: 24px;
      padding: 18px 18px 16px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.02));
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .card h2,
    .card h3 {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", serif;
      font-size: 14px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
    }

    .card p {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.55;
    }

    .action-stack {
      display: grid;
      gap: 12px;
      margin-top: 14px;
    }

    .action-button,
    .link-button {
      appearance: none;
      border: 0;
      width: 100%;
      border-radius: 18px;
      padding: 14px 16px;
      font: inherit;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
      transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }

    .action-button:hover,
    .link-button:hover {
      transform: translateY(-1px);
    }

    .action-button {
      color: #11171d;
      background: linear-gradient(135deg, #f7edde 0%, #e6ca8f 50%, #db6b3d 100%);
      box-shadow: 0 14px 28px rgba(219, 107, 61, 0.24);
    }

    .link-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--text);
      background: rgba(255, 255, 255, 0.045);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .link-panel {
      margin-top: 14px;
      padding: 14px 15px;
      border-radius: 18px;
      background: rgba(0, 0, 0, 0.24);
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--soft);
      font-size: 12px;
      line-height: 1.45;
      word-break: break-all;
    }

    .status-note {
      margin-top: 10px;
      color: var(--muted);
      font-size: 12px;
      min-height: 18px;
    }

    .stat-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }

    .stat {
      padding: 14px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .stat-label {
      display: block;
      color: var(--muted);
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .stat-value {
      display: block;
      margin-top: 8px;
      color: var(--text);
      font-size: 16px;
      font-weight: 700;
    }

    .cta-card {
      background:
        radial-gradient(circle at top left, rgba(46, 109, 97, 0.18), transparent 40%),
        radial-gradient(circle at bottom right, rgba(219, 107, 61, 0.16), transparent 38%),
        linear-gradient(180deg, rgba(20, 27, 34, 0.98), rgba(11, 16, 21, 0.98));
    }

    .cta-card p {
      margin-top: 12px;
    }

    .footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      padding: 18px 30px 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--muted);
      font-size: 13px;
    }

    .link {
      color: var(--accent);
      text-decoration: none;
    }

    .hero,
    .player-column,
    .sidebar {
      animation: riseIn 620ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    .player-column {
      animation-delay: 80ms;
    }

    .sidebar {
      animation-delay: 140ms;
    }

    @keyframes riseIn {
      from {
        opacity: 0;
        transform: translateY(22px);
        filter: blur(10px);
      }

      to {
        opacity: 1;
        transform: translateY(0);
        filter: blur(0);
      }
    }

    .link:hover {
      text-decoration: underline;
    }

    @media (max-width: 720px) {
      .hero {
        padding: 22px 20px 18px;
        flex-direction: column;
      }

      .hero-actions {
        justify-content: flex-start;
      }

      .stage {
        grid-template-columns: 1fr;
      }

      .signal-strip {
        padding: 18px 20px 0;
        grid-template-columns: 1fr;
      }

      .player-column {
        padding: 20px;
        border-right: 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }

      .sidebar {
        padding: 20px;
      }

      .footer {
        padding: 16px 20px 22px;
      }

      .stat-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <main>
      <section class="hero">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">${brandMark}</div>
          <div>
            <p class="eyebrow">MacClipper Clip Page</p>
            <h1>${title}</h1>
            <p class="subtitle">A clean, unlisted clip page for quick plays, fast previews, and easy link drops across Discord, DMs, and browsers.</p>
          </div>
        </div>
        <div class="hero-actions">
          <span class="pill"><span class="pill-dot"></span>Unlisted clip page</span>
          <span class="pill">${escapeHTML(orientationLabel)}</span>
        </div>
      </section>
      <section class="signal-strip" aria-label="Clip page highlights">
        <article class="signal-card">
          <p class="signal-label">Fast Open</p>
          <p class="signal-title">Press play immediately.</p>
          <p class="signal-copy">This page stays focused on the clip so the link feels quick and direct the moment it opens.</p>
        </article>
        <article class="signal-card">
          <p class="signal-label">Clean Preview</p>
          <p class="signal-title">Built for Discord and DMs.</p>
          <p class="signal-copy">The hosted page is meant to preview cleanly in chat while still opening as a polished standalone surface.</p>
        </article>
        <article class="signal-card">
          <p class="signal-label">MacClipper Flow</p>
          <p class="signal-title">Capture on Mac, share anywhere.</p>
          <p class="signal-copy">The goal is a lightweight handoff: clip fast, post once, and let the page do the rest.</p>
        </article>
      </section>
      <section class="stage">
        <div class="player-column">
          <div class="video-shell">
            <video controls autoplay muted playsinline preload="metadata" src="${videoURL}"></video>
          </div>
          <div class="player-meta">
            <div class="meta-cluster">
              <span class="meta-chip"><strong>Format</strong>${escapeHTML(share.fileType)}</span>
              <span class="meta-chip"><strong>Aspect</strong>${escapeHTML(aspectRatioLabel)}</span>
              <span class="meta-chip"><strong>Size</strong>${fileSize}</span>
            </div>
            <div class="meta-chip"><strong>Uploaded</strong>${uploadedAt}</div>
          </div>
        </div>
        <aside class="sidebar">
          <section class="card">
            <h2>Share This Clip</h2>
            <p>Copy the clip link when you want Discord and chat apps to preview the video properly before someone opens it.</p>
            <div class="action-stack">
              <button class="action-button" type="button" data-copy-link data-url="${shareURL}">Copy Clip Link</button>
            </div>
            <div class="link-panel">${shareURL}</div>
            <div class="status-note" data-copy-status>Drop this link in chat when you want Discord to preview the clip before someone clicks through.</div>
          </section>
          <section class="card">
            <h3>Clip Snapshot</h3>
            <div class="stat-grid">
              <div class="stat">
                <span class="stat-label">Orientation</span>
                <span class="stat-value">${escapeHTML(orientationLabel)}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Resolution Hint</span>
                <span class="stat-value">${dimensions.width} x ${dimensions.height}</span>
              </div>
              <div class="stat">
                <span class="stat-label">File Size</span>
                <span class="stat-value">${fileSize}</span>
              </div>
              <div class="stat">
                <span class="stat-label">Host</span>
                <span class="stat-value">MacClipper Cloud</span>
              </div>
            </div>
          </section>
          <section class="card cta-card">
            <h3>Want Your Own Clip Flow?</h3>
            <p>MacClipper is built so the page feels as intentional as the capture. Open the main site to see the full product surface.</p>
            <div class="action-stack">
              <a class="link-button" href="${homeURL}">Open MacClipper</a>
            </div>
          </section>
        </aside>
      </section>
      <div class="footer">
        <span>Drop this link in Discord and the clip can preview inline while still opening as a clean standalone page.</span>
        <a class="link" href="${shareURL}">Refresh clip page</a>
      </div>
    </main>
  </div>
  <script>
    const copyButton = document.querySelector('[data-copy-link]');
    const copyStatus = document.querySelector('[data-copy-status]');

    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        const shareURL = copyButton.getAttribute('data-url') || window.location.href;

        try {
          await navigator.clipboard.writeText(shareURL);
          if (copyStatus) {
            copyStatus.textContent = 'Clip page link copied. Drop it anywhere.';
          }
          copyButton.textContent = 'Copied';
          window.setTimeout(() => {
            copyButton.textContent = 'Copy Clip Page Link';
          }, 1800);
        } catch {
          if (copyStatus) {
            copyStatus.textContent = 'Copy failed here. Use the link block below instead.';
          }
        }
      });
    }
  </script>
</body>
</html>`;
}

function publicSharedClip(record: StoredSharedClipRecord): SharedClipRecord {
  return {
    id: record.id,
    title: record.title,
    orientation: record.orientation,
    uploadedAt: record.uploadedAt,
    fileName: record.fileName,
    fileType: record.fileType,
    fileSize: record.fileSize,
    videoURL: record.videoURL,
    pageURL: record.pageURL,
    shareURL: record.shareURL || record.pageURL
  };
}

function hydrateSharedClipRecord(
  snapshotId: string,
  data: Partial<StoredSharedClipRecord> | undefined,
  urlContext: SharedClipURLContext = {}
): StoredSharedClipRecord | null {
  if (!data) {
    return null;
  }

  const resolvedId = typeof data.id === "string" && data.id ? data.id : snapshotId;
  const resolvedPageURL = urlContext.pageBaseURL
    ? buildSharedClipPageURL(urlContext.pageBaseURL, resolvedId)
    : typeof data.pageURL === "string" && data.pageURL
      ? data.pageURL
      : "";
  const resolvedShareURL = urlContext.shareBaseURL
    ? buildSharedClipPreviewURL(urlContext.shareBaseURL, resolvedId)
    : typeof data.shareURL === "string" && data.shareURL
      ? data.shareURL
      : resolvedPageURL;

  return {
    id: resolvedId,
    appUuid: typeof data.appUuid === "string" ? data.appUuid : "",
    websiteUserId: sanitizeLookupField(data.websiteUserId),
    title: typeof data.title === "string" && data.title ? data.title : "MacClipper Clip",
    orientation: data.orientation === "vertical" ? "vertical" : "horizontal",
    uploadedAt: typeof data.uploadedAt === "string" ? data.uploadedAt : new Date().toISOString(),
    fileName: typeof data.fileName === "string" ? data.fileName : "clip.mp4",
    fileType: typeof data.fileType === "string" ? data.fileType : "video/mp4",
    fileSize: typeof data.fileSize === "number" ? data.fileSize : 0,
    storagePath: typeof data.storagePath === "string" ? data.storagePath : "",
    videoURL: typeof data.videoURL === "string" ? data.videoURL : "",
    pageURL: resolvedPageURL,
    shareURL: resolvedShareURL
  };
}

function buildSharedClipBrandMark(): string {
  return `<svg viewBox="0 0 100 100" role="img">
    <defs>
      <clipPath id="sharedClipBrandClip">
        <rect x="6" y="6" width="88" height="88" rx="20" ry="20"></rect>
      </clipPath>
    </defs>
    <rect x="6" y="6" width="88" height="88" rx="20" ry="20" fill="#1c242b"></rect>
    <g clip-path="url(#sharedClipBrandClip)">
      <path d="M6 6 H74 L49 50 L6 61.5 Z" fill="#2e6d61"></path>
      <path d="M33 94 H94 V47 L55 30 Z" fill="#db6b3d"></path>
      <ellipse cx="49" cy="54" rx="38" ry="36" fill="#ffffff" opacity="0.06"></ellipse>
    </g>
    <path d="M29 39.5 V70.5 H59 M41 30.5 H71 V59.5" fill="none" stroke="#f7edde" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"></path>
    <path d="M39.5 26 H52.5 L65 59 H52 Z" fill="#e6ca8f" stroke="rgba(255,255,255,0.22)" stroke-width="1.4" stroke-linejoin="round"></path>
  </svg>`;
}

function normalizeTextField(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0].trim() : "";
  }
  return "";
}

function sanitizeLookupField(value: unknown): string | undefined {
  const normalized = normalizeTextField(value);
  return normalized || undefined;
}

function resolveFileExtension(originalName: string, mimeType: string): string {
  const rawExtension = path.extname(originalName).replace(/^\./, "").toLowerCase();
  if (rawExtension) {
    return rawExtension;
  }
  if (mimeType === "video/quicktime") {
    return "mov";
  }
  return "mp4";
}

function sanitizeFilenameFragment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "macclipper-clip";
}

function buildStorageDownloadURL(bucketName: string, storagePath: string, downloadToken: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
}

function buildSharedClipPageURL(pageBaseURL: string, shareId: string): string {
  return `${pageBaseURL.replace(/\/+$/, "")}/${encodeURIComponent(shareId)}`;
}

function buildSharedClipPreviewURL(shareBaseURL: string, shareId: string): string {
  return `${shareBaseURL.replace(/\/+$/, "")}/${encodeURIComponent(shareId)}`;
}

function resolveSharedClipHomeURL(pageURL: string): string {
  try {
    const url = new URL(pageURL);
    const normalizedPathname = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${url.host}${normalizedPathname || "/"}`;
  } catch {
    return pageURL;
  }
}

function formatSharedClipDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatSharedClipSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "Unknown";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const rounded = size >= 100 || unitIndex === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHTML(value);
}