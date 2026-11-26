-- B-tree index for ORDER BY name ASC pagination and prefix lookups.
CREATE INDEX "College_name_idx" ON "College"("name");

-- Trigram GIN indexes so ILIKE '%query%' searches on 13k-39k+ colleges avoid sequential scans.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "College_name_trgm_idx" ON "College" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "College_city_trgm_idx" ON "College" USING GIN ("city" gin_trgm_ops);
CREATE INDEX "College_state_trgm_idx" ON "College" USING GIN ("state" gin_trgm_ops);
CREATE INDEX "CollegeAlias_normalized_trgm_idx" ON "CollegeAlias" USING GIN ("normalized" gin_trgm_ops);
