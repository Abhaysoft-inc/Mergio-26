import { z } from "zod";

// Dispute input (F-12), shared by the dispute form (client) and the server. Plain data only.

export const DISPUTE_CATEGORIES = {
  WRONG_LEVEL: "The level is wrong",
  MISSING_POINTS: "Points or a bonus are missing",
  WRONGLY_INELIGIBLE: "It was wrongly marked not eligible",
  WRONGLY_INVALIDATED: "It was wrongly invalidated",
  OTHER: "Something else",
} as const;
export type DisputeCategoryName = keyof typeof DISPUTE_CATEGORIES;

export const DISPUTE_STATUS_LABELS = {
  OPEN: "Dispute open",
  IN_REVIEW: "Dispute in review",
  UPHELD: "Dispute upheld",
  REJECTED: "Dispute rejected",
} as const;

export const MAX_EVIDENCE_LINKS = 5;

export const disputeSchema = z.object({
  pullRequestId: z.string().min(1, "Pick a pull request"),
  category: z.enum(
    Object.keys(DISPUTE_CATEGORIES) as [DisputeCategoryName, ...DisputeCategoryName[]],
    "Pick what is wrong",
  ),
  text: z
    .string()
    .trim()
    .min(20, "Explain what is wrong in at least 20 characters")
    .max(2000, "Keep this under 2000 characters"),
  evidenceUrls: z
    .array(z.url({ protocol: /^https$/, message: "Evidence links must start with https://" }).max(300))
    .max(MAX_EVIDENCE_LINKS, `Add at most ${MAX_EVIDENCE_LINKS} links`),
});

export type DisputeInput = z.infer<typeof disputeSchema>;

export type DisputeFormState = {
  errors?: Partial<Record<"category" | "text" | "evidenceUrls" | "form", string>>;
};

/** One link per line (or separated by spaces); blanks dropped. */
export const splitLinks = (value: string) =>
  value
    .split(/\s+/)
    .map((link) => link.trim())
    .filter(Boolean);
