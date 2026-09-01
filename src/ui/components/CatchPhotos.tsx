/**
 * The pictures of one fish, on its own record - spec 020.
 *
 * WHAT THIS REPLACES. The record showed `media[0]` inside a passive plate and
 * offered no way to add anything, so the only route to photographing a fish
 * you keep ran through the species page's "Card art" panel. That is the wrong
 * place twice over: a photo is of a fish, not of a species, and the panel then
 * had to ask which of your fish you meant. On a record there is nothing to
 * ask.
 *
 * It also meant photos two onward were unreachable. `useSpecimenMedia` has
 * always returned every one of them; only the first was ever drawn.
 *
 * The empty plate IS the button. A striped rectangle saying "no media" next to
 * a separate control somewhere else is two things where the keeper sees one.
 *
 * No `capture` attribute, deliberately. It looks like a helpful default and on
 * iOS it forces the camera and removes the photo library, which is wrong for a
 * fish you already own and photographed last year.
 */
import { useRef, useState } from 'react';
import { addPhotos, type CaptureFile } from '@/data/repositories';
import type { Id } from '@/domain/types';
import { useSpecimenMedia } from '../hooks';
import { PlusIcon } from './Icons';

interface Props {
  specimenId: Id;
  /** Alt text and labels read better with the fish's name in them. */
  title: string;
  /** FR-R04 / NFR-06: a video must not autoplay sound at someone. */
  reducedMotion: boolean;
}

export function CatchPhotos({ specimenId, title, reducedMotion }: Props) {
  const media = useSpecimenMedia(specimenId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [shownId, setShownId] = useState<Id | undefined>();

  // Newest first, so a record with no explicit choice shows the latest photo.
  // Falls back rather than pins: the chosen one can be deleted from elsewhere.
  const shown = media?.find((m) => m.media.id === shownId) ?? media?.[0];

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setSaving(true);
    setError(undefined);
    const files: CaptureFile[] = Array.from(list).map((f) => ({
      kind: f.type.startsWith('video') ? 'video' : 'photo',
      blob: f,
      mimeType: f.type || 'application/octet-stream',
    }));
    try {
      const added = await addPhotos({ specimenId, files });
      console.info('[photos] added to catch', {
        specimenId, count: added.length, ids: added.map((m) => m.id),
      });
      // Show what was just taken rather than leaving the old picture up.
      if (added[0]) setShownId(added[0].id);
    } catch (e) {
      console.error('[photos] adding to catch failed', { specimenId, error: e });
      setError(e instanceof Error ? e.message : 'Could not save that photo.');
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const pick = () => fileRef.current?.click();

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="visually-hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />

      <div className="hero-plate">
        {shown ? (
          <span className="plate">
            {shown.media.kind === 'video' ? (
              <video className="plate__img" src={shown.url} controls playsInline muted={reducedMotion} />
            ) : (
              <img className="plate__img" src={shown.url} alt={`Your photo of ${title}`} />
            )}
          </span>
        ) : (
          <button type="button" className="plate plate--action" onClick={pick} disabled={saving}>
            <span className="plate__img plate__img--none">
              <span className="plate__none-text">
                {saving ? 'Saving…' : 'Add a photo'}
              </span>
            </span>
          </button>
        )}
      </div>

      {media && media.length > 0 && (
        <div className="pad">
          <div className="photo-strip">
            {media.map(({ media: m, url }) => (
              <button
                key={m.id}
                type="button"
                className={`photo-strip__item${m.id === shown?.media.id ? ' photo-strip__item--on' : ''}`}
                aria-pressed={m.id === shown?.media.id}
                aria-label={`Show this ${m.kind} of ${title}`}
                onClick={() => setShownId(m.id)}
              >
                {m.kind === 'video'
                  ? <video src={url} muted playsInline preload="metadata" />
                  : <img src={url} alt="" loading="lazy" />}
              </button>
            ))}
            <button
              type="button"
              className="photo-strip__item photo-strip__item--add"
              onClick={pick}
              disabled={saving}
              aria-label={`Add another photo of ${title}`}
            >
              <PlusIcon size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {error && <p className="warn pad">{error}</p>}
    </>
  );
}
