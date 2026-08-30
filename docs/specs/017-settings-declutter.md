# 017 — Nine cards down to five

## What was asked

> I think the settings section is becoming really crammed and difficult to
> navigate, can you find ways to clean them up? specifically, profile is now
> redundant, app theme and aquariu scene and motion and sounds can be
> consolidated into a Theme section; account should be on top. Sync/backup/erase
> should be its own important section. import inventory is a redundant feature.
> Build should be on the bottom that's good.

## The problem

Settings had grown to nine cards, in the order they were built rather than the
order anyone needs them:

```
Profile · App theme · Aquarium scene · Motion and sound · Account ·
Import inventory · Backup · Erase everything · Build · Privacy
```

Account was fifth and Backup seventh. Those are the two things a keeper opens
this screen to find, and both sat below three cards of appearance preferences.

## Two premises in the request, checked before acting on them

**"Profile is now redundant" — the section, yes; its contents, no.** It held
two live settings. `displayName` drives the Home greeting and the avatar
initial; `currency` drives tank valuations, catalog prices and the entire
price-fit engine. Deleting the section as written would have silently removed
the only way to set a currency.

**"Account should be on top" and "sync should be its own section" collide.**
`AccountPanel` is *"Account and sync status"* — one component holding sign-in,
sync phase, last-in-sync and the media sync control. Sync status is meaningless
without knowing whether you are signed in, so splitting them would put a
half-answer at the top and the other half three cards down.

Both were resolved with Ryan before any code changed: currency moves into
Account, the display-name field goes and the greeting reads the signed-in
account's name, and sync stays with Account while the new Data section is
backup and erase.

## The result

```
Account   — signed in as, sign out, currency, sync status, photo sync
Theme     — appearance, aquarium scene, motion and sound
Your data — backup, restore, erase everything
Privacy
Build
```

## What was removed, and what that costs

**The display-name field, and `setDisplayName` with it.** The greeting now
reads `cloudUser.name` first and falls back to the stored `displayName`, so
anyone who set one before this — or who is signed out — keeps their greeting
rather than dropping to "Welcome back." The stored property is still read and
still syncs; it is just no longer writable from the app. `setDisplayName` had
exactly one caller and is deleted rather than left as a tested but unreachable
mutation on a synced record. A comment where it stood says what to restore if
a nickname control is ever wanted, and why its unchanged-value guard was the
part worth keeping.

**Import inventory, and the two modules that existed only to serve it**:
`src/data/import-service.ts` and the hand-rolled `.xlsx` reader
`src/data/seed/xlsx.ts`. Both had zero remaining consumers once the section
went.

The cost is real and worth stating: there is no longer any way to load a
spreadsheet into the app. Backup and restore is the replacement and is
strictly better for the job — it carries photos, specimens, encounters and
assessments, none of which a spreadsheet has. Two things make the trade
clearly worth it:

- The importer never reconciled. It only `bulkPut`, so re-importing an
  **edited** sheet left the old rows beside the new ones. That is **BUG-07**,
  and removing the only route to it closes it.
- A non-idempotent earlier version of this exact path is what produced 176
  holdings in production where there were 63 fish (spec 015).

`src/data/seed/inventory-import.ts` stays, because `etl/build-smoke-fixture.ts`
uses `parseInventoryCsv` and `importInventory` to generate the smoke fixture.
So FR-O03's parsing rules are still tested; only the in-app route is retired.
`docs/INVENTORY_IMPORT.md` now says so at the top.

## Acceptance criteria

1. Five cards, in the order above. ✅
2. Currency is still settable and still reaches `settings.currency`. ✅
3. Signed in, the greeting uses the account name; signed out with a stored
   name, that name; otherwise "Welcome back." ✅
4. The three appearance groups keep working as three independent groups — the
   radio `name` attributes are what guarantee that now they share a card. ✅
5. Backup and Erase render as subsections of one card, not nested cards. ✅
6. No dead module is left behind: nothing imports `import-service` or `xlsx`. ✅
7. Suite green with exactly the tests that belonged to deleted code removed:
   1010 → 1001, being 7 `xlsx` tests and 2 `setDisplayName` tests. ✅

## Alternatives rejected

- **Collapsible sections instead of fewer sections.** Nine cards behind nine
  disclosure triangles is the same nine decisions plus a tap each. The problem
  was count and order, not height.
- **A settings sub-navigation.** Far more machinery than five cards need, and
  it would put Account behind a tap rather than at the top.
- **Keeping Import inventory but hiding it behind developer mode.** Keeps a
  path to BUG-07 alive for the one person most likely to use it, to preserve a
  feature that backup and restore already does better.
- **Deleting the `displayName` property from the schema.** A migration on a
  synced table, for a field that costs nothing to keep and that the greeting
  still reads.

## Requirements touched

PRD 7.2, 7.4, 7.5 (settings screen), FR-A04 (currency), NFR-06, NFR-08.
Retires the in-app half of **FR-O03**; its parsing rules remain tested.
Closes **BUG-07** by removing the only path that reached it.
