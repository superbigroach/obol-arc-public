"use client";

// Client helper: ask our server route to POST a test message to the seller's
// incoming webhook (Slack/Discord/etc.). Server-side avoids the CORS block.
export async function testWebhook(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const res = await fetch("/api/notify-test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhookUrl, text }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}
