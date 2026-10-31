-- Outbox capture: every insert/update in the six Paytm schemas writes an
-- hisaab.outbox_events row and pings 'ledger_change' with the merchant id.
-- Idempotent: safe to re-run after every `prisma db push`.

CREATE OR REPLACE FUNCTION hisaab.capture_ledger_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rec jsonb := to_jsonb(NEW);
  mid text;
BEGIN
  -- A device heartbeat (only last_seen_at moved) is not a ledger change; skip it so the
  -- simulated pings don't send every merchant through detection.
  IF TG_OP = 'UPDATE' AND TG_TABLE_SCHEMA = 'logistics' AND TG_TABLE_NAME = 'devices'
     AND (to_jsonb(NEW) - 'last_seen_at') = (to_jsonb(OLD) - 'last_seen_at') THEN
    RETURN NEW;
  END IF;

  -- Two tables have no merchant_id of their own; resolve it inside their silo.
  mid := CASE TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME
    WHEN 'merchants.merchants' THEN rec->>'id'
    WHEN 'logistics.device_events' THEN (SELECT merchant_id FROM logistics.devices WHERE id = rec->>'device_id')
    WHEN 'lending.loan_payments' THEN (SELECT merchant_id FROM lending.loans WHERE id = rec->>'loan_id')
    ELSE rec->>'merchant_id'
  END;

  INSERT INTO hisaab.outbox_events ("schema", "table", row_id, op, merchant_id)
  VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, rec->>'id', TG_OP, mid);

  PERFORM pg_notify('ledger_change', coalesce(mid, ''));
  RETURN NEW;
END $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT table_schema, table_name FROM information_schema.tables
    WHERE table_type = 'BASE TABLE'
      AND table_schema IN ('merchants', 'settlement', 'billing', 'logistics', 'disputes', 'lending')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS ledger_change ON %I.%I', t.table_schema, t.table_name);
    EXECUTE format(
      'CREATE TRIGGER ledger_change AFTER INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION hisaab.capture_ledger_change()',
      t.table_schema, t.table_name);
  END LOOP;
END $$;
