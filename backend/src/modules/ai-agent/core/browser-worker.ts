// Abby's browser, the heavy half — run as a child of the API (core/browser.ts
// forks it when the browser wakes and ends it when the browser sleeps).
//
// Playwright costs ~120 MB the moment it is imported and gives none of it
// back. In the API process that would be ~120 MB held from the first browse
// until the next deploy, on a 2 GB box. Here it lives exactly as long as the
// browser does.
//
// Two connections to the same Chromium over CDP: Playwright's own MCP server
// (@playwright/mcp, in-process over an in-memory transport) for Abby's tools —
// its accessibility snapshots with element refs are what let a text-only
// model click the right thing — and a plain Playwright connection for the live
// view: a screencast of the page Abby is on, and the operator's own input.
//
// Speaks to the parent over Node IPC: see WorkerRequest / WorkerMessage.
import os from 'node:os';
import path from 'node:path';
import { createConnection } from '@playwright/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { chromium, type CDPSession, type Page } from 'playwright-core';
import type { BrowserTab, McpContent, ViewerInput, WorkerMessage, WorkerRequest } from './browser.js';

const CDP_URL = process.env.BROWSER_CDP_URL || 'http://127.0.0.1:9222';
const CALL_TIMEOUT_MS = 40_000;

const send = (m: WorkerMessage) => process.send?.(m);

const pw = await chromium.connectOverCDP(CDP_URL, { timeout: 15_000 });
const context = pw.contexts()[0] ?? (await pw.newContext());
const server = await createConnection(
  {
    browser: { cdpEndpoint: CDP_URL, cdpTimeout: 15_000 },
    capabilities: ['core', 'core-navigation', 'core-tabs', 'core-input', 'vision'],
    codegen: 'none',
    imageResponses: 'allow',
    // After an action Playwright would write the page to a .yml file on the
    // server and hand the model its path. Abby reads pages with
    // browser_snapshot instead, which returns them inline.
    snapshot: { mode: 'none' },
    outputDir: path.join(os.tmpdir(), 'abby-browser-files'),
    outputMaxSize: 20 * 1024 * 1024,
    timeouts: { action: 10_000, navigation: 30_000 },
  },
  // The MCP server gets the very context the live view watches, so what the
  // operator sees is the page Abby is acting on.
  async () => context
);
const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'ascend-abby', version: '1.0.0' });
await client.connect(clientSide);

pw.on('disconnected', () => {
  send({ event: 'disconnected' });
  process.exit(0);
});
// The parent went away (a deploy, a crash): nothing will ever ask again.
process.on('disconnect', () => process.exit(0));

// ---------------------------------------------------------------- tabs

let current: Page | null = null;
let watching = false;
let cast: { page: Page; session: CDPSession } | null = null;
let frameSize = { w: 1280, h: 800 };
const watched = new WeakSet<Page>();

async function tabs(withTitles: boolean): Promise<BrowserTab[]> {
  return Promise.all(
    context.pages().map(async (p, index) => ({
      index,
      url: p.url(),
      title: withTitles ? await p.title().catch(() => '') : '',
      current: p === current,
    }))
  );
}

function announce() {
  void tabs(true).then((t) => send({ event: 'state', tabs: t }));
}

function watchPage(p: Page) {
  if (watched.has(p)) return;
  watched.add(p);
  p.on('framenavigated', (f) => {
    if (f === p.mainFrame()) announce();
  });
  p.on('close', () => {
    if (current === p) follow(context.pages().at(-1) ?? null);
    announce();
  });
}

function follow(p: Page | null) {
  if (p) watchPage(p);
  if (p === current) return;
  current = p;
  if (watching && p) void startScreencast(p);
}

context.on('page', (p) => {
  follow(p);
  announce();
});
for (const p of context.pages()) watchPage(p);
if (!context.pages().length) await context.newPage();
follow(context.pages().at(-1) ?? null);

// Playwright MCP reports the tab it is on when it changes ("- Page URL:").
// The live view follows it, so the operator watches what Abby is doing rather
// than whichever tab opened last.
function syncCurrent(content: McpContent[]) {
  const text = content.map((c) => c.text ?? '').join('\n');
  const url = text.match(/^- Page URL: (\S+)/m)?.[1];
  const page = url ? context.pages().find((p) => p.url() === url) : null;
  if (page) follow(page);
}

// ---------------------------------------------------------------- live view

async function startScreencast(page: Page) {
  stopScreencast();
  try {
    const session = await page.context().newCDPSession(page);
    cast = { page, session };
    session.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }) => {
      void session.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      if (cast?.session !== session) return;
      frameSize = { w: Math.round(f.metadata.deviceWidth), h: Math.round(f.metadata.deviceHeight) };
      send({ event: 'frame', data: f.data, width: frameSize.w, height: frameSize.h });
    });
    await page.bringToFront().catch(() => {});
    await session.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  } catch {
    cast = null;
  }
}

function stopScreencast() {
  const c = cast;
  cast = null;
  if (c) void c.session.send('Page.stopScreencast').catch(() => {}).then(() => c.session.detach().catch(() => {}));
}

async function input(i: ViewerInput, url?: string): Promise<void> {
  const page = current ?? context.pages().at(-1) ?? (await context.newPage());
  const at = (p: { x: number; y: number }) => [Math.max(0, Math.min(1, p.x)) * frameSize.w, Math.max(0, Math.min(1, p.y)) * frameSize.h] as const;
  switch (i.type) {
    case 'click': {
      const [x, y] = at(i);
      await page.mouse.click(x, y, { button: i.button ?? 'left' });
      break;
    }
    case 'move': {
      const [x, y] = at(i);
      await page.mouse.move(x, y);
      break;
    }
    case 'wheel': {
      const [x, y] = at(i);
      await page.mouse.move(x, y);
      await page.mouse.wheel(i.dx, i.dy);
      break;
    }
    case 'key':
      await page.keyboard.press(i.key);
      break;
    case 'text':
      await page.keyboard.insertText(String(i.text).slice(0, 2000));
      break;
    case 'navigate':
      // `url` was checked by the parent (webUrl): http and https only.
      await page.goto(url!, { timeout: 30_000 }).catch((err) => {
        throw new Error(err?.message?.split('\n')[0] ?? 'Could not open that page');
      });
      break;
    case 'back':
      await page.goBack({ timeout: 15_000 }).catch(() => {});
      break;
    case 'forward':
      await page.goForward({ timeout: 15_000 }).catch(() => {});
      break;
    case 'reload':
      await page.reload({ timeout: 30_000 }).catch(() => {});
      break;
    case 'tab': {
      const p = context.pages()[i.index];
      if (p) follow(p);
      break;
    }
    case 'newtab':
      follow(await context.newPage());
      break;
    case 'closetab': {
      const p = context.pages()[i.index];
      // The last tab stays: closing it would leave nothing to screencast.
      if (p && context.pages().length > 1) await p.close();
      break;
    }
  }
  announce();
}

// ---------------------------------------------------------------- requests

process.on('message', async (m: WorkerRequest) => {
  const reply = (r: { result?: unknown; error?: string }) => send({ id: m.id, ...r });
  try {
    switch (m.op) {
      case 'call': {
        const res: any = await client.callTool({ name: m.name, arguments: m.args }, undefined, { timeout: CALL_TIMEOUT_MS });
        const content = (res?.content ?? []) as McpContent[];
        syncCurrent(content);
        announce();
        return reply({ result: { content, isError: !!res?.isError } });
      }
      case 'input':
        await input(m.input, m.url);
        return reply({ result: true });
      case 'tabs':
        return reply({ result: await tabs(true) });
      case 'watch':
        watching = m.on;
        if (watching && current) await startScreencast(current);
        if (!watching) stopScreencast();
        return reply({ result: true });
      case 'shutdown':
        stopScreencast();
        await client.close().catch(() => {});
        await pw.close().catch(() => {});
        reply({ result: true });
        return process.exit(0);
    }
  } catch (err: any) {
    reply({ error: err?.message ?? String(err) });
  }
});

send({ event: 'ready', tabs: await tabs(true) });
