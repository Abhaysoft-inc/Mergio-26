"use client";

import { useActionState, useState } from "react";
import { updateContactAction, type ContactState } from "./actions";

export function ContactForm({ phone, discord }: { phone: string | null; discord: string | null }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<ContactState, FormData>(
    async (prev, formData) => {
      const next = await updateContactAction(prev, formData);
      if (next.saved) setEditing(false);
      return next;
    },
    {},
  );
  const errors = state.errors ?? {};

  if (!editing) {
    return (
      <div className="mt-4 flex items-center justify-between gap-4">
        {state.saved ? (
          <p className="m-0 text-sm text-(color:--green)" role="status">
            Saved.
          </p>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
          Edit phone &amp; Discord
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="auth-form mt-6" noValidate>
      {errors.form && (
        <p className="form-alert" role="alert">
          {errors.form}
        </p>
      )}
      <div className="field">
        <label htmlFor="phone">
          Phone <span className="opt">optional</span>
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={phone ?? ""}
          placeholder="+91 98765 43210"
          autoComplete="tel"
          aria-invalid={Boolean(errors.phone)}
        />
        {errors.phone && <p className="field-error">{errors.phone}</p>}
      </div>
      <div className="field">
        <label htmlFor="discord">
          Discord username <span className="opt">optional</span>
        </label>
        <input
          id="discord"
          name="discord"
          defaultValue={discord ?? ""}
          maxLength={40}
          placeholder="username"
          aria-invalid={Boolean(errors.discord)}
        />
        {errors.discord && <p className="field-error">{errors.discord}</p>}
      </div>
      <div className="flex gap-3">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
