import { execFile, fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from '../../../config/env.js';

// Abby's web browser: one headless Chromium on the box, reached over CDP.
//
// This file is the light half, in the API process: when the browser runs,
// who may drive it, when it sleeps, and who is watching. The heavy half —
// Playwright, its MCP server, the screencast — is browser-worker.ts, a child
// process forked when the browser wakes and ended when it sleeps, so the
// ~120 MB Playwright costs is held only while someone is browsing.
//
// The browser is not always on. The VPS has under a gigabyte to spare, so it
// starts on the first call (BROWSER_START_CMD — on the VPS a systemd unit with
// a hard memory cap) and stops after BROWSER_IDLE_MINUTES with no tool call and
// nobody watching. A browser the cap killed is noticed on the next call and
// started again.
//
// One conversation drives it at a time. A second thread asking while the first
// is mid-task would be clicking on someone else's page.

const LOCK_MS = 2 * 60_000;
const START_TIMEOUT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 50_000;
// Watching keeps it awake, but not forever: a forgotten tab must not pin
// 600 MB on a 2 GB box overnight.
const WATCH_IDLE_MS = 30 * 60_000;

export interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface BrowserTab {
  index: number;
  url: string;
  title: string;
  current: boolean;
}

export interface BrowserState {
  enabled: boolean;
  running: boolean;
  starting: boolean;
  tabs: BrowserTab[];
  /** The thread driving it, while it holds the lock. */
  owner: string | null;
  error: string | null;
}

export type ViewerEvent = { type: 'frame'; data: string; width: number; height: number } | { type: 'state'; state: BrowserState };

export type ViewerInput =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'move'; x: number; y: number }
  | { type: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { type: 'key'; key: string }
  | { type: 'text'; text: string }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload' }
  | { type: 'tab'; index: number }
  | { type: 'newtab' }
  | { type: 'closetab'; index: number };

// The IPC between this file and browser-worker.ts.
export type WorkerOp =
  | { op: 'call'; name: string; args: Record<string, unknown> }
  | { op: 'input'; input: ViewerInput; url?: string }
  | { op: 'tabs' }
  | { op: 'watch'; on: boolean }
  | { op: 'shutdown' };
export type WorkerRequest = { id: number } & WorkerOp;
export type WorkerMessage =
  | { id: number; result?: unknown; error?: string }
  | { event: 'ready'; tabs: BrowserTab[] }
  | { event: 'state'; tabs: BrowserTab[] }
  | { event: 'frame'; data: string; width: number; height: number }
  | { event: 'disconnected' };

export function browserEnabled(): boolean {
  return env.AGENT_BROWSER === 'on';
}

// ---------------------------------------------------------------- the worker

interface Worker {
  child: ChildProcess;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  next: number;
}

let worker: Worker | null = null;
let starting: Promise<Worker> | null = null;
let lastError: string | null = null;
let tabs: BrowserTab[] = [];
let owner: { threadId: string; at: number } | null = null;
let lastUse = 0;
let idleTimer: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

function workerEntry(): { file: string; execArgv: string[] } {
  // Built: dist/browser-worker.js beside dist/server.js. From source (tsx):
  // the .ts beside this file, run through tsx.
  const js = fileURLToPath(new URL('./browser-worker.js', import.meta.url));
  if (existsSync(js)) return { file: js, execArgv: [] };
  return { file: fileURLToPath(new URL('./browser-worker.ts', import.meta.url)), execArgv: ['--import', 'tsx'] };
}

function sh(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/bin/sh', ['-c', cmd], { timeout: 30_000 }, (err, _out, stderr) => (err ? reject(new Error(`${cmd}: ${stderr?.trim() || err.message}`)) : resolve()));
  });
}

async function cdpReady(): Promise<boolean> {
  try {
    const res = await fetch(`${env.BROWSER_CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function request<T>(w: Worker, req: WorkerOp, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = w.next++;
    const timer = setTimeout(() => {
      w.pending.delete(id);
      reject(new Error('The browser did not answer in time.'));
    }, timeoutMs);
    w.pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    w.child.send({ ...req, id } as WorkerRequest);
  });
}

async function start(): Promise<Worker> {
  if (!(await cdpReady())) {
    if (!env.BROWSER_START_CMD) throw new Error(`The browser is not running at ${env.BROWSER_CDP_URL} and no BROWSER_START_CMD is set.`);
    await sh(env.BROWSER_START_CMD);
    const until = Date.now() + START_TIMEOUT_MS;
    while (!(await cdpReady())) {
      if (Date.now() > until) throw new Error('The browser did not come up within 25 seconds.');
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const { file, execArgv } = workerEntry();
  const child = fork(file, [], { execArgv, env: { ...process.env, BROWSER_CDP_URL: env.BROWSER_CDP_URL }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const w: Worker = { child, pending: new Map(), next: 1 };

  return new Promise<Worker>((resolve, reject) => {
    const failStart = setTimeout(() => {
      child.kill();
      reject(new Error('The browser worker did not start within 30 seconds.'));
    }, 30_000);
    child.on('message', (m: WorkerMessage) => {
      if ('id' in m) {
        const p = w.pending.get(m.id);
        w.pending.delete(m.id);
        if (m.error !== undefined) p?.reject(new Error(m.error));
        else p?.resolve(m.result);
        return;
      }
      if (m.event === 'ready') {
        clearTimeout(failStart);
        tabs = m.tabs;
        resolve(w);
      } else if (m.event === 'state') {
        tabs = m.tabs;
        broadcastState();
      } else if (m.event === 'frame') {
        lastFrame = { type: 'frame', data: m.data, width: m.width, height: m.height };
        for (const v of viewers) v(lastFrame);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(failStart);
      for (const p of w.pending.values()) p.reject(new Error('The browser closed.'));
      w.pending.clear();
      if (worker === w) {
        worker = null;
        tabs = [];
        lastFrame = null;
        broadcastState();
      }
      reject(new Error(`The browser worker exited (${code}).`));
    });
  });
}

/** Wakes the browser if it is asleep. */
export async function ensureBrowser(): Promise<void> {
  await getWorker();
}

async function getWorker(): Promise<Worker> {
  if (!browserEnabled()) throw new Error('The browser is switched off on this server (AGENT_BROWSER).');
  if (worker?.child.connected) return worker;
  worker = null;
  if (!starting) {
    starting = start()
      .then((w) => {
        worker = w;
        lastError = null;
        if (viewers.size) void request(w, { op: 'watch', on: true }).catch(() => {});
        return w;
      })
      .catch((err) => {
        lastError = err?.message ?? String(err);
        throw err;
      })
      .finally(() => {
        starting = null;
        touch();
        broadcastState();
      });
    broadcastState();
  }
  return starting;
}

export async function stopBrowser(): Promise<void> {
  const w = worker;
  worker = null;
  owner = null;
  tabs = [];
  lastFrame = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (w) {
    await request(w, { op: 'shutdown' }, 5_000).catch(() => {});
    if (w.child.exitCode === null) w.child.kill();
  }
  if (env.BROWSER_STOP_CMD) await sh(env.BROWSER_STOP_CMD).catch((err) => (lastError = err.message));
  broadcastState();
}

/**
 * At boot. A browser still up from before a restart belongs to no one: this
 * process has no connection to it and no idle timer for it, so on the VPS it
 * would hold its memory until the next reboot. Put it to sleep; the next call
 * starts a fresh one.
 */
export async function sleepOrphanedBrowser(): Promise<boolean> {
  if (!env.BROWSER_STOP_CMD || !(await cdpReady())) return false;
  await sh(env.BROWSER_STOP_CMD);
  return true;
}

function touch() {
  lastUse = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  const check = () => {
    const quiet = Date.now() - lastUse;
    const limit = viewers.size ? WATCH_IDLE_MS : env.BROWSER_IDLE_MINUTES * 60_000;
    if (quiet >= limit) void stopBrowser();
    else idleTimer = setTimeout(check, limit - quiet).unref();
  };
  idleTimer = setTimeout(check, env.BROWSER_IDLE_MINUTES * 60_000).unref();
}

// ---------------------------------------------------------------- Abby's calls

/** One Playwright MCP tool call on behalf of a thread. Serialised: one action at a time. */
export function callBrowser(threadId: string, name: string, args: Record<string, unknown>): Promise<{ content: McpContent[]; isError: boolean }> {
  if (owner && owner.threadId !== threadId && Date.now() - owner.at < LOCK_MS) {
    return Promise.reject(new Error('The browser is busy with another conversation right now. Try again in a minute, or ask the operator to finish that one first.'));
  }
  owner = { threadId, at: Date.now() };
  const run = async () => {
    const attempt = async () => request<{ content: McpContent[]; isError: boolean }>(await getWorker(), { op: 'call', name, args });
    let out;
    try {
      out = await attempt();
    } catch (err) {
      // Killed by its memory cap, or stopped while idle between two calls:
      // start it again once. The page it was on is gone, and the result says
      // so through the URL it reports.
      if (worker?.child.connected) throw err;
      out = await attempt();
    }
    owner = { threadId, at: Date.now() };
    touch();
    return out;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---------------------------------------------------------------- live view

type Viewer = (e: ViewerEvent) => void;
const viewers = new Set<Viewer>();
let lastFrame: Extract<ViewerEvent, { type: 'frame' }> | null = null;

/** The address of the tab Abby is on — the live view follows the same one. */
export function currentUrl(): string {
  return tabs.find((t) => t.current)?.url ?? '';
}

export function browserState(): BrowserState {
  return {
    enabled: browserEnabled(),
    running: !!worker?.child.connected,
    starting: !!starting,
    tabs,
    owner: owner && Date.now() - owner.at < LOCK_MS ? owner.threadId : null,
    error: lastError,
  };
}

/** browserState with fresh tabs and their titles from the browser. */
export async function browserStateFull(): Promise<BrowserState> {
  if (worker?.child.connected) tabs = await request<BrowserTab[]>(worker, { op: 'tabs' }, 5_000).catch(() => tabs);
  return browserState();
}

function broadcastState() {
  if (!viewers.size) return;
  const state = browserState();
  for (const v of viewers) v({ type: 'state', state });
}

export function watchBrowser(fn: Viewer): () => void {
  viewers.add(fn);
  touch();
  fn({ type: 'state', state: browserState() });
  if (lastFrame && worker) fn(lastFrame);
  if (viewers.size === 1 && worker) void request(worker, { op: 'watch', on: true }).catch(() => {});
  return () => {
    viewers.delete(fn);
    if (!viewers.size && worker) void request(worker, { op: 'watch', on: false }).catch(() => {});
  };
}

/** Only the web. file:// and chrome:// would show the server, not the internet. */
export function webUrl(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`"${raw}" is not a web address.`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`Only http and https pages can be opened, not ${u.protocol}`);
  return u.toString();
}

/** The operator, driving the page from the live view. x and y are 0..1 of the frame. */
export async function viewerInput(input: ViewerInput): Promise<void> {
  const url = input.type === 'navigate' ? webUrl(input.url) : undefined;
  const w = await getWorker();
  touch();
  await request(w, { op: 'input', input, url });
}
