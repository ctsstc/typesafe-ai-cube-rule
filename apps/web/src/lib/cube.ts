import { CATEGORIES, type CategoryId, CUBE_FACES, type CubeFace } from "@cube/core";

export interface Angle {
  readonly rx: number;
  readonly ry: number;
}

export const WIREFRAME_ANGLE: Angle = { rx: -22, ry: -38 };

export const HERO_ANGLES: Readonly<Record<CategoryId, Angle>> = {
  salad: { rx: -22, ry: -38 },
  toast: { rx: -32, ry: -30 },
  sandwich: { rx: -14, ry: -35 },
  taco: { rx: -24, ry: -14 },
  sushi: { rx: -12, ry: -22 },
  quiche: { rx: -40, ry: -30 },
  calzone: { rx: -22, ry: -38 },
  cake: { rx: -14, ry: -35 },
  nachos: { rx: -22, ry: -38 },
};

export const BAKE_ORDER: Readonly<Record<CubeFace, number>> = {
  bottom: 0,
  left: 1,
  right: 1,
  front: 2,
  back: 2,
  top: 3,
};

const FACE_NAMES: Readonly<Record<CubeFace, string>> = {
  top: "top",
  bottom: "bottom",
  left: "left side",
  right: "right side",
  front: "front end",
  back: "back end",
};

function listOf(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

export function starchFaces(id: CategoryId): CubeFace[] {
  const { faces } = CATEGORIES[id].geometry;
  return CUBE_FACES.filter((face) => faces[face]);
}

export function describeCube(id: CategoryId | null): string {
  if (id === null) return "Empty cube with no starch marked yet.";
  const { name, geometry } = CATEGORIES[id];
  const solid = starchFaces(id);
  const open = CUBE_FACES.filter((face) => !geometry.faces[face]);
  const prefix = `Cube diagram, ${name}:`;
  if (geometry.interior === "core") {
    return `${prefix} no starch on any face, with starch pieces scattered inside.`;
  }
  if (solid.length === 0) return `${prefix} no structural starch on any face.`;
  if (open.length === 0) return `${prefix} starch sealing all six faces.`;
  const middle = geometry.interior === "layers" ? ", plus a starch layer through the middle" : "";
  const openText = open.length === 1 ? "is open" : "are open";
  return `${prefix} starch on the ${listOf(solid.map((f) => FACE_NAMES[f]))}${middle}. The ${listOf(open.map((f) => FACE_NAMES[f]))} ${openText}.`;
}
