'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import posthog from 'posthog-js';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { SyringeGauge } from '@/components/calculator/SyringeGauge';

// Trim trailing zeros (e.g. 0.2500 -> 0.25) while still rounding to a sane precision.
function formatMg(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

const STRENGTH_OPTIONS = [1, 5, 10, 15, 20, 50];
const WATER_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3];
const DOSE_OPTIONS = [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 7.5, 10, 12.5, 15];
const DEFAULT_VALUE = 1;

function PillGroup({
  step,
  label,
  unit,
  options,
  value,
  onSelect,
  customValue,
  onCustomChange,
  impliedValue,
}: {
  step: number;
  label: string;
  unit: string;
  options: number[];
  value: number | null;
  onSelect: (v: number) => void;
  customValue: string;
  onCustomChange: (v: string) => void;
  impliedValue?: number;
}) {
  const filled = value !== null || customValue !== '';

  // Every column is the same shape: an even three-across grid of presets,
  // all one width, then the custom field. The "defaulting to" note lives
  // under all three columns rather than lengthening one of them.
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors',
            filled ? 'bg-primary text-white' : 'bg-surface-elevated text-text-muted'
          )}
        >
          {step}
        </div>
        <h2 className="font-display font-semibold text-lg">{label}</h2>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {options.map((opt) => {
          const isSelected = value === opt && customValue === '';
          const isImplied = !filled && impliedValue === opt;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(opt)}
              className={cn(
                'h-9 w-full px-1 rounded-full border text-sm font-medium tabular-nums whitespace-nowrap transition-colors cursor-pointer',
                isSelected
                  ? 'bg-primary text-white border-primary'
                  : isImplied
                  ? 'bg-surface border-dashed border-text-muted text-text-secondary'
                  : 'bg-surface border-border hover:border-text-muted text-text-primary'
              )}
            >
              {opt}
              {unit}
            </button>
          );
        })}
      </div>
      <div className="relative">
        <Input
          aria-label={`Custom ${label.toLowerCase()} (${unit})`}
          placeholder="Custom amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          className="pr-12 tabular-nums"
        />
        <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-muted pointer-events-none">{unit}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, unit, primary }: { label: string; value: string; unit: string; primary?: boolean }) {
  return (
    <div className={cn('rounded-lg p-3', primary ? 'bg-primary text-white' : 'border border-border')}>
      <p className={cn('text-xs mb-1 truncate', primary ? 'text-neutral-400' : 'text-text-secondary')}>{label}</p>
      <p className="tabular-nums whitespace-nowrap">
        <span className="font-display font-bold text-lg">{value}</span>{' '}
        <span className={cn('text-xs', primary ? 'text-neutral-300' : 'text-text-secondary')}>{unit}</span>
      </p>
    </div>
  );
}

export function CalculatorClient() {
  const [strength, setStrength] = useState<number | null>(null);
  const [strengthCustom, setStrengthCustom] = useState('');
  const [water, setWater] = useState<number | null>(null);
  const [waterCustom, setWaterCustom] = useState('');
  const [dose, setDose] = useState<number | null>(null);
  const [doseCustom, setDoseCustom] = useState('');

  const strengthMg = strengthCustom !== '' ? parseFloat(strengthCustom) : strength;
  const waterMl = waterCustom !== '' ? parseFloat(waterCustom) : water;
  const doseMg = doseCustom !== '' ? parseFloat(doseCustom) : dose;

  const validStrength = typeof strengthMg === 'number' && strengthMg > 0;
  const validWater = typeof waterMl === 'number' && waterMl > 0;
  const validDose = typeof doseMg === 'number' && doseMg > 0;

  const filledCount = [validStrength, validWater, validDose].filter(Boolean).length;

  // Once at least two of the three inputs are set, the third defaults to 1
  // (in its own unit) so a result is always visible rather than leaving the
  // user stuck with no feedback until all three are picked.
  const effective = useMemo(() => {
    if (filledCount < 2) return null;

    const eStrength = validStrength ? strengthMg! : DEFAULT_VALUE;
    const eWater = validWater ? waterMl! : DEFAULT_VALUE;
    const eDose = validDose ? doseMg! : DEFAULT_VALUE;

    const concentration = eStrength / eWater;
    return {
      concentration,
      vialDoses: eStrength / eDose,
      units: (eDose / eStrength) * eWater * 100,
      dose: eDose,
      // mg per single syringe unit at this concentration — lets the user work
      // out any other dose on this same vial without re-running the calculator.
      mgPerUnit: concentration / 100,
    };
  }, [filledCount, validStrength, validWater, validDose, strengthMg, waterMl, doseMg]);

  // Fire once, when the result panel first becomes visible. Doing this in an
  // effect keyed on `effective` rather than inside the click handlers matters
  // twice over: the handlers read the validity flags from the render that
  // preceded their own setState, so they test stale values, and they only
  // cover the preset buttons — a user typing custom amounts would never have
  // registered as having used the calculator at all.
  const capturedUse = useRef(false);
  useEffect(() => {
    if (effective && !capturedUse.current) {
      capturedUse.current = true;
      posthog.capture('calculator_used', { inputs_filled: filledCount });
    }
  }, [effective, filledCount]);

  const impliedNote =
    filledCount !== 2
      ? null
      : !validStrength
      ? `Vial strength defaulting to ${DEFAULT_VALUE}mg`
      : !validWater
      ? `Water defaulting to ${DEFAULT_VALUE}mL`
      : `Dose defaulting to ${DEFAULT_VALUE}mg`;

  const selectStrength = (v: number) => {
    setStrength(v);
    setStrengthCustom('');
  };
  const selectWater = (v: number) => {
    setWater(v);
    setWaterCustom('');
  };
  const selectDose = (v: number) => {
    setDose(v);
    setDoseCustom('');
  };

  return (
    <div className="space-y-8">
      <div className="bg-surface rounded-xl border border-border p-5 sm:p-6 grid sm:grid-cols-3 gap-6 sm:gap-8">
        <PillGroup
          step={1}
          label="Vial Strength"
          unit="mg"
          options={STRENGTH_OPTIONS}
          value={strength}
          onSelect={selectStrength}
          customValue={strengthCustom}
          onCustomChange={setStrengthCustom}
          impliedValue={!validStrength && filledCount >= 2 ? DEFAULT_VALUE : undefined}
        />
        <PillGroup
          step={2}
          label="Water Added"
          unit="mL"
          options={WATER_OPTIONS}
          value={water}
          onSelect={selectWater}
          customValue={waterCustom}
          onCustomChange={setWaterCustom}
          impliedValue={!validWater && filledCount >= 2 ? DEFAULT_VALUE : undefined}
        />
        <PillGroup
          step={3}
          label="Dose"
          unit="mg"
          options={DOSE_OPTIONS}
          value={dose}
          onSelect={selectDose}
          customValue={doseCustom}
          onCustomChange={setDoseCustom}
          impliedValue={!validDose && filledCount >= 2 ? DEFAULT_VALUE : undefined}
        />
        {impliedNote && (
          <p className="sm:col-span-3 -mt-2 text-xs text-text-muted">
            {impliedNote} — click above to set your own.
          </p>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-border p-5 sm:p-8">
        <h2 className="font-display font-semibold text-xl mb-6">Results</h2>

        {!effective ? (
          <p className="text-text-secondary text-center max-w-md mx-auto py-8">
            Pick any two of <strong className="text-text-primary">vial strength</strong>, <strong className="text-text-primary">water added</strong>, and <strong className="text-text-primary">dose</strong> above to see your results — we&apos;ll assume 1 for whichever one you leave out.
          </p>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex-1 w-full">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
                <Stat label="Concentration" value={effective.concentration.toFixed(2)} unit="mg/mL" />
                <Stat label="Vial yields" value={effective.vialDoses.toFixed(1)} unit="doses" />
                <Stat label="Dose" value={String(effective.dose)} unit="mg" />
                <Stat label="Draw to" value={effective.units.toFixed(2)} unit="units" primary />
              </div>
              <SyringeGauge units={effective.units} />
              <p className="text-xs text-text-muted mt-3">
                Assumes a standard U-100 insulin syringe (100 units = 1mL).
              </p>
            </div>

            <div className="w-full lg:w-64 shrink-0 bg-surface-elevated rounded-xl p-4">
              <div className="flex items-start gap-2.5">
                <Lightbulb className="w-4 h-4 text-text-secondary mt-0.5 shrink-0" />
                <div className="text-sm text-text-secondary">
                  <p className="font-semibold text-text-primary mb-1">Quick reference</p>
                  <p className="mb-2">
                    <strong className="text-text-primary">{effective.dose}mg = {effective.units.toFixed(2)} units</strong> on this vial.
                  </p>
                  <p>
                    Every unit on the syringe ≈ {formatMg(effective.mgPerUnit)}mg, so you can work out other doses on the same vial without recalculating.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
