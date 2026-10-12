CREATE TABLE "BibColor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BibColor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventCourtColor" (
    "eventId" TEXT NOT NULL,
    "court" INTEGER NOT NULL,
    "teamAColorId" TEXT NOT NULL,
    "teamBColorId" TEXT NOT NULL,
    CONSTRAINT "EventCourtColor_pkey" PRIMARY KEY ("eventId", "court")
);

CREATE UNIQUE INDEX "BibColor_name_key" ON "BibColor"("name");
CREATE INDEX "EventCourtColor_teamAColorId_idx" ON "EventCourtColor"("teamAColorId");
CREATE INDEX "EventCourtColor_teamBColorId_idx" ON "EventCourtColor"("teamBColorId");

ALTER TABLE "EventCourtColor"
  ADD CONSTRAINT "EventCourtColor_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCourtColor"
  ADD CONSTRAINT "EventCourtColor_teamAColorId_fkey"
  FOREIGN KEY ("teamAColorId") REFERENCES "BibColor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EventCourtColor"
  ADD CONSTRAINT "EventCourtColor_teamBColorId_fkey"
  FOREIGN KEY ("teamBColorId") REFERENCES "BibColor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "BibColor" ("id", "name", "hex") VALUES
  ('bib-color-white', 'White', '#FFFFFF'),
  ('bib-color-black', 'Black', '#111111'),
  ('bib-color-grey', 'Grey', '#808080'),
  ('bib-color-orange', 'Orange', '#F28C28'),
  ('bib-color-red', 'Red', '#C62828'),
  ('bib-color-yellow', 'Yellow', '#FDD835'),
  ('bib-color-green', 'Green', '#2E7D32'),
  ('bib-color-blue', 'Blue', '#1565C0'),
  ('bib-color-purple', 'Purple', '#6A1B9A'),
  ('bib-color-pink', 'Pink', '#D81B60');
