<?php
// Email sender. Prefers the SendGrid Web API (HTTPS, port 443) when configured;
// falls back to PHP mail() otherwise. Callers always also get the raw invite/portal
// link in-app, so email is best-effort and never a blocker.
//
// Emails share one lightly-branded HTML "shell" (header + accent + button + footer).
// Branding is data-driven: the accent color follows the workspace theme (the gold the
// team already uses) unless overridden in config; the logo and company name come from
// config keys (with safe fallbacks), so they can be changed without a code deploy.

// ---------- Branding ----------

function mail_brand(int $wid = 0): array {
    $cfg = app_config();

    // Accent: explicit config override → workspace theme accent → preset → default gold.
    $accent = trim((string)($cfg['mail_brand_color'] ?? ''));
    if ($accent === '' && $wid > 0 && function_exists('workspace_theme')) {
        $accent = mail_theme_accent(workspace_theme($wid));
    }
    if (!preg_match('/^#[0-9a-fA-F]{6}$/', $accent)) $accent = '#B26B22';

    // Company label: config → workspace name → mail_from_name.
    $company = trim((string)($cfg['company_name'] ?? ''));
    if ($company === '' && $wid > 0 && function_exists('workspace_name')) $company = workspace_name($wid);
    if ($company === '') $company = (string)($cfg['mail_from_name'] ?? 'Client Desk');

    return [
        'accent'     => $accent,
        'accentDeep' => mail_mix($accent, '#000000', 0.16),
        'btnText'    => mail_readable($accent),
        'logo'       => trim((string)($cfg['mail_logo_url'] ?? '')),
        'company'    => $company,
        'tagline'    => trim((string)($cfg['company_tagline'] ?? '')),
        'siteUrl'    => trim((string)($cfg['company_url'] ?? ($cfg['app_origin'] ?? ''))),
    ];
}

function mail_theme_accent(string $themeStr): string {
    $presets = ['pine'=>'#1C6E78','slate'=>'#34568C','forest'=>'#2F7A45','plum'=>'#7A3F6E','graphite'=>'#44515F'];
    $accent = ''; $preset = 'pine';
    if ($themeStr !== '') {
        $j = json_decode($themeStr, true);
        if (is_array($j)) { $accent = (string)($j['accent'] ?? ''); $preset = (string)($j['preset'] ?? 'pine'); }
    }
    if ($accent !== '') return $accent;
    return $presets[$preset] ?? $presets['pine'];
}

function mail_hex2rgb(string $h): array {
    $h = ltrim($h, '#');
    if (strlen($h) !== 6) return [0, 0, 0];
    return [hexdec(substr($h, 0, 2)), hexdec(substr($h, 2, 2)), hexdec(substr($h, 4, 2))];
}
function mail_mix(string $hex, string $target, float $t): string {
    [$r1, $g1, $b1] = mail_hex2rgb($hex);
    [$r2, $g2, $b2] = mail_hex2rgb($target);
    return sprintf('#%02x%02x%02x',
        (int)round($r1 + ($r2 - $r1) * $t),
        (int)round($g1 + ($g2 - $g1) * $t),
        (int)round($b1 + ($b2 - $b1) * $t));
}
// Pick black or white text for legibility on a given background.
function mail_readable(string $hex): string {
    [$r, $g, $b] = mail_hex2rgb($hex);
    $lum = 0.2126 * pow($r / 255, 2.2) + 0.7152 * pow($g / 255, 2.2) + 0.0722 * pow($b / 255, 2.2);
    return $lum > 0.4 ? '#15302E' : '#FFFFFF';
}
function mail_e($s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }

// ---------- Template ----------
// $o keys: brand, heading, intro, details (array of [label,value]), note,
//          ctaUrl, ctaLabel, footerNote.

function email_render(array $o): string {
    $brand  = $o['brand'];
    $accent = $brand['accent']; $deep = $brand['accentDeep']; $btnText = $brand['btnText'];

    $logo = $brand['logo'];
    $headerBrand = $logo !== ''
        ? '<img src="' . mail_e($logo) . '" alt="' . mail_e($brand['company']) . '" height="38" style="display:block;border:0;max-height:44px;">'
        : '<span style="font-family:Georgia,\'Times New Roman\',serif;font-size:20px;font-weight:700;color:' . $deep . ';letter-spacing:.2px;">' . mail_e($brand['company']) . '</span>';

    $headingHtml = !empty($o['heading'])
        ? '<h1 style="margin:0 0 12px;font:600 22px/1.3 Georgia,\'Times New Roman\',serif;color:#15302E;">' . mail_e($o['heading']) . '</h1>'
        : '';

    $introHtml = !empty($o['intro'])
        ? '<div style="font:15px/1.55 Arial,Helvetica,sans-serif;color:#15302E;">' . nl2br(mail_e($o['intro'])) . '</div>'
        : '';

    $detailsHtml = '';
    if (!empty($o['details'])) {
        $rows = '';
        foreach ($o['details'] as $d) {
            [$label, $value] = $d;
            if ($value === null || $value === '') continue;
            $rows .= '<tr>'
                . '<td style="padding:6px 0;font:13px Arial,Helvetica,sans-serif;color:#6B7A74;width:130px;vertical-align:top;">' . mail_e($label) . '</td>'
                . '<td style="padding:6px 0;font:13px Arial,Helvetica,sans-serif;color:#15302E;font-weight:600;">' . mail_e($value) . '</td>'
                . '</tr>';
        }
        if ($rows !== '') {
            $detailsHtml = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F4F7F2;border:1px solid #E7EBE3;border-radius:10px;margin:18px 0;">'
                . '<tr><td style="padding:6px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" width="100%">' . $rows . '</table></td></tr></table>';
        }
    }

    $noteHtml = !empty($o['note'])
        ? '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:18px 0;"><tr>'
          . '<td style="border-left:3px solid ' . $accent . ';padding:2px 14px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#51635D;">' . nl2br(mail_e($o['note'])) . '</td>'
          . '</tr></table>'
        : '';

    $button = ''; $fallback = '';
    if (!empty($o['ctaUrl'])) {
        $label = mail_e($o['ctaLabel'] ?? 'Open Client Desk');
        $button = '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;"><tr>'
            . '<td bgcolor="' . $accent . '" style="border-radius:8px;">'
            . '<a href="' . mail_e($o['ctaUrl']) . '" target="_blank" style="display:inline-block;padding:12px 24px;font:600 14px Arial,Helvetica,sans-serif;color:' . $btnText . ';text-decoration:none;border-radius:8px;">' . $label . '</a>'
            . '</td></tr></table>';
        $fallback = '<p style="margin:8px 0 0;font:12px Arial,Helvetica,sans-serif;color:#869089;">Or paste this into your browser:<br>'
            . '<span style="color:' . $deep . ';word-break:break-all;">' . mail_e($o['ctaUrl']) . '</span></p>';
    }

    $tagline = $brand['tagline'] !== ''
        ? '<div style="color:#869089;font:12px Arial,Helvetica,sans-serif;margin-top:2px;">' . mail_e($brand['tagline']) . '</div>'
        : '';
    $footNote = !empty($o['footerNote'])
        ? '<div style="color:#869089;font:12px/1.5 Arial,Helvetica,sans-serif;margin-top:10px;">' . mail_e($o['footerNote']) . '</div>'
        : '';

    return
        '<!DOCTYPE html><html><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
        . '<body style="margin:0;padding:0;background:#EAEDE7;">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#EAEDE7;padding:28px 12px;"><tr><td align="center">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background:#FFFFFF;border:1px solid #D9DFD6;border-radius:14px;overflow:hidden;">'
        . '<tr><td style="height:4px;background:' . $accent . ';line-height:4px;font-size:0;">&nbsp;</td></tr>'
        . '<tr><td style="padding:22px 28px 0;">' . $headerBrand . '</td></tr>'
        . '<tr><td style="padding:18px 28px 26px;">' . $headingHtml . $introHtml . $detailsHtml . $noteHtml . $button . $fallback . '</td></tr>'
        . '<tr><td style="padding:16px 28px;background:#F4F7F2;border-top:1px solid #E7EBE3;">'
        . '<div style="font:600 13px Georgia,serif;color:#15302E;">' . mail_e($brand['company']) . '</div>' . $tagline . $footNote
        . '</td></tr>'
        . '</table>'
        . '<div style="font:11px Arial,Helvetica,sans-serif;color:#A7AFA8;margin-top:14px;">Sent by Client Desk</div>'
        . '</td></tr></table></body></html>';
}

function email_plain(array $o): string {
    $lines = [];
    if (!empty($o['heading'])) { $lines[] = $o['heading']; $lines[] = str_repeat('-', min(48, max(3, strlen($o['heading'])))); }
    if (!empty($o['intro']))   { $lines[] = ''; $lines[] = $o['intro']; }
    if (!empty($o['details'])) {
        $lines[] = '';
        foreach ($o['details'] as $d) { [$l, $v] = $d; if ($v === null || $v === '') continue; $lines[] = $l . ': ' . $v; }
    }
    if (!empty($o['note']))      { $lines[] = ''; $lines[] = '"' . $o['note'] . '"'; }
    if (!empty($o['ctaUrl']))    { $lines[] = ''; $lines[] = ($o['ctaLabel'] ?? 'Open') . ':'; $lines[] = $o['ctaUrl']; }
    if (!empty($o['footerNote'])){ $lines[] = ''; $lines[] = $o['footerNote']; }
    $lines[] = ''; $lines[] = '— ' . ($o['brand']['company'] ?? 'Client Desk');
    return implode("\n", $lines) . "\n";
}

function send_branded(string $to, string $subject, array $o): bool {
    return send_html_mail($to, $subject, email_render($o), email_plain($o));
}

// ---------- Specific emails ----------

// $byName non-empty = an admin started the reset on the user's behalf; empty = self-service.
function send_password_reset_email(string $to, string $link, string $byName = '', int $wid = 0): bool {
    $brand = mail_brand($wid);
    $intro = $byName !== ''
        ? $byName . ' started a password reset for your Client Desk account. Use the button below to choose a new password.'
        : 'We received a request to reset the password for your Client Desk account. Use the button below to choose a new password.';
    return send_branded($to, 'Reset your Client Desk password', [
        'brand'      => $brand,
        'heading'    => 'Reset your password',
        'intro'      => $intro,
        'details'    => [['Account', $to], ['Link expires', 'In 1 hour']],
        'ctaUrl'     => $link,
        'ctaLabel'   => 'Set a new password',
        'footerNote' => "This link works once and expires in 1 hour. If you didn't request this, you can ignore this email — your password won't change.",
    ]);
}

function send_invite_email(string $to, string $link, string $inviterName, string $workspace, int $wid = 0, string $kind = 'team', string $clientName = ''): bool {
    $brand = mail_brand($wid);
    if ($kind === 'requester') {
        $cn  = $clientName !== '' ? $clientName : $workspace;
        $who = $inviterName !== '' ? $inviterName : 'The team';
        $subject = 'Your request portal for ' . $cn;
        $o = [
            'brand'   => $brand,
            'heading' => "You're invited to the " . $cn . ' request portal',
            'intro'   => $who . ' has set up a private portal where you can submit requests for ' . $cn . ' and follow their progress. Set a password to get started.',
            'details' => [['Portal for', $cn], ['Your sign-in', $to]],
            'ctaUrl'  => $link, 'ctaLabel' => 'Accept invitation',
            'footerNote' => "This invitation expires in 14 days. If you weren't expecting it, you can ignore this email.",
        ];
    } else {
        $subject = "You're invited to " . $workspace . ' on Client Desk';
        $o = [
            'brand'   => $brand,
            'heading' => 'Join ' . $workspace,
            'intro'   => ($inviterName !== '' ? $inviterName . ' has invited you' : "You've been invited")
                         . ' to join the ' . $workspace . ' workspace on Client Desk. Set a password to finish setting up your account.',
            'details' => [['Workspace', $workspace], ['Your sign-in', $to]],
            'ctaUrl'  => $link, 'ctaLabel' => 'Accept invitation',
            'footerNote' => "This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.",
        ];
    }
    return send_branded($to, $subject, $o);
}

// ---------- Transport ----------

function send_html_mail(string $to, string $subject, string $html, string $text): bool {
    $cfg = app_config();
    $fromEmail = $cfg['mail_from'] ?? ('no-reply@' . mail_domain());
    $fromName  = $cfg['mail_from_name'] ?? 'Client Desk';
    $apiKey    = $cfg['sendgrid_api_key'] ?? '';

    if ($apiKey !== '') {
        return sendgrid_send($apiKey, $to, $fromEmail, $fromName, $subject, $text, $html);
    }
    // Fallback: local multipart/alternative mail (often filtered; SendGrid is preferred).
    $boundary = 'cd_' . bin2hex(random_bytes(8));
    $headers = [
        'From: ' . sprintf('%s <%s>', $fromName, $fromEmail),
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
    ];
    $body = "--$boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" . $text
          . "\r\n--$boundary\r\nContent-Type: text/html; charset=utf-8\r\n\r\n" . $html
          . "\r\n--$boundary--";
    return (bool)@mail($to, $subject, $body, implode("\r\n", $headers), '-f' . $fromEmail);
}

// Plain-text only sender, kept for any non-branded callers.
function send_mail(string $to, string $subject, string $body): bool {
    return send_html_mail($to, $subject, nl2br(mail_e($body)), $body);
}

// POST to SendGrid v3 mail/send. Sends text/plain and (optionally) text/html.
function sendgrid_send(string $apiKey, string $to, string $fromEmail, string $fromName, string $subject, string $text, string $html = ''): bool {
    $content = [['type' => 'text/plain', 'value' => $text]];
    if ($html !== '') $content[] = ['type' => 'text/html', 'value' => $html]; // text/plain must come first
    $payload = [
        'personalizations' => [['to' => [['email' => $to]]]],
        'from'    => ['email' => $fromEmail, 'name' => $fromName],
        'subject' => $subject,
        'content' => $content,
    ];
    $ch = curl_init('https://api.sendgrid.com/v3/mail/send');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS     => json_encode($payload),
    ]);
    $resp = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return $code >= 200 && $code < 300;
}

function mail_domain(): string {
    $cfg = app_config();
    $host = parse_url($cfg['app_origin'] ?? '', PHP_URL_HOST) ?: 'localhost';
    $parts = explode('.', $host);
    return count($parts) >= 2 ? implode('.', array_slice($parts, -2)) : $host;
}
