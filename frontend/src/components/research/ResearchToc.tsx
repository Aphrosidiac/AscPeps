'use client';

import { useEffect, useRef } from 'react';

// "On this page": folded in the HTML (phones keep it that way, so nothing
// shifts), opened on wide screens where it sits in its own column and is
// sticky, with the section in view marked.
export function ResearchToc({ items }: { items: { id: string; text: string }[] }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const toc = ref.current;
    if (!toc) return;
    const wide = matchMedia('(min-width: 1100px)');
    const sync = () => (toc.open = wide.matches);
    sync();
    wide.addEventListener('change', sync);
    const summary = toc.querySelector('summary');
    const hold = (e: Event) => wide.matches && e.preventDefault();
    summary?.addEventListener('click', hold);

    const links = new Map([...toc.querySelectorAll<HTMLAnchorElement>('a')].map((a) => [decodeURIComponent(a.hash.slice(1)), a]));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          for (const a of links.values()) a.removeAttribute('aria-current');
          links.get(e.target.id)?.setAttribute('aria-current', 'true');
        }
      },
      { rootMargin: '0px 0px -70% 0px' }
    );
    for (const id of links.keys()) {
      const h = document.getElementById(id);
      if (h) io.observe(h);
    }
    return () => {
      wide.removeEventListener('change', sync);
      summary?.removeEventListener('click', hold);
      io.disconnect();
    };
  }, [items]);

  return (
    <nav className="rs-post__toc" aria-labelledby="toc-h">
      <details className="rs-toc" ref={ref}>
        <summary id="toc-h" className="rs-toc__h">On this page</summary>
        <ol>
          {items.map((h) => (
            <li key={h.id}>
              <a href={`#${h.id}`}>{h.text}</a>
            </li>
          ))}
        </ol>
      </details>
    </nav>
  );
}
