// Prisma's `contains` becomes `LIKE '%…%'` without escaping, so a search for "%" or "_" would
// match everything. Escape LIKE's wildcards (and the escape character itself) in user input.
export const likeText = (text: string) => text.replace(/[\\%_]/g, "\\$&");
