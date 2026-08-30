/**
 * The panel behind a tank's share icon - spec 015.
 *
 * Four states, and the fourth is the one most share features get wrong:
 * not shared, working, shared, and FAILED WITH A REASON. A button that
 * silently does nothing when the Worker is not deployed is exactly the defect
 * spec 011 was written about, so every refusal here says what happened and
 * whether waiting will help.
 *
 * It also states, in words, what being shared actually means. A keeper should
 * not have to infer that the estimated value of their livestock is on a public
 * page; that decision was made deliberately (spec 015) and it is only
 * defensible if it is visible.
 */
import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import {
  currentShareState, publishTank, revokeTank, shareBlocker, shareUrlFor,
} from '@/data/share/client';
import { needsRepublish } from '@/data/share/snapshot';
import type { Aquarium } from '@/domain/types';
import { CheckIcon, LinkIcon, ShareNetworkIcon, XIcon } from './Icons';

const BLOCKED_REASON: Record<string, string> = {
  'not-configured': 'This build cannot share tanks. Only the deployed site can.',
  'signed-out': 'Sign in to share a tank.',
  offline: 'You are offline. Sharing needs a connection.',
};

export default function ShareSheet({ aquarium, onClose }: {
  aquarium: Pick<Aquarium, 'id' | 'name'>;
  onClose: () => void;
}) {
  const share = useLiveQuery(() => db.shares.get(aquarium.id), [aquarium.id]);
  const [busy, setBusy] = useState<'publishing' | 'revoking'>();
  const [problem, setProblem] = useState<string>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const blocked = shareBlocker();

  async function run(what: 'publishing' | 'revoking', fn: () => Promise<unknown>) {
    setBusy(what);
    setProblem(undefined);
    try {
      await fn();
    } catch (cause) {
      // Shown, never swallowed. The message carries the Worker's own words.
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function publish() {
    await run('publishing', async () => {
      const result = await publishTank(aquarium.id);
      setWarnings(result.warnings);
    });
  }

  async function copy() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(shareUrlFor(share.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (cause) {
      // A clipboard refusal is common (no permission, insecure context) and
      // recoverable - the field below is selectable, so say that.
      console.warn('[share] clipboard refused', { cause: String(cause) });
      setProblem('Could not copy. Select the link above and copy it by hand.');
    }
  }

  async function shareNatively() {
    if (!share) return;
    try {
      await navigator.share({
        title: aquarium.name,
        text: `${aquarium.name} on Fish2Tank`,
        url: shareUrlFor(share.token),
      });
    } catch (cause) {
      // Cancelling the OS sheet rejects. That is not a failure worth showing.
      console.info('[share] native share closed', { cause: String(cause) });
    }
  }

  return (
    <section className="card stack sharesheet">
      <div className="spread">
        <strong>Share {aquarium.name}</strong>
        <button type="button" className="btn--ghost" onClick={onClose} aria-label="Close">
          <XIcon size={18} aria-hidden="true" />
        </button>
      </div>

      {blocked && <p className="warn small" style={{ marginBottom: 0 }}>{BLOCKED_REASON[blocked]}</p>}

      {!share ? (
        <>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Creates a link anyone can open, with no account, to see this tank: its fish,
            where they swim, what they grow into, and its estimated value. You can turn it
            off at any time.
          </p>
          <button
            type="button" className="btn--primary"
            disabled={Boolean(blocked) || busy === 'publishing'}
            onClick={() => void publish()}
          >
            <ShareNetworkIcon size={18} aria-hidden="true" />
            {busy === 'publishing' ? ' Sharing…' : ' Share this tank'}
          </button>
        </>
      ) : (
        <>
          <label className="xs muted" htmlFor={`share-url-${aquarium.id}`}>
            Anyone with this link can see this tank
          </label>
          <input
            id={`share-url-${aquarium.id}`}
            className="sharesheet__url data"
            readOnly
            value={shareUrlFor(share.token)}
            onFocus={(e) => e.currentTarget.select()}
          />

          <div className="row">
            <button type="button" className="btn--ghost" onClick={() => void copy()}>
              {copied
                ? <><CheckIcon size={16} aria-hidden="true" /> Copied</>
                : <><LinkIcon size={16} aria-hidden="true" /> Copy link</>}
            </button>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <button type="button" className="btn--ghost" onClick={() => void shareNatively()}>
                <ShareNetworkIcon size={16} aria-hidden="true" /> Share…
              </button>
            )}
          </div>

          <ShareFreshness aquariumId={aquarium.id} share={share} />

          <div className="row">
            <button
              type="button" className="btn--ghost"
              disabled={Boolean(blocked) || busy === 'publishing'}
              onClick={() => void publish()}
            >
              {busy === 'publishing' ? 'Updating…' : 'Update what guests see'}
            </button>
            <button
              type="button" className="btn--danger"
              disabled={Boolean(blocked) || busy === 'revoking'}
              onClick={() => void run('revoking', () => revokeTank(aquarium.id))}
            >
              {busy === 'revoking' ? 'Stopping…' : 'Stop sharing'}
            </button>
          </div>
        </>
      )}

      {warnings.map((w) => (
        <p key={w} className="xs warn" style={{ marginBottom: 0 }}>{w}</p>
      ))}
      {problem && <p className="warn small" style={{ marginBottom: 0 }}>{problem}</p>}
    </section>
  );
}

/**
 * Whether the published page still matches the tank.
 *
 * Normally it does, because a shared tank republishes itself. This line is for
 * the case that cannot: edits made offline. Without it the only honest thing
 * to say would be nothing, and a keeper would have no way to tell a stale page
 * from a current one.
 */
function ShareFreshness({ aquariumId, share }: {
  aquariumId: string;
  share: { publishedAt: string; fingerprint: string; photoIncluded: boolean; lastError?: string };
}) {
  const current = useLiveQuery(() => currentShareState(aquariumId), [aquariumId]);

  if (share.lastError) {
    return (
      <p className="xs warn" style={{ marginBottom: 0 }}>
        The shared page is behind: {share.lastError} Use “Update what guests see” to retry.
      </p>
    );
  }

  // Undefined while the query is in flight. Saying nothing is right until it
  // is known, rather than flashing "up to date" and correcting itself.
  if (current === undefined) return null;

  const stale = needsRepublish(share, current);
  return (
    <>
      <p className="xs muted" style={{ marginBottom: 0 }}>
        {stale
          ? 'This tank has changed since the page was last published.'
          : `Guests are seeing the tank as it is now. Published ${new Date(share.publishedAt).toLocaleString()}.`}
      </p>
      {/* Only when there IS a photo that did not make it. A tank with no photo
          has nothing missing, and saying otherwise reads as a fault. */}
      {current.hasPhoto && !share.photoIncluded && (
        <p className="xs muted" style={{ marginBottom: 0 }}>
          The tank photo is not on the shared page yet. It reaches guests once your
          photos have synced and the page updates.
        </p>
      )}
    </>
  );
}
