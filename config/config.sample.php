<?php
// Copy this file to a location OUTSIDE your web root and fill in real values,
// e.g. /var/www/vhosts/integritysafety.com/private/config.php
// Then point API_CONFIG to it (see api/public/index.php).
//
// NEVER commit the real config. Keep this sample (with placeholders) in git only.

return [
    // --- Database (from the Plesk "Add Database" step) ---
    'db_host' => 'localhost',
    'db_name' => 'YOUR_DB_NAME',
    'db_user' => 'YOUR_DB_USER',
    'db_pass' => 'YOUR_DB_PASSWORD',

    // --- App ---
    // Set to your live origin. Used to harden cookies + same-origin checks.
    'app_origin' => 'https://tasks.integritysafety.com',

    // Set true in production (HTTPS). Makes the session cookie Secure-only.
    'secure_cookies' => true,

    // Timezone used to decide "today" / "due today" for briefings and reports.
    'report_timezone' => 'America/Los_Angeles',

    // --- Email (SendGrid Web API) ---
    // API key with "Mail Send" permission. Leave '' to disable email (links still work).
    'sendgrid_api_key' => '',
    // Must be a SendGrid-verified sender (single sender or an authenticated domain).
    'mail_from' => 'no-reply@integritysafety.com',
    'mail_from_name' => 'Client Desk',

    // --- Email branding (all optional) ---
    // These control the look of the HTML emails. Leave any of them out for sensible defaults.
    // Logo: an absolute, public https:// URL to an image (~400px wide, white/transparent
    // background). Easiest: upload e.g. email-logo.png to your site's web root so it lives at
    // https://tasks.integritysafety.com/email-logo.png, then set that URL here. If blank, the
    // emails show your company name as a styled wordmark instead.
    'mail_logo_url' => '',
    // Company name shown in the header wordmark + footer. Defaults to your workspace name.
    'company_name' => '',
    // Optional one-line tagline under the company name in the footer.
    'company_tagline' => '',
    // Optional link for the footer/company. Defaults to app_origin.
    'company_url' => '',
    // Accent color for the header bar + button. Defaults to your workspace theme color
    // (the gold you set under Team → Appearance). Set a hex here only to override it.
    'mail_brand_color' => '',

    // Random long string; used as an extra session integrity salt.
    'app_secret' => 'change-me-to-a-long-random-string',
];
