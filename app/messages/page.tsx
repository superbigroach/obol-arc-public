"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/SiteNav";
import { useAuth } from "@/components/AuthProvider";
import {
  getMyThreads,
  subscribeMessages,
  replyThread,
  markRead,
  type Thread,
  type Msg,
} from "@/lib/messages";
import { getProfile } from "@/lib/clientStore";

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function nameInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
}

type ProfileCache = { name: string; handle?: string | null; avatarUrl?: string | null };

export default function MessagesPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [showList, setShowList] = useState(true);
  const [profileCache, setProfileCache] = useState<Map<string, ProfileCache>>(new Map());
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    getMyThreads(user.uid).then(async (ts) => {
      setThreads(ts);
      // fetch live profiles for all participants so names/avatars are current
      const uids = new Set<string>();
      ts.forEach(t => { uids.add(t.sellerUid); uids.add(t.buyerUid); });
      const entries = await Promise.all(
        [...uids].map(async uid => {
          const p = await getProfile(uid).catch(() => null);
          const name = p?.companyName || (p?.username ? `@${p.username}` : null) || p?.displayName || uid.slice(0, 8);
          const handle = p?.username ? `@${p.username}` : null;
          return [uid, { name, handle, avatarUrl: p?.logoUrl || p?.avatarUrl }] as [string, ProfileCache];
        })
      );
      setProfileCache(new Map(entries));
    }).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!activeId) { setMsgs([]); return; }
    const unsub = subscribeMessages(activeId, setMsgs);
    return () => unsub();
  }, [activeId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  function openThread(thread: Thread) {
    setActiveId(thread.id);
    setShowList(false);
    if (user) {
      const isSeller = thread.sellerUid === user.uid;
      markRead(thread.id, isSeller);
      setThreads((prev) =>
        prev.map((t) =>
          t.id === thread.id
            ? { ...t, ...(isSeller ? { unreadSeller: 0 } : { unreadBuyer: 0 }) }
            : t,
        ),
      );
    }
  }

  async function sendReply() {
    if (!user || !activeId || !reply.trim() || sending) return;
    const thread = threads.find((t) => t.id === activeId);
    if (!thread) return;
    setSending(true);
    try {
      const isSeller = thread.sellerUid === user.uid;
      const profile = await getProfile(user.uid).catch(() => null);
      const fromName = profile?.username ? `@${profile.username}`
        : profile?.companyName || profile?.displayName
        || user.email?.split("@")[0] || "Someone";
      await replyThread(activeId, user.uid, fromName, reply.trim(), isSeller);
      setReply("");
    } catch { /* best-effort */ }
    finally { setSending(false); }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>
    );
  }

  const activeThread = activeId ? threads.find((t) => t.id === activeId) ?? null : null;

  return (
    <div className="min-h-screen bg-base2">
      <SiteNav />
      <div className="mx-auto max-w-[1180px] px-4 py-6">
        <h1 className="mb-4 text-[22px] font-bold tracking-[-.02em]">Messages</h1>
        <div
          className="flex overflow-hidden rounded-[18px] border border-hairline bg-white shadow-soft"
          style={{ height: "calc(100vh - 200px)", minHeight: 520 }}
        >
          {/* Thread list panel */}
          <div
            className={`${showList ? "flex" : "hidden"} lg:flex w-full flex-col border-r border-hairline lg:w-[300px]`}
          >
            <div className="border-b border-hairline px-4 py-3">
              <div className="text-[13px] font-semibold uppercase tracking-[.05em] text-muted">
                Conversations
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {threads.length === 0 ? (
                <div className="px-5 py-10 text-center text-[14px] text-muted">
                  No messages yet.
                </div>
              ) : (
                threads.map((thread) => {
                  const isSeller = thread.sellerUid === user.uid;
                  const unread = isSeller ? thread.unreadSeller : thread.unreadBuyer;
                  const otherUid = isSeller ? thread.buyerUid : thread.sellerUid;
                  const otherProfile = profileCache.get(otherUid);
                  const otherName = otherProfile?.name || (isSeller ? thread.buyerName : thread.sellerName);
                  const otherAvatar = otherProfile?.avatarUrl;
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => openThread(thread)}
                      className={`w-full border-b border-hairline px-4 py-3 text-left transition hover:bg-base2 ${activeId === thread.id ? "bg-base2" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        {otherAvatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={otherAvatar} alt={otherName} className="h-9 w-9 shrink-0 rounded-full border border-hairline object-cover" />
                        ) : (
                          <div className="grad flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white">
                            {nameInitials(otherName)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-[14px] font-semibold text-ink">
                              {otherName}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted">
                              {timeAgo(thread.lastAt)}
                            </span>
                          </div>
                          {otherProfile?.handle && (
                            <div className="truncate text-[12px] text-muted">{otherProfile.handle}</div>
                          )}
                          <div className="mt-0.5 truncate text-[12.5px] text-[#3a3a48]">
                            {thread.lastMessage}
                          </div>
                        </div>
                        {(unread ?? 0) > 0 && (
                          <span className="grad flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white">
                            {(unread ?? 0) > 9 ? "9+" : unread}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Thread view panel */}
          <div
            className={`${!showList ? "flex" : "hidden"} lg:flex flex-1 flex-col`}
          >
            {!activeThread ? (
              <div className="flex flex-1 items-center justify-center text-center">
                <div>
                  <div className="text-[16px] font-semibold text-ink">Select a conversation</div>
                  <div className="mt-1 text-[13px] text-muted">
                    Choose a thread to start reading
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-3 border-b border-hairline px-5 py-3">
                  <button
                    type="button"
                    onClick={() => { setShowList(true); setActiveId(null); }}
                    className="lg:hidden rounded-[8px] border border-hairline p-1.5 text-muted hover:bg-base2"
                    aria-label="Back to conversations"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                  </button>
                  {(() => {
                    const otherUid2 = activeThread.sellerUid === user.uid ? activeThread.buyerUid : activeThread.sellerUid;
                    const p2 = profileCache.get(otherUid2);
                    const n2 = p2?.name || (activeThread.sellerUid === user.uid ? activeThread.buyerName : activeThread.sellerName);
                    return p2?.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p2.avatarUrl} alt={n2} className="h-8 w-8 shrink-0 rounded-full border border-hairline object-cover" />
                    ) : (
                      <div className="grad flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white">
                        {nameInitials(n2)}
                      </div>
                    );
                  })()}
                  <div>
                    <div className="text-[14px] font-semibold">
                      {(() => {
                        const otherUid3 = activeThread.sellerUid === user.uid ? activeThread.buyerUid : activeThread.sellerUid;
                        return profileCache.get(otherUid3)?.name || (activeThread.sellerUid === user.uid ? activeThread.buyerName : activeThread.sellerName);
                      })()}
                    </div>
                    {(() => {
                      const otherUid4 = activeThread.sellerUid === user.uid ? activeThread.buyerUid : activeThread.sellerUid;
                      const p4 = profileCache.get(otherUid4);
                      return p4?.handle ? (
                        <div className="text-[12px] text-muted">{p4.handle} · {activeThread.serviceName}</div>
                      ) : (
                        <div className="text-[12px] text-muted">{activeThread.serviceName}</div>
                      );
                    })()}
                  </div>
                </div>

                {/* Message bubbles */}
                <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
                  {msgs.length === 0 && (
                    <div className="py-6 text-center text-[13px] text-muted">Loading messages…</div>
                  )}
                  {msgs.map((msg) => {
                    const mine = msg.from === user.uid;
                    return (
                      <div key={msg.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[75%] rounded-[14px] px-4 py-2.5 ${mine ? "grad text-white" : "bg-base2 text-ink"}`}
                        >
                          {!mine && (
                            <div className="mb-1 text-[11px] font-semibold opacity-70">
                              {msg.fromName}
                            </div>
                          )}
                          <div className="whitespace-pre-wrap text-[14px] leading-[1.5]">{msg.body}</div>
                          <div
                            className={`mt-1 text-[10px] ${mine ? "text-right text-white/70" : "text-muted"}`}
                          >
                            {timeAgo(msg.ts)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={endRef} />
                </div>

                {/* Reply box */}
                <div className="border-t border-hairline p-4">
                  <div className="flex gap-3">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendReply();
                        }
                      }}
                      placeholder="Write a reply… (Enter to send, Shift+Enter for newline)"
                      rows={2}
                      className="flex-1 resize-none rounded-[12px] border border-hairline bg-white px-4 py-3 text-[14px] outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={sendReply}
                      disabled={sending || !reply.trim()}
                      className="grad self-end rounded-[10px] px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-60"
                    >
                      {sending ? "…" : "Send"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
