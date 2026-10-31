/**
 * Group Buy is built but not launched. Off unless the build sets
 * NEXT_PUBLIC_GROUP_BUY_ENABLED=true (the API has GROUP_BUY_ENABLED to match):
 * no header button, no portal, no promos, no admin entry. See docs/group-buy.md.
 */
export const GROUP_BUY_ENABLED = process.env.NEXT_PUBLIC_GROUP_BUY_ENABLED === 'true';
