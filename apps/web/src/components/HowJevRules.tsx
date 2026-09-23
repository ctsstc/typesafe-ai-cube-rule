import stats from "virtual:eval-stats";
import { CUBE_MODEL, THRESHOLDS, VERDICT_ADVERBS } from "@cube/core";
import {
  formatCount,
  formatRate,
  formatTally,
  formatUsd,
  onePointOf,
  rulingsPerDollar,
  type Tally,
} from "../lib/evalStats";
import { joinList } from "../lib/format";
import { ANSWER_TYPE_NAMES, QUESTION_COUNT, questionGroups } from "../lib/jevQuestions";
import { CLAUDE_CODE_URL, EVAL_DOC_URL, TYPESAFE } from "../lib/links";

function Scored({ tally }: { tally: Tally }) {
  return (
    <>
      {formatRate(tally)} <span className="jev__of">({formatTally(tally)})</span>
    </>
  );
}

export function HowJevRules() {
  const { holdout, canon } = stats;
  const holdoutNamed = holdout.all.n - holdout.notInPrompt.n;
  const canonNamed = canon.all.n - canon.notInPrompt.n;
  const perRuling = formatUsd(stats.cost.perRulingUsd);
  const groups = questionGroups();

  return (
    <section id="how-jev-rules" className="jev container" aria-labelledby="jev-title">
      <div className="section-head">
        <h2 id="jev-title">How Jev rules</h2>
        <p className="jev__disclaimer">
          <strong>Unofficial.</strong> This fan app is not affiliated with or endorsed by TypeSafe,
          cuberule.com or its creators. What we say about Jev comes from{" "}
          <a href={TYPESAFE.docs} rel="noopener">
            TypeSafe's docs
          </a>{" "}
          and{" "}
          <a href={TYPESAFE.launch} rel="noopener">
            launch post
          </a>
          . The numbers come from our own tests.
        </p>
      </div>

      <ul className="jev__stats" aria-label="The short version">
        <li>
          <strong>{formatRate(holdout.all)}</strong>
          <span>right on foods we never tuned against</span>
        </li>
        <li>
          <strong>{QUESTION_COUNT}</strong>
          <span>typed questions per food, one request</span>
        </li>
        <li>
          <strong>{perRuling}</strong>
          <span>per new ruling</span>
        </li>
        <li>
          <strong>{stats.latency.p50Ms} ms</strong>
          <span>median Jev call, from a laptop</span>
        </li>
      </ul>

      <div className="jev__grid">
        <article>
          <h3>It doesn't talk</h3>
          <p>
            Jev is TypeSafe's first{" "}
            <a href={TYPESAFE.systemOne} rel="noopener">
              System One
            </a>{" "}
            model. The name borrows the fast, gut-call kind of thinking popularized in Daniel
            Kahneman's <cite>Thinking, Fast and Slow</cite>. A chat model reads your question and
            writes an answer, one word at a time. Jev writes nothing. We hand it the food name you
            typed, and nothing else, plus a tray of{" "}
            <a href={TYPESAFE.primitives} rel="noopener">
              typed questions
            </a>
            . It hands back numbers.
          </p>
          <dl className="jev__kinds">
            <div>
              <dt>Choice</dt>
              <dd>Pick one option from a list we wrote. Jev gives a probability for each.</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>Place the food on a scale we wrote, with a probability for each level.</dd>
            </div>
            <div>
              <dt>Noul</dt>
              <dd>A yes or no question. Jev gives the probability of yes.</dd>
            </div>
          </dl>
          <p>
            The answer is always one of the options we offered. Jev can't invent a tenth cube. It
            can absolutely pick the wrong one of the nine.
          </p>
          <p>
            Every sentence on this site lives in our code. A ruling is a template, picked and filled
            in from Jev's numbers, and nothing is generated when you ask. The site, templates and
            all, was built with{" "}
            <a href={CLAUDE_CODE_URL} rel="noopener">
              Claude Code
            </a>
            .
          </p>
          <p>
            Jev is named after William Stanley Jevons, who noticed that more efficient steam engines
            made Britain burn more coal, not less. TypeSafe expects cheaper intelligence to go the
            same way.
          </p>
        </article>

        <article>
          <h3>One order, {QUESTION_COUNT} questions</h3>
          <p>
            Each new food is one request. Jev answers every question at once, each on its own,
            against the same food name.
          </p>
          <ul>
            {groups.map(({ type, count, asks }) => (
              <li key={type}>
                <strong>
                  {count} {ANSWER_TYPE_NAMES[type][count === 1 ? 0 : 1]}:
                </strong>{" "}
                {joinList(asks)}.
              </li>
            ))}
          </ul>
          <p>
            Your browser turns those answers into the ruling card, so we can reword the card without
            asking Jev again.
          </p>
        </article>

        <article>
          <h3>Sure, probably, arguably</h3>
          <p>
            Jev gives a probability for every cube. TypeSafe trains those probabilities to be
            calibrated: across many answers, things Jev puts at 0.8 should come true about 80% of
            the time. That is a promise about crowds, not about your burrito.
          </p>
          <p>
            The headline word uses a different number.{" "}
            <a href={TYPESAFE.confidence} rel="noopener">
              Confidence
            </a>{" "}
            is a score TypeSafe works out from how lopsided the probabilities are, and it is not a
            probability itself. The headline says {VERDICT_ADVERBS.unanimous} at a confidence of{" "}
            {THRESHOLDS.unanimous} or more, {VERDICT_ADVERBS.majority} from {THRESHOLDS.majority},
            and {VERDICT_ADVERBS.split} below that. When cuberule.com has ruled, it says Officially
            instead.
          </p>
        </article>

        <article>
          <h3>The receipt</h3>
          <dl className="receipt">
            <div>
              <dt>Questions asked</dt>
              <dd>{QUESTION_COUNT}, in one request</dd>
            </div>
            <div>
              <dt>Rulebook sent</dt>
              <dd>about {formatCount(stats.tokens.avgInput)} tokens</dd>
            </div>
            <div>
              <dt>Numbers returned</dt>
              <dd>about {formatCount(stats.tokens.avgOutput)} tokens, free</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{formatUsd(stats.cost.pricePerMillionInputUsd)} per million input tokens</dd>
            </div>
            <div className="receipt__total">
              <dt>Each new ruling</dt>
              <dd>{perRuling}</dd>
            </div>
            <div>
              <dt>New rulings per dollar</dt>
              <dd>about {formatCount(rulingsPerDollar(stats))}</dd>
            </div>
            <div>
              <dt>Our whole {stats.items}-item test</dt>
              <dd>{formatUsd(stats.cost.runUsd)}</dd>
            </div>
            <div>
              <dt>A food someone already asked about</dt>
              <dd>usually $0</dd>
            </div>
            <div>
              <dt>Median Jev call</dt>
              <dd>{stats.latency.p50Ms} ms</dd>
            </div>
            <div>
              <dt>95th percentile</dt>
              <dd>{stats.latency.p95Ms} ms</dd>
            </div>
          </dl>
          <p className="jev__fine">
            The rulebook is long. Your food is short. The price is{" "}
            <a href={TYPESAFE.models} rel="noopener">
              TypeSafe's published rate
            </a>{" "}
            for {CUBE_MODEL}, and output tokens are free. A repeat food is usually served from
            Cloudflare's cache, so Jev usually isn't asked twice. The times come from our{" "}
            {stats.items}-item test: the developer's laptop calling TypeSafe's API directly, network
            included. A visit here also passes through Cloudflare, so yours may take a little
            longer.
          </p>
        </article>

        <article>
          <h3>How we grade it</h3>
          <p>
            We keep {stats.items} labelled items and ask Jev every question about each one. They
            come in three piles:
          </p>
          <dl className="jev__kinds">
            <div>
              <dt>Canon, {canon.all.n}</dt>
              <dd>
                Items cuberule.com has already ruled on, humans included. The app shows the official
                ruling for these anyway, so we only check whether Jev agrees.
              </dd>
            </div>
            <div>
              <dt>Tune, {stats.tune.n}</dt>
              <dd>
                Foods we labelled from the site's rules, plus probes. We looked at these freely
                while rewriting questions, so they flatter Jev.
              </dd>
            </div>
            <div>
              <dt>Holdout, {holdout.all.n}</dt>
              <dd>
                Labelled the same way, looked at only after each version of the questions was final,
                and never tuned against. This is the number to trust.
              </dd>
            </div>
          </dl>
          <p>
            A hash of each name decides between tune and holdout. Probes include things that aren't
            food, keyboard mash, a prompt injection, real dishes with rude-sounding names and
            abusive phrases, which are stored base64-encoded so they don't show up as plain text in
            the code.
          </p>
          <table className="jev__table">
            <caption>
              Question set {stats.questionSetVersion} on {stats.model}
            </caption>
            <thead>
              <tr>
                <th scope="col">Pile</th>
                <th scope="col">Right</th>
              </tr>
            </thead>
            <tbody>
              <tr className="jev__lead">
                <th scope="row">Holdout</th>
                <td>
                  <Scored tally={holdout.all} />
                </td>
              </tr>
              <tr>
                <th scope="row">Holdout, without the {holdoutNamed} named in the questions</th>
                <td>
                  <Scored tally={holdout.notInPrompt} />
                </td>
              </tr>
              <tr>
                <th scope="row">Tune</th>
                <td>
                  <Scored tally={stats.tune} />
                </td>
              </tr>
              <tr>
                <th scope="row">Canon agreement</th>
                <td>
                  <Scored tally={canon.all} />
                </td>
              </tr>
              <tr>
                <th scope="row">Food, not food or nonsense</th>
                <td>
                  <Scored tally={stats.inputKind} />
                </td>
              </tr>
              <tr>
                <th scope="row">Abusive phrases declined</th>
                <td>
                  <Scored tally={stats.abuse.declined} />, with {stats.abuse.falseDeclines.hits} of{" "}
                  {stats.abuse.falseDeclines.n} others wrongly declined
                </td>
              </tr>
            </tbody>
          </table>
          <p>
            On held-out foods, {formatTally(holdout.sure)} rulings we would print as{" "}
            {VERDICT_ADVERBS.unanimous} were right.
          </p>
          <p>
            Leaks, disclosed: {holdoutNamed} of the {holdout.all.n} holdout items and {canonNamed}{" "}
            of the {canon.all.n} canon items are named as worked examples in the questions that
            decide the ruling. A few more are named in the other questions, and some wording
            describes tune foods without naming them. Named items are easier, so treat every number
            here as a little generous.
          </p>
          <p>
            <a href={EVAL_DOC_URL} rel="noopener">
              docs/eval.md on GitHub
            </a>{" "}
            has the method, every tuning round and every miss.
          </p>
        </article>

        <article>
          <h3>Honest limits</h3>
          <ul>
            <li>
              <strong>Our test, our labels.</strong> It grades our reading of the Cube Rule. It is
              not a TypeSafe benchmark and says nothing about Jev at other jobs.
            </li>
            <li>
              <strong>Small numbers.</strong> One holdout item moves that score by{" "}
              {onePointOf(holdout.all)}.
            </li>
            <li>
              <strong>Name only.</strong> Jev never sees a photo. "Pie" could be a slice or a whole
              pie, and it has to guess.
            </li>
            <li>
              <strong>Literal reader.</strong>{" "}
              <a href={TYPESAFE.jaggedness} rel="noopener">
                TypeSafe's notes on Jev's weak spots
              </a>{" "}
              say it reads questions literally and can be steered by text written to game it.
            </li>
            <li>
              <strong>A smoke test for abuse.</strong> The abuse check has met{" "}
              {stats.abuse.declined.n} abusive phrases. That is a start, not a guarantee.
            </li>
            <li>
              <strong>Pinned model.</strong> We ask for {CUBE_MODEL} by name, so a new Jev release
              can't quietly change our answers.
            </li>
          </ul>
        </article>
      </div>
    </section>
  );
}
