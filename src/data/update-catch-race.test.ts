import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from '@/data/db';
import { createCatchDraft, updateCatch } from '@/data/repositories';

let db: Fish2TankDB;
beforeEach(async () => {
  db = new Fish2TankDB(`test_${crypto.randomUUID()}`);
  await db.open();
});

const photo = () => ({ kind: 'photo' as const,
  blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), mimeType: 'image/jpeg' });

/**
 * BUG-16, spec 043. Every field on the record saves on its own since spec
 * 039/041, so a finger moving from one to the next fires two commits
 * milliseconds apart. `updateCatch` used to read the whole record and write
 * every field back, so the second commit carried state from before the first
 * landed - a lost update by construction.
 *
 * Both directions are guarded, because the bug had both: an edit that vanished,
 * and a value the keeper had CLEARED coming back.
 */
describe('updateCatch under concurrent edits (BUG-16)', () => {
  it('does not lose one field when two are saved at once', async () => {
    const draft = await createCatchDraft({ clientKey: 'k', files: [photo()] }, db);
    const id = draft.specimen.id;

    // Two inline fields committing at the same moment - which is what a form
    // of always-live inputs does when a finger moves from one to the next.
    await Promise.all([
      updateCatch({ specimenId: id, nickname: 'the Panther' }, db),
      updateCatch({ specimenId: id, rawLabel: 'Cuckoo catfish' }, db),
    ]);

    const after = await db.specimens.get(id);
    expect(after?.nickname).toBe('the Panther');
    expect(after?.rawLabel).toBe('Cuckoo catfish');
  });

  it('does not resurrect a value the keeper just cleared', async () => {
    const draft = await createCatchDraft({ clientKey: 'k2', rawLabel: 'old', files: [photo()] }, db);
    const id = draft.specimen.id;
    await updateCatch({ specimenId: id, nickname: 'Panther' }, db);

    await Promise.all([
      updateCatch({ specimenId: id, nickname: null }, db),
      updateCatch({ specimenId: id, rawLabel: 'new' }, db),
    ]);

    const after = await db.specimens.get(id);
    expect(after?.nickname).toBeUndefined();
    expect(after?.rawLabel).toBe('new');
  });
});
