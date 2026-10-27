-- New permissions for the job rule card: every existing administrator role gets them
-- (new companies get all permissions at setup).
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p.permission
FROM "roles" r CROSS JOIN (VALUES ('job_terms.manage'), ('profit.view')) AS p(permission)
WHERE r."code" = 'admin'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Starting fee types for companies that have none yet (the owner's diesel-to-Syria fees).
-- Booked to "Permits and fees" (5300) when the company has that account.
INSERT INTO "fee_types" ("company_id", "code", "name", "default_basis", "deduct_from_carrier", "billed_to_customer", "expense_account_id")
SELECT c."id", f.code, f.name, f.basis, false, false,
       (SELECT a."id" FROM "accounts" a WHERE a."company_id" = c."id" AND a."code" = '5300')
FROM "companies" c
CROSS JOIN (VALUES
  ('FEE-001', 'Guarantee (kafala)', 'per_trip'),
  ('FEE-002', 'Insurance', 'per_trip'),
  ('FEE-003', 'Visa', 'per_trip'),
  ('FEE-004', 'Entry slip', 'per_trip'),
  ('FEE-005', 'Declaration fee', 'per_trip'),
  ('FEE-006', 'Border commission', 'per_trip'),
  ('FEE-007', 'Customs', 'per_loaded_unit')
) AS f(code, name, basis)
WHERE NOT EXISTS (SELECT 1 FROM "fee_types" x WHERE x."company_id" = c."id");
--> statement-breakpoint
INSERT INTO "document_sequences" ("company_id", "prefix", "year", "last_value")
SELECT c."id", 'FEE', 0, 7 FROM "companies" c
WHERE EXISTS (SELECT 1 FROM "fee_types" x WHERE x."company_id" = c."id" AND x."code" = 'FEE-007')
ON CONFLICT DO NOTHING;
