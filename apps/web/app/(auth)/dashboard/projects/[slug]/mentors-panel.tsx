"use client";

import { useActionState, useState, useTransition } from "react";
import { MENTOR_STATE_INFO, type MentorFormState, type MentorState } from "@/lib/mentoring";

const toneClass = {
  green: "text-(color:--green)",
  gold: "text-(color:--gold)",
  muted: "text-(color:--muted)",
  red: "text-[#E5484D]",
} as const;

type Mentor = {
  id: string;
  githubLogin: string;
  name: string | null;
  state: MentorState;
  cannotLabel: string[] | null;
};

export function MentorsPanel({
  mentors,
  inviteUrl,
  addAction,
  removeAction,
}: {
  mentors: Mentor[];
  inviteUrl: string;
  addAction: (state: MentorFormState, formData: FormData) => Promise<MentorFormState>;
  removeAction: (mentorId: string) => Promise<{ error?: string; done?: string }>;
}) {
  const [state, formAction, pending] = useActionState(addAction, {});
  const [removing, startRemoving] = useTransition();
  const [removeMessage, setRemoveMessage] = useState<string | null>(null);

  function remove(mentor: Mentor) {
    if (!window.confirm(`Remove @${mentor.githubLogin} as a mentor? They lose access to this project at once.`)) return;
    startRemoving(async () => {
      const result = await removeAction(mentor.id);
      setRemoveMessage(result.error ?? result.done ?? null);
    });
  }

  return (
    <div>
      {mentors.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {mentors.map((mentor) => {
            const info = MENTOR_STATE_INFO[mentor.state];
            return (
              <li
                key={mentor.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-(color:--border) py-3.5 first:pt-0 last:border-b-0"
              >
                <div className="min-w-0">
                  <a
                    href={`https://github.com/${mentor.githubLogin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:text-(color:--ice)"
                  >
                    @{mentor.githubLogin}
                  </a>
                  {mentor.name && <span className="ml-2 text-sm text-(color:--muted)">{mentor.name}</span>}
                  <p className={`mt-0.5 mb-0 text-sm ${toneClass[info.tone]}`}>
                    {info.label} <span className="text-(color:--dim)">· {info.help}</span>
                  </p>
                  {mentor.cannotLabel && mentor.cannotLabel.length > 0 && (
                    <p className="mt-1 mb-0 text-sm text-(color:--gold)">
                      Needs triage permission on GitHub to label: {mentor.cannotLabel.join(", ")}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={removing}
                  onClick={() => remove(mentor)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="m-0 text-(color:--muted)">No mentors yet. Add the people who will review and label PRs.</p>
      )}
      {removeMessage && (
        <p className="mt-3 mb-0 text-sm text-(color:--muted)" role="status">
          {removeMessage}
        </p>
      )}

      <form action={formAction} className="mt-6 flex flex-wrap items-end gap-3" noValidate>
        <div className="field min-w-56">
          <label htmlFor="githubLogin">Add a mentor</label>
          <input
            id="githubLogin"
            name="githubLogin"
            placeholder="GitHub username"
            autoComplete="off"
            required
            aria-invalid={Boolean(state.error)}
            aria-describedby={state.error ? "mentor-err" : undefined}
          />
        </div>
        <button className="btn btn-primary btn-sm mb-0.5" type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add mentor"}
        </button>
      </form>
      {state.error && (
        <p className="field-error" id="mentor-err" role="alert">
          {state.error}
        </p>
      )}
      {state.done && (
        <p className="mt-3 mb-0 text-sm text-(color:--green)" role="status">
          {state.done}
        </p>
      )}
      <p className="field-hint">
        People without a Mergio account are invited: send them{" "}
        <code className="font-mono text-xs break-all">{state.inviteUrl ?? inviteUrl}</code>. They
        become active once they register as a mentor and an organizer approves them.
      </p>
    </div>
  );
}
