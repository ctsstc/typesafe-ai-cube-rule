import { type CubeResult, type FoodResult, type HonoraryResult, STARCHES } from "@cube/core";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import type { ActiveState } from "../hooks/useOracle";
import { useReducedMotion } from "../hooks/useReducedMotion";
import {
  bandOf,
  confidenceLine,
  errorCopy,
  extraChips,
  extraNotes,
  LOADING_LINES,
  officialCopy,
  STILL_THINKING,
  shareText,
  stampFor,
  verdictLine,
} from "../lib/copy";
import { sentenceCase } from "../lib/format";
import { useAnnouncer } from "./Announcer";
import { Cube3D } from "./Cube3D";
import { ErrorPanel } from "./ErrorPanel";
import { BoxIcon, PencilIcon } from "./Icons";
import { NerdStats } from "./NerdStats";
import { ProbabilityList } from "./ProbabilityList";
import { ShareBar } from "./ShareBar";
import { Stamp } from "./Stamp";
import "./RulingCard.css";

export const REVEAL_MS = 1400;
export const REVEAL_REDUCED_MS = 180;
const LINE_MS = 1100;
const SLOW_MS = 4000;

interface RulingCardProps {
  readonly state: ActiveState;
  readonly level?: 1 | 2;
  readonly onRetry: () => void;
  readonly onEdit: () => void;
  readonly onCubeAnother: () => void;
}

// Deep links are written by someone else, so their text is only shown once Jev has cleared it.
function canEcho(state: ActiveState): boolean {
  if (state.origin !== "link") return true;
  return state.status === "done" && state.result.kind !== "declined";
}

function headingText(state: ActiveState): string {
  if (state.status === "done") {
    const { result } = state;
    if (result.kind === "declined") return "Jev declines to cube that.";
    return `${sentenceCase(result.item)}: ${verdictLine(result)}`;
  }
  return canEcho(state) ? sentenceCase(state.item) : "Consulting the cube";
}

function useLoadingLine(active: boolean) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => setTick(Date.now() - started), 250);
    return () => clearInterval(timer);
  }, [active]);
  return {
    line: LOADING_LINES[Math.floor(tick / LINE_MS) % LOADING_LINES.length],
    slow: tick >= SLOW_MS,
  };
}

function WithCuberuleLink({ text }: { text: string }) {
  const parts = text.split("cuberule.com");
  return (
    <>
      {parts.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
        <Fragment key={index}>
          {index > 0 && (
            <a href="https://cuberule.com/" target="_blank" rel="noopener">
              cuberule.com
            </a>
          )}
          {part}
        </Fragment>
      ))}
    </>
  );
}

function OfficialBadge({ result }: { result: FoodResult | HonoraryResult }) {
  const copy = officialCopy(result);
  if (!copy) return null;
  return (
    <p className={`official ${copy.agrees ? "official--agrees" : "official--dissents"}`}>
      <span className="official__tag">{copy.agrees ? "Canon" : "Dissent"}</span>
      <span>
        <WithCuberuleLink text={copy.text} />
      </span>
    </p>
  );
}

function FoodDetails({ result, level }: { result: FoodResult; level: 2 | 3 }) {
  const official = officialCopy(result);
  const chips = extraChips(result);
  const notes = extraNotes(result);
  return (
    <>
      <div className="ruling__reveal-late">
        {(!official || official.agrees) && (
          <p className="ruling__confidence">{confidenceLine(result.item, result.ruling)}</p>
        )}
        <OfficialBadge result={result} />
        <ul className="tags" aria-label="Ruling details">
          {chips.map((chip) => (
            <li key={chip.id} className="tag">
              {chip.swatch && (
                <span
                  className="tag__swatch"
                  style={{ background: chip.swatch }}
                  aria-hidden="true"
                />
              )}
              {chip.label}
            </li>
          ))}
        </ul>
        {notes.length > 0 && (
          <ul className="notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
      <ProbabilityList
        ruling={result.ruling}
        canon={result.official && !result.official.jevAgrees ? result.official.category : null}
        level={level}
      />
    </>
  );
}

function HonoraryDetails({ result, level }: { result: HonoraryResult; level: 2 | 3 }) {
  return (
    <>
      <div className="ruling__reveal-late">
        <p className="ruling__confidence">{result.headline}</p>
        <OfficialBadge result={result} />
      </div>
      <ProbabilityList
        ruling={result.ruling}
        title="If it were food: Jev's probabilities"
        level={level}
      />
    </>
  );
}

function SkeletonOdds() {
  return (
    <div className="odds odds--skeleton" aria-hidden="true">
      <div className="odds__title skeleton-line" />
      {Array.from({ length: 9 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows
        <div key={i} className="odds__row">
          <span className="skeleton-line" />
        </div>
      ))}
    </div>
  );
}

function cubeFor(result: CubeResult) {
  if (result.kind === "food") {
    return {
      category: result.category,
      starchColor: result.starch ? STARCHES[result.starch].color : null,
      muted: !result.official && bandOf(result.ruling) === "baffled",
    };
  }
  if (result.kind === "honorary")
    return { category: result.category, starchColor: null, muted: false };
  return { category: null, starchColor: null, muted: true };
}

export function RulingCard({ state, level = 2, onRetry, onEdit, onCubeAnother }: RulingCardProps) {
  const reduced = useReducedMotion();
  const { announce } = useAnnouncer();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const [revealed, setRevealed] = useState(false);
  const revealing = state.status === "done" && !revealed;
  const { line, slow } = useLoadingLine(state.status === "loading");
  const echo = canEcho(state);
  const heading = headingText(state);

  useEffect(() => {
    if (state.status === "loading") {
      announce(echo ? `Ruling on ${state.item}.` : "Consulting the cube.");
    } else if (state.status === "error") {
      announce(errorCopy(state.error.code, state.error.retryAfter).title);
    }
  }, [state, echo, announce]);

  useEffect(() => {
    if (state.status !== "done") return;
    const timer = setTimeout(
      () => {
        setRevealed(true);
        if (state.origin === "typed") headingRef.current?.focus();
        else announce(heading);
      },
      reduced ? REVEAL_REDUCED_MS : REVEAL_MS,
    );
    return () => clearTimeout(timer);
  }, [state, reduced, heading, announce]);

  const simulated = state.status === "done" && state.meta?.response.mock === true;
  const result = state.status === "done" ? state.result : null;
  // One stage for loading and done, so the spinning wireframe settles into the ruling.
  const showStage = state.status === "loading" || (result !== null && result.kind !== "declined");
  const cube = result ? cubeFor(result) : { category: null, starchColor: null, muted: false };
  const phase = state.status === "loading" ? "loading" : revealing ? "reveal" : "static";
  const stamp = result ? stampFor(result) : null;
  const Heading = level === 1 ? "h1" : "h2";
  const subLevel = level === 1 ? 2 : 3;

  return (
    <article
      className="ruling"
      aria-labelledby={headingId}
      aria-busy={state.status === "loading"}
      data-status={state.status}
      data-kind={result?.kind}
      data-reveal={revealing || undefined}
      data-layout={showStage ? "split" : undefined}
    >
      <div className="ruling__lead">
        <p className="eyebrow">
          Ruling
          {simulated && <span className="pill pill--warn">Simulated</span>}
        </p>
        <Heading id={headingId} ref={headingRef} tabIndex={-1} className="ruling__heading">
          {result?.kind === "declined" ? (
            <span className="ruling__verdict ruling__verdict--solo">
              Jev declines to cube that.
            </span>
          ) : result ? (
            <>
              <span className="ruling__food">{sentenceCase(result.item)}</span>
              <span className="visually-hidden">:</span>{" "}
              <span className="ruling__verdict">{verdictLine(result)}</span>
            </>
          ) : (
            <span className="ruling__food">{heading}</span>
          )}
        </Heading>

        {showStage && (
          <div className="ruling__stage">
            <Cube3D {...cube} phase={phase} />
            {stamp && <Stamp stamp={stamp} simulated={simulated} />}
          </div>
        )}
      </div>

      <div className="ruling__body">
        {state.status === "loading" && (
          <>
            <p className="ruling__status" aria-hidden="true">
              {line}
            </p>
            <p className="ruling__slow">{slow ? STILL_THINKING : " "}</p>
            <SkeletonOdds />
          </>
        )}

        {state.status === "error" && (
          <ErrorPanel error={state.error} onRetry={onRetry} onEdit={onEdit} />
        )}

        {result?.kind === "declined" && (
          <div className="declined">
            <span className="declined__box">
              <BoxIcon />
            </span>
            <p>Try a food. Any food.</p>
            <button type="button" className="button button--primary" onClick={onCubeAnother}>
              <PencilIcon />
              Cube another
            </button>
          </div>
        )}

        {result && result.kind !== "declined" && (
          <>
            {result.kind === "food" && <FoodDetails result={result} level={subLevel} />}
            {result.kind === "honorary" && <HonoraryDetails result={result} level={subLevel} />}
            {result.kind === "nonsense" && (
              <p className="ruling__confidence">
                Jev can't find a food, or anything else, in that. Try a dish, a snack, or a drink.
              </p>
            )}
            {result.kind === "nonsense" ? (
              <div className="share">
                <div className="share__buttons">
                  <button type="button" className="button button--primary" onClick={onCubeAnother}>
                    <PencilIcon />
                    Cube another
                  </button>
                </div>
              </div>
            ) : (
              <ShareBar item={result.item} text={shareText(result)} onCubeAnother={onCubeAnother} />
            )}
          </>
        )}

        {state.status === "done" && <NerdStats result={state.result} meta={state.meta} />}
      </div>
    </article>
  );
}
