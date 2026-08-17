/**
 * Grounding guard unit tests. No LLM, no database, no API — pure functions.
 *
 *   npx tsx scripts/test-grounding-unit.ts
 *
 * This is the suite that matters. The e2e suites prove the agent works today
 * against a live model; this one proves the guard still catches the specific
 * failures that reached real operators, and it does so in milliseconds with no
 * moving parts, which means it can run on every commit forever.
 *
 * The fixtures below are NOT invented. They are the actual tool payloads and
 * the actual replies from production, pulled from `agent_tool_calls` and
 * `agent_messages` for 5 Aug and 17 Aug 2026. If a future change to the guard
 * would let either of those replies through again, this suite goes red.
 */
import {
  checkGrounding,
  buildFactIndex,
  norm,
  PRECONDITIONS,
  parseGroundingMode,
  type ToolResultRecord,
} from '../src/modules/ai-agent/grounding.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`   \x1b[32mPASS\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`   \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const tool = (name: string, result: unknown): ToolResultRecord => ({
  tool: name,
  result: typeof result === 'string' ? result : JSON.stringify(result),
});

// ---------------------------------------------------------------- fixtures

// Exactly what `list_orders {"search":"Calmant"}` returned at 09:28:54 on
// 17 Aug. Note what is NOT in it: no items, no address.
const LIST_ORDERS_CALMANT = tool('list_orders', {
  matched: 1,
  showing: 1,
  totalValue: { cents: 32000, display: 'RM 320.00' },
  orders: [
    {
      orderId: 'cmsvviz6j0000j9ydo4w1t2k1',
      orderNumber: 'ASC2608/0033',
      customer: 'Calmant Cheah',
      phone: '0122666913',
      email: null,
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      paymentMethod: 'WhatsApp (manual bank transfer)',
      total: { cents: 32000, display: 'RM 320.00' },
      trackingNumber: null,
      createdAt: '2026-08-16T14:02:00.475Z',
      deleted: false,
    },
  ],
});

// What `get_order {"orderRef":"ASC2608/0033"}` returned at 09:30:42 — the call
// that should have happened before the reply below, and eventually did.
const GET_ORDER_CALMANT = tool('get_order', {
  orderId: 'cmsvviz6j0000j9ydo4w1t2k1',
  orderNumber: 'ASC2608/0033',
  customer: 'Calmant Cheah',
  phone: '0122666913',
  status: 'PENDING',
  paymentStatus: 'UNPAID',
  total: { cents: 32000, display: 'RM 320.00' },
  address: '#04-38, Block A, Jalan Permas Utara, Bandar Baru Permas Jaya, 81750 Masai, Johor',
  subtotal: { cents: 31000, display: 'RM 310.00' },
  shippingFee: { cents: 1000, display: 'RM 10.00' },
  items: [
    {
      itemId: 'i1',
      product: 'Retatrutide',
      code: 'RT30',
      size: '30mg',
      quantity: 1,
      unitPrice: { cents: 31000, display: 'RM 310.00' },
      unitCost: null,
    },
    { itemId: 'i2', product: 'Bac Water', code: 'BW3', size: '3mL', quantity: 1 },
  ],
  allItemsCosted: false,
});

// The real 17 Aug reply, sent to operators off nothing but LIST_ORDERS_CALMANT.
const FABRICATED_DETAIL_REPLY = `Here's the full detail

*ASC2608/0033 — Calmant Cheah*
0122666913

*Items:*
- Tesamorelin 20mg (TS20) x1 — RM 310.00

*Totals:*
- Subtotal: RM 310.00
- Shipping: RM 10.00
- *Total: RM 320.00*

*Payment:* WhatsApp — *UNPAID* (awaiting bank transfer)
*Status:* Pending

*Costing:* Not yet costed
*Address:* Not yet on file (need to confirm with customer which part of Malaysia for delivery)`;

// The 5 Aug cross-record bleed. `list_orders` had returned two orders; the
// agent answered about Choo's order using Cecelia's address.
const LIST_ORDERS_TWO = tool('list_orders', {
  matched: 2,
  showing: 2,
  orders: [
    {
      orderNumber: 'ASC2608/0004',
      customer: 'Cecelia Kuek',
      phone: '0195550001',
      address: 'No 5, Jalan 3/62A, Bandar Menjalara, Kepong, 52100 Kuala Lumpur',
      status: 'CANCELLED',
      total: { cents: 14500, display: 'RM 145.00' },
    },
    {
      orderNumber: 'ASC2608/0005',
      customer: 'CHOO ONG LEONG HARRY VAKAS',
      phone: '0168362643',
      status: 'CONFIRMED',
      total: { cents: 14500, display: 'RM 145.00' },
    },
  ],
});

const BLED_ADDRESS_REPLY = `*Order:* ASC2608/0005 — CHOO ONG LEONG HARRY VAKAS

*Address:*
No 5, Jalan 3/62A, Bandar Menjalara
Kepong, 52100 Kuala Lumpur`;

// ------------------------------------------------------------------- tests

async function main() {
  console.log('\n=== normalisation ===\n');

  check('norm squashes case and punctuation', norm('#04-38, Block A') === '04 38 block a', norm('#04-38, Block A'));
  check('norm is stable across layouts', norm('No 5, Jalan 3/62A') === norm('no 5 jalan 3 62a'));

  console.log('\n=== fact index ===\n');

  const idx = buildFactIndex([GET_ORDER_CALMANT]);
  check('indexes the order as a subject', idx.subjects.has(norm('ASC2608/0033')));
  check(
    'files a nested item under its enclosing order',
    (idx.bySubject.get(norm('ASC2608/0033'))?.blob ?? '').includes('retatrutide'),
  );
  check('operator-supplied facts are grounded', buildFactIndex([], 'mark 0199998888 as paid').global.numbers.size > 0);

  console.log('\n=== 17 Aug: fabricated order detail (the live incident) ===\n');

  const augustSeventeen = checkGrounding({
    reply: FABRICATED_DETAIL_REPLY,
    toolResults: [LIST_ORDERS_CALMANT],
    operatorText: 'Full detail pls',
  });
  const kinds = augustSeventeen.violations.map((v) => `${v.kind}:${v.entityType}`);

  check(
    'catches the invented product line',
    augustSeventeen.violations.some((v) => /tesamorelin/i.test(v.entity)),
    kinds.join(', '),
  );
  check(
    'catches the invented variant code TS20',
    augustSeventeen.violations.some((v) => v.entityType === 'sku' && /TS20/.test(v.entity)),
    kinds.join(', '),
  );
  check(
    'catches describing items with no get_order',
    augustSeventeen.violations.some((v) => v.kind === 'precondition' && v.entityType === 'order-items'),
    kinds.join(', '),
  );
  check(
    'catches the FALSE ABSENCE "address: not yet on file"',
    augustSeventeen.violations.some((v) => v.kind === 'precondition' && v.entityType === 'order-address'),
    kinds.join(', '),
  );
  check(
    'catches the unchecked costing claim',
    augustSeventeen.violations.some((v) => v.kind === 'precondition' && v.entityType === 'order-costing'),
    kinds.join(', '),
  );

  console.log('\n=== 17 Aug: the same reply, once get_order has run ===\n');

  const corrected = `*ASC2608/0033 — Calmant Cheah*
0122666913

*Items:*
Retatrutide 30mg (RT30) x1 — RM 310.00
Bac Water 3mL

*Total:* RM 320.00
*Address:* #04-38, Block A, Jalan Permas Utara, Bandar Baru Permas Jaya, 81750 Masai, Johor
*Costing:* not yet costed`;

  const groundedVerdict = checkGrounding({
    reply: corrected,
    toolResults: [LIST_ORDERS_CALMANT, GET_ORDER_CALMANT],
    operatorText: 'Full detail pls',
  });
  check(
    'the correct answer passes clean',
    groundedVerdict.violations.length === 0,
    groundedVerdict.violations.map((v) => v.detail).join(' | '),
  );

  console.log('\n=== 5 Aug: cross-record address bleed ===\n');

  const augustFive = checkGrounding({
    reply: BLED_ADDRESS_REPLY,
    toolResults: [LIST_ORDERS_TWO],
    operatorText: 'Yuh',
  });
  check(
    "flags another customer's address as cross-record",
    augustFive.violations.some((v) => v.kind === 'cross-record' && v.entityType === 'address'),
    augustFive.violations.map((v) => `${v.kind}:${v.entityType}`).join(', '),
  );
  check(
    'a flat "is it anywhere in context" check would NOT have caught it',
    buildFactIndex([LIST_ORDERS_TWO]).global.blob.includes(norm('Bandar Menjalara')),
  );

  console.log('\n=== the address belongs to the order that owns it ===\n');

  const rightOrder = checkGrounding({
    reply: `*ASC2608/0004 — Cecelia Kuek*\nNo 5, Jalan 3/62A, Bandar Menjalara, Kepong, 52100 Kuala Lumpur`,
    toolResults: [LIST_ORDERS_TWO],
  });
  check(
    'same address under its own order is clean',
    !rightOrder.violations.some((v) => v.entityType === 'address'),
    rightOrder.violations.map((v) => v.detail).join(' | '),
  );

  console.log('\n=== false positives: ordinary traffic must stay silent ===\n');

  const chatter = [
    'Yes, dear?',
    'You got it, boss.',
    'Haha thanks, boss! Let me know if you need anything else.',
    'On it, one sec~',
    "Sure thing! What's the reminder for, and when would you like it?",
  ];
  for (const reply of chatter) {
    const v = checkGrounding({ reply, toolResults: [] });
    check(`conversational reply stays clean: "${reply.slice(0, 34)}…"`, v.violations.length === 0, v.violations.map((x) => x.detail).join(' | '));
  }

  const offerNoClaim = checkGrounding({
    reply: 'Nothing pending right now. Want me to check the delivery schedule for today?',
    toolResults: [],
  });
  check('an offer that asserts nothing is clean', offerNoClaim.violations.length === 0, offerNoClaim.violations.map((v) => v.detail).join(' | '));

  const listing = checkGrounding({
    reply: `You've got 1 order today:\n\n*ASC2608/0033 — Calmant Cheah* — RM 320.00, UNPAID`,
    toolResults: [LIST_ORDERS_CALMANT],
  });
  check(
    'quoting a summary back as a summary is clean',
    listing.violations.length === 0,
    listing.violations.map((v) => v.detail).join(' | '),
  );

  const derivedMoney = checkGrounding({
    reply: `*ASC2608/0033* — total RM 320.00. At a 70/30 split that's RM 224.00 and RM 96.00.`,
    toolResults: [GET_ORDER_CALMANT],
  });
  check(
    'derived money is deliberately NOT flagged',
    !derivedMoney.violations.some((v) => /224|96/.test(v.entity)),
    derivedMoney.violations.map((v) => v.detail).join(' | '),
  );

  const operatorSupplied = checkGrounding({
    reply: 'Got it — I&rsquo;ll use 0122666913 for the delivery contact.',
    toolResults: [],
    operatorText: 'her number is 0122666913',
  });
  check(
    'a phone the operator supplied is grounded',
    !operatorSupplied.violations.some((v) => v.entityType === 'phone'),
    operatorSupplied.violations.map((v) => v.detail).join(' | '),
  );

  console.log('\n=== precondition table integrity ===\n');

  check('every precondition names at least one tool', PRECONDITIONS.every((p) => p.requires.length > 0));
  check('every precondition has a unique id', new Set(PRECONDITIONS.map((p) => p.id)).size === PRECONDITIONS.length);
  check(
    'get_order satisfies every order-detail precondition',
    PRECONDITIONS.every((p) => p.requires.includes('get_order')),
  );

  console.log('\n=== coverage gate: detail-bearing read tools ===\n');

  // Mirrors the write-tool coverage gate in test-agent-writes.ts, for the same
  // reason: a rule table that nobody is forced to update rots, and it rots
  // silently — the guard keeps passing while a whole new class of detail walks
  // out ungrounded.
  //
  // Any tool that returns record-level detail must be reachable from a
  // precondition, or be exempted here ON PURPOSE with a reason. Adding tool 65
  // and forgetting this file is exactly the failure mode being designed out.
  const { ALL_TOOLS } = await import('../src/modules/ai-agent/registry.js');

  const EXEMPT: Record<string, string> = {
    get_product: 'catalogue copy, not a customer record — no address, items or costing claims hang off it',
    get_insight: 'published article text; nothing in it is an order fact',
    get_settings: 'store configuration, already stated to the model from the live STORE STATE block',
  };

  const detailTools = ALL_TOOLS.filter((t) => !t.write && /^get_|_statement$|^order_/.test(t.name));
  const covered = new Set(PRECONDITIONS.flatMap((p) => p.requires));
  const uncovered = detailTools.filter((t) => !covered.has(t.name) && !(t.name in EXEMPT));

  check(
    'every detail-bearing read tool is covered by a precondition or explicitly exempt',
    uncovered.length === 0,
    uncovered.length ? `uncovered: ${uncovered.map((t) => t.name).join(', ')}` : ''
  );
  check(
    'no precondition names a tool that does not exist',
    PRECONDITIONS.every((p) => p.requires.every((name) => ALL_TOOLS.some((t) => t.name === name))),
    PRECONDITIONS.flatMap((p) => p.requires)
      .filter((name) => !ALL_TOOLS.some((t) => t.name === name))
      .join(', ')
  );

  console.log('\n=== mode parsing ===\n');
  check('defaults to shadow', parseGroundingMode(undefined) === 'shadow');
  check('unknown values fall back to shadow, never to off', parseGroundingMode('yes please') === 'shadow');
  check('enforce is honoured', parseGroundingMode('enforce') === 'enforce');
  check('off is honoured', parseGroundingMode('off') === 'off');

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${pass} passed, ${fail} failed`);
  if (failures.length) console.log(`failed: ${failures.join(' | ')}`);
  console.log('='.repeat(70));
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
