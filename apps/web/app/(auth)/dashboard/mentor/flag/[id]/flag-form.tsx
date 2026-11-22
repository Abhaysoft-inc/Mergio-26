"use client";

import { useActionState } from "react";
import { FLAG_CATEGORIES, type FlagCategoryName, type FlagFormState } from "@/lib/mentoring";
import { flagAction } from "../../../actions";

export function FlagForm({ pullRequestId }: { pullRequestId: string }) {
  const [state, formAction, pending] = useActionState<FlagFormState, FormData>(
    flagAction.bind(null, pullRequestId),
    {},
  );
  const errors = state.errors ?? {};

  return (
    <form action={formAction} className="auth-form" noValidate>
      {errors.form && (
        <p className="form-alert" role="alert">
          {errors.form}
        </p>
      )}
      <div className="field">
        <label htmlFor="category">Reason</label>
        <select
          id="category"
          name="category"
          defaultValue=""
          required
          aria-invalid={Boolean(errors.category)}
          aria-describedby={errors.category ? "category-err" : undefined}
        >
          <option value="" disabled>
            Pick one
          </option>
          {(Object.keys(FLAG_CATEGORIES) as FlagCategoryName[]).map((key) => (
            <option key={key} value={key}>
              {FLAG_CATEGORIES[key]}
            </option>
          ))}
        </select>
        {errors.category && (
          <p className="field-error" id="category-err">
            {errors.category}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="note">What did you see?</label>
        <textarea
          id="note"
          name="note"
          rows={5}
          maxLength={1000}
          required
          placeholder="Links and specifics help the organizers decide quickly."
          aria-invalid={Boolean(errors.note)}
          aria-describedby={errors.note ? "note-err" : "note-hint"}
        />
        {errors.note ? (
          <p className="field-error" id="note-err">
            {errors.note}
          </p>
        ) : (
          <p className="field-hint" id="note-hint">
            Only organizers see this. Flagging doesn&apos;t change any score by itself.
          </p>
        )}
      </div>
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send flag"}
      </button>
    </form>
  );
}
