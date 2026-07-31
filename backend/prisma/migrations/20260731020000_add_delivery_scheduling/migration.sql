
-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "delivery_windows" (
    "id" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 60,
    "capacity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "partnerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_blackouts" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_bookings" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_windows_dayOfWeek_active_idx" ON "delivery_windows"("dayOfWeek", "active");

-- CreateIndex
CREATE INDEX "delivery_blackouts_date_idx" ON "delivery_blackouts"("date");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_bookings_orderId_key" ON "delivery_bookings"("orderId");

-- CreateIndex
CREATE INDEX "delivery_bookings_scheduledFor_idx" ON "delivery_bookings"("scheduledFor");

-- CreateIndex
CREATE INDEX "delivery_bookings_status_idx" ON "delivery_bookings"("status");

-- AddForeignKey
ALTER TABLE "delivery_windows" ADD CONSTRAINT "delivery_windows_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_bookings" ADD CONSTRAINT "delivery_bookings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
