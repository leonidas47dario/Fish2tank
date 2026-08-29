/**
 * Human corrections to the derived species dimension.
 *
 * WHY A SEPARATE FILE. The species dimension is derived from vendor listing
 * titles, and some titles simply do not contain the fish's name. No parser
 * recovers "Convict Cichlid" from six listings that all just say "Cichlid";
 * that takes somebody who knows the fish. This file is where that knowledge
 * lives.
 *
 * It is SOURCE, not build output, which is why it sits here and not under
 * marts/. build-marts.ts applies it after reading the warehouse, so a
 * correction survives every future refresh. That is the whole point: the
 * parser fix in etl/normalize/derive-species.ts stops the next batch of junk
 * being minted, and this file repairs what the parser cannot reach.
 *
 * THE RULES, enforced by catalog-quality.test.ts:
 *   - Every entry cites a source. An uncited correction is a guess wearing a
 *     lab coat, and this app does not guess (see README, "Three things this
 *     app refuses to do").
 *   - `commonName: null` means "no trustworthy common name exists" and the
 *     card falls back to the binomial. That is a real, honest outcome and is
 *     preferred over inventing a plausible-sounding name.
 *   - A proposed name must itself pass the quality rules.
 *
 * PROVENANCE. Compiled 2026-08-29 by a review pass over every species that
 * failed the quality gate. Wikipedia species articles are the preferred
 * source; where English Wikipedia has no article or gives no vernacular name,
 * the vendor's own listing title is cited instead and the entry is marked
 * `viaVendor` - a trade name is evidence of what the fish is SOLD as, which is
 * weaker than a taxonomic source and is labelled as such.
 *
 * FishBase and Wikidata are both unreachable from the network this was built
 * on, so neither could be consulted.
 */

export interface SpeciesOverride {
  /** Matches CatalogEntry.speciesId in the mart. */
  speciesId: string;
  /**
   * The corrected display name, or null when no trustworthy one exists and the
   * card should fall back to the scientific name.
   */
  commonName: string | null;
  /** Where the name came from. Required — see the rules above. */
  source: string;
  /**
   * True when the only source is a vendor listing rather than a taxonomic
   * reference. Kept explicit so "how do we know this?" stays answerable.
   */
  viaVendor?: boolean;
  /** Anything a reviewer needs to know, especially about what was NOT decided. */
  note?: string;
}

const WIKI = 'https://en.wikipedia.org/wiki/';

export const SPECIES_OVERRIDES: SpeciesOverride[] = [
  { speciesId: 'sp_acarichthys_heckelii', commonName: 'Threadfin Acara', source: `${WIKI}Acarichthys_heckelii` },
  { speciesId: 'sp_amatitlania_nigrofasciata', commonName: 'Convict Cichlid', source: `${WIKI}Amatitlania_nigrofasciata`, note: 'Two vendor titles are parrot-cichlid hybrids, not pure A. nigrofasciata.' },
  { speciesId: 'sp_ambystoma_mexicanum', commonName: 'Axolotl', source: `${WIKI}Ambystoma_mexicanum` },
  { speciesId: 'sp_apistogramma_macmasteri', commonName: 'Red Shoulder Dwarf Cichlid', source: 'Vendor title: "Red Shoulder Dwarf Cichlid (Apistogramma macmasteri), Tank-Bred"', viaVendor: true, note: 'English Wikipedia gives no vernacular name for this species.' },
  { speciesId: 'sp_asterophysus_batrachus', commonName: 'Gulper Catfish', source: `${WIKI}Asterophysus_batrachus` },
  { speciesId: 'sp_astronotus_ocellatus', commonName: 'Oscar', source: `${WIKI}Astronotus_ocellatus`, note: 'All vendor titles are colour strains (Albino Lemon, Red Ruby, Tiger) of the one species.' },
  { speciesId: 'sp_auriglobus_modestus', commonName: 'Golden Puffer', source: `${WIKI}Auriglobus_modestus`, note: 'Vendors sell it as "Avocado Puffer".' },
  { speciesId: 'sp_baryancistrus_xanthellus', commonName: 'Gold Nugget Pleco', source: `${WIKI}Baryancistrus_xanthellus`, note: 'Wikipedia confirms L018/L081/L085/L177 are all this one species, so the L-numbered listings are not distinct fish.' },
  { speciesId: 'sp_boraras_brigittae', commonName: 'Chili Rasbora', source: `${WIKI}Boraras_brigittae` },
  { speciesId: 'sp_boraras_maculatus', commonName: 'Dwarf Rasbora', source: `${WIKI}Boraras_maculatus` },
  { speciesId: 'sp_cambarellus_patzcuarensis', commonName: 'Mexican Dwarf Crayfish', source: `${WIKI}Cambarellus_patzcuarensis` },
  { speciesId: 'sp_cherax_alyciae', commonName: 'Blue Kong Crayfish', source: 'Vendor title: "Blue Kong Zebra Crayfish (Cherax alyciae)"', viaVendor: true, note: 'No English Wikipedia article. "Zebra" dropped - it belongs to the related C. peknyi.' },
  // Wikipedia deliberately gives no species name here, only four mutually
  // contradictory commercial strain names. Picking one would mislabel the rest.
  { speciesId: 'sp_cherax_boesemani', commonName: null, source: `${WIKI}Cherax_boesemani`, note: 'Article lists only strain names (Blue Moon, Supernova, Papuan Red, Tricolor); the four vendor titles disagree with each other. No species-level common name exists.' },
  { speciesId: 'sp_cherax_snowden', commonName: 'Orange Tip Crayfish', source: `${WIKI}Cherax_snowden`, note: 'Two of three vendor titles are other trade morphs that may not be this species.' },
  { speciesId: 'sp_corydoras_adolfoi', commonName: "Adolfo's Catfish", source: `${WIKI}Corydoras_adolfoi`, note: 'Taxonomy has moved to Hoplisoma adolfoi; the catalog binomial is the older, still-current trade name.' },
  { speciesId: 'sp_corydoras_paleatus', commonName: 'Peppered Catfish', source: `${WIKI}Corydoras_paleatus`, note: 'Taxonomy has moved to Hoplisoma paleatum.' },
  { speciesId: 'sp_corydoras_schultzei', commonName: 'Black Venezuela Corydoras', source: 'Vendor titles, both agreeing on "Black Venezuela"', viaVendor: true, note: 'Wikipedia treats Corydoras schultzei as a synonym of C. aeneus. See SPECIES_SYNONYMS.' },
  { speciesId: 'sp_corydoras_trilineatus', commonName: 'Threestripe Corydoras', source: `${WIKI}Corydoras_trilineatus`, note: 'Also sold as false julii cory. Taxonomy has moved to Hoplisoma trilineatum.' },
  { speciesId: 'sp_cyprinus_rubrofuscus', commonName: 'Koi', source: `${WIKI}Koi`, note: 'The species article titles this Amur carp; every ornamental koi descends from it and the only vendor title sells it as koi.' },
  { speciesId: 'sp_danio_rerio', commonName: 'Zebra Danio', source: `${WIKI}Danio_rerio`, note: 'Wikipedia titles it "zebrafish"; "Zebra Danio" is the aquarium-trade name and the one every vendor uses.' },
  { speciesId: 'sp_dormitator_maculatus', commonName: 'Fat Sleeper', source: `${WIKI}Dormitator_maculatus` },
  { speciesId: 'sp_eleocharis_vivipara', commonName: 'Umbrella Hairgrass', source: `${WIKI}Eleocharis_vivipara` },
  { speciesId: 'sp_geophagus_sveni', commonName: 'Sveni Eartheater', source: 'Vendor title: "Sveni Eartheater"', viaVendor: true, note: 'Wikipedia article exists but lists no common name.' },
  { speciesId: 'sp_guianacara_owroewefi', commonName: 'Blue Bandit Cichlid', source: 'Vendor titles: "Blue Bandit Cichlid" / "Blue Guianacara Cichlid"', viaVendor: true, note: 'No English Wikipedia species article.' },
  { speciesId: 'sp_gymnocorymbus_ternetzi', commonName: 'Black Skirt Tetra', source: `${WIKI}Gymnocorymbus_ternetzi` },
  { speciesId: 'sp_gymnogeophagus_lipokarenos', commonName: 'Rainbow Humphead Cichlid', source: 'Vendor titles, both agreeing', viaVendor: true, note: 'No English Wikipedia species article.' },
  { speciesId: 'sp_haludaria_fasciata', commonName: 'Melon Barb', source: `${WIKI}Haludaria_fasciata` },
  { speciesId: 'sp_hasemania_nana', commonName: 'Silvertip Tetra', source: `${WIKI}Hasemania_nana` },
  { speciesId: 'sp_hoplosternum_littorale', commonName: 'Brown Hoplo Catfish', source: 'Vendor titles, both agreeing on "Hoplo"', viaVendor: true, note: 'Wikipedia gives only regional vernaculars (tamata, hassa, kwi kwi), no English trade name.' },
  { speciesId: 'sp_hypselecara_temporalis', commonName: 'Emerald Cichlid', source: `${WIKI}Hypselecara_temporalis`, note: 'Trade overwhelmingly says "Chocolate Cichlid", which Wikipedia does not mention.' },
  { speciesId: 'sp_iriatherina_werneri', commonName: 'Threadfin Rainbowfish', source: `${WIKI}Iriatherina_werneri` },
  { speciesId: 'sp_leporacanthicus_galaxias', commonName: 'Galaxy Pleco', source: 'Vendor titles, both containing "Galaxy"', viaVendor: true, note: 'Wikipedia gives no species-level common name. The two titles cite conflicting L-numbers (L241 vs L007/L240).' },
  { speciesId: 'sp_mastacembelus_armatus', commonName: 'Tire Track Eel', source: `${WIKI}Mastacembelus_armatus`, note: "Wikipedia's lead name is zig-zag eel; tire-track is the listed alternate and what the trade uses." },
  { speciesId: 'sp_megalechis_thoracata', commonName: 'Spotted Hoplo Catfish', source: `${WIKI}Megalechis_thoracata` },
  { speciesId: 'sp_melanotaenia_parva', commonName: 'Lake Kurumoi Rainbowfish', source: `${WIKI}Melanotaenia_parva` },
  { speciesId: 'sp_melanotaenia_praecox', commonName: 'Dwarf Neon Rainbowfish', source: `${WIKI}Melanotaenia_praecox` },
  { speciesId: 'sp_melanotaenia_splendida', commonName: 'Eastern Rainbowfish', source: `${WIKI}Melanotaenia_splendida`, note: 'Its one vendor listing is from the Upper Katherine River, which is inornata range - may belong to the subspecies record instead.' },
  { speciesId: 'sp_melanotaenia_splendida_inornata', commonName: 'Checkered Rainbowfish', source: `${WIKI}Melanotaenia_splendida`, note: 'Subspecies list gives "M. s. inornata - chequered rainbowfish"; US spelling used to match the rest of the catalog.' },
  { speciesId: 'sp_melanotaenia_trifasciata', commonName: 'Banded Rainbowfish', source: `${WIKI}Melanotaenia_trifasciata` },
  { speciesId: 'sp_microdevario_kubotai', commonName: 'Kubotai Rasbora', source: `${WIKI}Microdevario_kubotai` },
  { speciesId: 'sp_microsorum_pteropus', commonName: 'Java Fern', source: `${WIKI}Microsorum_pteropus`, note: 'Accepted name is now Leptochilus pteropus.' },
  { speciesId: 'sp_mikrogeophagus_ramirezi', commonName: 'Ram Cichlid', source: `${WIKI}Mikrogeophagus_ramirezi` },
  { speciesId: 'sp_moenkhausia_costae', commonName: 'Blackline Tail Tetra', source: 'Vendor title: "Blackline Tail Tetra (Moenkhausia costae)"', viaVendor: true, note: 'No English Wikipedia article.' },
  { speciesId: 'sp_nandopsis_haitiensis', commonName: 'Haitian Cichlid', source: 'Vendor title: "Haitian Cichlid (Nandopsis haitiensis)"', viaVendor: true, note: 'No English Wikipedia species article; the genus page confirms the binomial. Trade also says "Black Nasty".' },
  { speciesId: 'sp_nematobrycon_palmeri', commonName: 'Emperor Tetra', source: `${WIKI}Nematobrycon_palmeri` },
  { speciesId: 'sp_neocaridina_davidi', commonName: 'Cherry Shrimp', source: `${WIKI}Neocaridina_davidi`, note: 'Two vendor titles are mixed-strain "Combo Box" lots rather than single-species listings.' },
  { speciesId: 'sp_neolamprologus_brichardi', commonName: 'Princess Cichlid', source: `${WIKI}Neolamprologus_brichardi` },
  { speciesId: 'sp_notropis_chrosomus', commonName: 'Rainbow Shiner', source: `${WIKI}Notropis_chrosomus`, note: 'Taxonomy has moved to Hydrophlox chrosomus.' },
  { speciesId: 'sp_oryzias_woworae', commonName: "Daisy's Blue Ricefish", source: 'Vendor title: "Daisy\'s Blue Ricefish (Oryzias woworae), Tank-Bred"', viaVendor: true, note: 'No English Wikipedia article; binomial is valid (Parenti & Hadiaty, 2010).' },
  { speciesId: 'sp_osphronemus_septemfasciatus', commonName: 'Borneo Giant Gourami', source: 'Vendor title: "Borneo Giant Gourami (Osphronemus septemfasciatus)"', viaVendor: true, note: 'Two other titles use the standard trade names for O. laticlavius and may be misidentified.' },
  { speciesId: 'sp_oxyeleotris_marmorata', commonName: 'Marble Goby', source: `${WIKI}Oxyeleotris_marmorata` },
  { speciesId: 'sp_panaqolus_albivermis', commonName: 'Flash Pleco', source: `${WIKI}Panaqolus_albivermis`, note: 'L-204 in the trade; the L-number is barred by the no-digits rule.' },
  { speciesId: 'sp_panaque_nigrolineatus_laurafabianae', commonName: 'Watermelon Pleco', source: `${WIKI}Panaque_nigrolineatus` },
  { speciesId: 'sp_paracheirodon_axelrodi', commonName: 'Cardinal Tetra', source: `${WIKI}Paracheirodon_axelrodi` },
  { speciesId: 'sp_peckoltia_compta', commonName: 'Leopard Frog Pleco', source: `${WIKI}Peckoltia_compta` },
  { speciesId: 'sp_pelvicachromis_pulcher', commonName: 'Kribensis', source: `${WIKI}Pelvicachromis_pulcher` },
  { speciesId: 'sp_phractocephalus_hemioliopterus', commonName: 'Redtail Catfish', source: `${WIKI}Phractocephalus_hemioliopterus`, note: 'Two vendor titles are explicit RTC hybrids, not the pure species.' },
  { speciesId: 'sp_phyllanthus_fluitans', commonName: 'Red Root Floater', source: `${WIKI}Phyllanthus_fluitans` },
  { speciesId: 'sp_pistia_stratiotes', commonName: 'Water Lettuce', source: `${WIKI}Pistia` },
  { speciesId: 'sp_planorbarius_corneus', commonName: 'Great Ramshorn Snail', source: `${WIKI}Planorbarius_corneus`, note: 'Vendor sells "Assorted Ramshorn Snails", which in the hobby are usually Planorbella duryi - the binomial may be misapplied.' },
  { speciesId: 'sp_poecilia_latipinna', commonName: 'Sailfin Molly', source: `${WIKI}Poecilia_latipinna`, note: 'Most trade black/dalmatian mollies are P. latipinna x P. sphenops hybrids, so the binomial is approximate.' },
  { speciesId: 'sp_poecilocharax_weitzmani', commonName: 'Black Darter Tetra', source: `${WIKI}Poecilocharax_weitzmani` },
  { speciesId: 'sp_potamotrygon_albimaculata', commonName: 'Itaituba River Stingray', source: `${WIKI}Potamotrygon`, note: 'Genus species-list entry; no standalone article. One vendor title is an explicit hybrid.' },
  { speciesId: 'sp_potamotrygon_jabuti', commonName: 'Pearl River Stingray', source: `${WIKI}Potamotrygon`, note: 'Genus species-list entry; no standalone article. One vendor title is an explicit hybrid.' },
  { speciesId: 'sp_potamotrygon_leopoldi', commonName: 'Black Diamond Stingray', source: `${WIKI}Potamotrygon_leopoldi`, note: 'Wikipedia leads with "white-blotched river stingray"; all six vendor titles say Black Diamond, which is the universal trade name.' },
  { speciesId: 'sp_potamotrygon_motoro', commonName: 'Ocellate River Stingray', source: `${WIKI}Potamotrygon_motoro` },
  { speciesId: 'sp_procambarus_alleni', commonName: 'Electric Blue Crayfish', source: `${WIKI}Procambarus_alleni`, note: 'Wikipedia leads with "Everglades crayfish"; the aquarium strain is universally sold as electric blue.' },
  { speciesId: 'sp_procambarus_clarkii', commonName: 'Red Swamp Crayfish', source: `${WIKI}Procambarus_clarkii` },
  { speciesId: 'sp_pseudomugil_luminatus', commonName: 'Red Neon Blue-Eye', source: `${WIKI}Pseudomugil_luminatus` },
  { speciesId: 'sp_pseudoplatystoma_corruscans', commonName: 'Spotted Sorubim', source: `${WIKI}Pseudoplatystoma_corruscans`, note: 'Two of three vendor titles are explicit hybrid crosses.' },
  { speciesId: 'sp_pterophyllum_scalare', commonName: 'Freshwater Angelfish', source: `${WIKI}Pterophyllum_scalare`, note: 'Bare "Angelfish" collides with the marine Pomacanthidae and would itself be ambiguous.' },
  { speciesId: 'sp_pterygoplichthys_gibbiceps', commonName: 'Leopard Sailfin Catfish', source: `${WIKI}Pterygoplichthys_gibbiceps` },
  { speciesId: 'sp_riccia_fluitans', commonName: 'Floating Crystalwort', source: `${WIKI}Riccia_fluitans` },
  { speciesId: 'sp_salvinia_minima', commonName: 'Water Spangles', source: `${WIKI}Salvinia_minima` },
  { speciesId: 'sp_sicyopus_rubicundus', commonName: 'Red Lipstick Goby', source: 'Vendor titles, both agreeing', viaVendor: true, note: 'No English Wikipedia species article. Congener S. jonklaasi is the plain "lipstick goby".' },
  { speciesId: 'sp_stenomelania_acutospira', commonName: 'Tiger Spike Chopstick Snail', source: 'Vendor titles, both agreeing', viaVendor: true, note: 'No English Wikipedia species article; "chopstick snail" is applied loosely across the genus.' },
  { speciesId: 'sp_stiphodon_annieae', commonName: "Annie's Dwarf Goby", source: 'Vendor titles, all three agreeing', viaVendor: true, note: 'Wikipedia article exists but assigns no common name.' },
  { speciesId: 'sp_stiphodon_atropurpureus', commonName: 'Blue Neon Dwarf Goby', source: `${WIKI}Stiphodon_atropurpureus` },
  { speciesId: 'sp_symphysodon_aequifasciatus', commonName: 'Blue Discus', source: `${WIKI}Symphysodon_aequifasciatus`, note: 'Canonical record. Two misspelled duplicates exist - see SPECIES_SYNONYMS.' },
  { speciesId: 'sp_synodontis_decorus', commonName: 'Clown Squeaker Catfish', source: `${WIKI}Synodontis_decorus`, note: 'One vendor title is a decorus x angelicus hybrid.' },
  { speciesId: 'sp_synodontis_eupterus', commonName: 'Featherfin Squeaker', source: `${WIKI}Synodontis_eupterus` },
  { speciesId: 'sp_synodontis_nigriventris', commonName: 'Blotched Upside-Down Catfish', source: `${WIKI}Synodontis_nigriventris` },
  { speciesId: 'sp_synodontis_nigrita', commonName: 'False Upside-Down Catfish', source: `${WIKI}Synodontis_nigrita` },
  { speciesId: 'sp_synodontis_petricola', commonName: 'Pygmy Leopard Catfish', source: `${WIKI}Synodontis_petricola`, note: 'Vendors call it "cuckoo", a name that properly belongs to S. multipunctatus.' },
  { speciesId: 'sp_tanichthys_albonubes', commonName: 'White Cloud Mountain Minnow', source: `${WIKI}Tanichthys_albonubes` },
  { speciesId: 'sp_taxiphyllum_alternans', commonName: 'Taiwan Triangle Moss', source: 'Vendor titles, both agreeing', viaVendor: true, note: 'No English Wikipedia article. Aquarium moss identification is unreliable; treat the binomial as low confidence.' },
  { speciesId: 'sp_trichogaster_labiosa', commonName: 'Thick-Lipped Gourami', source: `${WIKI}Trichogaster_labiosa` },
  { speciesId: 'sp_trichogaster_lalius', commonName: 'Dwarf Gourami', source: `${WIKI}Trichogaster_lalius` },
  { speciesId: 'sp_trichopodus_trichopterus', commonName: 'Three Spot Gourami', source: `${WIKI}Trichopodus_trichopterus` },
  { speciesId: 'sp_tylomelania_gemmifera', commonName: 'Orange Giant Sulawesi Rabbit Snail', source: 'Vendor titles, both agreeing', viaVendor: true, note: 'Wikipedia article gives no common name. Bare "rabbit snail" is genus-wide.' },
  { speciesId: 'sp_vallisneria_spiralis', commonName: 'Straight Vallisneria', source: `${WIKI}Vallisneria_spiralis` },
  { speciesId: 'sp_xiphophorus_hellerii', commonName: 'Green Swordtail', source: `${WIKI}Xiphophorus_hellerii`, note: 'Canonical record; the single-i spelling is an orthographic error - see SPECIES_SYNONYMS.' },
  { speciesId: 'sp_xiphophorus_maculatus', commonName: 'Southern Platyfish', source: `${WIKI}Xiphophorus_maculatus` },
  { speciesId: 'sp_zungaro_zungaro', commonName: 'Jau Catfish', source: `${WIKI}Zungaro_zungaro`, note: 'One vendor title is an explicit hybrid.' },

  // ── Added 2026-08-29, second refresh ──────────────────────────────────
  //
  // The vendor pull that added PetSmart and Petco also re-read every existing
  // vendor, and their catalogues had grown: dim_species went from 1,076 to
  // 2,153. Twenty-eight of the new species derived down to a bare family word
  // - six different fish called "Cichlid", three called "Gourami" - which the
  // ambiguous-generic rule caught and the build gate refused to ship.
  //
  // Each was resolved by looking the binomial up. Where English Wikipedia has
  // a species article that states a vernacular name, that is the source; where
  // it has none, the vendor's own title is cited and the entry is marked
  // viaVendor; where the only names on offer are contradictory colour strains,
  // the entry is null and the card shows the binomial.
  { speciesId: 'sp_puntius_tetrazona', commonName: 'Tiger Barb', source: `${WIKI}Tiger_barb`, note: 'Puntius tetrazona redirects to Tiger barb; the accepted genus is now Puntigrus.' },
  { speciesId: 'sp_puntius_sachsii', commonName: 'Gold Barb', source: `${WIKI}Gold_barb`, note: 'P. sachsii is a synonym of Barbodes semifasciolatus; the article names the captive gold form the gold barb.' },
  { speciesId: 'sp_synodontis_brichardi', commonName: "Brichard's Synodontis", source: `${WIKI}Synodontis_brichardi` },
  { speciesId: 'sp_corydoras_julii', commonName: 'Julii Cory', source: `${WIKI}Hoplisoma_julii`, note: 'Article states "the julii cory or leopard catfish"; the genus has moved to Hoplisoma.' },
  { speciesId: 'sp_apistogramma_cacatuoides', commonName: 'Cockatoo Dwarf Cichlid', source: `${WIKI}Apistogramma_cacatuoides` },
  { speciesId: 'sp_cryptoheros_cutteri', commonName: "Cutter's Cichlid", source: 'Vendor title: "Cutter\u2019s Cichlid" / "Blue Eye Cichlid (Cryptoheros cutteri)" - Aquatic Arts', viaVendor: true, note: 'English Wikipedia has no article for this species, only the genus Cryptoheros.' },
  { speciesId: 'sp_copadichromis_borleyi', commonName: 'Redfin Hap', source: `${WIKI}Copadichromis_borleyi`, note: 'Article: "numerous common names, including redfin and goldfin hap". Vendors sell it as Kadango / Red Fin Borleyi.' },
  { speciesId: 'sp_hypsophrys_nicaraguensis', commonName: 'Nicaragua Cichlid', source: 'Vendor title: "Nicaragua Cichlid (Hypsophrys nicaraguensis)" - Aquatic Arts', viaVendor: true, note: 'English Wikipedia has no species article; the genus page attributes "Nicaragua cichlid" to H. unimaculatus, so the taxonomic source is not clean enough to cite for this binomial.' },
  { speciesId: 'sp_neolamprologus_leleupi', commonName: 'Lemon Cichlid', source: `${WIKI}Neolamprologus_leleupi` },
  { speciesId: 'sp_apistogramma_agassizi', commonName: "Agassiz's Dwarf Cichlid", source: `${WIKI}Apistogramma_agassizii`, note: 'The vendor titles spell the epithet agassizi; the accepted spelling is agassizii, after Louis Agassiz.' },
  { speciesId: 'sp_sicyopterus_lagocephalus', commonName: 'Red-Tailed Goby', source: `${WIKI}Sicyopterus_lagocephalus` },
  { speciesId: 'sp_sicyopus_zosterophorus', commonName: 'Red Belted Goby', source: 'Vendor title: "Red Belted Goby (Sicyopus zosterophorus)" - Aquatic Arts', viaVendor: true, note: 'The Wikipedia article gives no vernacular name at all.' },
  { speciesId: 'sp_trichogaster_trichopterus', commonName: 'Three Spot Gourami', source: `${WIKI}Three_spot_gourami`, note: 'Blue, gold and opaline gourami are colour forms of this one species, which is why three vendor names collapsed onto it.' },
  { speciesId: 'sp_trichopsis_pumila', commonName: 'Pygmy Gourami', source: `${WIKI}Pygmy_gourami`, note: 'Article: "also known as the sparkling gourami".' },
  { speciesId: 'sp_trichogaster_chuna', commonName: 'Honey Gourami', source: `${WIKI}Honey_gourami` },
  { speciesId: 'sp_nothobranchius_guentheri', commonName: 'Redtail Notho', source: `${WIKI}Redtail_notho` },
  { speciesId: 'sp_simpsonichthys_magnificus', commonName: 'Magnificent Killifish', source: 'Vendor title: "Magnificent Killifish (Simpsonichthys magnificus)" - Aquatic Arts', viaVendor: true, note: 'Now Hypsolebias magnificus; that article gives no vernacular name.' },
  { speciesId: 'sp_botia_kubotai', commonName: 'Burmese Border Loach', source: `${WIKI}Burmese_border_loach`, note: 'Article: "Burmese Border loach, angelicus loach or polka dot loach".' },
  { speciesId: 'sp_myxocyprinus_asiaticus', commonName: 'Chinese High-Fin Banded Shark', source: 'Vendor title: "Chinese Hi Fin Banded Shark (Myxocyprinus asiaticus)" - Aquatic Arts', viaVendor: true, note: 'Wikipedia covers this fish only on the genus page Myxocyprinus, which gives no vernacular name. It is a sucker, not a shark, and not a loach either - the vendor titles calling it a loach are what derived the generic name.' },
  { speciesId: 'sp_botia_striata', commonName: 'Zebra Loach', source: `${WIKI}Zebra_loach` },
  { speciesId: 'sp_neocaridina_denticulata', commonName: null, source: `${WIKI}Neocaridina`, note: 'No species-level common name. The only names the vendors give are contradictory colour strains - Pumpkin, Carbon Rili, Blue Jelly - so the card shows the binomial, as for Cherax boesemani.' },
  { speciesId: 'sp_caridina_serrata', commonName: null, source: `${WIKI}Caridina`, note: 'Same as above: Tangerine Tiger and Blue Panda are strain names, not a species name, and English Wikipedia has no article for the species.' },
  { speciesId: 'sp_neocaridina_heteropoda', commonName: 'Cherry Shrimp', source: `${WIKI}Neocaridina_davidi`, note: 'N. heteropoda is a synonym of N. davidi, which the article names the cherry shrimp. Blackberry Bee and Black Rili are colour strains of it.' },
  { speciesId: 'sp_faunus_ater', commonName: 'Black Devil Spike Snail', source: 'Vendor title: "Black Devil Spike Snail (Faunus ater)" - Aquatic Arts', viaVendor: true, note: 'The Wikipedia article gives no vernacular name.' },
  { speciesId: 'sp_neritina_variegata', commonName: 'Batik Nerite Snail', source: 'Vendor title: "Batik Nerite Snail (Neritina variegata)" - Aquatic Arts', viaVendor: true, note: 'English Wikipedia has no article for the species, only the genus Neritina.' },
  { speciesId: 'sp_hyphessobrycon_columbianus', commonName: 'Colombian Tetra', source: `${WIKI}Hyphessobrycon_columbianus`, note: 'Article: "the Colombian tetra or blue-red Colombian tetra".' },
  { speciesId: 'sp_brycinus_longipinnis', commonName: 'Longfin Tetra', source: `${WIKI}Bryconalestes_longipinnis`, note: 'Now Bryconalestes longipinnis; article states "the longfin tetra, African long-finned tetra or longfin characin".' },
  { speciesId: 'sp_pristella_maxillaris', commonName: 'X-Ray Tetra', source: `${WIKI}Pristella_maxillaris` },
];

/**
 * Species the vendors minted twice by misspelling the binomial.
 *
 * These are not synonyms in the taxonomic sense - they are typos and stale
 * orthography that the derivation faithfully turned into separate species,
 * so the catalog shows the same fish two or three times over.
 *
 * WHAT HAPPENS TO THEM. build-marts.ts drops the non-canonical record from the
 * catalog. It does NOT pool their price listings into the canonical one:
 * market-index.json is built by a separate stage that needs a full vendor
 * re-scrape, so those listings stay attached to an id the catalog no longer
 * shows until the next `npm run refresh`. That is a known, bounded loss - a
 * handful of listings on three fish - and it is recorded here rather than
 * being quietly papered over.
 */
export interface SpeciesSynonym {
  /** The id to drop. */
  speciesId: string;
  /** The id it is the same fish as. */
  canonicalId: string;
  reason: string;
  source: string;
}

export const SPECIES_SYNONYMS: SpeciesSynonym[] = [
  {
    speciesId: 'sp_symphysodon_aequifaciatus',
    canonicalId: 'sp_symphysodon_aequifasciatus',
    reason: 'Vendor typo: "aequifaciatus" is missing the s in -fasciatus.',
    source: `${WIKI}Symphysodon_aequifasciatus`,
  },
  {
    speciesId: 'sp_symphysodon_aequifasciata',
    canonicalId: 'sp_symphysodon_aequifasciatus',
    reason: 'Old feminine form, listed by Wikipedia only as a synonym.',
    source: `${WIKI}Symphysodon_aequifasciatus`,
  },
  {
    speciesId: 'sp_xiphophorus_helleri',
    canonicalId: 'sp_xiphophorus_hellerii',
    reason: 'Orthographic error. Wikipedia states the accepted epithet is hellerii, for Karl Bartholomaeus Heller. The one-i form is widespread in the trade.',
    source: `${WIKI}Xiphophorus_hellerii`,
  },
  {
    speciesId: 'sp_xiphophorus_helleri_hybrid',
    canonicalId: 'sp_xiphophorus_hellerii',
    reason: 'Not a taxon at all - a hybrid/strain grouping the parser minted from "Xiphophorus helleri hybrid" in a title.',
    source: `${WIKI}Xiphophorus_hellerii`,
  },
];

/** Fast lookup for build-marts.ts. */
export const OVERRIDE_BY_ID: ReadonlyMap<string, SpeciesOverride> = new Map(
  SPECIES_OVERRIDES.map((o) => [o.speciesId, o]),
);

/** Ids that must not appear in the shipped catalog. */
export const SYNONYM_IDS: ReadonlySet<string> = new Set(
  SPECIES_SYNONYMS.map((s) => s.speciesId),
);
