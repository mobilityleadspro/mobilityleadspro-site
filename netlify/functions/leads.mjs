// MobilityLeads Pro — Netlify Function for lead capture
//
// What it does:
//   POST /api/leads (redirected to this function)
//     - Validates form fields
//     - Saves the lead JSON to Netlify Blobs (free, built-in storage)
//     - Emails LEAD_NOTIFICATION_EMAIL via Resend if RESEND_API_KEY is set
//   GET  /api/leads?token=<ADMIN_TOKEN>
//     - Returns all leads as JSON for Tyler's review
//
// Required environment variables (set in Netlify → Site configuration → Environment variables):
//   RESEND_API_KEY    your Resend API key (https://resend.com/api-keys)
//
// Optional environment variables:
//   LEAD_NOTIFICATION_EMAIL   override where leads are emailed (default: tyler@mobilityleadspro.com)
//   LEAD_NOTIFICATION_CC      optional comma-separated CC list (default: applinfc@gmail.com)
//   LEAD_FROM_EMAIL           override the From address (default: leads@mobilityleadspro.com — domain verified in Resend)
//   ADMIN_TOKEN               override the admin token (default: tyler2026)

import { getStore } from "@netlify/blobs";
import { z } from "zod";

// Primary lead-notification address (Microsoft 365 mailbox at the brand domain)
const DEFAULT_LEAD_EMAIL = "tyler@mobilityleadspro.com";
// Safety-net CC during cutover. Remove or override via LEAD_NOTIFICATION_CC after ~7 days of clean delivery.
const DEFAULT_LEAD_CC = "applinfc@gmail.com";
const DEFAULT_ADMIN_TOKEN = "tyler2026";
const DEFAULT_FROM_EMAIL = "MobilityLeads Pro <leads@mobilityleadspro.com>";

const VEHICLE_FOR_OPTIONS = [
  "Myself",
  "Spouse / Partner",
  "Parent",
  "Child",
  "Other family member",
];
const VEHICLE_TYPE_OPTIONS = [
  "Side-entry minivan",
  "Rear-entry minivan",
  "Full-size van",
  "Not sure — need help deciding",
];
const BUDGET_OPTIONS = [
  "Under $40,000",
  "$40,000–$60,000",
  "$60,000–$80,000",
  "$80,000+",
  "Not sure yet",
];
const TIMELINE_OPTIONS = [
  "Within 30 days",
  "1–3 months",
  "3–6 months",
  "Just researching",
];
const DELIVERY_PREF_OPTIONS = [
  "Pick up at dealer",
  "Delivered to my home",
  "Not sure yet",
];
const PAYMENT_PLAN_OPTIONS = [
  "Cash / Own funds",
  "Financing",
  "VA benefit / Grant",
  "Not sure yet — need help",
];
const TRADE_IN_OPTIONS = ["No", "Yes", "Maybe"];

const LEAD_TYPE_OPTIONS = ["buyer", "dealer"];
const DEALERSHIP_SIZE_OPTIONS = [
  "1 location",
  "2–5 locations",
  "6–20 locations",
  "20+ locations",
];
const NMEDA_OPTIONS = ["Yes", "No", "Not sure"];

// Lead-quality scoring: flags that make a lead HOT and ready to call
function computeHotFlags(lead) {
  const flags = [];
  if (lead.timeline === "Within 30 days") flags.push("30-day buyer");
  if (lead.paymentPlan === "Cash / Own funds") flags.push("Cash buyer");
  if (lead.paymentPlan === "VA benefit / Grant") flags.push("VA grant");
  if (lead.paymentPlan === "Not sure yet — need help") flags.push("Needs financing guidance");
  if (lead.tradeIn === "Yes") flags.push("Trade-in");
  if (lead.deliveryPref === "Delivered to my home") flags.push("Wants delivery");
  return flags;
}

// Treat empty strings as "not provided" for optional enum fields
const optionalEnum = (values) =>
  z
    .preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.enum(values).nullable().optional()
    );

const buyerSchema = z.object({
  leadType: z.literal("buyer").optional().default("buyer"),
  fullName: z.string().min(2, "Please enter your full name").max(120),
  phone: z
    .string()
    .min(10, "Please enter a valid US phone number")
    .regex(
      /^[+]?[1]?[\s\-.(]?\d{3}[\s\-.)]?[\s\-.]?\d{3}[\s\-.]?\d{4}$/,
      "Please enter a valid US phone number"
    ),
  email: z.string().email("Please enter a valid email"),
  zip: z.string().regex(/^\d{5}$/, "Please enter a 5-digit ZIP code"),
  vehicleFor: z.enum(VEHICLE_FOR_OPTIONS),
  vehicleType: z.enum(VEHICLE_TYPE_OPTIONS),
  budget: z.enum(BUDGET_OPTIONS),
  timeline: z.enum(TIMELINE_OPTIONS),
  deliveryPref: optionalEnum(DELIVERY_PREF_OPTIONS),
  paymentPlan: optionalEnum(PAYMENT_PLAN_OPTIONS),
  tradeIn: optionalEnum(TRADE_IN_OPTIONS),
  tradeInDetails: z
    .preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.string().max(200).nullable().optional()
    ),
});

const dealerSchema = z.object({
  leadType: z.literal("dealer"),
  fullName: z.string().min(2, "Please enter your full name").max(120),
  phone: z
    .string()
    .min(10, "Please enter a valid US phone number")
    .regex(
      /^[+]?[1]?[\s\-.(]?\d{3}[\s\-.)]?[\s\-.]?\d{3}[\s\-.]?\d{4}$/,
      "Please enter a valid US phone number"
    ),
  email: z.string().email("Please enter a valid email"),
  zip: z.string().regex(/^\d{5}$/, "Please enter a 5-digit ZIP code"),
  dealershipName: z.string().min(2, "Please enter your dealership name").max(160),
  role: z.string().max(120).optional().nullable(),
  dealershipSize: optionalEnum(DEALERSHIP_SIZE_OPTIONS),
  nmedaMember: optionalEnum(NMEDA_OPTIONS),
  website: z
    .preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.string().max(200).nullable().optional()
    ),
  territoryRequest: z
    .preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.string().max(300).nullable().optional()
    ),
  message: z
    .preprocess(
      (v) => (v === "" || v === undefined ? null : v),
      z.string().max(1000).nullable().optional()
    ),
});

const leadSchema = z.union([dealerSchema, buyerSchema]);

function formatDealerInquiryEmail(lead) {
  const lines = [
    `🏢 NEW DEALER INQUIRY — MobilityLeads Pro`,
    ``,
    `A dealer just requested information and pricing.`,
    ``,
    `Submitted: ${lead.createdAt}`,
    `Lead ID:   ${lead.id}`,
    ``,
    `Contact name:     ${lead.fullName}`,
    `Role:             ${lead.role || "(not provided)"}`,
    `Dealership:       ${lead.dealershipName}`,
    `Website:          ${lead.website || "(not provided)"}`,
    `Phone:            ${lead.phone}`,
    `Email:            ${lead.email}`,
    `ZIP:              ${lead.zip}`,
    `Dealership size:  ${lead.dealershipSize || "(not provided)"}`,
    `NMEDA member:     ${lead.nmedaMember || "(not provided)"}`,
  ];
  if (lead.territoryRequest) {
    lines.push(``, `Territory of interest:`, lead.territoryRequest);
  }
  if (lead.message) {
    lines.push(``, `Message:`, lead.message);
  }
  lines.push(
    ``,
    `IP address:       ${lead.ipAddress ?? "—"}`,
    `User agent:       ${lead.userAgent ?? "—"}`,
    ``,
    `Reply with founding-dealer pricing ($2,500/mo locked 24 months) and a 15-min territory review call.`,
  );
  return lines.join("\n");
}

function formatLeadEmail(lead) {
  if (lead.leadType === "dealer") return formatDealerInquiryEmail(lead);
  const hotFlags = computeHotFlags(lead);
  const lines = [
    `New MobilityLeads Pro lead from the Lansing landing page.`,
    ``,
  ];
  if (hotFlags.length) {
    lines.push(`🔥 HOT LEAD: ${hotFlags.join(" • ")}`);
    lines.push(``);
  }
  lines.push(
    `Submitted: ${lead.createdAt}`,
    `Lead ID:   ${lead.id}`,
    ``,
    `Name:           ${lead.fullName}`,
    `Phone:          ${lead.phone}`,
    `Email:          ${lead.email}`,
    `ZIP:            ${lead.zip}`,
    `Vehicle for:    ${lead.vehicleFor}`,
    `Vehicle type:   ${lead.vehicleType}`,
    `Budget:         ${lead.budget}`,
    `Timeline:       ${lead.timeline}`,
    ``,
    `— Caregiver decision toolkit —`,
    `Delivery pref:  ${lead.deliveryPref ?? "(not provided)"}`,
    `Payment plan:   ${lead.paymentPlan ?? "(not provided)"}`,
    `Trade-in:       ${lead.tradeIn ?? "(not provided)"}`,
  );
  if (lead.tradeIn === "Yes" && lead.tradeInDetails) {
    lines.push(`Trade-in info:  ${lead.tradeInDetails}`);
  }
  lines.push(
    ``,
    `IP address:     ${lead.ipAddress ?? "—"}`,
    `User agent:     ${lead.userAgent ?? "—"}`,
    ``,
    `Reply by calling ${lead.phone} or emailing ${lead.email} within 24 hours.`,
  );
  return lines.join("\n");
}

function buildSubject(lead) {
  if (lead.leadType === "dealer") {
    return `[DEALER INQUIRY] 🏢 ${lead.dealershipName} — ${lead.fullName} (${lead.zip})`;
  }
  const hotFlags = computeHotFlags(lead);
  const prefix = hotFlags.length ? `🔥 HOT [${hotFlags.join(", ")}] — ` : `New Lead: `;
  return `${prefix}${lead.fullName} (${lead.zip})`;
}

async function sendLeadEmail(lead) {
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = process.env.LEAD_NOTIFICATION_EMAIL || DEFAULT_LEAD_EMAIL;
  const fromEmail = process.env.LEAD_FROM_EMAIL || DEFAULT_FROM_EMAIL;
  // CC list: comma-separated env override, else default safety-net CC.
  const ccRaw =
    process.env.LEAD_NOTIFICATION_CC !== undefined
      ? process.env.LEAD_NOTIFICATION_CC
      : DEFAULT_LEAD_CC;
  const ccList = ccRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== recipient);
  if (!apiKey) {
    console.log(
      `[leads] RESEND_API_KEY not set — would have emailed ${recipient} re: lead #${lead.id} (${lead.fullName}, ${lead.zip})`
    );
    return { sent: false, reason: "resend_not_configured" };
  }
  try {
    const payload = {
      from: fromEmail,
      to: [recipient],
      reply_to: lead.email,
      subject: buildSubject(lead),
      text: formatLeadEmail(lead),
    };
    if (ccList.length > 0) payload.cc = ccList;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[leads] Resend API error ${res.status}:`, body);
      return { sent: false, reason: "resend_error", status: res.status, body };
    }
    console.log(`[leads] Sent lead #${lead.id} email to ${recipient} via Resend`);
    return { sent: true };
  } catch (err) {
    console.error(`[leads] Email failed for lead #${lead.id}:`, err);
    return { sent: false, reason: "resend_exception", error: String(err) };
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const store = getStore("leads");

  // ---- GET /api/leads?stats=1 : public stats (no token required) ----
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("stats") === "1") {
      const { blobs } = await store.list();
      const allLeads = await Promise.all(
        blobs
          .filter((b) => b.key.startsWith("lead-"))
          .map((b) => store.get(b.key, { type: "json" }))
      );
      const buyers = allLeads.filter((l) => l && l.leadType !== "dealer");
      const dealers = allLeads.filter((l) => l && l.leadType === "dealer");
      // Public-safe counts only — never expose PII via this endpoint.
      return jsonResponse(200, {
        totalLeads: buyers.length,
        dealerInquiries: dealers.length,
        // We display "Lansing pilot" badge until totalLeads crosses 25
        phase: buyers.length >= 25 ? "growing" : "lansing_pilot",
        lastUpdated: new Date().toISOString(),
      });
    }

    const token = url.searchParams.get("token");
    const expected = process.env.ADMIN_TOKEN || DEFAULT_ADMIN_TOKEN;
    if (token !== expected) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const { blobs } = await store.list();
    const leads = await Promise.all(
      blobs.map(async (b) => {
        const data = await store.get(b.key, { type: "json" });
        return data;
      })
    );
    leads.sort((a, b) => (a?.id ?? 0) - (b?.id ?? 0));
    return jsonResponse(200, { count: leads.length, leads });
  }

  // ---- PATCH: update lead outcome (admin only) ----
  if (req.method === "PATCH") {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const expected = process.env.ADMIN_TOKEN || DEFAULT_ADMIN_TOKEN;
    if (token !== expected) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    let patchBody;
    try {
      patchBody = await req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }
    const { id, ...updates } = patchBody;
    if (!id || typeof id !== "number") {
      return jsonResponse(400, { error: "id (number) is required" });
    }
    const key = `lead-${String(id).padStart(6, "0")}`;
    const existing = await store.get(key, { type: "json" });
    if (!existing) {
      return jsonResponse(404, { error: `Lead #${id} not found` });
    }
    const ALLOWED_OUTCOME_FIELDS = [
      "status",
      "dealerContacted",
      "sold",
      "saleAmount",
      "notes",
      "updatedAt",
    ];
    const sanitized = {};
    for (const k of Object.keys(updates)) {
      if (ALLOWED_OUTCOME_FIELDS.includes(k)) {
        sanitized[k] = updates[k];
      }
    }
    sanitized.updatedAt = new Date().toISOString();
    const merged = { ...existing, ...sanitized };
    await store.setJSON(key, merged);
    return jsonResponse(200, { id, updated: sanitized });
  }

  // ---- DELETE: remove a lead (admin only) ----
  if (req.method === "DELETE") {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const expected = process.env.ADMIN_TOKEN || DEFAULT_ADMIN_TOKEN;
    if (token !== expected) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const idStr = url.searchParams.get("id");
    const id = idStr ? Number(idStr) : NaN;
    if (!Number.isInteger(id)) {
      return jsonResponse(400, { error: "id query param (integer) is required" });
    }
    const key = `lead-${String(id).padStart(6, "0")}`;
    await store.delete(key);
    return jsonResponse(200, { id, deleted: true });
  }

  // ---- POST: lead capture ----
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(400, {
      error: "Please fix the highlighted fields and try again.",
      details: parsed.error.flatten(),
    });
  }

  // Auto-incrementing ID using a counter blob
  const counterRaw = await store.get("__counter", { type: "text" });
  const nextId = (counterRaw ? Number(counterRaw) : 0) + 1;
  await store.set("__counter", String(nextId));

  const ipHeader =
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for") ||
    null;
  const ipAddress = ipHeader ? ipHeader.split(",")[0].trim() : null;
  const userAgent = req.headers.get("user-agent") || null;

  const lead = {
    id: nextId,
    createdAt: new Date().toISOString(),
    ...parsed.data,
    ipAddress,
    userAgent,
  };

  await store.setJSON(`lead-${String(nextId).padStart(6, "0")}`, lead);

  // CRITICAL: Await the email so Netlify doesn't kill the task mid-flight.
  // The lead is already saved to Blobs above, so even if email fails,
  // it's recoverable from the admin endpoint and the daily digest.
  const emailResult = await sendLeadEmail(lead);
  console.log(`[leads] Lead #${lead.id} email result:`, JSON.stringify(emailResult));

  return jsonResponse(201, {
    id: lead.id,
    fullName: lead.fullName,
    emailSent: emailResult.sent,
  });
};
