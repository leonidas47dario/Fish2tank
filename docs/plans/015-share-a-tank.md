# Share a tank — implementation plan

> **For agentic workers:** steps use checkbox (`- [ ]`) syntax for tracking.
> Spec: `docs/specs/015-share-a-tank.md`.

**Goal:** A share icon on every tank card publishes a frozen, read-only page at
an unguessable URL that anyone can open without an account, and that prompts a
guest to sign up when they heart a fish.

**Architecture:** One R2 object, `shared/{token}.json`, holds both the frozen
view and the list of photo keys the link may read. The existing Worker gains
two authenticated routes (publish, revoke) and two public ones (read, media),
the public media route answering with a 302 to a presigned URL so bytes still
never pass through it. The guest view renders the *same* presentational
components as the owner's tank view, which is why those get extracted first.

**Tech stack:** React 18, react-router 6 (`HashRouter`), Dexie 4 +
`dexie-cloud-addon`, Cloudflare Workers + R2 via `aws4fetch`, Vitest.

---

## Two findings that shape the plan

1. **Resident tiles use bundled stock portraits**, not the keeper's own photos
   (`portraitAsset()`, `src/data/catalog.ts:94`, reads a Vite glob). The only
   private photo in a tank view is the tank photo. A manifest names 0 or 1
   keys, not one per fish. The key list stays a list anyway — it is the
   membership check that makes the media route safe, and a list costs nothing.
2. **No R2 binding is needed.** The Worker already signs S3 requests with
   `aws4fetch`; `aws.fetch()` can GET and PUT the manifest directly.
   `wrangler.toml` is untouched.

## File structure

| File | Responsibility |
|---|---|
| `src/data/share/snapshot.ts` | **Create.** Pure projection: live tank → publishable snapshot. Derives the key list from the projection. |
| `src/data/share/snapshot.test.ts` | **Create.** Field-by-field allowlist assertions. |
| `src/data/share/client.ts` | **Create.** Publish and revoke over HTTP, with the verify-then-report logging. |
| `src/data/share/pending-intent.ts` | **Create.** The action that survives a sign-in redirect. |
| `src/data/share/pending-intent.test.ts` | **Create.** Round-trip and expiry. |
| `src/data/db.ts` | **Modify.** v5 adds a `shares` table. |
| `src/data/repositories.ts` | **Modify.** `recordShare`, `forgetShare`, `shareFor`. |
| `worker/src/index.ts` | **Modify.** Per-route auth; four new routes. |
| `worker/src/index.test.ts` | **Modify.** Access-control tests for all four. |
| `src/ui/components/tank/TankViewer.tsx` | **Create.** The read-only dashboard, props-only. Moved verbatim from `TankDetail.tsx`. |
| `src/ui/screens/TankDetail.tsx` | **Modify.** Imports the above; keeps everything that writes. |
| `src/ui/screens/SharedTank.tsx` | **Create.** The guest view. |
| `src/ui/components/ShareSheet.tsx` | **Create.** The share icon's panel. |
| `src/ui/screens/Tanks.tsx` | **Modify.** Share icon on each card. |
| `src/App.tsx` | **Modify.** `/share/:token` outside `AuthGate`. |
| `src/ui/components/Icons.tsx` | **Modify.** Re-export `ShareNetworkIcon`, `HeartIcon`. |

---

### Task 1: The snapshot projection

**Files:** Create `src/data/share/snapshot.ts`, `src/data/share/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

Three tests. The first is the one that matters: it asserts the projection's
keys **exactly**, so a field added to `Holding` later cannot silently start
being published.

```ts
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from './snapshot';
import type { TankResident } from '@/domain/tank-stats';

const aquarium = {
  id: 'aq_1', name: 'Deep Sea Collector', kind: 'display', status: 'active',
  volume: { value: 75, unit: 'gal' }, createdAt: '2026-01-01T00:00:00.000Z',
} as never;

const resident = {
  holding: { id: 'h_1', speciesId: 'sp_betta', rawLabel: 'Betta', openingBalance: 1,
             notes: 'PRIVATE - bought with the birthday money' },
  quantity: 2, speciesId: 'sp_betta', commonName: 'Betta',
  scientificName: 'Betta splendens', portraitUrl: '/assets/sp_betta.jpg',
  adultSizeIn: 2.5, minVolumeGal: 5, aggression: 'semi-aggressive',
  waterZone: 'top', unitPrice: 12,
} as unknown as TankResident;

describe('buildSnapshot', () => {
  it('publishes exactly the allowed resident fields and nothing else', () => {
    const snap = buildSnapshot({ aquarium, residents: [resident], tankPhotoBlobKey: undefined,
      token: 'tok_1', publishedAt: '2026-08-30T12:00:00.000Z', buildId: 'b1' });
    expect(Object.keys(snap.residents[0]!).sort()).toEqual([
      'adultSizeIn', 'aggression', 'commonName', 'minVolumeGal', 'quantity',
      'scientificName', 'speciesId', 'unitPrice', 'waterZone',
    ]);
    expect(JSON.stringify(snap)).not.toContain('PRIVATE');
    expect(JSON.stringify(snap)).not.toContain('h_1');
  });

  it('permits exactly the photo keys the view references', () => {
    const none = buildSnapshot({ aquarium, residents: [resident], tankPhotoBlobKey: undefined,
      token: 't', publishedAt: 'now', buildId: 'b' });
    expect(none.allowedBlobKeys).toEqual([]);
    expect(none.tank.photoBlobKey).toBeUndefined();

    const one = buildSnapshot({ aquarium, residents: [resident], tankPhotoBlobKey: 'blob_x',
      token: 't', publishedAt: 'now', buildId: 'b' });
    expect(one.allowedBlobKeys).toEqual(['blob_x']);
    expect(one.tank.photoBlobKey).toBe('blob_x');
  });

  it('carries the stats the owner computed, so a guest recomputes nothing', () => {
    const snap = buildSnapshot({ aquarium, residents: [resident], tankPhotoBlobKey: undefined,
      token: 't', publishedAt: 'now', buildId: 'b' });
    expect(snap.stats.fish).toBe(2);
    expect(snap.stats.species).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

`npx vitest run src/data/share/snapshot.test.ts` → FAIL, no such module.

- [ ] **Step 3: Implement**

`buildSnapshot` calls `summariseTank(residents)` from `@/domain/tank-stats` for
`stats`, and maps residents through an explicit field list — **never a spread**.
`allowedBlobKeys` is computed from the built projection, not from the inputs,
so the two cannot disagree. Types `SharedSnapshot` and `PublicSnapshot` are
exported; `PublicSnapshot` is `Omit<SharedSnapshot, 'owner' | 'allowedBlobKeys'>`.

- [ ] **Step 4: Green.** Same command. Expect 3 passed.
- [ ] **Step 5: Prove the first test has teeth.** Temporarily change the
  resident map to `{ ...r, ...allowedFields }`. Expect the first test to FAIL on
  `PRIVATE`. Revert.
- [ ] **Step 6: Commit** `feat(share): project a tank into a publishable snapshot`

---

### Task 2: The local record of what is shared

**Files:** Modify `src/data/db.ts`, `src/data/repositories.ts`; create `src/data/share/shares.test.ts`

- [ ] **Step 1: Check `UNSYNCED_TABLES` in `src/data/environment.ts`.** The
  `shares` table must NOT be listed, so that revoking from a laptop is visible
  on a phone. Note in the docstring that this is deliberate.
- [ ] **Step 2: Write the failing test** — `recordShare` then `shareFor`
  returns the token; `forgetShare` clears it; recording twice for one tank
  replaces rather than duplicates (the table is keyed by `aquariumId`).
- [ ] **Step 3: Run it, watch it fail.**
- [ ] **Step 4: Implement.** `db.version(5).stores({ shares: 'aquariumId, token' })`,
  interface `ShareRecord { aquariumId, token, publishedAt, photoIncluded }`.
  A pure addition, so no upgrade function — say so in the comment, as v2 and v3 do.
- [ ] **Step 5: Green. Step 6: Commit** `feat(share): remember which tanks are shared`

---

### Task 3: The Worker routes

**Files:** Modify `worker/src/index.ts`, `worker/src/index.test.ts`

This is the highest-risk task in the plan: the existing blanket
`authenticate()` at the top of `fetch` becomes per-route, and getting that
wrong makes every photo route public.

- [ ] **Step 1: Write the failing tests.** Add to `worker/src/index.test.ts`,
  reusing its existing `env`, `validFor()` and token-sequence helpers:

```ts
describe('share routes', () => {
  it('still refuses an anonymous caller on the AUTHENTICATED routes', async () => {
    for (const r of ['/presign/put', '/presign/get', '/head', '/shared']) {
      const res = await worker.fetch(post(r, { blobKey: 'blob_a' }, { token: null }), env);
      expect(res.status, r).toBe(401);
    }
  });

  it('404s an unknown token', async () => { /* R2 GET → 404 → expect 404 */ });

  it('refuses a blob key the manifest does not name', async () => {
    /* manifest allows ['blob_ok']; request blob_evil; expect 403 and NO presign */
  });

  it('302s to a presigned URL for a key the manifest names', async () => {
    /* expect 302, Location host contains r2.cloudflarestorage.com */
  });

  it('strips owner and allowedBlobKeys from the public read', async () => {
    const body = await (await worker.fetch(get('/shared/tok'), env)).json();
    expect(body.owner).toBeUndefined();
    expect(body.allowedBlobKeys).toBeUndefined();
    expect(body.tank.name).toBe('Deep Sea Collector');
  });

  it('refuses a delete from someone who is not the owner', async () => {
    /* manifest.owner = 'ryan'; token sub = 'stranger'; expect 403, no DELETE issued */
  });

  it('refuses a token that is not a plain uuid', async () => {
    /* '../../users/ryan' must not reach R2 at all */
  });
});
```

  A `get(route)` helper is needed alongside the existing `post()`; the public
  routes are GET and carry no `Authorization` header.

- [ ] **Step 2: Run, watch them fail.** `npx vitest run worker/`
- [ ] **Step 3: Implement.** In order:
  1. `safeToken(value)` — `/^[A-Za-z0-9-]{8,64}$/`, mirroring `safeBlobKey`.
  2. Move `authenticate()` out of the top of `fetch` into the routes that need
     it. Public routes: `GET /shared/{token}`, `GET /shared/{token}/media/{key}`.
     Everything else keeps the 401.
  3. Allow `GET` in `Access-Control-Allow-Methods`.
  4. `readManifest(env, aws, token)` → parsed JSON or undefined on 404.
  5. The four routes from the spec's table.
- [ ] **Step 4: Green.** All worker tests, old and new.
- [ ] **Step 5: Prove the auth split has teeth.** Temporarily make
  `/presign/get` public. Expect the first test to FAIL. Revert.
- [ ] **Step 6: Commit** `feat(worker): publish, revoke, and serve a shared tank`

---

### Task 4: The publish client

**Files:** Create `src/data/share/client.ts`

- [ ] **Step 1:** `publishTank(aquariumId)` does, in order, logging intent and
  outcome as a pair at each step per NFR-13:
  1. Read the tank, residents and tank-photo media row.
  2. If there is a tank photo, **HEAD its blob key** through the existing
     `createWorkerBackend(...).head()`. If absent from R2, publish **without**
     the photo and return a warning naming it — a share that renders a broken
     image is worse than one that renders the fallback, and the warning tells
     the keeper to sync and republish.
  3. `buildSnapshot(...)`.
  4. `POST /shared`.
  5. **Verify**: `GET /shared/{token}` and confirm the tank name matches.
     Throw if it does not. A publish that reports success without the object
     being readable is the DW_SYNC failure exactly.
  6. `recordShare(...)`.
- [ ] **Step 2:** `revokeTank(aquariumId)` → `DELETE`, verify the read now
  404s, then `forgetShare`. Log both.
- [ ] **Step 3:** `shareUrlFor(token)` → `${location.origin}${import.meta.env.BASE_URL}#/share/${token}`.
- [ ] **Step 4: Commit** `feat(share): publish and revoke, verified rather than assumed`

---

### Task 5: Extract the presentational tank view

**Files:** Create `src/ui/components/tank/TankViewer.tsx`; modify `src/ui/screens/TankDetail.tsx`

Pure refactor. No behaviour change, and the existing tests must pass untouched.

- [ ] **Step 1:** Move `StatRow`, `WaterColumn`, `Temperament`, `GrowsInto`,
  `Coverage`, `AGGRESSION_TONE` and the read-only branch of `ResidentGrid` into
  the new file **verbatim**, including their docstrings. Export
  `TankViewer({ tankName, residents, stats, linkTo })`.
- [ ] **Step 2:** `linkTo?: (speciesId: string) => string | undefined` is how
  the two callers differ: the owner's view links to `/species/:id`, the guest's
  view returns undefined and the tile calls `onPick` instead. Editing controls
  do **not** move — they stay in `TankDetail.tsx`, which keeps its own
  `ResidentGrid` for the editing case.
- [ ] **Step 3:** `npm test` — everything still green. `npm run typecheck`.
- [ ] **Step 4: Commit** `refactor(ui): a tank view that renders from props`

---

### Task 6: Pending intent across sign-in

**Files:** Create `src/data/share/pending-intent.ts`, `pending-intent.test.ts`

- [ ] **Step 1: Write the failing test.** `remember({action:'heart', speciesId, returnTo})`
  then `takePending()` returns it once and `undefined` the second time (it is
  consumed, so a stale intent cannot re-fire on every later visit). An intent
  older than 15 minutes is discarded.
- [ ] **Step 2: Run, fail. Step 3: Implement** over `localStorage` — not
  `sessionStorage`, because a Google redirect can land in a fresh context.
  Wrap every access in try/catch: Safari private mode throws on write, and a
  heart that cannot be remembered must not take the page down.
- [ ] **Step 4: Green. Step 5: Commit** `feat(share): an intent that survives the sign-in`

---

### Task 7: The guest view

**Files:** Create `src/ui/screens/SharedTank.tsx`; modify `src/App.tsx`

- [ ] **Step 1:** `App.tsx` splits:

```tsx
<Routes>
  <Route path="/share/:token" element={<SharedTank />} />
  <Route path="/*" element={<GatedApp />} />
</Routes>
```

  `GatedApp` is today's `AuthGate`-wrapped tree, moved down one level
  unchanged. Comment must say why the public branch exists and what it is
  allowed to reach.
- [ ] **Step 2:** `SharedTank` fetches `GET ${MEDIA_WORKER_URL}/shared/${token}`.
  Four states, all rendered honestly: loading, 404 ("This link has been turned
  off"), a network failure, and the tank.
- [ ] **Step 3:** Renders `<TankViewer>` with the snapshot's residents and
  stats, plus a header carrying the tank name and a "shared from Fish2Tank"
  line. Tank photo, when present, is
  `<img src={`${MEDIA_WORKER_URL}/shared/${token}/media/${key}`}>` — an `img`
  follows the 302 natively and needs no CORS.
- [ ] **Step 4:** No bottom nav and no `ProfileButton` on this route.
- [ ] **Step 5: Commit** `feat(share): the page a stranger can open`

---

### Task 8: The funnel

**Files:** Modify `src/ui/screens/SharedTank.tsx`

- [ ] **Step 1:** A heart button on each resident tile, and tapping a tile,
  both call `wantsAccount({action, speciesId})` when signed out.
- [ ] **Step 2:** That opens a panel saying what happens next, with one
  button: `remember(intent)` then `db.cloud.login({ provider: 'google' })`.
- [ ] **Step 3:** On mount, and whenever `useObservable(db.cloud.currentUser)`
  becomes logged in, drain `takePending()` → `addToDreamList(speciesId)` →
  show "Added to your Dream List" on the tile. Log intent and outcome.
- [ ] **Step 4:** When already signed in, the heart just works with no prompt.
- [ ] **Step 5: Commit** `feat(share): a guest who hearts a fish becomes a keeper`

---

### Task 9: The share icon and its sheet

**Files:** Create `src/ui/components/ShareSheet.tsx`; modify `src/ui/screens/Tanks.tsx`, `src/ui/components/Icons.tsx`

- [ ] **Step 1:** Re-export `ShareNetworkIcon` and `HeartIcon` from
  `@phosphor-icons/react` in `Icons.tsx`, following the file's existing pattern.
- [ ] **Step 2:** An icon button on `TankCard`, **outside** the `<Link>` — the
  photo button next to it already establishes that pattern and the reason for
  it (a tap must not navigate away).
- [ ] **Step 3:** `ShareSheet` states: not shared (one **Share this tank**
  button); publishing; shared (the URL, **Copy**, `navigator.share` where it
  exists, **Update what guests see**, **Stop sharing**); and failed, showing
  the error rather than a shrug.
- [ ] **Step 4:** When shared, a line stating plainly what is public: "Anyone
  with this link can see this tank, its fish, and its estimated value."
- [ ] **Step 5:** No colour, radius, spacing or duration literals. Tokens only.
- [ ] **Step 6: Commit** `feat(share): a share icon on every tank`

---

### Task 10: Verify it end to end

- [ ] **Step 1:** `npm test` and `npm run typecheck` both clean.
- [ ] **Step 2:** `npm run build`.
- [ ] **Step 3:** `npm run preview -- --port 4199` and drive it with Playwright
  **passing `BASE_URL` explicitly** — port 4173 is shared with other sessions
  and testing someone else's build is the failure mode here.
- [ ] **Step 4:** Sign in via developer mode (spec 013), publish a tank, copy
  the URL.
- [ ] **Step 5:** Open that URL in a **fresh browser context with no storage**.
  Confirm: the tank renders, the stats match, no gate appears, no console
  errors.
- [ ] **Step 6:** Tap a heart → the sign-in prompt appears.
- [ ] **Step 7:** Stop sharing → the same URL now says the link is off.
- [ ] **Step 8:** Record every result, including anything that could not be
  verified in this environment and why, in the spec's **Verified** section.

---

### Task 11: Documentation

- [ ] **Step 1:** `README.md` — the feature, and the honest note that the
  Worker must be deployed for shares to work at all (spec 011's lesson: a
  feature that cannot work in production should say so before someone finds
  out).
- [ ] **Step 2:** `docs/BACKLOG.md` — a row for the preview-derivative idea,
  with the measured 3.6 MB behind it.
- [ ] **Step 3:** Deploy note: `npx wrangler deploy --env uat` is required
  before the UAT site can share anything.
- [ ] **Step 4: Commit** `docs: what sharing does, and what it needs deployed`

---

## Self-review against the spec

| Spec requirement | Task |
|---|---|
| FR-S01 publish to an unguessable URL | 3, 4, 9 |
| FR-S02 no account to view | 3 (public routes), 7 (route outside the gate) |
| FR-S03 frozen until republished | 1 (snapshot), 9 (Update button) |
| FR-S04 photos are the existing objects | 3 (302 to presign), 4 (no copy made) |
| FR-S05 revocable, photos withdrawn too | 3 (delete + membership check), 9 |
| FR-S06 heart prompts sign-up and survives it | 6, 8 |
| FR-S07 allowlist projection | 1 |
| NFR-14 access from manifest + validated token | 3 |
| NFR-13 intent and outcome, verified | 4 |
| Estimated value public | 5 (`StatRow` moves unchanged) |
| The refactor | 5 |
