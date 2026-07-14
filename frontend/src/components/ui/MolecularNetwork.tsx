'use client';

import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const NODE_COUNT = 50;
const CONNECTION_DIST = 220;
const SPEED = 0.35;
const DOT_RADIUS = 2;
const LINE_OPACITY = 0.22;
const DOT_OPACITY = 0.4;
const TARGET_FPS = 30;
const FRAME_INTERVAL = 1000 / TARGET_FPS;

export function MolecularNetwork({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const rafRef = useRef<number>(0);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Purely decorative — skip entirely for reduced-motion users, and don't
    // let it compete with LCP-critical rendering during initial page load.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let w = 0;
    let h = 0;
    let running = true;

    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      if (!rect) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const initNodes = () => {
      nodesRef.current = Array.from({ length: NODE_COUNT }, () => ({
        x: Math.random() * (w || 800),
        y: Math.random() * (h || 600),
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
      }));
    };

    const draw = (timestamp: number) => {
      if (!running) return;
      rafRef.current = requestAnimationFrame(draw);

      // Throttle to ~30fps — this is ambient background decoration, not
      // something that needs 60fps, and halving frame count roughly halves
      // the O(n²) pairwise-distance cost below.
      if (timestamp - lastFrameRef.current < FRAME_INTERVAL) return;
      lastFrameRef.current = timestamp;

      if (!ctx || !w || !h) return;
      ctx.clearRect(0, 0, w, h);

      const nodes = nodesRef.current;

      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        if (node.x < -20) { node.x = -20; node.vx *= -1; }
        if (node.x > w + 20) { node.x = w + 20; node.vx *= -1; }
        if (node.y < -20) { node.y = -20; node.vy *= -1; }
        if (node.y > h + 20) { node.y = h + 20; node.vy *= -1; }
      }

      ctx.lineWidth = 0.8;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const opacity = LINE_OPACITY * (1 - dist / CONNECTION_DIST);
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      ctx.fillStyle = `rgba(255, 255, 255, ${DOT_OPACITY})`;
      for (const node of nodes) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    // Pause the animation loop entirely while the hero is scrolled out of
    // view — no point spending CPU animating something off-screen.
    const io = new IntersectionObserver(([entry]) => {
      running = entry.isIntersecting;
      if (running) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
      } else {
        cancelAnimationFrame(rafRef.current);
      }
    });
    io.observe(canvas);

    // Defer the first frame until the browser is idle (or a short timeout
    // fallback) so this decorative animation doesn't compete with
    // LCP-critical rendering during initial page load.
    const start = () => {
      resize();
      initNodes();
      rafRef.current = requestAnimationFrame(draw);
    };
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(start, { timeout: 2000 });
    } else {
      timeoutId = setTimeout(start, 200);
    }

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      io.disconnect();
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${className}`}
      aria-hidden="true"
    />
  );
}
