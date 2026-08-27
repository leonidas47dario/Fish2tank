/**
 * Tanks - PRD 4.1, 4.8.
 *
 * A tank with no measurements is shown as unmeasured rather than assumed
 * average, because the screening engine's honesty depends on the difference
 * (FR-E05). Editing the dimensions here is what turns "Not enough data" into
 * a real verdict.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { moveHolding, recordDeath } from '@/data/repositories';
import { formatVolume } from '@/domain/units';
import type { Aquarium, StockingState } from '@/domain/types';
import { useTanksWithResidents } from '../hooks';

export default function Tanks() {
  const tanks = useTanksWithResidents();
  const allTanks = useLiveQuery(() => db.aquariums.toArray(), []);
  const [editing, setEditing] = useState<string | undefined>();

  return (
    <div className="stack">
      <header>
        <h1>Tanks</h1>
        <p className="muted small">Your real aquariums, and who actually lives in them.</p>
      </header>

      {tanks?.map(({ aquarium, residents }) => (
        <section key={aquarium.id} className="card stack">
          <div className="spread">
            <span>
              <strong>{aquarium.name}</strong><br />
              <span className="xs muted data">
                {aquarium.volume ? formatVolume(aquarium.volume) : 'volume unrecorded'}
                {aquarium.dimensions
                  ? ` · ${aquarium.dimensions.length.value}×${aquarium.dimensions.width.value}×${aquarium.dimensions.height.value}${aquarium.dimensions.length.unit}`
                  : ' · unmeasured'}
              </span>
            </span>
            <button type="button" className="btn--ghost" onClick={() => setEditing(editing === aquarium.id ? undefined : aquarium.id)}>
              {editing === aquarium.id ? 'Done' : 'Edit'}
            </button>
          </div>

          {!aquarium.volume && (
            <p className="warn">
              Without a volume and footprint this tank can only ever return “Not enough data”. Measuring it
              once is what makes every future check real.
            </p>
          )}

          {editing === aquarium.id && <TankForm aquarium={aquarium} onDone={() => setEditing(undefined)} />}

          <div>
            <p className="xs muted">Residents</p>
            {residents.length === 0 && <p className="muted small">Empty.</p>}
            <ul className="list">
              {residents.map(({ holding, quantity, badge }) => (
                <li key={holding.id} className="card card--raised stack">
                  <div className="spread">
                    <span>
                      <strong>{holding.rawLabel ?? 'Unnamed holding'}</strong>
                      <span className="muted data"> ×{quantity}</span><br />
                      {holding.category && <span className="xs muted">{holding.category}</span>}
                    </span>
                    {badge === 'current' && <span className="badge badge--suitable"><span aria-hidden="true">✓</span> Current</span>}
                  </div>
                  {holding.notes && <p className="xs muted" style={{ marginBottom: 0 }}>{holding.notes}</p>}
                  <div className="row">
                    <select
                      defaultValue=""
                      aria-label={`Move ${holding.rawLabel ?? 'holding'} to another tank`}
                      onChange={(e) => { if (e.target.value) void moveHolding(holding.id, e.target.value); }}
                    >
                      <option value="" disabled>Move to…</option>
                      {allTanks?.filter((t) => t.id !== aquarium.id).map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn--ghost"
                      onClick={() => void recordDeath({ holdingId: holding.id, quantity: 1 })}
                    >
                      Record a loss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}

function TankForm({ aquarium, onDone }: { aquarium: Aquarium; onDone: () => void }) {
  const [gallons, setGallons] = useState(aquarium.volume ? String(aquarium.volume.value) : '');
  const [l, setL] = useState(aquarium.dimensions ? String(aquarium.dimensions.length.value) : '');
  const [w, setW] = useState(aquarium.dimensions ? String(aquarium.dimensions.width.value) : '');
  const [h, setH] = useState(aquarium.dimensions ? String(aquarium.dimensions.height.value) : '');
  const [stocking, setStocking] = useState<StockingState | ''>(aquarium.stockingState ?? '');

  async function save() {
    const dims = l && w && h
      ? {
          length: { value: Number(l), unit: 'in' as const },
          width: { value: Number(w), unit: 'in' as const },
          height: { value: Number(h), unit: 'in' as const },
        }
      : undefined;
    await db.aquariums.update(aquarium.id, {
      volume: gallons ? { value: Number(gallons), unit: 'gal' } : undefined,
      dimensions: dims,
      stockingState: stocking || undefined,
    });
    onDone();
  }

  return (
    <div className="stack">
      <div>
        <label htmlFor={`vol-${aquarium.id}`}>Volume (gallons)</label>
        <input id={`vol-${aquarium.id}`} inputMode="decimal" value={gallons} onChange={(e) => setGallons(e.target.value)} />
      </div>
      <div className="row">
        <div className="grow"><label htmlFor={`l-${aquarium.id}`}>Length (in)</label>
          <input id={`l-${aquarium.id}`} inputMode="decimal" value={l} onChange={(e) => setL(e.target.value)} /></div>
        <div className="grow"><label htmlFor={`w-${aquarium.id}`}>Width</label>
          <input id={`w-${aquarium.id}`} inputMode="decimal" value={w} onChange={(e) => setW(e.target.value)} /></div>
        <div className="grow"><label htmlFor={`h-${aquarium.id}`}>Height</label>
          <input id={`h-${aquarium.id}`} inputMode="decimal" value={h} onChange={(e) => setH(e.target.value)} /></div>
      </div>
      <div>
        <label htmlFor={`stock-${aquarium.id}`}>How full does it feel?</label>
        <select id={`stock-${aquarium.id}`} value={stocking} onChange={(e) => setStocking(e.target.value as StockingState | '')}>
          <option value="">Not saying</option>
          <option value="low">Low</option>
          <option value="moderate">Moderate</option>
          <option value="crowded">Crowded</option>
        </select>
        <p className="xs muted">Your judgement, used as-is. Nothing here is turned into a bioload figure.</p>
      </div>
      <button type="button" className="btn--primary" onClick={() => void save()}>Save</button>
    </div>
  );
}
