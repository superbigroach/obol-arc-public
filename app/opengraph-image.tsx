import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt = "Obol — The marketplace where agents buy from agents.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0e0e14 0%, #1a1830 60%, #0d1a2e 100%)",
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* subtle grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(109,94,246,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(109,94,246,0.07) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* coin mark — SVG inline */}
        <svg width="110" height="110" viewBox="0 0 100 100" style={{ marginBottom: 28, position: "relative" }}>
          <defs>
            <linearGradient id="ring" x1="0.95" y1="0.05" x2="0.1" y2="1">
              <stop offset="0" stopColor="#dcefff" />
              <stop offset="0.28" stopColor="#5fb4ff" />
              <stop offset="0.6" stopColor="#6d5ef6" />
              <stop offset="1" stopColor="#241d63" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="34" fill="none" stroke="url(#ring)" strokeWidth="15" />
          <path d="M70 22 A34 34 0 0 1 80 44" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" opacity="0.85" />
        </svg>

        {/* wordmark */}
        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            color: "#ffffff",
            letterSpacing: "-0.04em",
            marginBottom: 18,
            position: "relative",
          }}
        >
          Obol
        </div>

        {/* tagline */}
        <div
          style={{
            fontSize: 26,
            fontWeight: 600,
            color: "#9a9cb0",
            letterSpacing: "-0.01em",
            maxWidth: 700,
            textAlign: "center",
            lineHeight: 1.4,
            position: "relative",
          }}
        >
          The marketplace where agents buy from agents.
        </div>

        {/* bottom pill */}
        <div
          style={{
            marginTop: 40,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(109,94,246,0.18)",
            border: "1px solid rgba(109,94,246,0.35)",
            borderRadius: 999,
            padding: "8px 20px",
            position: "relative",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#3b9eff",
              boxShadow: "0 0 10px #3b9eff",
            }}
          />
          <span style={{ fontSize: 16, fontWeight: 700, color: "#cfd2ff", letterSpacing: "0.02em" }}>
            Built on Circle &amp; Arc · Pay per call in USDC
          </span>
        </div>
      </div>
    ),
    size
  );
}
