-- Trigram search for resolving an order by a misspelled customer name.
--
-- Substring matching is exact about every character: on 17 Aug 2026 an operator
-- asked for the "calment" order, the real customer was "Calmant", and the agent
-- reported no match at all across two round trips. Operators type names they
-- heard over the phone, so the resolver needs a fallback that tolerates a wrong
-- letter. See fuzzyOrderMatches in orders.tools.ts.
--
-- IF NOT EXISTS so this is a no-op on any database where it is already present,
-- and so re-running the migration set cannot fail.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram indexes. Without them `similarity()` sequentially scans the
-- orders table on every fuzzy lookup — fine at today's row count and not fine
-- later, and the fallback only runs after an exact search has already missed.
CREATE INDEX IF NOT EXISTS orders_customer_name_trgm_idx ON orders USING gin ("customerName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS orders_order_number_trgm_idx ON orders USING gin ("orderNumber" gin_trgm_ops);
