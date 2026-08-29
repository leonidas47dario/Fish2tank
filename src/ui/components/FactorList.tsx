/**
 * The inspectable working behind a verdict - FR-E04.
 *
 * "Expose every factor, input, source, and rules version behind a verdict.
 * User can inspect which tank or species values created each warning."
 *
 * Everything is still rendered: the factors that passed, the ones that failed,
 * and the ones that could not be evaluated at all. Hiding the clean passes
 * would make the screen calmer and the reasoning less checkable.
 *
 * What changed is the shape. Each factor used to be a full card with an
 * expandable body, seven of them per tank and six tanks, which is what made
 * this screen 20,286px tall. Now a factor is one line - name, and the outcome
 * in a phrase - and the exact stored values that produced it are one tap
 * behind that line. The information is all still here; it is no longer all
 * shouting at once.
 */
import type { CompatibilityAssessment, FactorResult, Verdict } from '@/domain/types';

const FACTOR_NAMES: Record<string, string> = {
  'minimum-enclosure': 'Minimum enclosure',
  'adult-size': 'Adult size',
  aggression: 'Aggression',
  predation: 'Predation',
  'water-overlap': 'Water overlap',
  'social-needs': 'Social needs',
  crowding: 'Crowding',
};

/**
 * Four tones for five verdicts: high risk and extreme risk both read as bad
 * here, because the row above already carries which of the two it is and a
 * factor line has no room to re-litigate severity.
 *
 * The glyph is attached in CSS via `content: '■' / ''`, which supplies alt
 * text of "" so a screen reader announces the phrase and not the shape.
 */
const TONE: Record<Verdict, string> = {
  suitable: 'ok',
  conditional: 'warn',
  'high-risk': 'bad',
  'extreme-risk': 'bad',
  'insufficient-data': 'unknown',
};

/** The phrase on the line when the engine did not write a reason. */
const FALLBACK: Record<Verdict, string> = {
  suitable: 'fine',
  conditional: 'needs care',
  'high-risk': 'risky',
  'extreme-risk': 'unsafe',
  'insufficient-data': 'cannot check',
};

export function FactorList({ assessment, tankName }: {
  assessment: CompatibilityAssessment;
  /** Named, so it is never ambiguous which tank these factors describe. */
  tankName?: string;
}) {
  const severe = assessment.factors.some(
    (f) => f.verdict === 'high-risk' || f.verdict === 'extreme-risk',
  );

  return (
    <div className={`factors${severe ? ' factors--severe' : ''}`}>
      {tankName && <p className="factors__head">Why, for {tankName}</p>}

      {assessment.factors.map((f) => <Factor key={f.factor} f={f} />)}

      <p className="xs faint data" style={{ margin: 'var(--space-3) 0 0' }}>
        Rules version {assessment.rulesVersion}
      </p>
    </div>
  );
}

function Factor({ f }: { f: FactorResult }) {
  const tone = TONE[f.verdict];
  const phrase = f.reason ?? FALLBACK[f.verdict];
  const hasDetail = f.inputsUsed.length > 0 || f.missingInputs.length > 0;

  // A clean pass with nothing stored behind it is a line, not a control. Making
  // it look tappable and then doing nothing is worse than not offering it.
  if (!hasDetail) {
    return (
      <div className="factor">
        <span className="factor__name">{FACTOR_NAMES[f.factor] ?? f.factor}</span>
        <span className={`factor__val factor__val--${tone}`}>{phrase}</span>
      </div>
    );
  }

  return (
    <details className="factor-item">
      <summary className="factor">
        <span className="factor__name">{FACTOR_NAMES[f.factor] ?? f.factor}</span>
        <span className={`factor__val factor__val--${tone}`}>{phrase}</span>
      </summary>

      {f.inputsUsed.length > 0 && (
        <dl className="factor__detail">
          {f.inputsUsed.map((i) => (
            <div key={`${i.label}:${i.value}`} className="spread">
              <dt>{i.label}</dt>
              <dd className="data" style={{ margin: 0 }}>{i.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {f.missingInputs.length > 0 && (
        <div className="factor__detail">
          <p style={{ margin: '0 0 2px' }}>Could not check</p>
          <ul className="list">
            {f.missingInputs.map((m) => <li key={m}>— {m}</li>)}
          </ul>
        </div>
      )}
    </details>
  );
}

/** FR-E05: the checklist of what is missing, never an inferred green. */
export function MissingInputsNotice({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <div className="state">
      <p className="state__head">What this needs before it can be judged</p>
      <ul className="list state__body">
        {missing.map((m) => <li key={m}>— {m}</li>)}
      </ul>
      <p className="xs faint" style={{ margin: 0 }}>
        Missing facts never turn into a safe answer. Fill these in and run the check again.
      </p>
    </div>
  );
}
