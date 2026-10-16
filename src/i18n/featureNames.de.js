// -----------------------------------------------------------------------------
// German translations of the auto-generated feature names/labels this
// integration emits (see convertFeature.js). Same contract as
// featureNames.fr.js: keyed by the exact English string of the mappings, a
// string missing here is left untranslated (never a guess).
//
// test/tuya/featureNames.test.js fails if a name/label the mappings can
// produce has no entry here, if an entry is stale, or if two labels of the
// same option list translate to the same string.
// -----------------------------------------------------------------------------

export const FEATURE_NAMES_DE = {
  // --- Generic switches/lights/covers (global.js, smartSocket.js) ----------
  LED: 'LED',
  Switch: 'Schalter',
  'On/off': 'Ein/Aus',
  Brightness: 'Helligkeit',
  'Color temperature': 'Farbtemperatur',
  Color: 'Farbe',
  'Switch 1': 'Schalter 1',
  'Switch 2': 'Schalter 2',
  'Switch 3': 'Schalter 3',
  'Switch 4': 'Schalter 4',
  Control: 'Steuerung',
  Position: 'Position',
  'Total energy': 'Gesamtenergie',
  Current: 'Stromstärke',
  'Active power': 'Wirkleistung',
  Voltage: 'Spannung',
  'Child lock': 'Kindersicherung',

  // --- Camera / video doorbell (camera.js, videoDoorbell.js) ---------------
  'Privacy mode': 'Privatsphäre-Modus',
  'Motion detection': 'Bewegungserkennung',
  Siren: 'Sirene',
  'Motion tracking': 'Bewegungsverfolgung',
  'Human detection filter': 'Personenerkennung',
  Recording: 'Aufnahme',
  'Image flip': 'Bild spiegeln',
  Motion: 'Bewegung',
  Doorbell: 'Türklingel',
  Snapshot: 'Schnappschuss',
  'Status LED': 'Status-LED',
  'On-screen display': 'Bildschirmeinblendung',
  Ring: 'Klingeln',

  // --- Pet feeder (petFeeder.js) --------------------------------------------
  Feed: 'Füttern',
  'Last amount fed': 'Zuletzt ausgegebene Menge',
  'Slow feed': 'Langsames Füttern',
  Light: 'Licht',
  Battery: 'Batterie',
  'Battery voltage': 'Batteriespannung',
  'Battery low': 'Batterie schwach',
  'Scheduled meals': 'Geplante Mahlzeiten',

  // --- Pilot-wire thermostat (pilotThermostat.js) ---------------------------
  Mode: 'Modus',
  'Current mode': 'Aktueller Modus',
  'Window state': 'Fensterzustand',
  Program: 'Programm',
  'Holiday mode': 'Urlaubsmodus',

  // --- Smart meter (smartMeter.js) ------------------------------------------
  'Power A': 'Leistung A',
  'Power B': 'Leistung B',
  'Total power': 'Gesamtleistung',
  'Voltage A': 'Spannung A',
  'Current A': 'Stromstärke A',
  'Current B': 'Stromstärke B',
  'Forward energy A': 'Bezogene Energie A',
  'Forward energy B': 'Bezogene Energie B',
  'Forward energy total': 'Bezogene Energie gesamt',
  'Reverse energy A': 'Eingespeiste Energie A',
  'Reverse energy B': 'Eingespeiste Energie B',
  'Reverse energy total': 'Eingespeiste Energie gesamt',

  // --- Vacuum (vacuum.js) ----------------------------------------------------
  Dock: 'Zur Ladestation',
  State: 'Zustand',
  Pause: 'Pause',
  'Carpet boost': 'Teppich-Boost',
  'Custom mode': 'Benutzerdefinierter Modus',
  'Suction power': 'Saugleistung',
  'Water level': 'Wassermenge',
  'Dust collection': 'Absaugstation',
  'Y-mop wash': 'Y-Wischmuster',
  Cleaning: 'Reinigung',
  'Main brush': 'Hauptbürste',
  'Side brush': 'Seitenbürste',
  // Vacuum TEXT/SELECT option labels (fan_mode / water_mode / dust_collection_num).
  Quiet: 'Leise',
  Standard: 'Standard',
  Strong: 'Stark',
  Max: 'Max',
  Low: 'Niedrig',
  Medium: 'Mittel',
  High: 'Hoch',
  Never: 'Nie',
  'After every clean': 'Nach jeder Reinigung',
  'After 2 cleans': 'Nach 2 Reinigungen',
  'After 3 cleans': 'Nach 3 Reinigungen',

  // --- Fan (fan.js) ----------------------------------------------------------
  Speed: 'Geschwindigkeit',
  'Airflow direction': 'Luftstromrichtung',
  'Horizontal swing': 'Horizontales Schwenken',
  'Vertical swing': 'Vertikales Schwenken',

  // --- Dehumidifier (dehumidifier.js) ---------------------------------------
  Humidity: 'Luftfeuchtigkeit',
  Temperature: 'Temperatur',
  'Fan speed': 'Lüfterstufe',
  Timer: 'Timer',
  'Timer remaining': 'Timer-Restzeit',
  'Target humidity': 'Zielfeuchtigkeit',
  Ionizer: 'Ionisator',
  Manual: 'Manuell',
  Sleep: 'Schlafmodus',

  // --- Camera settings and PTZ (camera.js) ---
  'Timestamp overlay': 'Zeitstempel im Bild',
  'Sound detection': 'Geräuscherkennung',
  'Night vision': 'Nachtsicht',
  'Motion sensitivity': 'Bewegungsempfindlichkeit',
  'Sound sensitivity': 'Geräuschempfindlichkeit',
  'Recording mode': 'Aufnahmemodus',
  'Anti-flicker': 'Flimmerschutz',
  On: 'Ein',
  Event: 'Bei Ereignis',
  Continuous: 'Kontinuierlich',
  '50 Hz': '50 Hz',
  '60 Hz': '60 Hz',
  'Pan / tilt': 'Schwenken / Neigen',
  'Pan left': 'Nach links schwenken',
  'Pan right': 'Nach rechts schwenken',
  'Tilt up': 'Nach oben neigen',
  'Tilt down': 'Nach unten neigen',
  // --- Water valve (waterValve.js) ---
  Valve: 'Ventil',
  'Valve open': 'Ventil offen',
  'Water flow': 'Wasserdurchfluss',
  'Manual watering duration': 'Dauer der manuellen Bewässerung',
  'Watering mode': 'Bewässerungsmodus',
  // --- Water purifier (waterPurifier.js) ------------------------------------
  'Inlet TDS': 'TDS Zulauf',
  'Outlet TDS': 'TDS Ablauf',
  'PP filter life': 'PP-Filter Lebensdauer',
  'CTO filter life': 'CTO-Filter Lebensdauer',
  'RO filter life': 'RO-Filter Lebensdauer',
  'PP filter days left': 'PP-Filter Resttage',
  'CTO filter days left': 'CTO-Filter Resttage',
  'RO filter days left': 'RO-Filter Resttage',
  Status: 'Betriebszustand',
  Purifying: 'Filtern',
  'Water intake': 'Wasserzulauf',
  Standby: 'Standby',
  Flushing: 'Spülen',
  Sterilizing: 'Sterilisieren',

  // --- Pilot-wire mode option labels (API fallback, see featureNames.fr.js) --
  Off: 'Aus',
  'Frost Protection': 'Frostschutz',
  Eco: 'Eco',
  'Comfort -1°C': 'Komfort -1°C',
  'Comfort -2°C': 'Komfort -2°C',
  Comfort: 'Komfort',
  Programming: 'Programmierung',
  Thermostat: 'Thermostat',

  // --- AC mode/fan-speed/swing option labels (API fallback) ----------------
  Auto: 'Auto',
  Cooling: 'Kühlen',
  Heating: 'Heizen',
  Drying: 'Entfeuchten',
  Fan: 'Lüften',
  'Low-mid': 'Niedrig-mittel',
  Mid: 'Mittel',
  'Mid-high': 'Mittel-hoch',
  Turbo: 'Turbo',
  Swing: 'Schwenken',
  'Swing (opposite)': 'Schwenken (gegenläufig)',
  'Position 1': 'Position 1',
  'Position 2': 'Position 2',
  'Position 3': 'Position 3',
  'Position 4': 'Position 4',
  'Position 5': 'Position 5',
};
