# Tado Heating Manager Cards

[![HACS](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)
[![Release](https://img.shields.io/github/v/release/ilbagatta/tado_heating_manager_cards)](https://github.com/ilbagatta/tado_heating_manager_cards/releases)

Card Lovelace per l'integrazione **Tado Heating Manager** (`tado_heating_manager`): un solo file JavaScript, senza
dipendenze (niente button-card) e senza build.

La card del termosifone e quella del climatizzatore funzionano con qualsiasi entita' `climate`; la card dei programmi
e quella della quota richiedono l'integrazione Tado Heating Manager.

| Card | Uso |
|---|---|
| `custom:heating-planner-card` | Programmi a fasce di tutte le stanze, tab Feriali / Weekend, ordine delle stanze |
| `custom:heating-radiator-card` | Riga o blocco di un termosifone (modo, temperatura, valvola, offset, popup con grafico) |
| `custom:heating-summary-card` | Riepilogo per la Home: termosifoni, prossimo cambio, quota; ogni parte apre il suo popup |
| `custom:heating-summary-editable-card` | Come la precedente, con −/+ della temperatura e il tasto della modalità (tendina Caldo/Auto/Spento) in ogni riquadro |
| `custom:heating-radiators-card` | Una riga (o un blocco) di termosifone per ogni stanza di Tado Heating Manager, aggiunta da sola |
| `custom:heating-ac-card` | Riga o blocco di un climatizzatore (modo, oscillazione, velocità, temperatura, popup con grafico) |
| `custom:heating-acs-card` | Una riga (o un blocco) per ogni climatizzatore, trovati da soli o scelti a mano |
| `custom:heating-usage-card` | Ore di riscaldamento e di valvola chiusa per stanza (oggi, ieri, 7 e 30 giorni), dallo storico |
| `custom:tado-quota-card` | Quota API Tado: stato, indicatori, provenienza delle chiamate, voci espandibili |

Le card sono separate dall'integrazione: dopo una modifica basta **ricaricare la dashboard**, senza riavviare Home Assistant.

## Installazione

### HACS (repository personalizzato)

[![Apri in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=ilbagatta&repository=tado_heating_manager_cards&category=plugin)

Oppure a mano: HACS → ⋮ → *Repository personalizzati* → URL `https://github.com/ilbagatta/tado_heating_manager_cards`,
tipo **Dashboard** → *Aggiungi* → apri la card → *Scarica*.

HACS aggiunge da solo la risorsa `/hacsfiles/tado_heating_manager_cards/tado-heating-manager-cards.js`
(e ne aggiorna la versione a ogni aggiornamento): basta ricaricare la dashboard.

Se prima la installavi a mano, togli la vecchia risorsa `/local/tado-heating-manager-cards.js` e il file da `/config/www/`,
altrimenti il file viene caricato due volte (resta attivo il primo).

### Manuale

1. Copia `dist/tado-heating-manager-cards.js` in `/config/www/`.
2. **Impostazioni → Dashboard → ⋮ → Risorse → Aggiungi risorsa**:
   - URL: `/local/tado-heating-manager-cards.js?v=2.24.0`
   - Tipo: **Modulo JavaScript**

   (Se il menu Risorse non si vede: attiva la *Modalita' avanzata* nel profilo utente.)
3. Ricarica la pagina.

Una volta sola: le dashboard che usano gia' `custom:heating-planner-card`, `heating-radiator-card` e `heating-ac-card`
continuano a funzionare con la stessa configurazione.

## Aggiornare

- **HACS**: quando esce una nuova release HACS la propone; aggiorna e ricarica la dashboard.
- **Manuale**: sostituisci il file in `/config/www/`, poi alza `?v=` nella risorsa (es. `?v=2.0.2`) **oppure** ricarica la
  pagina con la cache svuotata (Ctrl+F5; nell'app: Impostazioni app → Debug → Reset frontend cache).

Nella console del browser compare `TADO-HEATING-MANAGER-CARDS <versione>`: serve a controllare quale versione e' caricata.

## Configurazione

Tutte le card si configurano anche dall'**editor visuale** di Home Assistant
(*Modifica dashboard → Aggiungi card → cerca "Heating" o "Tado"*), senza scrivere YAML.

```yaml
type: custom:heating-planner-card
title: Riscaldamento        # facoltativo
```

```yaml
type: custom:heating-radiator-card
entity: climate.termo_soggiorno   # obbligatorio
name: Soggiorno                   # facoltativo
layout: tile                      # facoltativo: blocco invece della riga
temp_termometro: sensor.xxx       # facoltativo: temperatura ambiente (T:)
temp_valvola: sensor.zzz          # facoltativo: temperatura della valvola (V:)
offset_prioritario: sensor.kkk    # facoltativo: se manca, l'"Offset gestito" della stanza con questo termostato
offset_sensor: sensor.yyy         # facoltativo
fan: switch.ventola               # facoltativo
door: binary_sensor.porta         # facoltativo
```

Nome, termometro, temperatura della valvola, ventola e offset lasciati vuoti si prendono dalla stanza di Tado Heating
Manager con lo stesso `entity` (la ventola si imposta nella stanza: *Impostazioni → Tado Heating Manager → stanza →
Modifica*).

Con `layout: tile` (nell'editor: *Aspetto → Blocco*) la card diventa un blocco nello stile di `heating-summary-card`
con gli stessi comandi della riga: modalità (fiamma, apre il menu Caldo/Auto/Spento), ventola, −/+ della temperatura
target, più temperatura grande, valvola (V) e offset (Δ). Nella vista a sezioni ne stanno tre per riga. Un tocco sul
blocco apre lo stesso popup della riga; la pressione lunga sui tasti apre i dettagli.

```yaml
type: custom:heating-radiators-card
layout: tile                      # facoltativo: blocchi affiancati invece delle righe
columns: 3                        # facoltativo, solo con layout: tile: blocchi per riga (2 o 3; predefinito: automatico)
order:                            # facoltativo: questi per primi, in quest'ordine (gli altri nell'ordine delle stanze)
  - climate.termo_camera
exclude:                          # facoltativo: stanze da non mostrare
  - climate.termo_bagno
names:                            # facoltativo: nome mostrato solo in questa card
  - entity: climate.termo_soggiorno
    name: Scala
```

Una `heating-radiator-card` per ogni stanza, nell'ordine delle stanze: le stanze nuove compaiono da sole.
La plancia "Riscaldamento" creata dall'integrazione usa invece righe separate (una `heating-radiator-card` per stanza).

Senza stanze, la card dei programmi e quella dei termosifoni mostrano il pulsante **Aggiungi le stanze**, che apre la
pagina dell'integrazione. Se nessuna stanza ha fasce, la card dei programmi si apre su "Tutti (modifica)".

```yaml
type: custom:heating-summary-card
title: Riscaldamento            # facoltativo
columns: 3                      # facoltativo: tessere delle stanze su 2 o 3 colonne (predefinito 3)
show_planner: true              # facoltativo: prossimo cambio e stato dei programmi
show_quota: true                # facoltativo: barra della quota (solo se ci sono i sensori)
show_turn_off: true             # facoltativo: tasto "spegni tutti" (button.hp_all_turn_off)
show_actions: true              # facoltativo: tasti "Riscalda prima di rientrare", "Boost" e "Super boost"
exclude:                        # facoltativo
  - climate.termo_bagno
```

Una tessera per stanza (temperatura del termometro e, in piccolo, della valvola e l'offset, obiettivo o "spento", ventola se impostata nella stanza), quanti
sono accesi, le ventole accese e la media; sotto, i prossimi cambi di tutte le stanze raggruppati per ora (fino a 4
orari). Lo sfondo si scalda quando un termosifone riscalda.

Al tocco: una stanza apre il popup della `heating-radiator-card` (grafico, modi, temperatura), i programmi
aprono la `heating-planner-card` e la barra della quota la `tado-quota-card`, entrambe in un popup.

Il tasto di spegnimento nell'intestazione (e nel popup dei programmi) spegne tutti i termosifoni con
`button.hp_all_turn_off`: al primo tocco chiede conferma ("Spegni tutti?"), il secondo entro 3 secondi spegne.
E' disattivato quando sono gia' tutti spenti.

In fondo, i tasti **Riscalda prima di rientrare** (`button.hp_all_preheat`) e **Boost** (`button.hp_all_boost`) con
l'ultima attivazione ("2 ore fa"); con il boost in corso il tasto e' arancione e mostra "fino alle …".
Un tocco preme il pulsante; sul boost (o super boost) in corso lo **ferma** (servizio `tado_heating_manager.stop_boost`:
termosifoni e condizionatori tornano com'erano prima della partenza). Da spenti i tasti hanno il fondo neutro, colorata solo l'icona. **Super boost** (`button.hp_all_super_boost`, integrazione aggiornata al 2026-11-22 o successiva) compare solo
se nelle opzioni dell'integrazione sono scelti i condizionatori; i tasti stanno tutti su una riga, ognuno col suo colore ("Preriscalda" = Riscalda prima di rientrare, verde acqua; Boost arancione, Super boost viola).

```yaml
type: custom:heating-summary-editable-card
columns: 2                      # facoltativo: 2 (predefinito) o 3; stesse opzioni di heating-summary-card
```

Come `heating-summary-card`, ma ogni riquadro ha su una riga −/+ (passi di 0,5 °C, 5–25 °C) e un tasto con la modalità
attuale, che apre la tendina Caldo / Auto / Spento; il resto del riquadro apre il popup del termosifone. I tocchi su −/+ si sommano e partono con una sola chiamata
dopo circa un secondo di pausa (il valore scelto resta colorato finché HA non lo conferma). Da spento, −/+ parte dalla
temperatura della stanza e accende. Con 3 colonne l'obiettivo va sotto la temperatura e i tasti −/+ ai lati.

```yaml
type: custom:heating-ac-card
entity: climate.condizionatore_cucina   # obbligatorio
name: Cucina                            # facoltativo
layout: tile                            # facoltativo: blocco invece della riga
temp_termometro: sensor.xxx             # facoltativo: temperatura ambiente (T:)
fan: switch.ventola                     # facoltativo: ventilatore separato
door: binary_sensor.porta               # facoltativo
```

Stesse funzioni di `heating-radiator-card`: riga o blocco (`layout: tile`), editor visuale, menu della modalità sul
tasto della modalità e menu dell'oscillazione sul suo tasto, −/+ con il passo e i limiti del climatizzatore, umidità se
il climate la espone, ventola come icona accanto al nome. Bordo colorato attenuato quando la modalità è attiva, pieno e
con sfondo quando lavora (`hvac_action`). Un tocco apre il popup con modalità, velocità (`fan_modes`), oscillazione,
ventola, porta e grafico (temperatura, target e bande di raffreddamento/riscaldamento); la pressione lunga sui tasti apre
i dettagli. Da spento il target resta visibile attenuato (o "Spento" se il climate non lo conserva) e −/+ cambiano solo
il target, senza accendere. Se il climatizzatore è il `climate` di una stanza di Tado Heating Manager, nome, termometro
e ventola lasciati vuoti si prendono dalla stanza.

`heating-acs-card` mette una `heating-ac-card` per ogni climatizzatore, come `heating-radiators-card` per i termosifoni.
Senza `entities` li trova da soli: i climate con modalità freddo, deumidifica o ventola (i termosifoni Tado no), non
nascosti, in ordine di nome.

```yaml
type: custom:heating-acs-card
layout: tile                      # facoltativo: blocchi affiancati invece delle righe
columns: 3                        # facoltativo, solo con layout: tile: blocchi per riga (2 o 3; predefinito: automatico)
entities:                         # facoltativo: solo questi, in quest'ordine
  - climate.condizionatore_cucina
order:                            # facoltativo: questi per primi, in quest'ordine (gli altri per nome)
  - climate.condizionatore_camera
exclude:                          # facoltativo: climatizzatori da non mostrare
  - climate.condizionatore_camera
names:                            # facoltativo: nome mostrato solo in questa card
  - entity: climate.condizionatore_cucina
    name: Cucina
```

`heating-usage-card` mostra per ogni stanza di Tado Heating Manager la temperatura e le ore in riscaldamento (arancio)
e con la valvola chiusa (blu), con la quota di tempo in riscaldamento sul tempo acceso. Le ore si calcolano dallo
storico di Home Assistant (attributo `hvac_action` del climate della stanza), senza sensori da creare: arrivano fin dove
arriva il recorder (`purge_keep_days`). I giorni chiusi si leggono una volta e restano nella cache del browser; oggi si
rilegge ogni 5 minuti. "7 gg" e "30 gg" sono oggi più i 6 o 29 giorni prima. Toccando l'icona si apre il termostato,
toccando il nome il suo storico.

```yaml
type: custom:heating-usage-card
title: Termosifoni                # facoltativo ("" = senza titolo)
periods: [today, yesterday, 7d]   # facoltativo: today, yesterday, 7d, 30d
order:                            # facoltativo: questi per primi
  - climate.termo_soggiorno
exclude:                          # facoltativo: stanze da non mostrare
  - climate.termo_cameretta
names:                            # facoltativo: nome mostrato solo in questa card
  - entity: climate.termo_camera_da_letto
    name: Camera
```

```yaml
type: custom:tado-quota-card
title: Quota API Tado     # facoltativo
hours_to_show: 48         # facoltativo: ore del grafico (0 = niente grafico)
entities:                 # facoltativo: solo per forzare entita' diverse da quelle trovate in automatico
  quota_status: sensor.xxx
```

La card della quota trova da sola i sensori di Tado Heating Manager (qualunque sia il loro entity_id). Chiavi per
`entities`: `quota_status`, `quota_percent`, `quota_used`, `quota_remaining`, `quota_limit`, `quota_reset`,
`quota_minutes_to_reset`, `tado_ce_tracked`, `tado_ce_untracked`, `api_calls_today`, `tado_ce_offset_services`, `unexplained_calls`. Toccando una riga si apre il
dettaglio dell'entita'.

Le card leggono le entita' dell'integrazione (`sensor.hp_all_rooms`, `switch.hp_<stanza>_enabled`, `sensor.hp_<stanza>_plan`, …)
e chiamano i servizi `tado_heating_manager.set_slots` e `tado_heating_manager.set_room_order`.

Se compare "Custom element doesn't exist": la risorsa non e' caricata. Apri l'URL della risorsa nel browser: deve mostrare il codice.

## Licenza

© 2026 ilbagatta — GNU General Public License v3.0 (vedi `LICENSE`).
Puoi usare, modificare e ridistribuire il codice; le versioni modificate distribuite devono restare GPL-3.0 con il codice sorgente pubblico.
