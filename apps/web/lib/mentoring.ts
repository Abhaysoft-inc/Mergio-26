import { z } from "zod";

// Mentor management (F-05) and flags (F-12): plain data shared by forms (client) and the server.

/** GitHub's username rules: letters, digits and single hyphens, at most 39 characters. */
const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

export const mentorLoginSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, "").replace(/^https:\/\/github\.com\//i, "").replace(/\/$/, ""))
  .pipe(z.string().regex(GITHUB_LOGIN, "Enter a GitHub username, like octocat"));

/** Where a mentor attachment stands, from the project admin's point of view. */
export type MentorState = "ACTIVE" | "AWAITING_APPROVAL" | "NOT_REGISTERED" | "REJECTED" | "INVITED";

export const MENTOR_STATE_INFO: Record<
  MentorState,
  { label: string; tone: "green" | "gold" | "muted" | "red"; help: string }
> = {
  ACTIVE: { label: "Active", tone: "green", help: "Can review and label, and earns mentor points." },
  AWAITING_APPROVAL: {
    label: "Waiting for approval",
    tone: "gold",
    help: "Registered as a mentor; an organizer still has to approve them.",
  },
  NOT_REGISTERED: {
    label: "Not a mentor yet",
    tone: "gold",
    help: "Has a Mergio account but hasn't registered as a mentor. Send them the invite link.",
  },
  REJECTED: {
    label: "Not approved",
    tone: "red",
    help: "Organizers didn't approve their mentor registration.",
  },
  INVITED: {
    label: "Invited",
    tone: "muted",
    help: "Hasn't signed in to Mergio yet. Send them the invite link.",
  },
};

/** Roles below triage can't apply labels on GitHub. */
export const LABELLING_ROLES = new Set(["triage", "write", "maintain", "admin"]);

export const FLAG_CATEGORIES = {
  SPAM: "Spam",
  PLAGIARISM: "Plagiarism or copied work",
  LOW_QUALITY_AI: "Low-quality AI-generated work",
  MULTIPLE_ACCOUNTS: "Multiple accounts",
  OTHER: "Something else",
} as const;
export type FlagCategoryName = keyof typeof FLAG_CATEGORIES;

export const flagSchema = z.object({
  pullRequestId: z.string().min(1, "Pick a pull request"),
  category: z.enum(
    Object.keys(FLAG_CATEGORIES) as [FlagCategoryName, ...FlagCategoryName[]],
    "Pick a reason",
  ),
  note: z
    .string()
    .trim()
    .min(10, "Tell the organizers what you saw, in at least 10 characters")
    .max(1000, "Keep this under 1000 characters"),
});

export type FlagFormState = {
  errors?: Partial<Record<"category" | "note" | "form", string>>;
};

export type MentorFormState = { error?: string; done?: string; inviteUrl?: string };
