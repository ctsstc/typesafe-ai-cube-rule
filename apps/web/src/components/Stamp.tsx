import type { StampCopy } from "../lib/copy";

interface StampProps {
  readonly stamp: StampCopy;
  readonly simulated?: boolean;
}

// The heading carries the verdict, so the stamp is decoration for sighted readers and screenshots.
export function Stamp({ stamp, simulated = false }: StampProps) {
  return (
    <div className={`stamp stamp--${stamp.variant}`} aria-hidden="true">
      {stamp.ghost && <span className="stamp__ghost">{stamp.ghost}</span>}
      <span className="stamp__main">
        {stamp.variant === "honorary" && <span className="stamp__kicker">Honorary</span>}
        <span className="stamp__label">{stamp.label}</span>
      </span>
      {simulated && <span className="stamp__sim">Simulated</span>}
    </div>
  );
}
