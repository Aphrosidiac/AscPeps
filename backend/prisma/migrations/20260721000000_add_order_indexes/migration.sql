-- Indexes for the hot order-read paths: order detail / receipt joins
-- (order_items by order), variant sales rollups (order_items by variant —
-- note the physical column is still "productId", see the @map in schema),
-- and every date-ranged dashboard/analytics query (orders by createdAt).
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");
