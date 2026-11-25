"use client";

import { useState, useTransition } from "react";

export function ReviewButtons({
  approve,
  reject,
  current,
}: {
  approve: () => Promise<{ error?: string; done?: string }>;
  reject: () => Promise<{ error?: string; done?: string }>;
  current: "PENDING" | "APPROVED" | "REJECTED";
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run = (action: () => Promise<{ error?: string; done?: string }>) =>
    start(async () => {
      const result = await action();
      setMessage(result.error ?? result.done ?? null);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {current !== "APPROVED" && (
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(approve)}>
          Approve
        </button>
      )}
      {current !== "REJECTED" && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(reject)}>
          Reject
        </button>
      )}
      {message && (
        <span className="text-sm text-(color:--muted)" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
