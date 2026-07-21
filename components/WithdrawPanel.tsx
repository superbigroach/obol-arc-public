"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { getWithdrawPasskeyAuth } from "@/lib/passkey";

const INPUT = "w-full rounded-[10px] border border-hairline px-3.5 py-2.5 text-[14px] outline-none focus:border-primary";

// Withdraw the user's Obol (dev-controlled) wallet balance to any address.
// Balance lives on Arc; the network selector picks the DESTINATION chain the
// USDC is minted onto (Gateway burn-on-Arc → mint-on-dest, same proven recipe).
const NETWORKS = [
  { value: "arc",       label: "Arc Testnet — same chain · instant" },
  { value: "base",      label: "Base Sepolia" },
  { value: "ethereum",  label: "Ethereum Sepolia" },
  { value: "avalanche", label: "Avalanche Fuji" },
  { value: "optimism",  label: "OP Sepolia" },
  { value: "arbitrum",  label: "Arbitrum Sepolia" },
  { value: "polygon",   label: "Polygon Amoy" },
  { value: "unichain",  label: "Unichain Sepolia" },
];

export default function WithdrawPanel({ available, defaultRecipient }: { available?: string; defaultRecipient?: string }) {
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const [network, setNetwork] = useState("arc");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; href?: string } | null>(null);

  async function withdraw() {
    setBusy(true); setMsg(null);
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(recipient.trim())) throw new Error("Enter a valid recipient address (0x…)");
      if (!amount || Number(amount) <= 0) throw new Error("Enter an amount");
      // SECURITY P0: if a passkey is registered, this prompts the device and
      // returns a one-time assertion the backend requires (null if none set up).
      const passkeyAuth = await getWithdrawPasskeyAuth();
      const fn = httpsCallable(functions, "withdrawObolWallet");
      const res = await fn({ recipient: recipient.trim(), amount: amount.trim(), network, ...(passkeyAuth ?? {}) });
      const d = res.data as { txHash: string; explorer: string };
      setMsg({ ok: true, text: `Withdrew ${amount} USDC ✓`, href: d.explorer });
      setAmount("");
    } catch (e) {
      setMsg({ ok: false, text: (e as { message?: string }).message || "Withdraw failed" });
    } finally { setBusy(false); }
  }

  return (
    <div className="shadow-soft rounded-[18px] border border-hairline bg-white p-7">
      <h3 className="text-[18px] font-bold tracking-[-.02em]">Withdraw earnings</h3>
      <p className="mt-1.5 text-[14px] text-muted">
        From your Obol wallet to any address.{available ? ` Available: $${available} USDC.` : ""}
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input className={INPUT} placeholder="Amount (USDC)" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select className={INPUT} value={network} onChange={(e) => setNetwork(e.target.value)} title="Destination network">
          {NETWORKS.map((n) => (
            <option key={n.value} value={n.value}>{n.label}</option>
          ))}
        </select>
        <input className={`${INPUT} sm:col-span-2`} placeholder="Recipient address 0x…" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
      </div>
      <button onClick={withdraw} disabled={busy} className="grad mt-4 rounded-[10px] px-5 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60">
        {busy ? "Withdrawing…" : "Withdraw"}
      </button>
      {msg && (
        <p className={`mt-3 text-[13px] ${msg.ok ? "text-success" : "text-red-600"}`}>
          {msg.text}{" "}
          {msg.href && <a href={msg.href} target="_blank" rel="noreferrer" className="underline">view tx</a>}
        </p>
      )}
    </div>
  );
}
