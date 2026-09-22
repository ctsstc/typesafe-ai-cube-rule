import { CATEGORIES, type CategoryId, CUBE_FACES } from "@cube/core";
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

// x, y, z as fractions of the cube edge, then rotations in degrees.
const CHIPS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [-0.26, 0.28, 0.2, 70, 10, 20],
  [0.24, 0.3, -0.18, 76, -20, -35],
  [0.04, 0.3, 0.26, 82, 35, 160],
  [-0.22, -0.02, -0.24, -30, 50, 10],
  [0.26, 0.02, 0.22, 40, -40, 120],
  [0, 0.08, -0.02, 60, 0, 200],
  [-0.08, -0.26, 0.1, 20, 70, 300],
  [0.2, -0.24, -0.16, -50, 20, 45],
];

type Vars = CSSProperties & Record<`--${string}`, string | number>;

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
          {CUBE_FACES.map((face) => {
            const starch = layout?.faces[face] ?? false;
            return (
              <div
                key={face}
                className={`face face--${face} ${starch ? "is-starch" : "is-open"}`}
                style={{ "--order": BAKE_ORDER[face] } as Vars}
              >
                <div className="skin">
                  <i className="out" />
                  <i className="in" />
                </div>
              </div>
            );
          })}
          {layout?.interior === "layers" && (
            <div className="slab is-starch" style={{ "--order": 2 } as Vars}>
              <div className="skin">
                <i className="out" />
                <i className="in" />
              </div>
            </div>
          )}
          {layout?.interior === "core" &&
            CHIPS.map(([x, y, z, rx, ry, rz], i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative list
                key={i}
                className="chip is-starch"
                style={
                  {
                    "--i": i,
                    transform: `translate3d(calc(var(--cube) * ${x}), calc(var(--cube) * ${y}), calc(var(--cube) * ${z})) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`,
                  } as Vars
                }
              />
            ))}
        </div>
      </div>
    </div>
  );
}
