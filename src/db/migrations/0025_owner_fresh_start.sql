-- One-time fresh start of the live Evercrest company, asked for by the owner on 2026-11-23
-- before following the guide from the beginning. It removes the test data and the starter
-- configuration, keeping only: the company, the owner's login with the Administrator role,
-- the chart of accounts with its posting map, units and currencies.
--
-- It runs only on the live database: when exactly that one company exists. On any other
-- database (tests, development, a new company) it does nothing.
-- The append-only guards are switched off only inside this step and switched on again
-- before it ends; the reset itself is recorded in the history.
DO $$
DECLARE
  live constant uuid := 'a6e2ff1a-a4fd-4d39-8ab6-392387276e32';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = live) OR (SELECT count(*) FROM companies) <> 1 THEN
    RETURN;
  END IF;

  ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only;
  ALTER TABLE journal_lines DISABLE TRIGGER journal_lines_append_only;
  ALTER TABLE journal_lines DISABLE TRIGGER journal_lines_balanced;
  ALTER TABLE journal_entries DISABLE TRIGGER journal_entries_immutable;
  ALTER TABLE journal_entries DISABLE TRIGGER journal_entries_period_check;
  ALTER TABLE exchange_rates DISABLE TRIGGER exchange_rates_append_only;

  DELETE FROM claim_items; DELETE FROM fine_waivers; DELETE FROM remote_settlements;
  DELETE FROM statement_debt_write_offs; DELETE FROM pay_statement_items; DELETE FROM payments; DELETE FROM pay_statements;
  DELETE FROM claims; DELETE FROM trip_settlements; DELETE FROM invoice_lines; DELETE FROM invoices; DELETE FROM currency_exchanges;
  DELETE FROM documents; DELETE FROM trip_fees; DELETE FROM approval_requests; DELETE FROM trips; DELETE FROM trip_imports; DELETE FROM trucks;
  DELETE FROM job_fees; DELETE FROM job_terms; DELETE FROM job_routes; DELETE FROM job_activities; DELETE FROM work_orders; DELETE FROM deliveries;
  DELETE FROM jobs; DELETE FROM projects; DELETE FROM rates; DELETE FROM contracts; DELETE FROM custom_fields;
  DELETE FROM partner_roles; DELETE FROM business_partners; DELETE FROM catalog_items;
  UPDATE journal_entries SET reversed_by_entry_id = NULL, reverses_entry_id = NULL WHERE reversed_by_entry_id IS NOT NULL OR reverses_entry_id IS NOT NULL;
  DELETE FROM journal_lines; DELETE FROM journal_entries;
  DELETE FROM money_accounts; DELETE FROM fee_types; DELETE FROM document_requirements; DELETE FROM document_types; DELETE FROM job_types;
  DELETE FROM exchange_rates; DELETE FROM fiscal_periods; DELETE FROM document_sequences; DELETE FROM idempotency_keys;
  DELETE FROM settings WHERE key <> 'accounting.posting_accounts';
  DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE code <> 'admin');
  DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE code <> 'admin');
  DELETE FROM roles WHERE code <> 'admin';
  DELETE FROM audit_events;

  INSERT INTO audit_events (company_id, actor_user_id, action, entity_type, entity_id, reason, after)
  SELECT live, (SELECT u.id FROM users u WHERE u.company_id = live ORDER BY u.created_at LIMIT 1), 'system.reset', 'company', live::text,
    'Owner asked for a fresh start before following the guide; test data and starter configuration removed',
    jsonb_build_object('kept', jsonb_build_array('company', 'owner login with the Administrator role', 'chart of accounts and posting map', 'units and currencies'));

  ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only;
  ALTER TABLE journal_lines ENABLE TRIGGER journal_lines_append_only;
  ALTER TABLE journal_lines ENABLE TRIGGER journal_lines_balanced;
  ALTER TABLE journal_entries ENABLE TRIGGER journal_entries_immutable;
  ALTER TABLE journal_entries ENABLE TRIGGER journal_entries_period_check;
  ALTER TABLE exchange_rates ENABLE TRIGGER exchange_rates_append_only;
END $$;
