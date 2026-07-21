import { NextRequest, NextResponse } from "next/server";

async function getResendKey(): Promise<string> {
  const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: "projects/obol-arc/secrets/RESEND_API_KEY/versions/latest",
  });
  return version.payload?.data?.toString() ?? "";
}

function notificationHtml(name: string, email: string, message: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#06080F;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#06080F;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

        <!-- Header with logo -->
        <tr><td style="background:linear-gradient(135deg,#0d0a2e 0%,#06080F 60%);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;border-bottom:1px solid rgba(109,94,246,0.25)">
          <div style="display:inline-flex;align-items:center;gap:10px">
            <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="20" r="18" stroke="#6D5EF6" stroke-width="3.5" fill="none"/>
              <circle cx="20" cy="20" r="9" fill="#6D5EF6" opacity="0.3"/>
              <circle cx="20" cy="20" r="4" fill="#6D5EF6"/>
            </svg>
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.03em">Obol</span>
          </div>
          <p style="color:#a9abbd;font-size:13px;margin:8px 0 0">Pay-per-call API marketplace for AI agents</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#0d0f1a;padding:32px 40px;border-left:1px solid rgba(109,94,246,0.12);border-right:1px solid rgba(109,94,246,0.12)">
          <h2 style="color:#fff;font-size:20px;font-weight:700;margin:0 0 20px;letter-spacing:-0.02em">
            New contact from Scale plan
          </h2>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:10px 14px;background:rgba(109,94,246,0.08);border-radius:8px;margin-bottom:10px">
              <span style="color:#a9abbd;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Name</span><br>
              <span style="color:#fff;font-size:15px;font-weight:600;margin-top:4px;display:block">${name}</span>
            </td></tr>
            <tr><td style="height:8px"></td></tr>
            <tr><td style="padding:10px 14px;background:rgba(109,94,246,0.08);border-radius:8px">
              <span style="color:#a9abbd;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Email</span><br>
              <a href="mailto:${email}" style="color:#6D5EF6;font-size:15px;font-weight:600;margin-top:4px;display:block;text-decoration:none">${email}</a>
            </td></tr>
            <tr><td style="height:8px"></td></tr>
            <tr><td style="padding:14px;background:rgba(109,94,246,0.08);border-radius:8px">
              <span style="color:#a9abbd;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Message</span><br>
              <span style="color:#e2e4f0;font-size:15px;line-height:1.6;margin-top:6px;display:block;white-space:pre-wrap">${message}</span>
            </td></tr>
          </table>
          <div style="margin-top:24px;text-align:center">
            <a href="mailto:${email}" style="display:inline-block;background:linear-gradient(135deg,#6D5EF6,#4F8EFF);color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-size:14px;font-weight:700;letter-spacing:-.01em">
              Reply to ${name} →
            </a>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#06080F;border-radius:0 0 16px 16px;padding:20px 40px;text-align:center;border:1px solid rgba(109,94,246,0.12);border-top:none">
          <p style="color:#4a4c5e;font-size:12px;margin:0">Obol · obol-arc.web.app · obolmcp@gmail.com</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function confirmationHtml(name: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#06080F;font-family:'Inter',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#06080F;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0d0a2e 0%,#06080F 60%);border-radius:16px 16px 0 0;padding:32px 40px;text-align:center;border-bottom:1px solid rgba(109,94,246,0.25)">
          <div style="display:inline-flex;align-items:center;gap:10px">
            <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="20" cy="20" r="18" stroke="#6D5EF6" stroke-width="3.5" fill="none"/>
              <circle cx="20" cy="20" r="9" fill="#6D5EF6" opacity="0.3"/>
              <circle cx="20" cy="20" r="4" fill="#6D5EF6"/>
            </svg>
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.03em">Obol</span>
          </div>
          <p style="color:#a9abbd;font-size:13px;margin:8px 0 0">Pay-per-call API marketplace for AI agents</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#0d0f1a;padding:36px 40px;border-left:1px solid rgba(109,94,246,0.12);border-right:1px solid rgba(109,94,246,0.12);text-align:center">
          <div style="font-size:36px;margin-bottom:16px">✓</div>
          <h2 style="color:#fff;font-size:22px;font-weight:800;margin:0 0 12px;letter-spacing:-0.02em">
            Got it, ${name}!
          </h2>
          <p style="color:#a9abbd;font-size:15px;line-height:1.6;margin:0 0 28px;max-width:400px;margin-left:auto;margin-right:auto">
            We received your message and will get back to you within 1 business day.
            In the meantime, feel free to explore the marketplace.
          </p>
          <a href="https://obol-arc.web.app/marketplace" style="display:inline-block;background:linear-gradient(135deg,#6D5EF6,#4F8EFF);color:#fff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:700;letter-spacing:-.01em">
            Browse marketplace →
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#06080F;border-radius:0 0 16px 16px;padding:20px 40px;text-align:center;border:1px solid rgba(109,94,246,0.12);border-top:none">
          <p style="color:#4a4c5e;font-size:12px;margin:0">Obol · obol-arc.web.app · Built on Circle &amp; Arc</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function POST(req: NextRequest) {
  try {
    const { name, email, message } = await req.json();
    if (!name || !email || !message) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const apiKey = await getResendKey();
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);

    await Promise.all([
      // Notification to you
      resend.emails.send({
        from: "Obol Contact <onboarding@resend.dev>",
        to: "obolmcp@gmail.com",
        subject: `New Scale inquiry from ${name}`,
        html: notificationHtml(name, email, message),
        replyTo: email,
      }),
      // Confirmation to sender
      resend.emails.send({
        from: "Obol <onboarding@resend.dev>",
        to: email,
        subject: "We got your message — Obol",
        html: confirmationHtml(name),
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Contact route error:", err);
    return NextResponse.json({ error: "Send failed" }, { status: 500 });
  }
}
