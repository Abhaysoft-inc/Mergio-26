"use client";

import { useActionState } from "react";
import { CollegePicker } from "@/components/colleges/college-picker";
import type { AdminState, VerifyState } from "./actions";

function Message({ state }: { state: AdminState }) {
  if (state.error) return <p className="m-0 text-sm text-[#E5484D]" role="alert">{state.error}</p>;
  if (state.done) return <p className="m-0 text-sm text-(color:--green)" role="status">{state.done}</p>;
  return null;
}

/** A leaderboard action with a confirmation first. */
export function ActionButton({
  action,
  label,
  confirm,
  primary,
}: {
  action: (state: AdminState) => Promise<AdminState>;
  label: string;
  confirm: string;
  primary?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      }}
      className="flex flex-col items-start gap-2"
    >
      <button className={`btn btn-sm ${primary ? "btn-primary" : "btn-ghost"}`} type="submit" disabled={pending}>
        {pending ? "Working…" : label}
      </button>
      <Message state={state} />
    </form>
  );
}

export function VerifyButton({ action }: { action: (state: VerifyState) => Promise<VerifyState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <button className="btn btn-ghost btn-sm self-start" type="submit" disabled={pending}>
        {pending ? "Comparing…" : "Compare Redis with SQL"}
      </button>
      {state.error && <p className="m-0 text-sm text-[#E5484D]">{state.error}</p>}
      {state.results && (
        <ul className="m-0 list-none space-y-2 p-0 text-sm">
          {state.results.map((result) => (
            <li key={result.board}>
              <span className={result.ok ? "text-(color:--green)" : "text-[#E5484D]"}>
                {result.ok ? "Match" : "Differs"}
              </span>{" "}
              <span className="font-mono">{result.board}</span>{" "}
              <span className="text-(color:--dim)">
                ({result.redisCount} in Redis, {result.sqlCount} in SQL)
              </span>
              {result.differences.length > 0 && (
                <ul className="mt-1 mb-0 pl-5 font-mono text-xs text-(color:--muted)">
                  {result.differences.map((difference) => (
                    <li key={difference}>{difference}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

export function MapCollegeForm({
  action,
  inputId,
  label,
}: {
  action: (state: AdminState, formData: FormData) => Promise<AdminState>;
  inputId: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2">
      <div className="field mb-0 min-w-64 flex-1">
        <CollegePicker defaultValue="" defaultId={null} invalid={false} inputId={inputId} label={`College for “${label}”`} />
      </div>
      <button className="btn btn-ghost btn-sm" type="submit" disabled={pending}>
        Map
      </button>
      <Message state={state} />
    </form>
  );
}

export function AddCollegeForm({ action }: { action: (state: AdminState, formData: FormData) => Promise<AdminState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <label className="field mb-0 min-w-64 flex-1">
        <span className="mb-1.5 text-sm text-(color:--muted)">Name</span>
        <input name="name" required minLength={3} />
      </label>
      <label className="field mb-0 max-w-48">
        <span className="mb-1.5 text-sm text-(color:--muted)">City</span>
        <input name="city" />
      </label>
      <label className="field mb-0 max-w-48">
        <span className="mb-1.5 text-sm text-(color:--muted)">State</span>
        <input name="state" required minLength={2} />
      </label>
      <button className="btn btn-ghost btn-sm mb-0.5" type="submit" disabled={pending}>
        Add college
      </button>
      <Message state={state} />
    </form>
  );
}
