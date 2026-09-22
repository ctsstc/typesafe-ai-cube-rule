import { CATEGORIES, type CategoryId, type CubeRuling } from "@cube/core";
import { type CSSProperties, useId } from "react";
import { formatPercent } from "../lib/format";

interface ProbabilityListProps {
  readonly ruling: CubeRuling;
  readonly canon?: CategoryId | null;
  readonly title?: string;
}

export function ProbabilityList({
  ruling,
  canon = null,
  title = "Jev's probabilities, highest first",
}: ProbabilityListProps) {
  const headingId = useId();
  return (
    <div className="odds">
      <h3 id={headingId} className="odds__title">
        {title}
      </h3>
      <ol className="odds__list" aria-labelledby={headingId}>
        {ruling.odds.map((odds, index) => {
          const category = CATEGORIES[odds.id];
          const style = { "--p": odds.probability, "--i": index } as CSSProperties;
          return (
            <li
              key={odds.id}
              className={index === 0 ? "odds__row is-winner" : "odds__row"}
              style={style}
            >
              <span className="odds__num" aria-hidden="true">
                {category.number}
              </span>
              <span className="odds__name">
                {category.name}
                {canon === odds.id && <span className="odds__canon"> canon</span>}
              </span>
              <span className="odds__pct">{formatPercent(odds.probability)}</span>
              <span className="odds__bar" aria-hidden="true">
                <span className="odds__fill" data-empty={odds.probability <= 0 || undefined} />
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
