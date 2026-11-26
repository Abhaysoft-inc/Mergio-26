"use client";

import { useActionState } from "react";
import {
  DISPUTE_CATEGORIES,
  MAX_EVIDENCE_LINKS,
  type DisputeCategoryName,
  type DisputeFormState,
} from "@/lib/disputes";
import { disputeAction } from "../../../actions";

export function DisputeForm({ pullRequestId }: { pullRequestId: string }) {
  const [state, formAction, pending] = useActionState<DisputeFormState, FormData>(
    disputeAction.bind(null, pullRequestId),
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
        <label htmlFor="category">What is wrong?</label>
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
          {(Object.keys(DISPUTE_CATEGORIES) as DisputeCategoryName[]).map((key) => (
            <option key={key} value={key}>
              {DISPUTE_CATEGORIES[key]}
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
        <label htmlFor="text">Explain</label>
        <textarea
          id="text"
          name="text"
          rows={6}
          maxLength={2000}
          required
          placeholder="What should the outcome be, and why? Organizers and the project's mentors read this."
          aria-invalid={Boolean(errors.text)}
          aria-describedby={errors.text ? "text-err" : undefined}
        />
        {errors.text && (
          <p className="field-error" id="text-err">
            {errors.text}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="evidenceUrls">
          Evidence links <span className="opt">optional</span>
        </label>
        <textarea
          id="evidenceUrls"
          name="evidenceUrls"
          rows={3}
          placeholder="https://github.com/owner/repo/issues/12"
          aria-invalid={Boolean(errors.evidenceUrls)}
          aria-describedby={errors.evidenceUrls ? "evidence-err" : "evidence-hint"}
        />
        {errors.evidenceUrls ? (
          <p className="field-error" id="evidence-err">
            {errors.evidenceUrls}
          </p>
        ) : (
          <p className="field-hint" id="evidence-hint">
            One per line, up to {MAX_EVIDENCE_LINKS}. Issues, comments or commits that support your case.
          </p>
        )}
      </div>

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Raise dispute"}
      </button>
    </form>
  );
}
