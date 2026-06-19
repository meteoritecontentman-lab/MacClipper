#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
import { createTransport } from "nodemailer";
import { homedir } from "os";
import { join, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");
const ENV_PATH = join(ROOT, "functions", ".env");

function loadEnv(path) {
  const text = readFileSync(path, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnv(ENV_PATH);

const SUPABASE_URL = "https://ccnuqjmqmylergzatpua.supabase.co";
const SERVICE_ROLE_KEY = process.env.MACCLIPPER_SUPABASE_SERVICE_ROLE_KEY;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM = process.env.BILLING_EMAIL_FROM || "support@macclipper.co";

const DOWNLOADS = join(homedir(), "Downloads");
const SCREENSHOTS = [
  { name: "CommunityPage-ClipPage", file: "MacClipper-CommunityPage-ClipPage.png", cid: "screenshot1" },
  { name: "CommunityPage", file: "MacClipper-CommunityPage.png", cid: "screenshot2" },
  { name: "ClipPage", file: "MacClipper-ClipPage.png", cid: "screenshot3" },
];

async function fetchAuthUsers() {
  const url = `${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase admin API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.users || []).map((u) => ({
    id: u.id,
    email: (u.email || "").toLowerCase().trim(),
    created_at: u.created_at,
  })).filter((u) => u.email);
}

function buildHtml() {
  const iconURL = "https://media.base44.com/images/public/user_69840c94143af1fbc044bd6f/cf2d115fa_AppIcon_1024x1024x32.png";
  const screenshotRows = SCREENSHOTS.map((s) => `
    <tr>
      <td style="padding: 10px 0;">
        <h3 style="margin: 0 0 8px 0; font-size: 15px; color: #ffe7a6;">${s.name}</h3>
        <img src="cid:${s.cid}" alt="${s.name}" style="width: 100%; max-width: 560px; border-radius: 12px; border: 1px solid rgba(255,198,92,0.25); display: block;" />
      </td>
    </tr>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>MacClipper Update</title></head>
<body style="margin:0;padding:0;background:#0e0a04;font-family:Arial,sans-serif;color:#f4efe3;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0e0a04;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:linear-gradient(180deg,#24180a 0%,#171008 100%);border:1px solid rgba(255,198,92,0.25);border-radius:22px;overflow:hidden;">
<tr><td style="padding:36px 28px 10px 28px;text-align:center;">
<img src="${iconURL}" alt="MacClipper" width="72" height="72" style="border-radius:18px;display:block;margin:0 auto 18px auto;box-shadow:0 8px 32px rgba(255,180,60,0.25);">
<div style="font-size:11px;letter-spacing:0.35em;text-transform:uppercase;color:#f2dcad;opacity:0.9;">MacClipper Update</div>
<h1 style="margin:12px 0 10px 0;font-size:24px;line-height:1.2;color:#ffe7a6;">Big things are coming</h1>
<p style="margin:0 0 16px 0;color:#efdcb8;font-size:14px;line-height:1.65;">
We've been working hard on MacClipper. Here's a sneak peek at what's new and what's coming next.
</p>
</td></tr>
${screenshotRows}
<tr><td style="padding:22px 28px 30px 28px;text-align:center;">
<p style="margin:0;color:#ccb990;font-size:12px;line-height:1.6;">
Stay tuned for more updates.<br/>
Questions? <a href="mailto:support@macclipper.co" style="color:#ffd973;text-decoration:none;">support@macclipper.co</a>
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("Missing MACCLIPPER_SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) { console.error("Missing SMTP config"); process.exit(1); }

  const users = await fetchAuthUsers();
  console.log(`Found ${users.length} users with emails`);

  const attachments = [];
  for (const s of SCREENSHOTS) {
    const p = join(DOWNLOADS, s.file);
    if (!existsSync(p)) { console.error(`Screenshot not found: ${p}`); process.exit(1); }
    attachments.push({
      filename: s.file,
      path: p,
      cid: s.cid,
    });
  }

  const transporter = createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await transporter.sendMail({
        from: FROM,
        to: user.email,
        subject: "MacClipper – What's new",
        html: buildHtml(),
        attachments,
      });
      sent++;
      console.log(`[OK] ${user.email}`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${user.email}: ${err.message}`);
    }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}`);
}

main().catch(console.error);
