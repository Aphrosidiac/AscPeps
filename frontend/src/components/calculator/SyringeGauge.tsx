interface SyringeGaugeProps {
  /** Draw line, in syringe units (U-100 insulin syringe: 100 units = 1mL). */
  units: number | null;
}

const MAX_UNITS = 100;
const GAUGE_START = 40;
const GAUGE_END = 660;
const GAUGE_WIDTH = GAUGE_END - GAUGE_START;

export function SyringeGauge({ units }: SyringeGaugeProps) {
  const clamped = units !== null ? Math.min(Math.max(units, 0), MAX_UNITS) : 0;
  const fillWidth = (clamped / MAX_UNITS) * GAUGE_WIDTH;
  const overCapacity = units !== null && units > MAX_UNITS;

  const ticks = Array.from({ length: MAX_UNITS + 1 }, (_, i) => i);

  return (
    <div className="w-full">
      <svg viewBox="0 0 700 140" className="w-full h-auto" role="img" aria-label={units !== null ? `Draw syringe to ${units.toFixed(2)} units` : 'Syringe gauge'}>
        {/* Plunger + flange */}
        <rect x="0" y="45" width="40" height="30" rx="2" fill="var(--color-text-muted)" />
        <rect x="30" y="30" width="14" height="60" rx="2" fill="var(--color-text-secondary)" />

        {/* Barrel outline */}
        <rect x={GAUGE_START} y="38" width={GAUGE_WIDTH} height="44" rx="4" fill="var(--color-surface)" stroke="var(--color-border-hover)" strokeWidth="2" />

        {/* Fill */}
        {clamped > 0 && (
          <rect x={GAUGE_START} y="38" width={fillWidth} height="44" rx="4" fill="var(--color-primary)" fillOpacity="0.18" />
        )}

        {/* Draw line */}
        {units !== null && (
          <line
            x1={GAUGE_START + fillWidth}
            y1="30"
            x2={GAUGE_START + fillWidth}
            y2="90"
            stroke="var(--color-danger)"
            strokeWidth="2.5"
          />
        )}

        {/* Tick marks */}
        {ticks.map((t) => {
          const x = GAUGE_START + (t / MAX_UNITS) * GAUGE_WIDTH;
          const isMajor = t % 10 === 0;
          return (
            <line
              key={t}
              x1={x}
              y1={38}
              x2={x}
              y2={isMajor ? 52 : 46}
              stroke="var(--color-text-muted)"
              strokeWidth={isMajor ? 1.5 : 1}
            />
          );
        })}

        {/* Major labels */}
        {ticks
          .filter((t) => t % 10 === 0)
          .map((t) => {
            const x = GAUGE_START + (t / MAX_UNITS) * GAUGE_WIDTH;
            return (
              <text key={t} x={x} y="112" textAnchor="middle" fontSize="14" fontWeight={600} fill="var(--color-text-secondary)">
                {t}
              </text>
            );
          })}

        {/* Needle hub */}
        <rect x={GAUGE_END} y="48" width="18" height="24" fill="var(--color-text-muted)" />
        <rect x={GAUGE_END + 18} y="58" width="24" height="4" fill="var(--color-text-secondary)" />
      </svg>

      {overCapacity && (
        <p className="text-sm text-danger text-center mt-2">
          This exceeds a standard 100-unit (1mL) syringe. Use a larger syringe, or increase your water volume to lower the concentration.
        </p>
      )}
    </div>
  );
}
