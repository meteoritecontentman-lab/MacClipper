import Stripe from "stripe";
import { randomUUID } from "crypto";
import {
  DEFAULT_PRO_SUBSCRIPTION_AMOUNT_CENTS,
  publicSiteURL,
  stripeCheckoutCancelPath,
  stripeCheckoutSuccessPath,
  stripePortalReturnPath,
  stripeProMonthlyPriceId,
  stripeSecretKey,
  stripeWebhookSecret
} from "../config";
import { getFirestore } from "../firestore";
import { ApiError } from "../middleware/errorHandler";
import {
  clearBillingOverrideLock,
  getBillingOverrideLocked,
  lookupAppLinkByWebsiteUserId,
  setAccountSubscription
} from "./accountService";
import { sendOrderConfirmationEmail } from "./emailService";

interface CreateCheckoutSessionInput {
  websiteUserId: string;
  email?: string;
  origin?: string;
}

interface CreatePortalSessionInput {
  websiteUserId: string;
  origin?: string;
}

interface BillingCustomerRecord {
  websiteUserId: string;
  appUuid: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  stripeSubscriptionStatus: string;
  updatedAt: string;
}

interface BillingOrderRecord {
  orderId: string;
  orderNumber: string;
  websiteUserId: string;
  appUuid: string;
  stripeSessionId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePaymentStatus: string;
  stripeSubscriptionStatus: string;
  amountTotalCents: number;
  currency: string;
  paymentEmailRecipient?: string;
  paymentEmailSentAt?: string;
  paymentEmailStatus?: string;
  paymentEmailError?: string;
  createdAt: string;
  updatedAt: string;
}

interface BillingOrderValidity {
  isValid: boolean;
  reason: string;
  status: string;
  subscriptionStartedAt: string;
  currentPeriodEndAt: string;
  trialStartedAt: string;
  trialEndsAt: string;
  trialElapsedSeconds: number;
  canceledAt: string;
  endedAt: string;
  endedElapsedSeconds: number;
}

const BILLING_CUSTOMERS_COLLECTION = "billingCustomers";
const BILLING_ORDERS_COLLECTION = "billingOrders";
const PRO_FEATURE_KEY = "4k-pro";
const PRO_STATUSES = new Set(["active", "trialing", "past_due"]);

let stripeClient: ReturnType<typeof Stripe> | null = null;

function nowISO(): string {
  return new Date().toISOString();
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown): string {
  const email = normalizeText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeWebsiteUserId(value: unknown): string {
  const websiteUserId = normalizeText(value);
  if (!websiteUserId) {
    throw new ApiError(400, "websiteUserId is required.");
  }

  return websiteUserId;
}

function normalizeAppUuid(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeOrderId(value: unknown): string {
  const orderId = normalizeText(value);
  return /^mco_[a-z0-9_-]{10,160}$/i.test(orderId) ? orderId : "";
}

function generateOrderId(): string {
  return `mco_${randomUUID().replace(/-/g, "")}`;
}

// Deterministic 8-digit numeric order number derived from orderId.
function orderNumberFromOrderId(orderId: string): string {
  const hex = orderId.replace(/[^0-9a-f]/gi, "").slice(0, 8);
  const num = (parseInt(hex || "0", 16) % 90000000) + 10000000;
  return String(num);
}

function billingCustomersCollection() {
  return getFirestore().collection(BILLING_CUSTOMERS_COLLECTION);
}

function billingOrdersCollection() {
  return getFirestore().collection(BILLING_ORDERS_COLLECTION);
}

async function upsertBillingOrder(record: Partial<BillingOrderRecord> & { orderId: string }): Promise<void> {
  const orderId = normalizeOrderId(record.orderId);
  if (!orderId) {
    return;
  }

  const payload: Partial<BillingOrderRecord> = {
    orderId,
    orderNumber: orderNumberFromOrderId(orderId),
    websiteUserId: normalizeText(record.websiteUserId),
    appUuid: normalizeAppUuid(record.appUuid),
    stripeSessionId: normalizeText(record.stripeSessionId),
    stripeCustomerId: normalizeText(record.stripeCustomerId),
    stripeSubscriptionId: normalizeText(record.stripeSubscriptionId),
    stripePaymentStatus: normalizeText(record.stripePaymentStatus),
    stripeSubscriptionStatus: normalizeText(record.stripeSubscriptionStatus),
    amountTotalCents: Number.isFinite(record.amountTotalCents) ? Number(record.amountTotalCents) : 0,
    currency: normalizeText(record.currency).toLowerCase(),
    paymentEmailRecipient: normalizeEmail(record.paymentEmailRecipient),
    paymentEmailSentAt: normalizeText(record.paymentEmailSentAt),
    paymentEmailStatus: normalizeText(record.paymentEmailStatus),
    paymentEmailError: normalizeText(record.paymentEmailError),
    updatedAt: nowISO()
  };

  if (record.createdAt) {
    payload.createdAt = normalizeText(record.createdAt);
  }

  await billingOrdersCollection().doc(orderId).set(payload, { merge: true });
}

export async function lookupBillingOrderByOrderId(input: { orderId: string }): Promise<{ order: BillingOrderRecord }> {
  const orderId = normalizeOrderId(input.orderId);
  if (!orderId) {
    throw new ApiError(400, "Invalid order id.");
  }

  const snapshot = await billingOrdersCollection().doc(orderId).get();
  if (!snapshot.exists) {
    throw new ApiError(404, "Order not found.");
  }

  const source = snapshot.data() || {};
  const order: BillingOrderRecord = {
    orderId,
    orderNumber: normalizeText(source.orderNumber) || orderNumberFromOrderId(orderId),
    websiteUserId: normalizeText(source.websiteUserId),
    appUuid: normalizeAppUuid(source.appUuid),
    stripeSessionId: normalizeText(source.stripeSessionId),
    stripeCustomerId: normalizeText(source.stripeCustomerId),
    stripeSubscriptionId: normalizeText(source.stripeSubscriptionId),
    stripePaymentStatus: normalizeText(source.stripePaymentStatus),
    stripeSubscriptionStatus: normalizeText(source.stripeSubscriptionStatus),
    amountTotalCents: Number(source.amountTotalCents || 0),
    currency: normalizeText(source.currency).toLowerCase(),
    paymentEmailRecipient: normalizeEmail(source.paymentEmailRecipient),
    paymentEmailSentAt: normalizeText(source.paymentEmailSentAt),
    paymentEmailStatus: normalizeText(source.paymentEmailStatus),
    paymentEmailError: normalizeText(source.paymentEmailError),
    createdAt: normalizeText(source.createdAt),
    updatedAt: normalizeText(source.updatedAt)
  };

  const validity = await buildBillingOrderValidity(order);

  return {
    order: {
      ...order,
      validity
    } as BillingOrderRecord & { validity: BillingOrderValidity }
  };
}

function summaryErrorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error ?? "unknown-error");
  return normalizeText(value).slice(0, 280);
}

function isoFromUnixSeconds(value: unknown): string {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  return new Date(seconds * 1000).toISOString();
}

function elapsedSecondsFromIso(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

async function buildBillingOrderValidity(order: BillingOrderRecord): Promise<BillingOrderValidity> {
  const fallbackStatus = normalizeText(order.stripeSubscriptionStatus).toLowerCase();
  const defaultReason = isSubscriptionPro(fallbackStatus)
    ? "subscription-active"
    : (fallbackStatus ? `subscription-${fallbackStatus}` : "subscription-unknown");

  const fallbackValidity: BillingOrderValidity = {
    isValid: isSubscriptionPro(fallbackStatus),
    reason: defaultReason,
    status: fallbackStatus || "unknown",
    subscriptionStartedAt: "",
    currentPeriodEndAt: "",
    trialStartedAt: "",
    trialEndsAt: "",
    trialElapsedSeconds: 0,
    canceledAt: "",
    endedAt: "",
    endedElapsedSeconds: 0
  };

  if (!order.stripeSubscriptionId) {
    return fallbackValidity;
  }

  try {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(order.stripeSubscriptionId);
    const status = normalizeText(subscription.status).toLowerCase() || fallbackValidity.status;
    const subscriptionStartedAt = isoFromUnixSeconds(subscription.start_date);
    const currentPeriodEndAt = isoFromUnixSeconds((subscription as { current_period_end?: number | null }).current_period_end);
    const trialStartedAt = isoFromUnixSeconds(subscription.trial_start);
    const trialEndsAt = isoFromUnixSeconds(subscription.trial_end);
    const canceledAt = isoFromUnixSeconds(subscription.canceled_at || subscription.cancel_at);
    const endedAt = canceledAt || (isSubscriptionPro(status) ? "" : currentPeriodEndAt);
    const trialElapsedSeconds = trialStartedAt ? elapsedSecondsFromIso(trialStartedAt) : 0;
    const endedElapsedSeconds = endedAt ? elapsedSecondsFromIso(endedAt) : 0;

    let reason = "subscription-active";
    if (status === "trialing") {
      reason = "trial-in-progress";
    } else if (status === "past_due") {
      reason = "payment-past-due";
    } else if (!isSubscriptionPro(status)) {
      reason = endedAt ? "subscription-ended" : `subscription-${status || "unknown"}`;
    }

    return {
      isValid: isSubscriptionPro(status),
      reason,
      status,
      subscriptionStartedAt,
      currentPeriodEndAt,
      trialStartedAt,
      trialEndsAt,
      trialElapsedSeconds,
      canceledAt,
      endedAt,
      endedElapsedSeconds
    };
  } catch (error) {
    console.warn("[BILLING] Failed to build live order validity", order.orderId, error);
    return fallbackValidity;
  }
}

async function resolveWebsiteUserEmail(websiteUserId: string): Promise<string> {
  if (!websiteUserId) {
    return "";
  }

  const snapshot = await getFirestore().collection("users").doc(websiteUserId).get();
  if (!snapshot.exists) {
    return "";
  }

  const data = snapshot.data() || {};
  return normalizeEmail(data.email);
}

async function resolveStripeCustomerEmail(stripeCustomerId: string): Promise<string> {
  if (!stripeCustomerId) {
    return "";
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if ((customer as { deleted?: boolean }).deleted) {
    return "";
  }

  return normalizeEmail((customer as { email?: string | null }).email);
}

async function reservePaymentEmailSend(orderId: string): Promise<boolean> {
  if (!orderId) {
    return false;
  }

  const docRef = billingOrdersCollection().doc(orderId);
  let reserved = false;

  await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);
    const source = snapshot.data() || {};
    const existingStatus = normalizeText(source.paymentEmailStatus).toLowerCase();
    const alreadySent = Boolean(normalizeText(source.paymentEmailSentAt));

    if (alreadySent || existingStatus === "sending") {
      reserved = false;
      return;
    }

    transaction.set(docRef, {
      paymentEmailStatus: "sending",
      paymentEmailError: "",
      updatedAt: nowISO()
    }, { merge: true });
    reserved = true;
  });

  return reserved;
}

async function finalizePaymentEmailSend(input: {
  orderId: string;
  status: "sent" | "skipped" | "failed";
  recipientEmail?: string;
  errorMessage?: string;
}): Promise<void> {
  if (!input.orderId) {
    return;
  }

  await billingOrdersCollection().doc(input.orderId).set({
    paymentEmailStatus: input.status,
    paymentEmailRecipient: normalizeEmail(input.recipientEmail),
    paymentEmailSentAt: input.status === "sent" ? nowISO() : "",
    paymentEmailError: normalizeText(input.errorMessage),
    updatedAt: nowISO()
  }, { merge: true });
}

async function sendOrderConfirmationIfNeeded(input: {
  orderId: string;
  websiteUserId: string;
  stripeCustomerId: string;
  amountTotalCents: number;
  currency: string;
  fallbackEmail?: string;
}): Promise<void> {
  const orderId = normalizeOrderId(input.orderId);
  if (!orderId) {
    console.log("[BILLING] sendOrderConfirmationIfNeeded: no orderId");
    return;
  }

  console.log(`[BILLING] sendOrderConfirmationIfNeeded: processing orderId=${orderId}`);

  const reserved = await reservePaymentEmailSend(orderId);
  if (!reserved) {
    console.log(`[BILLING] sendOrderConfirmationIfNeeded: email already reserved/sent for orderId=${orderId}`);
    return;
  }

  try {
    const websiteUserId = normalizeText(input.websiteUserId);
    console.log(`[BILLING] Resolving email: fallback=${input.fallbackEmail}, websiteUserId=${websiteUserId}, customerId=${input.stripeCustomerId}`);
    
    const recipientEmail = normalizeEmail(input.fallbackEmail)
      || (websiteUserId ? await resolveWebsiteUserEmail(websiteUserId) : "")
      || await resolveStripeCustomerEmail(normalizeText(input.stripeCustomerId));

    console.log(`[BILLING] Resolved recipient email: ${recipientEmail}`);

    if (!recipientEmail) {
      console.log(`[BILLING] No recipient email found for orderId=${orderId}`);
      await finalizePaymentEmailSend({
        orderId,
        status: "skipped",
        errorMessage: "No recipient email found."
      });
      return;
    }

    const result = await sendOrderConfirmationEmail({
      recipientEmail,
      orderId,
      orderNumber: orderNumberFromOrderId(orderId),
      amountCents: Number.isFinite(input.amountTotalCents) ? Number(input.amountTotalCents) : 0,
      currency: normalizeText(input.currency) || "usd"
    });

    if (!result.sent) {
      console.log(`[BILLING] Email send failed for orderId=${orderId}: ${result.reason}`);
      await finalizePaymentEmailSend({
        orderId,
        status: "skipped",
        recipientEmail,
        errorMessage: result.reason || "Email skipped."
      });
      return;
    }

    console.log(`[BILLING] Email sent successfully for orderId=${orderId}`);
    await finalizePaymentEmailSend({
      orderId,
      status: "sent",
      recipientEmail
    });
  } catch (error) {
    const errorMsg = summaryErrorMessage(error);
    console.error(`[BILLING] Error in sendOrderConfirmationIfNeeded for orderId=${orderId}: ${errorMsg}`, error);
    await finalizePaymentEmailSend({
      orderId,
      status: "failed",
      errorMessage: errorMsg
    });
  }
}

async function runOrderConfirmationEmailSafely(input: {
  orderId: string;
  websiteUserId: string;
  stripeCustomerId: string;
  amountTotalCents: number;
  currency: string;
  fallbackEmail?: string;
}): Promise<void> {
  try {
    await Promise.race([
      sendOrderConfirmationIfNeeded(input),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 8000);
      })
    ]);
  } catch (error) {
    console.error("[BILLING] Non-blocking email pipeline error", error);
  }
}

function getStripeClient(): ReturnType<typeof Stripe> {
  if (stripeClient) {
    return stripeClient;
  }

  const secret = stripeSecretKey();
  if (!secret) {
    throw new ApiError(500, "Stripe is not configured. Missing STRIPE_SECRET_KEY.");
  }

  stripeClient = new Stripe(secret, {
    apiVersion: "2026-04-22.dahlia"
  });

  return stripeClient;
}

function resolveAbsoluteURL(origin: string, pathOrURL: string): string {
  const source = normalizeText(pathOrURL);
  if (/^https?:\/\//i.test(source)) {
    return source;
  }

  const base = normalizeText(origin).replace(/\/+$/, "") || publicSiteURL();
  const nextPath = source.startsWith("/") ? source : `/${source}`;
  return `${base}${nextPath}`;
}

function buildCheckoutSuccessURL(baseSuccessURL: string, orderId: string): string {
  const url = new URL(baseSuccessURL);
  // Remove any existing session_id/order_id to avoid duplicates
  url.searchParams.delete("session_id");
  url.searchParams.delete("order_id");
  url.searchParams.set("order_id", orderId);
  // Append session_id as raw string — searchParams.set() would URL-encode the
  // curly braces and Stripe wouldn't recognise the placeholder.
  const base = url.toString();
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}session_id={CHECKOUT_SESSION_ID}`;
}

async function billingCustomerByWebsiteUserId(websiteUserId: string): Promise<BillingCustomerRecord | null> {
  const snapshot = await billingCustomersCollection().doc(websiteUserId).get();
  if (!snapshot.exists) {
    return null;
  }

  const source = snapshot.data() || {};
  return {
    websiteUserId,
    appUuid: normalizeAppUuid(source.appUuid),
    stripeCustomerId: normalizeText(source.stripeCustomerId),
    stripeSubscriptionId: normalizeText(source.stripeSubscriptionId),
    stripePriceId: normalizeText(source.stripePriceId),
    stripeSubscriptionStatus: normalizeText(source.stripeSubscriptionStatus),
    updatedAt: normalizeText(source.updatedAt)
  };
}

async function upsertBillingCustomer(record: Partial<BillingCustomerRecord> & { websiteUserId: string }): Promise<void> {
  const payload = {
    websiteUserId: normalizeWebsiteUserId(record.websiteUserId),
    appUuid: normalizeAppUuid(record.appUuid),
    stripeCustomerId: normalizeText(record.stripeCustomerId),
    stripeSubscriptionId: normalizeText(record.stripeSubscriptionId),
    stripePriceId: normalizeText(record.stripePriceId),
    stripeSubscriptionStatus: normalizeText(record.stripeSubscriptionStatus),
    updatedAt: nowISO()
  };

  await billingCustomersCollection().doc(payload.websiteUserId).set(payload, { merge: true });
}

async function ensureStripeCustomer(input: {
  websiteUserId: string;
  email?: string;
  appUuid?: string;
}): Promise<string> {
  const cached = await billingCustomerByWebsiteUserId(input.websiteUserId);
  if (cached?.stripeCustomerId) {
    return cached.stripeCustomerId;
  }

  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    ...(normalizeText(input.email) ? { email: normalizeText(input.email) } : {}),
    metadata: {
      websiteUserId: input.websiteUserId,
      appUuid: normalizeAppUuid(input.appUuid)
    }
  });

  await upsertBillingCustomer({
    websiteUserId: input.websiteUserId,
    appUuid: normalizeAppUuid(input.appUuid),
    stripeCustomerId: customer.id
  });

  return customer.id;
}

function isSubscriptionPro(status: string): boolean {
  return PRO_STATUSES.has(normalizeText(status).toLowerCase());
}

async function applyEntitlementForAppUuid(
  appUuid: string,
  status: string,
  options?: { ignoreBillingLock?: boolean }
): Promise<void> {
  if (!appUuid) {
    return;
  }

  try {
    const ignoreBillingLock = Boolean(options?.ignoreBillingLock);

    // If an admin has manually revoked Pro, skip Stripe-driven re-grants to keep the lock intact.
    // Downgrades (free) are still allowed so cancellations propagate correctly.
    const locked = ignoreBillingLock ? false : await getBillingOverrideLocked(appUuid);
    if (locked && isSubscriptionPro(status)) {
      console.info("Skipping Pro re-grant for appUuid", appUuid, "(billing override locked by admin)");
      return;
    }

    // Successful payment should restore normal billing sync and grant Pro immediately.
    if (ignoreBillingLock && isSubscriptionPro(status)) {
      await clearBillingOverrideLock(appUuid);
    }

    // Keep account tier neutral and drive access via feature unlock only.
    await setAccountSubscription({
      appUuid,
      subscriptionTier: "free",
      paidFeatures: isSubscriptionPro(status) ? [PRO_FEATURE_KEY] : []
    });
  } catch (error) {
    // The linked installation can briefly be missing during early onboarding.
    console.warn("Skipping entitlement update for appUuid", appUuid, error);
  }
}

export async function createStripeCheckoutSession(input: CreateCheckoutSessionInput): Promise<{ url: string }> {
  const websiteUserId = normalizeWebsiteUserId(input.websiteUserId);
  const stripe = getStripeClient();

  const linkRecord = await lookupAppLinkByWebsiteUserId({ websiteUserId });
  const appUuid = normalizeAppUuid(linkRecord?.appUuid);
  if (!appUuid) {
    throw new ApiError(409, "Link MacClipper first, then start a subscription.");
  }

  // Resolve customer email: use provided email or fetch from website user account
  let customerEmail = normalizeText(input.email);
  if (!customerEmail && websiteUserId) {
    const userDoc = await getFirestore().collection("users").doc(websiteUserId).get();
    const userData = userDoc.data() || {};
    customerEmail = normalizeEmail(userData.email);
  }

  console.log(`[CHECKOUT] Creating checkout for websiteUserId=${websiteUserId}, email=${customerEmail}, appUuid=${appUuid}`);

  const customerId = await ensureStripeCustomer({
    websiteUserId,
    email: customerEmail,
    appUuid
  });

  const origin = normalizeText(input.origin) || publicSiteURL();
  const baseSuccessURL = resolveAbsoluteURL(origin, stripeCheckoutSuccessPath());
  const cancelURL = resolveAbsoluteURL(origin, stripeCheckoutCancelPath());
  const configuredPriceId = stripeProMonthlyPriceId();
  const orderId = generateOrderId();
  const successURL = buildCheckoutSuccessURL(baseSuccessURL, orderId);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: websiteUserId,
    success_url: successURL,
    cancel_url: cancelURL,
    allow_promotion_codes: true,
    metadata: {
      websiteUserId,
      appUuid,
      orderId
    },
    subscription_data: {
      metadata: {
        websiteUserId,
        appUuid,
        orderId
      }
    },
    line_items: configuredPriceId
      ? [{ price: configuredPriceId, quantity: 1 }]
      : [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: DEFAULT_PRO_SUBSCRIPTION_AMOUNT_CENTS,
            recurring: { interval: "month" },
            product_data: {
              name: "MacClipper Pro"
            }
          }
        }]
  });

  if (!session.url) {
    throw new ApiError(500, "Stripe checkout URL is missing.");
  }

  await upsertBillingOrder({
    orderId,
    websiteUserId,
    appUuid,
    stripeSessionId: normalizeText(session.id),
    stripeCustomerId: normalizeText(customerId),
    stripePaymentStatus: normalizeText(session.payment_status) || "unpaid",
    stripeSubscriptionStatus: "pending",
    amountTotalCents: Number(session.amount_total || 0),
    currency: normalizeText(session.currency),
    createdAt: nowISO()
  });

  return { url: session.url };
}

export async function createStripePortalSession(input: CreatePortalSessionInput): Promise<{ url: string }> {
  const websiteUserId = normalizeWebsiteUserId(input.websiteUserId);
  const stripe = getStripeClient();

  const billingRecord = await billingCustomerByWebsiteUserId(websiteUserId);
  if (!billingRecord?.stripeCustomerId) {
    throw new ApiError(404, "No billing profile found yet. Start Pro first.");
  }

  const origin = normalizeText(input.origin) || publicSiteURL();
  const returnURL = resolveAbsoluteURL(origin, stripePortalReturnPath());

  const session = await stripe.billingPortal.sessions.create({
    customer: billingRecord.stripeCustomerId,
    return_url: returnURL
  });

  return { url: session.url };
}

export function stripeWebhookSecretConfigured(): boolean {
  return Boolean(stripeWebhookSecret());
}

export async function verifyAndFulfillCheckoutSession(input: {
  sessionId: string;
  websiteUserId: string;
}): Promise<{ fulfilled: boolean; status: string; orderId: string; appUuid: string }> {
  const sessionId = normalizeText(input.sessionId);
  const requestedWebsiteUserId = normalizeText(input.websiteUserId);

  if (!sessionId) {
    throw new ApiError(400, "sessionId is required.");
  }

  if (!requestedWebsiteUserId) {
    throw new ApiError(401, "Sign in to the account that purchased this subscription first.");
  }

  if (/\{\s*checkout_session_id\s*\}/i.test(sessionId) || !/^cs_[a-z0-9_]+$/i.test(sessionId)) {
    throw new ApiError(400, "Invalid checkout session id.");
  }

  const stripe = getStripeClient();
  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"]
    });
  } catch (error) {
    const message = summaryErrorMessage(error);
    throw new ApiError(400, `Checkout session lookup failed: ${message}`);
  }
  const orderId = normalizeOrderId(session.metadata?.orderId) || normalizeOrderId(`mco_${session.id}`) || "";
  const sessionWebsiteUserId = normalizeText(session.metadata?.websiteUserId)
    || normalizeText(session.client_reference_id);
  if (!sessionWebsiteUserId) {
    throw new ApiError(400, "websiteUserId could not be resolved for this checkout session.");
  }

  if (requestedWebsiteUserId !== sessionWebsiteUserId) {
    throw new ApiError(403, "This checkout confirmation belongs to a different account.");
  }

  const websiteUserId = requestedWebsiteUserId;
  const linkedApp = await lookupAppLinkByWebsiteUserId({ websiteUserId });
  const linkedAppUuid = normalizeAppUuid(linkedApp?.appUuid);
  const sessionAppUuid = normalizeAppUuid(session.metadata?.appUuid);
  if (!linkedAppUuid) {
    throw new ApiError(409, "Link MacClipper to this account before confirming the purchase.");
  }

  if (sessionAppUuid && linkedAppUuid !== sessionAppUuid) {
    throw new ApiError(409, "This checkout link no longer matches your currently linked Mac.");
  }

  if (session.payment_status !== "paid" && session.status !== "complete") {
    const appUuid = linkedAppUuid || sessionAppUuid;
    await upsertBillingOrder({
      orderId,
      websiteUserId,
      appUuid,
      stripeSessionId: normalizeText(session.id),
      stripeCustomerId: normalizeText(session.customer as string),
      stripeSubscriptionId: normalizeText(session.subscription as string),
      stripePaymentStatus: normalizeText(session.payment_status),
      stripeSubscriptionStatus: "pending",
      amountTotalCents: Number(session.amount_total || 0),
      currency: normalizeText(session.currency)
    });

    return { fulfilled: false, status: session.payment_status ?? "unknown", orderId, appUuid };
  }

  const subscription = session.subscription as { id?: string; status?: string; items?: { data?: Array<{ price?: { id?: string } }> } } | null;
  const subscriptionId = normalizeText(subscription?.id ?? session.subscription as unknown as string);
  const status = normalizeText(subscription?.status ?? "active");
  const firstItem = Array.isArray(subscription?.items?.data) ? subscription!.items!.data![0] : undefined;
  const priceId = normalizeText(firstItem?.price?.id);
  const customerId = normalizeText(session.customer as string);
  const customerEmail = normalizeEmail((session.customer_details as { email?: string | null } | null)?.email);
  const appUuid = linkedAppUuid || sessionAppUuid;

  await upsertBillingCustomer({
    websiteUserId,
    appUuid,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: priceId,
    stripeSubscriptionStatus: status || "active"
  });

  await applyEntitlementForAppUuid(appUuid, status || "active", { ignoreBillingLock: true });

  await upsertBillingOrder({
    orderId,
    websiteUserId,
    appUuid,
    stripeSessionId: normalizeText(session.id),
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePaymentStatus: normalizeText(session.payment_status) || "paid",
    stripeSubscriptionStatus: status || "active",
    amountTotalCents: Number(session.amount_total || 0),
    currency: normalizeText(session.currency)
  });

  await runOrderConfirmationEmailSafely({
    orderId,
    websiteUserId,
    stripeCustomerId: customerId,
    amountTotalCents: Number(session.amount_total || 0),
    currency: normalizeText(session.currency),
    fallbackEmail: customerEmail
  });

  return { fulfilled: true, status: status || "active", orderId, appUuid };
}

export async function processStripeWebhook(rawBody: Buffer, signatureHeader: string): Promise<{ processed: true }> {
  const stripe = getStripeClient();
  const webhookSecret = stripeWebhookSecret();
  if (!webhookSecret) {
    throw new ApiError(500, "Stripe webhook is not configured. Missing STRIPE_WEBHOOK_SECRET.");
  }

  let event: { type: string; data: { object: unknown } };
  try {
    event = stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe signature verification failed.";
    throw new ApiError(400, message);
  }

  if (event.type === "checkout.session.completed") {
    console.log("[WEBHOOK] Processing checkout.session.completed event");
    const session = event.data.object as {
      id?: string;
      metadata?: Record<string, string | undefined>;
      client_reference_id?: string | null;
      customer?: string | null;
      subscription?: string | null;
      payment_status?: string | null;
      amount_total?: number | null;
      currency?: string | null;
      customer_details?: {
        email?: string | null;
      } | null;
    };
    const websiteUserId = normalizeText(session.metadata?.websiteUserId || session.client_reference_id);
    const appUuid = normalizeAppUuid(session.metadata?.appUuid);
    const orderId = normalizeOrderId(session.metadata?.orderId) || normalizeOrderId(`mco_${session.id}`) || "";
    const customerId = normalizeText(session.customer);
    const subscriptionId = normalizeText(session.subscription);

    console.log(`[WEBHOOK] Checkout data: orderId=${orderId}, websiteUserId=${websiteUserId}, appUuid=${appUuid}, customerId=${customerId}, amount=${session.amount_total}, email=${session.customer_details?.email}`);

    if (websiteUserId) {
      await upsertBillingCustomer({
        websiteUserId,
        appUuid,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        stripeSubscriptionStatus: "active"
      });
    }

    await upsertBillingOrder({
      orderId,
      websiteUserId,
      appUuid,
      stripeSessionId: normalizeText(session.id),
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePaymentStatus: normalizeText(session.payment_status) || "paid",
      stripeSubscriptionStatus: "active",
      amountTotalCents: Number(session.amount_total || 0),
      currency: normalizeText(session.currency)
    });

    await applyEntitlementForAppUuid(appUuid, "active", { ignoreBillingLock: true });

    await runOrderConfirmationEmailSafely({
      orderId,
      websiteUserId,
      stripeCustomerId: customerId,
      amountTotalCents: Number(session.amount_total || 0),
      currency: normalizeText(session.currency),
      fallbackEmail: normalizeEmail(session.customer_details?.email)
    });

    return { processed: true };
  }

  if (
    event.type === "customer.subscription.created"
    || event.type === "customer.subscription.updated"
    || event.type === "customer.subscription.deleted"
  ) {
    const subscription = event.data.object as {
      id?: string;
      status?: string;
      customer?: string;
      metadata?: Record<string, string | undefined>;
      items?: {
        data?: Array<{
          price?: {
            id?: string;
          };
        }>;
      };
    };
    const customerId = normalizeText(subscription.customer);
    if (!customerId) {
      return { processed: true };
    }

    const status = normalizeText(subscription.status).toLowerCase();
    const subscriptionId = normalizeText(subscription.id);
    const firstSubscriptionItem = Array.isArray(subscription.items?.data)
      ? subscription.items.data[0]
      : undefined;
    const priceId = normalizeText(firstSubscriptionItem?.price?.id);

    const linkedCustomersSnapshot = await billingCustomersCollection()
      .where("stripeCustomerId", "==", customerId)
      .get();

    if (linkedCustomersSnapshot.empty) {
      const metadataWebsiteUserId = normalizeText(subscription.metadata?.websiteUserId);
      if (metadataWebsiteUserId) {
        await upsertBillingCustomer({
          websiteUserId: metadataWebsiteUserId,
          appUuid: normalizeAppUuid(subscription.metadata?.appUuid),
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: priceId,
          stripeSubscriptionStatus: status
        });

        await applyEntitlementForAppUuid(normalizeAppUuid(subscription.metadata?.appUuid), status);
      }

      return { processed: true };
    }

    const updates = linkedCustomersSnapshot.docs.map(async (document) => {
      const source = document.data() || {};
      const websiteUserId = normalizeWebsiteUserId(document.id);
      const appUuid = normalizeAppUuid(source.appUuid || subscription.metadata?.appUuid);

      await upsertBillingCustomer({
        websiteUserId,
        appUuid,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        stripePriceId: priceId,
        stripeSubscriptionStatus: status
      });

      await applyEntitlementForAppUuid(appUuid, status);
    });

    await Promise.all(updates);
    return { processed: true };
  }

  return { processed: true };
}

export async function lookupBillingSubscription(input: { websiteUserId: string }): Promise<{
  hasPro: boolean;
  status: string;
  planName: string;
  amountCents: number;
  currency: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string;
  startedAt: string;
  orderId: string;
  orderNumber: string;
  stripeSubscriptionId: string;
}> {
  const websiteUserId = normalizeWebsiteUserId(input.websiteUserId);
  const billingRecord = await billingCustomerByWebsiteUserId(websiteUserId);

  const empty = {
    hasPro: false,
    status: "none",
    planName: "Free",
    amountCents: 0,
    currency: "usd",
    currentPeriodEnd: "",
    cancelAtPeriodEnd: false,
    canceledAt: "",
    startedAt: "",
    orderId: "",
    orderNumber: "",
    stripeSubscriptionId: ""
  };

  if (!billingRecord?.stripeSubscriptionId) {
    return empty;
  }

  const stripe = getStripeClient();
  try {
    const sub = await stripe.subscriptions.retrieve(billingRecord.stripeSubscriptionId, {
      expand: ["items.data.price.product"]
    });

    const status = normalizeText(sub.status).toLowerCase();
    const hasPro = isSubscriptionPro(status);
    const item = Array.isArray(sub.items?.data) ? sub.items.data[0] : undefined;
    const price = item?.price;
    const product = price?.product as { name?: string } | undefined;
    const planName = normalizeText(product?.name) || "MacClipper Pro";
    const amountCents = Number(price?.unit_amount || 0);
    const currency = normalizeText(price?.currency || "usd").toLowerCase();
    const currentPeriodEnd = isoFromUnixSeconds((sub as { current_period_end?: number }).current_period_end);
    const cancelAtPeriodEnd = Boolean((sub as { cancel_at_period_end?: boolean }).cancel_at_period_end);
    const canceledAt = isoFromUnixSeconds(sub.canceled_at || sub.cancel_at);
    const startedAt = isoFromUnixSeconds(sub.start_date);

    // Find the most recent order for this subscription
    const ordersSnapshot = await billingOrdersCollection()
      .where("websiteUserId", "==", websiteUserId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    const latestOrder = ordersSnapshot.empty ? null : ordersSnapshot.docs[0].data();
    const orderId = normalizeOrderId(latestOrder?.orderId) || "";
    const orderNumber = normalizeText(latestOrder?.orderNumber) || (orderId ? orderNumberFromOrderId(orderId) : "");

    return {
      hasPro,
      status,
      planName,
      amountCents,
      currency,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      canceledAt,
      startedAt,
      orderId,
      orderNumber,
      stripeSubscriptionId: billingRecord.stripeSubscriptionId
    };
  } catch (error) {
    console.warn("[BILLING] lookupBillingSubscription failed:", summaryErrorMessage(error));
    return empty;
  }
}
