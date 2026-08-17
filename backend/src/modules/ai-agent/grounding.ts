// Read-side honesty guard.
//
// The write side has had a guard since day one (CLAIMS_COMPLETION in
// agent.service.ts): the model may not say a change landed unless a write tool
// returned success this turn. The read side had nothing, and the same class of
// failure duly appeared there instead — twice, identically, twelve days apart:
//
//   5 Aug   asked for an order's contents, the only tool called was
//           `list_orders` (which returns neither items nor address). The reply
//           listed two items that were not on the order and an address that
//           belonged to a DIFFERENT customer in the same tool result.
//   17 Aug  same question, same single `list_orders` call, invented item line,
//           and asserted "no address on file" for an order whose address was
//           sitting in the database. Corrected itself only after the operator
//           pushed twice, at which point it called `get_order` and was right
//           within 100ms.
//
// The system prompt already forbids exactly this ("Never state a number, price,
// stock level or order detail from memory or assumption — look it up"). It did
// not hold, in the same way the markdown-formatting instruction did not hold
// until `toWhatsAppText` fixed it in code. So this fixes it in code.
//
// Two independent mechanisms, because they fail in opposite directions:
//
//   1. GROUNDING — every checkable entity in the reply must appear in a tool
//      result from THIS turn, under the record the reply attributes it to.
//      Catches invention, and catches the 5 Aug cross-record bleed that a flat
//      "is this string anywhere in the context" check would have waved through.
//
//   2. PRECONDITIONS — certain claim shapes require certain tools to have run,
//      regardless of what the reply says. Grounding alone cannot catch a false
//      claim of ABSENCE ("no address on file"), because absence has no string
//      to look up. That was half of the 17 Aug failure.
//
// Deliberately NOT checked here: money. Operators legitimately ask for derived
// figures ("so how much does each of us get?") and the answer is arithmetic the
// model performs on grounded inputs. Flagging those would train everyone to
// ignore the guard, which is worse than not having it. Money can be added once
// shadow-mode traffic shows what the real derivation patterns look like.
//
// Everything in this file is pure and synchronous: no database, no model, no
// clock. That is what lets `test-grounding-unit.ts` cover it exhaustively in
// milliseconds, which is the actual reason the failure above will not come back.

export type GroundingMode = 'off' | 'shadow' | 'enforce';

export interface ToolResultRecord {
  tool: string;
  /** The JSON string exactly as it was handed to the model. */
  result: string;
}

export type ViolationKind = 'ungrounded' | 'cross-record' | 'precondition';

export interface GroundingViolation {
  kind: ViolationKind;
  /** Machine label for the sort of thing that was said. */
  entityType: string;
  /** The offending text, as it appeared in the reply. */
  entity: string;
  /** The record the reply attributed it to, when one could be determined. */
  subject?: string;
  /** One line an operator — or the model, during repair — can act on. */
  detail: string;
}

export interface GroundingInput {
  reply: string;
  /** Every tool result produced this turn, in order. */
  toolResults: ToolResultRecord[];
  /** The operator's own message. Facts they supplied are theirs to supply. */
  operatorText?: string;
  /**
   * Non-tool context the model was legitimately given this turn: the actor's
   * own name and number from the system prompt, and the operator-authored
   * memory blocks. These are facts the agent is SUPPOSED to know without
   * looking them up — flagging the operator's own phone number back at them as
   * an invention is noise, and the production replay duly produced exactly
   * that on a "hello, who are you" turn.
   */
  trustedContext?: string[];
}

export interface GroundingVerdict {
  violations: GroundingViolation[];
  /** Tool names that ran this turn, for the audit row. */
  toolsRan: string[];
}

// ---------------------------------------------------------------- normalising

/**
 * One-way squash used for every comparison on both sides.
 *
 * Case, punctuation and whitespace all vary freely between a JSON payload and
 * the prose a model writes about it — "#04-38, Block A" becomes "#04-38 Block
 * A" or "04-38 block a" depending on how it decided to lay the address out.
 * None of that variation is meaningful, so none of it survives this function.
 */
export function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Digits only. Phone numbers arrive as 0122666913, 012-266 6913, +60122666913. */
function digits(value: string): string {
  return value.replace(/\D+/g, '');
}

// ------------------------------------------------------------------ the index

interface SubjectFacts {
  /** Every scalar value seen under this subject, normalised. */
  values: Set<string>;
  /** All of them concatenated, so a reformatted address still matches. */
  blob: string;
  /** Digit-only forms, for phone/postcode comparison. */
  numbers: Set<string>;
}

export interface FactIndex {
  /** Facts keyed by the record they were returned under (an order number, a product name). */
  bySubject: Map<string, SubjectFacts>;
  /** Every fact from every tool result, plus anything the operator said. */
  global: SubjectFacts;
  /** Subjects that appeared in this turn's tool results at all. */
  subjects: Set<string>;
}

function emptyFacts(): SubjectFacts {
  return { values: new Set(), blob: '', numbers: new Set() };
}

function addFact(facts: SubjectFacts, raw: unknown) {
  if (raw === null || raw === undefined) return;
  const text = String(raw);
  if (!text) return;
  const n = norm(text);
  if (n) {
    facts.values.add(n);
    facts.blob += ` ${n}`;
  }
  const d = digits(text);
  if (d.length >= 4) facts.numbers.add(d);
}

/**
 * The identifier a nested object hangs off, if it has one.
 *
 * This is what makes cross-record bleed detectable. On 5 Aug the address the
 * agent quoted WAS in a tool result — it was just the wrong customer's, from a
 * neighbouring row of the same `list_orders` payload. Indexing every scalar
 * against the record it was nested under means "this address exists somewhere
 * in the context" and "this address belongs to the order you named" stop being
 * the same question.
 */
function subjectOf(node: Record<string, unknown>): string | undefined {
  // `order` earns its place next to `orderNumber`: delivery_schedule returns
  // rows shaped {bookingId, when, order: "ASC2608/0003", address, …}, and
  // without it every delivery address was filed under no record at all — which
  // showed up in the production replay as a wall of phantom cross-record
  // violations on turns that were in fact perfectly correct.
  for (const key of ['orderNumber', 'order', 'code', 'slug', 'name', 'orderId', 'bookingId', 'productId', 'variantId', 'id']) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) return norm(value);
    if (typeof value === 'number') return norm(String(value));
  }
  return undefined;
}

/**
 * Walk a parsed tool result, filing every scalar under the nearest enclosing
 * record as well as globally.
 *
 * Subjects nest (an item sits inside an order), and a fact is filed under EVERY
 * subject in its ancestry — an item's product name is legitimately a fact about
 * the order that contains it, not only about the line. Without that, quoting an
 * order's items back correctly would read as a cross-record violation.
 */
function walk(node: unknown, ancestry: string[], index: FactIndex) {
  if (node === null || node === undefined) return;

  if (Array.isArray(node)) {
    for (const child of node) walk(child, ancestry, index);
    return;
  }

  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    const own = subjectOf(record);
    const nextAncestry = own && !ancestry.includes(own) ? [...ancestry, own] : ancestry;
    if (own) {
      index.subjects.add(own);
      if (!index.bySubject.has(own)) index.bySubject.set(own, emptyFacts());
    }
    for (const value of Object.values(record)) walk(value, nextAncestry, index);
    return;
  }

  // Scalar. File it globally and against every record enclosing it.
  addFact(index.global, node);
  for (const subject of ancestry) {
    let facts = index.bySubject.get(subject);
    if (!facts) {
      facts = emptyFacts();
      index.bySubject.set(subject, facts);
    }
    addFact(facts, node);
  }
}

export function buildFactIndex(
  toolResults: ToolResultRecord[],
  operatorText?: string,
  trustedContext?: string[]
): FactIndex {
  const index: FactIndex = { bySubject: new Map(), global: emptyFacts(), subjects: new Set() };

  for (const { result } of toolResults) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(result);
    } catch {
      // A tool result that will not parse is still evidence the model saw —
      // index it flat rather than pretending the turn had no data at all.
      addFact(index.global, result);
      continue;
    }
    walk(parsed, [], index);
  }

  // What the operator typed is grounded by definition: they are the source.
  // "Mark the order for 0122666913 as paid" must not read as an invented phone
  // number just because no tool happened to echo it back.
  if (operatorText) addFact(index.global, operatorText);
  for (const block of trustedContext ?? []) addFact(index.global, block);

  return index;
}

// -------------------------------------------------------------- lookups

function knownGlobally(index: FactIndex, needle: string): boolean {
  const n = norm(needle);
  if (!n) return true;
  return index.global.values.has(n) || index.global.blob.includes(n);
}

function knownUnder(index: FactIndex, subject: string | undefined, needle: string): boolean {
  if (!subject) return false;
  const facts = index.bySubject.get(subject);
  if (!facts) return false;
  const n = norm(needle);
  if (!n) return true;
  return facts.values.has(n) || facts.blob.includes(n);
}

/**
 * Looser match for one component of a multi-part entity.
 *
 * Operators and the model both abbreviate product names constantly — "Reta
 * 10mg" for Retatrutide, "Tesa" for Tesamorelin. An abbreviation of a name that
 * IS on the record is not a fabrication, and the production replay showed this
 * accounted for most of the remaining product-size noise. A prefix of at least
 * four characters landing on a token boundary is specific enough that
 * "Tesamorelin" still cannot pass against a record holding only Retatrutide.
 */
function partKnown(blob: string, values: Set<string>, part: string): boolean {
  const n = norm(part);
  if (!n) return true;
  if (values.has(n) || blob.includes(n)) return true;
  if (n.length < 4) return false;
  return new RegExp(`(?:^| )${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(blob);
}

function partKnownUnder(index: FactIndex, subject: string | undefined, part: string): boolean {
  if (!subject) return false;
  const facts = index.bySubject.get(subject);
  return facts ? partKnown(facts.blob, facts.values, part) : false;
}

function partKnownGlobally(index: FactIndex, part: string): boolean {
  return partKnown(index.global.blob, index.global.values, part);
}

function numberKnown(index: FactIndex, subject: string | undefined, raw: string): 'subject' | 'global' | 'no' {
  const d = digits(raw);
  if (d.length < 4) return 'subject';
  if (subject) {
    const facts = index.bySubject.get(subject);
    if (facts && [...facts.numbers].some((k) => k.endsWith(d) || d.endsWith(k))) return 'subject';
  }
  if ([...index.global.numbers].some((k) => k.endsWith(d) || d.endsWith(k))) return 'global';
  return 'no';
}

// ------------------------------------------------------- entity extraction

/**
 * Order numbers, e.g. ASC2608/0033. Also the anchor for subject attribution:
 * whichever one most recently appeared above a line is the record that line is
 * talking about.
 */
const ORDER_NUMBER_RE = /\b[A-Z]{2,4}\d{4}\/\d{4}\b/g;

/** Variant codes as they appear in the catalogue: TS20, RT30, AOD10, BPC157. */
const SKU_RE = /\b[A-Z]{2,5}-?\d{1,4}\b/g;

/** "Tesamorelin 20mg", "Bac Water 3mL", "MOTS-C 10mg". */
const PRODUCT_SIZE_RE = /\b([A-Za-z][A-Za-z0-9-]{2,})\s+(\d+(?:\.\d+)?\s?(?:mg|mcg|ml|iu|g))\b/gi;

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g;

/** Malaysian mobile/landline as operators write them. */
const PHONE_RE = /\b(?:\+?60|0)\d{1,2}-?\s?\d{3,4}\s?\d{3,4}\b/g;

const POSTCODE_RE = /\b\d{5}\b/;

const STATES =
  /\b(johor|kedah|kelantan|melaka|malacca|negeri sembilan|pahang|penang|pulau pinang|perak|perlis|sabah|sarawak|selangor|terengganu|kuala lumpur|labuan|putrajaya)\b/i;

/** Not product names, however much they look like one next to a number. */
const PRODUCT_STOPWORDS = new Set([
  'rm', 'myr', 'total', 'subtotal', 'shipping', 'discount', 'order', 'qty', 'quantity',
  'stock', 'price', 'cost', 'paid', 'unpaid', 'status', 'about', 'over', 'under', 'and',
  'the', 'for', 'was', 'per', 'each', 'with', 'plus', 'free', 'foc', 'add', 'addon',
]);

/** Uppercase runs that are never variant codes. */
const SKU_STOPWORDS = new Set(['RM', 'MYR', 'ASC', 'PM', 'AM', 'ID', 'NO', 'OK', 'AI', 'CP', 'GB', 'MB']);

interface Extracted {
  type: string;
  text: string;
  /** Index in the reply, used to attribute it to the nearest order number above. */
  at: number;
  /**
   * Components that must each be grounded, rather than the whole string.
   *
   * A product and its size are separate columns in the database and therefore
   * separate scalars in a tool result — `{product: "Retatrutide", code: "RT30",
   * size: "30mg"}` never contains the contiguous text "Retatrutide 30mg". The
   * claim being checked is that the name and the size occur together on one
   * record, which is exactly what "Tesamorelin 20mg" failed to do on 17 Aug.
   */
  parts?: string[];
}

function extractEntities(reply: string): Extracted[] {
  const found: Extracted[] = [];
  const push = (type: string, text: string, at: number, parts?: string[]) =>
    found.push({ type, text, at, parts });

  for (const m of reply.matchAll(ORDER_NUMBER_RE)) push('order-number', m[0], m.index ?? 0);
  for (const m of reply.matchAll(EMAIL_RE)) push('email', m[0], m.index ?? 0);
  for (const m of reply.matchAll(PHONE_RE)) push('phone', m[0], m.index ?? 0);

  // Order numbers contain digit runs that would otherwise be read as SKUs, and
  // the SKU pattern is the loosest one here, so strip them from its input.
  const withoutOrderNumbers = reply.replace(ORDER_NUMBER_RE, ' ');
  for (const m of withoutOrderNumbers.matchAll(SKU_RE)) {
    const raw = m[0];
    const alpha = raw.replace(/[^A-Za-z]/g, '');
    if (SKU_STOPWORDS.has(alpha.toUpperCase())) continue;
    // Require genuine upper case: `Block A` and `04-38` are not variant codes.
    if (alpha !== alpha.toUpperCase()) continue;
    push('sku', raw, m.index ?? 0);
  }

  for (const m of reply.matchAll(PRODUCT_SIZE_RE)) {
    const name = m[1];
    if (PRODUCT_STOPWORDS.has(name.toLowerCase())) continue;
    if (/^\d+$/.test(name)) continue;
    push('product-size', `${name} ${m[2]}`.replace(/\s+/g, ' '), m.index ?? 0, [name, m[2]]);
  }

  return found;
}

/**
 * Lines that are making an address claim.
 *
 * Addresses are checked as whole lines rather than as extracted tokens because
 * that is how they go wrong: not one invented word, but a real address attached
 * to the wrong customer. A token-by-token check on the 5 Aug reply would have
 * passed every token individually.
 */
function addressLines(reply: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let offset = 0;
  for (const line of reply.split('\n')) {
    const trimmed = line.trim();

    // A postcode or a unit number, NOT merely a state name. Production replay
    // showed the state trigger auditing ordinary commentary — "That's a Johor
    // address, Permas Jaya area, just across the causeway" is talk ABOUT an
    // address, not a quotation of one, and it can never match a database row
    // token-for-token. Malaysian addresses on file carry a postcode, so
    // requiring one costs nothing real and removes a whole class of noise.
    //
    // The unit-number prefix must be followed by a digit: without it `no\.?`
    // matches the "No" in "Nothing pending right now…".
    const structural =
      POSTCODE_RE.test(trimmed) || /^(?:(?:no\.?|lot|unit|blok|block)\b\s*|#\s*)\d/i.test(trimmed);
    if (!structural || trimmed.length <= 12) {
      offset += line.length + 1;
      continue;
    }

    // Second gate: prose density. A quoted address is nouns and numbers; a
    // sentence about one is full of function words.
    const functionWords = (norm(trimmed).match(FUNCTION_WORD_RE) ?? []).length;
    if (functionWords < 3) out.push({ text: trimmed, at: offset });

    offset += line.length + 1;
  }
  return out;
}

/** Common words that mark a line as a sentence rather than a quoted address. */
const FUNCTION_WORD_RE =
  /\b(the|is|are|was|were|it|its|that|this|there|here|and|but|so|as|of|for|with|just|about|want|need|looks|says|has|have|had|you|your|me|my|we|our|they|their|been|would|could|should|will|shall|can|may|not|no|yes|please|let|still|only|also|which|what|when|where|why|how)\b/g;

/**
 * Which record a position in the reply is talking about.
 *
 * The nearest order number at or above it wins. Failing that, if the turn's
 * tool results named exactly one order, that is unambiguous enough to use —
 * a reply about "the order" after a single-order lookup is not attributing
 * anything to a record it never saw.
 */
function subjectAt(reply: string, at: number, index: FactIndex): string | undefined {
  let subject: string | undefined;
  for (const m of reply.matchAll(ORDER_NUMBER_RE)) {
    const pos = m.index ?? 0;
    if (pos <= at) subject = norm(m[0]);
    else break;
  }
  if (subject) return subject;

  const orderSubjects = [...index.subjects].filter((s) => /^[a-z]{2,4}\d{4} \d{4}$/.test(s));
  return orderSubjects.length === 1 ? orderSubjects[0] : undefined;
}

// ------------------------------------------------------------- preconditions

interface Precondition {
  id: string;
  /** What the reply is doing that requires evidence. */
  claim: RegExp;
  /** Any one of these having run this turn satisfies it. */
  requires: string[];
  /** How the violation reads. */
  describes: string;
}

/**
 * Claim shapes that require a tool to have run, whatever the reply says.
 *
 * This is the half of the guard that catches a false ABSENCE. "No address on
 * file" invents nothing — there is no string to look up — so only the missing
 * `get_order` gives it away. Both August incidents turned on exactly that.
 *
 * Kept as data rather than scattered `if`s so `test-grounding-unit.ts` can
 * enumerate them, and so the coverage gate in the agent suites can insist that
 * a newly added detail-bearing read tool appears in a `requires` list.
 */
export const PRECONDITIONS: Precondition[] = [
  {
    id: 'order-address',
    claim: /\b(address|addres|alamat|postcode|poskod|delivery location|shipping address)\b/i,
    requires: ['get_order', 'delivery_schedule', 'orders_awaiting_delivery', 'schedule_delivery', 'update_delivery', 'create_order'],
    describes: "an order's address (including saying it has none)",
  },
  {
    id: 'order-items',
    claim: /\b(items?|contents?|line items?|what(?:'s| is) (?:in|on) (?:the|this) order|isi)\b/i,
    requires: ['get_order', 'create_order', 'customer_report'],
    describes: "an order's line items",
  },
  {
    id: 'order-costing',
    claim: /\b(costed|costing|unit cost|profit|margin|split|share|payout)\b/i,
    requires: [
      'get_order', 'finance_overview', 'set_order_costs', 'set_order_profit_shares',
      'get_partner', 'save_partners', 'record_payout', 'sales_breakdown', 'sales_analytics',
    ],
    describes: "an order's costs or profit split",
  },
];

/**
 * Preconditions only apply when the reply is actually discussing an order.
 * Without this gate, "want me to remind someone to chase the address?" — a
 * question, about nothing — would trip the address rule.
 */
const ORDER_TOOLS = /^(get_order|list_orders|create_order|update_order|delete_order|restore_order|resend_order_email|set_order_|delivery_|schedule_delivery|update_delivery|cancel_delivery|orders_awaiting_delivery)/;

function discussingAnOrder(reply: string, toolsRan: string[]): boolean {
  ORDER_NUMBER_RE.lastIndex = 0;
  if (ORDER_NUMBER_RE.test(reply)) return true;
  return toolsRan.some((t) => ORDER_TOOLS.test(t));
}

// ------------------------------------------------------------------- the check

export function checkGrounding(input: GroundingInput): GroundingVerdict {
  const { reply, toolResults, operatorText, trustedContext } = input;
  const toolsRan = toolResults.map((t) => t.tool);
  const violations: GroundingViolation[] = [];

  // A turn that called nothing and asserted nothing is just conversation
  // ("Yes, dear?", "You got it, boss") and must stay free.
  const index = buildFactIndex(toolResults, operatorText, trustedContext);

  // ---- 1. Entities that must exist in the evidence.
  for (const entity of extractEntities(reply)) {
    const subject = subjectAt(reply, entity.at, index);

    if (entity.type === 'phone') {
      const where = numberKnown(index, subject, entity.text);
      if (where === 'no') {
        violations.push({
          kind: 'ungrounded',
          entityType: entity.type,
          entity: entity.text,
          subject,
          detail: `phone ${entity.text} is not in any tool result from this turn`,
        });
      } else if (where === 'global' && subject && index.bySubject.has(subject)) {
        violations.push({
          kind: 'cross-record',
          entityType: entity.type,
          entity: entity.text,
          subject,
          detail: `phone ${entity.text} appears in this turn's data but NOT under ${subject}`,
        });
      }
      continue;
    }

    // Multi-part entities are grounded when every part is, on the same record.
    if (entity.parts) {
      if (entity.parts.every((p) => partKnownUnder(index, subject, p))) continue;
      if (entity.parts.every((p) => partKnownGlobally(index, p))) {
        if (subject && index.bySubject.has(subject)) {
          violations.push({
            kind: 'cross-record',
            entityType: entity.type,
            entity: entity.text,
            subject,
            detail: `${entity.type} "${entity.text}" appears in this turn's data but NOT under ${subject}`,
          });
        }
        continue;
      }
      violations.push({
        kind: 'ungrounded',
        entityType: entity.type,
        entity: entity.text,
        subject,
        detail: `${entity.type} "${entity.text}" is not in any tool result from this turn`,
      });
      continue;
    }

    if (knownUnder(index, subject, entity.text)) continue;

    if (knownGlobally(index, entity.text)) {
      // Present, but filed under a different record. This is the 5 Aug failure.
      if (subject && index.bySubject.has(subject)) {
        violations.push({
          kind: 'cross-record',
          entityType: entity.type,
          entity: entity.text,
          subject,
          detail: `${entity.type} "${entity.text}" appears in this turn's data but NOT under ${subject}`,
        });
      }
      continue;
    }

    violations.push({
      kind: 'ungrounded',
      entityType: entity.type,
      entity: entity.text,
      subject,
      detail: `${entity.type} "${entity.text}" is not in any tool result from this turn`,
    });
  }

  // ---- 2. Address lines, checked whole.
  for (const line of addressLines(reply)) {
    const subject = subjectAt(reply, line.at, index);
    const tokens = norm(line.text)
      .split(' ')
      .filter((t) => t.length >= 3);
    if (tokens.length < 3) continue;

    const inSubject = subject ? tokens.filter((t) => knownUnder(index, subject, t)).length : 0;
    const inGlobal = tokens.filter((t) => knownGlobally(index, t)).length;
    const ratio = (n: number) => n / tokens.length;

    if (subject && ratio(inSubject) >= 0.7) continue;
    if (!subject && ratio(inGlobal) >= 0.7) continue;

    // Cross-record only means something when the record actually exists in this
    // turn's data. If the reply names an order the tools never returned, we
    // cannot attribute anything to it, and calling that "belongs to someone
    // else" is a claim the index cannot support either.
    if (ratio(inGlobal) >= 0.7) {
      if (!subject || !index.bySubject.has(subject)) continue;
      violations.push({
        kind: 'cross-record',
        entityType: 'address',
        entity: line.text,
        subject,
        detail: `this address is in the turn's data but does not belong to ${subject}`,
      });
    } else {
      violations.push({
        kind: 'ungrounded',
        entityType: 'address',
        entity: line.text,
        subject,
        detail: `address "${line.text}" is not supported by any tool result from this turn`,
      });
    }
  }

  // ---- 3. Claim shapes that require evidence to exist at all.
  if (discussingAnOrder(reply, toolsRan)) {
    for (const rule of PRECONDITIONS) {
      if (!rule.claim.test(reply)) continue;
      if (rule.requires.some((t) => toolsRan.includes(t))) continue;
      violations.push({
        kind: 'precondition',
        entityType: rule.id,
        entity: rule.describes,
        detail: `the reply describes ${rule.describes} but none of ${rule.requires.join(', ')} ran this turn`,
      });
    }
  }

  return { violations: dedupe(violations), toolsRan };
}

function dedupe(violations: GroundingViolation[]): GroundingViolation[] {
  const seen = new Set<string>();
  const out: GroundingViolation[] = [];
  for (const v of violations) {
    const key = `${v.kind}|${v.entityType}|${norm(v.entity)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

// ------------------------------------------------------------------- repair

/**
 * What the model is told when the guard fires.
 *
 * Repair rather than suppression, because suppression throws away a turn the
 * operator is waiting on. In both August incidents the correct tool was one
 * call away and the model reached the right answer immediately once it made it
 * — it simply never made it. This is the nudge that makes it.
 *
 * Written as an instruction from the system, never as a tool result: a tool
 * result is data the model may weigh, and this is not negotiable.
 */
export function repairInstruction(violations: GroundingViolation[]): string {
  const lines = violations.map((v) => `- ${v.detail}`).join('\n');
  return `STOP. Your draft reply states things this turn's tool results do not support:

${lines}

You are about to tell an operator something you have not checked. Do not send that.

Call the tool that establishes these facts NOW — get_order gives you an order's items, address, costs and email status; a list tool does not and never did. Then answer from what it returns.

If a tool genuinely cannot establish something, leave it out and say you have not checked it. Never assert a detail — and never assert that a detail is missing or empty — on the strength of a summary payload or of anything earlier in this conversation.`;
}

/** The backstop when repair has been tried and the reply still is not supported. */
export const GROUNDING_SUPPRESSED_REPLY =
  "I don't have that confirmed from the system, and I won't guess at it. Ask me again and I'll look it up properly.";

export function parseGroundingMode(raw: string | undefined): GroundingMode {
  return raw === 'off' || raw === 'enforce' || raw === 'shadow' ? raw : 'shadow';
}
