import { CUBE_ANSWER_TYPES } from "@cube/core";

type QuestionId = keyof typeof CUBE_ANSWER_TYPES;
export type AnswerType = (typeof CUBE_ANSWER_TYPES)[QuestionId];

const ASKS: Readonly<Record<QuestionId, string>> = {
  is_abusive: "is it abusive",
  input_kind: "is it food, not food or nonsense",
  category: "which of the nine cubes",
  honorary_category: "which cube it would be if it were food",
  starch: "what the starch is made of",
  is_wet: "is it served in liquid",
  starch_base: "where the starch sits",
  starch_lid: "where the starch sits",
  starch_side_wall: "where the starch sits",
  starch_opposite_walls: "where the starch sits",
  starch_all_walls: "where the starch sits",
  starch_middle_layer: "where the starch sits",
  starch_loose_pieces: "where the starch sits",
  starch_block: "where the starch sits",
  varies_by_serving: "does it depend how it's served",
  debate_heat: "how hard people argue about it",
};

export const ANSWER_TYPE_NAMES: Readonly<Record<AnswerType, [one: string, many: string]>> = {
  choice: ["Choice", "Choices"],
  noul: ["Noul", "Nouls"],
  score: ["Score", "Scores"],
};

export interface QuestionGroup {
  readonly type: AnswerType;
  readonly count: number;
  readonly asks: readonly string[];
}

const IDS = Object.keys(CUBE_ANSWER_TYPES) as QuestionId[];

export const QUESTION_COUNT = IDS.length;

export function questionGroups(): QuestionGroup[] {
  return (Object.keys(ANSWER_TYPE_NAMES) as AnswerType[]).flatMap((type) => {
    const ids = IDS.filter((id) => CUBE_ANSWER_TYPES[id] === type);
    if (ids.length === 0) return [];
    const times = new Map<string, number>();
    for (const id of ids) times.set(ASKS[id], (times.get(ASKS[id]) ?? 0) + 1);
    const asks = [...times].map(([ask, n]) => (n > 1 ? `${ask}, asked ${n} ways` : ask));
    return [{ type, count: ids.length, asks }];
  });
}
