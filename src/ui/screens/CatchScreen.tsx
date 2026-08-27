/**
 * Store mode - PRD 3.3, 4.2.
 *
 * "Silent, one-handed, camera-first, minimal typing." "Target: draft secured
 * within 10 seconds excluding upload." So this screen asks for nothing but
 * media: no species, no price, no story, no microphone (FR-C04). Everything
 * else happens later, at home, on the specimen page.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCatchDraft, type CaptureFile } from '@/data/repositories';
import { useRecentCatches } from '../hooks';
import { IdentityBadge } from '../components/Badges';

function kindOf(file: File): CaptureFile['kind'] {
  return file.type.startsWith('video') ? 'video' : 'photo';
}

export default function CatchScreen() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const recent = useRecentCatches(5);

  async function onFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setSaving(true);
    setError(undefined);
    try {
      const files: CaptureFile[] = Array.from(fileList).map((f) => ({
        kind: kindOf(f),
        blob: f,
        mimeType: f.type || 'application/octet-stream',
      }));
      // A per-capture key so a retry after a failure reuses the same draft
      // rather than creating a second catch (FR-C07).
      const draft = await createCatchDraft({ files, clientKey: crypto.randomUUID() });
      navigate(`/specimen/${draft.specimen.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that catch.');
    } finally {
      setSaving(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="stack">
      <header>
        <h1>Catch</h1>
        <p className="muted small">
          Media is all this needs. Confirm the species, price and story whenever you like — the draft is
          already yours.
        </p>
      </header>

      <input
        ref={inputRef}
        id="capture"
        type="file"
        accept="image/*,video/*"
        // Opens the camera directly on supported mobile browsers; the picker
        // is the fallback everywhere else (FR-C01).
        capture="environment"
        multiple
        className="visually-hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />

      <button
        type="button"
        className="btn btn--primary btn--big"
        disabled={saving}
        onClick={() => inputRef.current?.click()}
      >
        {saving ? 'Securing draft…' : '◉  Capture'}
      </button>

      {error && <p className="warn">{error}</p>}

      <p className="xs muted">
        Saved on this device first. Nothing is shared, and no sound is recorded or played.
      </p>

      <hr />

      <h2>Recent catches</h2>
      {recent === undefined && <p className="muted small">Loading…</p>}
      {recent?.length === 0 && (
        <p className="empty">Nothing caught yet. The next store visit is the first one.</p>
      )}
      <ul className="list">
        {recent?.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="card spread"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => navigate(`/specimen/${s.id}`)}
            >
              <span>
                <strong>{s.nickname ?? s.rawLabel ?? 'Mystery Catch'}</strong>
                <br />
                <span className="xs muted data">{new Date(s.createdAt).toLocaleString()}</span>
              </span>
              <IdentityBadge status={s.identityStatus} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
