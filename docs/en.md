# Tuya integration for Gladys Assistant

Control your Tuya / Smart Life devices from Gladys, over the **cloud** and, when possible, directly over your **local network (LAN)** for a faster, internet-independent experience.

## Supported devices

- **Smart plugs and sockets** (including the LSC Power Plug FR with energy metering): on/off, child lock, power, voltage, current, energy.
- **Energy meters** (including 3-phase): power, voltage, current, imported/exported energy.
- **Air conditioners**: on/off, mode (auto / cool / heat / dry / fan), target temperature, ambient temperature.
- **Pilot-wire (fil pilote) thermostats** (RP5 family, Konyks eCosy): heating mode, target temperature, ambient temperature, child lock, energy.
- **Switches, lights and covers** through the generic mappings.

Every device shows a **Local** or **Cloud** badge so you always know how it communicates.

---

## 1. Create a Tuya IoT Cloud project

The integration needs a (free) Tuya IoT Cloud project to reach your devices.

1. Go to the [Tuya IoT Platform](https://iot.tuya.com/) and sign in (create an account if needed).
2. Open **Cloud → Development** and click **Create Cloud Project**.
   - Give it any name.
   - **Industry / Development method**: keep the defaults (Smart Home).
   - **Data Center**: pick the region closest to you (e.g. _Central Europe_ for France). **Remember this choice** — you will select the same region in Gladys.
3. Once created, open the project. On the **Overview** tab, note the **Access ID / Client ID** and the **Access Secret / Client Secret**.
4. Open the **Service API** tab and make sure **IoT Core** is authorized (subscribe to it if not — it is free).

## 2. Link your Smart Life / Tuya app account

Your devices must belong to a Tuya app account that the project can see.

1. In the project, open **Devices → Link Tuya App Account → Add App Account**.
2. Scan the QR code with your **Smart Life** or **Tuya Smart** phone app (Me → top-right scan icon).
3. Back on the platform, open **Devices → Link Tuya App Account**: your devices now appear.
4. Note your **App account UID** (shown next to the linked account).

## 3. Fill in the configuration in Gladys

In the integration configuration screen, fill in:

| Field               | Where to find it                                         |
| ------------------- | -------------------------------------------------------- |
| **Endpoint**        | The Data Center region you chose in step 1               |
| **Client ID**       | Project Overview → Access ID / Client ID                 |
| **Client Secret**   | Project Overview → Access Secret / Client Secret         |
| **App account UID** | Devices → Link Tuya App Account → the linked account UID |

Save. The **Connection** status at the bottom of the screen should turn to **Connected**. If it shows an error, the message tells you what to fix (wrong credentials, wrong region…).

## 4. Discover your devices

Open the **Discover** tab and let Gladys list your Tuya devices, then create the ones you want. Each device appears with its features and a Local/Cloud badge.

---

## Local mode (LAN)

Local control is faster and keeps working without internet. It is enabled by the **"Prefer the local connection"** toggle (on by default).

- When on, Gladys tries to reach each device on your network; if it can, the device shows a **Local** badge and its state updates **instantly**. If it cannot, the device automatically falls back to the **Cloud**.
- Local control needs Gladys to know each device's IP address and protocol. Most devices are found automatically by the network scan during discovery.

### A device stays on Cloud even though it is on your LAN

Some devices are not found by the automatic scan (different subnet, asleep during the scan…). You can add them by hand:

1. Open the **Configuration** screen → **Detect local protocol (manual IP)** action.
2. Enter the device (its Gladys name or its Tuya ID) and its **IP address**.
3. Run it. On success, the device switches to local on the next cycle.

> Tip: give your Tuya devices a fixed IP (DHCP reservation) on your router so they stay reachable.

---

## Real-time cloud events (Pulsar) — optional

For devices used **over the cloud**, Gladys can receive their state changes **instantly** (in ~1–2 s) instead of waiting for the next poll. This uses the Tuya **Message Service** (a.k.a. Pulsar). Devices already controlled locally already get instant feedback and do not need this.

Two steps to enable it:

1. **On the Tuya IoT Platform**: open your project → **Service API** → subscribe to **Message Service** (free). Without it, the connection is refused and Gladys logs an explicit message.
2. **In Gladys**: turn on the **"Real-time cloud events (Pulsar)"** toggle in the configuration, then save.

> A device only reports through Pulsar what it actually sends to the Tuya cloud: some report their full state, some only a part (e.g. on/off), some nothing — those simply keep the regular cloud refresh. This is a device/firmware behaviour, not a limitation of Gladys.

---

## Useful actions

- **Detect local protocol (manual IP)**: enable local mode for a device the scan did not find (see above).
- **Disconnect from the Tuya cloud**: stops talking to the cloud until you save the configuration again.

## Troubleshooting

- **Connection shows an error** → check the four credentials and that the **Endpoint** matches your project's Data Center.
- **A device has no state / no control** → check its badge. On Cloud with nothing coming back, the device may be offline in the Tuya app.
- **Real-time cloud events do not start** → make sure **Message Service** is subscribed on your Tuya project (a 401 in the logs means it is not).
- **Logs** are available in the integration's **Logs** tab.
