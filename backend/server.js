const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT_DIR, "backend");
const RUNTIME_DIR = path.join(BACKEND_DIR, "runtime");
const DATA_DIR_DEFAULT = path.join(RUNTIME_DIR, "data");
const UPLOAD_DIR_DEFAULT = path.join(RUNTIME_DIR, "uploads");
const CONFIG_PATH = path.join(BACKEND_DIR, "config.env");
const RECOVERY_PATH = path.join(BACKEND_DIR, ".config.env.password");
const ACTIVATION_URL_SCHEME = "macclipper://purchase-complete";
const ACCOUNT_STATUS_VALUES = new Set(["active", "banned", "terminated"]);
const SUBSCRIPTION_TIERS = new Set(["free", "pro"]);
const BOT_API_CAPABILITIES = Object.freeze([
  "users.lookup",
  "users.link-discord",
  "users.admin",
  "users.status",
  "users.subscription",
  "users.features.grant",
  "users.features.revoke"
]);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, contents) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, "utf8");
}

function writeJson(filePath, value) {
  writeText(filePath, JSON.stringify(value, null, 2));
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function randomSecret(length = 32) {
  return crypto.randomBytes(length).toString("base64url");
}

function buildDefaultConfig() {
  return {
    PORT: "4173",
    COOKIE_NAME: "macclipper.sid",
    SESSION_SECRET: randomSecret(32),
    MACCLIPPER_BOT_SHARED_SECRET: randomSecret(32),
    MAX_UPLOAD_MB: "512",
    DATA_DIR: DATA_DIR_DEFAULT,
    UPLOAD_DIR: UPLOAD_DIR_DEFAULT
  };
}

function toEnvString(values) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${String(value).replaceAll("\n", "")}`)
    .join("\n");
}

function parseEnvString(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((accumulator, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        return accumulator;
      }
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      accumulator[key] = value;
      return accumulator;
    }, {});
}

function encryptConfig(plainText, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const payload = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify(
    {
      version: 1,
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      payload: payload.toString("hex")
    },
    null,
    2
  );
}

function decryptConfig(encryptedText, password) {
  const parsed = JSON.parse(encryptedText);
  const salt = Buffer.from(parsed.salt, "hex");
  const iv = Buffer.from(parsed.iv, "hex");
  const tag = Buffer.from(parsed.tag, "hex");
  const payload = Buffer.from(parsed.payload, "hex");
  const key = crypto.scryptSync(password, salt, 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
}

function ensureLockedConfig() {
  ensureDir(BACKEND_DIR);

  if (!fileExists(RECOVERY_PATH)) {
    const password = randomSecret(18);
    writeText(
      RECOVERY_PATH,
      [
        "MacClipper locked config recovery file",
        "If you forget the config password, use the value below.",
        password
      ].join("\n")
    );
  }

  const recoveryPassword = fs.readFileSync(RECOVERY_PATH, "utf8").trim().split(/\r?\n/).pop();

  if (!fileExists(CONFIG_PATH)) {
    const defaultConfig = buildDefaultConfig();
    writeText(CONFIG_PATH, encryptConfig(toEnvString(defaultConfig), recoveryPassword));
  }

  const defaultConfig = buildDefaultConfig();
  const parsedConfig = parseEnvString(decryptConfig(fs.readFileSync(CONFIG_PATH, "utf8"), recoveryPassword));
  const mergedConfig = { ...defaultConfig, ...parsedConfig };

  const isMissingConfigKey = Object.keys(defaultConfig).some((key) => !(key in parsedConfig));
  if (isMissingConfigKey) {
    writeText(CONFIG_PATH, encryptConfig(toEnvString(mergedConfig), recoveryPassword));
  }

  return { recoveryPassword, config: mergedConfig };
}

const { config } = ensureLockedConfig();

const DATA_DIR = config.DATA_DIR || DATA_DIR_DEFAULT;
const UPLOAD_DIR = config.UPLOAD_DIR || UPLOAD_DIR_DEFAULT;
const USERS_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const VIDEOS_FILE = path.join(DATA_DIR, "videos.json");
const APP_INSTALLATIONS_FILE = path.join(DATA_DIR, "app-installations.json");
const COOKIE_NAME = config.COOKIE_NAME || "macclipper.sid";
const MAX_UPLOAD_MB = Number(config.MAX_UPLOAD_MB || 512);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

ensureDir(DATA_DIR);
ensureDir(UPLOAD_DIR);
if (!fileExists(USERS_FILE)) writeJson(USERS_FILE, []);
if (!fileExists(SESSIONS_FILE)) writeJson(SESSIONS_FILE, []);
if (!fileExists(VIDEOS_FILE)) writeJson(VIDEOS_FILE, []);
if (!fileExists(APP_INSTALLATIONS_FILE)) writeJson(APP_INSTALLATIONS_FILE, []);

if (process.argv.includes("--init-only")) {
  console.log(`Locked config ready at ${CONFIG_PATH}`);
  console.log(`Recovery password file ready at ${RECOVERY_PATH}`);
  process.exit(0);
}

if (process.argv.includes("--print-bot-secret")) {
  console.log(config.MACCLIPPER_BOT_SHARED_SECRET || "");
  process.exit(0);
}

function loadUsers() {
  return readJson(USERS_FILE, []).map(normalizeUserRecord);
}

function saveUsers(users) {
  writeJson(USERS_FILE, users.map(normalizeUserRecord));
}

function loadSessions() {
  return readJson(SESSIONS_FILE, []);
}

function saveSessions(sessions) {
  writeJson(SESSIONS_FILE, sessions);
}

function loadVideos() {
  return readJson(VIDEOS_FILE, []).sort((left, right) => new Date(right.uploadedAt) - new Date(left.uploadedAt));
}

function saveVideos(videos) {
  writeJson(VIDEOS_FILE, videos);
}

function loadAppInstallations() {
  return readJson(APP_INSTALLATIONS_FILE, [])
    .map(normalizeAppInstallationRecord)
    .filter((installation) => installation.machineIdentifier);
}

function saveAppInstallations(installations) {
  writeJson(APP_INSTALLATIONS_FILE, installations.map(normalizeAppInstallationRecord));
}

function sanitizeText(value, fallback = "") {
  return String(value || "").trim() || fallback;
}

function normalizeAccountStatus(value) {
  const normalized = sanitizeText(value, "active").toLowerCase();
  return ACCOUNT_STATUS_VALUES.has(normalized) ? normalized : "active";
}

function normalizeSubscriptionTier(value) {
  const normalized = sanitizeText(value, "free").toLowerCase();
  return SUBSCRIPTION_TIERS.has(normalized) ? normalized : "free";
}

function normalizeRole(value) {
  return sanitizeText(value, "user").toLowerCase() === "admin" ? "admin" : "user";
}

function normalizeFeatureKey(value) {
  return sanitizeText(value).toLowerCase();
}

function normalizeUuid(value, fallback = crypto.randomUUID()) {
  const normalized = sanitizeText(value).toLowerCase();
  return UUID_PATTERN.test(normalized) ? normalized : fallback.toLowerCase();
}

function normalizeMachineIdentifier(value) {
  return sanitizeText(value).toLowerCase();
}

function normalizeFeatureKeys(values) {
  const source = Array.isArray(values) ? values : [];
  return Array.from(new Set(source.map(normalizeFeatureKey).filter(Boolean))).sort();
}

function defaultPaidFeaturesForTier(tier) {
  return normalizeSubscriptionTier(tier) === "pro" ? ["4k-pro"] : [];
}

function normalizeUserRecord(user) {
  const id = sanitizeText(user.id, crypto.randomUUID());
  // Only set Pro if explicitly set, not based on paidFeatures
  const subscriptionTier = normalizeSubscriptionTier(user.subscriptionTier);
  // Only grant paid features if tier is pro
  const paidFeatures = normalizeFeatureKeys([
    ...defaultPaidFeaturesForTier(subscriptionTier),
    ...(Array.isArray(user.paidFeatures) ? user.paidFeatures : [])
  ]);

  return {
    id,
    appUuid: normalizeUuid(user.appUuid, id),
    displayName: sanitizeText(user.displayName, "Creator"),
    email: sanitizeText(user.email).toLowerCase(),
    passwordHash: sanitizeText(user.passwordHash),
    createdAt: sanitizeText(user.createdAt, new Date().toISOString()),
    updatedAt: sanitizeText(user.updatedAt, user.createdAt || new Date().toISOString()),
    role: normalizeRole(user.role || (user.isAdmin ? "admin" : "user")),
    accountStatus: normalizeAccountStatus(user.accountStatus),
    subscriptionTier,
    paidFeatures,
    discordUserId: sanitizeText(user.discordUserId),
    discordUsername: sanitizeText(user.discordUsername)
  };
}

function normalizeAppInstallationRecord(installation) {
  const createdAt = sanitizeText(installation.createdAt, new Date().toISOString());
  const updatedAt = sanitizeText(installation.updatedAt, createdAt);
  const lastSeenAt = sanitizeText(installation.lastSeenAt, updatedAt);
  const subscriptionTier = normalizeSubscriptionTier(
    installation.subscriptionTier || (Array.isArray(installation.paidFeatures) && installation.paidFeatures.length ? "pro" : "free")
  );
  const paidFeatures = normalizeFeatureKeys([
    ...defaultPaidFeaturesForTier(subscriptionTier),
    ...(Array.isArray(installation.paidFeatures) ? installation.paidFeatures : [])
  ]);

  return {
    id: sanitizeText(installation.id, crypto.randomUUID()),
    appUuid: normalizeUuid(installation.appUuid),
    machineIdentifier: normalizeMachineIdentifier(installation.machineIdentifier),
    machineName: sanitizeText(installation.machineName, "Mac"),
    machineModel: sanitizeText(installation.machineModel),
    systemVersion: sanitizeText(installation.systemVersion),
    appVersion: sanitizeText(installation.appVersion),
    buildVersion: sanitizeText(installation.buildVersion),
    role: normalizeRole(installation.role),
    accountStatus: normalizeAccountStatus(installation.accountStatus),
    subscriptionTier,
    paidFeatures,
    discordUserId: sanitizeText(installation.discordUserId),
    discordUsername: sanitizeText(installation.discordUsername),
    createdAt,
    updatedAt,
    lastSeenAt
  };
}

function countUserClips(userId) {
  return loadVideos().filter((video) => video.uploaderId === userId).length;
}

function publicUser(user) {
  return {
    id: user.id,
    appUuid: user.appUuid || user.id,
    displayName: user.displayName,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    role: user.role,
    accountStatus: user.accountStatus,
    subscriptionTier: user.subscriptionTier,
    paidFeatures: user.paidFeatures,
    discordUserId: user.discordUserId || "",
    discordUsername: user.discordUsername || "",
    clipCount: countUserClips(user.id)
  };
}

function publicEntitlementUser(user) {
  return {
    id: user.id,
    accountStatus: user.accountStatus,
    subscriptionTier: user.subscriptionTier,
    paidFeatures: user.paidFeatures,
    updatedAt: user.updatedAt
  };
}

function publicEntitlementInstallation(installation) {
  return {
    id: "",
    accountStatus: installation.accountStatus,
    subscriptionTier: installation.subscriptionTier,
    paidFeatures: installation.paidFeatures,
    updatedAt: installation.updatedAt
  };
}

function linkedUserIdForAppUuid(appUuid) {
  const normalizedAppUuid = normalizeUuid(appUuid);
  const matchingUser = loadUsers().find((user) => (user.appUuid || user.id) === normalizedAppUuid);
  return matchingUser?.id || "";
}

function publicAppInstallation(installation) {
  return {
    id: installation.id,
    appUuid: installation.appUuid,
    machineIdentifier: installation.machineIdentifier,
    machineName: installation.machineName,
    machineModel: installation.machineModel,
    systemVersion: installation.systemVersion,
    appVersion: installation.appVersion,
    buildVersion: installation.buildVersion,
    role: installation.role,
    accountStatus: installation.accountStatus,
    subscriptionTier: installation.subscriptionTier,
    paidFeatures: installation.paidFeatures,
    discordUserId: installation.discordUserId || "",
    discordUsername: installation.discordUsername || "",
    // websiteUserId removed: use only appUuid
    createdAt: installation.createdAt,
    updatedAt: installation.updatedAt,
    lastSeenAt: installation.lastSeenAt
  };
}

function publicStandaloneAppUser(installation) {
  return {
    id: installation.id,
    appUuid: installation.appUuid,
    displayName: installation.machineName || "Mac",
    email: "Local app install",
    createdAt: installation.createdAt,
    updatedAt: installation.updatedAt,
    role: installation.role,
    accountStatus: installation.accountStatus,
    subscriptionTier: installation.subscriptionTier,
    paidFeatures: installation.paidFeatures,
    discordUserId: installation.discordUserId || "",
    discordUsername: installation.discordUsername || "",
    clipCount: 0,
    machineIdentifier: installation.machineIdentifier,
    machineName: installation.machineName,
    machineModel: installation.machineModel,
    systemVersion: installation.systemVersion,
    appVersion: installation.appVersion,
    buildVersion: installation.buildVersion,
    standaloneInstallation: true
  };
}

function nextAvailableAppUuid(installations, machineIdentifier) {
  let candidate = normalizeUuid(null);

  while (installations.some((entry) => entry.machineIdentifier !== machineIdentifier && entry.appUuid === candidate)) {
    candidate = normalizeUuid(null);
  }

  return candidate;
}

function revokeSessionsForUser(userId) {
  saveSessions(loadSessions().filter((entry) => entry.userId !== userId));
}

function parseUserLookup(source) {
  const candidates = [
    ["email", sanitizeText(source.email).toLowerCase()],
    ["userId", sanitizeText(source.userId)],
    ["appUuid", sanitizeText(source.appUuid)],
    ["discordUserId", sanitizeText(source.discordUserId)]
  ].filter(([, value]) => value);

  if (candidates.length !== 1) {
    throw new Error("Provide exactly one lookup target: email, userId, appUuid, or discordUserId.");
  }

  const [key, value] = candidates[0];
  return { key, value };
}

function findUserIndex(users, lookup) {
  switch (lookup.key) {
    case "email":
      return users.findIndex((user) => user.email === lookup.value);
    case "userId":
      return users.findIndex((user) => user.id === lookup.value);
    case "appUuid":
      return users.findIndex((user) => (user.appUuid || user.id) === lookup.value);
    case "discordUserId":
      return users.findIndex((user) => user.discordUserId === lookup.value);
    default:
      return -1;
  }
}

function findAppInstallationIndex(installations, lookup) {
  switch (lookup.key) {
    case "appUuid":
      return installations.findIndex((installation) => installation.appUuid === lookup.value);
    case "discordUserId":
      return installations.findIndex((installation) => installation.discordUserId === lookup.value);
    default:
      return -1;
  }
}

function requireExistingUser(source) {
  const users = loadUsers();
  const lookup = parseUserLookup(source);
  const index = findUserIndex(users, lookup);

  if (index === -1) {
    throw new Error("MacClipper user not found.");
  }

  return { users, index, user: users[index] };
}

function requireExistingAccount(source) {
  const lookup = parseUserLookup(source);
  const users = loadUsers();
  const userIndex = findUserIndex(users, lookup);

  if (userIndex !== -1) {
    return { kind: "user", users, index: userIndex, account: users[userIndex] };
  }

  const installations = loadAppInstallations();
  const installationIndex = findAppInstallationIndex(installations, lookup);

  if (installationIndex !== -1) {
    return { kind: "installation", installations, index: installationIndex, account: installations[installationIndex] };
  }

  throw new Error("MacClipper user not found.");
}

function persistUser(users, index, updates) {
  const nextUser = normalizeUserRecord({
    ...users[index],
    ...updates,
    updatedAt: new Date().toISOString()
  });
  users[index] = nextUser;
  saveUsers(users);
  return nextUser;
}

function persistAppInstallation(installations, index, updates) {
  const nextInstallation = normalizeAppInstallationRecord({
    ...installations[index],
    ...updates,
    updatedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  });
  installations[index] = nextInstallation;
  saveAppInstallations(installations);
  return nextInstallation;
}

function persistAccount(accountContext, updates) {
  if (accountContext.kind === "user") {
    return { kind: "user", account: persistUser(accountContext.users, accountContext.index, updates) };
  }

  return { kind: "installation", account: persistAppInstallation(accountContext.installations, accountContext.index, updates) };
}

function publicAccount(accountContext) {
  if (accountContext.kind === "user") {
    return publicUser(accountContext.account);
  }

  return publicStandaloneAppUser(accountContext.account);
}

function buildActivationURL(userId, feature) {
  const normalizedUserId = sanitizeText(userId);
  const normalizedFeature = normalizeFeatureKey(feature);
  const matchingUser = loadUsers().find((entry) => entry.id === normalizedUserId);
  const query = new URLSearchParams();

  if (normalizedUserId) {
    query.set("userId", normalizedUserId);
  }

  if (matchingUser?.appUuid || normalizedUserId) {
    query.set("appUuid", matchingUser?.appUuid || normalizedUserId);
  }

  if (normalizedFeature) {
    query.set("feature", normalizedFeature);
  }

  return `${ACTIVATION_URL_SCHEME}?${query.toString()}`;
}

function publicVideo(video) {
  return {
    id: video.id,
    title: video.title,
    game: video.game,
    description: video.description,
    visibility: video.visibility,
    uploadedAt: video.uploadedAt,
    uploaderId: video.uploaderId,
    uploaderName: video.uploaderName,
    fileName: video.fileName,
    fileType: video.fileType,
    fileSize: video.fileSize,
    videoUrl: video.videoUrl
  };
}

function getSessionUser(request) {
  const sessionToken = request.cookies[COOKIE_NAME];
  if (!sessionToken) {
    return null;
  }

  const sessions = loadSessions();
  const session = sessions.find((entry) => entry.token === sessionToken);
  if (!session) {
    return null;
  }

  const users = loadUsers();
  const user = users.find((entry) => entry.id === session.userId) || null;
  if (!user) {
    return null;
  }

  if (user.accountStatus !== "active") {
    saveSessions(sessions.filter((entry) => entry.token !== sessionToken));
    return null;
  }

  return user;
}

function requireAuth(request, response, next) {
  const user = getSessionUser(request);
  if (!user) {
    response.status(401).json({ error: "You need to sign in first." });
    return;
  }

  request.currentUser = user;
  next();
}

function requireTokenAuth(request, response, next) {
  const header = String(request.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  
  if (!token) {
    response.status(401).json({ error: "API token required. Include 'Authorization: Bearer YOUR_TOKEN' header." });
    return;
  }

  const users = loadUsers();
  const user = users.find((user) => user.apiToken === token);
  
  if (!user) {
    response.status(401).json({ error: "Invalid API token." });
    return;
  }

  request.currentUser = user;
  next();
}

function requireAuthOrToken(request, response, next) {
  // Try session auth first
  const sessionUser = getSessionUser(request);
  if (sessionUser) {
    request.currentUser = sessionUser;
    next();
    return;
  }

  // Try token auth
  const header = String(request.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  
  if (token) {
    const users = loadUsers();
    const tokenUser = users.find((user) => user.apiToken === token);
    if (tokenUser) {
      request.currentUser = tokenUser;
      next();
      return;
    }
  }

  response.status(401).json({ error: "Authentication required. Sign in or provide a valid API token." });
}

function requireBotAuth(request, response, next) {
  const configuredSecret = sanitizeText(config.MACCLIPPER_BOT_SHARED_SECRET);
  if (!configuredSecret) {
    response.status(503).json({ error: "The bot API secret is not configured yet." });
    return;
  }

  const header = String(request.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token !== configuredSecret) {
    response.status(401).json({ error: "Bot API authorization failed." });
    return;
  }

  next();
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase() || ".mp4";
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();
    const isVideo = file.mimetype.startsWith("video/") || [".mp4", ".mov", ".m4v", ".webm"].includes(extension);

    if (!isVideo) {
      callback(new Error("Only video files can be uploaded."));
      return;
    }

    callback(null, true);
  }
});

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser(config.SESSION_SECRET));
app.use("/media", express.static(UPLOAD_DIR));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/bot/health", (_request, response) => {
  response.json({
    ok: true,
    service: "macclipper-app-bot-api",
    capabilities: BOT_API_CAPABILITIES,
  });
});

app.get("/api/auth/me", (request, response) => {
  const user = getSessionUser(request);
  response.json({ user: user ? publicUser(user) : null });
});

app.get("/dashboard", requireAuth, (request, response) => {
  response.sendFile(path.join(__dirname, "dashboard.html"));
});

app.post("/api/app-installations/resolve", (request, response) => {
  const machineIdentifier = normalizeMachineIdentifier(request.body.machineIdentifier);
  if (!machineIdentifier) {
    response.status(400).json({ error: "machineIdentifier is required." });
    return;
  }

  const machineName = sanitizeText(request.body.machineName, "Mac");
  const machineModel = sanitizeText(request.body.machineModel);
  const systemVersion = sanitizeText(request.body.systemVersion);
  const appVersion = sanitizeText(request.body.appVersion);
  const buildVersion = sanitizeText(request.body.buildVersion);
  const installations = loadAppInstallations();
  const index = installations.findIndex((entry) => entry.machineIdentifier === machineIdentifier);
  const timestamp = new Date().toISOString();

  if (index !== -1) {
    const nextInstallation = normalizeAppInstallationRecord({
      ...installations[index],
      machineName,
      machineModel,
      systemVersion,
      appVersion,
      buildVersion,
      updatedAt: timestamp,
      lastSeenAt: timestamp
    });
    installations[index] = nextInstallation;
    saveAppInstallations(installations);
    response.json({ installation: publicAppInstallation(nextInstallation) });
    return;
  }

  const appUuid = nextAvailableAppUuid(installations, machineIdentifier);
  const installation = normalizeAppInstallationRecord({
    id: crypto.randomUUID(),
    appUuid,
    machineIdentifier,
    machineName,
    machineModel,
    systemVersion,
    appVersion,
    buildVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp
  });

  installations.push(installation);
  saveAppInstallations(installations);
  response.status(201).json({ installation: publicAppInstallation(installation) });
});

app.post("/api/auth/signup", (request, response) => {
  const displayName = sanitizeText(request.body.displayName);
  const email = sanitizeText(request.body.email).toLowerCase();
  const password = sanitizeText(request.body.password);

  if (!displayName || !email || !password) {
    response.status(400).json({ error: "Display name, email, and password are required." });
    return;
  }

  const users = loadUsers();
  if (users.some((user) => user.email === email)) {
    response.status(409).json({ error: "That email already exists. Sign in instead." });
    return;
  }

  const user = {
    id: crypto.randomUUID(),
    displayName,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    apiToken: randomSecret(32),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    role: "user",
    accountStatus: "active",
    subscriptionTier: "free",
    paidFeatures: [],
    discordUserId: "",
    discordUsername: ""
  };

  users.push(user);
  saveUsers(users);

  const sessions = loadSessions();
  const token = randomSecret(24);
  sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  saveSessions(sessions);

  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  });

  response.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/signin", (request, response) => {
  const email = sanitizeText(request.body.email).toLowerCase();
  const password = sanitizeText(request.body.password);
  const users = loadUsers();
  const user = users.find((entry) => entry.email === email);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    response.status(401).json({ error: "Invalid email or password." });
    return;
  }

  if (user.accountStatus !== "active") {
    const message = user.accountStatus === "banned"
      ? "This account is banned from signing in."
      : "This account has been terminated. Contact support if you think this is wrong.";
    response.status(403).json({ error: message });
    return;
  }

  const sessions = loadSessions().filter((entry) => entry.userId !== user.id);
  const token = randomSecret(24);
  sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
  saveSessions(sessions);

  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  });

  response.json({ user: publicUser(user) });
});

app.post("/api/auth/signout", (request, response) => {
  const sessionToken = request.cookies[COOKIE_NAME];
  if (sessionToken) {
    saveSessions(loadSessions().filter((entry) => entry.token !== sessionToken));
  }

  response.clearCookie(COOKIE_NAME);
  response.json({ ok: true });
});

app.post("/api/auth/generate-token", requireAuth, (request, response) => {
  const users = loadUsers();
  const userIndex = users.findIndex((user) => user.id === request.currentUser.id);
  
  if (userIndex === -1) {
    response.status(404).json({ error: "User not found." });
    return;
  }

  // Generate new API token
  const newToken = randomSecret(32);
  users[userIndex].apiToken = newToken;
  users[userIndex].updatedAt = new Date().toISOString();
  
  saveUsers(users);
  
  response.json({ 
    apiToken: newToken,
    message: "New API token generated. Copy this token now - it won't be shown again for security."
  });
});

app.post("/api/auth/app-uuid", requireAuth, (request, response) => {
  const appUuid = sanitizeText(request.body.appUuid).toLowerCase();
  if (!appUuid) {
    response.status(400).json({ error: "appUuid is required." });
    return;
  }

  const users = loadUsers();
  const index = users.findIndex((entry) => entry.id === request.currentUser.id);
  if (index === -1) {
    response.status(404).json({ error: "MacClipper user not found." });
    return;
  }

  const duplicateUser = users.find((entry) => (entry.appUuid || entry.id) === appUuid && entry.id !== request.currentUser.id);
  if (duplicateUser) {
    response.status(409).json({ error: "That app UUID is already linked to another account." });
    return;
  }

  const nextUser = persistUser(users, index, { appUuid });
  response.json({ user: publicUser(nextUser) });
});

function unlinkCurrentWebsiteUser(request, response) {
  const requestedWebsiteUserId = sanitizeText(request.body.websiteUserId || request.query.websiteUserId);
  if (!requestedWebsiteUserId) {
    response.status(400).json({ error: "websiteUserId is required." });
    return;
  }

  if (requestedWebsiteUserId !== request.currentUser.id) {
    response.status(403).json({ error: "websiteUserId does not match current user." });
    return;
  }

  const users = loadUsers();
  const index = users.findIndex((entry) => entry.id === request.currentUser.id);
  if (index === -1) {
    response.status(404).json({ error: "MacClipper user not found." });
    return;
  }

  const nextUser = persistUser(users, index, { appUuid: request.currentUser.id });
  response.status(200).json({ user: publicUser(nextUser) });
}

app.delete("/api/app-link", requireAuth, (request, response) => {
  unlinkCurrentWebsiteUser(request, response);
});

app.post("/api/app-link/unlink", requireAuth, (request, response) => {
  unlinkCurrentWebsiteUser(request, response);
});

app.get("/api/entitlements/by-user-id", (request, response) => {
  const userId = sanitizeText(request.query.userId);
  const appUuid = sanitizeText(request.query.appUuid);
  const hasUserId = userId.length > 0;
  const hasAppUuid = appUuid.length > 0;

  if ((hasUserId ? 1 : 0) + (hasAppUuid ? 1 : 0) !== 1) {
    response.status(400).json({ error: "Provide exactly one of userId or appUuid." });
    return;
  }

  if (hasUserId) {
    const user = loadUsers().find((entry) => entry.id === userId);
    if (!user) {
      response.status(404).json({ error: "MacClipper user not found." });
      return;
    }

    response.json({ user: publicEntitlementUser(user) });
    return;
  }

  const user = loadUsers().find((entry) => (entry.appUuid || entry.id) === appUuid);
  if (user) {
    response.json({ user: publicEntitlementUser(user) });
    return;
  }

  const installation = loadAppInstallations().find((entry) => entry.appUuid === appUuid);
  if (!installation) {
    response.status(404).json({ error: "MacClipper user not found." });
    return;
  }

  response.json({ user: publicEntitlementInstallation(installation) });
});

app.get("/api/entitlements/activation-link", requireAuth, (request, response) => {
  const feature = normalizeFeatureKey(request.query.feature || "4k-pro");
  if (!feature) {
    response.status(400).json({ error: "feature is required." });
    return;
  }

  if (!request.currentUser.paidFeatures.includes(feature)) {
    response.status(403).json({ error: "That feature is not active on this account yet." });
    return;
  }

  response.json({
    user: publicUser(request.currentUser),
    message: "Open this in MacClipper to refresh this install's entitlements.",
    activationURL: buildActivationURL(request.currentUser.id, feature)
  });
});

app.post("/api/purchases/4k-pro/complete", requireAuth, (request, response) => {
  const users = loadUsers();
  const index = users.findIndex((entry) => entry.id === request.currentUser.id);
  if (index === -1) {
    response.status(404).json({ error: "MacClipper user not found." });
    return;
  }

  // Replace this simulated purchase grant with a Stripe Checkout/session verification flow when payments go live.
  const nextUser = persistUser(users, index, {
    subscriptionTier: "pro",
    paidFeatures: normalizeFeatureKeys(["4k-pro", ...users[index].paidFeatures])
  });

  response.json({
    user: publicUser(nextUser),
    message: "Purchase recorded. Open MacClipper so it can refresh this install's entitlements.",
    activationURL: buildActivationURL(nextUser.id, "4k-pro")
  });
});

app.get("/api/bot/users/lookup", requireBotAuth, (request, response) => {
  try {
    const account = requireExistingAccount(request.query);
    response.json({ user: publicAccount(account) });
  } catch (error) {
    response.status(error.message === "MacClipper user not found." ? 404 : 400).json({ error: error.message });
  }
});

app.post("/api/bot/users/link-discord", requireBotAuth, (request, response) => {
  const discordUserId = sanitizeText(request.body.discordUserId);
  const discordUsername = sanitizeText(request.body.discordUsername);
  if (!discordUserId || !discordUsername) {
    response.status(400).json({ error: "discordUserId and discordUsername are required." });
    return;
  }

  try {
    const account = requireExistingAccount(request.body);
    const nextAccount = persistAccount(account, {
      discordUserId,
      discordUsername
    });
    response.json({ user: publicAccount(nextAccount) });
  } catch (error) {
    response.status(error.message === "MacClipper user not found." ? 404 : 400).json({ error: error.message });
  }
});

app.post("/api/bot/users/admin", requireBotAuth, (request, response) => {
  const enabled = Boolean(request.body.enabled);

  try {
    const account = requireExistingAccount(request.body);
    const nextAccount = persistAccount(account, {
      role: enabled ? "admin" : "user"
    });
    response.json({ user: publicAccount(nextAccount) });
  } catch (error) {
    response.status(error.message === "MacClipper user not found." ? 404 : 400).json({ error: error.message });
  }
});

app.post("/api/bot/users/status", requireBotAuth, (request, response) => {
  const accountStatus = normalizeAccountStatus(request.body.status);

  try {
    const account = requireExistingAccount(request.body);
    const currentAccount = account.account;
    const updates = { accountStatus };

    if (accountStatus === "terminated") {
      updates.role = "user";
      updates.subscriptionTier = "free";
      updates.paidFeatures = [];
    }

    const nextAccount = persistAccount(account, updates);
    if (account.kind === "user" && accountStatus !== "active") {
      revokeSessionsForUser(currentAccount.id);
    }

    response.json({ user: publicAccount(nextAccount) });
  } catch (error) {
    response.status(error.message === "MacClipper user not found." ? 404 : 400).json({ error: error.message });
  }
});

app.post("/api/bot/users/subscription", requireBotAuth, (request, response) => {
  const subscriptionTier = normalizeSubscriptionTier(request.body.subscriptionTier);
  const customFeatures = Array.isArray(request.body.paidFeatures)
    ? normalizeFeatureKeys(request.body.paidFeatures)
    : null;
  const paidFeatures = normalizeFeatureKeys([
    ...defaultPaidFeaturesForTier(subscriptionTier),
    ...(customFeatures || [])
  ]);

  try {
    const account = requireExistingAccount(request.body);
    const nextAccount = persistAccount(account, {
      subscriptionTier,
      paidFeatures
    });
    response.json({ user: publicAccount(nextAccount) });
  } catch (error) {
    response.status(error.message === "MacClipper user not found." ? 404 : 400).json({ error: error.message });
  }
});

app.post("/api/bot/users/features/grant", requireBotAuth, (request, response) => {
  const feature = normalizeFeatureKey(request.body.feature);
  if (!feature) {
    response.status(400).json({ error: "feature is required." });
    return;
  }

  try {
    const account = requireExistingAccount(request.body);
    const currentAccount = account.account;
    const nextAccount = persistAccount(account, {
      subscriptionTier: feature === "4k-pro" ? "pro" : currentAccount.subscriptionTier,
      paidFeatures: normalizeFeatureKeys([feature, ...currentAccount.paidFeatures])
    });

    const responsePayload = { user: publicAccount(nextAccount) };
    if (nextAccount.kind === "user") {
      responsePayload.activationURL = buildActivationURL(nextAccount.account.id, feature);
    }

    response.json(responsePayload);
  } catch (error) {
    response.status(error.message === "MacClipper user not found." ? 404 : 400).json({ error: error.message });
  }
});

app.post("/api/bot/users/features/revoke", requireBotAuth, (request, response) => {
  const feature = normalizeFeatureKey(request.body.feature);
  if (!feature) {
    response.status(400).json({ error: "feature is required." });
    return;
  }

  try {
    const account = requireExistingAccount(request.body);
    const currentAccount = account.account;
    const remainingFeatures = normalizeFeatureKeys(currentAccount.paidFeatures.filter((entry) => entry !== feature));
    const nextAccount = persistAccount(account, {
      subscriptionTier: feature === "4k-pro" && remainingFeatures.length === 0 ? "free" : currentAccount.subscriptionTier,
      paidFeatures: remainingFeatures
    });
    response.json({ user: publicAccount(nextAccount) });
  } catch (error) {
    response.status(error.message === "MacClipper user not found." ? 404 : 400).json({ error: error.message });
  }
});

app.get("/api/videos", (request, response) => {
  const currentUser = getSessionUser(request);
  const mineOnly = request.query.mine === "1";
  const videos = mineOnly && currentUser
    ? loadVideos().filter((video) => video.uploaderId === currentUser.id)
    : loadVideos();

  response.json({ videos: videos.map(publicVideo) });
});

app.get("/api/videos/:id", (request, response) => {
  const video = loadVideos().find((entry) => entry.id === request.params.id);
  if (!video) {
    response.status(404).json({ error: "Clip not found." });
    return;
  }

  response.json({ video: publicVideo(video) });
});

app.post("/api/videos", requireAuthOrToken, upload.single("video"), (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: "Pick a video file first." });
    return;
  }

  const video = {
    id: crypto.randomUUID(),
    title: sanitizeText(request.body.title, path.parse(request.file.originalname).name || "Untitled clip"),
    game: sanitizeText(request.body.game, "Clip"),
    description: sanitizeText(request.body.description),
    visibility: sanitizeText(request.body.visibility, "Public"),
    uploadedAt: new Date().toISOString(),
    uploaderId: request.currentUser.id,
    uploaderName: request.currentUser.displayName,
    fileName: request.file.originalname,
    storedName: request.file.filename,
    fileType: request.file.mimetype,
    fileSize: request.file.size,
    videoUrl: `/media/${request.file.filename}`
  };

  const videos = loadVideos();
  videos.push(video);
  saveVideos(videos);

  response.status(201).json({ video: publicVideo(video) });
});

app.delete("/api/videos/:id", requireAuth, (request, response) => {
  const videos = loadVideos();
  const target = videos.find((entry) => entry.id === request.params.id);

  if (!target) {
    response.status(404).json({ error: "Clip not found." });
    return;
  }

  if (target.uploaderId !== request.currentUser.id) {
    response.status(403).json({ error: "You can only delete your own clips." });
    return;
  }

  const nextVideos = videos.filter((entry) => entry.id !== target.id);
  saveVideos(nextVideos);

  try {
    fs.unlinkSync(path.join(UPLOAD_DIR, target.storedName));
  } catch {
    // Ignore missing files so metadata deletion still succeeds.
  }

  response.json({ ok: true });
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(400).json({ error: `Video is too large. Max upload is ${MAX_UPLOAD_MB} MB.` });
    return;
  }

  if (error) {
    response.status(400).json({ error: error.message || "Request failed." });
    return;
  }

  response.status(500).json({ error: "Unexpected server error." });
});


// In-memory store for pending Discord link codes (for demo; use persistent store for production)
const pendingDiscordLinks = new Map();

// POST /api/bot/discord-link/start
// Body: { discordUserId, discordUsername }
// Returns: { linkURL, code }
app.post("/api/bot/discord-link/start", requireBotAuth, (request, response) => {
  const discordUserId = sanitizeText(request.body.discordUserId);
  const discordUsername = sanitizeText(request.body.discordUsername);
  if (!discordUserId || !discordUsername) {
    response.status(400).json({ error: "discordUserId and discordUsername are required." });
    return;
  }

  // Generate a unique code for linking
  const code = randomSecret(24);
  // Store the code with Discord info (expires in 10 min)
  pendingDiscordLinks.set(code, {
    discordUserId,
    discordUsername,
    createdAt: Date.now()
  });
  setTimeout(() => pendingDiscordLinks.delete(code), 10 * 60 * 1000); // auto-expire

  // Construct the link URL for the website to handle
  const linkURL = `https://macclipper.com/discord-link/verify?code=${encodeURIComponent(code)}`;
  response.json({ linkURL, code });
});

const port = Number(config.PORT || 4173);
app.listen(port, () => {
  console.log(`MacClipper web server running at http://127.0.0.1:${port}`);
  console.log(`Locked config file: ${CONFIG_PATH}`);
  console.log(`Recovery password file: ${RECOVERY_PATH}`);
});