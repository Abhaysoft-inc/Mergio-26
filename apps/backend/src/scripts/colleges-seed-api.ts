// Seeds curated AICTE colleges from https://indian-colleges-list.vercel.app/api/institutions
// into Postgres in batches, then matches any existing unmatched profiles.
//
//   pnpm --filter backend colleges:seed-api [--dry-run] [--limit=500]
//
// Re-running is safe: existing (AICTE, sourceId) rows are skipped, slugs are deduplicated,
// and existing CollegeAlias rows are never overwritten.
import { prisma } from "@repo/db";
import { collegeSlug, normaliseCollegeName } from "@repo/scoring";
import { enqueueJobs } from "@repo/scoring/server";

const API_URL = "https://indian-colleges-list.vercel.app/api/institutions";
const BATCH_SIZE = 500;

const flags = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
const limitFlag = flags.find((flag) => flag.startsWith("--limit="));
const limit = limitFlag ? Math.max(1, Number.parseInt(limitFlag.slice("--limit=".length), 10) || 0) : null;

type RawInstitution = {
  aicte_id?: string | null;
  institute_name?: string | null;
  address?: string | null;
  district?: string | null;
};

const INDIAN_STATES = [
  "ANDAMAN AND NICOBAR ISLANDS",
  "ANDHRA PRADESH",
  "ARUNACHAL PRADESH",
  "ASSAM",
  "BIHAR",
  "CHANDIGARH",
  "CHHATTISGARH",
  "DADRA AND NAGAR HAVELI",
  "DAMAN AND DIU",
  "DELHI",
  "GOA",
  "GUJARAT",
  "HARYANA",
  "HIMACHAL PRADESH",
  "JAMMU AND KASHMIR",
  "JHARKHAND",
  "KARNATAKA",
  "KERALA",
  "LADAKH",
  "LAKSHADWEEP",
  "MADHYA PRADESH",
  "MAHARASHTRA",
  "MANIPUR",
  "MEGHALAYA",
  "MIZORAM",
  "NAGALAND",
  "ODISHA",
  "PUDUCHERRY",
  "PUNJAB",
  "RAJASTHAN",
  "SIKKIM",
  "TAMIL NADU",
  "TELANGANA",
  "TRIPURA",
  "UTTAR PRADESH",
  "UTTARAKHAND",
  "WEST BENGAL",
];

const KEEP_UPPER = new Set(["IIT", "NIT", "IIIT", "IIM", "IISC", "IISER", "AIIMS", "RGUKT", "BIT", "MIT", "VIT", "SRM", "PSG", "BMS", "RV", "MS"]);
const LOWER_WORDS = new Set(["of", "and", "the", "for", "in", "at", "on", "to", "by"]);

function smartTitleCase(raw: string): string {
  const words = raw.trim().replace(/\s+/g, " ").split(" ");
  return words
    .map((word, idx) => {
      const upper = word.toUpperCase();
      if (KEEP_UPPER.has(upper) || /^[A-Z](\.[A-Z])+\.?$/.test(upper)) return upper;
      const lower = word.toLowerCase();
      if (idx > 0 && LOWER_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function inferState(address: string | null | undefined, district: string | null | undefined): string {
  const upperAddr = (address ?? "").toUpperCase();
  for (const state of INDIAN_STATES) {
    if (upperAddr.includes(state)) return smartTitleCase(state);
  }
  const cleanDistrict = district?.trim();
  return cleanDistrict ? smartTitleCase(cleanDistrict) : "India";
}

console.log(`Fetching institutions from ${API_URL}...`);
const response = await fetch(API_URL, { signal: AbortSignal.timeout(60_000) });
if (!response.ok) {
  console.error(`Failed to fetch institutions: HTTP ${response.status}`);
  process.exit(1);
}
const payload = (await response.json()) as { data?: RawInstitution[] };
const allRows = Array.isArray(payload.data) ? payload.data : [];
const rows = limit ? allRows.slice(0, limit) : allRows;
console.log(`Loaded ${allRows.length} records${limit ? ` (processing first ${rows.length})` : ""}.`);

const existingColleges = await prisma.college.findMany({
  select: { id: true, slug: true, source: true, sourceId: true },
});
const existingAliases = new Set(
  (await prisma.collegeAlias.findMany({ select: { normalized: true } })).map((a) => a.normalized),
);

const usedSlugs = new Set(existingColleges.map((c) => c.slug));
const existingSourceIds = new Set(
  existingColleges.filter((c) => c.source === "AICTE" && c.sourceId).map((c) => c.sourceId!),
);

type PendingCollege = {
  slug: string;
  name: string;
  state: string;
  city: string | null;
  source: "AICTE";
  sourceId: string;
  normalized: string;
};

const toInsert: PendingCollege[] = [];
let skipped = 0;

for (const row of rows) {
  const sourceId = row.aicte_id?.trim() ?? "";
  const rawName = row.institute_name?.trim() ?? "";
  if (!sourceId || rawName.length < 3) {
    skipped++;
    continue;
  }
  if (existingSourceIds.has(sourceId)) continue;
  existingSourceIds.add(sourceId);

  const name = smartTitleCase(rawName);
  const city = row.district?.trim() ? smartTitleCase(row.district) : null;
  const state = inferState(row.address, row.district);
  const base = collegeSlug(name, city);
  let slug = base;
  for (let n = 2; usedSlugs.has(slug); n++) slug = `${base}-${n}`;
  usedSlugs.add(slug);

  toInsert.push({
    slug,
    name,
    state,
    city,
    source: "AICTE",
    sourceId,
    normalized: normaliseCollegeName(name),
  });
}

let created = 0;
let aliasesCreated = 0;

if (!dryRun) {
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const result = await prisma.college.createMany({
      data: batch.map((item) => ({
        slug: item.slug,
        name: item.name,
        state: item.state,
        city: item.city,
        source: item.source,
        sourceId: item.sourceId,
      })),
      skipDuplicates: true,
    });
    created += result.count;

    const inserted = await prisma.college.findMany({
      where: { source: "AICTE", sourceId: { in: batch.map((item) => item.sourceId) } },
      select: { id: true, sourceId: true },
    });
    const idBySourceId = new Map(inserted.map((c) => [c.sourceId!, c.id]));

    const aliasRows: { normalized: string; label: string; collegeId: string }[] = [];
    for (const item of batch) {
      if (!item.normalized || existingAliases.has(item.normalized)) continue;
      const collegeId = idBySourceId.get(item.sourceId);
      if (!collegeId) continue;
      existingAliases.add(item.normalized);
      aliasRows.push({ normalized: item.normalized, label: item.name, collegeId });
    }
    if (aliasRows.length > 0) {
      const aliasResult = await prisma.collegeAlias.createMany({
        data: aliasRows,
        skipDuplicates: true,
      });
      aliasesCreated += aliasResult.count;
    }
  }
}

let matched = 0;
if (!dryRun) {
  const aliases = new Map(
    (await prisma.collegeAlias.findMany({ select: { normalized: true, collegeId: true } })).map((a) => [
      a.normalized,
      a.collegeId,
    ]),
  );
  const unmatched = await prisma.profile.findMany({
    where: { collegeId: null },
    select: { id: true, userId: true, college: true },
  });
  const season = await prisma.season.findFirst({ where: { isActive: true }, select: { id: true } });
  for (const profile of unmatched) {
    const collegeId = aliases.get(normaliseCollegeName(profile.college));
    if (!collegeId) continue;
    await prisma.profile.update({ where: { id: profile.id }, data: { collegeId, collegeMatch: "ALIAS" } });
    if (season) {
      await enqueueJobs([
        { kind: "LEADERBOARD_REFRESH", payload: { seasonId: season.id, kind: "user", id: profile.userId } },
      ]);
    }
    matched++;
  }
}

console.log(
  `${dryRun ? "Dry run: " : ""}${rows.length} rows processed. ` +
    `New colleges queued: ${toInsert.length}, created: ${created}, skipped: ${skipped}, ` +
    `new aliases: ${aliasesCreated}, profiles matched: ${matched}.`,
);
await prisma.$disconnect();
