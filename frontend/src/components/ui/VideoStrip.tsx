'use client';

import { useRef, useEffect } from 'react';

interface VideoStripProps {
  src: string;
  height?: string;
  overlay?: number;
}

export function VideoStrip({ src, height = '140px', overlay = 0.4 }: VideoStripProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="metadata"
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src={src} type="video/mp4" />
      </video>
      <div
        className="absolute inset-0 bg-primary"
        style={{ opacity: overlay }}
      />
    </div>
  );
}
