// Server-side read helpers over Circle's official GatewayClient. We only READ
// here (transfer history + balances by address) to power the dashboard — all
// payments/settlement are done by buyers/sellers with their own keys via
// @circle-fin/x402-batching. searchTransfers/getBalances take an explicit
// address, so a throwaway (never-funded, never-signing) key satisfies the
// client constructor for read-only queries.
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { generatePrivateKey } from "viem/accounts";
import { getAddress, type Address } from "viem";
import { ARC_CHAIN_NAME, fromAtomic } from "./config";

let _client: GatewayClient | null = null;
function readClient(): GatewayClient {
  if (!_client) _client = new GatewayClient({ chain: ARC_CHAIN_NAME, privateKey: generatePrivateKey() });
  return _client;
}

export type Activity = {
  id: string;
  from: string;
  to: string;
  amount: string;
  status: string;
  network: string;
  createdAt: string;
};

function mapTransfers(transfers: Array<Record<string, unknown>> | undefined | null): Activity[] {
  return (Array.isArray(transfers) ? transfers : []).map((t) => ({
    id: String(t.id ?? ""),
    from: String(t.fromAddress ?? ""),
    to: String(t.toAddress ?? ""),
    amount: fromAtomic(String(t.amount ?? "0")),
    status: String(t.status ?? ""),
    network: String(t.recipientNetwork ?? t.sendingNetwork ?? ""),
    createdAt: String(t.createdAt ?? ""),
  }));
}

/** Payments RECEIVED by a seller address (earnings). */
export async function getEarnings(address: string): Promise<Activity[]> {
  try {
    const { transfers } = await readClient().searchTransfers({ to: getAddress(address), token: "USDC" });
    return mapTransfers(transfers as Array<Record<string, unknown>>);
  } catch {
    return [];
  }
}

/** Payments SENT by a buyer address (spend). */
export async function getSpend(address: string): Promise<Activity[]> {
  try {
    const { transfers } = await readClient().searchTransfers({ from: getAddress(address), token: "USDC" });
    return mapTransfers(transfers as Array<Record<string, unknown>>);
  } catch {
    return [];
  }
}

export type WalletBalances = { wallet: string; available: string; total: string };

/** Wallet USDC + Gateway balance for an address. */
export async function getBalances(address: string): Promise<WalletBalances> {
  try {
    const b = await readClient().getBalances(getAddress(address) as Address);
    return {
      wallet: b.wallet.formatted,
      available: b.gateway.formattedAvailable,
      total: b.gateway.formattedTotal,
    };
  } catch {
    return { wallet: "0", available: "0", total: "0" };
  }
}

const sum = (rows: Activity[]) =>
  rows.reduce((acc, r) => acc + Number(r.amount || 0), 0).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

export const totalOf = (rows: Activity[]) => sum(rows) || "0";
