"use client";

import {
  collection, doc, setDoc, addDoc, getDoc, getDocs,
  query, where, orderBy, limit, updateDoc, increment,
  onSnapshot, type Unsubscribe,
} from "firebase/firestore";
import { fdb } from "./firebase";

export type Thread = {
  id: string;
  sellerUid: string;
  buyerUid: string;
  serviceId: string;
  serviceName: string;
  sellerName: string;
  buyerName: string;
  lastMessage: string;
  lastAt: number;
  unreadSeller: number;
  unreadBuyer: number;
};

export type Msg = {
  id: string;
  from: string;
  fromName: string;
  body: string;
  ts: number;
};

export function makeThreadId(serviceId: string, buyerUid: string): string {
  return `${serviceId}_${buyerUid}`;
}

async function fetchThreads(field: string, uid: string): Promise<Thread[]> {
  try {
    const snap = await getDocs(
      query(collection(fdb, "threads"), where(field, "==", uid), orderBy("lastAt", "desc"), limit(50))
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Thread, "id">) }));
  } catch { return []; }
}

export async function initiateThread(
  buyerUid: string, buyerName: string,
  sellerUid: string, sellerName: string,
  serviceId: string, serviceName: string,
  body: string,
): Promise<string> {
  const tid = makeThreadId(serviceId, buyerUid);
  const threadRef = doc(fdb, "threads", tid);
  const snap = await getDoc(threadRef);
  if (!snap.exists()) {
    await setDoc(threadRef, {
      sellerUid, buyerUid, serviceId, serviceName, sellerName, buyerName,
      lastMessage: body.slice(0, 120), lastAt: Date.now(),
      unreadSeller: 1, unreadBuyer: 0,
    });
  } else {
    await updateDoc(threadRef, {
      lastMessage: body.slice(0, 120), lastAt: Date.now(),
      unreadSeller: increment(1),
    });
  }
  await addDoc(collection(fdb, "threads", tid, "messages"), {
    from: buyerUid, fromName: buyerName, body: body.trim(), ts: Date.now(),
  });
  return tid;
}

export async function replyThread(
  threadId: string, fromUid: string, fromName: string, body: string, isSeller: boolean,
): Promise<void> {
  await updateDoc(doc(fdb, "threads", threadId), {
    lastMessage: body.slice(0, 120), lastAt: Date.now(),
    ...(isSeller ? { unreadBuyer: increment(1) } : { unreadSeller: increment(1) }),
  });
  await addDoc(collection(fdb, "threads", threadId, "messages"), {
    from: fromUid, fromName, body: body.trim(), ts: Date.now(),
  });
}

export async function getMyThreads(uid: string): Promise<Thread[]> {
  const [asSeller, asBuyer] = await Promise.all([
    fetchThreads("sellerUid", uid),
    fetchThreads("buyerUid", uid),
  ]);
  const map = new Map<string, Thread>();
  for (const t of [...asSeller, ...asBuyer]) {
    if (!map.has(t.id)) map.set(t.id, t);
  }
  return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
}

export function subscribeMessages(threadId: string, cb: (msgs: Msg[]) => void): Unsubscribe {
  return onSnapshot(
    query(collection(fdb, "threads", threadId, "messages"), orderBy("ts", "asc"), limit(200)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Msg, "id">) }))),
    () => cb([]),
  );
}

export async function markRead(threadId: string, isSeller: boolean): Promise<void> {
  try {
    await updateDoc(doc(fdb, "threads", threadId), {
      [isSeller ? "unreadSeller" : "unreadBuyer"]: 0,
    });
  } catch { /* best-effort */ }
}

export async function getTotalUnread(uid: string): Promise<number> {
  try {
    const [s, b] = await Promise.all([
      fetchThreads("sellerUid", uid),
      fetchThreads("buyerUid", uid),
    ]);
    const allThreads = [...s, ...b];
    return allThreads.reduce((n, t) => {
      if (t.sellerUid === uid) return n + (t.unreadSeller || 0);
      return n + (t.unreadBuyer || 0);
    }, 0);
  } catch { return 0; }
}
