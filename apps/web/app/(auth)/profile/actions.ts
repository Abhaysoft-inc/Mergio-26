"use server";

import { prisma } from "@repo/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import { registrationSchema } from "@/lib/registration";

export type ContactState = {
  errors?: { phone?: string; discord?: string; form?: string };
  saved?: boolean;
};

const contactSchema = registrationSchema.pick({ phone: true, discord: true });

export async function updateContactAction(
  _prev: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const user = await requireUser();
  const parsed = contactSchema.safeParse({
    phone: formData.get("phone")?.toString() ?? "",
    discord: formData.get("discord")?.toString() ?? "",
  });
  if (!parsed.success) {
    const errors: NonNullable<ContactState["errors"]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] === "phone" ? "phone" : "discord";
      errors[key] ??= issue.message;
    }
    return { errors };
  }

  // Blank means "remove it".
  const result = await prisma.profile.updateMany({
    where: { userId: user.id },
    data: { phone: parsed.data.phone ?? null, discord: parsed.data.discord ?? null },
  });
  if (result.count === 0) return { errors: { form: "Register first to create your profile." } };

  revalidatePath("/profile");
  return { saved: true };
}
