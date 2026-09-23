import { CATEGORIES, type CategoryId, CUBE_FACES, type CubeFace } from "@cube/core";
import { type CSSProperties, useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { BAKE_ORDER, describeCube, HERO_ANGLES, WIREFRAME_ANGLE } from "../lib/cube";
import "./Cube3D.css";

export type CubePhase = "loading" | "reveal" | "static";

interface Cube3DProps {
  readonly category: CategoryId | null;
  readonly phase?: CubePhase;
  readonly size?: string;
  readonly starchColor?: string | null;
  readonly muted?: boolean;
  readonly decorative?: boolean;
  readonly className?: string;
}

const SPIN_MS = 2400;
const SETTLE_MS = 800;

type Vars = CSSProperties & Record<`--${string}`, string | number>;

function Face({ face, starch }: { face: CubeFace; starch: boolean }) {
  return (
    <div
      className={`face face--${face} ${starch ? "is-starch" : "is-open"}`}
      style={{ "--order": BAKE_ORDER[face] } as Vars}
    >
      <div className="skin">
        <i className="out" />
        <i className="in" />
      </div>
    </div>
  );
}

function spinAngle(animation: Animation | null): number | null {
  if (!animation) return null;
  const time = Number(animation.currentTime ?? 0);
  return ((time % SPIN_MS) / SPIN_MS) * 360;
}

export function Cube3D({
  category,
  phase = "static",
  size,
  starchColor,
  muted = false,
  decorative = false,
  className,
}: Cube3DProps) {
  const cubeRef = useRef<HTMLDivElement>(null);
  const spin = useRef<Animation | null>(null);
  const lastSpinAngle = useRef<number | null>(null);
  const reduced = useReducedMotion();
  const resting = category ? HERO_ANGLES[category] : WIREFRAME_ANGLE;
  const geometry = category ? CATEGORIES[category].geometry : null;
  const layout = phase === "loading" ? null : geometry;

  useLayoutEffect(() => {
    const el = cubeRef.current;
    if (!el || typeof el.animate !== "function" || reduced) return;
    if (phase === "loading") {
      const animation = el.animate(
        [
          { transform: `rotateX(${WIREFRAME_ANGLE.rx}deg) rotateY(0deg)` },
          { transform: `rotateX(${WIREFRAME_ANGLE.rx}deg) rotateY(360deg)` },
        ],
        { duration: SPIN_MS, iterations: Number.POSITIVE_INFINITY },
      );
      spin.current = animation;
      return () => {
        lastSpinAngle.current = spinAngle(animation);
        animation.cancel();
        spin.current = null;
      };
    }
    if (phase === "reveal") {
      const fromRy = lastSpinAngle.current ?? 0;
      const fromRx = lastSpinAngle.current === null ? resting.rx : WIREFRAME_ANGLE.rx;
      const toRy = resting.ry + 360 * Math.ceil((fromRy + 270 - resting.ry) / 360);
      const animation = el.animate(
        [
          { transform: `rotateX(${fromRx}deg) rotateY(${fromRy}deg)` },
          { transform: `rotateX(${resting.rx}deg) rotateY(${toRy}deg)` },
        ],
        { duration: SETTLE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
      return () => animation.cancel();
    }
  }, [phase, reduced, resting.rx, resting.ry]);

  const stageStyle: Vars = {
    "--rx": `${resting.rx}deg`,
    "--ry": `${resting.ry}deg`,
  };
  if (size) stageStyle["--cube"] = size;
  if (starchColor) stageStyle["--starch"] = starchColor;

  const a11y = decorative
    ? { "aria-hidden": true as const }
    : { role: "img", "aria-label": describeCube(phase === "loading" ? null : category) };

  return (
    <div
      className={["cube-stage", className].filter(Boolean).join(" ")}
      data-phase={phase}
      data-category={layout ? category : undefined}
      data-muted={muted || undefined}
      data-tinted={starchColor ? true : undefined}
      style={stageStyle}
      {...a11y}
    >
      <div className="cube-wrap">
        <div className="cube" ref={cubeRef}>
          {CUBE_FACES.map((face) => (
            <Face key={face} face={face} starch={layout?.faces[face] ?? false} />
          ))}
          {layout?.interior === "layers" && (
            <div className="slab is-starch" style={{ "--order": 2 } as Vars}>
              <div className="skin">
                <i className="out" />
                <i className="in" />
              </div>
            </div>
          )}
          {layout?.interior === "core" && (
            <div className="core">
              {CUBE_FACES.map((face) => (
                <Face key={face} face={face} starch />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
