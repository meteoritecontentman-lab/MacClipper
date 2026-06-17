import nodemailer from "nodemailer";
import {
  billingEmailFrom,
  billingEmailReplyTo,
  billingEmailSupportInbox,
  publicSiteURL,
  smtpHost,
  smtpPass,
  smtpPort,
  smtpSecure,
  smtpUser
} from "../config";

let mailTransporter: nodemailer.Transporter | null = null;

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function hasSmtpConfig(): boolean {
  return Boolean(smtpHost() && smtpUser() && smtpPass());
}

function getTransporter(): nodemailer.Transporter {
  if (mailTransporter) {
    return mailTransporter;
  }

  mailTransporter = nodemailer.createTransport({
    host: smtpHost(),
    port: smtpPort(),
    secure: smtpSecure(),
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    auth: {
      user: smtpUser(),
      pass: smtpPass()
    }
  });

  return mailTransporter;
}

function formatAmount(amountCents: number, currency: string): string {
  const safeCents = Number.isFinite(amountCents) ? Math.max(0, amountCents) : 0;
  const safeCurrency = normalizeText(currency).toUpperCase() || "USD";

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: safeCurrency
    }).format(safeCents / 100);
  } catch {
    return `${(safeCents / 100).toFixed(2)} ${safeCurrency}`;
  }
}

function buildOrderConfirmationHtml(input: {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
}): string {
  const amountDisplay = formatAmount(input.amountCents, input.currency);
  const siteURL = publicSiteURL();
  const supportEmail = billingEmailSupportInbox() || billingEmailFrom();
  const iconURL = "https://media.base44.com/images/public/user_69840c94143af1fbc044bd6f/cf2d115fa_AppIcon_1024x1024x32.png";

  // Gmail/Yahoo/Outlook Purchases schema markup
  const orderDate = new Date().toISOString();
  const schema = JSON.stringify({
    "@context": "http://schema.org",
    "@type": "Order",
    "merchant": {
      "@type": "Organization",
      "name": "MacClipper"
    },
    "orderNumber": input.orderNumber,
    "orderDate": orderDate,
    "orderStatus": "http://schema.org/OrderPaymentDue",
    "priceCurrency": input.currency.toUpperCase() || "USD",
    "price": (input.amountCents / 100).toFixed(2),
    "acceptedOffer": {
      "@type": "Offer",
      "itemOffered": {
        "@type": "Product",
        "name": "MacClipper Pro",
        "description": "MacClipper Pro monthly subscription"
      }
    },
    "url": `${siteURL}/settings`
  });

  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MacClipper Pro – Order #${input.orderNumber}</title>
    <script type="application/ld+json">${schema}</script>
  </head>
  <body style="margin:0;padding:0;background:#0e0a04;font-family:Arial,sans-serif;color:#f4efe3;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0e0a04;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:linear-gradient(180deg,#24180a 0%,#171008 100%);border:1px solid rgba(255,198,92,0.25);border-radius:22px;overflow:hidden;">

            <!-- Icon + Header -->
            <tr>
              <td style="padding:36px 28px 10px 28px;text-align:center;">
                <img src="${iconURL}" alt="MacClipper" width="72" height="72" style="border-radius:18px;display:block;margin:0 auto 18px auto;box-shadow:0 8px 32px rgba(255,180,60,0.25);" />
                <div style="font-size:11px;letter-spacing:0.35em;text-transform:uppercase;color:#f2dcad;opacity:0.9;">MacClipper Pro</div>
                <h1 style="margin:12px 0 10px 0;font-size:28px;line-height:1.2;color:#ffe7a6;">Payment Confirmed</h1>
                <p style="margin:0;color:#efdcb8;font-size:15px;line-height:1.65;">
                  Your MacClipper Pro subscription is live. Welcome to Pro.
                </p>
              </td>
            </tr>

            <!-- Order details -->
            <tr>
              <td style="padding:20px 28px 4px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0f0b06;border:1px solid rgba(255,198,92,0.2);border-radius:14px;">
                  <tr>
                    <td style="padding:18px 20px;border-bottom:1px solid rgba(255,198,92,0.12);">
                      <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#f2dcad;opacity:0.8;">Order Number</div>
                      <div style="margin-top:6px;font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:0.06em;">#${input.orderNumber}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 20px;border-bottom:1px solid rgba(255,198,92,0.12);">
                      <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#f2dcad;opacity:0.8;">Order ID</div>
                      <div style="margin-top:6px;font-size:13px;color:#ffffff;font-family:'Courier New',monospace;word-break:break-all;">${input.orderId}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 20px;border-bottom:1px solid rgba(255,198,92,0.12);">
                      <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#f2dcad;opacity:0.8;">Plan</div>
                      <div style="margin-top:6px;font-size:15px;color:#ffffff;">MacClipper Pro – Monthly</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 20px;">
                      <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#f2dcad;opacity:0.8;">Amount Charged</div>
                      <div style="margin-top:6px;font-size:17px;font-weight:bold;color:#ffffff;">${amountDisplay}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- CTA -->
            <tr>
              <td style="padding:22px 28px 30px 28px;text-align:center;">
                <a href="${siteURL}/settings" style="display:inline-block;background:linear-gradient(90deg,#ffd973 0%,#ffbb4f 100%);padding:13px 22px;border-radius:10px;text-decoration:none;color:#2f2108;font-weight:700;font-size:14px;">Manage Subscription</a>
                <p style="margin:18px 0 0 0;color:#ccb990;font-size:12px;line-height:1.6;">
                  Keep this receipt for your records.<br/>
                  Need help? <a href="mailto:${supportEmail}" style="color:#ffd973;text-decoration:none;">${supportEmail}</a>
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`.trim();
}

function buildOrderConfirmationText(input: {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
}): string {
  const amountDisplay = formatAmount(input.amountCents, input.currency);
  const siteURL = publicSiteURL();
  const supportEmail = billingEmailSupportInbox() || billingEmailFrom();
  return [
    "MacClipper Pro – Payment Confirmation",
    "",
    `Order #${input.orderNumber}`,
    `Order ID: ${input.orderId}`,
    `Plan: MacClipper Pro – Monthly`,
    `Amount: ${amountDisplay}`,
    "",
    `Manage subscription: ${siteURL}/settings`,
    `Support: ${supportEmail}`
  ].join("\n");
}

export async function sendOrderConfirmationEmail(input: {
  recipientEmail: string;
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currency: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const recipientEmail = normalizeText(input.recipientEmail).toLowerCase();
  const orderId = normalizeText(input.orderId);

  console.log(`[EMAIL] Starting send for orderId=${orderId}, recipient=${recipientEmail}`);

  if (!recipientEmail || !orderId) {
    console.log(`[EMAIL] Missing recipient or orderId: recipient=${recipientEmail}, orderId=${orderId}`);
    return { sent: false, reason: "missing-recipient-or-order-id" };
  }

  if (!hasSmtpConfig()) {
    console.log("[EMAIL] SMTP not configured");
    return { sent: false, reason: "smtp-not-configured" };
  }

  const fromAddress = billingEmailFrom();
  const supportInbox = billingEmailSupportInbox() || fromAddress;

  try {
    console.log(`[EMAIL] Sending via SMTP: from=${fromAddress}, to=${recipientEmail}, bcc=${supportInbox}`);
    const result = await getTransporter().sendMail({
      from: fromAddress,
      to: recipientEmail,
      bcc: supportInbox,
      replyTo: billingEmailReplyTo() || fromAddress,
      subject: `MacClipper Pro – Order #${normalizeText(input.orderNumber) || orderId} (${orderId})`,
      text: buildOrderConfirmationText({
        orderId,
        orderNumber: normalizeText(input.orderNumber) || orderId,
        amountCents: input.amountCents,
        currency: input.currency
      }),
      html: buildOrderConfirmationHtml({
        orderId,
        orderNumber: normalizeText(input.orderNumber) || orderId,
        amountCents: input.amountCents,
        currency: input.currency
      })
    });
    console.log(`[EMAIL] Send successful for orderId=${orderId}, response=${result}`);
    return { sent: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[EMAIL] Send failed for orderId=${orderId}: ${errorMsg}`, error);
    return { sent: false, reason: `smtp-error: ${errorMsg}` };
  }
}