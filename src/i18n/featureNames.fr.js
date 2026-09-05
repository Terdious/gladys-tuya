// -----------------------------------------------------------------------------
// French translations of the auto-generated feature names/labels this
// integration emits (see convertFeature.js). Keyed by the exact English
// string every device-type mapping (src/devices/*.js) and the AC/pilot-wire
// enum label tables (tuya.deviceMapping.js) use — a string missing here is
// simply left untranslated (never a guess), which is also what happens for
// every string this dictionary does not yet know about.
//
// Closed and flat on purpose: the `feature_names` config option (`en`/`fr`,
// default `en`) only ever looks up `feature.name` and
// `supported_options[].label` as-produced, never the raw Tuya code. A code
// used as a fallback name (no curated `name` in the mapping) is never a key
// here, so it always passes through untouched, in either language.
//
// test/tuya/featureNames.test.js enumerates every name/label this repo's
// mappings can currently produce and fails if one has no entry here — run it
// after adding a new device type or a new curated name/label.
// -----------------------------------------------------------------------------

export const FEATURE_NAMES_FR = {
  // --- Generic switches/lights/covers (global.js, smartSocket.js) ----------
  LED: 'LED',
  Switch: 'Interrupteur',
  'On/off': 'Marche/Arrêt',
  Brightness: 'Luminosité',
  'Color temperature': 'Température de couleur',
  Color: 'Couleur',
  'Switch 1': 'Interrupteur 1',
  'Switch 2': 'Interrupteur 2',
  'Switch 3': 'Interrupteur 3',
  'Switch 4': 'Interrupteur 4',
  Control: 'Commande',
  Position: 'Position',
  'Total energy': 'Énergie totale',
  Current: 'Courant',
  'Active power': 'Puissance active',
  Voltage: 'Tension',
  'Child lock': 'Verrou enfant',

  // --- Camera / video doorbell (camera.js, videoDoorbell.js) ---------------
  'Privacy mode': 'Mode privé',
  'Motion detection': 'Détection de mouvement',
  Siren: 'Sirène',
  'Motion tracking': 'Suivi de mouvement',
  'Human detection filter': 'Filtre de détection humaine',
  Recording: 'Enregistrement',
  'Image flip': 'Retournement d’image',
  Motion: 'Mouvement',
  Doorbell: 'Sonnette',
  Snapshot: 'Photo',
  'Status LED': 'LED d’état',
  'On-screen display': 'Affichage à l’écran',
  Ring: 'Sonnerie',

  // --- Pet feeder (petFeeder.js) --------------------------------------------
  Feed: 'Distribuer',
  'Last amount fed': 'Dernière quantité distribuée',
  'Slow feed': 'Distribution lente',
  Light: 'Lumière',
  Battery: 'Batterie',
  'Battery voltage': 'Tension de la batterie',
  'Battery low': 'Batterie faible',
  'Scheduled meals': 'Repas programmés',

  // --- Pilot-wire thermostat (pilotThermostat.js) ---------------------------
  Mode: 'Mode',
  'Current mode': 'Mode actuel',
  'Window state': 'État de la fenêtre',
  Program: 'Programme',
  'Holiday mode': 'Mode vacances',

  // --- Smart meter (smartMeter.js) ------------------------------------------
  'Power A': 'Puissance A',
  'Power B': 'Puissance B',
  'Total power': 'Puissance totale',
  'Voltage A': 'Tension A',
  'Current A': 'Courant A',
  'Current B': 'Courant B',
  'Forward energy A': 'Énergie importée A',
  'Forward energy B': 'Énergie importée B',
  'Forward energy total': 'Énergie importée totale',
  'Reverse energy A': 'Énergie exportée A',
  'Reverse energy B': 'Énergie exportée B',
  'Reverse energy total': 'Énergie exportée totale',

  // --- Vacuum (vacuum.js) ----------------------------------------------------
  Dock: 'Retour à la base',
  State: 'État',
  Pause: 'Pause',
  'Carpet boost': 'Boost tapis',
  'Custom mode': 'Mode personnalisé',
  'Suction power': 'Puissance d’aspiration',
  'Water level': 'Niveau d’eau',
  'Dust collection': 'Collecte des poussières',
  'Y-mop wash': 'Lavage en Y',
  Cleaning: 'Nettoyage',
  'Main brush': 'Brosse principale',
  'Side brush': 'Brosse latérale',
  // Vacuum TEXT/SELECT option labels (fan_mode / water_mode / dust_collection_num).
  Quiet: 'Silencieux',
  Standard: 'Standard',
  Strong: 'Fort',
  Max: 'Max',
  Low: 'Faible',
  Medium: 'Moyen',
  High: 'Fort',
  Never: 'Jamais',
  'After every clean': 'Après chaque nettoyage',
  'After 2 cleans': 'Après 2 nettoyages',
  'After 3 cleans': 'Après 3 nettoyages',

  // --- Pilot-wire mode option labels (API fallback: the frontend renders its
  // own localized label for this first-class type from the numeric value —
  // see the comment above PILOT_WIRE_MODE_LABELS in tuya.deviceMapping.js;
  // this translation only benefits a raw API/automation reading the JSON
  // payload directly) -------------------------------------------------------
  Off: 'Arrêt',
  'Frost Protection': 'Hors gel',
  Eco: 'Éco',
  'Comfort -1°C': 'Confort -1°C',
  'Comfort -2°C': 'Confort -2°C',
  Comfort: 'Confort',
  Programming: 'Programmation',
  Thermostat: 'Thermostat',

  // --- AC mode/fan-speed/swing option labels (same API-fallback caveat as
  // pilot-wire above — see AC_SUPPORTED_OPTION_SOURCES) ---------------------
  Auto: 'Auto',
  Cooling: 'Froid',
  Heating: 'Chaud',
  Drying: 'Déshumidification',
  Fan: 'Ventilation',
  'Low-mid': 'Faible-moyen',
  Mid: 'Moyen',
  'Mid-high': 'Moyen-fort',
  Turbo: 'Turbo',
  Swing: 'Oscillation',
  'Swing (opposite)': 'Oscillation (opposée)',
  'Position 1': 'Position 1',
  'Position 2': 'Position 2',
  'Position 3': 'Position 3',
  'Position 4': 'Position 4',
  'Position 5': 'Position 5',
};
