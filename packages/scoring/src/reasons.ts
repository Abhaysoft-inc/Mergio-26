import type { ScoringRules } from "./rules";

// Why a merged PR earns no points (PRD §4.2). The dashboard always shows one of these fixed codes
// with its text, never free-form text. Keep the list in sync with the ScoreReason enum in
// packages/db/prisma/schema.prisma.
export const REASON_CODES = [
  "NOT_REGISTERED",
  "NO_PROGRAM_LABEL",
  "NO_LEVEL_LABEL",
  "MULTIPLE_LEVEL_LABELS",
  "OUTSIDE_WINDOW",
  "REPO_NOT_TRACKED",
  "WRONG_BASE_BRANCH",
  "SELF_MERGED",
  "AUTHOR_IS_MENTOR",
  "CAP_REACHED",
  "INVALID_LABEL",
  "SPAM_LABEL",
  "REVERTED",
  "AUTHOR_SANCTIONED",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Reasons that take points away from a PR that already counted, as opposed to never counting. */
export const INVALIDATING_REASONS = ["INVALID_LABEL", "SPAM_LABEL", "REVERTED"] as const;
export type InvalidatingReason = (typeof INVALIDATING_REASONS)[number];

export function reasonTitle(code: ReasonCode): string {
  return {
    NOT_REGISTERED: "Not registered",
    NO_PROGRAM_LABEL: "No program label",
    NO_LEVEL_LABEL: "No level label",
    MULTIPLE_LEVEL_LABELS: "Several level labels",
    OUTSIDE_WINDOW: "Outside the contribution window",
    REPO_NOT_TRACKED: "Repository not tracked",
    WRONG_BASE_BRANCH: "Wrong base branch",
    SELF_MERGED: "Self-merged",
    AUTHOR_IS_MENTOR: "Project staff",
    CAP_REACHED: "Beginner cap reached",
    INVALID_LABEL: "Marked invalid",
    SPAM_LABEL: "Marked as spam",
    REVERTED: "Reverted",
    AUTHOR_SANCTIONED: "Scoring suspended",
  }[code];
}

/** A full sentence for the contributor, with the season's actual label names and limits. */
export function reasonText(code: ReasonCode, rules: ScoringRules): string {
  const { labels, caps } = rules;
  switch (code) {
    case "NOT_REGISTERED":
      return "You weren't a registered contributor when this was checked. Register as a contributor and it is checked again automatically.";
    case "NO_PROGRAM_LABEL":
      return `Neither the PR nor the issue it closes has the "${labels.program}" label.`;
    case "NO_LEVEL_LABEL":
      return `No level label was added within ${rules.labelGraceHours} hours of the merge, on the PR or on the issue it closes.`;
    case "MULTIPLE_LEVEL_LABELS":
      return "It has more than one level label, so its level is ambiguous. A mentor needs to keep just one.";
    case "OUTSIDE_WINDOW":
      return "It was merged outside the season's contribution window.";
    case "REPO_NOT_TRACKED":
      return "The repository isn't an approved repository of a live project for this season.";
    case "WRONG_BASE_BRANCH":
      return "It was merged into a branch other than the repository's default branch.";
    case "SELF_MERGED":
      return "You merged your own pull request. Someone else has to review and merge it.";
    case "AUTHOR_IS_MENTOR":
      return "You're on this project's team, and project staff can't score on their own project.";
    case "CAP_REACHED":
      return `You already have ${caps.beginnerPrsPerProject} scored beginner PRs on this project, the most that count. Try an intermediate or advanced issue.`;
    case "INVALID_LABEL":
      return `A mentor added the "${labels.invalid}" label, so it doesn't count.`;
    case "SPAM_LABEL":
      return `A mentor added the "${labels.spam}" label. It doesn't count, and it's a strike on your account.`;
    case "REVERTED":
      return `It was reverted within ${rules.revertWindowDays} days of being merged.`;
    case "AUTHOR_SANCTIONED":
      return "Scoring is suspended on your account until an organizer reviews it.";
  }
}
