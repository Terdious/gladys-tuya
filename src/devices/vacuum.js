// -----------------------------------------------------------------------------
// Device type: VACUUM (robot vacuum cleaners).
//
// First product: Honiture Q6 Pro (Tuya LAN protocol 3.3, product id
// c4ueb7cxlgmfon1t). DPS wired into Gladys features so far:
//   - DOCK (DP 103, `charge_switch`): `robot.set_value(103, True)` physically
//     sent the robot back to base.
//   - STATE (DP 105, `robot_state`): full vocabulary confirmed, see
//     HONITURE_Q6_PRO_STATE_TUYA_ENUM below.
//   - BATTERY (DP 106, `battery`, integer percent).
//   - `pause_switch` (DP 102), `auto_boost` (DP 137, carpet-boost suction)
//     and `room_mode_switch` (DP 144, the app's "custom mode" toggle) as
//     plain SWITCH.BINARY features: each is confirmed to toggle with its
//     matching app action, but VACUUM_CLEANER has no dedicated feature type
//     for any of them (only STATE/RUN_MODE/CLEAN_MODE/DOCK exist), so a
//     generic switch — same category smart-socket.js already uses for its
//     switch_1..4 — is the closest fit without inventing a new category.
//     `pause_switch` is additionally confirmed WRITABLE from Gladys, both
//     ways, on the real robot: writing `true` physically paused an active
//     cycle; writing `false` from a fully idle robot (docked, no cycle
//     queued) started a new cleaning cycle. It doubles as the closest thing
//     to a "start" control this product has — see clean_switch below, which
//     was tried for that and confirmed NOT to work. Writing `true` while
//     idle had no visible effect (nothing to pause). A pause is not
//     necessarily sticky either: on this test the robot auto-returned to
//     its dock a few seconds into being paused — an autonomous decision by
//     the robot, not a Gladys/DP behavior — which is why `pause_switch`
//     read back to `false` again shortly after (robot_state moved to
//     "tocharge", not because the pause command itself failed or reverted).
//   - `fan_mode` (DP 109, suction power) and `water_mode` (DP 110, mop water
//     flow) as TEXT/SELECT features (core >= 4.86.0, PR #2869 upstream — see
//     TEXT_SELECT_MIN_CORE_VERSION in tuya.coreVersion.js; skipped outright
//     on an older core, see tuya.convertFeature.js). TEXT/SELECT was built
//     exactly for this: "a choice among string values the integration
//     discovers on the appliance itself [...], declared per-device through
//     supported_options" (core constants.js) — unlike VACUUM_CLEANER.CLEAN_MODE,
//     whose front-end dropdown hardcodes a FIXED 7-option list with no
//     per-device filtering, so our 4 confirmed suction levels (quiet/auto/
//     strong/max — only quiet/auto have a semantic CLEAN_MODE equivalent)
//     would have left 5 of 7 buttons erroring on click. TEXT/SELECT instead
//     publishes exactly and only the values this device supports, so the
//     Gladys value IS the raw Tuya string directly (no int enum to translate,
//     see writeValues/readValues[TEXT][SELECT] in tuya.deviceMapping.js).
//     Names/labels below are plain French strings (this integration has no
//     per-viewer translation for a feature's name or its supported_options —
//     both are a plain string fixed once at discovery — and no way to detect
//     the installing user's language either: a device-type integration is
//     scoped to its service/container, not to a Gladys user account, so
//     there is no "current user" to read a language from; see the
//     account-scoped `onWeatherGet` language param for the one place Gladys
//     does thread a language through, which does not apply here).
//   - `main_brush_time` (DP 120) as MAINTENANCE.LIFE_REMAINING (a generic
//     0-100 percent "remaining life" sensor — "One feature per component,
//     the feature name identifies the component" per core constants.js).
//     The cloud spec gives no range/unit for this DPS (empty `values`), so
//     the full-life reference (MAIN_BRUSH_FULL_LIFE_SECONDS below) is NOT
//     from Tuya — it is cross-checked against the Smart Life app's own
//     "Consommables et Entretien" screen: the app showed the main brush at
//     41% / 124h remaining while DP 120 read 632691s (~175.7h) elapsed;
//     124h / (1 - 0.41) = ~300h total, and 632691s is itself ~58.6% of
//     300h — both derivations agree with the app's 41% within rounding.
//     300h (1,080,000s) is also the common default main-brush lifespan
//     Tuya vacuum firmwares use.
//   - `side_brush_time` (DP 119) as MAINTENANCE.LIFE_REMAINING, same idea:
//     confirmed by resetting the side brush counter in the app (Consommables
//     et Entretien > brosse latérale > reset) and observing DP 119 read 0
//     immediately after, while the app showed 100% / "150 Heure(s)" — full
//     life = 150h (540,000s). Also resolved a smaller mystery: DP 119 was
//     completely absent from every local DPS snapshot while the brush was at
//     0% (fully expired) — it only starts appearing in the LAN payload once
//     the counter is non-degenerate (reset or counting).
//   - `dust_collection_num` (DP 136, auto-empty-dock frequency) as another
//     TEXT/SELECT: confirmed string enum "0".."3" (0 = never, 1 = after every
//     clean, 2/3 = after 2/3 cleans), the same "arbitrary device setting, no
//     fixed Gladys vocabulary" case fan_mode/water_mode are.
//   - `y_mop` (DP 139, confirmed boolean: "Y-shaped mop wash" pattern toggle)
//     as a plain SWITCH.BINARY, same reasoning as pause_switch/auto_boost/
//     room_mode_switch above (no dedicated VACUUM_CLEANER type for it).
//   - `power_go` (DP 2, real Start/Stop): confirmed with a raw LAN write
//     (`tinytuya` `set_value(2, True)`/`set_value(2, False)`, bypassing
//     Gladys entirely) — `true` launches a cleaning cycle from idle AND
//     restarts one already running (observed: a fresh `path_comm` map
//     session, new `pathID`, on the second `true` while already cleaning);
//     `false` is a full stop, not a pause (`robot_state` moves straight to
//     `"idle"`, a value distinct from the `pause_switch`/"tocharge" path —
//     see the STATE vocabulary below). Wired as SWITCH.BINARY like
//     pause_switch/auto_boost/etc., but with `has_feedback: false`: DP 2
//     never appears in a full local `status()` snapshot in either state —
//     it is write-only, so Gladys cannot read its own toggle back; use the
//     "État" (robot_state) feature to see whether a cycle is actually
//     running. Its cloud code (`power_go`) was confirmed against the real
//     robot's Tuya cloud specification, not guessed.
//   Both `battery` and the two MAINTENANCE.LIFE_REMAINING features declare
//   `unit: DEVICE_FEATURE_UNITS.PERCENT` (all three are 0-100 percentages).
//   Every feature except the two consumables (main_brush_time/
//   side_brush_time) sets `keep_history: false`: per-second/frequent DPS
//   like state or battery would otherwise flood the states table for values
//   nobody graphs, while a consumable's percent — which only moves a few
//   times a day at most — is exactly the kind of trend worth keeping. The
//   two consumables set `keep_history: true` explicitly even though it is
//   the Gladys core default, so the choice reads as deliberate here rather
//   than an accidental omission.
//
// The cloud code <-> DPS mapping below is the REAL one, read from the
// actual robot's Tuya cloud specification and local DPS, with every value
// confirmed one at a time by toggling the matching setting in the Smart
// Life app and diffing DPS snapshots. The rest of the DPS this product
// exposes, deliberately NOT wired into a Gladys feature:
//   - clean_switch=101 (its real purpose is now understood — NOT the start
//     control it was first assumed to be). Tried as BUTTON/PUSH (writing
//     the plain `1` Gladys' own push control sends, unchanged, straight to
//     DP 101) and PHYSICALLY CONFIRMED NOT TO WORK: pressing it in Gladys
//     had no effect on the robot. Removed rather than left in place not
//     working. A later raw-LAN `status()` read (bypassing Gladys) showed
//     why: DP 101 is a READ-ONLY mirror of "is a cycle currently running"
//     (`true` while cleaning, `false` once stopped) — it toggles on its own
//     as a side effect of `power_go` (DP 2, see above), it was never a
//     writable command on this product. Left unwired: `robot_state` (DP
//     105) already conveys the same "is it running" information through a
//     richer vocabulary, so DP 101 would be redundant as a second feature.
//   - clean_mode=104 (string — loosely mirrors robot_state's activity type;
//     observed: "null" idle, "selectroom" room clean, "backcharge" returning)
//   - cur_clean_time=107 / cur_clean_area=108 (current-cycle counters, reset
//     to 0 at the start of a new cycle)
//   - remote_ctrl=111, seek_robot=112 (not exercised yet)
//   - disturb_switch=113 (do not disturb, boolean)
//   - volume=114 (voice volume, integer)
//   - total_clean_time=116 / total_clean_area=117 / total_clean_count=118
//     (cumulative counters, confirmed to increment when a cycle completes)
//   - filter_time=121: same idea as main_brush_time/side_brush_time
//     (elapsed-seconds consumable counter) but NOT wired — the app showed it
//     at 0% / 0h remaining (fully expired) with no reset option exercised
//     yet, so no elapsed value to cross-check a full-life reference against.
//     Needs re-checking once the filter is replaced/reset (a fresh, non-zero
//     — or freshly-zeroed, see the side_brush_time note above — elapsed
//     reading to cross-check against the app).
//   - robot_fault=122 (error code). Confirmed `type=bitmap` via the cloud
//     spec, but Tuya returns no bit-label list for this product
//     (`values={}`, same limitation as the consumables). One bit confirmed
//     by hand: lifting the robot off the ground mid-cycle set DP 122 to
//     1048576 (bit 20, 2^20) and `robot_state` (DP 105) to a new value,
//     `"fault"`, at the same time; putting it back down cleared both. Left
//     unwired: with only one of an unknown number of bits mapped, there is
//     nothing reliable to expose yet — see the project roadmap if more
//     fault conditions get cross-tested later.
//   - path_comm=123 / comm_raw=127 (NOT settings: a live event/notification
//     stream. 123 carries the robot's current map position while cleaning
//     (`{data:{pathID,posArray:[[x,y]],...}}`); 127 carries assorted
//     server/app notifications, e.g. the room/zone map on room-select
//     (`{data:{autoAreaValue:[{id,name,tag,vertexs},...],mapId,value:[...
//     forbidden zones]}}` — room `name` is Tuya-internal-encoded, not the
//     human label typed in the app) or a save-config ack
//     (`{data:{code,operate:"save"}}`). Their string payloads are
//     base64-encoded JSON, useful for investigation but not for the
//     cloud/local mapping tables (no stable per-DPS shape to map to a
//     Gladys feature).
//   - cmd_comm=124, request_data=125, comm_flag=126, message_report=128,
//     sn=130, uuid=131, voice_id=133, voice_link=134 (not exercised yet)
//   - mop_installed=138, only_mop_mode=141 (not exercised yet)
//   - depth_clean_switch=142 (confirmed boolean: a more intensive mop
//     scrub/pass mode) — not wired for the same reason as pause_switch/
//     auto_boost/room_mode_switch above (no dedicated VACUUM_CLEANER type);
//     left out to keep this to the settings actually asked for, not because
//     of a technical blocker like clean_switch's.
// Per-room cleaning itself (selecting a specific room/zone by name) stays
// cloud/app-only: DP 127's map payload above is the only place a room shows
// up locally, and only by an internal id + encoded name, never the label the
// user typed in the app. See the project roadmap.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

// Mirror of the core VACUUM_CLEANER_STATE constant (server/utils/constants.js).
export const VACUUM_CLEANER_STATE = {
  STOPPED: 0,
  RUNNING: 1,
  PAUSED: 2,
  ERROR: 3,
  RETURNING_TO_DOCK: 4,
  CHARGING: 5,
  DOCKED: 6,
};

// Honiture Q6 Pro vocabulary (Tuya DP 105 `robot_state` string -> Gladys
// VACUUM_CLEANER_STATE), confirmed one value at a time by triggering the
// matching action in the Smart Life app (or, for "totaling"/"idle", a raw
// LAN write via `power_go`/DP 2) and diffing DPS snapshots:
//   - "fullcharge": robot docked, battery at 100% -> DOCKED
//   - "chargring": robot docked, actively charging below 100% -> CHARGING
//     (this exact typo — missing the "a" in "charging" — is what the
//     firmware sends; it is not a mistake introduced here)
//   - "selectroom": a room-targeted clean cycle is running -> RUNNING
//   - "totaling": a general (non-room-targeted) clean cycle is running,
//     started via `power_go` -> RUNNING
//   - "pause": cycle paused (dock or room-clean alike) -> PAUSED
//   - "tocharge": heading back to the dock -> RETURNING_TO_DOCK
//   - "idle": stopped off-dock, no cycle running and none queued (reached by
//     writing `false` to `power_go` while cleaning) -> STOPPED
//   - "fault": a fault condition is active (confirmed by lifting the robot
//     off the ground mid-cycle; see robot_fault=DP122 in the file header —
//     the bitmap value itself is not decoded, but this string is) -> ERROR
// An unrecognized/unmapped string reads back as null, same as the
// HEATER.PILOT_WIRE_MODE reader in tuya.deviceMapping.js this pattern is
// copied from — never guessed.
export const HONITURE_Q6_PRO_STATE_TUYA_ENUM = {
  fullcharge: VACUUM_CLEANER_STATE.DOCKED,
  chargring: VACUUM_CLEANER_STATE.CHARGING,
  selectroom: VACUUM_CLEANER_STATE.RUNNING,
  totaling: VACUUM_CLEANER_STATE.RUNNING,
  pause: VACUUM_CLEANER_STATE.PAUSED,
  tocharge: VACUUM_CLEANER_STATE.RETURNING_TO_DOCK,
  idle: VACUUM_CLEANER_STATE.STOPPED,
  fault: VACUUM_CLEANER_STATE.ERROR,
};

// Cross-checked against the Smart Life app's "Consommables et Entretien"
// screen (41% / 124h remaining while DP 120 read 632691s elapsed) — see the
// file header for the full derivation. Not from the Tuya cloud spec, which
// gives no range/unit for this DPS.
const MAIN_BRUSH_FULL_LIFE_SECONDS = 300 * 3600;
// Confirmed by resetting the side brush counter in the app and reading DP
// 119 back at 0 while the app showed 100% / 150h — see the file header.
const SIDE_BRUSH_FULL_LIFE_SECONDS = 150 * 3600;

const cloudMapping = {
  charge_switch: {
    name: 'Retour à la base',
    category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
    type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.DOCK,
    keep_history: false,
  },
  robot_state: {
    name: 'État',
    category: DEVICE_FEATURE_CATEGORIES.VACUUM_CLEANER,
    type: DEVICE_FEATURE_TYPES.VACUUM_CLEANER.STATE,
    read_only: true,
    tuyaEnum: HONITURE_Q6_PRO_STATE_TUYA_ENUM,
    keep_history: false,
  },
  battery: {
    name: 'Batterie',
    category: DEVICE_FEATURE_CATEGORIES.BATTERY,
    type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
    read_only: true,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    keep_history: false,
  },
  pause_switch: {
    name: 'Pause',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    has_feedback: true,
    keep_history: false,
  },
  auto_boost: {
    name: 'Boost tapis',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    has_feedback: true,
    keep_history: false,
  },
  room_mode_switch: {
    name: 'Mode personnalisé',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    has_feedback: true,
    keep_history: false,
  },
  fan_mode: {
    name: "Puissance d'aspiration",
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    has_feedback: true,
    keep_history: false,
    // The complete, confirmed vocabulary (see the file header): no other
    // value has ever been observed, and an unrecognized raw string is simply
    // not one of these options rather than silently accepted.
    selectOptions: [
      { value: 'quiet', label: 'Silencieux' },
      { value: 'auto', label: 'Standard' },
      { value: 'strong', label: 'Fort' },
      { value: 'max', label: 'Max' },
    ],
  },
  water_mode: {
    name: "Niveau d'eau",
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    has_feedback: true,
    keep_history: false,
    selectOptions: [
      { value: 'low', label: 'Faible' },
      { value: 'mid', label: 'Moyen' },
      { value: 'high', label: 'Fort' },
    ],
  },
  dust_collection_num: {
    name: 'Collecte des poussières',
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
    has_feedback: true,
    keep_history: false,
    // Confirmed 4-value numeric-string scale (see the file header); the raw
    // Tuya values are single digits "0".."3", used as-is as the option value.
    selectOptions: [
      { value: '0', label: 'Jamais' },
      { value: '1', label: 'Après chaque nettoyage' },
      { value: '2', label: 'Après 2 nettoyages' },
      { value: '3', label: 'Après 3 nettoyages' },
    ],
  },
  y_mop: {
    name: 'Lavage en Y',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    has_feedback: true,
    keep_history: false,
  },
  power_go: {
    name: 'Nettoyage',
    category: DEVICE_FEATURE_CATEGORIES.SWITCH,
    type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    // DP 2 is write-only (never appears in a local status() snapshot): no
    // readback is possible, so this toggle cannot show the robot's real
    // state — use "État" (robot_state) for that.
    has_feedback: false,
    keep_history: false,
  },
  main_brush_time: {
    name: 'Brosse principale',
    category: DEVICE_FEATURE_CATEGORIES.MAINTENANCE,
    type: DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING,
    read_only: true,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    fullLifeSeconds: MAIN_BRUSH_FULL_LIFE_SECONDS,
    keep_history: true,
  },
  side_brush_time: {
    name: 'Brosse latérale',
    category: DEVICE_FEATURE_CATEGORIES.MAINTENANCE,
    type: DEVICE_FEATURE_TYPES.MAINTENANCE.LIFE_REMAINING,
    read_only: true,
    unit: DEVICE_FEATURE_UNITS.PERCENT,
    fullLifeSeconds: SIDE_BRUSH_FULL_LIFE_SECONDS,
    keep_history: true,
  },
};

const localMapping = {
  strict: true,
  codeAliases: {},
  dps: {
    charge_switch: 103,
    robot_state: 105,
    battery: 106,
    pause_switch: 102,
    auto_boost: 137,
    room_mode_switch: 144,
    fan_mode: 109,
    water_mode: 110,
    side_brush_time: 119,
    main_brush_time: 120,
    dust_collection_num: 136,
    y_mop: 139,
    power_go: 2,
  },
};

export const vacuum = {
  DEVICE_TYPE_NAME: 'vacuum',
  CATEGORIES: new Set(),
  PRODUCT_IDS: new Set(['c4ueb7cxlgmfon1t']),
  KEYWORDS: ['vacuum', 'robot vacuum', 'aspirateur', 'honiture'],
  REQUIRED_CODES: new Set(),
  CLOUD_MAPPINGS: cloudMapping,
  LOCAL_MAPPINGS: localMapping,
};
