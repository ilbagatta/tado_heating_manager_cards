# AGENTS.md — Tado Heating Manager Cards

Card Lovelace dell'integrazione Tado Heating Manager (progetto `../tado_heating_manager`). Lingua: **italiano**.

## Struttura

```
dist/tado-heating-manager-cards.js   unico file servito (HACS "Dashboard" o /config/www)
hacs.json                            filename = tado-heating-manager-cards.js
tools/deploy.sh, bump_resource.py    deploy manuale con aggiornamento automatico di ?v=
```

Il file contiene quattro card, ognuna dentro un blocco `{ ... }` (le costanti non si scontrano):
`heating-planner-card` (HP_*), `heating-radiator-card` (HR_*), `heating-ac-card` (AC_*), `tado-quota-card` (TQ_*).
La card della quota trova i sensori da `hass.entities` (platform `tado_heating_manager` + `translation_key`, cioe' le
chiavi di `HUB_KEYS`), poi ripiega sui nomi storici `sensor.system_tado_offset_manager_*`; il grafico usa la
`history-graph` di HA (`loadCardHelpers`). Prova veloce senza HA: Chrome headless con una pagina che carica il file e
passa un `hass` finto (`states` + `entities`).

## Regole

- Web component in JS puro, **nessuna dipendenza e nessuna build**. Nell'ambiente non c'e' Node: rileggi il JS con attenzione.
- A ogni modifica alza `THM_CARDS_VERSION` in cima al file e la versione negli esempi del README.
- Le card di riga usano `getGridOptions() { return { columns: "full" }; }` senza fissare `rows`.
- Stile uguale tra termosifoni e climatizzatori (cerchi 38px, riga 68px, bordo colorato per modo, animazioni).
- Contratto con l'integrazione (non cambiarlo senza cambiare anche `../tado_heating_manager`):
  `sensor.hp_all_rooms` (attributo `rooms`: slug, name, climate, offset_entity...), `switch.hp_all_enabled`,
  `switch.hp_<slug>_enabled`, `sensor.hp_<slug>_current`, `sensor.hp_<slug>_plan` (attributi `wd`/`we`),
  servizi `tado_heating_manager.set_slots` e `set_room_order`.
- Nomi degli elementi invariati rispetto a Heating Planner: le dashboard esistenti non vanno toccate.

## Pubblicazione (GitHub + HACS)

Repository pubblico `ilbagatta/tado_heating_manager_cards` (tipo HACS "Dashboard": `hacs.json` + `dist/`).
Per una nuova versione: alza `THM_CARDS_VERSION`, commit, tag `v<versione>` e release GitHub
(`gh release create v<versione> --generate-notes`): HACS propone l'aggiornamento solo con una nuova release.
Niente dati delle installazioni reali nel repository (host, IP, entita' personali).

## Deploy

`tools/deploy.sh <host>` (chiedi conferma all'utente prima di scrivere): copia `dist/tado-heating-manager-cards.js` in
`/config/www/` e con `tools/bump_resource.py` (eseguito sul server, WebSocket del Supervisor, solo libreria standard) porta
la risorsa Lovelace a `?v=<THM_CARDS_VERSION>` (la crea se manca). Non serve riavviare HA: basta un refresh normale.
