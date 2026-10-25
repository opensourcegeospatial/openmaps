import React, { useMemo } from 'react';
import { downsampleProfile, heightAt, type ElevationProfileData } from '../lib/routeDetails';
import { formatHeight, formatKm, formatMetres } from '../lib/format';

interface ElevationProfileProps {
  profile: ElevationProfileData;
  /** Metres along the route being pointed at, or null. */
  position: number | null;
  onPosition: (metres: number | null) => void;
}

/** Drawing units: about the panel's content width in px, so one sample per pixel. */
const WIDTH = 268;
const HEIGHT = 60;

/** Distance along the route as a reader says it: "0 m", "850 m", "1,6 km". */
export function alongLabel(metres: number): string {
  return metres <= 0 ? '0 m' : formatKm(metres);
}

/**
 * The route's height along its length. One keyboard stop, a slider: the
 * arrows move 1 %, PageUp/PageDown 10 %, Home/End to the ends, and the map
 * shows a dot at the position (App draws it). The pointer does the same.
 */
const ElevationProfile: React.FC<ElevationProfileProps> = ({ profile, position, onPosition }) => {
  const titleId = React.useId();
  const isPointerDownRef = React.useRef(false);
  const drawn = useMemo(() => downsampleProfile(profile.points, WIDTH), [profile.points]);
  const { min, max, length } = profile;
  // A flat route still needs a band to draw in.
  const flat = max - min < 1;
  const lo = flat ? min - 5 : min;
  const hi = flat ? max + 5 : max;
  const x = (at: number) => (length > 0 ? (at / length) * WIDTH : 0);
  const y = (h: number) => HEIGHT - ((h - lo) / (hi - lo)) * HEIGHT;
  const line = drawn.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.at).toFixed(1)} ${y(p.height).toFixed(1)}`).join(' ');
  const area = `${line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`;

  const at = position ?? 0;
  const here = heightAt(profile, at);
  const valueText = `${alongLabel(at)}, ${formatHeight(here)}`;
  const move = (to: number) => onPosition(Math.max(0, Math.min(length, to)));
  const step = length / 100;

  const onKeyDown = (event: React.KeyboardEvent) => {
    const targets: Record<string, number> = {
      ArrowRight: at + step,
      ArrowUp: at + step,
      ArrowLeft: at - step,
      ArrowDown: at - step,
      PageUp: at + step * 10,
      PageDown: at - step * 10,
      Home: 0,
      End: length
    };
    if (!(event.key in targets)) return;
    event.preventDefault();
    move(targets[event.key]);
  };

  const positionFromPointerEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    move(((event.clientX - box.left) / box.width) * length);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    isPointerDownRef.current = true;
    positionFromPointerEvent(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerUp = () => {
    isPointerDownRef.current = false;
  };

  const onPointerCancel = () => {
    isPointerDownRef.current = false;
  };

  const onPointerMove = positionFromPointerEvent;

  return (
    <section aria-labelledby={titleId} className="border-t border-border-subtle pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id={titleId} className="text-sm font-medium text-text-default">
          Høydeprofil
        </h3>
        <span className="text-xs tabular-nums text-text-subtle">
          Stigning {formatMetres(profile.ascend)} · Fall {formatMetres(profile.descend)}
        </span>
      </div>
      {/* The readout: the same words the slider's value speaks. */}
      <p aria-hidden="true" className="mt-1 h-4 text-xs tabular-nums text-text-default">
        {position === null ? '' : `${alongLabel(at)} · ${formatHeight(here)}`}
      </p>
      <div className="mt-1 flex gap-2">
        <div aria-hidden="true" className="flex w-14 shrink-0 flex-col justify-between text-right text-xs tabular-nums text-text-subtle">
          <span>{formatHeight(max)}</span>
          <span>{formatHeight(min)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Høydeprofil"
            aria-valuemin={0}
            aria-valuemax={Math.round(length)}
            aria-valuenow={Math.round(at)}
            aria-valuetext={valueText}
            onKeyDown={onKeyDown}
            onFocus={() => {
              if (position === null && !isPointerDownRef.current) onPosition(0);
            }}
            onBlur={() => onPosition(null)}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerMove={onPointerMove}
            onPointerLeave={(event) => {
              if (document.activeElement !== event.currentTarget) onPosition(null);
            }}
            className="touch-pan-y cursor-crosshair rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-base-default focus-visible:ring-offset-2 focus-visible:ring-offset-surface-default"
          >
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="block h-[60px] w-full" aria-hidden="true">
              <path d={area} className="fill-base-default/15" />
              <path d={line} fill="none" className="stroke-base-default" strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {position !== null && (
                <line x1={x(at)} x2={x(at)} y1={0} y2={HEIGHT} className="stroke-text-default" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              )}
            </svg>
          </div>
          <div aria-hidden="true" className="mt-0.5 flex justify-between text-xs tabular-nums text-text-subtle">
            <span>0</span>
            <span>{alongLabel(length)}</span>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ElevationProfile;
