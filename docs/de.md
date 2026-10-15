# Tuya-Integration für Gladys Assistant

Steuern Sie Ihre Tuya / Smart Life Geräte aus Gladys, über die **Cloud** und, wenn möglich, direkt über Ihr **lokales Netzwerk (LAN)** — schneller und unabhängig vom Internet.

## Unterstützte Geräte

- **Smarte Stecker und Steckdosen** (einschließlich LSC Power Plug FR mit Energiemessung): Ein/Aus, Kindersicherung, Leistung, Spannung, Strom, Energie.
- **Energiezähler** (auch dreiphasig): Leistung, Spannung, Strom, bezogene/eingespeiste Energie.
- **Klimageräte**: Ein/Aus, Modus (Auto / Kühlen / Heizen / Entfeuchten / Lüften), Solltemperatur, Raumtemperatur, Lüfterstufe und beide Schwenkachsen.
- **Fil-pilote-Thermostate** (französische Steuerleitung, RP5-Familie, Konyks eCosy): Heizmodus, Solltemperatur, Raumtemperatur, Kindersicherung, Energie.
- **Kameras** (einschließlich LSC): Privatsphäre-Modus, Bewegungserkennung, Sirene, Bewegungsverfolgung, Personenfilter, Aufnahme, Bilddrehung und ein in Szenen nutzbarer Bewegungssensor.
- **Video-Türklingeln**: Klingeln (eigene Türklingel-Funktion), Schnappschuss des Besuchers, Bewegungserkennung, Aufnahme, Status-LED.
- **Futterautomaten**: Füttern auf Abruf, zuletzt ausgegebene Menge, langsames Füttern, Licht, Batterie (Prozent oder Rohspannung plus Schwach-Flag, je nach Modell), geplante Mahlzeiten.
- **Ventilatoren und Lüftungsgeräte** (Kategorie `fs`, z. B. das Wärmerückgewinnungsgerät AV-TTW5-W): Ein/Aus, Stufe (die eigenen Stufen des Geräts, z. B. 1 bis 3), Licht, Kindersicherung, Luftstromrichtung, horizontales/vertikales Schwenken, Raumtemperatur, wenn das Gerät eine misst.
- **Luftentfeuchter** (Kategorie `cs`, z. B. Qlima D825A): Ein/Aus, aktuelle Luftfeuchtigkeit, Temperatur, Lüfterstufe, Timer und Restzeit, Modus, Ziel-Luftfeuchtigkeit (wenn in Stufen angeboten), Kindersicherung. Stufen, Timer-Dauern und Modi listen genau die Werte, die Ihr Modell angibt.
- **Temperatur- und Feuchtigkeitssensoren** (Kategorie `wsdcg`, z. B. Konyks Termo): Temperatur, Luftfeuchtigkeit, Batterie-schwach-Flag (und Batterieprozent bei den Modellen, die es messen). Batteriegeräte schlafen zwischen zwei Meldungen: sie werden über die Cloud bedient, nicht über das LAN.
- **Wasserfilter / Umkehrosmoseanlagen** (Kategorie `js`, z. B. The Box): TDS am Ein- und Ausgang (ppm), Restlebensdauer jeder Filterstufe (PP, CTO, RO) in Prozent und in Tagen, Betriebszustand. Das Zurücksetzen nach einem Filterwechsel bleibt in der Tuya-App (ein Fehlklick würde den tatsächlichen Verschleiß des Filters löschen).
- **Saugroboter** (Honiture Q6 Pro): Start/Stopp, Pause, zur Ladestation, Reinigungszustand, Batterie, Saugleistung, Wasserstand, Teppich-Boost, benutzerdefinierter (Raum-)Modus, Y-Wischen, Häufigkeit der Staubabsaugung, Restlebensdauer der Haupt-/Seitenbürste. Hinweis: bei diesem Produkt startet das Ausschalten von Pause bei vollständig gestopptem Roboter auch einen neuen Reinigungszyklus — es ist kein reiner Pause-Schalter.
- **Schalter, Lampen und Rollläden** über die generischen Zuordnungen.

> Kameras und Türklingeln liefern ihre Schnappschüsse, keinen Live-Videostream: Tuya stellt keinen stabilen lokalen RTSP/ONVIF-Endpunkt bereit.
>
> Das Klingeln der Türklingel sowie Lüfterstufe / Schwenken des Klimageräts erfordern **Gladys 4.84.2 oder neuer**. Saugleistung / Wasserstand / Häufigkeit der Staubabsaugung des Saugroboters erfordern **Gladys 4.86.1 oder neuer**. Auf einem älteren Gladys funktioniert die Integration weiter, ohne diese Funktionen.
>
> Neuinstallationen aus dem Store erfordern **Gladys 4.86.1 oder neuer**; eine bereits installierte Integration wird auf jeder Gladys-Version weiter aktualisiert.

Jedes Gerät zeigt ein Abzeichen **Lokal** oder **Cloud**, damit Sie immer wissen, wie es kommuniziert.

---

## 1. Ein Tuya-IoT-Cloud-Projekt erstellen

Die Integration benötigt ein (kostenloses) Tuya-IoT-Cloud-Projekt, um Ihre Geräte zu erreichen.

1. Öffnen Sie die [Tuya IoT Platform](https://iot.tuya.com/) und melden Sie sich an (legen Sie bei Bedarf ein Konto an).
2. Öffnen Sie **Cloud → Development** und klicken Sie auf **Create Cloud Project**.
   - Geben Sie einen beliebigen Namen ein.
   - **Industry / Development method**: Standardwerte beibehalten (Smart Home).
   - **Data Center**: wählen Sie die Region, die Ihnen am nächsten liegt (z. B. _Central Europe_ für Deutschland). **Merken Sie sich diese Wahl** — Sie wählen dieselbe Region in Gladys.
3. Öffnen Sie das erstellte Projekt. Notieren Sie im Reiter **Overview** die **Access ID / Client ID** und das **Access Secret / Client Secret**.
4. Öffnen Sie den Reiter **Service API** und prüfen Sie, dass **IoT Core** autorisiert ist (abonnieren Sie es sonst — es ist kostenlos).

> ⚠️ **Die Testphase von IoT Core läuft ab.** Tuya stellt diesen Dienst als kostenlose Testphase bereit (ein Monat, danach kostenlos um jeweils sechs Monate verlängerbar). Ist sie abgelaufen, lehnt Tuya **jeden** API-Aufruf Ihres Projekts ab und alle Ihre Geräte sind in Gladys offline, mit der Meldung _"IoT Core service subscription has expired"_.
>
> Zum Verlängern: **Cloud → Development → Ihr Projekt → Service API** (oder **Cloud → Cloud Services → IoT Core**), dann **Extend Trial Period**. Das ist kostenlos und sofort wirksam. Stellen Sie sich eine Erinnerung — die Verlängerung ist alle sechs Monate nötig.

## 2. Ihr Smart Life / Tuya App-Konto verknüpfen

Ihre Geräte müssen zu einem Tuya-App-Konto gehören, das das Projekt sehen kann.

1. Öffnen Sie im Projekt **Devices → Link Tuya App Account → Add App Account**.
2. Scannen Sie den QR-Code mit Ihrer **Smart Life**- oder **Tuya Smart**-App (Ich → Scan-Symbol oben rechts).
3. Öffnen Sie auf der Plattform wieder **Devices → Link Tuya App Account**: Ihre Geräte erscheinen jetzt.
4. Notieren Sie Ihre **App account UID** (neben dem verknüpften Konto angezeigt).

## 3. Die Konfiguration in Gladys ausfüllen

Füllen Sie im Konfigurationsbildschirm der Integration aus:

| Feld              | Wo Sie es finden                                             |
| ----------------- | ------------------------------------------------------------ |
| **Endpoint**      | Die in Schritt 1 gewählte Data-Center-Region                 |
| **Client ID**     | Projekt-Overview → Access ID / Client ID                     |
| **Client Secret** | Projekt-Overview → Access Secret / Client Secret             |
| **App-Konto-UID** | Devices → Link Tuya App Account → UID des verknüpften Kontos |

Speichern Sie. Der Status **Verbindung** unten auf dem Bildschirm sollte auf **Verbunden** wechseln. Bei einem Fehler sagt die Meldung, was zu korrigieren ist (falsche Zugangsdaten, falsche Region…).

## 4. Ihre Geräte entdecken

Öffnen Sie den Reiter **Entdecken**, lassen Sie Gladys Ihre Tuya-Geräte auflisten und erstellen Sie die gewünschten. Jedes Gerät erscheint mit seinen Funktionen und einem Lokal/Cloud-Abzeichen.

---

## Lokaler Modus (LAN)

Die lokale Steuerung ist schneller und funktioniert auch ohne Internet. Sie wird über den Schalter **„Lokale (LAN) Verbindung bevorzugen, wenn verfügbar“** aktiviert (standardmäßig an).

- Wenn er an ist, versucht Gladys jedes Gerät in Ihrem Netzwerk zu erreichen; gelingt das, zeigt das Gerät ein Abzeichen **Lokal** und sein Zustand aktualisiert sich **sofort**. Andernfalls weicht das Gerät automatisch auf die **Cloud** aus.
- Die lokale Steuerung erfordert, dass Gladys IP-Adresse und Protokoll jedes Geräts kennt. Die meisten Geräte werden beim Entdecken automatisch vom Netzwerkscan gefunden.
- Ein Gerät, das lokal laufen _könnte_ (IP bekannt und Präferenz aktiv), aber gerade über die Cloud läuft, behält ein Abzeichen **Cloud** mit einem **orangen Punkt** — fahren Sie mit der Maus darüber, um den Grund zu sehen (Gerät nach Fehlern geparkt, LAN-Daten unvollständig…). Ein reines Cloud-Gerät bleibt ein einfaches blaues Cloud-Abzeichen.

### Ein Gerät bleibt in der Cloud, obwohl es in Ihrem LAN ist

Manche Geräte findet der automatische Scan nicht (anderes Subnetz, während des Scans im Ruhezustand…). Sie können sie von Hand hinzufügen:

1. Öffnen Sie den Bildschirm **Konfiguration** → Aktion **Lokales Protokoll erkennen (manuelle IP)**.
2. Geben Sie das Gerät (seinen Namen in Gladys oder seine Tuya-ID) und seine **IP-Adresse** ein.
3. Führen Sie sie aus. Bei Erfolg wechselt das Gerät im nächsten Zyklus auf lokal.

> Tipp: Geben Sie Ihren Tuya-Geräten in Ihrem Router eine feste IP (DHCP-Reservierung), damit sie erreichbar bleiben.

---

## Echtzeit-Cloud-Ereignisse (Pulsar) — optional

Für Geräte, die **über die Cloud** genutzt werden, kann Gladys deren Zustandsänderungen **sofort** (in ~1–2 s) empfangen, statt auf die nächste Abfrage zu warten. Dafür wird der Tuya **Message Service** (auch Pulsar genannt) verwendet. Lokal gesteuerte Geräte erhalten bereits eine sofortige Rückmeldung und brauchen dies nicht.

Zwei Schritte zur Aktivierung:

1. **Auf der Tuya IoT Platform**: öffnen Sie Ihr Projekt → **Service API** → abonnieren Sie **Message Service** (kostenlos). Ohne dieses Abonnement wird die Verbindung abgelehnt und Gladys protokolliert eine eindeutige Meldung.
2. **In Gladys**: aktivieren Sie in der Konfiguration den Schalter **„Echtzeit-Cloud-Ereignisse (Pulsar)“** und speichern Sie.

> Ein Gerät meldet über Pulsar nur, was es tatsächlich an die Tuya-Cloud sendet: manche ihren vollständigen Zustand, manche nur einen Teil (z. B. Ein/Aus), manche nichts — diese behalten einfach die normale Cloud-Aktualisierung. Das ist ein Verhalten des Geräts/der Firmware, keine Einschränkung von Gladys.

---

## Ein nicht unterstütztes Gerät melden

Ein Gerät, das ohne Funktion (oder mit nur einer) erstellt wird, meldet Tuya-Codes, die die Integration noch nicht kennt — häufig bei Varianten desselben Modells.

Führen Sie in der Konfiguration der Integration die Aktion **Gerätediagnose** aus, geben Sie den Gerätenamen wie in Gladys angezeigt ein und kopieren Sie das Ergebnis in ein GitHub-Issue. Der Bericht listet jeden Code, den das Gerät meldet, seinen Wert und was die Integration damit macht. Er enthält weder lokalen Schlüssel noch IP-Adresse noch Tuya-Geräte-ID: er kann so wie er ist öffentlich eingefügt werden.

---

## Namen der Funktionen (Sprache) — optional

Die automatisch erzeugten Funktionsnamen dieser Integration (z. B. „Dock“, „Suction power“) und Optionsbezeichnungen sind standardmäßig **Englisch**, gemäß der Konvention aller unterstützten Gerätetypen — ein tatsächlich vom Gerät selbst gelesener Name (selten) bleibt unabhängig von dieser Einstellung unverändert. Mit der Konfigurationsoption **„Namen der Funktionen“** können Sie neu entdeckte Geräte stattdessen auf **Französisch**, **Deutsch** oder **Spanisch** umstellen, übersetzt über ein kleines eingebautes Wörterbuch.

> **Funktionsnamen ändern sich nur bei neu entdeckten Geräten.** Das Ändern dieser Option benennt bereits in Gladys erstellte Funktionen nicht um — benennen Sie sie dort bei Bedarf von Hand um, oder löschen Sie das Gerät und fügen Sie es über den Reiter Entdecken neu hinzu, um die neue Sprache zu übernehmen. Optionsbezeichnungen sind die Ausnahme: bei einem bestehenden Gerät folgen die Bezeichnungen der Listen (z. B. die Saugleistung des Saugroboters) bei der nächsten Erkennung der neuen Sprache, da Gladys dann die Optionen jedes Geräts neu synchronisiert. Ein Name/eine Bezeichnung, für die die Integration noch keine Übersetzung hat, bleibt in jedem Fall Englisch, nie geraten.

---

## Nützliche Aktionen

- **Lokales Protokoll erkennen (manuelle IP)**: aktiviert den lokalen Modus für ein Gerät, das der Scan nicht gefunden hat (siehe oben).
- **Gerätediagnose**: erstellt den Bericht über das, was ein Gerät bereitstellt (siehe oben).
- **Von der Tuya-Cloud trennen**: beendet die Kommunikation mit der Cloud, bis Sie die Konfiguration erneut speichern.

## Fehlerbehebung

- **Die Verbindung zeigt einen Fehler** → prüfen Sie die vier Zugangsdaten und dass der **Endpoint** dem Data Center Ihres Projekts entspricht.
- **Ein Gerät hat keinen Zustand / keine Steuerung** → prüfen Sie sein Abzeichen. In der Cloud ohne Rückmeldung ist das Gerät in der Tuya-App möglicherweise offline.
- **Die Echtzeit-Cloud-Ereignisse starten nicht** → prüfen Sie, dass **Message Service** in Ihrem Tuya-Projekt abonniert ist (ein 401 in den Logs bedeutet, dass es das nicht ist).
- **Logs** finden Sie im Reiter **Protokolle** der Integration.
