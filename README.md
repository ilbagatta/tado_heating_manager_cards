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
| `custom:heating-radiator-card` | Riga di un termosifone (modo, temperatura, offset, popup con grafico) |
| `custom:heating-ac-card` | Riga di un climatizzatore |
| `custom:tado-quota-card` | Quota API Tado: stato, indicatori, provenienza delle chiamate, grafico |

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
   - URL: `/local/tado-heating-manager-cards.js?v=2.3.2`
   - Tipo: **Modulo JavaScript**

   (Se il menu Risorse non si vede: attiva la *Modalita' avanzata* nel profilo utente.)
3. Ricarica la pagina.

Una volta sola: le dashboard che usano gia' `custom:heating-planner-card`, `heating-radiator-card` e `heating-ac-card`
continuano a funzionare con la stessa configurazione.

## Aggiornare

- **HACS**: quando esce una nuova release HACS la propone; aggiorna e ricarica la dashboard.
- **Script** (sviluppo, con l'add-on SSH): `tools/deploy.sh <host>` copia il file e aggiorna da solo `?v=` della risorsa;
  poi basta ricaricare la dashboard.
- **Manuale**: sostituisci il file in `/config/www/`, poi alza `?v=` nella risorsa (es. `?v=2.0.2`) **oppure** ricarica la
  pagina con la cache svuotata (Ctrl+F5; nell'app: Impostazioni app → Debug → Reset frontend cache).

Nella console del browser compare `TADO-HEATING-MANAGER-CARDS <versione>`: serve a controllare quale versione e' caricata.

## Configurazione

```yaml
type: custom:heating-planner-card
title: Riscaldamento        # facoltativo
```

```yaml
type: custom:heating-radiator-card
entity: climate.termo_soggiorno   # obbligatorio
name: Soggiorno                   # facoltativo
temp_termometro: sensor.xxx       # facoltativo: temperatura ambiente (T:)
temp_valvola: sensor.zzz          # facoltativo: temperatura della valvola (V:)
offset_prioritario: sensor.kkk    # facoltativo: se manca, l'"Offset gestito" della stanza con questo termostato
offset_sensor: sensor.yyy         # facoltativo
fan: switch.ventola               # facoltativo
door: binary_sensor.porta         # facoltativo
```

```yaml
type: custom:heating-ac-card
entity: climate.condizionatore_cucina   # obbligatorio
name: Cucina                            # facoltativo
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
`quota_minutes_to_reset`, `tado_ce_tracked`, `api_calls_today`, `unexplained_calls`. Toccando una riga si apre il
dettaglio dell'entita'.

Le card leggono le entita' dell'integrazione (`sensor.hp_all_rooms`, `switch.hp_<stanza>_enabled`, `sensor.hp_<stanza>_plan`, …)
e chiamano i servizi `tado_heating_manager.set_slots` e `tado_heating_manager.set_room_order`.

Se compare "Custom element doesn't exist": la risorsa non e' caricata. Apri l'URL della risorsa nel browser: deve mostrare il codice.

## Licenza

MIT
