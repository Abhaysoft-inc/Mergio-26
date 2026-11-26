// The roles from PRD section 2, and who holds them. Plain data only, no server imports,
// so client components can use the types too.
//
// - Visitor: anyone, signed in or not.
// - Contributor, Mentor, Project Admin: an APPROVED registration for that role
//   (a project admin registers as a maintainer). Who owns a particular project is a
//   separate, per-project check.
// - Organizer, Super Admin: User.staffRole. A super admin can do everything an organizer can.

export const PLATFORM_ROLES = [
  "VISITOR",
  "CONTRIBUTOR",
  "MENTOR",
  "PROJECT_ADMIN",
  "ORGANIZER",
  "SUPER_ADMIN",
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const STAFF_ROLES = ["ORGANIZER", "SUPER_ADMIN"] as const;
export type StaffRoleName = (typeof STAFF_ROLES)[number];

type RegistrationRole = "CONTRIBUTOR" | "MAINTAINER" | "MENTOR";

const REGISTRATION_TO_PLATFORM: Record<RegistrationRole, PlatformRole> = {
  CONTRIBUTOR: "CONTRIBUTOR",
  MENTOR: "MENTOR",
  MAINTAINER: "PROJECT_ADMIN",
};

/** Better Auth types additional fields loosely, so anything unrecognised counts as no staff role. */
export function parseStaffRole(value: unknown): StaffRoleName | null {
  return STAFF_ROLES.find((role) => role === value) ?? null;
}

/** Every role a person holds, in PLATFORM_ROLES order. A null user is a visitor. */
export function rolesOf(
  user: { staffRole?: unknown; isAdmin?: unknown; isSuperAdmin?: unknown } | null,
  registrations: { role: RegistrationRole; status: string }[] = [],
): PlatformRole[] {
  const held = new Set<PlatformRole>(["VISITOR"]);
  if (user) {
    for (const registration of registrations) {
      if (registration.status === "APPROVED") {
        held.add(REGISTRATION_TO_PLATFORM[registration.role]);
      }
    }
    const staff = parseStaffRole(user.staffRole);
    if (staff === "SUPER_ADMIN" || user.isSuperAdmin === true) {
      held.add("SUPER_ADMIN").add("ORGANIZER");
    } else if (staff === "ORGANIZER" || user.isAdmin === true) {
      held.add("ORGANIZER");
    }
  }
  return PLATFORM_ROLES.filter((role) => held.has(role));
}

/** Whether a person may act as an organizer (organizers and super admins). */
export function isOrganizer(
  user: { staffRole?: unknown; isAdmin?: unknown; isSuperAdmin?: unknown } | null | undefined,
) {
  return (
    parseStaffRole(user?.staffRole) !== null ||
    user?.isAdmin === true ||
    user?.isSuperAdmin === true
  );
}

export function isSuperAdmin(
  user: { staffRole?: unknown; isSuperAdmin?: unknown } | null | undefined,
) {
  return parseStaffRole(user?.staffRole) === "SUPER_ADMIN" || user?.isSuperAdmin === true;
}
