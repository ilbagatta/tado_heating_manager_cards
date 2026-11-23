# AGENTS.md — Tado Heating Manager Cards

Card Lovelace dell'integrazione Tado Heating Manager (progetto `../tado_heating_manager`). Lingua: **italiano**.

## Struttura

```
dist/tado-heating-manager-cards.js   unico file servito (HACS "Dashboard" o /config/www)
hacs.json                            filename = tado-heating-manager-cards.js
tools/bump_resource.py               aggiorna ?v= della risorsa Lovelace (installazione manuale)
```

Il file contiene nove card, ognuna dentro un blocco `{ ... }` (le costanti non si scontrano):
`heating-planner-card` (HP_*), `heating-radiator-card` (HR_*), `heating-radiators-card` (una `heating-radiator-card`
per stanza di `sensor.hp_all_rooms`; entrambe con `layout: tile` = blocchi come le tessere del riepilogo, `_buildTile`/`_updateTile`, griglia `columns: 4`; `heating-radiators-card` ha `columns: 2|3` per i blocchi, predefinito automatico), `heating-summary-card` (HS_*, riepilogo per la Home: tessere delle stanze,
prossimo cambio, quota trovata come nella card della quota; dalla 2.16.0 niente `navigation_path`: tocco su una stanza = popup di una `heating-radiator-card` nascosta nella card (`_rads`, cosi' il more-info arriva a HA), su programmi/quota = popup generico (`_openPop`) con `heating-planner-card`/`tado-quota-card`, more-info rimandato dalla summary; `columns: 2|3` per le tessere, predefinito 3, 2.17.0; tasto "spegni tutti" `show_turn_off` = `button.hp_all_turn_off` con conferma in due tocchi, anche nel popup dei programmi, 2.18.0; tasti `show_actions` = `button.hp_all_preheat`/`hp_all_boost` con ultima pressione (stato del pulsante, `hsAgo`, ridisegno ogni minuto) e boost in corso da `binary_sensor.hp_all_boost_active` (`until`, `super`), 2.21.0; `button.hp_all_super_boost` se ha `climates`, 2.22.0; dalla 2.23.0 tutti su una riga, colore per tasto `--c`, etichetta corta `short`; 2.24.0: fondo neutro da spenti, tocco sul tasto acceso = servizio `stop_boost`; 2.25.0: icona animata da acceso, classe `a-<anim>`; 2.26.0: tasto in basso a destra (`.fliprow`/`data-flip`, solo se `button.hp_all_boost` ha l'attributo `rooms`) che gira la card (`_flip`: Web Animations + timer, `cancel()` di sicurezza; `ha-card.flipped`) sul retro `_renderBack`: caselle `data-pick` per stanze del boost, del super boost e condizionatori (stessa scelta di `_ac_options` dell'integrazione), ogni tocco = servizio `set_boost_targets`, scelta tenuta in `_pick` finche' HA la conferma o 10 s; righe −/+ delle temperature (`HS_TEMPS`: campo del servizio → attributo del pulsante e limiti; `_tpend`, una chiamata dopo 900 ms di pausa); Preriscalda non ha stato attivo, l'utente lo vuole cosi'), `heating-summary-editable-card` (2.19.0: sottoclasse di HeatingSummaryCard nello stesso blocco, allunga `_tileHtml` con una riga −/+ e tasto della modalita' (2.20.0: tendina `_toggleMenu` sul body, come quella della `heating-radiator-card`); tasti `data-act` presi in fase di cattura prima del tocco sul riquadro; −/+ in `_pend` con debounce `HSE_DEBOUNCE` 900 ms, una `set_temperature` (con `hvac_mode: heat` se era spento), valore tenuto finche' HA lo conferma o 10 s; `columns` predefinito 2, con 3 l'obiettivo va nel sottotitolo), `heating-ac-card` (AC_*), `heating-acs-card` (una `heating-ac-card` per climatizzatore: `entities` o, se vuoto, i climate con
`cool`/`dry`/`fan_only` non nascosti, per nome; `layout`, `columns`, `order`, `exclude`, `names` come `heating-radiators-card`;
lista, colonne e ordine (`order`: questi per primi, solo nella card) condivisi in `THM_LIST_CSS`/`THM_COLUMNS_SELECTOR`/`thmColumns`/`thmOrder`), `tado-quota-card` (TQ_*).
Editor visuale: `static getConfigForm()` (schema `ha-form` disegnato da HA, nessun elemento editor) su tutte.
`heating-radiator-card` usa `this._cfg` = config + valori presi dalla stanza con lo stesso climate
(`name`, `thermometer`, `valve_temperature`, `fan`; l'offset da `offset_entity`), ricalcolata a ogni `hass`.
`heating-ac-card` (2.10.0) ha la stessa struttura (riga/`layout: tile`, popup con grafico, menu, pressione lunga,
`this._cfg` da `name`/`thermometer`/`fan` della stanza) senza valvola e offset; in piu' oscillazione, velocita'
(`fan_modes`) e umidita'; ventola come icona accanto al nome (tre tasti tondi non stanno a 358 px).
Senza stanze: pulsante "Aggiungi le stanze" (`thmOpenConfig`, `pushState` + `location-changed`) nel planner e in
`heating-radiators-card`; planner senza fasce in nessuna stanza: si apre su "Tutti (modifica)".
La card della quota trova i sensori da `hass.entities` (platform `tado_heating_manager` + `translation_key`, cioe' le
chiavi di `HUB_KEYS`), poi ripiega sui nomi storici `sensor.system_tado_offset_manager_*`; le sottovoci delle fonti (Tado CE, controlli extra) sono chiudibili (freccia, stato in `_open`); la barra "Utilizzo chiamate" sta in fondo, grafico storico tolto nella 2.14.0. Prova veloce senza HA: Chrome headless con una pagina che carica il file e
passa un `hass` finto (`states` + `entities`), con `ha-card`/`ha-icon` finti definiti prima e un contenitore largo
358 px per simulare lo smartphone (la finestra headless non scende sotto ~500 px).

## Regole

- Web component in JS puro, **nessuna dipendenza e nessuna build**. Nell'ambiente non c'e' Node: rileggi il JS con attenzione.
- A ogni modifica alza `THM_CARDS_VERSION` in cima al file e la versione negli esempi del README.
- Le card di riga usano `getGridOptions() { return { columns: "full" }; }` senza fissare `rows`.
- Stile uguale tra termosifoni e climatizzatori (cerchi 38px, riga 68px, bordo colorato per modo, animazioni).
- Contratto con l'integrazione (non cambiarlo senza cambiare anche `../tado_heating_manager`):
  `button.hp_all_preheat`/`hp_all_boost` (attributi `rooms`, `temperature`)/`hp_all_super_boost` (attributi `climates`, `rooms`, `temperature`, `ac_temperature`, `ac_temperature_after`), servizi `stop_boost` e `set_boost_targets`, `binary_sensor.hp_all_boost_active` (`until`, `super`),
  `sensor.hp_all_rooms` (attributo `rooms`: slug, name, climate, fan, offset_entity, thermometer, valve, valve_temperature), `switch.hp_all_enabled`,
  `switch.hp_<slug>_enabled`, `sensor.hp_<slug>_current`, `sensor.hp_<slug>_plan` (attributi `wd`/`we`),
  servizi `tado_heating_manager.set_slots` e `set_room_order`.
  Card della quota: sensori per `translation_key` (`tado_ce_tracked` con `by_type`, `tado_ce_untracked` con il dettaglio
  per categoria, `api_calls_today`, `tado_ce_offset_services`, `unexplained_calls` con `tado_ce_offset_sync_zones`).
- Nomi degli elementi invariati rispetto a Heating Planner: le dashboard esistenti non vanno toccate.

## Pubblicazione (GitHub + HACS)

Repository pubblico `ilbagatta/tado_heating_manager_cards` (tipo HACS "Dashboard": `hacs.json` + `dist/`).
Per una nuova versione: alza `THM_CARDS_VERSION`, commit, tag `v<versione>` e release GitHub
(`gh release create v<versione> --title v<versione> --notes "<frase breve della modifica>\n\n[Modifiche](https://github.com/ilbagatta/tado_heating_manager_cards/compare/v<precedente>...v<versione>)"`;
mai `--generate-notes`: l'utente vuole solo una breve descrizione e al massimo il link): HACS propone l'aggiornamento solo con una nuova release.
Niente dati delle installazioni reali nel repository (host, IP, entita' personali).

## Deploy

Le installazioni dell'utente usano le card da **HACS**: si aggiornano solo con una nuova release (sopra).
`tools/bump_resource.py` (installazione manuale, eseguito sul server con
`ssh root@<host> python3 - <versione> < tools/bump_resource.py`; chiedi conferma prima di scrivere) porta la risorsa
Lovelace a `?v=<versione>` (la crea se manca).

## heating-usage-card (2.15.0)

Ore per stanza (stanze da `sensor.hp_all_rooms`) calcolate dallo storico: `history/history_during_period` sul climate,
stato contato = `hvac_action` o lo stato (heating/idle/off; il resto non conta). Una richiesta per ogni giorno chiuso
mancante (condivisa fra le card, `HU_INFLIGHT`), totali in secondi nella cache `localStorage` `thm-usage-v1`
(`climate|AAAA-MM-GG`, tenuti 40 giorni); oggi riletto ogni 5 minuti e allungato con lo stato attuale; ridisegno ogni minuto.
Giorni = mezzanotte locale del browser. Sostituisce la scheda markdown basata sul package `termosifoni_ore_stato.yaml`
dell'utente e, per ora, l'idea del sensore delle ore nell'integrazione (vedi sotto).

## Card rimandate

`heating-hours-card` (ore dei termosifoni oggi/7/30 giorni, pensata per lo smartphone) e' stata pubblicata in 2.2.0 e
tolta in 2.3.0 (leggeva i sensori `*_riepilogo_ore` del package); sostituita da `heating-usage-card` (2.15.0), che non ha bisogno di sensori. Il codice e' nel commit
0c474ea (`git show 0c474ea:dist/tado-heating-manager-cards.js`, blocco `heating-hours-card.js`).
