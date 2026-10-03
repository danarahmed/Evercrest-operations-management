-- Database-level guards for integrity rules that must hold even if application code is wrong.

CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'check_violation';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER exchange_rates_append_only BEFORE UPDATE OR DELETE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- Posted entries are immutable; the only permitted change is linking the reversal once.
CREATE FUNCTION journal_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'journal entries cannot be deleted; reverse them' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.reversed_by_entry_id IS NOT NULL
     OR NEW.reversed_by_entry_id IS NULL
     OR (to_jsonb(NEW) - 'reversed_by_entry_id') <> (to_jsonb(OLD) - 'reversed_by_entry_id') THEN
    RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_guard();
--> statement-breakpoint

-- No posting into a locked month.
CREATE FUNCTION journal_entries_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fiscal_periods p
    WHERE p.company_id = NEW.company_id
      AND p.year = extract(year FROM NEW.entry_date)
      AND p.month = extract(month FROM NEW.entry_date)
      AND p.status = 'locked'
  ) THEN
    RAISE EXCEPTION 'period % is locked', to_char(NEW.entry_date, 'YYYY-MM') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_period_check BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_period_open();
--> statement-breakpoint

-- Every entry has at least two lines and balances within each currency (checked at commit).
CREATE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bad text;
BEGIN
  IF (SELECT count(*) FROM journal_lines WHERE entry_id = NEW.entry_id) < 2 THEN
    RAISE EXCEPTION 'journal entry % needs at least two lines', NEW.entry_id USING ERRCODE = 'check_violation';
  END IF;
  SELECT string_agg(currency, ', ') INTO bad FROM (
    SELECT currency FROM journal_lines WHERE entry_id = NEW.entry_id
    GROUP BY currency HAVING sum(debit) <> sum(credit)
  ) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'journal entry % does not balance in %', NEW.entry_id, bad USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
--> statement-breakpoint

-- Reference data: ISO 4217 minor units.
INSERT INTO currencies (code, name, minor_units) VALUES
  ('IQD', 'Iraqi Dinar', 3),
  ('USD', 'US Dollar', 2);
