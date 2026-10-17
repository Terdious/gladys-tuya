# Changelog

All notable changes to this integration. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

Every pull request adds its user-facing changes under **Unreleased**. The
Release workflow moves that section under the new version number and publishes
it as the GitHub Release notes — it refuses to release when Unreleased is empty.

## [Unreleased]

## [1.27.0] - 2026-10-17

### Added

- Three-phase meters / power clamps (category `zndb`, e.g. the "Power Clamp" with CamelCase codes): power, current, voltage and consumed energy of each phase, total power, current and energy, internal temperature of the clamp, over the cloud or the LAN. A clamp already created (as an unknown device, with no feature) gets them with the **Update** button of the Discover tab, or by deleting and re-creating it.

## [1.26.0] - 2026-10-16

### Added

- PTZ cameras (#26, LSC PTZ / Dualband): pan left/right and tilt up/down through the Gladys `camera.move` feature (Gladys 4.86.1 or later), over the cloud or the LAN. Every move is stopped by the camera's `ptz_stop` on release, or after 2 s if the stop never arrives (the spec's safety rule).
- Camera settings as lists: night vision (auto/off/on), motion sensitivity, sound sensitivity, recording mode (event/continuous), anti-flicker (off/50 Hz/60 Hz); sound detection and timestamp overlay as switches. Thanks @GBoulvin for the diagnostics.

## [1.25.0] - 2026-10-16

### Added

- Automatic LAN re-scan: while a created device that can run locally still has no IP (asleep or silent during the discovery scan), a LAN scan is retried every 15 minutes in the background; a device that answers gets its IP/protocol stored and switches to local on the next poll, with no user action (#7).

## [1.24.1] - 2026-10-16

### Changed

- Local devices still read their LAN states every 10 s, but their cloud reads (features without a local mapping, fallback while the LAN fails or is parked) are throttled to one every 25–30 s, sparing the Tuya cloud API quota. Cloud-only devices keep their 30 s cadence (#6).

## [1.24.0] - 2026-10-16

### Added

- Water valves / irrigation controllers (category `sfkzq`, e.g. R2601): open/close, valve state, instant water flow (converted to m³/h), battery, child lock, watering mode, manual watering duration (#28). A valve already created (as an unknown device, with only its switch) gets the new features with the **Update** button of the Discover tab, or by deleting and re-creating it.

### Changed

- A short loss of the connection to Gladys (core restart, network blip) no longer reconnects the Tuya cloud nor re-runs a full discovery and LAN scan when nothing changed: the status and the known devices are simply re-sent (#21).
- On container stop, the integration waits (up to 5 s) for the local sessions to close cleanly (#21).

### Fixed

- "Detect local protocol": a discovery started during the probe could replace the device list and lose the detected IP/protocol; both now run one after the other (#21).
- The automatic cloud reconnection kept the ids of its finished timers forever (slow memory growth) (#20).

## [1.23.0] - 2026-10-16

### Changed

- The "Detect local protocol" and "Device diagnostic" actions offer the device in a **list** of the devices created in Gladys, instead of a text field. A second, optional field still accepts a name or Tuya ID for a device not created in Gladys.
- Device diagnostic: a new "Declared value specs" section lists the range, scale, step and unit each numeric code declares (what a new device type needs to publish the right value in the right unit).

## [1.22.1] - 2026-10-16

### Changed

- Integration SDK 0.15.0 (additive: poll frequencies, state deduplication and
  the latest Gladys device constants).
- Node.js 22 or later is required for development (Node 20 is end-of-life);
  the image keeps running Node 24.

### Security

- `qs` 6.16.1 (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g), a dependency of the
  Tuya cloud client.

## [1.22.0] - 2026-10-16

### Added

- Air conditioners that spell their values their own way, e.g. the MEDION P502 camping AC (needs for which the `gladys-tuya-medion` fork was made):
  - modes are read and written case-insensitively, in the device's own spelling (`COOL`, `DRY`…);
  - a fan speed declared as bare levels (`"1"`/`"2"`) is offered as Low / High (3 to 5 levels are spread the same way);
  - the `Shake` louver swing is exposed as a "Swing" switch (DPS 8 on the LAN).

  The enum values each AC declares are stored at discovery (`AC_ENUM_RANGES` device param): re-run a discovery (or delete and re-create the AC) for an existing device to pick them up. Without them, the behaviour is unchanged.

## [1.21.0] - 2026-10-16

### Added

- `CHANGELOG.md`, published as GitHub Release notes by the Release workflow.

### Fixed

- Air conditioners whose panel displays °F (#52): the ambient temperature is no longer divided by 10 on models sending whole degrees (the scale the device declares is now kept), and the setpoint / ambient temperature are no longer labelled °F while the device sends Celsius (when the device also exposes the `temp_set_f` / `temp_current_f` twins). Delete and re-discover an AC created before this version to pick up the correct unit; its scale is corrected at the next discovery.

## [1.20.0] - 2026-10-16

### Added

- "Feature names" configuration option: the auto-generated feature names and option labels of newly discovered devices in English, French, German or Spanish (#43, thanks @vincentBesseau).
- Every user-facing text in English, French, German and Spanish: manifest (description, configuration, actions), connection statuses, degraded-badge tooltips, action results, and the user documentation (`docs/de.md`, `docs/es.md`).
- Tests that fail CI when a text, feature name or documentation page misses one of the four languages.

### Changed

- French: "Heating" is now translated "Chauffage".

## [1.19.0] - 2026-10-15

### Added

- Water purifiers / reverse-osmosis units (category `js`, e.g. The Box): inlet and outlet TDS, remaining life of each filter stage (PP, CTO, RO) in percent and in days, working status (#54).

## [1.18.0] - 2026-10-10

### Added

- Temperature & humidity sensors (category `wsdcg`, e.g. Konyks Termo): temperature, humidity, low-battery flag and battery level when the model measures one.

## [1.17.0] - 2026-10-06

### Added

- Dehumidifiers (category `cs`, e.g. Qlima D825A): on/off, humidity, temperature, fan speed, timer and time left, mode, target humidity steps, child lock (#39).
- Device diagnostic: reports the enum ranges the cloud declares for each code.

### Fixed

- Air conditioners: the Heating and Fan modes can be selected again (hidden since 1.11.0).

## [1.16.0] - 2026-09-18

### Added

- Fans and ventilation units (category `fs`, e.g. the AV-TTW5-W heat-recovery unit): on/off, speed, light, child lock, airflow direction, swing, ambient temperature (#49).

## [1.15.0] - 2026-09-05

### Added

- Pet feeders: support for the F14-W code set (#35).

## [1.14.0] - 2026-09-04

### Added

- "Device diagnostic" action: lists what a device reports and what the integration does with each code, ready to paste into a GitHub issue (#37).

## [1.13.3] - 2026-09-04

### Changed

- Logs: the cloud status of each device is logged once, annotated code by code.

## [1.13.2] - 2026-09-03

### Fixed

- Doorbells: the visitor snapshot is published before the ring event fires.

## [1.13.1] - 2026-09-03

### Changed

- New installs from the store require Gladys 4.86.1 or later; store categories declared, descriptions refreshed.

## [1.13.0] - 2026-09-02

### Added

- Robot vacuums (Honiture Q6 Pro): start/stop, pause, dock, state, battery, suction power, water level, modes, brush life.

### Fixed

- States that were silently skipped by the poll for some feature types.

### Removed

- The `debug_device_status` action (replaced by the logs, then by the device diagnostic in 1.14.0).

## [1.12.0] - 2026-08-05

### Added

- Pet feeders (category `cwwsq`): feed on demand, last amount fed, slow feed, light, battery, meal plan.
- More discovery and LAN diagnostics in the logs.

## [1.11.0] - 2026-08-02

### Added

- Doorbells use the dedicated Doorbell feature type (scene trigger "the doorbell rings"), on Gladys 4.84.2 or later.
- Air conditioners: fan speed and horizontal/vertical swing, on Gladys 4.84.2 or later.

### Changed

- Camera and doorbell motion is a motion sensor instead of a button.
- On a Gladys older than 4.84.2, the new features gracefully fall back to the previous behaviour.

## [1.10.0] - 2026-08-01

### Fixed

- Cameras: the doorbell and motion buttons expose their supported options.

## [1.9.0] - 2026-08-01

### Added

- Cameras: motion event and live-view snapshot refresh.

## [1.8.0] - 2026-08-01

### Added

- Video doorbells: ring event and visitor snapshot.

## [1.7.0] - 2026-08-01

### Added

- Smart cameras (cloud + LAN): privacy mode, motion detection, siren, motion tracking, recording, image flip.

## [1.6.0] - 2026-07-23

### Added

- User documentation and configuration sections.
- Degraded badge: a local-capable device running over the cloud shows why (#15).

## [1.5.0] - 2026-07-22

### Added

- Real-time cloud events through the Tuya Message Service (Pulsar), opt-in (#10).

## [1.4.0] - 2026-07-22

### Changed

- Hardening from the full code review and the bench tests: badge flapping, connection status, initial states on session connect, manifest shipped in the image label.

## [1.3.0] - 2026-07-21

### Added

- Pilot-wire (fil pilote) thermostats.
- LSC Power Plug FR with energy metering.

## [1.2.0] - 2026-07-21

### Added

- Air conditioners.

### Fixed

- A discovery no longer wipes the stored LAN info of a device.
- The feature scale lost by the Gladys persistence is restored.

## [1.1.0] - 2026-07-21

### Added

- Persistent local sessions with instant state push (#9).

## [1.0.1] - 2026-07-21

### Added

- First release: the Tuya cloud connection, device model and local (LAN) mode ported from the Gladys core service, with a live local/cloud preference and a local circuit breaker.
