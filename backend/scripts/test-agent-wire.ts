/**
 * The transcript as the provider receives it. No LLM, no database, no API —
 * pure functions.
 *
 *   npm run test:agent:wire
 *
 * Every provider on the OpenAI wire refuses a request where a tool call has
 * no result or a result has no call (a 400), and the next turn rebuilds the
 * same transcript — so one broken pair takes a thread down for good, and a
 * WhatsApp thread is one per chat, forever. Three ways the store could hold
 * one, each covered here:
 *   - a compaction range that ended between a call and its result;
 *   - a restart between storing a step's calls and storing their results;
 *   - a system row (an approval made mid-run) landing between the two.
 * Plus where the compaction summary sits: at the start of the range it
 * replaced, not after the operator's newest message.
 */

// run.ts reads the environment on import; these are never used here.
process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';
process.env.JWT_SECRET ??= 'x'.repeat(32);

const { toWire, pairToolMessages, compactionEnd, unansweredToolCalls, interruptedResult } = await import('../src/modules/ai-agent/core/run.js');
type Row = { seq: number; role: string; content: any };
type Wire = ReturnType<typeof toWire>;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

// What the provider enforces: every call is answered by the tool messages
// directly after it, and every tool message answers a call directly before.
function wireProblem(wire: Wire): string | null {
  for (let i = 0; i < wire.length; i++) {
    const m = wire[i];
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const block: string[] = [];
      for (let j = i + 1; j < wire.length && wire[j].role === 'tool'; j++) block.push(wire[j].tool_call_id!);
      for (const t of m.tool_calls) if (!block.includes(t.id)) return `call ${t.id} at ${i} has no result straight after it`;
    }
    if (m.role === 'tool') {
      let k = i - 1;
      while (k >= 0 && wire[k].role === 'tool') k--;
      const call = wire[k];
      if (!call || call.role !== 'assistant' || !call.tool_calls?.some((t) => t.id === m.tool_call_id)) return `result ${m.tool_call_id} at ${i} answers no call before it`;
    }
  }
  return null;
}

// A turn: the operator asks, the model looks something up, then answers.
function turn(seq: number, n: number): Row[] {
  return [
    { seq, role: 'user', content: { text: `question ${n}` } },
    { seq: seq + 1, role: 'assistant', content: { toolCalls: [{ id: `c${n}`, name: 'get_order', input: { orderNumber: `AS-${n}` } }] } },
    { seq: seq + 2, role: 'tool', content: { toolResults: [{ id: `c${n}`, name: 'get_order', output: { orderNumber: `AS-${n}` }, isError: false, ms: 5 }] } },
    { seq: seq + 3, role: 'assistant', content: { text: `answer ${n}` } },
  ];
}
function conversation(turns: number): Row[] {
  return Array.from({ length: turns }, (_, i) => turn(1 + i * 4, i + 1)).flat();
}

console.log('▸ the compaction cut never separates a call from its result');
{
  const rows = conversation(10); // 40 rows
  for (let keep = 1; keep < rows.length - 1; keep++) {
    const to = compactionEnd(rows, keep);
    if (to === null) continue;
    const next = rows.find((r) => r.seq > to && r.role !== 'system');
    if (next?.role === 'tool') {
      check(`keep=${keep} leaves the tail opening on a result`, false, `cut at ${to}`);
      break;
    }
  }
  check('no cut leaves the kept tail opening on a tool result', fail === 0);
  // keep=14 on 40 rows lands on seq 26 — turn 7's call, whose result is 27.
  check('a cut that would land on a call moves back before it', compactionEnd(rows, 14) === 25, `got ${compactionEnd(rows, 14)}`);
  check('a cut on a turn boundary stays where it is', compactionEnd(rows, 12) === 28, `got ${compactionEnd(rows, 12)}`);

  const withApproval: Row[] = [...turn(1, 1).slice(0, 2), { seq: 3, role: 'system', content: { text: 'Fakhrul APPROVED' } }, { ...turn(1, 1)[2], seq: 4 }, { ...turn(1, 1)[3], seq: 5 }, ...turn(6, 2)];
  check('a system row between call and result is looked past', compactionEnd(withApproval, 6) === 1, `got ${compactionEnd(withApproval, 6)}`);
  check('nothing safe to compact gives null', compactionEnd(turn(1, 1).slice(1, 3), 1) === null);
}

console.log('▸ a summary written by the old cut (between call and result) still makes a valid request');
{
  const rows: Row[] = [...conversation(5), { seq: 21, role: 'system', content: { summary: 'Looked up AS-1 to AS-3.', replaces: [1, 10] } }];
  // seq 10 is turn 3's call; its result (11) stays in view with no call.
  const wire = toWire(rows);
  check('the request is well-formed', wireProblem(wire) === null, wireProblem(wire) ?? '');
  check('the orphaned result is not sent', !wire.some((m) => m.role === 'tool' && m.tool_call_id === 'c3'));
  check('the rest of the kept tail is', wire.some((m) => m.role === 'tool' && m.tool_call_id === 'c4') && wire.some((m) => m.content === 'answer 5'));
}

console.log('▸ the summary sits where its range began');
{
  const rows: Row[] = [
    ...conversation(5),
    { seq: 21, role: 'system', content: { summary: '(superseded)', replaces: [0, 0] } },
    { seq: 22, role: 'system', content: { summary: 'Looked up AS-1 and AS-2.', replaces: [1, 8] } },
    { seq: 23, role: 'user', content: { text: 'and the next one?' } },
  ];
  const wire = toWire(rows);
  const summaryAt = wire.findIndex((m) => m.role === 'system' && m.content?.includes('Looked up AS-1 and AS-2.'));
  check('it is the first message', summaryAt === 0, `at ${summaryAt}: ${JSON.stringify(wire.map((m) => m.role))}`);
  check('it comes before the operator’s newest message', summaryAt < wire.findIndex((m) => m.content === 'and the next one?'));
  check('the range it replaced is not sent', !wire.some((m) => m.content === 'question 1' || m.content === 'answer 2'));
  check('a superseded summary is not sent', !wire.some((m) => m.content?.includes('(superseded)')));
  check('it is sent once', wire.filter((m) => m.content?.includes('Looked up AS-1')).length === 1);
  check('the request is well-formed', wireProblem(wire) === null, wireProblem(wire) ?? '');
}

console.log('▸ a turn cut off by a restart');
{
  const cut: Row[] = [
    ...conversation(2),
    { seq: 9, role: 'user', content: { text: 'mark AS-9 paid and check stock' } },
    {
      seq: 10,
      role: 'assistant',
      content: {
        toolCalls: [
          { id: 'w1', name: 'update_order', input: {} },
          { id: 'r1', name: 'list_low_stock', input: {} },
        ],
      },
    },
  ];
  const before = toWire(cut);
  check('before repair the request is still well-formed', wireProblem(before) === null, wireProblem(before) ?? '');
  check('the unanswered calls are not sent', !before.some((m) => m.tool_calls?.some((t) => t.id === 'w1')));

  const open = unansweredToolCalls(cut);
  check('both unanswered calls are found', open.map((c) => c.id).join() === 'w1,r1', JSON.stringify(open));
  check('answered calls in earlier turns are not', !open.some((c) => c.id === 'c1' || c.id === 'c2'));

  const repaired: Row[] = [
    ...cut,
    { seq: 11, role: 'tool', content: { toolResults: open.map((c) => ({ id: c.id, name: c.name, ...interruptedResult(c.name, undefined), ms: 0 })) } },
    { seq: 12, role: 'system', content: { text: 'The server restarted in the middle of this reply, so it stopped here.' } },
  ];
  const after = toWire(repaired);
  check('after repair the calls go out with their results', wireProblem(after) === null && after.some((m) => m.tool_call_id === 'w1'), wireProblem(after) ?? '');
  check('nothing is left unanswered', unansweredToolCalls(repaired).length === 0);
}

console.log('▸ what the model is told about a cut-off call');
{
  const none = interruptedResult('update_order', undefined);
  check('a write with no record: may or may not have happened', none.isError && /may or may not/.test((none.output as any).error));
  const read = interruptedResult('list_low_stock', undefined);
  check('a read with no record: run it again', read.isError && /Run it again/.test((read.output as any).error));
  const done = interruptedResult('update_order', { id: 'a', status: 'done', output: { orderNumber: 'AS-9', status: 'PAID' }, error: null, summary: null });
  check('a finished write: its real result', !done.isError && (done.output as any).status === 'PAID');
  const failed = interruptedResult('update_order', { id: 'a', status: 'failed', output: null, error: 'Order not found', summary: null });
  check('a failed write: its real error', failed.isError && (failed.output as any).error === 'Order not found');
  const pending = interruptedResult('delete_product', { id: 'a', status: 'pending', output: null, error: null, summary: 'Delete BPC-157 5mg' });
  check('a parked action: still waiting on approval', !pending.isError && (pending.output as any).pending === true && (pending.output as any).wouldDo === 'Delete BPC-157 5mg');
}

console.log('▸ a system row between a call and its result');
{
  const rows: Row[] = [
    { seq: 1, role: 'user', content: { text: 'delete it' } },
    { seq: 2, role: 'assistant', content: { toolCalls: [{ id: 'd1', name: 'get_order', input: {} }] } },
    { seq: 3, role: 'system', content: { text: 'Fakhrul APPROVED "Delete AS-1".' } },
    { seq: 4, role: 'tool', content: { toolResults: [{ id: 'd1', name: 'get_order', output: {}, isError: false, ms: 1 }] } },
    { seq: 5, role: 'assistant', content: { text: 'done' } },
  ];
  const wire = toWire(rows);
  check('the result is moved straight after its call', wireProblem(wire) === null && wire[2].role === 'tool', JSON.stringify(wire.map((m) => m.role)));
  check('the system row is kept', wire.some((m) => m.content?.includes('APPROVED')));
}

console.log('▸ calls that keep some results');
{
  const wire = pairToolMessages([
    { role: 'user', content: 'x' },
    {
      role: 'assistant',
      content: 'checking',
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'get_order', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'get_order', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'a', content: '{}' },
  ]);
  check('only the answered call is sent', wire[1].tool_calls?.map((t) => t.id).join() === 'a' && wireProblem(wire) === null);
  const bare = pairToolMessages([
    { role: 'user', content: 'x' },
    { role: 'assistant', content: 'checking', tool_calls: [{ id: 'z', type: 'function', function: { name: 'get_order', arguments: '{}' } }] },
  ]);
  check('a call with none keeps its text and drops the call', bare.length === 2 && bare[1].content === 'checking' && !bare[1].tool_calls);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
