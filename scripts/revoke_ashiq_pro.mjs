#!/usr/bin/env node
import { readFileSync } from "fs";
import { resolve, join } from "path";

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    process.env[key] = val;
  }
}

loadEnv(ENV_PATH);

const SUPABASE_URL = "https://ccnuqjmqmylergzatpua.supabase.co";
const SERVICE_ROLE_KEY = process.env.MACCLIPPER_SUPABASE_SERVICE_ROLE_KEY;
const API_BASE = "https://macclipper.co/api";
const BOT_SECRET = process.env.MACCLIPPER_BOT_SHARED_SECRET;

const SEARCH_TERM = process.argv[2] || "Ashiq";

async function searchByDisplayName(term) {
  const url = `${SUPABASE_URL}/rest/v1/profiles?select=id,email,display_name,avatar_url&display_name=ilike.%${encodeURIComponent(term)}%`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function revokePro(appUuid) {
  const res = await fetch(`${API_BASE}/bot/users/revoke-feature`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-secret": BOT_SECRET,
    },
    body: JSON.stringify({ appUuid, feature: "4k-pro" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`API error ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  if (!SERVICE_ROLE_KEY) { console.error("Missing MACCLIPPER_SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
  if (!BOT_SECRET) { console.error("Missing MACCLIPPER_BOT_SHARED_SECRET"); process.exit(1); }

  console.log(`Searching for profiles matching "${SEARCH_TERM}"...`);
  const profiles = await searchByDisplayName(SEARCH_TERM);

  if (profiles.length === 0) {
    console.log("No profiles found with that display name.");
    console.log("Let me search auth users by email prefix...");
    const usersUrl = `${SUPABASE_URL}/auth/v1/admin/users?per_page=10000`;
    const res = await fetch(usersUrl, {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    });
    const data = await res.json();
    const matching = (data.users || []).filter(u =>
      (u.email || "").toLowerCase().includes(SEARCH_TERM.toLowerCase())
    );
    if (matching.length === 0) {
      console.log(`No auth users found matching "${SEARCH_TERM}" either.`);
      process.exit(1);
    }
    console.log(`Found ${matching.length} auth user(s):`);
    for (const u of matching) {
      console.log(`  ID: ${u.id}, Email: ${u.email}`);
    }
    process.exit(0);
  }

  console.log(`Found ${profiles.length} profile(s):`);
  for (const p of profiles) {
    console.log(`  ID: ${p.id}, Email: ${p.email || "N/A"}, Display: ${p.display_name}`);
  }

  const target = profiles[0];
  console.log(`\nRevoking pro for: ${target.display_name} (${target.id})`);

  const result = await revokePro(target.id);
  console.log("Success:", JSON.stringify(result, null, 2));
}

main().catch(console.error);
