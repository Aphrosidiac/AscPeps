/**
 * The restock line: a variant needs a reminder when it has FEWER than this
 * many units, and not otherwise. Set by the operators (Asywa, 2026-09-25:
 * "stock under 5 units require reminder, the rest are not") — one constant so
 * the dashboard, the morning brief, the month-end wrap and the assistant's
 * stock tools can never disagree about what "low" means again. They used to:
 * the dashboard said < 5 while the assistant's tools defaulted to ≤ 10, so the
 * brief nagged about variants the operators considered fine.
 */
export const RESTOCK_BELOW = 5;
