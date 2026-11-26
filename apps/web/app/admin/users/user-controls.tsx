"use client";

import { useState, useTransition } from "react";
import {
  banUserAction,
  revokeSessionsAction,
  setStaffRoleAction,
  unbanUserAction,
  type UserActionResult,
} from "./actions";

export function UserControls({
  userId,
  isSelf,
  isBanned,
  isTargetSuperAdmin,
  isTargetOrganizer,
  currentStaffRole,
  canEditStaffRole,
  sessionCount,
}: {
  userId: string;
  isSelf: boolean;
  isBanned: boolean;
  isTargetSuperAdmin: boolean;
  isTargetOrganizer: boolean;
  currentStaffRole: "ORGANIZER" | "SUPER_ADMIN" | null;
  canEditStaffRole: boolean;
  sessionCount: number;
}) {
  const [pending, start] = useTransition();
  const [banOpen, setBanOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [roleValue, setRoleValue] = useState<string>(currentStaffRole ?? "");
  const [message, setMessage] = useState<string | null>(null);

  const canModerate = !isSelf && !isTargetSuperAdmin && (!isTargetOrganizer || canEditStaffRole);

  const run = (action: () => Promise<UserActionResult>, onSuccess?: () => void) =>
    start(async () => {
      const result = await action();
      setMessage(result.error ?? result.done ?? null);
      if (!result.error) onSuccess?.();
    });

  if (isSelf) {
    return <span className="text-xs text-(color:--dim)">Your account</span>;
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canEditStaffRole && (
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Staff role"
              value={roleValue}
              disabled={pending}
              onChange={(e) => setRoleValue(e.target.value)}
              className="rounded-lg border border-(color:--border-strong) bg-(color:--surface-2) px-2.5 py-1 text-xs text-(color:--text)"
            >
              <option value="">No staff role</option>
              <option value="ORGANIZER">Organizer</option>
              <option value="SUPER_ADMIN">Super Admin</option>
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={pending || roleValue === (currentStaffRole ?? "")}
              onClick={() => run(() => setStaffRoleAction(userId, roleValue))}
            >
              Save role
            </button>
          </div>
        )}

        {canModerate && sessionCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={pending}
            onClick={() => run(() => revokeSessionsAction(userId))}
          >
            Sign out ({sessionCount})
          </button>
        )}

        {canModerate &&
          (isBanned ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={pending}
              onClick={() => run(() => unbanUserAction(userId))}
            >
              Unban
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-[#E5484D]"
              disabled={pending}
              onClick={() => {
                setBanOpen((prev) => !prev);
                setMessage(null);
              }}
            >
              {banOpen ? "Cancel" : "Ban"}
            </button>
          ))}
      </div>

      {banOpen && !isBanned && (
        <form
          className="flex flex-wrap items-center justify-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => banUserAction(userId, reason), () => {
              setBanOpen(false);
              setReason("");
            });
          }}
        >
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ban reason (required)"
            maxLength={500}
            required
            disabled={pending}
            className="w-60 rounded-lg border border-(color:--border-strong) bg-(color:--surface-2) px-2.5 py-1 text-xs text-(color:--text)"
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !reason.trim()}>
            Confirm ban
          </button>
        </form>
      )}

      {message && (
        <span className="text-xs text-(color:--muted)" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
