/**
 * Fish Heaven - the index of timelines that ended (spec 046, FH-1/FH-2).
 *
 * SPEC 037 ENDED WITH A CLAIM THIS SCREEN MAKES GOOD ON: a memorial is not a
 * card with a date on it, it is a fish's whole timeline with an end. So this
 * adds almost no storage - the life events, the photographs, the measurements
 * and the memorial are all already written and already dated. What was missing
 * was a place to read them.
 *
 * FR-L03 IS THE HARDEST CONSTRAINT HERE: "a gentle, dignified tone rather than
 * a stats-heavy reward screen". Every number on this screen is a fact about an
 * animal and none of them is a score. Nothing is ranked, nothing is totalled
 * across fish, and no tier, rarity band or completion percentage appears.
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { readMediaBlob } from '@/data/media/read';
import { useBlobUrls } from '../blob-url';
import { ButterflyIcon } from '../components/Icons';
import { CATALOG_BY_SPECIES } from '@/data/catalog';
import type { Id } from '@/domain/types';

/** `2026-04-19` → `19 Apr 2026`, parsed as UTC so no timezone moves a day. */
export function longDate(on: string): string {
  const parsed = Date.parse(`${on}T00:00:00Z`);
  if (Number.isNaN(parsed)) return on;
  return new Date(parsed).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

export default function Heaven() {
  const rows = useLiveQuery(async () => {
    const memorials = (await db.memorials.toArray())
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
    const holdings = await db.holdings.toArray();
    const specimens = await db.specimens.toArray();

    const out = [];
    for (const memorial of memorials) {
      const holding = holdings.find((h) => h.id === memorial.holdingId);
      const specimen = memorial.specimenId
        ? specimens.find((s) => s.id === memorial.specimenId)
        : specimens.find((s) => s.id === holding?.specimenId);

      // The LAST photograph, which is the one a keeper looks for. Thumbnail:
      // this is a 96px square (spec 036's rule).
      let blob: Blob | undefined;
      if (specimen) {
        const media = (await db.media.where('specimenIds').equals(specimen.id).toArray())
          .filter((m) => m.kind === 'photo')
          .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
        const last = media[media.length - 1];
        if (last) blob = await readMediaBlob(last, 'thumbnail');
      }

      const speciesId = specimen?.speciesId ?? holding?.speciesId;
      out.push({
        id: memorial.id,
        memorial,
        name: specimen?.nickname
          ?? holding?.rawLabel
          ?? (speciesId ? CATALOG_BY_SPECIES.get(speciesId)?.commonName : undefined)
          ?? 'A fish',
        blob,
      });
    }
    return out;
  }, []);

  // Memoised: `useBlobUrls` re-mints on every change of identity of the array
  // it is handed, and an inline `.filter()` is a new array every render.
  const withPhotos = useMemo(
    () => rows?.filter((r): r is typeof r & { blob: Blob } => Boolean(r.blob)),
    [rows],
  );
  const urls = useBlobUrls(withPhotos);
  const byId = new Map(urls.map((u) => [u.id as Id, u.url]));

  return (
    <div className="screen">
      <header className="pad">
        <h1 className="specimen-name">
          <ButterflyIcon size={22} aria-hidden="true" /> Fish Heaven
        </h1>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Still part of every tank they lived in.
        </p>
      </header>

      {rows === undefined && <p className="empty muted">Loading…</p>}

      {rows?.length === 0 && (
        <div className="prompt">
          <p className="prompt__title">Nobody here</p>
          <p className="prompt__body">
            When a fish dies you can record it from its own page. Everything you
            wrote and photographed stays with it.
          </p>
        </div>
      )}

      <ul className="list pad">
        {rows?.map((row) => (
          <li key={row.id}>
            <Link to={`/heaven/${row.id}`} className="heaven-card">
              <span className="heaven-card__art">
                {byId.get(row.id)
                  ? <img src={byId.get(row.id)} alt="" loading="lazy" />
                  : <ButterflyIcon size={22} aria-hidden="true" />}
              </span>
              <span className="heaven-card__body">
                <strong>{row.name}</strong>
                {/* A span of time, where a tank card reads as capacity. */}
                <span className="xs muted data">
                  Remembered {longDate(row.memorial.occurredOn)}
                </span>
                {row.memorial.story && (
                  <span className="xs muted heaven-card__story">{row.memorial.story}</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
