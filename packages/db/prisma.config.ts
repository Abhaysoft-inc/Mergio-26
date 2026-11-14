import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // CLI commands (migrate, db push, studio) need a session connection, so prefer
    // Supabase's session pooler (DIRECT_URL) and fall back to DATABASE_URL.
    // Read process.env directly instead of env(): env() throws when the variable is
    // missing, and `prisma generate` (run during builds) never connects to the database.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
