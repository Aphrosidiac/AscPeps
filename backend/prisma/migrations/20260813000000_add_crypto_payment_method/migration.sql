-- Crypto becomes its own PaymentMethod rather than a third `payment_gateway`
-- option. The gateway setting is store-wide, so listing BTCPay there would
-- have made Bitcoin the only online method and switched FPX off for everyone.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CRYPTO';
