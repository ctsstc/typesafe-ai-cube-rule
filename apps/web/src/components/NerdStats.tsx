import { CATEGORY_IDS, type CubeResult, QUESTION_SET_VERSION } from "@cube/core";
import type { ReactNode } from "react";
import type { Classified } from "../lib/api";

interface NerdStatsProps {
  readonly result: CubeResult;
  readonly meta: Classified | null;
}

const n3 = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "n/a";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{children}</td>
    </tr>
  );
}

function cacheLabel(meta: Classified): string {
  if (meta.fromBrowserCache) return "browser cache";
  return meta.cache ?? "not reported";
}

export function NerdStats({ result, meta }: NerdStatsProps) {
  const answers = meta?.response.answers;
  const mode = !meta ? "precheck (no request)" : meta.response.mock ? "mock" : "live";
  return (
    <details className="nerd">
      <summary>Nerd stats</summary>
      <table className="nerd__table">
        <caption className="visually-hidden">Raw numbers behind this ruling</caption>
        <tbody>
          <Row label="Model">{result.model}</Row>
          <Row label="Question set">{QUESTION_SET_VERSION}</Row>
          <Row label="Mode">{mode}</Row>
          {meta && <Row label="Round trip">{meta.latencyMs} ms</Row>}
          {meta && <Row label="Cache">{cacheLabel(meta)}</Row>}
          {answers && (
            <>
              <Row label="is_abusive">{n3(answers.is_abusive.noul)}</Row>
              {result.kind !== "declined" && (
                <>
                  <Row label="input_kind">
                    {answers.input_kind.choice} ({n3(answers.input_kind.confidence)} confidence)
                  </Row>
                  <Row label="category">
                    {answers.category.choice} ({n3(answers.category.confidence)} confidence)
                  </Row>
                  {CATEGORY_IDS.map((id) => (
                    <Row key={id} label={`  ${id}`}>
                      {n3(answers.category.probabilities[id])}
                    </Row>
                  ))}
                  {result.kind === "honorary" && (
                    <Row label="honorary_category">
                      {answers.honorary_category.choice} ({n3(answers.honorary_category.confidence)}{" "}
                      confidence)
                    </Row>
                  )}
                  <Row label="starch">
                    {answers.starch.choice} ({n3(answers.starch.confidence)} confidence)
                  </Row>
                  <Row label="is_wet">{n3(answers.is_wet.noul)}</Row>
                  <Row label="varies_by_serving">{n3(answers.varies_by_serving.noul)}</Row>
                  <Row label="debate_heat">{n3(answers.debate_heat.score)} of 3</Row>
                </>
              )}
            </>
          )}
        </tbody>
      </table>
    </details>
  );
}
