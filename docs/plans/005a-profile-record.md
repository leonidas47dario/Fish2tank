# Profile record implementation plan (spec 005, Release 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the user profile the types have been promising since v1, so
settings live in one place and are ready to sync, with nothing going near the
network yet.

**Architecture:** One `User` row in the existing `users` table becomes the
source of truth for account-level settings. `localStorage` demotes from source
of truth to a first-paint cache, so there is no theme flash on load. All logic
lives in plain `.ts` modules with tests; `ThemeProvider.tsx` becomes thin
wiring.

**Tech Stack:** TypeScript, Dexie 4, React 18, Vitest with `fake-indexeddb`.

---

## Two corrections to spec 005

Found while planning. Both reduce risk; the spec text should be read through
these.

**1. There is no schema migration.** Spec 005 FR-A06 says "Schema v3."
Wrong: `users: 'id'` has existed since version 1 (`src/data/db.ts`), and this
work changes only the shape of the object stored inside a row, which Dexie
does not police. No `.version(3)` block, no upgrade function, no risk of a
half-applied migration. It is a one-time data fold at startup, guarded by an
idempotency check.

**2. React components cannot be unit-tested in this repo today.**
`vitest.config.ts` includes only `src/**/*.test.ts` and runs
`environment: 'node'`, with no jsdom and no testing-library. Adding that stack
is out of scope for a profile change. Every decision therefore lives in a
`.ts` module with real tests, and `ThemeProvider.tsx` holds only wiring, which
`npm run smoke` covers end to end.

## File structure

| File | Responsibility |
|---|---|
| `src/domain/types.ts` (modify) | `UserSettings` and `User` reconciled to what is actually used |
| `src/data/profile.ts` (create) | Defaults, the legacy fold, and profile read/write. The only module that knows a profile is stored in Dexie. |
| `src/data/profile.test.ts` (create) | Full coverage of the above |
| `src/theme/resolve.ts` (create) | Narrows an arbitrary stored id to a known theme or scene, with fallback |
| `src/theme/resolve.test.ts` (create) | Coverage of the narrowing, including unknown ids |
| `src/theme/ThemeProvider.tsx` (modify) | Wiring only: first-paint cache, hydrate from profile, write through |
| `src/data/bootstrap.ts` (modify) | Runs the one-time fold at startup |
| `src/data/repositories.ts` (modify) | `recordPrice` reads the profile currency instead of hardcoding `'USD'` |
| `src/ui/screens/Settings.tsx` (modify) | Display name and currency controls |

---

### Task 1: Reconcile the domain types

**Files:**
- Modify: `src/domain/types.ts:59-76`

- [ ] **Step 1: Replace `UserSettings` and `User`**

Delete `homeRegion`, `lengthUnit` and `volumeUnit` (unreferenced anywhere in
the codebase). Delete `muted` (device-level per spec FR-A04). Add `sceneId`,
which the live localStorage shape has and this type never did.

`themeId` and `sceneId` stay `string` rather than importing the union from
`ThemeProvider.tsx`, for two reasons: the domain layer must not depend on a UI
module, and once Release 2 syncs profiles, a device running an older build
will legitimately receive a theme id it has never heard of. Narrowing is the
UI's job (Task 3).

```ts
export interface UserSettings {
  /** Active app theme token set (PRD 7.2/7.3). Narrowed by the UI, see src/theme/resolve.ts. */
  themeId: string;
  /** Living Portrait surround (PRD 7.4). Independent of the app theme. */
  sceneId: string;
  /**
   * NFR-06 / FR-R04: the reveal ceremony must respect this.
   * Account-level (spec 005 FR-A04): an accessibility need belongs to the
   * person, not the device, so it follows them across devices. `muted` is
   * deliberately NOT here - it is about the room a device is in.
   */
  reducedMotion: boolean;
  /** FR-P01: the currency new price observations are recorded in. */
  currency: CurrencyCode;
}

export interface User {
  id: Id;
  displayName: string;
  settings: UserSettings;
  createdAt: Instant;
}
```

- [ ] **Step 2: Verify the build breaks only where expected**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: FAIL, and **only** with errors about `UserSettings` members in files
you are about to touch. If any other file references `homeRegion`,
`lengthUnit` or `volumeUnit`, stop: the premise that they are dead is wrong,
and this task needs rethinking rather than forcing.

- [ ] **Step 3: Commit**

```bash
git add src/domain/types.ts
git commit -m "refactor(types): a profile should describe settings that exist"
```

---

### Task 2: The profile module

**Files:**
- Create: `src/data/profile.ts`
- Create: `src/data/profile.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/data/profile.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Fish2TankDB } from './db';
import {
  DEFAULT_SETTINGS,
  LOCAL_PROFILE_ID,
  foldLegacySettings,
  loadProfile,
  setDisplayName,
  updateSettings,
} from './profile';

let db: Fish2TankDB;

beforeEach(async () => {
  db = new Fish2TankDB(`profile-test-${crypto.randomUUID()}`);
  await db.open();
});

describe('foldLegacySettings', () => {
  it('carries every known field across from the localStorage shape', () => {
    const folded = foldLegacySettings(
      '{"theme":"playful-collector","scene":"planted","reducedMotion":true,"muted":true}',
    );
    expect(folded).toEqual({
      themeId: 'playful-collector',
      sceneId: 'planted',
      reducedMotion: true,
      currency: 'USD',
    });
  });

  it('drops muted, which stays device-level', () => {
    const folded = foldLegacySettings('{"muted":true}');
    expect(folded).not.toHaveProperty('muted');
  });

  it('falls back to defaults for absent, empty or corrupt input', () => {
    expect(foldLegacySettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(foldLegacySettings('')).toEqual(DEFAULT_SETTINGS);
    expect(foldLegacySettings('{ not json')).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores unknown keys rather than storing them', () => {
    const folded = foldLegacySettings('{"theme":"planted","somethingElse":42}');
    expect(folded).not.toHaveProperty('somethingElse');
  });
});

describe('loadProfile', () => {
  it('creates a profile on first call', async () => {
    const profile = await loadProfile(db);
    expect(profile.id).toBe(LOCAL_PROFILE_ID);
    expect(profile.settings).toEqual(DEFAULT_SETTINGS);
    expect(await db.users.count()).toBe(1);
  });

  it('is idempotent: a second call returns the same row, not a second one', async () => {
    const first = await loadProfile(db);
    await updateSettings({ themeId: 'planted' }, db);
    const second = await loadProfile(db);
    expect(await db.users.count()).toBe(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.settings.themeId).toBe('planted');
  });

  it('seeds from legacy settings when given them, but only on creation', async () => {
    await loadProfile(db, '{"theme":"expedition-fieldbook"}');
    await loadProfile(db, '{"theme":"playful-collector"}');
    const profile = await loadProfile(db);
    expect(profile.settings.themeId).toBe('expedition-fieldbook');
  });
});

describe('updateSettings', () => {
  it('patches one field without disturbing the others', async () => {
    await loadProfile(db);
    await updateSettings({ currency: 'EUR' }, db);
    const profile = await loadProfile(db);
    expect(profile.settings.currency).toBe('EUR');
    expect(profile.settings.themeId).toBe(DEFAULT_SETTINGS.themeId);
  });

  it('creates the profile first if it does not exist yet', async () => {
    await updateSettings({ currency: 'GBP' }, db);
    expect((await loadProfile(db)).settings.currency).toBe('GBP');
  });
});

describe('setDisplayName', () => {
  it('stores the name without disturbing settings', async () => {
    await updateSettings({ currency: 'CAD' }, db);
    await setDisplayName('Ryan', db);
    const profile = await loadProfile(db);
    expect(profile.displayName).toBe('Ryan');
    expect(profile.settings.currency).toBe('CAD');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/profile.test.ts`
Expected: FAIL, "Failed to resolve import ./profile".

- [ ] **Step 3: Write the implementation**

Create `src/data/profile.ts`:

```ts
/**
 * The keeper's profile.
 *
 * Spec 005 FR-A04. Until now `User` and `UserSettings` were declared and never
 * written, while the settings people actually change lived in localStorage
 * under a different shape. This module is the single place that knows where a
 * profile is stored, so Release 2 can point it at a synced identity without
 * anything upstream changing.
 *
 * Account-level settings live here. `muted` deliberately does not: it is about
 * the room a device is in, and stays in localStorage (spec 005 FR-A04).
 */
import { db, nowIso, type Fish2TankDB } from './db';
import type { User, UserSettings } from '@/domain/types';

/**
 * Fixed while the app is single-user and offline. Release 2 maps the synced
 * identity onto this row rather than creating a second one.
 */
export const LOCAL_PROFILE_ID = 'user_local';

export const DEFAULT_SETTINGS: UserSettings = {
  themeId: 'midnight-aquarium',
  sceneId: 'original-tank',
  reducedMotion: false,
  currency: 'USD',
};

/** The shape ThemeProvider wrote to localStorage before this existed. */
interface LegacySettings {
  theme?: unknown;
  scene?: unknown;
  reducedMotion?: unknown;
}

/**
 * Reads the pre-profile localStorage payload into settings.
 *
 * Total, by design: a keeper who never opened Settings, or whose stored JSON
 * is corrupt, gets defaults rather than an error. Losing a theme preference is
 * not worth a failed startup. `muted` is dropped on purpose.
 */
export function foldLegacySettings(raw: string | null | undefined): UserSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let parsed: LegacySettings;
  try {
    parsed = JSON.parse(raw) as LegacySettings;
  } catch (err) {
    console.warn('[profile] legacy settings were not valid JSON, using defaults', err);
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SETTINGS };
  return {
    themeId: typeof parsed.theme === 'string' ? parsed.theme : DEFAULT_SETTINGS.themeId,
    sceneId: typeof parsed.scene === 'string' ? parsed.scene : DEFAULT_SETTINGS.sceneId,
    reducedMotion:
      typeof parsed.reducedMotion === 'boolean' ? parsed.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    currency: DEFAULT_SETTINGS.currency,
  };
}

/**
 * The profile, created on first call.
 *
 * `legacyRaw` seeds settings at creation only. Passing it again later does
 * nothing, so a stale localStorage value can never overwrite a deliberate
 * change made afterwards.
 */
export async function loadProfile(
  database: Fish2TankDB = db,
  legacyRaw?: string | null,
): Promise<User> {
  const existing = await database.users.get(LOCAL_PROFILE_ID);
  if (existing) return existing;

  const created: User = {
    id: LOCAL_PROFILE_ID,
    displayName: '',
    settings: foldLegacySettings(legacyRaw),
    createdAt: nowIso(),
  };
  await database.users.put(created);
  console.info(
    `[profile] created ${LOCAL_PROFILE_ID} theme=${created.settings.themeId} ` +
      `scene=${created.settings.sceneId} currency=${created.settings.currency} ` +
      `legacy=${legacyRaw ? 'folded' : 'none'}`,
  );
  return created;
}

/** Patches settings, creating the profile first if needed. */
export async function updateSettings(
  patch: Partial<UserSettings>,
  database: Fish2TankDB = db,
): Promise<User> {
  const current = await loadProfile(database);
  const next: User = { ...current, settings: { ...current.settings, ...patch } };
  await database.users.put(next);
  return next;
}

/** Sets the display name, creating the profile first if needed. */
export async function setDisplayName(
  displayName: string,
  database: Fish2TankDB = db,
): Promise<User> {
  const current = await loadProfile(database);
  const next: User = { ...current, displayName };
  await database.users.put(next);
  return next;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/profile.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/profile.ts src/data/profile.test.ts
git commit -m "feat(profile): one place that knows where a keeper's settings live"
```

---

### Task 3: Narrow stored ids to known themes and scenes

**Files:**
- Create: `src/theme/resolve.ts`
- Create: `src/theme/resolve.test.ts`

A stored id is arbitrary text. Today it comes from this build; after Release 2
it can come from a newer build on another device. An unknown id must fall back
to the default rather than write a bogus `data-theme` attribute and render an
unstyled app.

- [ ] **Step 1: Write the failing tests**

Create `src/theme/resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveSceneId, resolveThemeId } from './resolve';

describe('resolveThemeId', () => {
  it('passes a known theme through', () => {
    expect(resolveThemeId('playful-collector')).toBe('playful-collector');
  });

  it('falls back for an id this build does not know', () => {
    expect(resolveThemeId('theme-from-a-newer-build')).toBe('midnight-aquarium');
  });

  it('falls back for absent or empty input', () => {
    expect(resolveThemeId(undefined)).toBe('midnight-aquarium');
    expect(resolveThemeId('')).toBe('midnight-aquarium');
  });
});

describe('resolveSceneId', () => {
  it('passes a known scene through', () => {
    expect(resolveSceneId('planted')).toBe('planted');
  });

  it('falls back for an unknown scene', () => {
    expect(resolveSceneId('nope')).toBe('original-tank');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/theme/resolve.test.ts`
Expected: FAIL, "Failed to resolve import ./resolve".

- [ ] **Step 3: Write the implementation**

Create `src/theme/resolve.ts`:

```ts
/**
 * Narrowing a stored theme or scene id to one this build can actually render.
 *
 * Spec 005 FR-A04 stores these as plain strings, because after Release 2 a
 * profile synced from a newer build can name a theme this one has never heard
 * of. Falling back beats rendering an app with no tokens applied.
 *
 * The id lists live in ThemeProvider.tsx alongside their display copy; this
 * module imports them so there is still exactly one definition.
 */
import { SCENES, THEMES, type SceneId, type ThemeId } from './ThemeProvider';

export const DEFAULT_THEME_ID: ThemeId = 'midnight-aquarium';
export const DEFAULT_SCENE_ID: SceneId = 'original-tank';

export function resolveThemeId(id: string | undefined): ThemeId {
  const match = THEMES.find((t) => t.id === id);
  if (match) return match.id;
  if (id) console.warn(`[theme] unknown theme id "${id}", falling back to ${DEFAULT_THEME_ID}`);
  return DEFAULT_THEME_ID;
}

export function resolveSceneId(id: string | undefined): SceneId {
  const match = SCENES.find((s) => s.id === id);
  if (match) return match.id;
  if (id) console.warn(`[theme] unknown scene id "${id}", falling back to ${DEFAULT_SCENE_ID}`);
  return DEFAULT_SCENE_ID;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/theme/resolve.test.ts`
Expected: PASS, 5 tests.

> **Note for the implementer:** this imports from a `.tsx` file into a `.ts`
> file, which TypeScript allows. If the vitest run fails to resolve `.tsx`,
> the fix is to move the `THEMES`/`SCENES` const arrays into a new
> `src/theme/catalog.ts` and re-export them from `ThemeProvider.tsx`. Do that
> rather than duplicating the lists.

- [ ] **Step 5: Commit**

```bash
git add src/theme/resolve.ts src/theme/resolve.test.ts
git commit -m "feat(theme): an unknown theme id should fall back, not render nothing"
```

---

### Task 4: Wire ThemeProvider to the profile

**Files:**
- Modify: `src/theme/ThemeProvider.tsx:31-96`

The provider is synchronous today and reads localStorage during `useState`
initialisation. Dexie reads are async, and rendering defaults until the
profile arrives would flash the wrong theme on every load. So localStorage is
demoted to a **first-paint cache**: read synchronously for the first frame,
then reconciled against the profile, which is authoritative.

- [ ] **Step 1: Replace the settings plumbing**

Keep `THEMES`, `SCENES`, `ThemeId`, `SceneId` and `usePrefersReducedMotion`
exactly as they are. Replace the `Settings` interface, `DEFAULTS`, `load()`,
and the body of `ThemeProvider`:

```tsx
import { db } from '@/data/db';
import { loadProfile, updateSettings } from '@/data/profile';
import { resolveSceneId, resolveThemeId } from './resolve';

interface Settings {
  theme: ThemeId;
  scene: SceneId;
  reducedMotion: boolean;
  /** Device-level (spec 005 FR-A04): never synced, never in the profile. */
  muted: boolean;
}

const DEFAULTS: Settings = {
  theme: 'midnight-aquarium',
  scene: 'original-tank',
  reducedMotion: false,
  muted: true,
};

const STORAGE_KEY = 'fish2tank.settings';

/**
 * First-paint cache only. The profile in IndexedDB is authoritative, but it
 * cannot be read synchronously, and rendering defaults for one frame would
 * flash the wrong theme on every load.
 */
function loadCache(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    // A blocked or unavailable store is not an error worth surfacing here.
    return DEFAULTS;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadCache);

  // Hydrate from the profile, which wins over the cache.
  useEffect(() => {
    let cancelled = false;
    loadProfile(db, localStorage.getItem(STORAGE_KEY))
      .then((profile) => {
        if (cancelled) return;
        setSettings((s) => ({
          ...s,
          theme: resolveThemeId(profile.settings.themeId),
          scene: resolveSceneId(profile.settings.sceneId),
          reducedMotion: profile.settings.reducedMotion,
        }));
      })
      .catch((err) => {
        // Keep the cached values rather than snapping to defaults, but say so:
        // a silent failure here means settings appear to work and never persist.
        console.error('[theme] could not load profile, staying on cached settings', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    root.setAttribute('data-scene', settings.scene);
    root.setAttribute('data-reduced-motion', String(settings.reducedMotion));
    root.setAttribute('data-muted', String(settings.muted));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* the cache is a convenience; the profile is the record */
    }
  }, [settings]);

  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);

  /** Applies locally for instant feedback, then persists the account-level part. */
  const patchProfile = useCallback(
    (p: Partial<Settings>, stored: Partial<UserSettings>) => {
      patch(p);
      updateSettings(stored).catch((err) =>
        console.error(`[theme] failed to persist ${JSON.stringify(stored)}`, err),
      );
    },
    [patch],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...settings,
      setTheme: (theme) => patchProfile({ theme }, { themeId: theme }),
      setScene: (scene) => patchProfile({ scene }, { sceneId: scene }),
      setReducedMotion: (reducedMotion) => patchProfile({ reducedMotion }, { reducedMotion }),
      // Device-level: cache only, never the profile.
      setMuted: (muted) => patch({ muted }),
    }),
    [settings, patch, patchProfile],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
```

Add `import type { UserSettings } from '@/domain/types';` to the imports.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

- [ ] **Step 3: Verify by hand in the running app**

Run: `npm run dev`
Then, in the browser:
1. Change the theme in Settings. Confirm it applies immediately.
2. Reload. Confirm the theme is still applied **and does not flash the default
   first**.
3. In DevTools, delete the `fish2tank.settings` localStorage key and reload.
   Confirm the theme still comes back, now from IndexedDB. This is the step
   that proves the profile is authoritative rather than decorative.
4. In DevTools, Application, IndexedDB, `fish2tank`, `users`: confirm exactly
   one row, id `user_local`, with the theme you chose.
5. Toggle mute, reload, and confirm it persists but is **absent** from the
   `users` row.

- [ ] **Step 4: Commit**

```bash
git add src/theme/ThemeProvider.tsx
git commit -m "feat(theme): the profile is the record, localStorage is just the first frame"
```

---

### Task 5: Wire currency into recorded prices

**Files:**
- Modify: `src/data/repositories.ts:329-341`
- Modify: `src/data/profile.test.ts` (append)

`recordPrice` hardcodes `'USD'`, and `src/engine/pricing/price-fit.ts:171`
excludes observations whose currency does not match the subject. So for any
keeper outside the US, every price comparison silently drops its evidence.

- [ ] **Step 1: Write the failing test**

Append to `src/data/profile.test.ts`:

```ts
describe('recordPrice currency', () => {
  it('defaults to the profile currency rather than USD', async () => {
    const { recordPrice } = await import('./repositories');
    await updateSettings({ currency: 'EUR' }, db);
    const observation = await recordPrice({ speciesId: 'sp_x', askingPrice: 10 }, db);
    expect(observation.currency).toBe('EUR');
  });

  it('still lets an explicit currency win, for a price seen abroad', async () => {
    const { recordPrice } = await import('./repositories');
    await updateSettings({ currency: 'EUR' }, db);
    const observation = await recordPrice(
      { speciesId: 'sp_x', askingPrice: 10, currency: 'JPY' },
      db,
    );
    expect(observation.currency).toBe('JPY');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/profile.test.ts -t 'recordPrice currency'`
Expected: FAIL, received `'USD'` where `'EUR'` was expected.

- [ ] **Step 3: Implement**

In `src/data/repositories.ts`, add the import:

```ts
import { loadProfile } from './profile';
```

Then replace the whole function body. `type DB = Fish2TankDB` at
`repositories.ts:42`, so `loadProfile(database)` takes it directly and no cast
is needed. Only the two marked lines differ from what is there now:

```ts
export async function recordPrice(input: RecordPriceInput, database: DB = db): Promise<PriceObservation> {
  // FR-P01 / spec 005 FR-A04: an unstated currency is the keeper's own, not USD.
  // price-fit.ts excludes observations on currency mismatch, so a wrong default
  // silently discards evidence rather than failing visibly.
  const currency = input.currency ?? (await loadProfile(database)).settings.currency;

  const observation: PriceObservation = {
    id: newId('price'),
    specimenId: input.specimenId,
    speciesId: input.speciesId,
    encounterId: input.encounterId,
    placeId: input.placeId,
    askingPrice: input.askingPrice,
    memberPrice: input.memberPrice,
    paidPrice: input.paidPrice,
    currency,
    basis: input.basis ?? 'each',
    packageQuantity: input.packageQuantity ?? 1,
    observedSize: input.observedSize,
    observedAt: input.observedAt ?? nowIso(),
    online: input.online,
    source: input.source ?? 'in-store',
    note: input.note,
  };
  await database.priceObservations.add(observation);
  return observation;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS. Existing `recordPrice` tests that assert `'USD'` should still
pass, because `DEFAULT_SETTINGS.currency` is `'USD'`. If any fail, that is a
real finding: report it rather than editing the assertion to match.

- [ ] **Step 5: Commit**

```bash
git add src/data/repositories.ts src/data/profile.test.ts
git commit -m "fix(pricing): an unstated currency is the keeper's, not USD"
```

---

### Task 6: Profile controls in Settings

**Files:**
- Modify: `src/ui/screens/Settings.tsx`

- [ ] **Step 1: Add a profile section**

Add above the existing "App theme" section, matching the surrounding
`section.card.stack` markup exactly. Use no colour, radius, spacing or
duration literals (per `CLAUDE.md`).

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
import { LOCAL_PROFILE_ID, setDisplayName, updateSettings } from '@/data/profile';

// Inside the component. A plain read, not loadProfile(): a live query re-runs
// whenever `users` changes, and loadProfile() writes on first call, so using it
// here would put a write inside a query that observes the table it writes to.
// ThemeProvider has already created the row by the time Settings renders.
const profile = useLiveQuery(() => db.users.get(LOCAL_PROFILE_ID));

// In the returned JSX, before the App theme section:
<section className="card stack">
  <h2>Profile</h2>
  <p className="muted small">
    Kept on this device. Nothing here is shared or published.
  </p>
  <label className="stack">
    <span className="xs muted">Display name</span>
    <input
      type="text"
      value={profile?.displayName ?? ''}
      placeholder="Unnamed keeper"
      onChange={(e) => void setDisplayName(e.target.value)}
    />
  </label>
  <label className="stack">
    <span className="xs muted">Currency for new prices</span>
    <select
      value={profile?.settings.currency ?? 'USD'}
      onChange={(e) => void updateSettings({ currency: e.target.value })}
    >
      {['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY'].map((c) => (
        <option key={c} value={c}>{c}</option>
      ))}
    </select>
  </label>
</section>
```

`db` is already imported in `Settings.tsx`. Note that `noUnusedLocals` is on
in `tsconfig.json`, so an import you end up not using fails the type-check
rather than passing quietly.

- [ ] **Step 2: Type-check and test**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: PASS both.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`
1. Set a display name, reload, confirm it persists.
2. Set currency to EUR. Record a price on any specimen. Confirm the stored
   observation carries `EUR` (DevTools, IndexedDB, `priceObservations`).
3. Confirm the existing theme, scene, motion and sound controls still work.

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/Settings.tsx
git commit -m "feat(settings): a keeper can name themselves and pick their currency"
```

---

### Task 7: Verify the whole release

- [ ] **Step 1: Full check, matching CI**

Run: `npx tsc --noEmit -p tsconfig.json && npm test && npm run build`
Expected: all three PASS. Record the test count.

- [ ] **Step 2: Smoke test**

Run: `npm run smoke`
Expected: PASS, no console errors about the profile.

- [ ] **Step 3: Upgrade-in-place check, the one that matters**

This proves an existing keeper is not reset. Do it in a browser profile that
already has real Fish2tank data, or simulate one:

1. On `main`'s build, set a non-default theme and scene, and record a price.
2. Switch to this branch and reload.
3. Confirm the theme and scene survived, now sourced from the `users` row.
4. Confirm every specimen, encounter, holding, tank and photo is still present
   and unchanged. Nothing in this release touches those tables, so anything
   missing is a serious finding, not a migration side effect.

- [ ] **Step 4: Open the PR into `uat`**

```bash
git push -u origin feat/account-sync
gh pr create --base uat --title "Profile record (spec 005, Release 1)" \
  --body "Implements docs/plans/005a-profile-record.md. Offline only: no network, no sync, no auth. Release 2 is not in this PR."
```

Then tell Ryan the UAT URL to review, and do not merge to `main` without his
explicit sign-off.

---

## Out of scope, deliberately

Everything in spec 005 that touches the network: Dexie Cloud, the Worker, R2,
Google/Apple sign-in, media transfer, and the sync status UI. Release 2 gets
its own plan, written after this ships and after the first-login claim
behaviour has been tested against a real exported database.

Also out of scope, and filed for the backlog rather than fixed here:

- **uat and production share one IndexedDB** (spec 005). Origin-scoped, not
  path-scoped. Real today, worse with sync, but not caused by this release.
- **`types.ts:11`'s claim that exact location "never leaves the device"**
  overreaches past NFR-04, which forbids *publishing* it. The comment should
  be corrected when Release 2 makes it actually wrong.
- **Per-user storage quotas**, which only matter once other keepers exist.
