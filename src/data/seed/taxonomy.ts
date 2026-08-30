/**
 * Genus to family, and family to where the animal actually lives.
 *
 * WHY THIS SHAPE. The catalog needs "is this a top, mid or bottom dweller?"
 * for 1,080 species, and there is no machine source for it: FishBase and
 * Wikidata are both unreachable from the network this was built on, and
 * Wikipedia's prose does not reliably state it (the Hypostomus plecostomus
 * article runs 6,500 characters without once saying "bottom-dwelling").
 *
 * What IS reliable is taxonomy. A binomial gives you the genus for free,
 * genus-to-family is stable and independently checkable, and water-column
 * habit is overwhelmingly a family-level trait: every Loricariid is a bottom
 * dweller, every Gasteropelecid hangs at the surface. So the derivation is
 * genus → family → zone, and each family carries the reason it is classified
 * that way.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not derive AGGRESSION. Cichlidae
 * contains both the ram and the jaguar cichlid; a family-level temperament
 * would be exactly the invented data this app refuses to ship. Aggression
 * stays per-species and curated.
 *
 * A family that is not in FAMILY_TRAITS yields no zone, and the catalog says
 * "not recorded" rather than guessing. That is the same rule the care profiles
 * follow.
 *
 * Compiled 2026-08-29 by a taxonomy review over every genus in the catalog,
 * verified against Wikipedia. Where a family has been split recently, BOTH the
 * current and the superseded name are listed, because the vendor data and the
 * literature disagree about which is current and a lookup miss would silently
 * drop the species out of the filter.
 */

/** Where in the water column the animal spends its time. */
export type WaterZone = 'top' | 'mid' | 'bottom' | 'all-levels';

/** What kind of thing it is. Plants and inverts are not fish and read differently. */
export type OrganismKind = 'fish' | 'invertebrate' | 'plant' | 'amphibian' | 'reptile';

export interface FamilyTraits {
  kind: OrganismKind;
  /** Absent where the family genuinely has no single answer. */
  zone?: WaterZone;
  /** Why. Every classification is answerable. */
  note: string;
}

/**
 * Family to habit.
 *
 * Grouped by zone so the reasoning is legible at a glance and a
 * miscategorisation is easy to spot in review.
 */
export const FAMILY_TRAITS: Record<string, FamilyTraits> = {
  // --- Bottom: catfishes -------------------------------------------------
  ...bottom('fish', 'Suckermouth and armoured catfishes; rasp and forage on the substrate.', [
    'Loricariidae', 'Callichthyidae', 'Astroblepidae',
  ]),
  ...bottom('fish', 'Benthic catfishes; feed on or near the bottom.', [
    'Doradidae', 'Auchenipteridae', 'Pimelodidae', 'Bagridae', 'Siluridae',
    'Ictaluridae', 'Ariidae', 'Aspredinidae', 'Heptapteridae', 'Pseudopimelodidae',
    'Sisoridae', 'Akysidae', 'Claroteidae', 'Auchenoglanididae', 'Horabagridae',
    'Cetopsidae', 'Mochokidae', 'Erethistidae', 'Schilbeidae', 'Amphiliidae',
    'Malapteruridae', 'Clariidae', 'Trichomycteridae', 'Calophysidae',
  ]),
  // --- Bottom: loaches and suckers --------------------------------------
  ...bottom('fish', 'Loaches and hillstream suckers; substrate- and rock-dwelling.', [
    'Cobitidae', 'Botiidae', 'Nemacheilidae', 'Balitoridae', 'Gastromyzontidae',
    'Serpenticobitidae', 'Gyrinocheilidae', 'Catostomidae',
  ]),
  // --- Bottom: rays, sturgeon, eels, gobies ------------------------------
  ...bottom('fish', 'Rays; benthic by body plan.', ['Potamotrygonidae', 'Dasyatidae']),
  ...bottom('fish', 'Sturgeons and paddlefish; bottom-feeding.', ['Acipenseridae', 'Polyodontidae']),
  ...bottom('fish', 'Spiny eels and swamp eels; burrowers.', ['Mastacembelidae', 'Synbranchidae']),
  ...bottom('fish', 'Gobies and sleepers; perch on the substrate, most lack a swim bladder.', [
    'Gobiidae', 'Oxudercidae', 'Eleotridae', 'Butidae', 'Hymenosomatidae',
  ]),
  ...bottom('fish', 'Bichirs and lungfishes; bottom-associated.', [
    'Polypteridae', 'Protopteridae', 'Lepidosirenidae', 'Neoceratodontidae',
  ]),
  ...bottom('fish', 'Bottom-associated perciforms and oddities.', [
    'Soleidae', 'Batrachoididae', 'Lotidae', 'Amiidae', 'Sinipercidae', 'Percichthyidae',
  ]),
  // --- Bottom: invertebrates --------------------------------------------
  ...bottom('invertebrate', 'Crayfish and freshwater crabs; benthic.', [
    'Cambaridae', 'Parastacidae', 'Gecarcinucidae', 'Potamidae', 'Sesarmidae',
    'Varunidae', 'Aeglidae', 'Gecarcinidae', 'Coenobitidae',
  ]),
  ...bottom('invertebrate', 'Shrimp; graze biofilm on surfaces near the bottom.', [
    'Atyidae', 'Palaemonidae',
  ]),
  ...bottom('invertebrate', 'Snails and mussels; substrate grazers and filterers.', [
    'Neritidae', 'Ampullariidae', 'Thiaridae', 'Planorbidae', 'Bulinidae', 'Physidae',
    'Viviparidae', 'Pachychilidae', 'Nassariidae', 'Buccinidae', 'Unionidae',
  ]),
  ...bottom('invertebrate', 'Worms and micro-crustaceans used as live food.', [
    'Naididae', 'Tubificidae', 'Lumbriculidae', 'Daphniidae',
  ]),
  ...bottom('invertebrate', 'Terrestrial isopods, sold for vivaria rather than aquaria.', [
    'Armadillidae', 'Porcellionidae',
  ]),

  // --- Mid: characins ----------------------------------------------------
  ...mid('fish', 'Characins; open-water shoalers.', [
    'Characidae', 'Acestrorhamphidae', 'Stevardiidae', 'Alestidae', 'Serrasalmidae',
    'Anostomidae', 'Prochilodontidae', 'Lebiasinidae', 'Crenuchidae', 'Bryconidae',
    'Triportheidae', 'Chalceidae', 'Ctenoluciidae', 'Cynodontidae', 'Acestrorhynchidae',
    'Distichodontidae', 'Citharinidae',
  ]),
  ...mid('fish', 'Wolf fishes; ambush predators holding mid-water and low.', [
    'Erythrinidae', 'Hepsetidae',
  ]),
  // --- Mid: cyprinids ----------------------------------------------------
  ...mid('fish', 'Carps, barbs, danios and rasboras; open-water shoalers.', [
    'Cyprinidae', 'Danionidae', 'Leuciscidae', 'Xenocyprididae', 'Gobionidae',
    'Acheilognathidae', 'Tanichthyidae', 'Sundadanionidae',
  ]),
  // --- Mid: cichlids and rainbowfish -------------------------------------
  ...mid('fish', 'Cichlids; hold mid-water and defend a substrate territory.', ['Cichlidae']),
  ...mid('fish', 'Rainbowfishes and blue-eyes; active mid to upper shoalers.', [
    'Melanotaeniidae', 'Pseudomugilidae', 'Telmatherinidae', 'Bedotiidae',
  ]),
  // --- Mid: everything else ----------------------------------------------
  ...mid('fish', 'Knifefishes and elephantfishes; cruise mid-water and low.', [
    'Notopteridae', 'Mormyridae', 'Gymnotidae', 'Apteronotidae', 'Gymnarchidae',
  ]),
  ...mid('fish', 'Puffers; deliberate mid-water swimmers.', ['Tetraodontidae']),
  // The exception among catfishes: shark catfishes are open-water shoalers,
  // not benthic, which is exactly why the zone is set per family and not by a
  // blanket "catfish means bottom" rule.
  ...mid('fish', 'Shark catfishes; free-swimming, unlike most catfish.', ['Pangasiidae']),
  ...top('fish', 'Gars; ambush predators that hold just under the surface and gulp air.', ['Lepisosteidae']),
  ...mid('fish', 'Brackish and estuarine mid-water perciforms.', [
    'Datnioididae', 'Monodactylidae', 'Scatophagidae', 'Ambassidae', 'Kuhliidae',
    'Terapontidae', 'Latidae', 'Centropomidae', 'Sciaenidae', 'Moronidae',
    'Centrarchidae', 'Esocidae', 'Lutjanidae', 'Serranidae', 'Carangidae',
    'Polycentridae', 'Nandidae', 'Pristolepididae',
  ]),
  ...mid('fish', 'Sharks and rays kept in very large systems.', [
    'Carcharhinidae', 'Stegostomatidae', 'Muraenidae', 'Anguillidae',
  ]),

  // --- Top ---------------------------------------------------------------
  ...top('fish', 'Killifishes; surface and upper-column spawners and feeders.', [
    'Aplocheilidae', 'Nothobranchiidae', 'Rivulidae', 'Cynolebiidae', 'Fundulidae',
    'Cyprinodontidae', 'Procatopodidae', 'Profundulidae',
  ]),
  ...top('fish', 'Ricefishes; surface shoalers.', ['Adrianichthyidae']),
  ...top('fish', 'Halfbeaks; upturned jaw, surface feeders.', [
    'Zenarchopteridae', 'Hemiramphidae', 'Belonidae',
  ]),
  ...top('fish', 'Hatchetfishes; obligate surface dwellers that jump.', ['Gasteropelecidae']),
  ...top('fish', 'Butterflyfish and arowanas; surface hunters.', [
    'Pantodontidae', 'Osteoglossidae', 'Arapaimidae', 'Megalopidae',
  ]),
  ...top('fish', 'Archerfish; shoot prey off overhanging vegetation.', ['Toxotidae']),

  // --- All levels --------------------------------------------------------
  ...allLevels('fish', 'Livebearers; range the whole column but favour the upper half.', [
    'Poeciliidae', 'Goodeidae',
  ]),
  ...allLevels('fish', 'Labyrinth fishes; breathe air at the surface but feed throughout.', [
    'Osphronemidae', 'Anabantidae', 'Helostomatidae', 'Badidae', 'Channidae',
  ]),

  // --- Plants ------------------------------------------------------------
  // Zone is left undefined: a plant's position is set by how it is planted,
  // not by its taxonomy, so asserting one would be meaningless.
  ...plants([
    'Araceae', 'Alismataceae', 'Hydrocharitaceae', 'Aponogetonaceae', 'Cyperaceae',
    'Plantaginaceae', 'Linderniaceae', 'Acanthaceae', 'Amaranthaceae', 'Lythraceae',
    'Onagraceae', 'Haloragaceae', 'Menyanthaceae', 'Primulaceae', 'Apiaceae',
    'Araliaceae', 'Phrymaceae', 'Ceratophyllaceae', 'Cabombaceae', 'Nymphaeaceae',
    'Salviniaceae', 'Marsileaceae', 'Pteridaceae', 'Polypodiaceae', 'Dryopteridaceae',
    'Lomariopsidaceae', 'Ricciaceae', 'Hypnaceae', 'Fissidentaceae', 'Pylaisiadelphaceae',
    'Pithophoraceae', 'Amaryllidaceae', 'Juncaceae', 'Lentibulariaceae', 'Phyllanthaceae',
    'Commelinaceae', 'Campanulaceae', 'Lamiaceae', 'Pontederiaceae', 'Droseraceae',
    'Combretaceae', 'Anacardiaceae', 'Casuarinaceae', 'Rutaceae', 'Myrtaceae',
  ]),

  // --- Not fish, not plants ----------------------------------------------
  Ambystomatidae: { kind: 'amphibian', zone: 'bottom', note: 'Mole salamanders; the axolotl is fully aquatic and benthic.' },
  Pipidae: { kind: 'amphibian', zone: 'all-levels', note: 'Clawed and dwarf frogs; swim throughout, surface to breathe.' },
  Ranidae: { kind: 'amphibian', note: 'True frogs; largely semi-aquatic.' },
  Carettochelyidae: { kind: 'reptile', zone: 'all-levels', note: 'Pig-nosed turtle; fully aquatic.' },
  Trionychidae: { kind: 'reptile', zone: 'bottom', note: 'Softshell turtles; bury in the substrate.' },

  // --- Derived 2026-08-30 by `npm run genera:classify` (spec 009, BUG-03) ---
  // Kind only, and no zone. Walking Wikipedia's taxonomy templates upward
  // establishes what an animal IS with near-certainty; it says nothing about
  // where in the water column it sits, and this module's rule is that an
  // unsourced zone stays absent rather than becoming a guess.
  ...derived('fish', [
    'Acanthuridae', 'Anomalopidae', 'Antennariidae', 'Anthiadidae', 'Apogonidae',
    'Balistidae', 'Blenniidae', 'Bothidae', 'Callionymidae', 'Centriscidae',
    'Chaenopsidae', 'Chaetodontidae', 'Cirrhitidae', 'Dactylopteridae', 'Diodontidae',
    'Enoplosidae', 'Ephippidae', 'Epinephelidae', 'Gobiesocidae', 'Grammatidae',
    'Grammistidae', 'Haemulidae', 'Hemiscylliidae', 'Heterodontidae', 'Holocentridae',
    'Labridae', 'Liopropomatidae', 'Malacanthidae', 'Microcanthinae', 'Monacanthidae',
    'Monocentridae', 'Mullidae', 'Nemipteridae', 'Ogcocephalidae', 'Opistognathidae',
    'Ostraciidae', 'Pegasidae', 'Plesiopidae', 'Pomacanthidae', 'Pomacentridae',
    'Priacanthidae', 'Pseudochromidae', 'Scorpaenidae', 'Siganidae', 'Sternopygidae',
    'Synanceiidae', 'Syngnathidae', 'Urotrygonidae', 'Zanclidae',
  ]),
  ...derived('invertebrate', [
    'Acroporidae', 'Actiniidae', 'Agariciidae', 'Aglajidae', 'Alcyoniidae', 'Alpheidae',
    'Aplysiidae', 'Archasteridae', 'Cardiidae', 'Cerithiidae', 'Cidaridae',
    'Columbellidae', 'Cucumariidae', 'Cypraeidae', 'Dendrophylliidae', 'Diadematidae',
    'Diogenidae', 'Diploastreidae', 'Discosomidae', 'Echinasteridae', 'Enoplometopidae',
    'Euphylliidae', 'Faviidae', 'Fissurellidae', 'Fungiidae', 'Galatheidae',
    'Goniasteridae', 'Haliotidae', 'Helioporidae', 'Heteractidae', 'Hexabranchidae',
    'Hippolytidae', 'Holothuriidae', 'Inachidae', 'Limidae', 'Limulidae', 'Lobophylliidae',
    'Lysmatidae', 'Margaritidae', 'Merulinidae', 'Mithracidae', 'Octopodidae',
    'Odontodactylidae', 'Ophidiasteridae', 'Ophiocomidae', 'Oreasteridae', 'Percnidae',
    'Plerogyridae', 'Plesiastreidae', 'Plexauridae', 'Pocilloporidae', 'Porcellanidae',
    'Rhynchocinetidae', 'Ricordeidae', 'Sabellidae', 'Serpulidae', 'Spongiodermidae',
    'Stenopodidae', 'Stichodactylidae', 'Stichopodidae', 'Strombidae', 'Tegulidae',
    'Tetillidae', 'Thoridae', 'Trochidae', 'Tubiporidae', 'Turbinidae', 'Ulmaridae',
    'Xeniidae', 'Zoanthidae',
  ]),
  ...derived('plant', [
    'Acoraceae', 'Cannaceae', 'Equisetaceae', 'Malvaceae', 'Marantaceae', 'Nelumbonaceae',
    'Poaceae', 'Saururaceae', 'Typhaceae',
  ]),

};

// --- helpers ---------------------------------------------------------------
// These exist only to keep the table above readable. Writing 200 identical
// `{ kind, zone, note }` objects by hand would bury the classification in
// punctuation and make a wrong zone hard to see in a diff.

function fill(kind: OrganismKind, zone: WaterZone | undefined, note: string, families: string[]) {
  return Object.fromEntries(families.map((f) => [f, { kind, ...(zone ? { zone } : {}), note }]));
}
function bottom(kind: OrganismKind, note: string, f: string[]) { return fill(kind, 'bottom', note, f); }
function mid(kind: OrganismKind, note: string, f: string[]) { return fill(kind, 'mid', note, f); }
function top(kind: OrganismKind, note: string, f: string[]) { return fill(kind, 'top', note, f); }
function allLevels(kind: OrganismKind, note: string, f: string[]) { return fill(kind, 'all-levels', note, f); }
/**
 * A family classified from taxonomy alone: kind known, zone deliberately not.
 *
 * Separate from `fill` so the diff shows at a glance which families carry a
 * sourced water-column habit and which only carry a kingdom-level fact.
 */
function derived(kind: OrganismKind, f: string[]) {
  return fill(kind, undefined, 'Kind derived from Wikipedia taxonomy (npm run genera:classify); water-column habit not sourced.', f);
}
function plants(f: string[]) {
  return fill('plant', undefined, 'Aquatic or marginal plant; position in the tank is a planting decision, not a trait.', f);
}

/**
 * Genus to family, for every genus the catalog contains.
 *
 * Stable taxonomy, verified against Wikipedia. Where a 2023-2025 revision
 * moved a genus, the CURRENT family is used and FAMILY_TRAITS carries the
 * superseded name too, so neither spelling drops out of the filter.
 *
 * A genus that is not a genus at all - a vendor typo, a trade category - is
 * absent here and listed in MISSPELLED_GENERA instead.
 */
export const GENUS_FAMILY: Record<string, string> = {
  Aborichthys: 'Nemacheilidae', Acanthicus: 'Loricariidae', Acarichthys: 'Cichlidae',
  Acaronia: 'Cichlidae', Acestrorhynchus: 'Acestrorhynchidae', Acipenser: 'Acipenseridae',
  Acnodon: 'Serrasalmidae', Acrossocheilus: 'Cyprinidae', Aegagropila: 'Pithophoraceae',
  Agamyxis: 'Doradidae', Ageneiosus: 'Auchenipteridae', Aguarunichthys: 'Pimelodidae',
  Akysis: 'Akysidae', Alestopetersius: 'Alestidae', Alternanthera: 'Amaranthaceae',
  Amatitlania: 'Cichlidae', Ambastaia: 'Botiidae', Ambystoma: 'Ambystomatidae',
  Ameiurus: 'Ictaluridae', Amia: 'Amiidae', Amphilophus: 'Cichlidae',
  Anabas: 'Anabantidae', Ancistomus: 'Loricariidae', Ancistrus: 'Loricariidae',
  Andinoacara: 'Cichlidae', Anguilla: 'Anguillidae', Anomalochromis: 'Cichlidae',
  Anubias: 'Araceae', Aphyocharax: 'Characidae', Apistogramma: 'Cichlidae',
  Aplocheilichthys: 'Procatopodidae', Aplocheilus: 'Aplocheilidae', Aponogeton: 'Aponogetonaceae',
  Apteronotus: 'Apteronotidae', Arapaima: 'Arapaimidae', Arius: 'Ariidae',
  Astatheros: 'Cichlidae', Asterophysus: 'Auchenipteridae', Astronotus: 'Cichlidae',
  Astyanax: 'Acestrorhamphidae', Atractosteus: 'Lepisosteidae', Atya: 'Atyidae',
  Atyopsis: 'Atyidae', Auchenoglanis: 'Auchenoglanididae', Aulonocara: 'Cichlidae',
  Auriglobus: 'Tetraodontidae', Axelrodia: 'Acestrorhamphidae', Azolla: 'Salviniaceae',
  Bacopa: 'Plantaginaceae', Badis: 'Badidae', Bagarius: 'Sisoridae',
  Bagrichthys: 'Bagridae', Bagroides: 'Bagridae', Balantiocheilos: 'Cyprinidae',
  Balantiocheilus: 'Cyprinidae', Barbodes: 'Cyprinidae', Barbonymus: 'Cyprinidae',
  Barbus: 'Cyprinidae', Baryancistrus: 'Loricariidae', Batrachomoeus: 'Batrachoididae',
  Beaufortia: 'Gastromyzontidae', Belodontichthys: 'Siluridae', Belonesox: 'Poeciliidae',
  Belonophago: 'Distichodontidae', Betta: 'Osphronemidae', Biotodoma: 'Cichlidae',
  Boehlkea: 'Stevardiidae', Boesemania: 'Sciaenidae', Bolbitis: 'Dryopteridaceae',
  Boraras: 'Danionidae', Botia: 'Botiidae', Boulengerella: 'Ctenoluciidae',
  Boulengerochromis: 'Cichlidae', Brachydanio: 'Danionidae', Brachygobius: 'Oxudercidae',
  Brachyplatystoma: 'Pimelodidae', Brachirus: 'Soleidae', Brevibora: 'Danionidae',
  Brevidens: 'Anostomidae', Brotia: 'Pachychilidae', Brycinus: 'Alestidae',
  Brycon: 'Bryconidae', Bujurquina: 'Cichlidae', Bunocephalus: 'Aspredinidae',
  Cabomba: 'Cabombaceae', Calophysus: 'Pimelodidae', Cambarellus: 'Cambaridae',
  Campylomormyrus: 'Mormyridae', Caranx: 'Carangidae', Carassius: 'Cyprinidae',
  Carcharhinus: 'Carcharhinidae', Cardisoma: 'Gecarcinidae', Caridina: 'Atyidae',
  Carinotetraodon: 'Tetraodontidae', Carnegiella: 'Gasteropelecidae', Casuarina: 'Casuarinaceae',
  Catlocarpio: 'Cyprinidae', Celestichthys: 'Danionidae', Celetaia: 'Viviparidae',
  Centrodoras: 'Doradidae', Centromochlus: 'Auchenipteridae', Centropomus: 'Centropomidae',
  Cephalosilurus: 'Pseudopimelodidae', Ceratophyllum: 'Ceratophyllaceae', Ceratopteris: 'Pteridaceae',
  Cetopsis: 'Cetopsidae', Chaetobranchus: 'Cichlidae', Chalceus: 'Chalceidae',
  Chanodichthys: 'Xenocyprididae', Charax: 'Characidae', Cherax: 'Parastacidae',
  Chilatherina: 'Melanotaeniidae', Chindongo: 'Cichlidae', Chitala: 'Notopteridae',
  Chromobotia: 'Botiidae', Cichla: 'Cichlidae', Cichlasoma: 'Cichlidae',
  Clea: 'Nassariidae', Clithon: 'Neritidae', Coenobita: 'Coenobitidae',
  Colomesus: 'Tetraodontidae', Colossoma: 'Serrasalmidae', Copadichromis: 'Cichlidae',
  Corydoras: 'Callichthyidae', Crenicichla: 'Cichlidae', Crinum: 'Amaryllidaceae',
  Crossocheilus: 'Cyprinidae', Cryptarius: 'Ariidae', Cryptocoryne: 'Araceae',
  Cryptoheros: 'Cichlidae', Ctenolucius: 'Ctenoluciidae', Ctenopoma: 'Anabantidae',
  Cyphotilapia: 'Cichlidae', Cyprinella: 'Leuciscidae', Cyprinus: 'Cyprinidae',
  Cyrtocara: 'Cichlidae', Danio: 'Danionidae', Daphnia: 'Daphniidae',
  Darienheros: 'Cichlidae', Dario: 'Badidae', Dasyatis: 'Dasyatidae',
  Datnioides: 'Datnioididae', Dawkinsia: 'Cyprinidae', Dekeyseria: 'Loricariidae',
  Dermogenys: 'Zenarchopteridae', Desmopuntius: 'Cyprinidae', Devario: 'Danionidae',
  Dichotomyctere: 'Tetraodontidae', Dicrossus: 'Cichlidae', Dimidiochromis: 'Cichlidae',
  Dionaea: 'Droseraceae', Distichodus: 'Distichodontidae', Doras: 'Doradidae',
  Dormitator: 'Eleotridae', Echinodorus: 'Alismataceae', Eichhornia: 'Pontederiaceae',
  Eleocharis: 'Cyperaceae', Electrophorus: 'Gymnotidae', Elopichthys: 'Xenocyprididae',
  Epalzeorhynchos: 'Cyprinidae', Epinephelus: 'Serranidae', Epiplatys: 'Nothobranchiidae',
  Epipremnum: 'Araceae', Erethistes: 'Sisoridae', Erpetoichthys: 'Polypteridae',
  Erythrinus: 'Erythrinidae', Esox: 'Esocidae', Exodon: 'Characidae',
  Farlowella: 'Loricariidae', Faunus: 'Pachychilidae', Filopaludina: 'Viviparidae',
  Fissidens: 'Fissidentaceae', Fluvitrygon: 'Dasyatidae', Franciscodoras: 'Doradidae',
  Fundulopanchax: 'Nothobranchiidae', Fundulus: 'Fundulidae', Garra: 'Cyprinidae',
  Gastromyzon: 'Gastromyzontidae', Geophagus: 'Cichlidae', Geosesarma: 'Sesarmidae',
  Girardinus: 'Poeciliidae', Giuris: 'Eleotridae', Glossolepis: 'Melanotaeniidae',
  Glossostigma: 'Phrymaceae', Glyptoperichthys: 'Loricariidae', Gnathonemus: 'Mormyridae',
  Gratiola: 'Plantaginaceae', Guianacara: 'Cichlidae', Gymnarchus: 'Gymnarchidae',
  Gymnocorymbus: 'Acestrorhamphidae', Gymnogeophagus: 'Cichlidae', Gymnothorax: 'Muraenidae',
  Gymnotus: 'Gymnotidae', Gyrinocheilus: 'Gyrinocheilidae', Haludaria: 'Cyprinidae',
  Hampala: 'Cyprinidae', Haplochromis: 'Cichlidae', Hara: 'Sisoridae',
  Hasemania: 'Acestrorhamphidae', Helanthium: 'Alismataceae', Helostoma: 'Helostomatidae',
  Hemiancistrus: 'Loricariidae', Hemibagrus: 'Bagridae', Hemichromis: 'Cichlidae',
  Hemigrammus: 'Acestrorhamphidae', Hemigraphis: 'Acanthaceae', Hemianthus: 'Linderniaceae',
  Hemirhamphodon: 'Zenarchopteridae', Hemisynodontis: 'Mochokidae', Hepsetus: 'Hepsetidae',
  Hephaestus: 'Terapontidae', Herichthys: 'Cichlidae', Herotilapia: 'Cichlidae',
  Heros: 'Cichlidae', Heterotis: 'Osteoglossidae', Holopristis: 'Characidae',
  Homaloptera: 'Balitoridae', Homalopteroides: 'Balitoridae', Hoplarchus: 'Cichlidae',
  Hoplerythrinus: 'Erythrinidae', Hoplias: 'Erythrinidae', Hoplisoma: 'Callichthyidae',
  Hoplosternum: 'Callichthyidae', Horabagrus: 'Horabagridae', Hyalobagrus: 'Bagridae',
  Hydrocotyle: 'Araliaceae', Hydrocynus: 'Alestidae', Hydrolycus: 'Cynodontidae',
  Hygrophila: 'Acanthaceae', Hymenochirus: 'Pipidae', Hypancistrus: 'Loricariidae',
  Hyphessobrycon: 'Characidae', Hypoptopoma: 'Loricariidae', Hypostomus: 'Loricariidae',
  Hypselecara: 'Cichlidae', Hypseleotris: 'Eleotridae', Hypsibarbus: 'Cyprinidae',
  Hypsophrys: 'Cichlidae', Ictalurus: 'Ictaluridae', Indoplanorbis: 'Bulinidae',
  Inpaichthys: 'Acestrorhamphidae', Iriatherina: 'Melanotaeniidae', Jordanella: 'Cyprinodontidae',
  Juncus: 'Juncaceae', Kapuasia: 'Nemacheilidae', Knodus: 'Stevardiidae',
  Kronoheros: 'Cichlidae', Kryptopterus: 'Siluridae', Kuhlia: 'Kuhliidae',
  Labeo: 'Cyprinidae', Labeobarbus: 'Cyprinidae', Labeotropheus: 'Cichlidae',
  Labidochromis: 'Cichlidae', Laetacara: 'Cichlidae', Lamprichthys: 'Procatopodidae',
  Lamprologus: 'Cichlidae', Lates: 'Latidae', Leiarius: 'Pimelodidae',
  Leiocassis: 'Bagridae', Lemna: 'Araceae', Lentipes: 'Oxudercidae',
  Lepidosiren: 'Lepidosirenidae', Lepidothelphusa: 'Gecarcinucidae', Lepisosteus: 'Lepisosteidae',
  Leporacanthicus: 'Loricariidae', Leporinus: 'Anostomidae', Leptobarbus: 'Cyprinidae',
  Leptobotia: 'Botiidae', Lilaeopsis: 'Apiaceae', Limia: 'Poeciliidae',
  Limnobium: 'Hydrocharitaceae', Limnophila: 'Plantaginaceae', Limnopilos: 'Hymenosomatidae',
  Lindernia: 'Linderniaceae', Liosomadoras: 'Auchenipteridae', Lithobates: 'Ranidae',
  Lithodoras: 'Doradidae', Littorella: 'Plantaginaceae', Lobelia: 'Campanulaceae',
  Lophiosilurus: 'Pseudopimelodidae', Loricaria: 'Loricariidae', Lota: 'Lotidae',
  Lucania: 'Fundulidae', Luciobarbus: 'Cyprinidae', Luciosoma: 'Danionidae',
  Ludwigia: 'Onagraceae', Lumbriculus: 'Lumbriculidae', Lutjanus: 'Lutjanidae',
  Lysimachia: 'Primulaceae', Maccullochella: 'Percichthyidae', Macrobrachium: 'Palaemonidae',
  Macrochirichthys: 'Xenocyprididae', Macrognathus: 'Mastacembelidae', Macropodus: 'Osphronemidae',
  Mangifera: 'Anacardiaceae', Marosatherina: 'Telmatherinidae', Marsilea: 'Marsileaceae',
  Maskaheros: 'Cichlidae', Mastacembelus: 'Mastacembelidae', Megalamphodus: 'Acestrorhamphidae',
  Megalechis: 'Callichthyidae', Megalodoras: 'Doradidae', Megalops: 'Megalopidae',
  Melanochromis: 'Cichlidae', Melanoides: 'Thiaridae', Melanotaenia: 'Melanotaeniidae',
  Mesoheros: 'Cichlidae', Mesonauta: 'Cichlidae', Mesonoemacheilus: 'Nemacheilidae',
  Metasesarma: 'Sesarmidae', Metriaclima: 'Cichlidae', Metynnis: 'Serrasalmidae',
  Micranthemum: 'Linderniaceae', Microctenopoma: 'Anabantidae', Microdevario: 'Danionidae',
  Microglanis: 'Pseudopimelodidae', Micropterus: 'Centrarchidae', Microsorum: 'Polypodiaceae',
  Mikrogeophagus: 'Cichlidae', Misgurnus: 'Cobitidae', Moenkhausia: 'Acestrorhamphidae',
  Mogurnda: 'Eleotridae', Monocirrhus: 'Polycentridae', Monodactylus: 'Monodactylidae',
  Monopterus: 'Synbranchidae', Mormyrops: 'Mormyridae', Mormyrus: 'Mormyridae',
  Morone: 'Moronidae', Mugilogobius: 'Oxudercidae', Myleus: 'Serrasalmidae',
  Mylochromis: 'Cichlidae', Myloplus: 'Serrasalmidae', Myxocyprinus: 'Catostomidae',
  Najas: 'Hydrocharitaceae', Nandopsis: 'Cichlidae', Nannacara: 'Cichlidae',
  Nannostomus: 'Lebiasinidae', Nanochromis: 'Cichlidae', Neoarius: 'Ariidae',
  Neocaridina: 'Atyidae', Neoceratodus: 'Neoceratodontidae', Neolamprologus: 'Cichlidae',
  Neolissochilus: 'Cyprinidae', Neritina: 'Neritidae', Neritodryas: 'Neritidae',
  Nematobrycon: 'Characidae', Nesodillo: 'Armadillidae', Nimbochromis: 'Cichlidae',
  Niwaella: 'Cobitidae', Nomorhampus: 'Zenarchopteridae', Notoglanidium: 'Claroteidae',
  Nothobranchius: 'Nothobranchiidae', Notropis: 'Leuciscidae', Nymphaea: 'Nymphaeaceae',
  Nymphoides: 'Menyanthaceae', Oryzias: 'Adrianichthyidae', Osphronemus: 'Osphronemidae',
  Osteogaster: 'Callichthyidae', Osteoglossum: 'Osteoglossidae', Otocinclus: 'Loricariidae',
  Otothyropsis: 'Loricariidae', Oxydoras: 'Doradidae', Oxyeleotris: 'Eleotridae',
  Palaemonetes: 'Palaemonidae', Panaqolus: 'Loricariidae', Panaque: 'Loricariidae',
  Pangasianodon: 'Pangasiidae', Pangasius: 'Pangasiidae', Pangio: 'Cobitidae',
  Pantodon: 'Pantodontidae', Pao: 'Tetraodontidae', Papyrocranus: 'Notopteridae',
  Parabotia: 'Botiidae', Paracheilognathus: 'Acheilognathidae', Paracheirodon: 'Acestrorhamphidae',
  Parachromis: 'Cichlidae', Paracrossochilus: 'Cyprinidae', Paracyprichromis: 'Cichlidae',
  Parambassis: 'Ambassidae', Paraneetroplus: 'Cichlidae', Parancistrus: 'Loricariidae',
  Parathelphusa: 'Gecarcinucidae', Paretroplus: 'Cichlidae', Pareutropius: 'Schilbeidae',
  Paratilapia: 'Cichlidae', Parosphromenus: 'Osphronemidae', Peckoltia: 'Loricariidae',
  Pelodiscus: 'Trionychidae', Pelvicachromis: 'Cichlidae', Petenia: 'Cichlidae',
  Pethia: 'Cyprinidae', Petrochromis: 'Cichlidae', Phago: 'Distichodontidae',
  Phalacronotus: 'Siluridae', Phenacogrammus: 'Alestidae', Phractocephalus: 'Pimelodidae',
  Phyllanthus: 'Phyllanthaceae', Physella: 'Physidae', Piabina: 'Stevardiidae',
  Piaractus: 'Serrasalmidae', Pimelodus: 'Pimelodidae', Pinirampus: 'Pimelodidae',
  Pistia: 'Araceae', Placidochromis: 'Cichlidae', Planorbarius: 'Planorbidae',
  Platydoras: 'Doradidae', Platynematichthys: 'Pimelodidae', Poecilia: 'Poeciliidae',
  Poecilocharax: 'Crenuchidae', Pogostemon: 'Lamiaceae', Polyodon: 'Polyodontidae',
  Polypterus: 'Polypteridae', Pomacea: 'Ampullariidae', Porcellio: 'Porcellionidae',
  Poropanchax: 'Procatopodidae', Potamotrygon: 'Potamotrygonidae', Prionobrama: 'Characidae',
  Pristella: 'Characidae', Procambarus: 'Cambaridae', Prochilodus: 'Prochilodontidae',
  Proserpinaca: 'Haloragaceae', Protomelas: 'Cichlidae', Protopterus: 'Protopteridae',
  Pseudacanthicus: 'Loricariidae', Pseudancistrus: 'Loricariidae', Pseudohemiodon: 'Loricariidae',
  Pseudolithoxus: 'Loricariidae', Pseudomugil: 'Pseudomugilidae', Pseudomystus: 'Bagridae',
  Pseudopimelodus: 'Pseudopimelodidae', Pseudoplatystoma: 'Pimelodidae', Pseudorinelepis: 'Loricariidae',
  Pterodoras: 'Doradidae', Pterophyllum: 'Cichlidae', Pterygoplichthys: 'Loricariidae',
  Ptychochromis: 'Cichlidae', Ptychognathus: 'Varunidae', Puntigrus: 'Cyprinidae',
  Puntioplites: 'Cyprinidae', Puntius: 'Cyprinidae', Raiamas: 'Danionidae',
  Rasbora: 'Cyprinidae', Retroculus: 'Cichlidae', Rhamdia: 'Heptapteridae',
  Rhodeus: 'Acheilognathidae', Riccia: 'Ricciaceae', Ricciocarpos: 'Ricciaceae',
  Rineloricaria: 'Loricariidae', Rocio: 'Cichlidae', Rohanella: 'Cyprinidae',
  Rotala: 'Lythraceae', Rubricatochromis: 'Cichlidae', Sagittaria: 'Alismataceae',
  Sahyadria: 'Cyprinidae', Salvinia: 'Salviniaceae', Sarcocheilichthys: 'Gobionidae',
  Satanoperca: 'Cichlidae', Sawbwa: 'Cyprinidae', Scatophagus: 'Scatophagidae',
  Schismatogobius: 'Oxudercidae', Sciaenochromis: 'Cichlidae', Scleropages: 'Osteoglossidae',
  Scobiancistrus: 'Loricariidae', Scobinancistrus: 'Loricariidae', Semaprochilodus: 'Prochilodontidae',
  Semilabeo: 'Cyprinidae', Septaria: 'Neritidae', Serpenticobitis: 'Serpenticobitidae',
  Sewellia: 'Gastromyzontidae', Sicyopterus: 'Oxudercidae', Sicyopus: 'Oxudercidae',
  Silurus: 'Siluridae', Simpsonichthys: 'Rivulidae', Sinanodonta: 'Unionidae',
  Siniperca: 'Sinipercidae', Sinotaia: 'Viviparidae', Sorubim: 'Pimelodidae',
  Sorubimichthys: 'Pimelodidae', Spathiphyllum: 'Araceae', Spectracanthicus: 'Loricariidae',
  Sphaerichthys: 'Osphronemidae', Spinibarbus: 'Cyprinidae', Spirodela: 'Araceae',
  Squaliforma: 'Loricariidae', Staurogyne: 'Acanthaceae', Stegostoma: 'Stegostomatidae',
  Stenomelania: 'Thiaridae', Stigmatogobius: 'Oxudercidae', Stiphodon: 'Gobiidae',
  Sturisoma: 'Loricariidae', Sturisomatichthys: 'Loricariidae', Sundadanio: 'Sundadanionidae',
  Symphysodon: 'Cichlidae', Synaptolaemus: 'Anostomidae', Synbranchus: 'Synbranchidae',
  Syngonium: 'Araceae', Synodontis: 'Mochokidae', Syntripsa: 'Gecarcinucidae',
  Systomus: 'Cyprinidae', Tachysurus: 'Bagridae', Takifugu: 'Tetraodontidae',
  Tanichthys: 'Tanichthyidae', Tateurndina: 'Eleotridae', Tatia: 'Auchenipteridae',
  Taxiphyllum: 'Hypnaceae', Tenellus: 'Doradidae', Terminalia: 'Combretaceae',
  Tetranematichthys: 'Auchenipteridae', Tetraodon: 'Tetraodontidae', Thayeria: 'Acestrorhamphidae',
  Thiara: 'Thiaridae', Thorichthys: 'Cichlidae', Tilapia: 'Cichlidae',
  Tomocichla: 'Cichlidae', Tometes: 'Serrasalmidae', Tor: 'Cyprinidae',
  Toxotes: 'Toxotidae', Trachelyopterus: 'Auchenipteridae', Trachycorystes: 'Auchenipteridae',
  Tradescantia: 'Commelinaceae', Trichogaster: 'Osphronemidae', Trichopodus: 'Osphronemidae',
  Trichopsis: 'Osphronemidae', Trigonostigma: 'Cyprinidae', Triportheus: 'Triportheidae',
  Tubifex: 'Naididae', Tylomelania: 'Pachychilidae', Tyrannochromis: 'Cichlidae',
  Uaru: 'Cichlidae', Utiaritichthys: 'Serrasalmidae', Utricularia: 'Lentibulariaceae',
  Vallisneria: 'Hydrocharitaceae', Vesicularia: 'Hypnaceae', Vieja: 'Cichlidae',
  Vittina: 'Neritidae', Wallaciia: 'Cichlidae', Wallagonia: 'Siluridae',
  Wertheimeria: 'Doradidae', Xenentodon: 'Belonidae', Xenomystus: 'Notopteridae',
  Xenopus: 'Pipidae', Xiphophorus: 'Poeciliidae', Yaoshania: 'Gastromyzontidae',
  Yasuhikotakia: 'Botiidae', Zephyranthes: 'Amaryllidaceae', Zoogoneticus: 'Goodeidae',
  Zungaro: 'Pimelodidae',

  // --- Derived 2026-08-30 by `npm run genera:classify` (spec 009, BUG-03) ---
  // 368 genera the hand-compiled table never saw, almost all reef stock that
  // arrived with a saltwater vendor. Genus -> family walked from Wikipedia's
  // taxonomy templates, which is structured data rather than prose.
  Abudefduf: 'Pomacentridae', Acanthastrea: 'Lobophylliidae', Acanthemblemaria: 'Chaenopsidae',
  Acanthochromis: 'Pomacentridae', Acanthostracion: 'Ostraciidae', Acanthurus: 'Acanthuridae',
  Acantopsis: 'Cobitidae', Acorus: 'Acoraceae', Acreichthys: 'Monacanthidae',
  Acropora: 'Acroporidae', Aeoliscus: 'Centriscidae', Aequidens: 'Cichlidae',
  Allogalathea: 'Galatheidae', Alpheus: 'Alpheidae', Altolamprologus: 'Cichlidae',
  Amblyeleotris: 'Gobiidae', Amblyglyphidodon: 'Pomacentridae', Amblygobius: 'Gobiidae',
  Amphiprion: 'Pomacentridae', Anampses: 'Labridae', Ancylomenes: 'Palaemonidae',
  Anisotremus: 'Haemulidae', Anomalops: 'Anomalopidae', Antennarius: 'Antennariidae',
  Aphyosemion: 'Nothobranchiidae', Apogon: 'Apogonidae', Apogonichthyoides: 'Apogonidae',
  Apogonichthys: 'Apogonidae', Apolemichthys: 'Pomacanthidae', Archaster: 'Archasteridae',
  Archocentrus: 'Cichlidae', Arothron: 'Tetraodontidae', Assessor: 'Plesiopidae',
  Astraea: 'Turbinidae', Astropyga: 'Diadematidae', Atrosalarias: 'Blenniidae',
  Aurelia: 'Ulmaridae', Balistapus: 'Balistidae', Balistes: 'Balistidae',
  Balistoides: 'Balistidae', Belonepterygion: 'Plesiopidae', Bispira: 'Sabellidae',
  Blastomussa: 'Plerogyridae', Blenniella: 'Blenniidae', Bodianus: 'Labridae',
  Bothus: 'Bothidae', Brochis: 'Callichthyidae', Buccochromis: 'Cichlidae',
  Caesio: 'Lutjanidae', Calcinus: 'Diogenidae', Calloplesiops: 'Plesiopidae',
  Campanula: 'Campanulaceae', Camposcia: 'Inachidae', Canna: 'Cannaceae',
  Cantherhines: 'Monacanthidae', Canthigaster: 'Tetraodontidae', Caracanthus: 'Scorpaenidae',
  Carettochelys: 'Carettochelyidae', Catalaphyllia: 'Euphylliidae',
  Centropyge: 'Pomacanthidae', Cephalopholis: 'Epinephelidae', Cerithium: 'Cerithiidae',
  Cetoscarus: 'Labridae', Chaenopsis: 'Chaenopsidae', Chaetodermis: 'Monacanthidae',
  Chaetodon: 'Chaetodontidae', Chaetodontoplus: 'Pomacanthidae', Cheilinus: 'Labridae',
  Cheilodipterus: 'Apogonidae', Chelidonura: 'Aglajidae', Chelmon: 'Chaetodontidae',
  Chelonodon: 'Tetraodontidae', Chilomycterus: 'Diodontidae', Chiloscyllium: 'Hemiscylliidae',
  Choerodon: 'Labridae', Choridactylus: 'Synanceiidae', Chromis: 'Pomacentridae',
  Chrysiptera: 'Pomacentridae', Ciliopagurus: 'Diogenidae', Cinachyra: 'Tetillidae',
  Cirrhilabrus: 'Labridae', Cirrhitichthys: 'Cirrhitidae', Cirrhitops: 'Cirrhitidae',
  Cirripectes: 'Blenniidae', Cleidopus: 'Monocentridae', Clibanarius: 'Diogenidae',
  Colochirus: 'Cucumariidae', Congrogadus: 'Pseudochromidae', Conomurex: 'Strombidae',
  Coradion: 'Chaetodontidae', Coris: 'Labridae', Coryphopterus: 'Gobiidae',
  Cromileptes: 'Epinephelidae', Crossosalarias: 'Blenniidae', Cryptocentrus: 'Gobiidae',
  Ctenochaetus: 'Acanthuridae', Ctenogobiops: 'Gobiidae', Cynarina: 'Lobophylliidae',
  Cyperus: 'Cyperaceae', Cypho: 'Pseudochromidae', Cypraea: 'Cypraeidae',
  Cyprinocirrhites: 'Cirrhitidae', Dactyloptena: 'Dactylopteridae',
  Dactylopus: 'Callionymidae', Dardanus: 'Diogenidae', Dascyllus: 'Pomacentridae',
  Dendrochirus: 'Scorpaenidae', Diademichthys: 'Gobiesocidae', Dianema: 'Callichthyidae',
  Diodogorgia: 'Spongiodermidae', Diodon: 'Diodontidae', Diploastrea: 'Diploastreidae',
  Dolabella: 'Aplysiidae', Doryrhamphus: 'Syngnathidae', Duncanopsammia: 'Dendrophylliidae',
  Dunckerocampus: 'Syngnathidae', Echidna: 'Muraenidae', Echinaster: 'Echinasteridae',
  Echinophyllia: 'Lobophylliidae', Echinothrix: 'Diadematidae', Ecsenius: 'Blenniidae',
  Egeria: 'Hydrocharitaceae', Eigenmannia: 'Sternopygidae', Ekemblemaria: 'Chaenopsidae',
  Elacatinus: 'Gobiidae', Enchelycore: 'Muraenidae', Enoplometopus: 'Enoplometopidae',
  Enoplosus: 'Enoplosidae', Entacmaea: 'Actiniidae', Equetus: 'Sciaenidae',
  Equisetum: 'Equisetaceae', Eucidaris: 'Cidaridae', Euphyllia: 'Euphylliidae',
  Eurypegasus: 'Pegasidae', Eviota: 'Gobiidae', Exallias: 'Blenniidae', Favia: 'Faviidae',
  Favites: 'Merulinidae', Forcipiger: 'Chaetodontidae', Fowleria: 'Apogonidae',
  Fromia: 'Goniasteridae', Fungia: 'Fungiidae', Galaxea: 'Euphylliidae',
  Gambusia: 'Poeciliidae', Gasteropelecus: 'Gasteropelecidae', Genicanthus: 'Pomacanthidae',
  Gnathophyllum: 'Palaemonidae', Gobiodon: 'Gobiidae', Gobiopsis: 'Gobiidae',
  Gomphosus: 'Labridae', Goniodiscaster: 'Oreasteridae', Gramma: 'Grammatidae',
  Grammistes: 'Grammistidae', Gymnomuraena: 'Muraenidae', Halichoeres: 'Labridae',
  Haliotis: 'Haliotidae', Heliofungia: 'Fungiidae', Heliopora: 'Helioporidae',
  Hemiscyllium: 'Hemiscylliidae', Hemitaurichthys: 'Chaetodontidae',
  Heniochus: 'Chaetodontidae', Heteractis: 'Heteractidae', Heterodontus: 'Heterodontidae',
  Heteropriacanthus: 'Priacanthidae', Hexabranchus: 'Hexabranchidae', Hibiscus: 'Malvaceae',
  Hippocampus: 'Syngnathidae', Hippopus: 'Cardiidae', Histrio: 'Antennariidae',
  Holacanthus: 'Pomacanthidae', Hologymnosus: 'Labridae', Holothuria: 'Holothuriidae',
  Homophyllia: 'Lobophylliidae', Hoplolatilus: 'Malacanthidae', Hottonia: 'Primulaceae',
  Houttuynia: 'Saururaceae', Hydnophora: 'Merulinidae', Hydrocleys: 'Alismataceae',
  Hymenocallis: 'Amaryllidaceae', Hymenocera: 'Palaemonidae', Hypsoblennius: 'Blenniidae',
  Hypsypops: 'Pomacentridae', Iconaster: 'Goniasteridae', Isaurus: 'Zoanthidae',
  Istigobius: 'Gobiidae', Koumansetta: 'Gobiidae', Labracinus: 'Pseudochromidae',
  Labroides: 'Labridae', Lactoria: 'Ostraciidae', Larabicus: 'Labridae',
  Leander: 'Palaemonidae', Leptastrea: 'Faviidae', Leptoseris: 'Agariciidae', Lima: 'Limidae',
  Limulus: 'Limulidae', Linckia: 'Ophidiasteridae', Liopropoma: 'Liopropomatidae',
  Lobophyllia: 'Lobophylliidae', Lotilia: 'Gobiidae', Luzonichthys: 'Anthiadidae',
  Lysmata: 'Lysmatidae', Lythrypnus: 'Gobiidae', Macrodactyla: 'Actiniidae',
  Macropharyngodon: 'Labridae', Manonichthys: 'Pseudochromidae', Margarites: 'Margaritidae',
  Megathura: 'Fissurellidae', Meiacanthus: 'Blenniidae', Melichthys: 'Balistidae',
  Merulina: 'Merulinidae', Microcanthus: 'Microcanthinae', Micromussa: 'Lobophylliidae',
  Microspathodon: 'Pomacentridae', Mimulus: 'Phrymaceae', Mirolabrichthys: 'Anthiadidae',
  Mithraculus: 'Mithracidae', Monetaria: 'Cypraeidae', Montipora: 'Acroporidae',
  Muraena: 'Muraenidae', Myriophyllum: 'Haloragaceae', Myripristis: 'Holocentridae',
  Mystus: 'Bagridae', Nardoa: 'Ophidiasteridae', Naso: 'Acanthuridae',
  Nelumbo: 'Nelumbonaceae', Nemanthias: 'Anthiadidae', Nemateleotris: 'Gobiidae',
  Neocirrhites: 'Cirrhitidae', Neoglyphidodon: 'Pomacentridae', Neoniphon: 'Holocentridae',
  Neopetrolisthes: 'Porcellanidae', Neopomacentrus: 'Pomacentridae', Nerita: 'Neritidae',
  Nomorhamphus: 'Zenarchopteridae', Novaculichthys: 'Labridae', Octopus: 'Octopodidae',
  Odontanthias: 'Anthiadidae', Odontodactylus: 'Odontodactylidae', Odonus: 'Balistidae',
  Ogcocephalus: 'Ogcocephalidae', Ogilbyina: 'Pseudochromidae', Omobranchus: 'Blenniidae',
  Ophioblennius: 'Blenniidae', Ophiocoma: 'Ophiocomidae', Ophiomastix: 'Ophiocomidae',
  Opistognathus: 'Opistognathidae', Orontium: 'Araceae', Ostorhinchus: 'Apogonidae',
  Ostracion: 'Ostraciidae', Otopharynx: 'Cichlidae', Oxycirrhites: 'Cirrhitidae',
  Paguristes: 'Diogenidae', Paracanthurus: 'Acanthuridae', Paracentropyge: 'Pomacanthidae',
  Paracheilinus: 'Labridae', Paracirrhites: 'Cirrhitidae', Paragobiodon: 'Gobiidae',
  Paraplesiops: 'Plesiopidae', Parioglossus: 'Gobiidae', Parupeneus: 'Mullidae',
  Pavona: 'Agariciidae', Pentacta: 'Cucumariidae', Pentapodus: 'Nemipteridae',
  Percnon: 'Percnidae', Periclimenes: 'Palaemonidae', Pervagor: 'Monacanthidae',
  Petrolisthes: 'Porcellanidae', Phalaris: 'Poaceae', Philodendron: 'Araceae',
  Physostegia: 'Lamiaceae', Pictichromis: 'Pseudochromidae', Pictocolumbella: 'Columbellidae',
  Pilsbryoconcha: 'Unionidae', Platax: 'Ephippidae', Plectorhinchus: 'Haemulidae',
  Plectranthias: 'Anthiadidae', Plectropomus: 'Epinephelidae', Plerogyra: 'Plerogyridae',
  Plesiastrea: 'Plesiastreidae', Pocillopora: 'Pocilloporidae', Pogonoperca: 'Grammistidae',
  Pomacanthus: 'Pomacanthidae', Pomacentrus: 'Pomacentridae', Pontederia: 'Pontederiaceae',
  Porcellionides: 'Porcellionidae', Premnas: 'Pomacentridae', Priolepis: 'Gobiidae',
  Prognathodes: 'Chaetodontidae', Protomyzon: 'Gastromyzontidae', Protoreaster: 'Oreasteridae',
  Protula: 'Serpulidae', Pseudanthias: 'Anthiadidae', Pseudechidna: 'Muraenidae',
  Pseudobalistes: 'Balistidae', Pseudocheilinops: 'Labridae', Pseudocheilinus: 'Labridae',
  Pseudochromis: 'Pseudochromidae', Pseudocolochirus: 'Cucumariidae', Pseudodax: 'Labridae',
  Pseudojuloides: 'Labridae', Pseudoplesiops: 'Pseudochromidae', Pseudotropheus: 'Cichlidae',
  Pterapogon: 'Apogonidae', Ptereleotris: 'Gobiidae', Pterois: 'Scorpaenidae',
  Pygoplites: 'Pomacanthidae', Rachoviscus: 'Acestrorhamphidae', Rhinecanthus: 'Balistidae',
  Rhinomuraena: 'Muraenidae', Rhinopias: 'Scorpaenidae', Rhodactis: 'Discosomidae',
  Rhynchocinetes: 'Rhynchocinetidae', Ricordea: 'Ricordeidae', Salarias: 'Blenniidae',
  Sarcophyton: 'Alcyoniidae', Sargocentron: 'Holocentridae', Saron: 'Hippolytidae',
  Saururus: 'Saururaceae', Scartella: 'Blenniidae', Scolopsis: 'Nemipteridae',
  Selene: 'Carangidae', Selenotoca: 'Scatophagidae', Seriatopora: 'Pocilloporidae',
  Serranocirrhitus: 'Anthiadidae', Serranus: 'Serranidae', Siganus: 'Siganidae',
  Signigobius: 'Gobiidae', Sinularia: 'Alcyoniidae', Sparisoma: 'Labridae',
  Sphaeramia: 'Apogonidae', Spirobranchus: 'Serpulidae', Steatocranus: 'Cichlidae',
  Stenopus: 'Stenopodidae', Stenorhynchus: 'Inachidae', Stichodactyla: 'Stichodactylidae',
  Stichopus: 'Stichopodidae', Stonogobiops: 'Gobiidae', Stylophora: 'Pocilloporidae',
  Sufflamen: 'Balistidae', Swiftia: 'Plexauridae', Synchiropus: 'Callionymidae',
  Taenianotus: 'Scorpaenidae', Taeniura: 'Dasyatidae', Tectus: 'Tegulidae',
  Telmatherina: 'Telmatherinidae', Thalassoma: 'Labridae', Thalia: 'Marantaceae',
  Thor: 'Thoridae', Tigrigobius: 'Gobiidae', Trachyphyllia: 'Merulinidae',
  Tridacna: 'Cardiidae', Trimma: 'Gobiidae', Trochus: 'Trochidae', Tropheus: 'Cichlidae',
  Tubipora: 'Tubiporidae', Tulbaghia: 'Amaryllidaceae', Turbo: 'Turbinidae',
  Typha: 'Typhaceae', Urotrygon: 'Urotrygonidae', Valenciennea: 'Gobiidae',
  Variola: 'Epinephelidae', Viviparus: 'Viviparidae', Wetmorella: 'Labridae',
  Xanthichthys: 'Balistidae', Xenia: 'Xeniidae', Zanclus: 'Zanclidae',
  Zebrasoma: 'Acanthuridae', Zoramia: 'Apogonidae',

};

/**
 * "Genus" strings in the catalog that are not genera.
 *
 * Every one is a vendor typo or a shop category that the derivation turned
 * into a species. They are recorded rather than silently skipped because each
 * one is a duplicate of a real species elsewhere in the catalog, and that is
 * worth being able to count.
 */
export const MISSPELLED_GENERA: Record<string, string> = {
  Abrimites: 'Abramites',
  Aegle: 'Aegla',
  Balantiocheilus: 'Balantiocheilos',
  Bleotris: 'Eleotris',
  Crencichla: 'Crenicichla',
  Crenincichla: 'Crenicichla',
  Eichornia: 'Eichhornia',
  Herichthy: 'Herichthys',
  Notropsis: 'Notropis',
  Parospromenus: 'Parosphromenus',
  Trachelyopterichtys: 'Trachelyopterichthys',
  Vietorintalia: 'Vietorientalia',
};

/**
 * Where a species lives, derived from its binomial.
 *
 * Returns undefined for anything the tables cannot answer - an unmapped genus,
 * an unmapped family, or a family with no single honest answer. The catalog
 * shows "not recorded" for those rather than defaulting them into a bucket,
 * which would quietly make the filter lie.
 */
export function traitsFor(scientificName: string | undefined): (FamilyTraits & { family: string }) | undefined {
  if (!scientificName) return undefined;
  const genus = scientificName.split(' ')[0];
  if (!genus) return undefined;
  const family = GENUS_FAMILY[genus];
  if (!family) return undefined;
  const traits = FAMILY_TRAITS[family];
  return traits ? { ...traits, family } : undefined;
}
