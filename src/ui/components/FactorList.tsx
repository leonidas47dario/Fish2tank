/**
 * The inspectable working behind a verdict - FR-E04.
 *
 * "Expose every factor, input, source, and rules version behind a verdict.
 * User can inspect which tank or species values created each warning."
 *
 * Everything is rendered: the factors that passed, the ones that failed, and
 * the ones that could not be evaluated at all. Hiding the clean passes would
 * make the screen calmer and the reasoning less checkable.
 */
import type { CompatibilityAssessment, FactorId } from '@/domain/types';
import { VerdictBadge } from './Badges';

const FACTOR_NAMES: Record<FactorId, string> = {
  'minimum-enclosure': 'Minimum enclosure',
  'adult-size': 'Adult size',
  aggression: 'Aggression',
  predation: 'Predation',
  'water-overlap': 'Water overlap',
  'social-needs': 'Social needs',
  crowding: 'Crowding',
};

export function FactorList({ assessment }: { assessment: CompatibilityAssessment }) {
  return (
    <div className="stack">
      {assessment.factors.map((f) => (
        <details key={f.factor} className="card">
          <summary className="spread" style={{ cursor: 'pointer', listStyle: 'none' }}>
            <strong>{FACTOR_NAMES[f.factor]}</strong>
            <VerdictBadge verdict={f.verdict} />
          </summary>

          {f.reason && <p className="small" style={{ marginTop: 'var(--space-3)' }}>{f.reason}</p>}

          {f.inputsUsed.length > 0 && (
            <>
              <p className="xs muted" style={{ margin: 'var(--space-3) 0 var(--space-1)' }}>Values used</p>
              <dl className="kv">
                {f.inputsUsed.map((i) => (
                  <div key={`${i.label}:${i.value}`} style={{ display: 'contents' }}>
                    <dt>{i.label}</dt>
                    <dd>{i.value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {f.missingInputs.length > 0 && (
            <>
              <p className="xs muted" style={{ margin: 'var(--space-3) 0 var(--space-1)' }}>Could not check</p>
              <ul className="list small">
                {f.missingInputs.map((m) => <li key={m}>— {m}</li>)}
              </ul>
            </>
          )}
        </details>
      ))}

      <p className="xs muted data">Rules version {assessment.rulesVersion}</p>
    </div>
  );
}

/** FR-E05: the checklist of what is missing, never an inferred green. */
export function MissingInputsNotice({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <div className="card">
      <h3>What this needs before it can be judged</h3>
      <ul className="list small">
        {missing.map((m) => <li key={m}>— {m}</li>)}
      </ul>
      <p className="xs muted" style={{ marginTop: 'var(--space-3)', marginBottom: 0 }}>
        Missing facts never turn into a safe answer. Fill these in and run the check again.
      </p>
    </div>
  );
}
