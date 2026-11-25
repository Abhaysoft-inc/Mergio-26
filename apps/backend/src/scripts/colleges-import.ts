// Imports colleges into the curated list (F-08) from a CSV, then matches existing profiles.
//
//   pnpm --filter backend colleges:import <file.csv> [--dry-run]
//
// Columns (header row required, any order):
//   source    AICTE, UGC or ADMIN
//   sourceId  the id in that dataset (AICTE permanent id, UGC id); empty for ADMIN
//   name      the institution's name
//   state     full state or union territory name, e.g. "Tamil Nadu"
//   city      optional
//   aliases   optional, "|"-separated other names and abbreviations, e.g. "IITM|IIT Madras"
//
// Build the file from AICTE's list of approved institutions and UGC's list of universities: keep
// one row per institution and map their columns onto the ones above. Rows are upserted by
// (source, sourceId), so re-running with a newer export updates names and states in place.
// An alias already used by another college is reported and skipped, never moved.
import { readFileSync } from "node:fs";
import { prisma, type CollegeSource } from "@repo/db";
import { collegeSlug, normaliseCollegeName } from "@repo/scoring";
import { enqueueJobs } from "@repo/scoring/server";

const [file, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
if (!file) {
  console.error("Usage: colleges:import <file.csv> [--dry-run]");
  process.exit(1);
}

/** A small RFC 4180 parser: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

const [header, ...rows] = parseCsv(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
if (!header) {
  console.error("The file is empty.");
  process.exit(1);
}
const column = (name: string) => header.findIndex((value) => value.trim().toLowerCase() === name.toLowerCase());
const at = { source: column("source"), sourceId: column("sourceId"), name: column("name"), state: column("state"), city: column("city"), aliases: column("aliases") };
for (const required of ["source", "name", "state"] as const) {
  if (at[required] < 0) {
    console.error(`Missing the "${required}" column.`);
    process.exit(1);
  }
}

const SOURCES = new Set(["AICTE", "UGC", "ADMIN"]);
const usedSlugs = new Set((await prisma.college.findMany({ select: { slug: true } })).map((c) => c.slug));
const stats = { created: 0, updated: 0, skipped: 0, aliases: 0, aliasConflicts: 0 };

for (const [index, row] of rows.entries()) {
  const value = (i: number) => (i >= 0 ? (row[i] ?? "").trim() : "");
  const source = value(at.source).toUpperCase();
  const sourceId = value(at.sourceId) || null;
  const name = value(at.name).replace(/\s+/g, " ");
  const state = value(at.state).replace(/\s+/g, " ");
  const city = value(at.city) || null;
  if (!SOURCES.has(source) || name.length < 3 || state.length < 2 || (source !== "ADMIN" && !sourceId)) {
    console.warn(`Line ${index + 2}: skipped (needs source, name, state, and a sourceId for AICTE/UGC)`);
    stats.skipped++;
    continue;
  }
  if (dryRun) continue;

  const existing = sourceId
    ? await prisma.college.findUnique({ where: { source_sourceId: { source: source as CollegeSource, sourceId } } })
    : await prisma.college.findFirst({ where: { source: "ADMIN", name } });
  let college;
  if (existing) {
    college = await prisma.college.update({ where: { id: existing.id }, data: { name, state, city } });
    stats.updated++;
  } else {
    const base = collegeSlug(name, city);
    let slug = base;
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${base}-${n}`;
    usedSlugs.add(slug);
    college = await prisma.college.create({
      data: { name, state, city, slug, source: source as CollegeSource, sourceId },
    });
    stats.created++;
  }

  const names = [name, ...value(at.aliases).split("|")].map((alias) => alias.trim()).filter(Boolean);
  for (const alias of names) {
    const normalized = normaliseCollegeName(alias);
    if (!normalized) continue;
    const taken = await prisma.collegeAlias.findUnique({ where: { normalized } });
    if (taken && taken.collegeId !== college.id) {
      console.warn(`Alias "${alias}" already belongs to another college; skipped for ${name}`);
      stats.aliasConflicts++;
      continue;
    }
    if (!taken) {
      await prisma.collegeAlias.create({ data: { normalized, label: alias, collegeId: college.id } });
      stats.aliases++;
    }
  }
}

// Profiles that typed a name these aliases now cover.
let matched = 0;
if (!dryRun) {
  const aliases = new Map(
    (await prisma.collegeAlias.findMany({ select: { normalized: true, collegeId: true } })).map((a) => [a.normalized, a.collegeId]),
  );
  const unmatched = await prisma.profile.findMany({ where: { collegeId: null }, select: { id: true, userId: true, college: true } });
  const season = await prisma.season.findFirst({ where: { isActive: true }, select: { id: true } });
  for (const profile of unmatched) {
    const collegeId = aliases.get(normaliseCollegeName(profile.college));
    if (!collegeId) continue;
    await prisma.profile.update({ where: { id: profile.id }, data: { collegeId, collegeMatch: "ALIAS" } });
    if (season) {
      await enqueueJobs([{ kind: "LEADERBOARD_REFRESH", payload: { seasonId: season.id, kind: "user", id: profile.userId } }]);
    }
    matched++;
  }
}

console.log(
  `${dryRun ? "Dry run: " : ""}${rows.length} rows. Created ${stats.created}, updated ${stats.updated}, skipped ${stats.skipped}. ` +
    `${stats.aliases} new aliases, ${stats.aliasConflicts} alias conflicts. ${matched} profiles matched.`,
);
await prisma.$disconnect();
