import "./Docket.css";
import type { ListEntry, ListName } from "@cube/core";
import { useEffect, useState } from "react";
import {
  activityLine,
  type Docket as DocketData,
  entryDetail,
  LIST_BLURBS,
  LIST_TITLES,
  loadDocket,
} from "../lib/docket";
import { sentenceCase } from "../lib/format";
import { FoodLink } from "./FoodForm";

interface DocketProps {
  readonly onPick: (item: string) => void;
  /** Keeps lists that are ready from rendering until the slot is back below the reader. */
  readonly hold?: boolean;
  readonly onShown?: () => void;
}

interface EntryProps extends Pick<DocketProps, "onPick"> {
  readonly list: ListName;
  readonly entry: ListEntry;
  readonly className: string;
}

function Entry({ list, entry, className, onPick }: EntryProps) {
  return (
    <FoodLink
      item={entry.item}
      onPick={onPick}
      className={className}
      label={
        <>
          <span className="docket__name">
            {sentenceCase(entry.item)}
            {entry.kind === "honorary" && (
              <>
                <span className="visually-hidden">,</span>{" "}
                <span className="docket__honorary">Honorary</span>
              </>
            )}
          </span>
          <span className="visually-hidden">:</span>{" "}
          <span className="docket__detail">{entryDetail(list, entry)}</span>
        </>
      }
    />
  );
}

function ListHead({ name }: { readonly name: ListName }) {
  return (
    <div className="docket__head">
      <h3 id={`docket-${name}`}>{LIST_TITLES[name]}</h3>
      <p>{LIST_BLURBS[name]}</p>
    </div>
  );
}

export function Docket({ onPick, hold = false, onShown }: DocketProps) {
  const [docket, setDocket] = useState<DocketData | null>(null);
  const [shown, setShown] = useState(false);
  if (docket && !hold && !shown) setShown(true);

  useEffect(() => {
    let live = true;
    void loadDocket().then((value) => {
      if (live) setDocket(value);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (shown) onShown?.();
  }, [shown, onShown]);

  if (!docket || !shown) return null;
  const latest = docket.lists.find((list) => list.name === "latest");
  const cards = docket.lists.filter((list) => list.name !== "latest");

  return (
    <section
      id="docket"
      className="docket container container--wide"
      aria-labelledby="docket-title"
    >
      <div className="section-head">
        <h2 id="docket-title">The docket</h2>
        <p>What the court has been hearing. Pick a case for the full ruling.</p>
        {docket.newFoodsLastHour !== null && (
          <p className="docket__activity">{activityLine(docket.newFoodsLastHour)}</p>
        )}
      </div>

      {latest && (
        <div className="docket__latest">
          <ListHead name="latest" />
          <ol className="docket__strip" aria-labelledby="docket-latest">
            {latest.entries.map((entry) => (
              <li key={entry.item}>
                <Entry list="latest" entry={entry} className="docket__chip" onPick={onPick} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {cards.length > 0 && (
        <div className="docket__grid">
          {cards.map(({ name, entries }) => (
            <div key={name} className="docket__card">
              <ListHead name={name} />
              <ol className="docket__list" aria-labelledby={`docket-${name}`}>
                {entries.map((entry) => (
                  <li key={entry.item}>
                    <Entry list={name} entry={entry} className="docket__link" onPick={onPick} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
