// -----------------------------------------------------------------------------
// Spanish translations of the auto-generated feature names/labels this
// integration emits (see convertFeature.js). Same contract as
// featureNames.fr.js: keyed by the exact English string of the mappings, a
// string missing here is left untranslated (never a guess).
//
// test/tuya/featureNames.test.js fails if a name/label the mappings can
// produce has no entry here, if an entry is stale, or if two labels of the
// same option list translate to the same string.
// -----------------------------------------------------------------------------

export const FEATURE_NAMES_ES = {
  // --- Generic switches/lights/covers (global.js, smartSocket.js) ----------
  LED: 'LED',
  Switch: 'Interruptor',
  'On/off': 'Encendido/Apagado',
  Brightness: 'Brillo',
  'Color temperature': 'Temperatura de color',
  Color: 'Color',
  'Switch 1': 'Interruptor 1',
  'Switch 2': 'Interruptor 2',
  'Switch 3': 'Interruptor 3',
  'Switch 4': 'Interruptor 4',
  Control: 'Control',
  Position: 'Posición',
  'Total energy': 'Energía total',
  Current: 'Corriente',
  'Active power': 'Potencia activa',
  Voltage: 'Tensión',
  'Child lock': 'Bloqueo infantil',

  // --- Camera / video doorbell (camera.js, videoDoorbell.js) ---------------
  'Privacy mode': 'Modo privacidad',
  'Motion detection': 'Detección de movimiento',
  Siren: 'Sirena',
  'Motion tracking': 'Seguimiento de movimiento',
  'Human detection filter': 'Filtro de detección de personas',
  Recording: 'Grabación',
  'Image flip': 'Voltear imagen',
  Motion: 'Movimiento',
  Doorbell: 'Timbre',
  Snapshot: 'Captura',
  'Status LED': 'LED de estado',
  'On-screen display': 'Información en pantalla',
  Ring: 'Llamada',

  // --- Pet feeder (petFeeder.js) --------------------------------------------
  Feed: 'Dispensar',
  'Last amount fed': 'Última ración dispensada',
  'Slow feed': 'Dispensado lento',
  Light: 'Luz',
  Battery: 'Batería',
  'Battery voltage': 'Tensión de la batería',
  'Battery low': 'Batería baja',
  'Scheduled meals': 'Comidas programadas',

  // --- Pilot-wire thermostat (pilotThermostat.js) ---------------------------
  Mode: 'Modo',
  'Current mode': 'Modo actual',
  'Window state': 'Estado de la ventana',
  Program: 'Programa',
  'Holiday mode': 'Modo vacaciones',

  // --- Smart meter (smartMeter.js) ------------------------------------------
  'Power A': 'Potencia A',
  'Power B': 'Potencia B',
  'Total power': 'Potencia total',
  'Voltage A': 'Tensión A',
  'Current A': 'Corriente A',
  'Current B': 'Corriente B',
  'Forward energy A': 'Energía importada A',
  'Forward energy B': 'Energía importada B',
  'Forward energy total': 'Energía importada total',
  'Reverse energy A': 'Energía exportada A',
  'Reverse energy B': 'Energía exportada B',
  'Reverse energy total': 'Energía exportada total',

  // --- Vacuum (vacuum.js) ----------------------------------------------------
  Dock: 'Volver a la base',
  State: 'Estado',
  Pause: 'Pausa',
  'Carpet boost': 'Turbo en alfombras',
  'Custom mode': 'Modo personalizado',
  'Suction power': 'Potencia de succión',
  'Water level': 'Nivel de agua',
  'Dust collection': 'Vaciado automático',
  'Y-mop wash': 'Fregado en Y',
  Cleaning: 'Limpieza',
  'Main brush': 'Cepillo principal',
  'Side brush': 'Cepillo lateral',
  // Vacuum TEXT/SELECT option labels (fan_mode / water_mode / dust_collection_num).
  Quiet: 'Silencioso',
  Standard: 'Estándar',
  Strong: 'Fuerte',
  Max: 'Máx.',
  Low: 'Bajo',
  Medium: 'Medio',
  High: 'Alto',
  Never: 'Nunca',
  'After every clean': 'Tras cada limpieza',
  'After 2 cleans': 'Tras 2 limpiezas',
  'After 3 cleans': 'Tras 3 limpiezas',

  // --- Fan (fan.js) ----------------------------------------------------------
  Speed: 'Velocidad',
  'Airflow direction': 'Dirección del flujo de aire',
  'Horizontal swing': 'Oscilación horizontal',
  'Vertical swing': 'Oscilación vertical',

  // --- Dehumidifier (dehumidifier.js) ---------------------------------------
  Humidity: 'Humedad',
  Temperature: 'Temperatura',
  'Fan speed': 'Velocidad del ventilador',
  Timer: 'Temporizador',
  'Timer remaining': 'Tiempo restante',
  'Target humidity': 'Humedad objetivo',
  Ionizer: 'Ionizador',
  Manual: 'Manual',
  Sleep: 'Modo noche',

  // --- Water valve (waterValve.js) ---
  Valve: 'Válvula',
  'Valve open': 'Válvula abierta',
  'Water flow': 'Caudal de agua',
  'Manual watering duration': 'Duración del riego manual',
  'Watering mode': 'Modo de riego',
  // --- Water purifier (waterPurifier.js) ------------------------------------
  'Inlet TDS': 'TDS de entrada',
  'Outlet TDS': 'TDS de salida',
  'PP filter life': 'Vida del filtro PP',
  'CTO filter life': 'Vida del filtro CTO',
  'RO filter life': 'Vida del filtro RO',
  'PP filter days left': 'Días restantes filtro PP',
  'CTO filter days left': 'Días restantes filtro CTO',
  'RO filter days left': 'Días restantes filtro RO',
  Status: 'Estado de funcionamiento',
  Purifying: 'Purificando',
  'Water intake': 'Entrada de agua',
  Standby: 'En espera',
  Flushing: 'Enjuague',
  Sterilizing: 'Esterilizando',

  // --- Pilot-wire mode option labels (API fallback, see featureNames.fr.js) --
  Off: 'Apagado',
  'Frost Protection': 'Antihielo',
  Eco: 'Eco',
  'Comfort -1°C': 'Confort -1°C',
  'Comfort -2°C': 'Confort -2°C',
  Comfort: 'Confort',
  Programming: 'Programación',
  Thermostat: 'Termostato',

  // --- AC mode/fan-speed/swing option labels (API fallback) ----------------
  Auto: 'Auto',
  Cooling: 'Refrigeración',
  Heating: 'Calefacción',
  Drying: 'Deshumidificación',
  Fan: 'Ventilación',
  'Low-mid': 'Medio-bajo',
  Mid: 'Medio',
  'Mid-high': 'Medio-alto',
  Turbo: 'Turbo',
  Swing: 'Oscilación',
  'Swing (opposite)': 'Oscilación (inversa)',
  'Position 1': 'Posición 1',
  'Position 2': 'Posición 2',
  'Position 3': 'Posición 3',
  'Position 4': 'Posición 4',
  'Position 5': 'Posición 5',
};
