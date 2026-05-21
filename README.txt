MobilityLeads Pro — Lansing Landing Page
Netlify Deploy Package

═══════════════════════════════════════════════════
HOW TO DEPLOY (5 minutes)
═══════════════════════════════════════════════════

1. Go to:  https://app.netlify.com/drop
2. Sign in (you already have a Netlify account connected).
3. Drag the entire UNZIPPED folder onto the drop zone.
4. Wait ~30 seconds. Netlify gives you a temporary URL like
   https://radiant-cupcake-123abc.netlify.app
5. Test the URL — confirm the form loads on phone and desktop.

═══════════════════════════════════════════════════
CONNECT YOUR CUSTOM DOMAIN (mobilityleadspro.com)
═══════════════════════════════════════════════════

After the site is live on the temp URL:

A. In Netlify (your new site dashboard):
   1. Click "Domain settings" or "Add a domain"
   2. Enter:  mobilityleadspro.com
   3. Netlify will show you DNS records to add at GoDaddy

B. In GoDaddy:
   1. Sign in → My Products → Domains → mobilityleadspro.com
   2. Click "DNS" or "Manage DNS"
   3. Add the records Netlify gave you (typically):
      • A record:    @     →    75.2.60.5
      • CNAME:       www   →    [your-site-name].netlify.app
   4. Save. DNS takes 5 min – 24 hours to propagate.

C. Back in Netlify:
   1. Wait for the green check next to your domain
   2. Click "HTTPS" → "Verify DNS configuration"
   3. Enable "Force HTTPS"

Done. mobilityleadspro.com now loads your landing page.

═══════════════════════════════════════════════════
ENABLE EMAIL ALERTS FOR LEADS (optional but recommended)
═══════════════════════════════════════════════════

In Netlify → your site → Site settings → Environment variables → Add:

  SMTP_HOST    smtp.gmail.com
  SMTP_PORT    587
  SMTP_USER    applinfc@gmail.com
  SMTP_PASS    [your 16-char Gmail App Password]
  SMTP_FROM    applinfc@gmail.com

To get a Gmail App Password:
  https://myaccount.google.com/apppasswords
  (you must have 2-factor auth enabled on your Google account)

After adding env vars, trigger a redeploy in Netlify.
Every new lead will now email applinfc@gmail.com instantly.

═══════════════════════════════════════════════════
VIEW SUBMITTED LEADS ANYTIME
═══════════════════════════════════════════════════

Even without email, every lead is saved to Netlify Blobs.
View them at:

  https://mobilityleadspro.com/api/leads?token=tyler2026

(Returns JSON. Change the token in Netlify env vars by
setting ADMIN_TOKEN.)

═══════════════════════════════════════════════════
WHAT'S IN THIS PACKAGE
═══════════════════════════════════════════════════

  index.html             The landing page
  favicon.svg            Browser tab icon
  assets/                Compiled JS + CSS
  netlify.toml           Netlify configuration
  netlify/functions/     Serverless backend for the form
