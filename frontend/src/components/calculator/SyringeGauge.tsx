interface SyringeGaugeProps {
  /** Draw line, in syringe units (U-100 insulin syringe: 100 units = 1mL). */
  units: number | null;
}

const MAX_UNITS = 100;
const GAUGE_START = 48;
const GAUGE_END = 652;
const GAUGE_WIDTH = GAUGE_END - GAUGE_START;
const BARREL_TOP = 48;
const BARREL_H = 44;
const CALLOUT_W = 84;

export function SyringeGauge({ units }: SyringeGaugeProps) {
  const clamped = units !== null ? Math.min(Math.max(units, 0), MAX_UNITS) : 0;
  const fillWidth = (clamped / MAX_UNITS) * GAUGE_WIDTH;
  const drawX = GAUGE_START + fillWidth;
  const overCapacity = units !== null && units > MAX_UNITS;
  // Keep the value tag inside the drawing at either end of the scale.
  const calloutX = Math.min(Math.max(drawX - CALLOUT_W / 2, 0), 700 - CALLOUT_W);

  const ticks = Array.from({ length: MAX_UNITS + 1 }, (_, i) => i);

  return (
    <div className="w-full">
      <svg viewBox="0 0 700 140" className="w-full h-auto" role="img" aria-label={units !== null ? `Draw syringe to ${units.toFixed(2)} units` : 'Syringe gauge'}>
        {/* Thumb rest, plunger rod, finger flange */}
        <rect x="0" y={BARREL_TOP + 8} width="10" height={BARREL_H - 16} rx="2" fill="var(--color-border-hover)" />
        <rect x="10" y={BARREL_TOP + BARREL_H / 2 - 4} width={GAUGE_START - 10} height="8" fill="var(--color-border)" />
        <rect x={GAUGE_START - 8} y={BARREL_TOP - 10} width="8" height={BARREL_H + 20} rx="2" fill="var(--color-border-hover)" />

        {/* Barrel */}
        <rect x={GAUGE_START} y={BARREL_TOP} width={GAUGE_WIDTH} height={BARREL_H} rx="6" fill="var(--color-surface)" stroke="var(--color-border-hover)" strokeWidth="1.5" />

        {/* Fill */}
        {clamped > 0 && (
          <rect x={GAUGE_START} y={BARREL_TOP} width={fillWidth} height={BARREL_H} rx="6" fill="var(--color-primary)" fillOpacity="0.1" />
        )}

        {/* Tick marks */}
        {ticks.map((t) => {
          const x = GAUGE_START + (t / MAX_UNITS) * GAUGE_WIDTH;
          const major = t % 10 === 0;
          const mid = t % 5 === 0;
          return (
            <line
              key={t}
              x1={x}
              y1={BARREL_TOP}
              x2={x}
              y2={BARREL_TOP + (major ? 16 : mid ? 11 : 7)}
              stroke="var(--color-text-muted)"
              strokeWidth={major ? 1.5 : 1}
            />
          );
        })}

        {/* Major labels */}
        {ticks
          .filter((t) => t % 10 === 0)
          .map((t) => {
            const x = GAUGE_START + (t / MAX_UNITS) * GAUGE_WIDTH;
            return (
              <text key={t} x={x} y={BARREL_TOP + BARREL_H + 30} textAnchor="middle" fontSize="20" fontWeight={500} fill="var(--color-text-secondary)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {t}
              </text>
            );
          })}

        {/* Needle hub + needle */}
        <path d={`M${GAUGE_END} ${BARREL_TOP + 10} L${GAUGE_END + 18} ${BARREL_TOP + 16} L${GAUGE_END + 18} ${BARREL_TOP + BARREL_H - 16} L${GAUGE_END} ${BARREL_TOP + BARREL_H - 10} Z`} fill="var(--color-border-hover)" />
        <line x1={GAUGE_END + 18} y1={BARREL_TOP + BARREL_H / 2} x2="700" y2={BARREL_TOP + BARREL_H / 2} stroke="var(--color-text-muted)" strokeWidth="2" />

        {/* Draw line + value tag */}
        {units !== null && (
          <>
            <line x1={drawX} y1={BARREL_TOP - 8} x2={drawX} y2={BARREL_TOP + BARREL_H + 6} stroke="var(--color-primary)" strokeWidth="2.5" />
            <rect x={calloutX} y="2" width={CALLOUT_W} height="32" rx="6" fill="var(--color-primary)" />
            <text x={calloutX + CALLOUT_W / 2} y="24" textAnchor="middle" fontSize="18" fontWeight={600} fill="white" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {units.toFixed(1)} u
            </text>
          </>
        )}
      </svg>

      {overCapacity && (
        <p className="text-sm text-danger text-center mt-2">
          This exceeds a standard 100-unit (1mL) syringe. Use a larger syringe, or increase your water volume to lower the concentration.
        </p>
      )}
    </div>
  );
}
