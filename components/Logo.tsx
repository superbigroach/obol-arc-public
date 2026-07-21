// The Obol coin marks. `gradId` lets multiple instances share one gradient def.

export function CoinGradients() {
  // Render once near the root so all logos can reference these gradient ids.
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <linearGradient id="og" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d5ef6" />
          <stop offset="1" stopColor="#3b9eff" />
        </linearGradient>
        {/* metallic ring: lit upper-right, shadowed lower-left */}
        <linearGradient id="ring" x1="0.95" y1="0.05" x2="0.1" y2="1">
          <stop offset="0" stopColor="#dcefff" />
          <stop offset="0.28" stopColor="#5fb4ff" />
          <stop offset="0.6" stopColor="#6d5ef6" />
          <stop offset="1" stopColor="#241d63" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="34" fill="none" stroke="url(#ring)" strokeWidth="15" />
      <path
        d="M70 22 A34 34 0 0 1 80 44"
        fill="none"
        stroke="#ffffff"
        strokeWidth="4.5"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5 font-extrabold text-[20px] tracking-tight">
      <LogoMark size={size} />
      <span>Obol</span>
    </span>
  );
}

export function HeroCoin() {
  return (
    <svg className="coin-float relative z-[2]" width="240" height="240" viewBox="0 0 120 120" aria-hidden>
      <circle cx="60" cy="60" r="50" fill="none" stroke="url(#ring)" strokeWidth="2" opacity="0.3" />
      <circle cx="60" cy="60" r="40" fill="none" stroke="url(#ring)" strokeWidth="17" />
      <path
        d="M84 28 A40 40 0 0 1 99 60"
        fill="none"
        stroke="#eaf6ff"
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.92"
      />
      <circle cx="93" cy="37" r="4.5" fill="#ffffff" />
    </svg>
  );
}
