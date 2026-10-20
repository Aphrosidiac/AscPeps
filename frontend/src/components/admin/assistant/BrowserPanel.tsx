'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Maximize2, Minimize2, MousePointer2, Plus, Power, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { browserInput, errorMessage, setBrowserAwake, streamBrowser, type BrowserInput, type BrowserState } from '@/lib/assistant';

// Abby's browser, live. The page she is on streams in as it changes; the
// address bar, the tabs, and — once the operator takes control — their own
// clicks, scrolling and typing go straight to it. That is also how a site
// that needs a login gets one: the operator signs in here themselves, and
// the password never passes through the conversation.

const KEYS = new Set([
  'Enter', 'Backspace', 'Tab', 'Escape', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function BrowserPanel({
  token,
  expanded,
  onExpand,
  onClose,
  onNotice,
}: {
  token: string;
  expanded: boolean;
  onExpand: () => void;
  onClose: () => void;
  onNotice: (kind: 'ok' | 'bad', text: string) => void;
}) {
  const [state, setState] = useState<BrowserState | null>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [control, setControl] = useState(false);
  const [address, setAddress] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const img = useRef<HTMLImageElement | null>(null);
  const screen = useRef<HTMLDivElement | null>(null);
  const typed = useRef('');
  const typeTimer = useRef<number | null>(null);
  const lastMove = useRef(0);
  const wheel = useRef({ dy: 0, dx: 0, x: 0.5, y: 0.5, timer: 0 as number | 0 });

  // Frames go straight into the <img>: ten re-renders a second of the whole
  // panel would be paid for by the transcript beside it.
  useEffect(
    () =>
      streamBrowser(
        token,
        (f) => {
          if (img.current) img.current.src = `data:image/jpeg;base64,${f.data}`;
          setHasFrame(true);
        },
        (s) => {
          setState(s);
          if (!s.running) setHasFrame(false);
        }
      ),
    [token]
  );

  const current = state?.tabs.find((t) => t.current) ?? null;
  // The address bar shows the page until the operator starts typing in it.
  const shownUrl = current?.url && current.url !== 'about:blank' ? current.url : '';

  const send = useCallback(
    (input: BrowserInput) => {
      browserInput(token, input).catch((e) => onNotice('bad', errorMessage(e)));
    },
    [token, onNotice]
  );

  const flushTyped = useCallback(() => {
    if (typeTimer.current) window.clearTimeout(typeTimer.current);
    typeTimer.current = null;
    const text = typed.current;
    typed.current = '';
    if (text) send({ type: 'text', text });
  }, [send]);

  // Where on the page a pointer event landed, as 0..1 of the frame. The
  // <img> is sized to the frame's aspect, so its box is the page.
  const at = (e: { clientX: number; clientY: number }) => {
    const r = img.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  const wake = (awake: boolean) => {
    setBusy(true);
    setBrowserAwake(token, awake)
      .then(setState)
      .catch((e) => onNotice('bad', errorMessage(e)))
      .finally(() => setBusy(false));
  };

  const running = !!state?.running;
  const status = !state
    ? 'Connecting…'
    : !state.enabled
      ? 'Switched off on this server'
      : state.starting
        ? 'Waking up…'
        : !running
          ? 'Asleep — wakes when Abby browses'
          : state.owner
            ? 'Abby is browsing'
            : control
              ? 'You have control'
              : 'Live · view only';

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-semibold leading-5 text-text-primary">Browser</p>
          <p className="flex items-center gap-1.5 truncate text-[12px] leading-4 text-text-secondary">
            <span
              className={cn(
                'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                running ? (state?.owner ? 'animate-pulse bg-success' : 'bg-success') : state?.starting ? 'animate-pulse bg-warning' : 'bg-border-hover'
              )}
            />
            {status}
          </p>
        </div>
        <button
          aria-pressed={control}
          disabled={!running}
          onClick={() => {
            setControl((c) => !c);
            if (!control) setTimeout(() => screen.current?.focus(), 0);
          }}
          className={cn(
            'press inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium disabled:opacity-50',
            control ? 'border-primary bg-primary text-white' : 'border-border text-text-primary hover:bg-surface-elevated'
          )}
        >
          <MousePointer2 className="h-4 w-4" strokeWidth={1.75} /> <span className="hidden sm:inline">{control ? 'In control' : 'Take control'}</span>
        </button>
        <button
          disabled={busy || !state?.enabled || !!state?.starting}
          onClick={() => wake(!running)}
          aria-label={running ? 'Put the browser to sleep' : 'Wake the browser'}
          title={running ? 'Put the browser to sleep' : 'Wake the browser'}
          className="press grid h-8 w-8 place-items-center rounded-lg border border-border text-text-secondary hover:bg-surface-elevated hover:text-text-primary disabled:opacity-50"
        >
          <Power className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          onClick={onExpand}
          aria-label={expanded ? 'Shrink' : 'Expand'}
          title={expanded ? 'Shrink' : 'Expand'}
          className="press hidden h-8 w-8 place-items-center rounded-lg border border-border text-text-secondary hover:bg-surface-elevated hover:text-text-primary lg:grid"
        >
          {expanded ? <Minimize2 className="h-4 w-4" strokeWidth={1.75} /> : <Maximize2 className="h-4 w-4" strokeWidth={1.75} />}
        </button>
        <button
          onClick={onClose}
          aria-label="Close"
          className="press grid h-9 w-9 place-items-center rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
        >
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-surface-elevated px-2 py-1.5">
        {(state?.tabs ?? []).map((t) => (
          <div
            key={t.index}
            className={cn(
              'group flex h-7 max-w-[200px] shrink-0 items-center gap-1 rounded-md pl-2.5 pr-1 text-[12px] leading-4',
              t.current ? 'bg-surface text-text-primary shadow-[0_0_0_1px_var(--color-border)]' : 'text-text-secondary hover:bg-surface/70'
            )}
          >
            <button className="min-w-0 flex-1 truncate text-left" onClick={() => send({ type: 'tab', index: t.index })} title={t.url}>
              {t.title || (t.url === 'about:blank' ? 'New tab' : hostOf(t.url))}
            </button>
            {(state?.tabs.length ?? 0) > 1 && (
              <button
                onClick={() => send({ type: 'closetab', index: t.index })}
                aria-label="Close tab"
                className="grid h-5 w-5 shrink-0 place-items-center rounded text-text-muted opacity-0 hover:bg-surface-elevated hover:text-text-primary group-hover:opacity-100"
              >
                <X className="h-3 w-3" strokeWidth={2} />
              </button>
            )}
          </div>
        ))}
        <button
          disabled={!state?.enabled}
          onClick={() => send({ type: 'newtab' })}
          aria-label="New tab"
          className="press grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-secondary hover:bg-surface hover:text-text-primary disabled:opacity-50"
        >
          <Plus className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {/* Address bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        {(
          [
            ['back', ArrowLeft, 'Back'],
            ['forward', ArrowRight, 'Forward'],
            ['reload', RotateCw, 'Reload'],
          ] as const
        ).map(([type, Icon, label]) => (
          <button
            key={type}
            disabled={!running}
            onClick={() => send({ type })}
            aria-label={label}
            className="press grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-secondary hover:bg-surface-elevated hover:text-text-primary disabled:opacity-40"
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ))}
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            const url = address.trim();
            if (!url) return;
            setEditing(false);
            (document.activeElement as HTMLElement | null)?.blur();
            send({ type: 'navigate', url });
          }}
        >
          <input
            value={editing ? address : shownUrl}
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => {
              setAddress(shownUrl);
              setEditing(true);
              const el = e.currentTarget;
              requestAnimationFrame(() => el.select());
            }}
            onBlur={() => setEditing(false)}
            disabled={!state?.enabled}
            aria-label="Address"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={running ? 'Type an address' : status}
            className="h-8 w-full rounded-md border border-border bg-surface-elevated px-3 text-[13px] text-text-primary outline-none placeholder:text-text-muted focus:border-text-secondary focus:bg-surface"
          />
        </form>
      </div>
      {state?.error && !running && <p className="shrink-0 border-b border-border px-4 py-1.5 text-[12px] leading-4 text-danger">{state.error}</p>}

      {/* The page */}
      <div
        ref={screen}
        tabIndex={control ? 0 : -1}
        className={cn(
          'relative grid min-h-0 flex-1 content-start justify-items-center overflow-hidden bg-surface-elevated p-2 outline-none',
          control && 'ring-2 ring-inset ring-primary'
        )}
        onKeyDown={(e) => {
          if (!control) return;
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return; // paste arrives as onPaste
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            typed.current += e.key;
            if (typeTimer.current) window.clearTimeout(typeTimer.current);
            typeTimer.current = window.setTimeout(flushTyped, 120);
            return;
          }
          const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.metaKey && 'Meta', e.shiftKey && e.key.length > 1 && 'Shift'].filter(Boolean);
          if (KEYS.has(e.key) || (mods.length && e.key.length === 1)) {
            e.preventDefault();
            flushTyped();
            send({ type: 'key', key: [...mods, e.key].join('+') });
          }
        }}
        onPaste={(e) => {
          if (!control) return;
          e.preventDefault();
          flushTyped();
          send({ type: 'text', text: e.clipboardData.getData('text') });
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={img}
          alt={current ? `The page Abby's browser is on: ${current.title || current.url}` : "Abby's browser"}
          draggable={false}
          className={cn(
            'block h-auto max-h-full w-auto max-w-full select-none rounded-[6px] bg-white shadow-[0_0_0_1px_var(--color-border)]',
            !hasFrame && 'invisible',
            control ? 'cursor-default' : 'cursor-not-allowed'
          )}
          onMouseDown={(e) => {
            if (!control) return;
            e.preventDefault();
            screen.current?.focus();
          }}
          onClick={(e) => {
            const p = at(e);
            if (!control || !p) return;
            flushTyped();
            send({ type: 'click', ...p });
          }}
          onContextMenu={(e) => {
            const p = at(e);
            if (!control || !p) return;
            e.preventDefault();
            send({ type: 'click', ...p, button: 'right' });
          }}
          onMouseMove={(e) => {
            const p = at(e);
            if (!control || !p || Date.now() - lastMove.current < 200) return;
            lastMove.current = Date.now();
            send({ type: 'move', ...p });
          }}
          onWheel={(e) => {
            const p = at(e);
            if (!control || !p) return;
            const w = wheel.current;
            w.dy += e.deltaY;
            w.dx += e.deltaX;
            w.x = p.x;
            w.y = p.y;
            if (w.timer) return;
            w.timer = window.setTimeout(() => {
              send({ type: 'wheel', x: w.x, y: w.y, dx: w.dx, dy: w.dy });
              w.dx = 0;
              w.dy = 0;
              w.timer = 0;
            }, 90);
          }}
        />
      </div>
    </div>
  );
}
