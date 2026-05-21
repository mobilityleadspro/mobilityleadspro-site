// MobilityLeads Pro — Netlify Function for lead capture
//
// What it does:
//   POST /api/leads (redirected to this function)
//     - Validates form fields
//     - Saves the lead JSON to Netlify Blobs (free, built-in storage)
//     - Emails LEAD_NOTIFICATION_EMAIL via SMTP if SMTP env vars are set
//   GET  /api/leads?token=<ADMIN_TOKEN>
//     - Returns all leads as JSON for Tyler's review
//
// Required environment variables (set in Netlify → Site settings → Environment variables):
//   SMTP_HOST       e.g. smtp.gmail.com
//   SMTP_PORT       e.g. 587
//   SMTP_USER       e.g. applinfc@gmail.com
//   SMTP_PASS       e.g. a 16-char Gmail App Password
//   SMTP_FROM       (optional) defaults to SMTP_USER
//
// Optional environment variables:
//   LEAD_NOTIFICATION_EMAIL   override where leads are emailed (default: applinfc@gmail.com)
//   ADMIN_TOKEN               override the admin token (default: tyler2026)

import { getStore } from "@netlify/blobs";
import nodemailer from "nodemailer";
import { z } from "zod";

const DEFAULT_LEAD_EMAIL = "applinfc@gmail.com";
const DEFAULT_ADMIN_TOKEN = "tyler2026";

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

const leadSchema = z.object({
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
});

function formatLeadEmail(lead) {
  return [
    `New MobilityLeads Pro lead from the Lansing landing page.`,
    ``,
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
    `IP address:     ${lead.ipAddress ?? "—"}`,
    `User agent:     ${lead.userAgent ?? "—"}`,
    ``,
    `Reply by calling ${lead.phone} or emailing ${lead.email} within 24 hours.`,
  ].join("\n");
}

async function sendLeadEmail(lead) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  const recipient = process.env.LEAD_NOTIFICATION_EMAIL || DEFAULT_LEAD_EMAIL;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log(
      `[leads] SMTP env not set — would have emailed ${recipient} re: lead #${lead.id} (${lead.fullName}, ${lead.zip})`
    );
    return { sent: false, reason: "smtp_not_configured" };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT ? Number(SMTP_PORT) : 587,
      secure: SMTP_PORT === "465",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({
      from: SMTP_FROM ?? SMTP_USER,
      to: recipient,
      subject: `New MobilityLeads Pro Lead: ${lead.fullName} (${lead.zip})`,
      text: formatLeadEmail(lead),
    });
    console.log(`[leads] Sent lead #${lead.id} email to ${recipient}`);
    return { sent: true };
  } catch (err) {
    console.error(`[leads] Email failed for lead #${lead.id}:`, err);
    return { sent: false, reason: "smtp_error", error: String(err) };
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

  // ---- GET: admin endpoint ----
  if (req.method === "GET") {
    const url = new URL(req.url);
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

  // Fire-and-forget email
  sendLeadEmail(lead).catch((err) => console.error("[leads] email task error:", err));

  return jsonResponse(201, { id: lead.id, fullName: lead.fullName });
};

export const config = {
  path: "/api/leads",
};
