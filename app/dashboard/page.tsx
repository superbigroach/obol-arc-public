"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { User } from "firebase/auth";
import { useAuth } from "@/components/AuthProvider";
import SiteNav from "@/components/SiteNav";
import FeesPanel from "@/components/FeesPanel";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import {
  listMyServices, getProfile, saveProfile, type Service,
} from "@/lib/clientStore";
import TxTable, { type Activity } from "@/components/TxTable";
import ActivityPanel from "@/components/ActivityPanel";
import { buildObolSkill } from "@/lib/obolSkill";

type Tab = "use" | "provide";
type ChainEntry = { label: string; balance: string };
type Wallet = {
  balance: {
    wallet: string;
    available: string;
    total: string;
    chains?: Record<string, ChainEntry>;
  };
  seller: { earned: string; calls: number; recent: Activity[] };
  buyer: { spent: string; calls: number; recent: Activity[] };
};

/** Human-readable label for all 12 Gateway-supported testnets. */
const ALL_CHAIN_LABELS: Record<string, string> = {
  arc:        "Arc Testnet",
  base:       "Base Sepolia",
  ethereum:   "Ethereum Sepolia",
  avalanche:  "Avalanche Fuji",
  optimism:   "OP Sepolia",
  arbitrum:   "Arbitrum Sepolia",
  polygon:    "Polygon Amoy",
  unichain:   "Unichain Sepolia",
  monad:      "Monad Testnet",
  solana:     "Solana Devnet",
  sonic:      "Sonic Testnet",
  worldchain: "World Chain Sepolia",
  sei:        "Sei Atlantic",
  hyperevm:   "HyperEVM Testnet",
};

// Chains a withdrawal can be delivered to. Withdrawals always SOURCE from the
// unified Arc Gateway balance (not a per-chain wallet balance), so any supported
// destination is selectable regardless of that chain's current wallet balance.
const WITHDRAW_DESTINATIONS = [
  "arc", "base", "ethereum", "avalanche", "optimism",
  "arbitrum", "polygon", "unichain", "monad", "solana",
];

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab: Tab = searchParams?.get("tab") === "provide" ? "provide" : "use";
  const [address, setAddress] = useState<string | null>(null);
  const [payout, setPayout] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  // Seller earnings are keyed to the payout address (which may be a SELF-CUSTODY
  // wallet ≠ the custodial buyer wallet), so fetch it separately for the Earn view.
  const [sellerWallet, setSellerWallet] = useState<Wallet | null>(null);
  const [spendingBalance, setSpendingBalance] = useState<string>("0");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const provisionedRef = useRef(false);
  const reload = useCallback(async () => {
    if (!user) return;
    const [prof, mine] = await Promise.all([getProfile(user.uid), listMyServices(user.uid)]);
    const addr = prof?.obolWalletAddress ?? prof?.address ?? null;
    setAddress(addr);
    setPayout(prof?.payoutAddress ?? addr ?? null);
    setServices(mine);
    setSpendingBalance(String(prof?.spendingBalance ?? "0"));

    const payoutAddr = prof?.payoutAddress ?? addr ?? null;
    if (addr) {
      const r = await fetch(`/api/wallet?address=${addr}`);
      const buyerW = r.ok ? await r.json() : null;
      setWallet(buyerW);
      // Earnings live at the payout address. If it's the same as the buyer wallet,
      // reuse it; otherwise fetch it (self-custody payout).
      if (payoutAddr && payoutAddr.toLowerCase() !== addr.toLowerCase()) {
        const sr = await fetch(`/api/wallet?address=${payoutAddr}`);
        setSellerWallet(sr.ok ? await sr.json() : null);
      } else {
        setSellerWallet(buyerW);
      }
    } else {
      setWallet(null);
      setSellerWallet(null);
    }
  }, [user]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { reload(); }, [reload]);


  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-base2">
      <SiteNav />

      <main className="mx-auto max-w-[1180px] px-6 py-8">
        {tab === "use"
          ? <BuyerView
              address={address}
              wallet={wallet}
              reload={reload}
              user={user}
              spendingBalance={spendingBalance}
            />
          : <SellerView user={user} address={address} payout={payout} services={services} wallet={sellerWallet ?? wallet} reload={reload} />}
      </main>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* clipboard blocked */ } }}
      className="shrink-0 rounded-[7px] border border-hairline px-2 py-1 text-[11.5px] font-semibold text-muted hover:bg-base2"
      aria-label="Copy address"
    >
      {done ? "Copied ✓" : "Copy"}
    </button>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="shadow-soft rounded-[16px] border border-hairline bg-white p-6">
      <div className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">{label}</div>
      <div className={`mt-2 text-[32px] font-extrabold tracking-[-.03em] ${accent ? "grad-text" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-[13px] text-success">{sub}</div>}
    </div>
  );
}

// ─── Fund Modal — loads API spending credits from the user's agent wallet ─
function FundModal({ arcBalance, onClose, onSuccess }: {
  arcBalance: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newBalance, setNewBalance] = useState<string | null>(null);

  async function fund() {
    if (!amount || parseFloat(amount) < 0.01) { setErr("Minimum $0.01"); return; }
    if (parseFloat(amount) > parseFloat(arcBalance || "0")) { setErr("Exceeds your Arc wallet balance."); return; }
    setBusy(true); setErr(null);
    try {
      const cf = httpsCallable<unknown, { spendingBalance: string }>(functions, "fundAgentBalance");
      const res = await cf({ amount });
      setNewBalance(res.data.spendingBalance);
      onSuccess();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 p-4 sm:items-center"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[440px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.18)]">
        <div className="mb-5 flex items-start justify-between">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Add API credits</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-base2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {newBalance ? (
          <div className="py-4 text-center">
            <div className="text-[40px]">✅</div>
            <p className="mt-3 text-[16px] font-bold">Credits added!</p>
            <p className="mt-1 text-[13px] text-muted">New API balance: <span className="font-bold text-ink">${newBalance} USDC</span></p>
            <button onClick={onClose} className="grad mt-5 w-full rounded-[10px] py-2.5 text-[14px] font-semibold text-white">Done</button>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="rounded-[10px] border border-hairline bg-base2 px-4 py-3">
              <div className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">From</div>
              <div className="mt-0.5 text-[14px] font-semibold text-ink">Your agent wallet (Arc Testnet)</div>
              <div className="text-[12px] text-muted">Balance: {arcBalance} USDC</div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Amount (USDC)</label>
                <button onClick={() => setAmount(parseFloat(arcBalance || "0").toFixed(2))}
                  className="text-[11px] font-semibold text-primary hover:underline">Max</button>
              </div>
              <input type="number" step="0.01" min="0.01" value={amount}
                onChange={(e) => { setAmount(e.target.value); setErr(null); }}
                className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-3 text-[14px] outline-none focus:border-primary"
                placeholder="0.00" />
            </div>
            <div className="rounded-[10px] bg-[rgba(109,94,246,.06)] px-4 py-3 text-[12.5px] text-primary">
              Transfers USDC from your wallet to Obol&apos;s relayer. Credits are used automatically when your agent calls services via the MCP. Takes ~10 seconds to confirm.
            </div>
            {err && <p className="text-[13px] text-red-600">{err}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 rounded-[10px] border border-hairline py-2.5 text-[14px] font-semibold text-muted hover:bg-base2">Cancel</button>
              <button onClick={fund} disabled={busy || !amount || parseFloat(amount) <= 0}
                className="flex-1 grad rounded-[10px] py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
                {busy ? "Transferring…" : "Add credits →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Withdraw Modal ───────────────────────────────────────────────────────

function WithdrawModal({ available, agentAddress, onClose, onSuccess, chains }: {
  available: string;
  agentAddress: string;
  onClose: () => void;
  onSuccess: () => void;
  chains?: Record<string, ChainEntry>;
}) {
  const [network, setNetwork] = useState("arc");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState(parseFloat(available || "0").toFixed(2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  // SECURITY: withdrawals require the user's 2FA code (if 2FA is set up).
  const [totpCode, setTotpCode] = useState("");

  // Withdrawals always source from the unified Arc Gateway balance (`available`),
  // regardless of destination chain — so the max is the Gateway balance, not the
  // destination chain's wallet balance.
  const selectedBalance = parseFloat(available || "0");
  const maxAmount = selectedBalance.toFixed(2);

  async function withdraw() {
    const validRecipient = network === "solana"
      ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient)
      : /^0x[0-9a-fA-F]{40}$/.test(recipient);
    if (!recipient || !validRecipient) { setErr(network === "solana" ? "Enter a valid Solana address." : "Enter a valid 0x address."); return; }
    if (!amount || parseFloat(amount) <= 0) { setErr("Enter a valid amount."); return; }
    if (parseFloat(amount) > selectedBalance) { setErr(`Exceeds ${ALL_CHAIN_LABELS[network]} balance`); return; }
    setBusy(true); setErr(null);
    try {
      // 2FA code is sent along; the backend requires it only if the user has 2FA set up.
      const fn = httpsCallable<unknown, { transferId?: string; txHash?: string }>(functions, "withdrawObolWallet");
      const res = await fn({ network, amount, recipient, ...(totpCode ? { totpCode } : {}) });
      setTxId(res.data?.transferId ?? res.data?.txHash ?? "submitted");
      onSuccess();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  // Destination options = every supported withdrawal chain (source is the Gateway
  // balance, so we do NOT gate destinations by per-chain wallet balance).
  const chainOptions = WITHDRAW_DESTINATIONS.map((k) => ({ key: k, label: ALL_CHAIN_LABELS[k] ?? k }));

  return (
    <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 p-4 sm:items-center"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[440px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.18)]">
        <div className="mb-5 flex items-start justify-between">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Withdraw USDC</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-base2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {txId ? (
          <div className="py-4 text-center">
            <div className="text-[40px]">✅</div>
            <p className="mt-3 text-[16px] font-bold">Withdrawal submitted!</p>
            <p className="mt-1 text-[13px] text-muted">Funds will arrive on {ALL_CHAIN_LABELS[network] ?? network} in a few minutes.</p>
            <button onClick={onClose} className="grad mt-5 w-full rounded-[10px] py-2.5 text-[14px] font-semibold text-white">Done</button>
          </div>
        ) : (
          <div className="grid gap-4">
            {/* Destination chain picker — source is always your Arc Gateway balance */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted block">Destination chain</label>
                <span className="text-[11px] text-muted">Spendable: <span className="font-semibold text-ink">${selectedBalance.toFixed(2)}</span></span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {chainOptions.map(c => (
                  <button
                    key={c.key}
                    onClick={() => { setNetwork(c.key); setErr(null); }}
                    className={`rounded-[10px] border-2 p-3 text-left transition ${network === c.key
                      ? 'border-primary bg-[rgba(109,94,246,.08)]'
                      : 'border-hairline hover:border-primary/40'}`}>
                    <div className="text-[13px] font-semibold text-ink">{c.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Recipient address</label>
              <input type="text" value={recipient} onChange={(e) => { setRecipient(e.target.value); setErr(null); }}
                placeholder={network === "solana" ? "Solana address (base58)…" : "0x…"}
                className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-3 font-mono text-[13px] outline-none focus:border-primary" />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Amount (USDC)</label>
                <button onClick={() => setAmount(maxAmount)}
                  className="text-[11px] font-semibold text-primary hover:underline">Max: {maxAmount}</button>
              </div>
              <input type="number" step="0.01" min="0.01" value={amount}
                onChange={(e) => { setAmount(e.target.value); setErr(null); }}
                className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-3 text-[14px] outline-none focus:border-primary"
                placeholder="0.00" />
            </div>
            {/* SECURITY — 2FA gate. If you've set up 2FA, a code is required to
                withdraw, so a leaked API key/session alone can't move funds out. */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">2FA code <span className="font-normal normal-case text-muted">(if enabled)</span></label>
              <input type="text" inputMode="numeric" autoComplete="one-time-code" value={totpCode}
                onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setErr(null); }}
                placeholder="123456"
                className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-3 font-mono tracking-[.3em] text-[15px] outline-none focus:border-primary" />
              <p className="mt-1.5 text-[12px] text-muted">🔒 Enter the code from your authenticator app. No 2FA yet? Set it up in Settings to protect withdrawals.</p>
            </div>
            {err && <p className="text-[13px] text-red-600">{err}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 rounded-[10px] border border-hairline py-2.5 text-[14px] font-semibold text-muted hover:bg-base2">Cancel</button>
              <button onClick={withdraw} disabled={busy || !amount || parseFloat(amount) <= 0 || selectedBalance <= 0}
                className="flex-1 grad rounded-[10px] py-2.5 text-[14px] font-semibold text-white transition-all hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-60">
                {busy ? "Withdrawing…" : "Withdraw →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bridge Modal ─────────────────────────────────────────────────────────

type BridgeTarget = { key: string; label: string; balance: string } | null;

function BridgeModal({ source, allLabels, onClose, onSuccess }: {
  source: { key: string; label: string; balance: string };
  allLabels: Record<string, string>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const destOptions = Object.entries(allLabels).filter(([k]) => k !== source.key);
  const [destKey, setDestKey] = useState(destOptions[0]?.[0] ?? "arc");
  const [amount, setAmount] = useState(parseFloat(source.balance).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);

  async function bridge() {
    if (!amount || parseFloat(amount) <= 0) { setErr("Enter a valid amount."); return; }
    setBusy(true); setErr(null);
    try {
      const fn = httpsCallable(functions, "bridgeChain");
      const res = await fn({ sourceChain: source.key, destChain: destKey, amount });
      const data = res.data as { explorer?: string };
      setTxUrl(data.explorer ?? null);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 p-4 sm:items-center"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[440px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.18)]">
        <div className="flex items-start justify-between mb-5">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Bridge USDC</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-base2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {txUrl ? (
          <div className="text-center py-4">
            <div className="text-[40px]">✅</div>
            <p className="mt-3 text-[16px] font-bold">Bridge submitted!</p>
            <p className="mt-1 text-[13px] text-muted">Takes ~30 seconds to arrive on {allLabels[destKey]}.</p>
            <a href={txUrl} target="_blank" rel="noreferrer" className="mt-3 block text-[13px] font-semibold text-primary hover:underline">View on explorer ↗</a>
            <button onClick={onSuccess} className="grad mt-5 w-full rounded-[10px] py-2.5 text-[14px] font-semibold text-white">Done</button>
          </div>
        ) : (
          <div className="grid gap-4">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">From</label>
              <div className="mt-1.5 rounded-[10px] border border-hairline bg-base2 px-4 py-3">
                <div className="text-[14px] font-semibold text-ink">{source.label}</div>
                <div className="text-[12px] text-muted">${parseFloat(source.balance).toFixed(2)} USDC available</div>
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">To</label>
              <select value={destKey} onChange={(e) => setDestKey(e.target.value)}
                className="mt-1.5 w-full rounded-[10px] border border-hairline bg-white px-4 py-3 text-[14px] font-semibold outline-none focus:border-primary">
                {destOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Amount (USDC)</label>
                <button onClick={() => setAmount(parseFloat(source.balance).toFixed(2))}
                  className="text-[11px] font-semibold text-primary hover:underline">Max</button>
              </div>
              <input type="number" step="0.01" min="0.01" max={source.balance}
                value={amount} onChange={(e) => { setAmount(e.target.value); setErr(null); }}
                className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-3 text-[14px] outline-none focus:border-primary"
                placeholder="0.00" />
            </div>
            <div className="rounded-[10px] bg-base2 px-4 py-3 text-[12.5px] text-muted">
              Bridged via Circle CCTP · burned on {source.label}, minted on {allLabels[destKey]} · ~30 seconds
            </div>
            {err && <p className="text-[13px] text-red-600">{err}</p>}
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 rounded-[10px] border border-hairline py-2.5 text-[14px] font-semibold text-muted hover:bg-base2">Cancel</button>
              <button onClick={bridge} disabled={busy || !amount || parseFloat(amount) <= 0}
                className="flex-1 grad rounded-[10px] py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
                {busy ? "Bridging…" : "Bridge →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Deposit Modal — fund your Arc balance from another network ───────────
// Arc uses the existing direct fundAgentBalance path (onSelectArc). Every
// other chain provisions a per-user deposit address, the user sends native
// USDC there, and processFundingDeposit bridges it to Arc via CCTP.

type DepositChain = { key: string; label: string; speed: string; beta: boolean };

// Arc is the hub: ONE spendable balance, whatever chain you fund from. Every other
// chain — Base included — bridges in via CCTP and lands in the same Gateway balance.
//
// BASE_RAW_FOR_BAZAAR keeps the old behaviour (Base USDC stays raw in your EOA so it
// can pay x402 Bazaar sellers directly). Bazaar listings are MAINNET-only, so on
// testnet that carve-out just gives users a second, confusing balance — it's off
// here and flips on with the mainnet build.
const BASE_RAW_FOR_BAZAAR: boolean = false;

const DEPOSIT_CHAINS: DepositChain[] = [
  { key: "arc",       label: "Arc Testnet",      speed: "~instant", beta: false },
  { key: "base",      label: "Base Sepolia",     speed: "~30–60s",  beta: false },
  { key: "avalanche", label: "Avalanche Fuji",   speed: "~seconds", beta: true  },
  { key: "polygon",   label: "Polygon Amoy",     speed: "~seconds", beta: true  },
  { key: "arbitrum",  label: "Arbitrum Sepolia", speed: "~30–60s",  beta: true  },
  { key: "optimism",  label: "OP Sepolia",       speed: "~30–60s",  beta: true  },
  { key: "ethereum",  label: "Ethereum Sepolia", speed: "~30–60s",  beta: true  },
  { key: "unichain",  label: "Unichain Sepolia", speed: "~30–60s",  beta: true  },
  { key: "monad",     label: "Monad Testnet",    speed: "~seconds", beta: true  },
  { key: "solana",    label: "Solana Devnet",    speed: "~seconds", beta: true  },
];

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity=".25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function DepositModal({ onClose, agentAddress, arcWalletBalance, reload }: {
  onClose: () => void;
  agentAddress: string | null;
  arcWalletBalance: string;
  reload: () => void;
}) {
  const [selected, setSelected] = useState<DepositChain | null>(null);
  const [depositAddress, setDepositAddress] = useState<string | null>(null);
  const [depositLabel, setDepositLabel] = useState<string>("");
  const [provisioning, setProvisioning] = useState(false);
  const [bridging, setBridging] = useState(false);
  const [credited, setCredited] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Stop any in-flight polling loop if the modal unmounts.
  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  async function pickChain(chain: DepositChain) {
    // Direct-to-EOA chains — no SCA, no bridge. Your agent wallet has the SAME
    // address on every chain, so you just send USDC to it on the chain you want:
    //   • Arc  → auto-deposits into your Gateway balance (sub-cent marketplace rail)
    //   • Base → raw, Bazaar-spendable ONLY when BASE_RAW_FOR_BAZAAR is on (mainnet)
    if (chain.key === "arc" || (chain.key === "base" && BASE_RAW_FOR_BAZAAR)) {
      setSelected(chain);
      setDepositLabel(chain.key === "arc" ? "Arc — marketplace balance" : "Base — spendable for Bazaar (raw, no bridge)");
      setDepositAddress(agentAddress);
      return;
    }
    setSelected(chain);
    setProvisioning(true);
    setErr(null);
    try {
      const fn = httpsCallable<{ chain: string }, { chain: string; depositAddress: string; label: string; cached: boolean }>(
        functions, "provisionFundingWallet",
      );
      const res = await fn({ chain: chain.key });
      setDepositAddress(res.data.depositAddress);
      setDepositLabel(res.data.label || chain.label);
    } catch (e) {
      setErr((e as Error).message);
      setSelected(null);
    } finally {
      setProvisioning(false);
    }
  }

  // Poll processFundingDeposit every ~15s. "No USDC found yet" means the user
  // hasn't sent funds — keep waiting. Any other error stops the loop.
  async function checkDeposit() {
    if (!selected) return;
    setBridging(true);
    setErr(null);
    // Arc: no bridge — deposit whatever USDC is in the wallet straight into the balance.
    if (selected.key === "arc") {
      try {
        const amt = parseFloat(arcWalletBalance || "0");
        if (amt < 0.06) { setErr("No USDC in your Arc wallet yet. Send USDC to the address above, then tap again."); setBridging(false); return; }
        const dep = (Math.floor((amt - 0.05) * 100) / 100).toFixed(2); // leave a little for gas
        const fn = httpsCallable<{ amount: string }, unknown>(functions, "fundAgentBalance");
        await fn({ amount: dep });
        setCredited(dep); setBridging(false); reload(); return;
      } catch (e) { setErr((e as Error).message); setBridging(false); return; }
    }
    // Base (mainnet/Bazaar mode only): raw USDC in your EOA is immediately spendable via
    // the facilitator — nothing to bridge or credit. Just confirm + refresh balances.
    if (selected.key === "base" && BASE_RAW_FOR_BAZAAR) {
      setCredited("ready"); setBridging(false); reload(); return;
    }
    const fn = httpsCallable<{ chain: string }, { ok: boolean; chain: string; received: string; credited: string }>(
      functions, "processFundingDeposit",
    );
    while (!cancelledRef.current) {
      try {
        const res = await fn({ chain: selected.key });
        if (res.data?.ok) {
          setCredited(res.data.credited);
          setBridging(false);
          reload();
          return;
        }
      } catch (e) {
        const msg = (e as Error).message || "";
        const notYet = /no usdc/i.test(msg) || /failed-precondition/i.test(msg) || /not.*arrived/i.test(msg);
        if (!notYet) { setErr(msg); setBridging(false); return; }
        // else: funds not arrived yet — fall through and keep polling.
      }
      await new Promise((r) => setTimeout(r, 15000));
    }
  }

  const label = depositLabel || selected?.label || "";

  return (
    <div className="fixed inset-0 z-[999] flex items-end justify-center bg-black/40 p-4 sm:items-center"
         onClick={(e) => { if (e.target === e.currentTarget && !bridging) onClose(); }}>
      <div className="w-full max-w-[440px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.18)]">
        <div className="mb-5 flex items-start justify-between">
          <h2 className="text-[18px] font-bold tracking-[-.02em]">Deposit from another network</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-base2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {credited ? (
          // ── Success ──
          <div className="py-4 text-center">
            <div className="text-[40px]">✅</div>
            <p className="mt-3 text-[16px] font-bold">{selected?.key === "base" && BASE_RAW_FOR_BAZAAR ? "Base USDC ready" : "Deposit credited!"}</p>
            <p className="mt-1 text-[13px] text-muted">
              {selected?.key === "base" && BASE_RAW_FOR_BAZAAR
                ? "Your Base USDC is spendable directly for Bazaar services — no bridge."
                : <>Credited <span className="font-bold text-ink">{credited} USDC</span> to your Arc balance.</>}
            </p>
            <button onClick={onClose} className="grad mt-5 w-full rounded-[10px] py-2.5 text-[14px] font-semibold text-white">Done</button>
          </div>
        ) : depositAddress ? (
          // ── Send + check ──
          <div className="grid gap-4">
            <div className="flex items-center gap-2">
              <button onClick={() => { if (!bridging) { setSelected(null); setDepositAddress(null); setErr(null); } }}
                disabled={bridging}
                className="text-[12px] font-semibold text-primary hover:underline disabled:opacity-40">← Change network</button>
              {selected?.beta && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Beta</span>}
              <span className="ml-auto text-[11px] font-semibold text-muted">{selected?.speed}</span>
            </div>

            <div>
              <div className="text-[13px] font-semibold text-ink">Send USDC on {label} to this address:</div>
              <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-hairline bg-base2 px-3 py-3">
                <span className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-ink">{depositAddress}</span>
                <CopyBtn text={depositAddress} />
              </div>
            </div>

            <div className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
              ⚠️ Send only native USDC on {label} — wrong network or token = lost funds.
            </div>

            {bridging ? (
              <div className="flex items-center justify-center gap-2 rounded-[10px] bg-[rgba(109,94,246,.06)] px-4 py-3 text-[13px] font-semibold text-primary">
                <Spinner /> {selected?.key === "arc" ? "Depositing into your balance…" : selected?.key === "base" && BASE_RAW_FOR_BAZAAR ? "Confirming…" : "Bridging to your balance…"}
              </div>
            ) : (
              <div className="rounded-[10px] bg-base2 px-4 py-3 text-[12.5px] text-muted">
                {selected?.key === "arc"
                  ? "Arc USDC deposits straight into your spendable balance — no bridge. (Also auto-converts within ~5 min if you just send it.)"
                  : selected?.key === "base" && BASE_RAW_FOR_BAZAAR
                  ? "Raw Base USDC in your wallet — spendable directly for Bazaar services. No bridge, no conversion."
                  : `Bridged via Circle CCTP · lands in your spendable balance in ${selected?.speed}.`}
              </div>
            )}

            {err && <p className="text-[13px] text-red-600">{err}</p>}

            <div className="flex gap-3">
              <button onClick={onClose} disabled={bridging}
                className="flex-1 rounded-[10px] border border-hairline py-2.5 text-[14px] font-semibold text-muted hover:bg-base2 disabled:opacity-60">
                {bridging ? "Close" : "Cancel"}
              </button>
              <button onClick={checkDeposit} disabled={bridging}
                className="flex-1 grad rounded-[10px] py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
                {bridging ? (selected?.key === "arc" ? "Depositing…" : "Checking…") : (selected?.key === "arc" ? "Deposit to my balance →" : "Check / I've sent it →")}
              </button>
            </div>
          </div>
        ) : (
          // ── Network picker ──
          <div className="grid gap-4">
            <p className="text-[13px] text-muted">Pick the network you&apos;re funding from. USDC lands in your Arc balance and becomes API credits.</p>
            <div className="grid grid-cols-2 gap-2">
              {DEPOSIT_CHAINS.map((c) => {
                const isSel = selected?.key === c.key;
                return (
                  <button key={c.key} onClick={() => pickChain(c)} disabled={provisioning}
                    className={`rounded-[10px] border-2 p-3 text-left transition disabled:opacity-60 ${isSel
                      ? "border-primary bg-[rgba(109,94,246,.08)]"
                      : "border-hairline hover:border-primary/40"}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-ink">{c.label}</span>
                      {c.beta && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-amber-700">Beta</span>}
                    </div>
                    <div className="mt-1 text-[11.5px] text-muted">
                      {c.key === "arc" ? "Direct · " : "Bridge · "}{c.speed}
                    </div>
                    {isSel && provisioning && <div className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-primary"><Spinner /> Preparing…</div>}
                  </button>
                );
              })}
            </div>
            {err && <p className="text-[13px] text-red-600">{err}</p>}
            <div className="rounded-[10px] bg-base2 px-4 py-3 text-[12.5px] text-muted">
              Every network lands in the same spendable Arc balance. Arc funds instantly from your agent wallet; everything else bridges in via Circle CCTP — Base is the most tested route.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MCP config block with copy button ───────────────────────────────────
// Keyless: an Obol API key is all a buyer needs. Obol's relayer pays sellers
// from the account's funded spending balance — no private key anywhere.
function McpConfigBlock() {
  const [copied, setCopied] = useState(false);
  const config = `{
  "mcpServers": {
    "obol": {
      "command": "npx",
      "args": ["-y", "@superbigroach/obol-mcp"],
      "env": { "OBOL_API_KEY": "obl_sk_live_…" }
    }
  }
}`;
  async function copy() {
    await navigator.clipboard.writeText(config).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }
  return (
    <div className="relative mt-4">
      <pre className="overflow-x-auto rounded-[12px] border border-hairline bg-[#0b0b12] p-5 text-[13px] leading-relaxed text-[#e6e6f0]">
        {config}
      </pre>
      <button
        onClick={copy}
        className="absolute right-3 top-3 rounded-[7px] border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-700"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

// ─── Build with AI — Obol Skill card ─────────────────────────────────────
function ObolSkillCard({ sellerAddr }: { sellerAddr: string }) {
  const [copied, setCopied] = useState(false);
  const skill = buildObolSkill(sellerAddr);
  async function copy() {
    await navigator.clipboard.writeText(skill).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="relative overflow-hidden rounded-[18px] border border-[#6d5ef6]/30 bg-gradient-to-br from-[#0c0a1f] to-[#1a1340] p-7 text-white shadow-[0_20px_60px_rgba(109,94,246,.14)]">
      <div className="pointer-events-none absolute -right-16 -top-16 h-[220px] w-[220px] rounded-full bg-[#6d5ef6]/25 blur-[70px]" />
      <div className="relative">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.06] px-3 py-1 text-[11px] font-bold uppercase tracking-[.06em] text-[#cfd2ff]">
          ✨ Build with AI · 2-min setup
        </div>
        <h3 className="text-[20px] font-extrabold tracking-[-.03em]">
          Don&apos;t write code. Let your AI build the service.
        </h3>
        <p className="mt-2 max-w-[520px] text-[13.5px] leading-relaxed text-[#a9abbd]">
          Copy the Obol Skill below and paste it into <b className="text-white">Claude, ChatGPT, or Cursor</b>.
          Your Arc payout address is already baked in — your AI will scaffold, wire, and deploy a live paid API for you.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={copy}
            className="grad inline-flex items-center gap-2 rounded-[10px] px-5 py-2.5 text-[13px] font-bold text-white shadow-[0_4px_14px_rgba(109,94,246,.4)] transition hover:-translate-y-px"
          >
            {copied ? "Copied to clipboard ✓" : "📋 Copy the Obol Skill"}
          </button>
          <Link href="/docs#ai-quickstart" className="inline-flex items-center gap-2 rounded-[10px] border border-white/20 bg-white/[.07] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-white/[.14]">
            Full docs →
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Buyer View ───────────────────────────────────────────────────────────

function BuyerView({ address, wallet, reload, user, spendingBalance }: {
  address: string | null;
  wallet: Wallet | null;
  reload: () => void;
  user: User | null;
  spendingBalance: string;
}) {
  const chains = wallet?.balance.chains;
  const [bridgeTarget, setBridgeTarget] = useState<BridgeTarget>(null);
  const [fundOpen, setFundOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [provisioningWallet, setProvisioningWallet] = useState(false);
  const [walletErr, setWalletErr] = useState<string | null>(null);

  async function provisionWallet() {
    setProvisioningWallet(true);
    setWalletErr(null);
    try {
      const fn = httpsCallable(functions, "provisionObolWallet");
      await fn({});
      // Auto-issue the ACK-ID verified identity the moment the wallet exists —
      // fully automatic, no user action. Best-effort: never blocks the wallet flow.
      httpsCallable(functions, "reissueAck")({}).catch(() => {});
      reload();
    } catch (e) {
      setWalletErr((e as Error).message);
    } finally {
      setProvisioningWallet(false);
    }
  }

  const chainEntries: [string, ChainEntry][] = chains
    ? Object.entries(chains).filter(([k, v]) => k === "arc" || parseFloat(v.balance) > 0)
    : [];

  const totalAcrossChains = chains
    ? Object.values(chains).reduce((s, c) => s + parseFloat(c.balance || "0"), 0).toFixed(2)
    : "0";

  return (
    <>
      {/* ── Balance hero: ONE spendable balance, two actions ── */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="shadow-soft lg:col-span-2 rounded-[18px] border border-hairline bg-white p-7">
          <div className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">Balance</div>
          <div className="mt-1.5 text-[46px] font-extrabold leading-none tracking-[-.03em] grad-text">
            ${parseFloat(wallet?.balance.available ?? "0").toFixed(2)}
          </div>
          <div className="mt-2 text-[13px] text-success">USDC · ready to spend on API calls</div>
          {parseFloat(totalAcrossChains) > 0.5 && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-[9px] border border-hairline bg-base2 px-3 py-1.5 text-[12px] text-muted" title="Leftover testnet USDC sitting at your wallet address on non-Arc chains. Your wallet only operates on Arc, so these can't be moved. New deposits go through the deposit flow and land in your balance normally.">
              <span>＋ <span className="font-semibold text-ink">${totalAcrossChains}</span> leftover testnet USDC on other chains</span>
              <span className="text-[11px]">· not spendable</span>
            </div>
          )}

          {address ? (
            <>
              <div className="mt-6 flex flex-wrap gap-2.5">
                <button onClick={() => setDepositOpen(true)}
                  className="grad rounded-[11px] px-6 py-3 text-[14.5px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)] hover:opacity-95">
                  ↓ Deposit
                </button>
                <button onClick={() => setWithdrawOpen(true)}
                  className="rounded-[11px] border border-hairline bg-white px-6 py-3 text-[14.5px] font-semibold text-ink hover:bg-base2">
                  ↑ Withdraw
                </button>
                <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
                  className="rounded-[11px] border border-hairline bg-white px-5 py-3 text-[13.5px] font-semibold text-muted hover:bg-base2">
                  Get testnet USDC ↗
                </a>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
                <span className="rounded-full bg-[rgba(109,94,246,.12)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">Agent wallet</span>
                <span className="font-mono text-[13px] text-ink">{address.slice(0, 10)}…{address.slice(-8)}</span>
                <CopyBtn text={address} />
                <span className="ml-auto text-[12px] text-muted">Deposit auto-lands here · withdraw to any chain</span>
              </div>
            </>
          ) : (
            <div className="mt-6">
              <p className="text-[13.5px] text-muted">Provision your agent wallet — Obol creates a secure Arc wallet for your account.</p>
              <button onClick={provisionWallet} disabled={provisioningWallet}
                className="grad mt-3 rounded-[11px] px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-60">
                {provisioningWallet ? "Setting up…" : "Set up wallet →"}
              </button>
              {walletErr && <p className="mt-2 text-[12.5px] text-red-600">{walletErr}</p>}
            </div>
          )}
        </div>

        <div className="grid content-start gap-5">
          <Stat label="Spent" value={`$${wallet?.buyer.spent ?? "0"}`} sub="on API calls, all time" />
          <Stat label="Calls made" value={String(wallet?.buyer.calls ?? 0)} sub="paid API calls" />
        </div>
      </div>


      {/* ── Activity feed — history of the unified balance (deposits, payments, withdrawals, bridges) ── */}
      <ActivityPanel uid={user?.uid} />

      {/* ── Modals ── */}
      {bridgeTarget && (
        <BridgeModal
          source={bridgeTarget}
          allLabels={ALL_CHAIN_LABELS}
          onClose={() => setBridgeTarget(null)}
          onSuccess={() => { setBridgeTarget(null); reload(); }}
        />
      )}
      {fundOpen && (
        <FundModal
          arcBalance={chains?.arc?.balance ?? "0"}
          onClose={() => setFundOpen(false)}
          onSuccess={() => { setFundOpen(false); reload(); }}
        />
      )}
      {depositOpen && (
        <DepositModal
          onClose={() => setDepositOpen(false)}
          agentAddress={address}
          arcWalletBalance={wallet?.balance.wallet ?? "0"}
          reload={reload}
        />
      )}
      {withdrawOpen && address && (
        <WithdrawModal
          available={wallet?.balance.available ?? "0"}
          agentAddress={address}
          chains={chains}
          onClose={() => setWithdrawOpen(false)}
          onSuccess={() => { setWithdrawOpen(false); reload(); }}
        />
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.5fr]">
        {/* Build with AI — Obol Skill prompt */}
        <ObolSkillCard sellerAddr={address ?? "0xYourArcAddress"} />

        <div className="shadow-soft rounded-[18px] border border-hairline bg-white p-7">
          <h3 className="text-[18px] font-bold tracking-[-.02em]">Connect your agent (MCP)</h3>
          <p className="mt-1.5 text-[14px] text-muted">Add Obol to Claude, Cursor, or any MCP-compatible agent — it discovers services, pays per call, and returns results automatically. Just your API key from Settings — no private key needed.</p>
          <McpConfigBlock />
        </div>
      </div>
      <TxTable title="Services used" rows={wallet?.buyer.recent ?? []} kind="spend" />
    </>
  );
}

// ─── Seller View ──────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function SellerView({ address, payout, services, wallet, reload }: { user: User; address: string | null; payout: string | null; services: Service[]; wallet: Wallet | null; reload: () => void }) {
  const hasWallet = !!address;
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  // Self-custody payout wallet — where earnings land. Seller can point this at
  // their OWN wallet (they hold the keys), so a platform breach can't touch earnings.
  const [payoutInput, setPayoutInput] = useState("");
  const [savingPayout, setSavingPayout] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState<string | null>(null);
  const isSelfCustody = !!payout && !!address && payout.toLowerCase() !== address.toLowerCase();

  async function savePayout() {
    const addr = payoutInput.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { setPayoutMsg("Enter a valid 0x wallet address."); return; }
    setSavingPayout(true); setPayoutMsg(null);
    try {
      const fn = httpsCallable<{ address: string }, { ok: boolean; services: number }>(functions, "setPayoutWallet");
      const res = await fn({ address: addr });
      setPayoutMsg(`✓ Earnings now go to your own wallet (updated ${res.data.services} service${res.data.services === 1 ? "" : "s"}).`);
      setPayoutInput("");
      reload();
    } catch (e) { setPayoutMsg((e as Error).message); }
    finally { setSavingPayout(false); }
  }

  // Create a self-custody EOA in the BROWSER. The private key/phrase is shown ONCE
  // and NEVER sent to Obol — only the address is stored (as payout). Copy-at-creation
  // = true self-custody: lose the phrase, lose the earnings, and Obol can't recover it.
  const [genWallet, setGenWallet] = useState<{ address: string; privateKey: string; mnemonic: string } | null>(null);
  const [savedConfirm, setSavedConfirm] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function createSelfCustodyWallet() {
    setPayoutMsg(null);
    const { Wallet } = await import("ethers");
    const w = Wallet.createRandom();
    setGenWallet({ address: w.address, privateKey: w.privateKey, mnemonic: w.mnemonic?.phrase ?? "" });
    setSavedConfirm(false);
  }

  async function confirmSelfCustodyWallet() {
    if (!genWallet || !savedConfirm) return;
    setConfirming(true);
    try {
      const fn = httpsCallable<{ address: string }, { ok: boolean; services: number }>(functions, "setPayoutWallet");
      await fn({ address: genWallet.address });   // only the ADDRESS goes to Obol — never the key
      setGenWallet(null); setSavedConfirm(false);
      setPayoutMsg("✓ Self-custody earnings wallet set. You hold the keys.");
      reload();
    } catch (e) { setPayoutMsg((e as Error).message); }
    finally { setConfirming(false); }
  }

  // Cash out self-custody earnings to any chain. Seller pastes their key → it signs
  // (deposit + burn) entirely in the browser → only the signed intent goes to Obol,
  // which relays the mint. The key NEVER touches Obol's servers.
  const [cashOut, setCashOut] = useState(false);
  const [coNetwork, setCoNetwork] = useState("base");
  const [coRecipient, setCoRecipient] = useState("");
  const [coAmount, setCoAmount] = useState("");
  const [coKey, setCoKey] = useState("");
  const [coBusy, setCoBusy] = useState(false);
  const [coStep, setCoStep] = useState<string>("");
  const [coMsg, setCoMsg] = useState<string | null>(null);
  const [coDone, setCoDone] = useState<string | null>(null);

  async function doCashOut() {
    setCoMsg(null);
    if (!/^0x[0-9a-fA-F]{40}$/.test(coRecipient)) { setCoMsg("Enter a valid 0x recipient address."); return; }
    if (!coAmount || parseFloat(coAmount) < 0.1) { setCoMsg("Enter an amount of at least 0.1 USDC."); return; }
    if (!coKey.trim()) { setCoMsg("Paste your wallet's private key — it signs locally and never leaves your browser."); return; }
    setCoBusy(true);
    try {
      const lib = await import("@/lib/sellerWithdraw");
      if (lib.cctpSupported(coNetwork)) {
        // Non-Gateway chain (Monad): raw CCTP burn, then relay polls IRIS + mints.
        setCoStep("Signing CCTP burn in your browser…");
        const { burnTxHash } = await lib.buildSellerCctpBurn({ privateKey: coKey, network: coNetwork, recipient: coRecipient, amount: coAmount });
        setCoStep("Waiting for attestation + delivering…");
        const fn = httpsCallable<{ network: string; burnTxHash: string }, { txHash?: string; explorer?: string }>(functions, "relaySellerWithdrawCctp");
        const res = await fn({ network: coNetwork, burnTxHash });
        setCoDone(res.data?.explorer || res.data?.txHash || "submitted");
      } else {
        // Gateway EVM chain: deposit + sign burn intent, relay to Gateway API + mint.
        setCoStep("Signing in your browser (deposit + burn)…");
        const { burnIntent, signature } = await lib.buildSellerWithdraw({ privateKey: coKey, network: coNetwork, recipient: coRecipient, amount: coAmount });
        setCoStep("Delivering to " + coNetwork + "…");
        const fn = httpsCallable<{ network: string; burnIntent: unknown; signature: string }, { txHash?: string; explorer?: string }>(functions, "relaySellerWithdraw");
        const res = await fn({ network: coNetwork, burnIntent, signature });
        setCoDone(res.data?.explorer || res.data?.txHash || "submitted");
      }
      setCoKey("");
      reload();
    } catch (e) { setCoMsg((e as Error).message); }
    finally { setCoBusy(false); setCoStep(""); }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return; // Skip on server-side

    async function fetchRatings() {
      if (!services.length) return;
      try {
        let totalRatings = 0;
        let totalCount = 0;

        for (const svc of services) {
          try {
            const r = await fetch(`/api/service-rating?serviceId=${svc.id}`);
            if (r.ok) {
              const data = await r.json() as { avgRating?: number; ratingCount?: number };
              totalRatings += (data.avgRating ?? 0) * (data.ratingCount ?? 0);
              totalCount += data.ratingCount ?? 0;
            }
          } catch { /* skip failed fetch */ }
        }

        const avg = totalCount > 0 ? totalRatings / totalCount : 0;
        setAvgRating(avg);
        setRatingCount(totalCount);
      } catch { /* silent fail */ }
    }
    fetchRatings();
  }, [services]);

  return (
    <>
      {!hasWallet && (
        <div className="mb-6 rounded-[14px] border border-amber-300 bg-amber-50 p-5 flex items-center gap-4">
          <span className="text-[28px]">🔑</span>
          <div className="flex-1">
            <div className="text-[14px] font-bold">Wallet required to list services</div>
            <div className="text-[13px] text-muted">Go to the Use services tab to set up your wallet first — payments land there.</div>
          </div>
          <button onClick={() => document.querySelector<HTMLButtonElement>("[data-tab-use]")?.click()}
            className="shrink-0 rounded-[10px] border border-amber-400 bg-white px-4 py-2 text-[13px] font-semibold text-amber-700 hover:bg-amber-50">
            Set up wallet
          </button>
        </div>
      )}

      {hasWallet && (
        <div className="mb-5 rounded-[16px] border border-hairline bg-white p-6 shadow-soft">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">Earnings wallet</div>
            {isSelfCustody
              ? <span className="rounded-full bg-[rgba(16,185,129,.12)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-success">Self-custody 🔑</span>
              : <span className="rounded-full bg-base2 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">Obol-managed</span>}
          </div>
          <div className="mt-2 break-all font-mono text-[13px] text-ink">{payout ?? "—"}</div>
          <p className="mt-2 text-[12.5px] text-muted">
            {isSelfCustody
              ? "Earnings land in your own wallet — you hold the keys, so a platform breach can't touch them."
              : "✓ You're all set — earnings arrive here automatically and you can withdraw to any chain anytime. No setup needed. (Advanced, optional: prefer to hold your own keys? Paste your wallet below — you'll receive on Arc and bridge out yourself.)"}
          </p>
          {isSelfCustody && (
            <button onClick={() => { setCashOut(true); setCoDone(null); setCoMsg(null); }}
              className="mt-3 grad rounded-[10px] px-5 py-2.5 text-[13.5px] font-semibold text-white">
              Cash out earnings → any chain
            </button>
          )}
          {!isSelfCustody && (
            <div className="mt-3">
              <button onClick={createSelfCustodyWallet}
                className="grad rounded-[10px] px-5 py-2.5 text-[13.5px] font-semibold text-white">
                ✨ Create a self-custody wallet on Arc
              </button>
              <p className="mt-2 text-[12px] text-muted">One click — we generate it in your browser, you hold the keys. Or do nothing: earnings stay in your managed balance and you withdraw to any chain from the app.</p>
            </div>
          )}
          {payoutMsg && <p className="mt-2 text-[12.5px] text-muted">{payoutMsg}</p>}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <div className="shadow-soft rounded-[16px] border border-hairline bg-white p-6">
          <div className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">Earned</div>
          <div className="mt-2 text-[32px] font-extrabold tracking-[-.03em] grad-text">${parseFloat(wallet?.seller.earned ?? "0").toFixed(2)}</div>
          <div className="mt-1 text-[13px] text-success">USDC · settled by Gateway</div>
          <div className="mt-4 pt-4 border-t border-hairline">
            <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-muted">Your rating</div>
            <div className="mt-2 text-[20px] font-extrabold">
              ⭐ {avgRating !== null ? avgRating.toFixed(1) : "—"} / 5
            </div>
            <div className="mt-1 text-[12px] text-muted">
              {ratingCount > 0 ? `from ${ratingCount} agent${ratingCount !== 1 ? "s" : ""}` : "no ratings yet"}
            </div>
          </div>
        </div>
        <Stat label="Calls served" value={String(wallet?.seller.calls ?? 0)} sub="all time" />
        <Stat label="Active services" value={String(services.filter((s) => s.active).length)} sub="listed in directory" />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <FeesPanel earned={wallet?.seller.earned ?? "0"} calls={wallet?.seller.calls ?? 0} />
        <div className="shadow-soft rounded-[16px] border border-hairline bg-white p-6">
          <div className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">Your net earnings</div>
          <div className="mt-2 text-[32px] font-extrabold tracking-[-.03em] grad-text">${parseFloat(wallet?.seller.earned ?? "0").toFixed(2)}</div>
          <div className="mt-1 text-[13px] text-success">USDC · you keep 100% (0% commission)</div>
        </div>
      </div>

      <div className="mt-6 shadow-soft rounded-[18px] border border-hairline bg-white p-7">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[18px] font-bold tracking-[-.02em]">Your services</h3>
            <p className="mt-1 text-[13.5px] text-muted">Each service is a pay-per-call API your agents can find in the marketplace.</p>
          </div>
          {hasWallet ? (
            <Link href="/service/new" className="grad rounded-[10px] px-4 py-2 text-[13px] font-semibold text-white">
              + New service
            </Link>
          ) : (
            <span title="Set up a wallet first" className="cursor-not-allowed rounded-[10px] px-4 py-2 text-[13px] font-semibold text-muted bg-base2 border border-hairline opacity-60 select-none">
              + New service
            </span>
          )}
        </div>
        {services.length === 0 ? (
          <div className="mt-6 rounded-[14px] border border-dashed border-hairline p-10 text-center">
            <div className="text-[14px] text-muted">No services yet.</div>
            <Link href="/service/new" className="grad mt-3 inline-flex rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white">
              Register your first service →
            </Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {services.map((svc) => (
              <div key={svc.id} className="rounded-[14px] border border-hairline bg-base2 p-5">
                <div className="flex items-start gap-3">
                  <div className="grad flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-[13px] font-extrabold text-white">
                    {initials(svc.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[15px] font-bold text-ink truncate">{svc.name}</span>
                      {svc.active
                        ? <span className="shrink-0 rounded-full bg-[rgba(21,194,107,.12)] px-2 py-0.5 text-[11px] font-bold text-success">Live</span>
                        : <span className="shrink-0 rounded-full bg-base2 px-2 py-0.5 text-[11px] font-bold text-muted">Inactive</span>}
                    </div>
                    <div className="text-[12.5px] text-muted">{svc.category} · ${svc.priceUsdc}/call</div>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Link href={`/service/${svc.id}`} className="text-[13px] font-semibold text-primary hover:underline">View listing →</Link>
                  <a href={svc.hostedUrl} target="_blank" rel="noreferrer" className="truncate text-[12.5px] text-muted hover:text-ink">{svc.hostedUrl}</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <TxTable title="Earnings" rows={wallet?.seller.recent ?? []} kind="earn" />

      {/* ── Self-custody wallet reveal — shown ONCE, key never leaves the browser ── */}
      {genWallet && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-[500px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.25)]">
            <h2 className="text-[18px] font-bold tracking-[-.02em]">Save your earnings wallet 🔑</h2>
            <div className="mt-2 rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-800">
              ⚠️ This is the <b>only time</b> you&apos;ll see this. Obol <b>never stores your key</b> — save it now. Lose it and your earnings are gone forever, unrecoverable.
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Address (this receives your earnings)</div>
                <div className="mt-1 flex items-center gap-2 rounded-[10px] border border-hairline bg-base2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink">{genWallet.address}</span>
                  <CopyBtn text={genWallet.address} />
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.05em] text-red-600">Recovery phrase — SAVE THIS</div>
                <div className="mt-1 flex items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5">
                  <span className="min-w-0 flex-1 break-words font-mono text-[12.5px] text-ink">{genWallet.mnemonic}</span>
                  <CopyBtn text={genWallet.mnemonic} />
                </div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Private key</div>
                <div className="mt-1 flex items-center gap-2 rounded-[10px] border border-hairline bg-base2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-muted">{genWallet.privateKey}</span>
                  <CopyBtn text={genWallet.privateKey} />
                </div>
              </div>
            </div>
            <label className="mt-4 flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" checked={savedConfirm} onChange={(e) => setSavedConfirm(e.target.checked)} className="mt-0.5" />
              <span>I&apos;ve saved my recovery phrase somewhere safe. I understand Obol can&apos;t recover it, and losing it means losing my earnings.</span>
            </label>
            <div className="mt-4 flex gap-3">
              <button onClick={() => { setGenWallet(null); setSavedConfirm(false); }}
                className="flex-1 rounded-[10px] border border-hairline py-2.5 text-[14px] font-semibold text-muted hover:bg-base2">Cancel</button>
              <button onClick={confirmSelfCustodyWallet} disabled={!savedConfirm || confirming}
                className="flex-1 grad rounded-[10px] py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
                {confirming ? "Setting up…" : "Use this wallet →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cash out self-custody earnings — signs in the browser, key never leaves ── */}
      {cashOut && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-[460px] rounded-[20px] border border-hairline bg-white p-7 shadow-[0_20px_60px_rgba(0,0,0,.25)]">
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-[18px] font-bold tracking-[-.02em]">Cash out earnings</h2>
              <button onClick={() => setCashOut(false)} className="rounded-full p-1.5 text-muted hover:bg-base2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            {coDone ? (
              <div className="py-4 text-center">
                <div className="text-[40px]">✅</div>
                <p className="mt-3 text-[15px] font-bold">Sent to {ALL_CHAIN_LABELS[coNetwork] ?? coNetwork}!</p>
                {coDone.startsWith("http") && <a href={coDone} target="_blank" rel="noreferrer" className="mt-1 block text-[13px] text-primary hover:underline">View transaction ↗</a>}
                <button onClick={() => setCashOut(false)} className="grad mt-5 w-full rounded-[10px] py-2.5 text-[14px] font-semibold text-white">Done</button>
              </div>
            ) : (
              <div className="grid gap-3.5">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Network</label>
                  <select value={coNetwork} onChange={(e) => setCoNetwork(e.target.value)}
                    className="mt-1.5 w-full rounded-[10px] border border-hairline bg-white px-4 py-2.5 text-[14px] outline-none focus:border-primary">
                    {["base", "ethereum", "avalanche", "optimism", "arbitrum", "polygon", "unichain", "monad"].map((k) => (
                      <option key={k} value={k}>{ALL_CHAIN_LABELS[k] ?? k}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Recipient address</label>
                  <input value={coRecipient} onChange={(e) => { setCoRecipient(e.target.value); setCoMsg(null); }} placeholder="0x…"
                    className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-2.5 font-mono text-[13px] outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Amount (USDC)</label>
                  <input type="number" step="0.01" value={coAmount} onChange={(e) => { setCoAmount(e.target.value); setCoMsg(null); }} placeholder="0.00"
                    className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-2.5 text-[14px] outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-[.05em] text-muted">Your private key <span className="font-normal normal-case">(signs locally — never sent to Obol)</span></label>
                  <input type="password" value={coKey} onChange={(e) => { setCoKey(e.target.value); setCoMsg(null); }} placeholder="0x… paste to sign"
                    className="mt-1.5 w-full rounded-[10px] border border-hairline px-4 py-2.5 font-mono text-[12px] outline-none focus:border-primary" />
                  <p className="mt-1.5 text-[11.5px] text-muted">🔒 Used only in your browser to sign the transfer. It is never transmitted to Obol.</p>
                </div>
                {coMsg && <p className="text-[13px] text-red-600">{coMsg}</p>}
                <button onClick={doCashOut} disabled={coBusy}
                  className="grad mt-1 w-full rounded-[10px] py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
                  {coBusy ? (coStep || "Working…") : "Cash out →"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
