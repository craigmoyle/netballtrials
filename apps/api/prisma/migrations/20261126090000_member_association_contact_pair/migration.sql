-- Keep the contact fields as an atomic pair, matching the Admin contract.
-- Fail rather than silently erase a legacy name or email; an Admin must clean it first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MemberAssociation"
    WHERE ("primaryContactName" IS NULL) <> ("primaryContactEmail" IS NULL)
  ) THEN
    RAISE EXCEPTION 'MemberAssociation contains incomplete primary contact pairs. Repair them before migration.';
  END IF;
END $$;

ALTER TABLE "MemberAssociation"
ADD CONSTRAINT "MemberAssociation_contact_pair_check"
CHECK (("primaryContactName" IS NULL) = ("primaryContactEmail" IS NULL));
