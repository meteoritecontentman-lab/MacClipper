export const API_SERVICE_NAME = "macclipper-app-bot-api";
export const API_BASE_PATH = "/api";
export const PAID_FEATURES = ["4k-pro"] as const;
export const DEFAULT_PRO_FEATURES = ["4k-pro"] as const;
export const FUNCTIONS_REGION = "us-central1";
export const FUNCTIONS_TIMEOUT_SECONDS = 120;
export const DEFAULT_PUBLIC_SITE_URL = "https://macclipper.co";
export const DEFAULT_PRO_SUBSCRIPTION_AMOUNT_CENTS = 699;
export const DEFAULT_SUPABASE_URL = "https://ccnuqjmqmylergzatpua.supabase.co";
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjbnVxam1xbXlsZXJnemF0cHVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzMwMzQsImV4cCI6MjA5MTg0OTAzNH0.T5F8_yYwcEJ2gtxrB0jGXJ-14f6ro0yuUJFG_QMfzZk";
export const DEFAULT_MACCLIPPER_DOWNLOAD_URL = "https://github.com/Userbro20/macclip-auto-update/releases/download/v1.2.7/MacClipper.dmg";

export function botSharedSecret(): string {
  return (process.env.MACCLIPPER_BOT_SHARED_SECRET || "").trim();
}

export function publicSiteURL(): string {
  const configuredValue = (process.env.MACCLIPPER_PUBLIC_SITE_URL || "")
    .trim()
    .replace(/\/+$/, "");

  return configuredValue || DEFAULT_PUBLIC_SITE_URL;
}

export function supabaseURL(): string {
  return (process.env.MACCLIPPER_SUPABASE_URL || DEFAULT_SUPABASE_URL)
    .trim()
    .replace(/\/+$/, "");
}

export function supabasePublishableKey(): string {
  return (process.env.MACCLIPPER_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY)
    .trim();
}

export function supabaseServiceRoleKey(): string {
  return (process.env.MACCLIPPER_SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

export function stripeSecretKey(): string {
  return (process.env.STRIPE_SECRET_KEY || "").trim();
}

export function stripeWebhookSecret(): string {
  return (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
}

export function stripeProMonthlyPriceId(): string {
  return (process.env.STRIPE_PRICE_PRO_MONTHLY || "").trim();
}

export function stripeCheckoutSuccessPath(): string {
  return (process.env.STRIPE_CHECKOUT_SUCCESS_PATH || "/order-confirmation?session_id={CHECKOUT_SESSION_ID}").trim() || "/order-confirmation?session_id={CHECKOUT_SESSION_ID}";
}

export function stripeCheckoutCancelPath(): string {
  return (process.env.STRIPE_CHECKOUT_CANCEL_PATH || "/support?billing=cancel").trim() || "/support?billing=cancel";
}

export function stripePortalReturnPath(): string {
  return (process.env.STRIPE_PORTAL_RETURN_PATH || "/settings").trim() || "/settings";
}

export function smtpHost(): string {
  return (process.env.SMTP_HOST || "").trim();
}

export function smtpPort(): number {
  const parsed = Number.parseInt((process.env.SMTP_PORT || "587").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 587;
}

export function smtpSecure(): boolean {
  return (process.env.SMTP_SECURE || "false").trim().toLowerCase() === "true";
}

export function smtpUser(): string {
  const configuredUser = (process.env.SMTP_USER || "").trim();
  if (configuredUser) {
    return configuredUser;
  }

  const host = smtpHost().toLowerCase();
  if (host.includes("sendgrid")) {
    return "apikey";
  }

  return "";
}

export function smtpPass(): string {
  return (process.env.SMTP_PASS || process.env.SENDGRID_API_KEY || "").trim();
}

export function billingEmailFrom(): string {
  return (process.env.BILLING_EMAIL_FROM || "support@macclipper.co").trim();
}

export function billingEmailReplyTo(): string {
  return (process.env.BILLING_EMAIL_REPLY_TO || billingEmailFrom()).trim();
}

export function billingEmailSupportInbox(): string {
  return (process.env.BILLING_EMAIL_SUPPORT_INBOX || "support@macclipper.co").trim();
}

export function macclipperDownloadURL(): string {
  return (process.env.MACCLIPPER_DOWNLOAD_URL || DEFAULT_MACCLIPPER_DOWNLOAD_URL).trim();
}

export function botDiscordLinkedWebhookURL(): string {
  return (process.env.MACCLIPPER_BOT_DISCORD_LINKED_WEBHOOK_URL || "").trim();
}

export function ownerEmail(): string {
  return (process.env.MACCLIPPER_OWNER_EMAIL || "").trim().toLowerCase();
}