'use client';

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';

interface AnimateProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  variant?: 'fadeUp' | 'fadeDown' | 'fadeLeft' | 'fadeRight' | 'fade' | 'scale';
  once?: boolean;
  threshold?: number;
}

const variants: Record<string, { from: CSSProperties; to: CSSProperties }> = {
  fadeUp: {
    from: { opacity: 0, transform: 'translateY(24px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  fadeDown: {
    from: { opacity: 0, transform: 'translateY(-24px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
  fadeLeft: {
    from: { opacity: 0, transform: 'translateX(-24px)' },
    to: { opacity: 1, transform: 'translateX(0)' },
  },
  fadeRight: {
    from: { opacity: 0, transform: 'translateX(24px)' },
    to: { opacity: 1, transform: 'translateX(0)' },
  },
  fade: {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },
  scale: {
    from: { opacity: 0, transform: 'scale(0.95)' },
    to: { opacity: 1, transform: 'scale(1)' },
  },
};

// Elements default to visible; they only opt into the fade-in-on-scroll
// effect once JS confirms motion is wanted. This keeps content present for
// any tool/user that doesn't trigger IntersectionObserver — screenshot/PDF
// exporters, social-preview bots, slow connections, prefers-reduced-motion —
// instead of leaving it permanently opacity:0. A short fallback timer also
// forces visibility for anyone whose element never intersects (e.g. an
// automated full-page capture that doesn't scroll).
function usePlaysAnimation() {
  const [plays, setPlays] = useState(false);
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setPlays(!reduceMotion);
  }, []);
  return plays;
}

export function Animate({
  children,
  className,
  delay = 0,
  duration = 0.5,
  variant = 'fadeUp',
  once = true,
  threshold = 0.1,
}: AnimateProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const plays = usePlaysAnimation();

  useEffect(() => {
    if (!plays) return;
    const el = ref.current;
    if (!el) return;

    setVisible(false);
    const fallback = setTimeout(() => setVisible(true), 1500);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          clearTimeout(fallback);
          setVisible(true);
          if (once) observer.unobserve(el);
        } else if (!once) {
          setVisible(false);
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => {
      clearTimeout(fallback);
      observer.disconnect();
    };
  }, [plays, once, threshold]);

  const v = variants[variant];
  const style: CSSProperties = plays
    ? {
        ...(visible ? v.to : v.from),
        transition: `opacity ${duration}s cubic-bezier(0.16,1,0.3,1) ${delay}s, transform ${duration}s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
        willChange: 'opacity, transform',
      }
    : {};

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

interface StaggerProps {
  children: ReactNode;
  className?: string;
  stagger?: number;
  variant?: AnimateProps['variant'];
  duration?: number;
}

export function Stagger({ children, className, stagger = 0.06, variant = 'fadeUp', duration = 0.45 }: StaggerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const plays = usePlaysAnimation();

  useEffect(() => {
    if (!plays) return;
    const el = ref.current;
    if (!el) return;

    setVisible(false);
    const fallback = setTimeout(() => setVisible(true), 1500);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          clearTimeout(fallback);
          setVisible(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.05 }
    );

    observer.observe(el);
    return () => {
      clearTimeout(fallback);
      observer.disconnect();
    };
  }, [plays]);

  const v = variants[variant];

  return (
    <div ref={ref} className={className}>
      {Array.isArray(children)
        ? children.map((child, i) => {
            const style: CSSProperties = plays
              ? {
                  ...(visible ? v.to : v.from),
                  transition: `opacity ${duration}s cubic-bezier(0.16,1,0.3,1) ${i * stagger}s, transform ${duration}s cubic-bezier(0.16,1,0.3,1) ${i * stagger}s`,
                  willChange: 'opacity, transform',
                }
              : {};
            return (
              <div key={i} style={{ ...style, display: 'flex', flexDirection: 'column' }}>
                {child}
              </div>
            );
          })
        : children}
    </div>
  );
}
