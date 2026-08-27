> **Converted from** `Real_Life_Fish_Collection_App_PRD.docx` (the authoritative original, kept alongside this file).
> This Markdown rendering exists so the spec is greppable, diffable, and linkable from code.
> Requirement IDs (`FR-*`, `NFR-*`) are referenced throughout the source.

---

PRODUCT REQUIREMENTS DOCUMENT
Real-Life Fish Collection App
Catch the encounter. Keep every story.
Status: Builder-ready MVP requirements
Primary user: Ryan — experienced freshwater aquarist, Chicago
Target: Installable mobile-first web app (PWA)
MVP loop: Catch → Evaluate → Reveal → Journal
Date: August 27, 2026

Origin encounter: “the Panther,” Aquarium Adventure, Chicago area
Product thesis: Make every fish-store visit feel like an expedition—and preserve the story of every fish that mattered.

# 1. Executive Summary
This product is a personal-first, real-world fish discovery game and aquarium journal. It transforms fish-store encounters into collectible, story-rich records without requiring purchase. The product restores the feedback loop Ryan lost when his physical tanks became full: discovery can remain rewarding even when responsible ownership is impossible.
North-star outcome: Ryan leaves a store without buying a fish yet still feels he caught something meaningful: the exact specimen, the story, the evaluation, and a place in his lifelong aquarium history.
## 1.1 The product in one sentence
An installable mobile web app that lets aquarists catch fish through photos and video, unlock species and unique specimens, evaluate tank fit and price through transparent rules, and preserve discoveries, owned-fish histories, losses, and lessons.
## 1.2 First-release ‘aha’ moment
Ryan records a fish silently in under ten seconds while standing at the store tank.
He confirms the likely species and approximate size, records the asking price, and receives an honest evaluation of his real aquariums.
The app performs a playful species-unlock and specimen-card reveal.
Later, Ryan adds the story privately and can revisit the original media without having purchased the fish.
## 1.3 Scope decision

| MVP includes | Explicitly deferred |
|---|---|
| Fast private capture, collection/reveal, tank inventory, deterministic compatibility screening, price logging, stories, Dream List, basic legacy records | Public profiles, trading, treasure map, levels, automatic Chicago rarity, sophisticated AI chat |
| Original photo/video playback and specimen history | Fish extraction, simulated personality, multi-fish virtual aquarium, arbitrary background replacement |
| Manual or externally assisted identification with user confirmation | A proprietary ornamental-fish computer-vision model |


## 1.4 Source material
Eleven-round product-discovery interview conducted August 27, 2026.
Uploaded fish inventory: 61 current holding rows across six enclosure labels.
Jaguar cichlid encounter photo and narrative from Aquarium Adventure.
CatchCat’s real-world spotting, keepsake, rarity, album, and map model as external inspiration.
# 2. Problem, Audience, and Product Principles
## 2.1 Problem statement
Fish-store exploration once delivered a repeating cycle of surprise, research, decision, and ownership. Physical space eventually broke that cycle. Ryan’s apartment tanks are full, and purchasing another large or aggressive fish may be irresponsible even when the encounter is emotionally powerful. Existing camera rolls, spreadsheets, and marketplace research preserve fragments but not the complete experience.
“My tanks are just all full. I kind of lost the feedback loop.”
Ryan — product interview
## 2.2 Primary audience
The MVP is designed for one person: Ryan. It must remain worthwhile if no community ever forms.
Experienced freshwater aquarist managing predators, oddballs, cichlids, catfish, bichirs, gobies, totes, quarantine, and mixed communities.
Visits local fish stores for discovery as much as purchasing.
Enjoys rare specimens, price research, compatibility thought experiments, data, collecting, and meaningful animal stories.
Uses an iPhone and needs an experience that works discreetly in a store aisle.
## 2.3 Product principles

| ID | Principle | Implication |
|---|---|---|
| P1 | A catch is documentation—not acquisition. | The product rewards restraint and must never make buying necessary for progress. |
| P2 | Capture now; enchant later. | Store mode stays silent and fast. Reflection, storytelling, and visual delight happen later. |
| P3 | The exact specimen matters. | Species unlocks coexist with unique specimen records and repeated encounter chapters. |
| P4 | Fun before dashboards. | Ratings and data support the game; they do not turn it into a fish Bloomberg terminal. |
| P5 | Rules before AI. | Compatibility verdicts are deterministic, sourced, versioned, and inspectable. AI may explain but never invent a verdict. |
| P6 | Unknown is an honest answer. | Sparse price, identity, and care data must produce uncertainty—not fabricated precision. |
| P7 | Loss becomes legacy and learning. | Fish Heaven preserves the animal; lessons may contribute to a private Keeper’s Code without interrupting future catches. |
| P8 | Personal-first; community optional. | The private product must be complete before profiles, maps, trading, or reputation systems. |


## 2.4 Non-goals
Live store-inventory aggregation or commercial market-data vending.
Encouraging users to buy, overstock, or chase levels through ownership volume.
Providing guaranteed compatibility, diagnosis, or animal-welfare outcomes.
Building a proprietary fish identification model for the MVP.
Copying Pokémon, Hearthstone, CatchCat, or any protected characters, frames, icons, typography, animations, or trade dress.
Replacing the original media with an unreliable synthetic version of the fish in the MVP.
# 3. Experience Model and Information Architecture
## 3.1 Core lifecycle

| Stage | User action | System response | Emotional result |
|---|---|---|---|
| Discover | Notices a compelling fish unexpectedly | No app action required until the user chooses to capture | Surprise remains intact |
| Catch | Records photo/video | Creates offline-safe draft with time and optional place | The moment is secured |
| Confirm | Confirms species, size, price | Shows identity state and missing information | Research becomes focused |
| Evaluate | Checks real tanks and price history | Runs transparent screening and personal comparisons | Decision support without false certainty |
| Reveal | Completes first species encounter | Shows playful rarity and unlock ceremony | Discovery feels rewarding |
| Journal | Adds text, audio, or video memo later | Preserves why the specimen mattered | The story gains permanence |
| Evolve | Reserves, acquires, moves, rehomes, or loses fish | Adds lifecycle chapters without replacing history | One record follows the fish |
| Remember | Opens Fish Heaven or Keeper’s Code | Shows media, uncertain cause, lesson, and legacy | Loss becomes memory and judgment |


## 3.2 Navigation model

| Destination | Purpose |
|---|---|
| Home | Recent catches, Dream List, unfinished stories, current-tank highlights |
| Collection | Species index, unique specimen cards, filters, rarity, encounter chapters |
| Catch | Central camera action for photos/video and rapid draft creation |
| Tanks | Real aquariums, residents, compatibility screening, moves, and lifecycle events |
| Journal | Stories, Fish Heaven, Keeper’s Code, and historical timeline |


## 3.3 Two-speed interaction

| Store mode | Home mode |
|---|---|
| Silent, one-handed, camera-first, minimal typing | Reflective, media-rich, editable, and emotionally expressive |
| Capture, confirm, record price/size, evaluate, save | Memo, story, comparison research, tank history, legacy |
| Target: draft secured within 10 seconds excluding upload | No time pressure; unfinished stories remain drafts |


## 3.4 Record semantics
Key modeling decision: Species, specimen/group, encounter, acquisition, tank residency, and lifecycle outcome are separate records. A spreadsheet-style ‘species in tank’ row cannot preserve the product story by itself.

| Object | Meaning |
|---|---|
| Species | Canonical identity, aliases, scientific name, morph/locality; may be unknown initially |
| Specimen or observed group | The exact individual or lot encountered; owns the collectible card |
| Encounter chapter | One visit/date/place observation; repeat sighting of the same fish adds a chapter |
| Holding | An owned individual or group plus current quantity; linked to the specimen when acquired |
| Residency | Dated placement in a physical aquarium; moves close one interval and open another |
| Life event | Reserved, acquired, quantity adjusted, moved, rehomed, sold, returned, missing, or deceased |


# 4. MVP Functional Requirements
Priority legend: P0 = required for the first usable release. P1 = may slip only with an explicit release decision. P2 = documented future enhancement.
## 4.1 Onboarding and tank inventory

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-O01 | P0 | Create a private user workspace without exposing home or store locations publicly. | A new account opens into private mode; public sharing controls are absent from the MVP. |
| FR-O02 | P0 | Create physical aquariums with name, volume/unit, dimensions, type, active status, photo, and manual stocking state. | User can save a tank even when optional dimensions or photo are missing; missing fields affect evaluation honestly. |
| FR-O03 | P0 | Import the uploaded inventory as opening-balance holdings. | All 61 source rows import with original labels, quantities, categories, notes, and enclosure assignment; no history is invented. |
| FR-O04 | P0 | Support both individual and group holdings. | User selects Individual or Group + quantity; a group can later be split without losing history. |
| FR-O05 | P0 | Preserve provisional and unclear species labels. | Rows such as ‘unclear ID’ remain raw labels with identity status Provisional until user confirmation. |
| FR-O06 | P1 | Allow species profiles and resident sizes to be completed progressively. | Incomplete profiles remain usable for inventory but return Not enough data where screening inputs are missing. |


## 4.2 Catch and draft flow

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-C01 | P0 | Capture one or more photos and a video from the device camera or media picker. | On supported mobile browsers, camera opens directly; fallback upload is available. |
| FR-C02 | P0 | Create the catch draft before media upload completes. | Draft receives a local ID, timestamp, and sync state; closing the app does not lose it. |
| FR-C03 | P0 | Store editable encounter time and optional store/place. | Time is automatic; location requires permission and remains editable/private. |
| FR-C04 | P0 | Keep store mode silent and free of required voice input. | A catch can reach Saved without recording or playing audio. |
| FR-C05 | P0 | Allow approximate observed size, quantity seen, raw tank label, observed tankmates, origin/locality text, and notes. | Only media is required to save a draft; evaluation clearly lists missing inputs. |
| FR-C06 | P0 | Support asking price, member price, paid price, currency, and pricing basis. | Price can be per fish, pair, or lot and stores the package quantity. |
| FR-C07 | P0 | Save offline and retry uploads when connectivity returns. | Offline draft is visible immediately with a retry indicator; no duplicate catch is created on retry. |
| FR-C08 | P1 | Offer a later reminder to finish the story without interrupting the store visit. | Reminder is opt-in, dismissible, and never blocks use. |


## 4.3 Identification

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-I01 | P0 | Represent identity as Unknown, Provisional, or User Confirmed. | Every catch displays its identity state; Unknown is a valid saved state. |
| FR-I02 | P0 | Provide manual species search and raw-label entry. | User can search common/scientific aliases or retain the store label verbatim. |
| FR-I03 | P1 | Provide an external visual-search handoff where the platform permits. | The product does not claim embedded Google Lens capability; the user returns and confirms the result manually. |
| FR-I04 | P0 | Show candidate confidence only when a source provides it; otherwise show no artificial percentage. | Manual confirmation is labeled User Confirmed, not ‘100% AI confidence.’ |
| FR-I05 | P0 | Prevent full compatibility or price-fit claims before identity and observed size are adequate. | Evaluation shows the exact missing inputs and remains rerunnable after correction. |
| FR-I06 | P1 | Preserve identification history. | Changing jaguar cichlid to dovii retains the earlier assertion, source, date, and user correction. |


## 4.4 Instant evaluation

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-E01 | P0 | Prioritize identity, tank fit, and price fit on the evaluation screen. | These appear before rarity details and secondary species facts. |
| FR-E02 | P0 | Evaluate every active physical aquarium using a versioned deterministic rule set. | Each tank returns Suitable, Conditional, High risk, Extreme risk, or Not enough data. |
| FR-E03 | P0 | Treat long-term adult suitability as the headline result. | Temporary juvenile fit, when present, is visibly secondary and time-bounded. |
| FR-E04 | P0 | Expose every factor, input, source, and rules version behind a verdict. | User can inspect which tank or species values created each warning. |
| FR-E05 | P0 | Return Not enough data rather than infer safety from missing facts. | Missing tank dimensions, species facts, sizes, or conflicting data cannot produce a green result. |
| FR-E06 | P0 | Use minimum tank size, adult size, aggression, water overlap, predation tags, schooling needs, and manual crowding state when available. | Each rule can be independently tested and disabled by versioned configuration. |
| FR-E07 | P0 | Allow source data corrections without changing historical assessments silently. | Rerun creates a new assessment snapshot; the encounter-day result remains accessible. |
| FR-E08 | P1 | Allow a user override with a reason. | Override changes personal decision status but does not erase the calculated risk. |
| FR-E09 | P2 | Offer optional AI explanation or hypothetical discussion only after the deterministic result exists. | AI response cites the rule output and is labeled advisory; it cannot alter the stored verdict. |


## 4.5 Price intelligence

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-P01 | P0 | Record price observations as dated store/specimen facts, not one mutable species price. | Repeat sightings create separate observations linked to size, place, date, and basis. |
| FR-P02 | P0 | Compare against the user’s own saved observations and manually entered comparisons. | Result displays sample count, size range, date range, and comparable basis. |
| FR-P03 | P0 | Separate asking price, membership price, and paid price. | The jaguar example can retain $100 asking and $75 member price without overwriting either. |
| FR-P04 | P0 | Show Insufficient comparison data when the sample is too small or incomparable. | No good-deal/bad-deal badge appears without a stated threshold and compatible samples. |
| FR-P05 | P1 | Allow manual online comparison with item price, shipping, source URL, date, and risk note. | Online availability never increases collecting rarity in the MVP. |
| FR-P06 | P2 | Automate selected public pricing research only after source licensing and normalization are approved. | Automated values retain source, retrieval date, shipping, size, and confidence. |


## 4.6 Collection, rarity, and reveal

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-R01 | P0 | Unlock a species on the first User Confirmed encounter. | Collection distinguishes Species unlocked from unique specimen count. |
| FR-R02 | P0 | Create a unique card for each memorable specimen or observed group. | Today’s Panther and a smaller J4 jaguar remain separate cards under the same species page. |
| FR-R03 | P0 | Let the user manually identify a repeat sighting as the same specimen. | Repeat adds an encounter chapter rather than duplicating the card. |
| FR-R04 | P0 | Run a brief, skippable, mute-compatible species unlock and rarity reveal. | Reveal never blocks saving; reduced-motion and mute settings are respected. |
| FR-R05 | P0 | Calculate Personal Discovery Tier from transparent configurable components. | Score breakdown shows first-species, Dream List, encounter frequency, and exceptional-specimen components. |
| FR-R06 | P0 | Allow a personal Golden treatment without rewriting objective data. | User may mark any meaningful specimen Golden; the reason may be recorded privately. |
| FR-R07 | P0 | Do not claim objective Chicago rarity without a minimum sample threshold. | MVP displays Local rarity unavailable and explains the data requirement. |
| FR-R08 | P0 | Provide a Dream List that can be populated by species search or collection browsing. | Dream List status exists before encounter and contributes to the reveal. |
| FR-R09 | P1 | Allow filtering by species, place, year, rarity, status, and aquarium history. | Filters work across confirmed and provisional records without deleting Unknown catches. |


## 4.7 Journal and media

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-J01 | P0 | Preserve original photos and video plus derived thumbnails/previews. | Original media remains downloadable and is never replaced by a generated reconstruction. |
| FR-J02 | P0 | Add text, audio, or video memo after the store visit. | Memo can be recorded in the car or at home and linked to a specimen or chapter. |
| FR-J03 | P0 | Transcription, when available, must preserve the original audio and remain editable. | Deleting or correcting transcript does not delete source media. |
| FR-J04 | P0 | Support a narrative title or nickname such as ‘the Panther.’ | Nickname does not replace scientific identity or store label. |
| FR-J05 | P0 | Provide a chronological specimen story. | Media, encounters, prices, acquisition, moves, and outcomes appear as dated chapters. |
| FR-J06 | P1 | Offer full-screen, distraction-light media replay. | User can relive the original clip without entering an animated aquarium. |


## 4.8 Ownership, tanks, and lifecycle

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-T01 | P0 | Convert an encountered specimen into an owned holding without creating a disconnected duplicate. | Acquisition advances the same specimen story from Encountered to Resident. |
| FR-T02 | P0 | Add owned fish with no prior catch. | User may create an opening balance or direct acquisition and leave source/date unknown. |
| FR-T03 | P0 | Assign holdings to physical aquariums through dated residency intervals. | Moving a fish closes the prior interval; history is never overwritten by a single tank field. |
| FR-T04 | P0 | Track quantity changes for groups. | Partial death, sale, birth, correction, or split updates quantity through dated events. |
| FR-T05 | P0 | Support acquired, reserved, moved, rehomed, sold, returned, missing, escaped, and deceased events. | Events require date; quantity and notes are optional where logically valid. |
| FR-T06 | P0 | Derive Current, Past kept, and Kept badges from lifecycle history. | Badges update without deleting earlier records. |
| FR-T07 | P1 | Track approximate size over time. | Growth entries retain date, unit, estimate flag, and media link. |
| FR-T08 | P1 | Derive actual home tankmates from overlapping residency periods. | Store co-housing observations are never presented as compatibility evidence. |


## 4.9 Fish Heaven and Keeper’s Code

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-L01 | P0 | Move deceased fish into Fish Heaven without deleting them from tank history. | Original residencies and media remain accessible; current quantity updates through a death event. |
| FR-L02 | P0 | Record known facts, suspected contributors, cause confidence, and an optional lesson. | Unknown and multiple possibilities are valid; no required diagnosis field exists. |
| FR-L03 | P0 | Present Fish Heaven in a gentle, dignified tone compatible with the selected theme rather than a stats-heavy reward screen. | Legacy page emphasizes media, story, dates, and lesson; rarity and competitive ceremony are secondary. |
| FR-L04 | P1 | Allow lessons to become optional Keeper’s Code principles. | Principle remains private and links back to the fish that inspired it. |
| FR-L05 | P1 | Make past connections available without interrupting new encounters. | Related principles are accessible from details but do not create modal warnings or forced acknowledgments. |


# 5. Deterministic Evaluation and Rarity Systems
## 5.1 Compatibility screening contract
The engine answers a narrow question: based on the data currently stored, is this aquarium a plausible long-term home? It is not a guarantee and must remain conservative when inputs are incomplete.

| Factor | Inputs | MVP behavior |
|---|---|---|
| Minimum enclosure | Candidate profile minimum volume/dimensions vs. aquarium | Extreme risk when below a hard minimum; Not enough data when either side is missing |
| Adult size | Adult size and growth runway vs. current tank dimensions | Headline uses adult requirement; juvenile fit may be shown separately |
| Aggression | Candidate aggression tags/rating vs. each resident and manual tank balance | Matrix produces factor-level warnings; user can inspect every pairing |
| Predation | Predatory behavior tags plus candidate/resident size bands | High or Extreme risk when an explicit size/predation rule is triggered |
| Water overlap | Temperature and other supported range intersections | Hard conflict when verified ranges do not overlap; otherwise unassessed if data is absent |
| Social needs | Schooling, solitary, territorial, conspecific rules | Conditional or High risk depending on rule severity |
| Crowding | User-set Low / Moderate / Crowded aquarium state | Crowded state raises risk but does not fabricate a bioload calculation |


## 5.2 Verdict scale

| Verdict | Trigger | Presentation |
|---|---|---|
| Suitable | No blocking rule with sufficient required data | Green label plus exact evaluated assumptions |
| Conditional | Manageable warning or unmet soft condition | Amber label and required condition |
| High risk | One serious conflict or several compounding warnings | Red-orange label and concise reason |
| Extreme risk | Hard tank-size, predation, water, or severe aggression conflict | Red label; no language implying safe trial |
| Not enough data | Any required data absent or contradictory | Neutral label and checklist of missing inputs |


## 5.3 Personal Discovery Tier v0
Scoring status: This formula is a testable MVP hypothesis. Weights live in configuration, the breakdown is shown to the user, and tuning never rewrites a historical reveal snapshot.

| Component | Points | Definition |
|---|---|---|
| First confirmed species | 0 or 45 | 45 when the species has never been confirmed in the user’s collection |
| Dream List hit | 0 or 30 | 30 when added to Dream List before the encounter |
| Personal encounter scarcity | 0–15 | Higher when the user has logged many catches but rarely/never this species |
| Exceptional specimen | 0 or 10 | User-selected attribute for an unusually compelling individual |
| Total | 0–100 | Stored with component values, formula version, and reveal date |



| Score | Working tier |
|---|---|
| 0–19 | Familiar |
| 20–39 | Uncommon |
| 40–59 | Rare |
| 60–79 | Epic |
| 80–100 | Legendary |
| Personal overlay | Golden — user-awarded foil treatment with optional private reason |


Local Chicago rarity is excluded from the MVP score. It may be added only when the community dataset passes a documented minimum sample threshold and store/time disclosures are privacy-safe.
## 5.4 Price-fit calculation contract
Normalize only comparable observations: species/morph, size range, basis (each/pair/lot), currency, region, and date window.
Show median and range only when the minimum sample count is met; always show sample count.
Membership discount remains a separate observation; the user sees both sticker and effective price.
Online comparison is optional reference data with shipping and source date; it does not affect encounter rarity.
If comparison is weak, show recorded facts and Insufficient comparison data—never an unsupported bargain badge.
# 6. Logical Data Model
The MVP may use any backend that satisfies these logical entities and relationships. External data sources must sit behind replaceable adapters and retain attribution and source dates.

| Entity | Key fields | Purpose |
|---|---|---|
| User | id, private settings, home region, units, reduced motion, mute | Owns all private records |
| Place | name, branch, type, coarse/exact location, privacy | Encounter location; home location never public |
| Species | common/scientific names, aliases, morph/locality | Canonical identity; not a specimen |
| Species profile | adult size, minimum enclosure, aggression, water ranges, social/predation tags, sources, version | Input to deterministic screening |
| Specimen | individual/group, raw label, species nullable, identity status, nickname, status | Collectible real-world fish or observed lot |
| Encounter | specimen, place, date/time, quantity, observed size, notes | Repeat visit chapter; never assumed current store stock |
| Media | encounter/specimen, type, original, derivative, metadata, sync state | Photos, video, audio, thumbnails |
| Identification assertion | candidate species, source, confidence, date, status | Preserves corrections and uncertainty |
| Price observation | ask/member/paid, basis, package quantity, size, currency, source | Historical market fact |
| Rarity snapshot | component scores, tier, formula version, personal gold | Preserves reveal-day result |
| Dream List item | species, created date, source, notes | Pre-encounter aspiration |
| Aquarium | physical/virtual type, volume, dimensions, status, stocking state, photo | MVP uses physical; virtual reserved |
| Holding | specimen nullable, individual/group, quantity, opening balance | Owned livestock record |
| Residency | holding, aquarium, start/end date | Tank placement history |
| Life event | type, date, quantity delta, notes, cause/confidence | Acquisition through outcome |
| Compatibility assessment | candidate, aquarium, inputs, factors, verdict, rules version | Immutable screening snapshot |
| Memorial | holding/specimen, story, cause possibilities, confidence, lesson | Fish Heaven record |
| Keeper principle | text, source fish, created date, private | Optional lesson available later |


## 6.1 State transitions

| Object | Allowed transition |
|---|---|
| Identity | Unknown → Provisional → User Confirmed; correction creates a new assertion |
| Specimen | Encountered → Reserved → Resident → Rehomed/Sold/Returned/Missing/Deceased |
| Holding | Active while derived quantity > 0; closed when quantity reaches 0 |
| Aquarium | Planned → Active → Retired; residency history persists |
| Media | Local draft → Uploading → Synced or Retry required |
| Assessment | Draft inputs → Completed immutable snapshot; rerun creates a new version |


## 6.2 Seed inventory migration
The uploaded workbook contains 61 holding rows under six enclosure labels: 75G, Breeder Tote, Quarantine, Bass Tote, Mini Tank, and Predator Tank.

| Source column | Migration rule |
|---|---|
| Tank | Create or match a physical Aquarium; totes and quarantine remain valid enclosure types |
| Species / Description | Preserve raw text and map provisionally; do not force unclear IDs |
| Quantity | Create opening-balance individual or group quantity |
| Category | Preserve as livestock class/tag (Fish, Invert, Amphibian) |
| Notes | Preserve verbatim; do not infer missing acquisition or health history |


Migration guardrail: Never merge the same species across tanks, invent acquisition dates, or treat the spreadsheet row as a canonical species record. Each row becomes a current holding snapshot.
# 7. Art Direction Exploration and Theme Architecture
DECISION STATUS: OPEN; VALIDATE THROUGH COMPARATIVE MOCKUPS
The product should be fun, fish-focused, and accessible, but its final visual language is intentionally not locked in this PRD. Creature-collection games are inspiration for delight and ceremony—not a style specification. The first prototype must let Ryan compare the same Panther content in several coherent visual territories before a production default is selected.
Design strategy: Make the interface themeable by construction and keep app theme separate from aquarium scene. Mockup switching is a design tool; shipping several complete app themes in the MVP is optional, not a release requirement.
## 7.1 Visual principles

| Principle | Requirement |
|---|---|
| Real fish first | Use edge-to-edge media or generous image windows; never obscure markings needed for identification. |
| Themeable by construction | Components consume semantic tokens for color, type, shape, surface, shadow, motion, and rarity treatment; business logic contains no theme styling. |
| Theme ≠ scene | The app shell may change visual language while a Living Portrait independently selects a tank surround; neither changes the record. |
| Simple implementation | Use reusable 2D CSS/SVG assets and original media; no theme may require 3D or a unique illustration for every species. |
| Ceremony in bursts | Everyday screens stay legible; unlocks may add a brief, skippable layer of motion, sound, and haptics. |
| Kind memorial tone | Fish Heaven becomes a quiet, dignified story space—not a competitive stats or loot screen. |
| Accessible rarity | Every tier uses text/icon/shape in addition to color; all motion is skippable and reducible. |


## 7.2 Visual territories to prototype

| Territory | Visual language | Strength | Watch-out |
|---|---|---|---|
| Playful Collector | Bright aquatic color, rounded cards, buoyant icons | Immediate game-like delight | Can become childish or noisy |
| Midnight Aquarium | Dark gallery, luminous media, restrained foil | Makes real fish the hero | May feel less playful day to day |
| Expedition Fieldbook | Warm paper, stamps, maps, annotated dossiers | Strong discovery/research identity | Needs extra Golden ceremony |


These are testable hypotheses, not three committed product modes. A production direction may select one or deliberately combine the calm base, reveal ceremony, and research language of different territories.
## 7.3 Design-token contract

| Token group | Required semantic slots |
|---|---|
| Color | canvas, surface, text, muted, primary, accent, positive, caution, danger, legendary |
| Typography | display, body, data/mono, scientific-name style, size scale, weight scale |
| Shape | card/control radius, border width, image mask, rarity-frame silhouette |
| Depth | surface elevation, focus ring, media glow, foil/shimmer strength |
| Motion/sound | durations, easing, reveal intensity, cues, reduced-motion and mute variants |
| Assets | icon set, background texture, dividers, stamps/bubbles, rarity ornament |


Functional components must render correctly when the token set changes; no data migration or component rewrite is allowed for a theme change.
Species identity, compatibility meaning, rarity semantics, and accessibility remain stable across themes.
The MVP may ship one chosen default. Runtime app-theme switching is a later choice unless implementation testing shows it is effectively free.
## 7.4 Aquarium scene system

| Scene | Treatment | Rule |
|---|---|---|
| Original Tank | Unaltered photo/video and real background | Always available; authoritative media view |
| Moon Sand | Dark surround, pale sand, minimal distractions | Simple illustrated frame inspired by the Panther encounter |
| Planted | Soft greenery and natural structure around the media window | Alternative atmosphere for at-home revisiting |


The first Living Portrait scenes frame or surround the original video rather than pretending to extract and reanimate the exact fish. Original media remains one tap away. Multi-fish interaction and generated backgrounds stay deferred.
## 7.5 Motion and sound
Species unlock: short card rise, bubble burst, name reveal, and tier stamp; target under three seconds and always skippable.
Golden reveal: foil sweep, warm sparkle, optional haptic and sound; no full-screen delay after the first viewing.
Everyday interactions: small feedback only; avoid constant particles.
Global mute and reduced-motion controls are available from first release.
## 7.6 Art-direction acceptance test
Pass condition: Ryan can compare the same Panther on Evaluate, Reveal, and Journal screens in all three territories; name what to keep or combine; and change tokens or a Living Portrait scene without changing records, calculations, or structure. The selected result must feel fun and fish-focused while remaining original and legible.
# 8. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Performance | A media draft becomes visibly saved within 10 seconds on a normal phone, excluding network upload time. |
| NFR-02 | Offline resilience | Capture, edit, and view unsynced drafts without connectivity; retry idempotently. |
| NFR-03 | Media durability | Preserve originals, verify upload completion, support backup/export/restore, and never silently downsample the only copy. |
| NFR-04 | Privacy | Private by default; never publish exact home location; strip EXIF from future shared derivatives. |
| NFR-05 | Transparency | Every computed result exposes sources, inputs, sample size, version, and uncertainty. |
| NFR-06 | Accessibility | Keyboard-readable web UI, meaningful labels, text alternatives, sufficient contrast, non-color rarity cues, reduced motion, and mute. |
| NFR-07 | Responsiveness | Primary flows support modern iPhone portrait widths first and remain usable on desktop. |
| NFR-08 | Data portability | Export user records and original media references in documented machine-readable form. |
| NFR-09 | Auditability | Identity corrections, assessment reruns, rule changes, and lifecycle events are historically traceable. |
| NFR-10 | Security | Authenticated media URLs are private and time-limited; secrets never ship in the client bundle. |
| NFR-11 | Observability | Capture failures, sync retries, assessment errors, and missing-data states are diagnosable without exposing personal content. |
| NFR-12 | Maintainability | Taxonomy, pricing, compatibility, rarity, and visual tokens are modular/versioned; content and business logic are independent of theme/scene; external sources use adapters. |


## 8.1 Initial media limits to validate
Prototype target: photos up to 20 MB each and videos up to 30 seconds; final limits follow device and storage testing.
Derived preview may be compressed for playback, but the original remains retained and exportable.
Capture must show storage/upload status and recover cleanly from browser suspension.
## 8.2 Privacy defaults
Exact store and home locations are private.
Public profile, sharing, map, and trading capabilities do not exist in the MVP navigation.
Future sharing must separate exact place data from a geographically coarse clue and require explicit opt-in.
# 9. Edge Cases and Failure Behavior

| Situation | Required behavior |
|---|---|
| Unknown fish | Save Mystery Catch; withhold species unlock and full evaluation until confirmation. |
| Several species in one video | Allow one media item to link to several specimens; user selects the subject for each catch. |
| Same fish revisited | User manually adds an encounter chapter; automatic deduplication is not required. |
| Same species, different individual | Create a new specimen card beneath the existing species page. |
| Fish sold before return | Historical encounter remains valid; app never claims store availability. |
| No price tag | Store null price and narrative; do not interpret as free or unavailable. |
| Member discount | Record sticker and effective price separately. |
| Pair/lot price | Require price basis and package count before comparing per-fish values. |
| Contradictory care sources | Show conflict, source dates, and Not enough data for affected rules. |
| No suitable tank | Show factor-level reasons; no MVP rearrangement planner or AI workaround. |
| Temporary juvenile fit | Headline remains long-term result; temporary fit is visually secondary. |
| Group partial loss | Record quantity delta and memorial details without closing surviving group. |
| Uncertain cause of death | Support multiple suspected contributors and confidence; Unknown remains valid. |
| Species correction after reveal | Retain old assertion; recalculate future evaluations; historical reveal remains archived. |
| Offline browser closed | Draft persists locally and resumes upload without duplication. |
| Media upload fails permanently | Original local state remains visible with export/retry guidance; do not mark Synced. |
| Location denied | Manual/favorite store selection remains fully functional. |
| Sparse price history | Show raw observations and Insufficient comparison data. |
| Rarity cold start | Use personal novelty and Dream List only; local rarity stays unavailable. |
| Rehomed fish | Close ownership lifecycle without moving the fish to Fish Heaven. |



# 10. End-to-End Acceptance Scenario: The Panther
This scenario operationalizes the interview story and serves as the primary MVP demo. It is an acceptance test, not a claim that the app independently diagnosed the fish or guaranteed compatibility.

| Step | Stage | Acceptance behavior |
|---|---|---|
| 1 | Discover | Ryan unexpectedly notices a young adult jaguar cichlid at Aquarium Adventure while accompanying a friend shopping for plants. |
| 2 | Capture | He records photos/video; draft saves silently with time and selected favorite store. |
| 3 | Identify | He enters or externally researches Jaguar Cichlid and marks the identity User Confirmed; ‘the Panther’ becomes a nickname. |
| 4 | Price | He records $100 asking and $75 member price, approximate size, and a manual comparison to a smaller $50 J4 specimen. |
| 5 | Evaluate | The app screens active tanks. The crowded 75G returns Extreme risk with adult size/aggression/crowding factors or Not enough data where a profile is missing. |
| 6 | Reveal | Jaguar Cichlid becomes a new species unlock. Personal Discovery Tier components are shown; Ryan may award Golden treatment. |
| 7 | Leave responsibly | The specimen remains Encountered/Considering. No ownership XP or purchase pressure appears. |
| 8 | Journal later | At home, Ryan adds the story: same-morning arrival, donated/unpriced cue, perceived intelligence, beauty, and why he did not destabilize the 75G. |
| 9 | Revisit | If he sees the exact fish again, he adds a chapter. If he acquires it, the same specimen advances to Resident and receives a residency. |


## 10.1 Demo success criteria
No required spoken input or public sharing.
No duplicate record between encounter and later ownership.
No fabricated price or compatibility confidence.
The playful reveal is visible, skippable, and distinct from the practical evaluation.
The story remains emotionally legible months later without needing the fish to have been purchased.

# 11. Phased Roadmap

| Phase | Scope | Entry/exit condition |
|---|---|---|
| MVP — Private Catchbook | Catch, confirm, evaluate, reveal, journal; real tanks and holdings; personal price history; Dream List; Fish Heaven; offline drafts and private sync | Ryan completes the Panther scenario and continues using the app across repeated store visits |
| Phase 1 — Useful Intelligence + Living Portrait | Broader curated profiles, refined rule engine, manual online comps, original-video observation tank with selectable Original/Moon Sand/Planted surrounds | Repeated personal use demonstrates reliable inputs and demand for revisit experiences |
| Phase 2 — Community Beta | Profiles, opt-in sharing, moderated delayed/coarse treasure-map clues, reputation experiments | Moderation, privacy, store-policy, and false-sighting design are approved |
| Phase 3 — Scale-dependent Enchantment | Chicago rarity thresholds, pricing trends, levels, fish segmentation experiments, multi-fish virtual aquarium | Dataset size and technical prototypes meet explicit accuracy/performance thresholds |
| Future — Trading | Trading/rehoming listings and local meet-up workflows | Animal welfare, local law, fraud, payment, and personal-safety controls are designed first |


## 11.1 MVP delivery slices

| Slice | Theme | Deliverable |
|---|---|---|
| Slice 1 | Private shell | PWA installability, account/private workspace, offline drafts, media capture |
| Slice 2 | Collection | Species/specimen/encounter model, identity states, reveal, Dream List |
| Slice 3 | Real tanks | Inventory import, physical aquariums, holdings, residencies, lifecycle |
| Slice 4 | Evaluation | Curated species profiles, deterministic screening, assessment snapshots |
| Slice 5 | Price + journal | Price observations/comparisons, memo, story timeline |
| Slice 6 | Legacy + hardening | Fish Heaven, Keeper’s Code foundation, export/backup, accessibility and failure-state QA |


## 11.2 MVP success measures

| Measure | MVP target |
|---|---|
| Capture completion | At least 90% of initiated catches become a durable draft in prototype testing |
| Time to secure | Median ≤10 seconds from camera confirmation to visible local draft, excluding upload |
| Evaluation honesty | 100% of missing required inputs produce Not enough data rather than Suitable |
| Story completion | Ryan enriches at least 30% of catches after leaving the store during the first month |
| Repeat use | Ryan uses the app on three separate store visits within four weeks |
| No-purchase value | At least one favorite catch is revisited despite never becoming owned |


# 12. Risks, Dependencies, and Open Decisions

| Risk | Why it matters | Mitigation |
|---|---|---|
| Identification dependency | External visual search may not be embeddable or reliable for ornamental variants | Manual search + confirmation is the guaranteed path; preserve Unknown state |
| Care-data quality | No single authoritative source covers minimum tank and aggression consistently | Curate a small sourced catalog, version rules, expose conflicts |
| Price sparsity | One user’s history cannot support robust market value immediately | Record structured facts; require sample threshold; return insufficient data |
| Rarity cold start | Objective Chicago rarity requires a community and time | Personal novelty/Dream List only in MVP |
| Media storage | Original video is emotionally important but expensive | Prototype limits, compression for derivatives, private durable storage, export |
| PWA constraints | Mobile browser camera, storage, upload, and background behavior vary | Test on Ryan’s iPhone early; keep fallback picker and resumable sync |
| Game welfare | Levels or ownership rewards could encourage overstocking | Progress from discovery, care history, learning, and contributions—not purchase volume |
| IP/trade dress | ‘Pokémon-like’ could become imitation during design | Original creatures/UI assets and legal design review before public launch |
| Theme sprawl | Maintaining several production themes can slow a personal-first MVP | Prototype three, choose one default, preserve tokens; only ship runtime switching if it remains low-cost |
| Community harm | False sightings, exact location exposure, store objections, unsafe trading | All community features deferred and private-by-default architecture retained |


## 12.1 Decisions intentionally left open

| Decision | Current direction |
|---|---|
| Product name | Use ‘Real-Life Fish Collection App’ as the working title until naming exercise. |
| Final rarity terminology | Test Familiar/Uncommon/Rare/Epic/Legendary plus personal Golden overlay. |
| Cloud/auth provider | Select after prototype stack review; requirements remain provider-neutral. |
| Species-care sources | Choose based on quality, licensing, attribution, and maintainability. |
| Exact media limits | Validate against iPhone capture, PWA storage, upload speed, and cost. |
| Fish Heaven visual metaphor | Keep the tone gentle and dignified; test literal heaven, legacy aquarium, and archival treatments with real entries. |
| Production art direction | Compare Playful Collector, Midnight Aquarium, and Expedition Fieldbook mockups before choosing or combining a default. |
| Runtime theme switching | Treat as exploratory; themeability is required, multiple shipped app themes are not. |
| Community thresholds | Define sample, geography, delay, reputation, and moderation only before Phase 2. |


# 13. MVP Definition of Done
Ryan can install and use the PWA on his iPhone.
A photo/video catch survives offline, browser suspension, retry, and later sync without duplication.
The app models Species → Specimen/Group → Encounter chapter and does not collapse these objects.
The 61-row source inventory imports without losing raw labels, quantities, categories, notes, or enclosure assignments.
Identity can remain Unknown or Provisional; all corrections are traceable.
Every active tank returns a conservative, explainable compatibility screening or Not enough data.
Price observations preserve asking/member/paid distinctions and do not claim value from insufficient samples.
A first confirmed species receives a playful, original, accessible reveal and a transparent personal rarity breakdown.
A catch can remain meaningful without acquisition and can later evolve into an owned holding without duplication.
Tank moves and quantity-changing lifecycle events preserve complete history.
A deceased fish remains in historical tank records and has an optional Fish Heaven story, uncertain cause, lesson, and Keeper’s Code link.
Original media is private, backed up, exportable, and never silently replaced by generated imagery.
Evaluate, Reveal, and Journal screens use semantic visual tokens, and the selected theme can be replaced without changing records or business logic.
Reduced motion, mute, non-color rarity cues, and meaningful media labels pass accessibility review.
The complete Panther acceptance scenario passes on the target iPhone and desktop review view.
Release gate: The MVP is not complete merely because records can be saved. It is complete when a responsible no-purchase encounter feels rewarding, memorable, and worth repeating.
## 13.1 Recommended first prototype
Build one vertical slice around the Panther: capture existing media, confirm Jaguar Cichlid, enter $100/$75 pricing and approximate size, evaluate the current 75G from seeded inventory, perform the reveal, and complete the story later. This validates the full emotional and data architecture before broad catalog work.
# Appendix A — Terminology

| Term | Definition |
|---|---|
| Catch | A documented real-world fish encounter; purchase is not required. |
| Species unlock | First User Confirmed encounter with a species. |
| Specimen card | Collectible record for an exact individual or observed group. |
| Encounter chapter | A dated observation of a specimen at a place. |
| Personal Discovery Tier | Transparent score based on the user’s history and Dream List, not global market claims. |
| Golden | Optional personal foil treatment for an emotionally exceptional specimen. |
| Compatibility screening | Rule-based, conservative check—not a guarantee. |
| Observed price | A structured historical fact tied to date, place, size, and price basis. |
| Holding | An owned individual or group with quantity and lifecycle history. |
| Fish Heaven | Legacy collection for deceased fish and their stories. |
| Keeper’s Code | Private principles learned through actual fishkeeping experiences. |
| Living Portrait | Phase 1 at-home display using original video in a simple illustrated tank setting. |
| Treasure map | Deferred community clue experience with delayed/coarse sightings—not live inventory. |


# Appendix B — Sources and Inspiration
CatchCat official product site: catchcat.lol
CatchCat product loop: How CatchCat Works
CatchCat album/cards: Collectible Cat Cards & Album
Uploaded source: fish_inventory.xlsx — 61 rows, Fish Inventory sheet.
Uploaded source: IMG_5126.jpeg — jaguar cichlid encounter photograph.
Primary discovery source: Ryan product interview, August 27, 2026.
# Appendix C — PRD Assumptions
Ryan is the sole required MVP user and accepts manual confirmation/curation where data is sparse.
The first build may use a limited species profile catalog centered on existing inventory and test catches.
No claim is made that external visual search can be embedded directly; manual workflow remains sufficient.
The app is private and non-commercial during MVP validation.
All public community, map, trading, and market-index features require separate requirements and safety review.
The visual direction remains open until comparative mockups are reviewed; any selected style may borrow the accessibility and joy of creature-collection games but must remain original.
