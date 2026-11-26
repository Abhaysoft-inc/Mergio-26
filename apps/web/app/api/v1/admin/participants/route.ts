import { prisma, type RegistrationStatus, type Role } from "@repo/db";
import type { NextRequest } from "next/server";
import { apiError, apiUser, json, unauthorized } from "@/lib/api";

const ROLES: Record<string, Role> = { mentor: "MENTOR", maintainer: "MAINTAINER" };
const STATUSES: Record<string, RegistrationStatus> = {
  pending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
};

/** GET /api/v1/admin/participants?role=mentor&status=pending — registrations for organizers. */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (!user) return unauthorized();
  if (!user.isAdmin) return apiError(404, "Not found.");
  const params = request.nextUrl.searchParams;
  const role = ROLES[params.get("role") ?? "mentor"];
  const status = STATUSES[params.get("status") ?? "pending"];
  if (!role) return apiError(400, "role must be mentor or maintainer");
  if (!status) return apiError(400, "status must be pending, approved or rejected");

  const registrations = await prisma.registration.findMany({
    where: { role, status },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          githubLogin: true,
          image: true,
          profile: { select: { college: true, graduationYear: true } },
          mentorships: { select: { project: { select: { slug: true, name: true } } } },
        },
      },
    },
  });
  return json({
    participants: registrations.map((registration) => ({
      id: registration.id,
      role: registration.role,
      status: registration.status,
      answers: registration.answers,
      repoUrl: registration.repoUrl,
      createdAt: registration.createdAt,
      reviewedAt: registration.reviewedAt,
      user: {
        id: registration.user.id,
        name: registration.user.name,
        githubLogin: registration.user.githubLogin,
        image: registration.user.image,
        college: registration.user.profile?.college ?? null,
        graduationYear: registration.user.profile?.graduationYear ?? null,
        // Projects that already invited them as a mentor.
        invitedTo: registration.user.mentorships.map((mentorship) => mentorship.project),
      },
    })),
  });
}
