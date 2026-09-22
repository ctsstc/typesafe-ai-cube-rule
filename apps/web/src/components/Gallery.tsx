import { CATEGORIES, CATEGORY_IDS, FAMILIES } from "@cube/core";
import { exampleQuery } from "../lib/examples";
import { Cube3D } from "./Cube3D";
import { FoodLink } from "./FoodForm";

export function FaceLegend() {
  return (
    <ul className="legend" aria-label="Legend">
      <li>
        <span className="legend__swatch legend__swatch--starch" aria-hidden="true" />
        Structural starch
      </li>
      <li>
        <span className="legend__swatch legend__swatch--open" aria-hidden="true" />
        Open face
      </li>
    </ul>
  );
}

export function Gallery({ onPick }: { onPick: (item: string) => void }) {
  return (
    <section
      id="gallery"
      className="gallery container container--wide"
      aria-labelledby="gallery-title"
    >
      <div className="section-head">
        <h2 id="gallery-title">The nine cubes</h2>
        <p>
          Every food is one of these. The Cube Rule ignores ingredients and only asks where the
          structural starch sits. Tap an example to put Jev to the test.
        </p>
        <FaceLegend />
      </div>
      <ol className="gallery__grid">
        {CATEGORY_IDS.map((id) => {
          const category = CATEGORIES[id];
          return (
            <li key={id} className="cube-card">
              <Cube3D category={id} className="cube-card__cube" size="var(--card-cube)" />
              <div className="cube-card__body">
                <h3 className="cube-card__title">
                  <span className="cube-card__num" aria-hidden="true">
                    {category.number}
                  </span>
                  {category.name}
                </h3>
                <p className="cube-card__summary">{category.summary}.</p>
                <p className="cube-card__family">
                  Family: {FAMILIES[category.family].label.toLowerCase()}
                </p>
                <ul
                  className="cube-card__examples"
                  aria-label={`Canon ${category.name.toLowerCase()} examples`}
                >
                  {category.examples.slice(0, 3).map((example) => (
                    <li key={example}>
                      <FoodLink item={exampleQuery(example)} onPick={onPick} />
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
