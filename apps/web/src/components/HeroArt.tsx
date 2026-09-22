import { CATEGORIES } from "@cube/core";
import { useEffect, useState } from "react";
import type { HeroQuestion } from "../lib/copy";
import { foodHref } from "../lib/url";
import { Cube3D } from "./Cube3D";
import { isPlainClick } from "./FoodForm";
import { Stamp } from "./Stamp";

const INTRO_MS = 1400;

export function HeroArt({
  hero,
  onPick,
}: {
  readonly hero: HeroQuestion;
  readonly onPick: (item: string) => void;
}) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), INTRO_MS);
    return () => clearTimeout(timer);
  }, []);
  const name = CATEGORIES[hero.category].name;
  return (
    <a
      className="hero__art"
      href={foodHref(hero.food)}
      aria-label={`Ask Jev about ${hero.food}`}
      data-intro={settled ? undefined : true}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onPick(hero.food);
      }}
    >
      <Cube3D
        category={hero.category}
        phase={settled ? "static" : "reveal"}
        size="var(--hero-cube)"
        decorative
      />
      <Stamp stamp={{ label: `${name}?`, ghost: null, variant: "question" }} />
    </a>
  );
}
