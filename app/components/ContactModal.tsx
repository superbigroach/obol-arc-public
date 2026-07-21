"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function ContactButton({ compact, onOpen }: { compact?: boolean; onOpen?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  function handleOpen() { onOpen?.(); setOpen(true); }
  return (
    <>
      {compact ? (
        <button
          onClick={handleOpen}
          className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-[13.5px] text-ink hover:bg-base2"
        >
          <span className="text-[15px] leading-none">📬</span>
          Contact support
        </button>
      ) : (
        <button
          onClick={handleOpen}
          className="mt-auto inline-flex items-center justify-center gap-2 rounded-[10px] bg-ink px-[18px] py-2.5 text-[15px] font-semibold text-white transition hover:-translate-y-px"
        >
          Talk to us
        </button>
      )}
      {open && <ContactModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function ContactModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [mounted, setMounted] = useState(false);

  // Portal target only exists on the client; lock body scroll while open.
  useEffect(() => {
    setMounted(true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    const data = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
        }),
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        setStatus("sent");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative my-auto max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-[20px] bg-white p-8 shadow-[0_24px_80px_rgba(10,10,15,.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-5 top-5 text-[20px] text-muted hover:text-ink"
          aria-label="Close"
        >
          ✕
        </button>

        {status === "sent" ? (
          <div className="py-8 text-center">
            <div className="mb-3 text-[40px]">✓</div>
            <h3 className="mb-2 text-[22px] font-extrabold tracking-[-.02em]">Message sent!</h3>
            <p className="text-[15px] text-muted">We'll get back to you within 1 business day.</p>
            <button
              onClick={onClose}
              className="grad mt-6 inline-flex items-center justify-center rounded-[10px] px-6 py-2.5 text-[15px] font-semibold text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h3 className="mb-1 text-[22px] font-extrabold tracking-[-.02em]">Talk to us</h3>
            <p className="mb-6 text-[14.5px] text-muted">
              Tell us about your use case and we'll set up a call.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[#3a3a48]">Name</label>
                <input
                  name="name"
                  required
                  placeholder="Your name"
                  className="w-full rounded-[10px] border border-hairline bg-[#f7f7fa] px-4 py-2.5 text-[14.5px] outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[#3a3a48]">Work email</label>
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="you@company.com"
                  className="w-full rounded-[10px] border border-hairline bg-[#f7f7fa] px-4 py-2.5 text-[14.5px] outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-[#3a3a48]">What are you building?</label>
                <textarea
                  name="message"
                  required
                  rows={4}
                  placeholder="Tell us about your use case, expected volume, or any questions..."
                  className="w-full resize-none rounded-[10px] border border-hairline bg-[#f7f7fa] px-4 py-2.5 text-[14.5px] outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                type="submit"
                disabled={status === "sending"}
                className="grad mt-1 inline-flex items-center justify-center gap-2 rounded-[10px] py-3 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(109,94,246,.35)] transition hover:-translate-y-px disabled:opacity-60"
              >
                {status === "sending" ? "Sending…" : "Send message →"}
              </button>
              {status === "error" && (
                <p className="text-center text-[13px] text-red-500">Something went wrong — try again or email obolmcp@gmail.com</p>
              )}
            </form>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
