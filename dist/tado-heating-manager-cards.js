/* Tado Heating Manager Cards
 * Card Lovelace per l'integrazione Tado Heating Manager (custom_components/tado_heating_manager).
 * Un solo file con sei card, senza dipendenze e senza build:
 *   custom:heating-planner-card    programmi a fasce di tutte le stanze (Feriali / Weekend)
 *   custom:heating-radiator-card   riga di un termosifone
 *   custom:heating-radiators-card  una riga per ogni termosifone di Tado Heating Manager
 *   custom:heating-summary-card    riepilogo per la Home (termosifoni, programmi, quota); al tocco apre la plancia
 *   custom:heating-ac-card         riga di un climatizzatore
 *   custom:tado-quota-card         quota API Tado (stato, indicatori, provenienza delle chiamate, grafico)
 * Ogni card e' racchiusa in un blocco { } cosi' le costanti non si scontrano.
 *
 * © 2026 ilbagatta — SPDX-License-Identifier: GPL-3.0-or-later
 * https://github.com/ilbagatta/tado_heating_manager_cards
 */
const THM_CARDS_VERSION = "2.8.1";
// Pagina dell'integrazione (per aggiungere le stanze): navigazione interna del frontend di HA.
const THM_CONFIG_PATH = "/config/integrations/integration/tado_heating_manager";
const thmOpenConfig = () => {
  window.history.pushState(null, "", THM_CONFIG_PATH);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
};
const THM_EMPTY_BTN =
  '<button class="thm-cfg" style="margin-top:10px;padding:8px 14px;border-radius:8px;border:1px solid var(--primary-color);background:none;color:var(--primary-color);cursor:pointer;font-size:.95em">Aggiungi le stanze</button>';
console.info(`%c TADO-HEATING-MANAGER-CARDS %c ${THM_CARDS_VERSION} `, "color:#fff;background:#ff8a3d;font-weight:600", "color:#ff8a3d");

// ===== heating-planner-card.js =====
{
  /* Heating Planner card: tutte le stanze in una schermata, tab Feriali / Weekend.
   * Uso:  type: custom:heating-planner-card   (opzionale: title: "Riscaldamento")
   */
  const HP_MAX = 12;
  const HP_KINDS = { wd: "Feriali", we: "Weekend" };

  const hpEsc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  class HeatingPlannerCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._kind = null;
      this._room = "summary"; // summary = riepilogo (sola lettura) | all = tutte le stanze | <slug> = una stanza
      this._orderMode = false;
      this._sig = "";
      this._pending = false;
      this._collapsed = null; // letto da localStorage al primo render
      this.shadowRoot.addEventListener("focusout", () => {
        setTimeout(() => {
          if (this._pending && !this._editing()) {
            this._pending = false;
            this._render();
          }
        }, 150);
      });
    }

    setConfig(config) {
      this._config = config || {};
    }

    getCardSize() {
      return 12;
    }

    static getStubConfig() {
      return {};
    }

    static getConfigForm() {
      return {
        schema: [{ name: "title", selector: { text: {} } }],
        computeLabel: (s) => (s.name === "title" ? "Titolo" : s.name),
        computeHelper: (s) => (s.name === "title" ? "Vuoto: Riscaldamento." : undefined),
      };
    }

    set hass(hass) {
      this._hass = hass;
      const sig = this._signature();
      if (sig === this._sig) return;
      if (this._editing()) {
        this._pending = true;
        return;
      }
      this._sig = sig;
      this._render();
    }

    _editing() {
      const a = this.shadowRoot.activeElement;
      return !!a && (a.tagName === "INPUT" || a.tagName === "SELECT");
    }

    _rooms() {
      const st = this._hass && this._hass.states["sensor.hp_all_rooms"];
      return st && st.attributes.rooms ? st.attributes.rooms : [];
    }

    _state(id) {
      return this._hass.states[id];
    }

    _signature() {
      if (!this._hass) return "";
      const parts = [];
      const hub = this._state("switch.hp_all_enabled");
      parts.push(hub ? hub.state : "?");
      for (const r of this._rooms()) {
        parts.push(r.slug, r.name);
        for (const id of [`switch.hp_${r.slug}_enabled`, `sensor.hp_${r.slug}_current`]) {
          const s = this._state(id);
          parts.push(s ? s.state + (s.attributes.next_change || "") + (s.attributes.slot ?? "") : "-");
        }
        const plan = this._state(`sensor.hp_${r.slug}_plan`);
        parts.push(plan ? JSON.stringify([plan.attributes.wd, plan.attributes.we]) : "-");
      }
      return parts.join("|") + "|" + (this._kind || "") + "|" + this._orderMode + "|" + this._room;
    }

    _defaultKind() {
      for (const r of this._rooms()) {
        const s = this._state(`sensor.hp_${r.slug}_current`);
        if (s && s.attributes.kind) return s.attributes.kind;
      }
      return "wd";
    }

    _call(domain, service, data) {
      this._hass.callService(domain, service, data);
    }

    _fmtNext(s) {
      if (!s || !s.attributes.next_change) return "";
      const d = new Date(s.attributes.next_change);
      const days = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      const hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      return `poi ${s.attributes.next_value} alle ${hh}${sameDay ? "" : " (" + days[d.getDay()] + ")"}`;
    }

    _hhmm(minutes) {
      minutes = ((minutes % 1440) + 1440) % 1440;
      return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
    }

    _commit(roomEl, slug, op = {}) {
      let slots = [...roomEl.querySelectorAll(".slot")].map((row) => {
        const val = (f) => row.querySelector(`[data-f="${f}"]`).value;
        const t = Math.min(25, Math.max(5, parseFloat(val("temp"))));
        return [val("start"), val("end"), Number.isNaN(t) ? 18 : t, row.querySelector('[data-f="home"]').checked];
      });
      if (op.del !== undefined) slots.splice(op.del, 1);
      if (op.add) {
        const last = slots.length ? slots[slots.length - 1][1] : "07:00";
        const [h, m] = (last || "07:00").split(":").map(Number);
        const start = this._hhmm(h * 60 + m);
        slots.push([start, this._hhmm(h * 60 + m + 60), 18, true]);
      }
      slots = slots.filter((x) => x[0] && x[1]);
      this._call("tado_heating_manager", "set_slots", { room: slug, kind: this._kind, slots });
    }

    _render() {
      if (!this._hass) return;
      if (!this._kind) this._kind = this._defaultKind();
      const allRooms = this._rooms();
      // nessuna fascia in nessuna stanza (installazione nuova): il riepilogo sarebbe vuoto, si apre la modifica
      if (!this._roomChosen && this._room === "summary" && allRooms.length && !allRooms.some((r) => {
        const plan = this._state(`sensor.hp_${r.slug}_plan`);
        return plan && ((plan.attributes.wd || []).length || (plan.attributes.we || []).length);
      })) this._room = "all";
      if (this._room !== "summary" && this._room !== "all" && !allRooms.some((r) => r.slug === this._room)) this._room = "summary";
      const summary = this._room === "summary";
      const single = !summary && this._room !== "all";
      if (summary || single) this._orderMode = false;
      const rooms = single ? allRooms.filter((r) => r.slug === this._room) : allRooms;
      const title = this._config.title || "Riscaldamento";
      const colKey = `thm-planner-collapsed:${title}`;
      if (this._collapsed === null) {
        try { this._collapsed = localStorage.getItem(colKey) === "1"; } catch (e) { this._collapsed = false; }
      }
      const collapsed = this._collapsed;
      const hub = this._state("switch.hp_all_enabled");
      const hubOn = hub && hub.state === "on";
      const k = this._kind;

      const roomHtml = rooms
        .map((r) => {
          const cur = this._state(`sensor.hp_${r.slug}_current`);
          const en = this._state(`switch.hp_${r.slug}_enabled`);
          const enOn = en && en.state === "on";
          const curSlot = cur && cur.attributes.kind === k ? cur.attributes.slot : null;
          const plan = this._state(`sensor.hp_${r.slug}_plan`);
          const slots = plan && plan.attributes[k] ? plan.attributes[k] : [];
          const rows = slots.map(
            ([start, end, temp, home], i) => `
              <div class="slot ${curSlot === i ? "active" : ""}" data-idx="${i}">
                <span class="n">${i + 1}</span>
                <input type="time" value="${start}" data-f="start" aria-label="dalle">
                <span class="arrow">&rarr;</span>
                <input type="time" value="${end}" data-f="end" aria-label="alle">
                <input type="number" class="temp" min="5" max="25" step="0.5" value="${Number(temp)}" data-f="temp" aria-label="temperatura">
                <span class="deg">&deg;C</span>
                <label class="home" title="Solo se qualcuno è in casa">
                  <input type="checkbox" data-f="home" ${home === false ? "" : "checked"}>
                  <ha-icon icon="mdi:home-account"></ha-icon>
                </label>
                <button class="clear" title="Elimina fascia" data-del="${i}">&#10005;</button>
              </div>`
          );
          if (!rows.length) rows.push('<div class="none">Nessuna fascia: sempre spento</div>');
          if (slots.length < HP_MAX) {
            rows.push('<button class="add" data-add="1">+ Aggiungi fascia</button>');
          }
          return `
            <div class="room ${enOn ? "" : "off"}" data-room="${r.slug}">
              <div class="room-head">
                <div>
                  <div class="room-name">${hpEsc(r.name)}</div>
                  <div class="room-now">${cur ? hpEsc(cur.state) : ""} <span class="next">${enOn ? hpEsc(this._fmtNext(cur)) : ""}</span></div>
                </div>
                ${
                  this._orderMode
                    ? `<div class="arrows"><button data-move="-1" data-slug="${r.slug}" ${rooms[0] === r ? "disabled" : ""} aria-label="Sposta su">&#9650;</button><button data-move="1" data-slug="${r.slug}" ${rooms[rooms.length - 1] === r ? "disabled" : ""} aria-label="Sposta giu">&#9660;</button></div>`
                    : `<label class="toggle" title="Programma attivo">
                  <input type="checkbox" data-switch="switch.hp_${r.slug}_enabled" ${enOn ? "checked" : ""}>
                  <span></span>
                </label>`
                }
              </div>
              ${rows.join("")}
            </div>`;
        })
        .join("");

      const summaryHtml = allRooms
        .map((r) => {
          const cur = this._state(`sensor.hp_${r.slug}_current`);
          const en = this._state(`switch.hp_${r.slug}_enabled`);
          const enOn = en && en.state === "on";
          const plan = this._state(`sensor.hp_${r.slug}_plan`);
          const kind = cur && cur.attributes.kind;
          const idx = cur ? cur.attributes.slot : null;
          const slot = plan && kind && idx !== null && idx !== undefined ? (plan.attributes[kind] || [])[idx] : null;
          const range = slot ? `${slot[0]} &rarr; ${slot[1]}` : "Fuori fascia";
          return `
            <div class="room sum ${enOn ? "" : "off"}">
              <div class="sum-l">
                <div class="room-name">${hpEsc(r.name)}</div>
                <div class="sum-sub">${enOn ? range : "Disattivato"}${enOn ? `<span class="next"> &middot; ${hpEsc(this._fmtNext(cur))}</span>` : ""}</div>
              </div>
              <div class="sum-temp">${cur ? hpEsc(cur.state) : "-"}</div>
            </div>`;
        })
        .join("");

      this.shadowRoot.innerHTML = `
        <style>
          .room.sum { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 12px; border-radius:10px; }
          .sum-l { min-width:0; }
          .sum-l .room-name { font-size:1em; line-height:1.2; }
          .sum-sub { font-size:.8em; line-height:1.3; color:var(--secondary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .sum-temp { font-size:1.2em; font-weight:600; white-space:nowrap; }
          .grid.compact { gap:6px; }
          :host { display:block; }
          ha-card { padding:12px; }
          .top { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; }
          .top.collapsed { margin-bottom:0; }
          .title { font-size:1.25em; font-weight:500; display:flex; align-items:center; gap:4px; cursor:pointer; user-select:none;
                   -webkit-tap-highlight-color:transparent; min-height:36px; }
          .title ha-icon { --mdc-icon-size:22px; color:var(--secondary-text-color); transition:transform .2s; }
          .top.collapsed .title ha-icon { transform:rotate(-90deg); }
          .selwrap { position:relative; margin-bottom:10px; }
          .selwrap ha-icon { position:absolute; right:12px; top:50%; transform:translateY(-50%); pointer-events:none;
                             color:var(--secondary-text-color); --mdc-icon-size:22px; }
          .roomsel { display:block; width:100%; box-sizing:border-box; min-height:46px; padding:10px 44px 10px 14px; border-radius:12px;
                     font-size:1em; line-height:1.4; font-family:inherit; cursor:pointer; -webkit-appearance:none; -moz-appearance:none; appearance:none;
                     border:1px solid var(--divider-color); background:var(--secondary-background-color, var(--card-background-color));
                     color:var(--primary-text-color); }
          .roomsel:focus { outline:none; border-color:var(--primary-color); }
          .tabs { display:flex; gap:6px; margin-bottom:10px; }
          .tab { flex:1; padding:10px; border-radius:10px; border:1px solid var(--divider-color); background:none;
                 color:var(--primary-text-color); font-size:1em; cursor:pointer; }
          .tab.sel { background:var(--primary-color); color:var(--text-primary-color, #fff); border-color:var(--primary-color); }
          .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:10px; }
          .room { border:1px solid var(--divider-color); border-radius:12px; padding:10px; }
          .room.off { opacity:.55; }
          .room-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
          .room-name { font-weight:600; font-size:1.05em; }
          .room-now { font-size:.85em; color:var(--secondary-text-color); }
          .next { opacity:.8; }
          .slot { display:flex; align-items:center; gap:6px; padding:4px 4px; border-radius:8px; }
          .slot.active { background:color-mix(in srgb, var(--primary-color) 18%, transparent); }
          .slot.unused { opacity:.45; }
          .n { width:16px; color:var(--secondary-text-color); font-size:.85em; text-align:center; }
          input[type=time], input.temp { background:var(--card-background-color); color:var(--primary-text-color);
                border:1px solid var(--divider-color); border-radius:8px; padding:6px 4px; font-size:1em; }
          input[type=time] { width:92px; }
          input.temp { width:60px; text-align:right; }
          .arrow, .deg { color:var(--secondary-text-color); }
          .clear { border:none; background:none; color:var(--secondary-text-color); cursor:pointer; font-size:1em; }
          .home { margin-left:auto; display:flex; align-items:center; gap:2px; font-size:.85em; color:var(--secondary-text-color); cursor:pointer; }
          .home ha-icon { --mdc-icon-size:18px; }
          .toggle { position:relative; display:inline-block; width:44px; height:24px; }
          .toggle input { opacity:0; width:0; height:0; }
          .toggle span { position:absolute; inset:0; background:var(--disabled-text-color, #999); border-radius:24px; transition:.2s; cursor:pointer; }
          .toggle span:before { content:""; position:absolute; height:18px; width:18px; left:3px; top:3px; background:#fff; border-radius:50%; transition:.2s; }
          .toggle input:checked + span { background:var(--primary-color); }
          .toggle input:checked + span:before { transform:translateX(20px); }
          .none { padding:6px 4px; color:var(--secondary-text-color); font-size:.9em; }
          .add { margin:6px 0 0 22px; padding:6px 10px; border:1px dashed var(--divider-color); border-radius:8px; background:none; color:var(--primary-color); cursor:pointer; font-size:.9em; }
          .ord { margin-left:auto; margin-right:12px; padding:6px 12px; border-radius:8px; border:1px solid var(--divider-color); background:none; color:var(--primary-text-color); cursor:pointer; }
          .ord.sel { background:var(--primary-color); color:var(--text-primary-color, #fff); border-color:var(--primary-color); }
          .arrows { display:flex; gap:6px; }
          .arrows button { width:40px; height:36px; border-radius:8px; border:1px solid var(--divider-color); background:none; color:var(--primary-text-color); cursor:pointer; font-size:1em; }
          .arrows button:disabled { opacity:.3; cursor:default; }
          .empty { padding:16px; color:var(--secondary-text-color); }
        </style>
        <ha-card>
          <div class="top ${collapsed ? "collapsed" : ""}">
            <div class="title" role="button" tabindex="0" aria-expanded="${collapsed ? "false" : "true"}">${hpEsc(title)}<ha-icon icon="mdi:chevron-down"></ha-icon></div>
            ${summary || single || collapsed ? "" : `<button class="ord ${this._orderMode ? "sel" : ""}" data-order-toggle="1">${this._orderMode ? "Fatto" : "Ordina stanze"}</button>`}
            <label class="toggle" title="Tutti i programmi attivi">
              <input type="checkbox" data-switch="switch.hp_all_enabled" ${hubOn ? "checked" : ""}>
              <span></span>
            </label>
          </div>
          ${collapsed ? "" : `<div class="selwrap"><select class="roomsel" aria-label="Termosifone">
            <option value="summary" ${summary ? "selected" : ""}>Riepilogo (fasce attive)</option>
            <option value="all" ${this._room === "all" ? "selected" : ""}>Tutti (modifica)</option>
            ${allRooms.map((r) => `<option value="${hpEsc(r.slug)}" ${r.slug === this._room ? "selected" : ""}>${hpEsc(r.name)}</option>`).join("")}
          </select><ha-icon icon="mdi:chevron-down"></ha-icon></div>
          ${summary ? "" : `<div class="tabs">
            ${Object.entries(HP_KINDS)
              .map(([key, label]) => `<button class="tab ${key === k ? "sel" : ""}" data-kind="${key}">${label}</button>`)
              .join("")}
          </div>`}
          <div class="grid ${summary ? "compact" : ""}">${(summary ? summaryHtml : roomHtml) || `<div class="empty">Nessun termosifone configurato: aggiungi le stanze in Tado Heating Manager.<br>${THM_EMPTY_BTN}</div>`}</div>`}
        </ha-card>`;

      const root = this.shadowRoot;
      const cfgBtn = root.querySelector(".thm-cfg");
      if (cfgBtn) cfgBtn.addEventListener("click", thmOpenConfig);
      const titleEl = root.querySelector(".title");
      const toggleCollapse = () => {
        this._collapsed = !this._collapsed;
        try { localStorage.setItem(colKey, this._collapsed ? "1" : "0"); } catch (e) { /* storage non disponibile */ }
        if (this._collapsed) this._orderMode = false;
        this._sig = "";
        this._render();
      };
      titleEl.addEventListener("click", toggleCollapse);
      titleEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleCollapse(); }
      });
      const sel = root.querySelector(".roomsel");
      if (sel) {
        sel.addEventListener("change", () => {
          this._room = sel.value;
          this._roomChosen = true;
          // vista singola: apre il tipo di giorno di oggi (quello con la fascia attiva)
          const cur = this._room === "all" || this._room === "summary" ? null : this._state(`sensor.hp_${this._room}_current`);
          this._kind = (cur && cur.attributes.kind) || this._defaultKind();
          this._orderMode = false;
          this._sig = "";
          this._render();
        });
      }
      root.querySelectorAll(".tab").forEach((b) =>
        b.addEventListener("click", () => {
          this._kind = b.dataset.kind;
          this._sig = "";
          this._render();
        })
      );
      root.querySelectorAll("input[data-switch]").forEach((i) =>
        i.addEventListener("change", () => this._call("switch", i.checked ? "turn_on" : "turn_off", { entity_id: i.dataset.switch }))
      );
      const ordBtn = root.querySelector("button[data-order-toggle]");
      if (ordBtn) ordBtn.addEventListener("click", () => { this._orderMode = !this._orderMode; this._sig = ""; this._render(); });
      root.querySelectorAll("button[data-move]").forEach((b) =>
        b.addEventListener("click", () => {
          const order = this._rooms().map((r) => r.slug);
          const i = order.indexOf(b.dataset.slug);
          const j = i + Number(b.dataset.move);
          if (i < 0 || j < 0 || j >= order.length) return;
          [order[i], order[j]] = [order[j], order[i]];
          this._call("tado_heating_manager", "set_room_order", { order });
        })
      );
      root.querySelectorAll(".room").forEach((roomEl) => {
        const slug = roomEl.dataset.room;
        roomEl.querySelectorAll(".slot input").forEach((inp) => inp.addEventListener("change", () => this._commit(roomEl, slug)));
        roomEl.querySelectorAll("button[data-del]").forEach((b) =>
          b.addEventListener("click", () => this._commit(roomEl, slug, { del: Number(b.dataset.del) }))
        );
        const add = roomEl.querySelector("button[data-add]");
        if (add) add.addEventListener("click", () => this._commit(roomEl, slug, { add: true }));
      });
    }
  }

  if (!customElements.get("heating-planner-card")) {
    customElements.define("heating-planner-card", HeatingPlannerCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-planner-card",
    name: "Heating Planner",
    description: "Programmi di riscaldamento a fasce da ora a ora, feriali e weekend.",
  });
}

// ===== heating-radiator-card.js =====
{
  /* Heating Radiator card: riga compatta per un termosifone (sostituisce il button-card "termo_row").
   * Uso:
   *   type: custom:heating-radiator-card
   *   entity: climate.termo_soggiorno
   *   name: Soggiorno              # opzionale
   * I campi opzionali lasciati vuoti si prendono dalla stanza di Tado Heating Manager con lo stesso climate
   * (nome, termometro, temperatura della valvola, ventola, offset gestito). Configurabile anche dall'editor visuale.
   *   temp_termometro: sensor.xxx  # opzionale: temperatura ambiente (mostrata come T:)
   *   temp_valvola: sensor.zzz     # opzionale: temperatura della valvola (mostrata come V:)
   *   offset_prioritario: sensor.kkk # opzionale: offset mostrato con precedenza (se ha un valore numerico).
   *                                  Se manca, si usa da solo l'"Offset gestito" di Tado Heating Manager per questo termostato.
   *   offset_sensor: sensor.yyy    # opzionale: offset (se non e' nell'attributo offset_celsius)
   *   fan: switch.ventola          # opzionale: mostra il pulsante ventola
   *   door: binary_sensor.porta    # opzionale: porta/finestra aperta (nel popup)
   * Un tocco sul corpo della riga apre un popup con comandi, interruttori e grafico.
   * Non richiede button-card.
   */
  const HR_ORDER = ["heat", "auto", "off"];
  const HR_ACT = { heating: "Riscalda", idle: "Inattivo", off: "Spento" };
  const HR_GREEN = "#4caf50";
  const HR_ORANGE = "#ff8a3d";
  const HR_BLUE = "#4f78a8";
  const HR_VALVE = "#ba68c8";

  const HR_LABELS = {
    entity: "Termostato (climate)",
    name: "Nome",
    temp_termometro: "Termometro della stanza",
    temp_valvola: "Temperatura della valvola",
    fan: "Ventola",
    door: "Porta o finestra",
    offset_prioritario: "Offset mostrato (prioritario)",
    offset_sensor: "Offset di riserva",
  };
  const HR_HELPERS = {
    name: "Vuoto: nome della stanza in Tado Heating Manager.",
    temp_termometro: "Vuoto: il termometro configurato nella stanza.",
    temp_valvola: "Vuoto: il sensore della valvola HomeKit della stanza.",
    fan: "Vuoto: la ventola configurata nella stanza (se c'è).",
    offset_prioritario: "Vuoto: l'offset gestito da Tado Heating Manager.",
    offset_sensor: "Usato solo se il climate non ha l'attributo offset_celsius.",
  };

  const hrEsc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  class HeatingRadiatorCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._sig = "";
    }

    setConfig(config) {
      if (!config || !config.entity) throw new Error("Manca 'entity' (climate.*)");
      this._config = config;
      this._cfg = this._effective();
      this._sig = "";
      this._build();
    }

    // Stanza di Tado Heating Manager con questo climate (attributo rooms di sensor.hp_all_rooms).
    _room() {
      const st = this._hass && this._hass.states["sensor.hp_all_rooms"];
      const rooms = (st && st.attributes.rooms) || [];
      return rooms.find((r) => r.climate === this._config.entity);
    }

    // Configurazione effettiva: i campi lasciati vuoti si prendono dalla stanza dell'integrazione.
    _effective() {
      const room = (this._hass && this._room()) || {};
      const auto = {
        name: room.name,
        temp_termometro: room.thermometer,
        temp_valvola: room.valve_temperature,
        fan: room.fan,
      };
      const out = { ...this._config };
      Object.keys(auto).forEach((k) => {
        if (!out[k] && auto[k]) out[k] = auto[k];
      });
      return out;
    }

    getCardSize() {
      return 1;
    }

    getGridOptions() {
      return { columns: "full" };
    }

    static getStubConfig(hass) {
      const st = hass.states["sensor.hp_all_rooms"];
      const rooms = (st && st.attributes.rooms) || [];
      if (rooms.length) return { entity: rooms[0].climate };
      const e = Object.keys(hass.states).find((k) => k.startsWith("climate."));
      return { entity: e || "climate.example" };
    }

    // Editor visuale di HA (nessun elemento personalizzato: lo disegna HA dallo schema).
    static getConfigForm() {
      const sensor = { entity: { domain: "sensor" } };
      return {
        schema: [
          { name: "entity", required: true, selector: { entity: { domain: "climate" } } },
          { name: "name", selector: { text: {} } },
          {
            type: "expandable", name: "", title: "Altre entità (facoltative)", flatten: true,
            schema: [
              { name: "temp_termometro", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
              { name: "temp_valvola", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
              { name: "fan", selector: { entity: { domain: ["fan", "switch"] } } },
              { name: "door", selector: { entity: { domain: ["binary_sensor", "input_boolean", "switch"] } } },
              { name: "offset_prioritario", selector: sensor },
              { name: "offset_sensor", selector: sensor },
            ],
          },
        ],
        computeLabel: (s) => HR_LABELS[s.name] || s.name,
        computeHelper: (s) => HR_HELPERS[s.name],
      };
    }

    set hass(hass) {
      this._hass = hass;
      const eff = this._effective();
      if (JSON.stringify(eff) !== JSON.stringify(this._cfg)) {
        this._cfg = eff;
        this._sig = "";
      }
      const sig = this._signature();
      if (sig === this._sig) return;
      this._sig = sig;
      this._update();
    }

    _st(id) {
      return id && this._hass ? this._hass.states[id] : undefined;
    }

    _bad(s) {
      return !s || s.state === "unavailable" || s.state === "unknown";
    }

    // Offset gestito da Tado Heating Manager per questo termostato (dall'elenco delle stanze).
    _autoOffset() {
      const st = this._hass && this._hass.states["sensor.hp_all_rooms"];
      const rooms = (st && st.attributes.rooms) || [];
      const room = rooms.find((r) => r.climate === this._config.entity);
      return room && room.offset_entity ? room.offset_entity : undefined;
    }

    _offsetEntity() {
      return this._cfg.offset_prioritario || this._autoOffset();
    }

    _signature() {
      const c = this._cfg;
      const ids = [c.entity, c.temp_termometro, c.temp_valvola, this._offsetEntity(), c.offset_sensor, c.fan, c.door];
      return ids
        .map((id) => {
          const s = this._st(id);
          return s ? s.state + JSON.stringify(id === c.entity ? s.attributes : "") : "-";
        })
        .join("|");
    }

    _fire(type, entityId) {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
      );
    }

    _build() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; }
          ha-card {
            box-sizing: border-box; min-height: 68px; border-radius: 15px; padding: 10px 14px;
            box-shadow: none; overflow: hidden; cursor: pointer; color: var(--primary-text-color);
            display: grid; align-items: center; column-gap: 8px;
            grid-template-columns: 44px minmax(0, 1fr) auto auto auto;
            border: 2px solid transparent;
          }
          ha-card.noFan { grid-template-columns: 44px minmax(0, 1fr) auto auto; }
          ha-card.heating { background-image: linear-gradient(rgba(255,122,40,.24), rgba(255,122,40,.24)); }
          ha-card.auto { border-color: ${HR_GREEN}; }
          ha-card.hot { border-color: ${HR_ORANGE}; }
          ha-card.heat { border-color: rgba(255,138,61,.45); }
          .icon {
            width: 44px; height: 44px; border-radius: 50%; background: rgba(128,128,128,.22);
            display: flex; align-items: center; justify-content: center;
          }
          .info { min-width: 0; overflow: hidden; text-align: left; }
          .nrow { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
          .name { font-weight: 600; font-size: 15px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
          .off { font-size: 11px; opacity: .85; white-space: nowrap; flex: none; }
          .off:empty { display: none; }
          .line { margin-top: 3px; font-size: 11px; line-height: 1.2; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .line:empty { display: none; }
          .btn {
            width: 38px; height: 38px; border-radius: 50%; background: rgba(128,128,128,.22);
            display: flex; align-items: center; justify-content: center; cursor: pointer; justify-self: end;
            --mdc-icon-size: 20px;
          }
          .btn ha-icon { display: inline-block; transform-origin: 50% 90%; }
          .btn.fan ha-icon { transform-origin: 50% 50%; }
          .btn.flame.on ha-icon { animation: fiamma-flicker .9s ease-in-out infinite; }
          .btn.fan.on ha-icon { animation: ventola-spin 1s linear infinite; }
          .temp {
            height: 38px; border-radius: 14px; background: rgba(128,128,128,.22); justify-self: end;
            display: grid; grid-template-columns: 32px 44px 32px; align-items: center; padding: 0 4px;
          }
          .temp .v { font-size: 14px; font-weight: 500; text-align: center; }
          .temp .s {
            width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
            cursor: pointer; --mdc-icon-size: 18px; border-radius: 50%;
          }
          @keyframes fiamma-flicker {
            0%   { transform: scale(1, 1) rotate(0deg);        filter: brightness(1); }
            20%  { transform: scale(1.06, .94) rotate(-3deg);  filter: brightness(1.15); }
            40%  { transform: scale(.95, 1.08) rotate(2deg);   filter: brightness(.95); }
            60%  { transform: scale(1.05, .96) rotate(-2deg);  filter: brightness(1.2); }
            80%  { transform: scale(.97, 1.05) rotate(3deg);   filter: brightness(1); }
            100% { transform: scale(1, 1) rotate(0deg);        filter: brightness(1); }
          }
          @keyframes ventola-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        </style>
        <ha-card>
          <div class="icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><rect x="1.4" y="5.2" width="3" height="1.8" rx=".5"/><rect x="1.4" y="17" width="3" height="1.8" rx=".5"/><rect x="3.9" y="3.5" width="2.6" height="17" rx="1.3"/><rect x="7.3" y="3.5" width="2.6" height="17" rx="1.3"/><rect x="10.7" y="3.5" width="2.6" height="17" rx="1.3"/><rect x="14.1" y="3.5" width="2.6" height="17" rx="1.3"/><rect x="17.5" y="3.5" width="2.6" height="17" rx="1.3"/></svg></div>
          <div class="info"><div class="nrow"><div class="name"></div><div class="off"></div></div><div class="line"></div></div>
          <div class="btn flame" data-a="mode"><ha-icon icon="mdi:fire"></ha-icon></div>
          <div class="btn fan" data-a="fan"><ha-icon icon="mdi:fan"></ha-icon></div>
          <div class="temp">
            <div class="s" data-a="minus"><ha-icon icon="mdi:minus"></ha-icon></div>
            <div class="v"></div>
            <div class="s" data-a="plus"><ha-icon icon="mdi:plus"></ha-icon></div>
          </div>
        </ha-card>`;
      const $ = (q) => this.shadowRoot.querySelector(q);
      this._card = $("ha-card");
      this._el = {
        icon: $(".icon svg"),
        iconWrap: $(".icon"),
        name: $(".name"),
        line: $(".line"),
        off: $(".off"),
        flame: $(".btn.flame"),
        fan: $(".btn.fan"),
        fanIcon: $(".btn.fan ha-icon"),
        value: $(".temp .v"),
      };

      this._closeDialog();
      this._card.addEventListener("click", () => this._openDialog());
      this.shadowRoot.querySelectorAll("[data-a]").forEach((el) => {
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._action(el.dataset.a);
        });
        // pressione lunga sui pulsanti = dettagli
        let t;
        el.addEventListener("pointerdown", () => {
          t = setTimeout(() => {
            t = null;
            el._held = true;
            const id = el.dataset.a === "fan" ? this._cfg.fan : this._cfg.entity;
            this._fire("more-info", id);
          }, 500);
        });
        const clear = () => t && clearTimeout(t);
        el.addEventListener("pointerup", clear);
        el.addEventListener("pointerleave", clear);
        el.addEventListener("click", (ev) => {
          if (el._held) {
            el._held = false;
            ev.stopImmediatePropagation();
          }
        }, true);
      });
    }

    _action(a) {
      const c = this._st(this._cfg.entity);
      if (!c) return;
      const id = this._cfg.entity;
      if (a === "mode") {
        this._openModeMenu();
      } else if (a === "fan") {
        this._hass.callService("homeassistant", "toggle", { entity_id: this._cfg.fan });
      } else if (a === "minus" || a === "plus") {
        const base = Number(c.attributes.temperature ?? c.attributes.current_temperature ?? 20);
        const d = a === "plus" ? 0.5 : -0.5;
        const t = Math.min(25, Math.max(5, Math.round((base + d) * 2) / 2));
        this._hass.callService("climate", "set_temperature", { entity_id: id, temperature: t });
      }
    }

    // tendina per scegliere la modalita' (una sola chiamata a set_hvac_mode)
    _closeModeMenu() {
      if (this._menu) {
        this._menu.remove();
        this._menu = null;
      }
      if (this._menuOff) {
        this._menuOff();
        this._menuOff = null;
      }
    }

    _openModeMenu() {
      if (this._menu) return this._closeModeMenu();
      const c = this._st(this._cfg.entity);
      if (!c) return;
      const modes = c.attributes.hvac_modes;
      const avail = modes ? HR_ORDER.filter((m) => modes.includes(m)) : HR_ORDER;
      const label = { heat: "Caldo", auto: "Auto", off: "Spento" };
      const icon = { heat: "mdi:fire", auto: "mdi:calendar-clock", off: "mdi:power" };
      const color = { heat: HR_ORANGE, auto: HR_GREEN, off: "var(--primary-text-color)" };
      const r = this._el.flame.getBoundingClientRect();
      const m = document.createElement("div");
      m.style.cssText =
        "position:fixed;z-index:9999;min-width:150px;padding:6px;border-radius:14px;" +
        "background:var(--card-background-color,#fff);color:var(--primary-text-color);" +
        "box-shadow:0 6px 24px rgba(0,0,0,.35);font-family:var(--paper-font-body1_-_font-family,inherit);";
      m.innerHTML = avail
        .map(
          (k) =>
            `<div data-m="${k}" style="display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border-radius:10px;cursor:pointer;font-size:14px;` +
            `${c.state === k ? "background:rgba(128,128,128,.25);font-weight:600;" : ""}">` +
            `<ha-icon icon="${icon[k]}" style="--mdc-icon-size:20px;color:${color[k]}"></ha-icon>${label[k]}</div>`
        )
        .join("");
      document.body.appendChild(m);
      const w = m.offsetWidth;
      const h = m.offsetHeight;
      let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      m.style.left = left + "px";
      m.style.top = top + "px";
      m.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const t = ev.target.closest("[data-m]");
        if (!t) return;
        const mode = t.dataset.m;
        this._closeModeMenu();
        if (mode !== c.state) {
          this._hass.callService("climate", "set_hvac_mode", { entity_id: this._cfg.entity, hvac_mode: mode });
        }
      });
      const away = (ev) => {
        if (!ev.composedPath().includes(m)) this._closeModeMenu();
      };
      const key = (ev) => ev.key === "Escape" && this._closeModeMenu();
      const close = () => this._closeModeMenu();
      // listener registrati dopo il click corrente, per non chiudere subito la tendina
      setTimeout(() => {
        if (!this._menu) return;
        document.addEventListener("pointerdown", away, true);
        document.addEventListener("keydown", key);
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        this._menuOff = () => {
          document.removeEventListener("pointerdown", away, true);
          document.removeEventListener("keydown", key);
          window.removeEventListener("scroll", close, true);
          window.removeEventListener("resize", close);
        };
      }, 0);
      this._menu = m;
    }

    _update() {
      if (!this._el || !this._hass) return;
      const cfg = this._cfg;
      const c = this._st(cfg.entity);
      const e = this._el;
      const fmt = (v) => (v === undefined || v === null || isNaN(Number(v)) ? "--" : Number(v).toFixed(1));

      const heating = !!c && !["off", "unavailable", "unknown"].includes(c.state) && c.attributes.hvac_action === "heating";
      const cls = ["noFan"];
      if (cfg.fan) cls.length = 0;
      if (heating) cls.push("heating");
      if (c && c.state === "auto") cls.push("auto");
      else if (heating) cls.push("hot");
      else if (c && c.state === "heat") cls.push("heat");
      this._card.className = cls.join(" ");

      const color = c && c.state === "auto" ? HR_GREEN : c && c.state === "heat" ? HR_ORANGE : "var(--primary-text-color)";
      e.iconWrap.style.color = color;
      e.flame.style.color = color;
      const pm = c && c.state === "auto" ? HR_GREEN : c && c.state === "heat" ? HR_ORANGE : HR_BLUE;
      this.shadowRoot.querySelectorAll(".temp .s").forEach((x) => (x.style.color = pm));
      e.flame.classList.toggle("on", heating);

      const name = cfg.name || (c && c.attributes.friendly_name) || "";
      const ts = this._st(cfg.temp_termometro);
      const temp = !this._bad(ts) && !isNaN(Number(ts.state)) ? ts.state : c && c.attributes.current_temperature;
      const vs = this._st(cfg.temp_valvola);
      const valv = !this._bad(vs) && !isNaN(Number(vs.state)) ? vs.state : undefined;
      let line;
      let offTxt = "";
      if (!c) line = "Entità non trovata";
      else if (c.state === "unavailable") line = "Non disponibile";
      else if (c.state === "unknown") line = "Stato sconosciuto";
      else {
        let off = "--";
        let ov;
        const prio = this._offsetEntity();
        if (prio) {
          const p = this._st(prio);
          if (!this._bad(p) && p.state !== "" && !isNaN(Number(p.state))) ov = p.state;
        }
        if (ov === undefined) ov = c.attributes.offset_celsius;
        if ((ov === undefined || ov === null) && cfg.offset_sensor) {
          const o = this._st(cfg.offset_sensor);
          if (!this._bad(o)) ov = o.state;
        }
        if (ov !== undefined && ov !== null && !isNaN(Number(ov))) {
          const n = Number(ov);
          off = (n > 0 ? "+" : "") + n.toFixed(1) + "°";
        }
        offTxt = off;
        // niente stato (Riscalda/Inattivo/Spento) sulla riga: lo dicono gia' icona e colore
        line = `T: ${fmt(temp)}°C`;
        if (cfg.temp_valvola) line += ` • V: ${fmt(valv)}°C`;
      }
      e.name.textContent = name;
      e.off.textContent = offTxt;
      e.line.textContent = line;

      if (cfg.fan) {
        const f = this._st(cfg.fan);
        const bad = this._bad(f);
        e.fan.style.display = "";
        e.fanIcon.setAttribute("icon", bad ? "mdi:fan-off" : "mdi:fan");
        e.fan.style.color = bad ? "var(--disabled-text-color)" : f.state === "on" ? "#29b6f6" : "var(--secondary-text-color)";
        e.fan.classList.toggle("on", !bad && f.state === "on");
      } else {
        e.fan.style.display = "none";
      }

      e.value.textContent = !c || this._bad(c) ? "--" : fmt(c.attributes.temperature);
      this._dlgUpdate();
    }

    disconnectedCallback() {
      this._closeModeMenu();
      this._closeDialog();
    }

    // ---- popup (alternativa al more-info) ----
    _openDialog() {
      if (this._dlg || !this._hass) return;
      const cfg = this._cfg;
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          .ov { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.55);
            display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
          .dlg { background: var(--card-background-color, #1c1c1c); color: var(--primary-text-color);
            border-radius: 20px; width: min(560px, 100%); max-height: 100%; overflow-y: auto;
            padding: 16px; box-sizing: border-box; font-family: var(--paper-font-body1_-_font-family, inherit); }
          .hd { display: flex; align-items: center; gap: 8px; }
          .hd .t { flex: 1; font-size: 18px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .x { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; }
          .x:hover, .chip:hover, .mode:hover, .rng:hover { background: rgba(128,128,128,.32); }
          .sub { font-size: 13px; opacity: .8; margin: 2px 0 12px; }
          .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
          .mode, .chip, .rng { height: 38px; padding: 0 14px; border-radius: 19px; background: rgba(128,128,128,.22);
            display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; --mdc-icon-size: 20px; user-select: none; }
          .mode.on, .rng.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
          .chip.ro { cursor: default; }
          .chip.active { background: rgba(41,182,246,.28); color: #29b6f6; }
          .chip.alert { background: rgba(255,138,61,.28); color: ${HR_ORANGE}; }
          .tset { margin-left: auto; height: 44px; border-radius: 16px; background: rgba(128,128,128,.22);
            display: grid; grid-template-columns: 44px 70px 44px; align-items: center; }
          .tset .v { text-align: center; font-size: 20px; font-weight: 600; }
          .tset .s { height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50%; }
          .graph { min-height: 160px; margin: 4px 0 8px; }
          .more { text-align: center; font-size: 12px; opacity: .7; cursor: pointer; padding: 6px; }
          .more:hover { opacity: 1; }
        </style>
        <div class="ov"><div class="dlg">
          <div class="hd"><div class="t"></div><div class="x" data-d="close"><ha-icon icon="mdi:close"></ha-icon></div></div>
          <div class="sub"></div>
          <div class="row modes"></div>
          <div class="row">
            <div class="chips" style="display:contents"></div>
            <div class="tset">
              <div class="s" data-d="minus"><ha-icon icon="mdi:minus"></ha-icon></div>
              <div class="v"></div>
              <div class="s" data-d="plus"><ha-icon icon="mdi:plus"></ha-icon></div>
            </div>
          </div>
          <div class="row ranges">
            <div class="rng" data-h="6">6 ore</div><div class="rng on" data-h="24">24 ore</div><div class="rng" data-h="168">7 giorni</div>
          </div>
          <div class="graph"></div>
          <div class="more" data-d="more">Impostazioni avanzate</div>
        </div></div>`;
      document.body.appendChild(host);
      const q = (x) => root.querySelector(x);
      this._dlg = { host, root, q, hours: 24, graph: null };

      root.querySelector(".ov").addEventListener("click", (ev) => {
        if (ev.target.classList.contains("ov")) this._closeDialog();
      });
      root.addEventListener("click", (ev) => {
        const d = ev.target.closest("[data-d]");
        const h = ev.target.closest("[data-h]");
        const m = ev.target.closest("[data-m]");
        const f = ev.target.closest("[data-t]");
        if (h) {
          this._dlg.hours = Number(h.dataset.h);
          root.querySelectorAll(".rng").forEach((x) => x.classList.toggle("on", x === h));
          this._dlgGraph();
        } else if (m) {
          this._hass.callService("climate", "set_hvac_mode", { entity_id: cfg.entity, hvac_mode: m.dataset.m });
        } else if (f) {
          this._hass.callService("homeassistant", "toggle", { entity_id: f.dataset.t });
        } else if (d) {
          if (d.dataset.d === "close") this._closeDialog();
          else if (d.dataset.d === "more") this._fire("more-info", cfg.entity);
          else this._action(d.dataset.d);
        }
      });
      this._onKey = (ev) => ev.key === "Escape" && this._closeDialog();
      document.addEventListener("keydown", this._onKey);

      this._dlgUpdate();
      this._dlgGraph();
    }

    _closeDialog() {
      if (!this._dlg) return;
      document.removeEventListener("keydown", this._onKey);
      this._dlg.host.remove();
      this._dlg = null;
    }

    async _dlgGraph() {
      const dlg = this._dlg;
      if (!dlg) return;
      const cfg = this._cfg;
      const box = dlg.q(".graph");
      box.textContent = "Caricamento grafico...";
      const seq = (dlg.seq = (dlg.seq || 0) + 1);
      const end = Date.now();
      const start = end - dlg.hours * 3600e3;
      const ids = [cfg.entity];
      if (cfg.temp_termometro) ids.push(cfg.temp_termometro);
      if (cfg.temp_valvola) ids.push(cfg.temp_valvola);
      let res;
      try {
        res = await this._hass.callWS({
          type: "history/history_during_period",
          start_time: new Date(start).toISOString(),
          end_time: new Date(end).toISOString(),
          entity_ids: ids,
          include_start_time_state: true,
          significant_changes_only: false,
          no_attributes: false,
        });
      } catch (err) {
        if (this._dlg === dlg && seq === dlg.seq) box.textContent = "Grafico non disponibile";
        return;
      }
      if (this._dlg !== dlg || seq !== dlg.seq) return;

      const ts = (p) => {
        const v = p.lu ?? p.lc ?? p.last_updated ?? p.last_changed;
        return typeof v === "string" ? Date.parse(v) : v * 1000;
      };
      const temp = [];
      const target = [];
      const heat = []; // [t0, t1]
      let attrs = {};
      let heatStart = null;
      (res[cfg.entity] || []).forEach((p) => {
        const t = Math.max(ts(p), start);
        const st = p.s ?? p.state;
        attrs = Object.assign({}, attrs, p.a ?? p.attributes ?? {});
        if (attrs.current_temperature != null && !isNaN(Number(attrs.current_temperature)))
          temp.push({ t, v: Number(attrs.current_temperature), src: "c" });
        const off = st === "off" || st === "unavailable" || st === "unknown";
        target.push({ t, v: off || attrs.temperature == null ? null : Number(attrs.temperature) });
        const h = !off && attrs.hvac_action === "heating";
        if (h && heatStart === null) heatStart = t;
        if (!h && heatStart !== null) { heat.push([heatStart, t]); heatStart = null; }
      });
      if (heatStart !== null) heat.push([heatStart, end]);
      if (cfg.temp_termometro) {
        const sensor = [];
        (res[cfg.temp_termometro] || []).forEach((p) => {
          const v = Number(p.s ?? p.state);
          if (!isNaN(v) && (p.s ?? p.state) !== "") sensor.push({ t: Math.max(ts(p), start), v });
        });
        if (sensor.length) { temp.length = 0; temp.push(...sensor); }
      }
      const valve = [];
      if (cfg.temp_valvola) {
        (res[cfg.temp_valvola] || []).forEach((p) => {
          const raw = p.s ?? p.state;
          const v = Number(raw);
          if (!isNaN(v) && raw !== "" && raw !== null) valve.push({ t: Math.max(ts(p), start), v });
        });
      }
      [temp, target, valve].forEach((a) => { if (a.length) a.push({ t: end, v: a[a.length - 1].v }); });

      const vals = temp.concat(target, valve).map((x) => x.v).filter((v) => v !== null);
      if (temp.length < 1 || !vals.length) { box.textContent = "Nessun dato nel periodo"; return; }
      let lo = Math.floor(Math.min(...vals) - 0.5);
      let hi = Math.ceil(Math.max(...vals) + 0.5);
      if (hi - lo < 4) hi = lo + 4;
      const W = 600, H = 220, L = 36, R = 10, T = 10, B = 24;
      const X = (t) => L + ((t - start) / (end - start)) * (W - L - R);
      const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const line = (arr, step) => {
        let d = "", pen = false, prev = null;
        arr.forEach((p) => {
          if (p.v === null) { pen = false; prev = null; return; }
          if (!pen) d += `M${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`;
          else if (step) d += `H${X(p.t).toFixed(1)}V${Y(p.v).toFixed(1)}`;
          else d += `L${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`;
          pen = true; prev = p;
        });
        return d;
      };
      let grid = "";
      const stepY = hi - lo > 12 ? 5 : hi - lo > 6 ? 2 : 1;
      for (let v = Math.ceil(lo / stepY) * stepY; v <= hi; v += stepY)
        grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity=".15"/><text x="${L - 5}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="currentColor" opacity=".7">${v}</text>`;
      const fmtT = (t) => {
        const d = new Date(t);
        const hm = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
        return dlg.hours > 24 ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) : hm;
      };
      let xl = "";
      for (let i = 0; i <= 4; i++) {
        const t = start + ((end - start) * i) / 4;
        xl += `<text x="${X(t)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}" font-size="11" fill="currentColor" opacity=".7">${fmtT(t)}</text>`;
      }
      const bands = heat.map(([a, b]) => `<rect x="${X(a)}" y="${T}" width="${Math.max(1, X(b) - X(a))}" height="${H - T - B}" fill="${HR_ORANGE}" opacity=".18"/>`).join("");
      box.innerHTML = `
        <div style="position:relative">
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;touch-action:none">
            ${grid}${xl}${bands}
            <path d="${line(target, true)}" fill="none" stroke="${HR_ORANGE}" stroke-width="1.8" stroke-dasharray="5 3"/>
            <path d="${line(valve, false)}" fill="none" stroke="${HR_VALVE}" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="${line(temp, false)}" fill="none" stroke="#29b6f6" stroke-width="2.2" stroke-linejoin="round"/>
            <line class="cur" y1="${T}" y2="${H - B}" stroke="currentColor" opacity=".5" style="display:none"/>
          </svg>
          <div class="tip" style="position:absolute;top:0;left:40px;font-size:12px;padding:2px 8px;border-radius:8px;background:rgba(128,128,128,.3);display:none"></div>
        </div>
        <div style="display:flex;gap:14px;font-size:12px;opacity:.85;padding:2px 10px 0;flex-wrap:wrap">
          <span><b style="color:#29b6f6">&#9644;</b> ${cfg.temp_termometro ? "Termometro" : "Temperatura"}</span>
          ${cfg.temp_valvola ? `<span><b style="color:${HR_VALVE}">&#9644;</b> Valvola</span>` : ""}
          <span><b style="color:${HR_ORANGE}">&#9548;</b> Target</span>
          <span><b style="color:${HR_ORANGE};opacity:.5">&#9608;</b> Riscalda</span>
        </div>`;
      const svg = box.querySelector("svg");
      const cur = box.querySelector(".cur");
      const tip = box.querySelector(".tip");
      const at = (arr, t) => { let r = null; for (const p of arr) { if (p.t <= t) r = p; else break; } return r; };
      const move = (ev) => {
        const r = svg.getBoundingClientRect();
        const x = ((ev.clientX - r.left) / r.width) * W;
        if (x < L || x > W - R) return;
        const t = start + ((x - L) / (W - L - R)) * (end - start);
        const a = at(temp, t), g = at(target, t), vv = at(valve, t);
        cur.setAttribute("x1", x); cur.setAttribute("x2", x); cur.style.display = "";
        tip.textContent = `${fmtT(t)}${dlg.hours > 24 ? "" : ""}  •  T: ${a ? a.v.toFixed(1) : "--"}°` + (vv ? `  •  V: ${vv.v.toFixed(1)}°` : "") + (g && g.v !== null ? `  •  Target: ${g.v.toFixed(1)}°` : "");
        tip.style.display = "";
      };
      svg.addEventListener("pointermove", move);
      svg.addEventListener("pointerdown", move);
      svg.addEventListener("pointerleave", () => { cur.style.display = "none"; tip.style.display = "none"; });
    }

    _dlgUpdate() {
      const dlg = this._dlg;
      if (!dlg || !this._hass) return;
      const cfg = this._cfg;
      const c = this._st(cfg.entity);
      const q = dlg.q;
      const fmt = (v) => (v === undefined || v === null || isNaN(Number(v)) ? "--" : Number(v).toFixed(1));
      q(".t").textContent = cfg.name || (c && c.attributes.friendly_name) || "";

      const ts = this._st(cfg.temp_termometro);
      const temp = !this._bad(ts) && !isNaN(Number(ts.state)) ? ts.state : c && c.attributes.current_temperature;
      const a = c && (c.attributes.hvac_action || (c.state === "off" ? "off" : ""));
      q(".sub").textContent = c ? `${a ? HR_ACT[a] || a : "--"} • T: ${fmt(temp)}°C` : "Entità non trovata";

      const modes = c && c.attributes.hvac_modes ? HR_ORDER.filter((m) => c.attributes.hvac_modes.includes(m)) : HR_ORDER;
      const label = { heat: "Caldo", auto: "Auto", off: "Spento" };
      const icon = { heat: "mdi:fire", auto: "mdi:calendar-clock", off: "mdi:power" };
      q(".modes").innerHTML = modes
        .map((m) => `<div class="mode${c && c.state === m ? " on" : ""}" data-m="${m}"><ha-icon icon="${icon[m]}"></ha-icon>${label[m]}</div>`)
        .join("");

      const chips = [];
      if (cfg.fan) {
        const f = this._st(cfg.fan);
        const on = !this._bad(f) && f.state === "on";
        chips.push(`<div class="chip${on ? " active" : ""}" data-t="${hrEsc(cfg.fan)}"><ha-icon icon="${on ? "mdi:fan" : "mdi:fan-off"}"></ha-icon>Ventola</div>`);
      }
      if (cfg.door) {
        const d = this._st(cfg.door);
        const open = !this._bad(d) && d.state === "on";
        const ro = cfg.door.startsWith("binary_sensor.");
        chips.push(`<div class="chip${ro ? " ro" : ""}${open ? " alert" : ""}" ${ro ? "" : `data-t="${hrEsc(cfg.door)}"`}><ha-icon icon="${open ? "mdi:door-open" : "mdi:door-closed"}"></ha-icon>${open ? "Porta aperta" : "Porta chiusa"}</div>`);
      }
      q(".chips").innerHTML = chips.join("");
      q(".tset .v").textContent = !c || this._bad(c) ? "--" : fmt(c.attributes.temperature) + "°";

    }
  }

  if (!customElements.get("heating-radiator-card")) {
    customElements.define("heating-radiator-card", HeatingRadiatorCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-radiator-card",
    name: "Heating Radiator",
    description: "Riga termosifone: modalità, ventola, temperatura target e stato.",
  });
}

// ===== heating-radiators-card.js =====
{
  /* Heating Radiators card: una heating-radiator-card per ogni stanza di Tado Heating Manager, nell'ordine delle stanze.
   * Uso:  type: custom:heating-radiators-card
   *       exclude: [climate.xxx]   # opzionale: stanze da non mostrare
   * Termometro, valvola, ventola e offset di ogni riga arrivano dalla stanza (vedi heating-radiator-card).
   */
  class HeatingRadiatorsCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._sig = null;
      this._cards = [];
    }

    setConfig(config) {
      this._config = config || {};
      this._sig = null;
      if (this._hass) this.hass = this._hass;
    }

    getCardSize() {
      return Math.max(1, this._cards.length);
    }

    getGridOptions() {
      return { columns: "full" };
    }

    static getStubConfig() {
      return {};
    }

    static getConfigForm() {
      return {
        schema: [{ name: "exclude", selector: { entity: { domain: "climate", multiple: true } } }],
        computeLabel: (s) => (s.name === "exclude" ? "Stanze da non mostrare" : s.name),
        computeHelper: (s) =>
          s.name === "exclude" ? "Le altre stanze di Tado Heating Manager compaiono da sole, nell'ordine delle stanze." : undefined,
      };
    }

    _rooms() {
      const st = this._hass.states["sensor.hp_all_rooms"];
      const rooms = (st && st.attributes.rooms) || [];
      const skip = new Set(this._config.exclude || []);
      return rooms.filter((r) => r.climate && !skip.has(r.climate));
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      const rooms = this._rooms();
      const sig = rooms.map((r) => r.climate).join("|");
      if (sig !== this._sig) {
        this._sig = sig;
        this._build(rooms);
      }
      this._cards.forEach((c) => (c.hass = hass));
    }

    _build(rooms) {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; }
          .list { display: flex; flex-direction: column; gap: 8px; }
          ha-card.empty { padding: 16px; color: var(--secondary-text-color); }
        </style>
        <div class="list"></div>`;
      const list = this.shadowRoot.querySelector(".list");
      this._cards = [];
      if (!rooms.length) {
        list.innerHTML = `<ha-card class="empty">Nessun termosifone: aggiungi le stanze in Tado Heating Manager.<br>${THM_EMPTY_BTN}</ha-card>`;
        list.querySelector(".thm-cfg").addEventListener("click", thmOpenConfig);
        return;
      }
      rooms.forEach((r) => {
        const card = document.createElement("heating-radiator-card");
        card.setConfig({ entity: r.climate });
        list.appendChild(card);
        this._cards.push(card);
      });
    }
  }

  if (!customElements.get("heating-radiators-card")) {
    customElements.define("heating-radiators-card", HeatingRadiatorsCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-radiators-card",
    name: "Heating Radiators",
    description: "Una riga per ogni termosifone di Tado Heating Manager, aggiunta da sola.",
  });
}

// ===== heating-summary-card.js =====
{
  /* Heating Summary card: riepilogo per la Home (termosifoni, programmi, quota). Un tocco apre la plancia Riscaldamento.
   * Uso:  type: custom:heating-summary-card
   *       title: Riscaldamento          # facoltativo
   *       navigation_path: /tado-heating # facoltativo: plancia aperta al tocco
   *       show_planner: true             # facoltativo: prossimo cambio dei programmi
   *       show_quota: true               # facoltativo: barra della quota Tado (se ci sono i sensori)
   *       exclude: [climate.xxx]         # facoltativo
   */
  const HS_ORANGE = "#ff8a3d";
  const HS_GREEN = "#4caf50";
  const HS_RED = "#e53935";
  const HS_PLATFORM = "tado_heating_manager";
  const HS_QUOTA_LEGACY = {
    quota_status: "sensor.system_tado_offset_manager_quota_tado_stato",
    quota_percent: "sensor.system_tado_offset_manager_quota_tado_usata",
    quota_remaining: "sensor.system_tado_offset_manager_quota_tado_residue",
    quota_reset: "sensor.system_tado_offset_manager_quota_tado_prossimo_reset",
  };
  const HS_DAYS = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
  const hsEsc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hsNum = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? null : Number(v));
  const hsTemp = (v) => (v === null ? "--" : v.toFixed(1));
  const hsTime = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return hh;
    return `${HS_DAYS[d.getDay()]} ${hh}`;
  };
  const hsShortValue = (v) => (!v ? "" : v === "Spento" ? "spento" : String(v).replace(" °C", "°"));

  class HeatingSummaryCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._sig = "";
    }

    setConfig(config) {
      this._config = { title: "Riscaldamento", navigation_path: "/tado-heating", show_planner: true, show_quota: true, ...(config || {}) };
      this._sig = "";
      this._quotaIds = null;
      this._build();
    }

    getCardSize() {
      return 4;
    }

    getGridOptions() {
      return { columns: 12, min_columns: 6 };
    }

    static getStubConfig() {
      return {};
    }

    static getConfigForm() {
      return {
        schema: [
          { name: "title", selector: { text: {} } },
          { name: "navigation_path", selector: { text: {} } },
          {
            type: "grid", name: "", flatten: true,
            schema: [
              { name: "show_planner", selector: { boolean: {} } },
              { name: "show_quota", selector: { boolean: {} } },
            ],
          },
          { name: "exclude", selector: { entity: { domain: "climate", multiple: true } } },
        ],
        computeLabel: (s) =>
          ({ title: "Titolo", navigation_path: "Plancia da aprire", show_planner: "Prossimo cambio", show_quota: "Quota Tado", exclude: "Stanze da non mostrare" }[s.name] || s.name),
        computeHelper: (s) => (s.name === "navigation_path" ? "Vuoto: /tado-heating (la plancia creata da Tado Heating Manager)." : undefined),
      };
    }

    _st(id) {
      return id && this._hass ? this._hass.states[id] : undefined;
    }

    _rooms() {
      const st = this._st("sensor.hp_all_rooms");
      const skip = new Set(this._config.exclude || []);
      return ((st && st.attributes.rooms) || []).filter((r) => r.climate && !skip.has(r.climate));
    }

    // sensori della quota: registro (piattaforma + chiave) > nomi storici
    _resolveQuota() {
      const reg = this._hass.entities || {};
      const found = {};
      Object.values(reg).forEach((e) => {
        if (e.platform === HS_PLATFORM && e.translation_key && e.entity_id.startsWith("sensor.")) found[e.translation_key] = e.entity_id;
      });
      const out = {};
      Object.keys(HS_QUOTA_LEGACY).forEach((k) => (out[k] = found[k] || HS_QUOTA_LEGACY[k]));
      this._quotaFromReg = Object.keys(reg).length > 0;
      return out;
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      if (!this._quotaIds || !this._quotaFromReg) this._quotaIds = this._resolveQuota();
      const ids = ["sensor.hp_all_rooms", "switch.hp_all_enabled", ...Object.values(this._quotaIds)];
      this._rooms().forEach((r) => ids.push(r.climate, r.thermometer, r.fan, `sensor.hp_${r.slug}_current`, `switch.hp_${r.slug}_enabled`));
      const sig = ids.map((id) => {
        const s = this._st(id);
        return s ? s.state + JSON.stringify(s.attributes) : "-";
      }).join("|");
      if (sig === this._sig) return;
      this._sig = sig;
      this._update();
    }

    _build() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; }
          ha-card {
            position: relative; overflow: hidden; cursor: pointer; padding: 16px; border-radius: var(--ha-card-border-radius, 16px);
            color: var(--primary-text-color); transition: background .6s ease;
          }
          ha-card::before {
            content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .6s ease;
            background: radial-gradient(120% 90% at 0% 0%, rgba(255,138,61,.28), rgba(255,138,61,0) 60%);
          }
          ha-card.warm::before { opacity: 1; }
          .head { position: relative; display: flex; align-items: center; gap: 12px; }
          .hicon {
            width: 44px; height: 44px; border-radius: 14px; flex: none; display: flex; align-items: center; justify-content: center;
            background: rgba(128,128,128,.18); color: var(--secondary-text-color); --mdc-icon-size: 24px; transition: all .4s ease;
          }
          ha-card.warm .hicon { background: rgba(255,138,61,.22); color: ${HS_ORANGE}; }
          ha-card.warm .hicon ha-icon { animation: hs-flicker 1s ease-in-out infinite; transform-origin: 50% 90%; }
          .htxt { min-width: 0; flex: 1; }
          .title { font-size: 17px; font-weight: 600; line-height: 1.2; }
          .sub { font-size: 12.5px; color: var(--secondary-text-color); margin-top: 2px; line-height: 1.35; }
          .avg { text-align: right; flex: none; }
          .avg .v { font-size: 26px; font-weight: 300; line-height: 1; letter-spacing: -.5px; }
          .avg .v small { font-size: 14px; margin-left: 1px; }
          .avg .l { font-size: 11px; color: var(--secondary-text-color); margin-top: 3px; }
          .rooms { position: relative; display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; margin-top: 14px; }
          .room {
            border-radius: 14px; padding: 10px 11px; background: rgba(128,128,128,.10); border: 1.5px solid transparent;
            min-width: 0; transition: all .4s ease;
          }
          .room.on { border-color: rgba(255,138,61,.35); }
          .room.heating { background: rgba(255,122,40,.16); border-color: rgba(255,138,61,.6); }
          .room.auto { border-color: rgba(76,175,80,.55); }
          .room.off { opacity: .72; }
          .rtop { display: flex; align-items: center; gap: 6px; }
          .rname { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .rflame { --mdc-icon-size: 16px; color: ${HS_ORANGE}; display: none; transform-origin: 50% 90%; }
          .room.heating .rflame { display: inline-flex; animation: hs-flicker .9s ease-in-out infinite; }
          .rfan { --mdc-icon-size: 16px; color: var(--disabled-text-color, #9e9e9e); display: inline-flex; }
          .rfan.on { color: #29b6f6; }
          .rfan.on ha-icon { animation: hs-spin 1.2s linear infinite; }
          .rfan ha-icon { --mdc-icon-size: 16px; display: inline-flex; }
          .plan { display: flex; flex-direction: column; gap: 4px; }
          .ch { display: flex; gap: 10px; font-size: 12.5px; color: var(--secondary-text-color); padding-left: 26px; }
          .ch .w { flex: none; min-width: 64px; font-weight: 600; color: var(--primary-text-color); font-variant-numeric: tabular-nums; }
          .ch .a { min-width: 0; }
          .rtemp { font-size: 22px; font-weight: 400; margin-top: 4px; line-height: 1.1; }
          .rsub { font-size: 11.5px; color: var(--secondary-text-color); margin-top: 2px; white-space: nowrap; }
          .room.heating .rsub { color: ${HS_ORANGE}; }
          .foot { position: relative; display: flex; flex-direction: column; gap: 10px; margin-top: 14px; }
          .foot:empty { display: none; }
          .line { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--secondary-text-color); min-width: 0; }
          .line ha-icon { --mdc-icon-size: 18px; flex: none; }
          .line .t { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .line b { color: var(--primary-text-color); font-weight: 600; }
          .pill { flex: none; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: rgba(128,128,128,.16); }
          .pill.on { background: rgba(76,175,80,.18); color: ${HS_GREEN}; }
          .bar { height: 6px; border-radius: 3px; background: rgba(128,128,128,.2); overflow: hidden; margin-top: 5px; }
          .bar > div { height: 100%; border-radius: 3px; transition: width .6s ease, background .6s ease; }
          .q { flex: 1; min-width: 0; }
          .empty { position: relative; margin-top: 12px; font-size: 13px; color: var(--secondary-text-color); }
          @keyframes hs-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes hs-flicker {
            0%, 100% { transform: scale(1, 1) rotate(0deg); }
            25% { transform: scale(1.06, .94) rotate(-3deg); }
            50% { transform: scale(.95, 1.07) rotate(2deg); }
            75% { transform: scale(1.04, .97) rotate(-2deg); }
          }
          @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
        </style>
        <ha-card tabindex="0" role="button">
          <div class="head">
            <div class="hicon"><ha-icon icon="mdi:fire"></ha-icon></div>
            <div class="htxt"><div class="title"></div><div class="sub"></div></div>
            <div class="avg"><div class="v"></div><div class="l">media</div></div>
          </div>
          <div class="rooms"></div>
          <div class="foot"></div>
        </ha-card>`;
      const $ = (q) => this.shadowRoot.querySelector(q);
      this._el = { card: $("ha-card"), title: $(".title"), sub: $(".sub"), avg: $(".avg .v"), avgWrap: $(".avg"), rooms: $(".rooms"), foot: $(".foot") };
      const go = () => {
        const path = this._config.navigation_path || "/tado-heating";
        window.history.pushState(null, "", path);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      };
      this._el.card.addEventListener("click", go);
      this._el.card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); go(); }
      });
    }

    _room(r) {
      const c = this._st(r.climate);
      const th = this._st(r.thermometer);
      const temp = hsNum(th && th.state) ?? hsNum(c && c.attributes.current_temperature);
      const bad = !c || c.state === "unavailable" || c.state === "unknown";
      const off = bad || c.state === "off";
      const heating = !off && c.attributes.hvac_action === "heating";
      const target = off ? null : hsNum(c.attributes.temperature);
      const cur = this._st(`sensor.hp_${r.slug}_current`);
      const en = this._st(`switch.hp_${r.slug}_enabled`);
      const planOn = !!en && en.state === "on";
      const next = planOn && cur && cur.attributes.next_change
        ? { when: cur.attributes.next_change, value: cur.attributes.next_value, name: r.name } : null;
      const f = this._st(r.fan);
      const fan = !r.fan ? null : !f || f.state === "unavailable" || f.state === "unknown" ? "bad" : f.state === "on" ? "on" : "off";
      return { r, c, temp, bad, off, heating, target, next, fan, auto: !off && c.state === "auto" };
    }

    _update() {
      if (!this._el || !this._hass) return;
      const e = this._el;
      const rooms = this._rooms().map((r) => this._room(r));
      const on = rooms.filter((x) => !x.off).length;
      const heating = rooms.filter((x) => x.heating).length;
      const temps = rooms.map((x) => x.temp).filter((t) => t !== null);
      const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;

      e.card.classList.toggle("warm", heating > 0);
      e.title.textContent = this._config.title || "Riscaldamento";
      e.sub.textContent = !rooms.length
        ? "Nessun termosifone"
        : heating
          ? `${heating} in riscaldamento · ${on}/${rooms.length} accesi`
          : on
            ? `${on}/${rooms.length} accesi · temperatura raggiunta`
            : "Tutti spenti";
      const fansOn = rooms.filter((x) => x.fan === "on").length;
      if (fansOn) e.sub.textContent += fansOn === 1 ? " · 1 ventola" : ` · ${fansOn} ventole`;
      e.avgWrap.style.display = avg === null ? "none" : "";
      e.avg.innerHTML = avg === null ? "" : `${avg.toFixed(1)}<small>°</small>`;

      e.rooms.innerHTML = rooms.length
        ? rooms.map((x) => {
            const cls = ["room", x.off ? "off" : "on", x.heating ? "heating" : "", x.auto ? "auto" : ""].join(" ");
            const sub = x.bad ? "non disponibile" : x.off ? "spento" : x.target !== null ? `obiettivo ${x.target.toFixed(1)}°` : "acceso";
            const fan = x.fan
              ? `<span class="rfan ${x.fan === "on" ? "on" : ""}" title="Ventola ${x.fan === "on" ? "accesa" : x.fan === "off" ? "spenta" : "non disponibile"}"><ha-icon icon="${x.fan === "bad" ? "mdi:fan-off" : "mdi:fan"}"></ha-icon></span>`
              : "";
            return `<div class="${cls}">
                <div class="rtop"><div class="rname">${hsEsc(x.r.name)}</div>${fan}<ha-icon class="rflame" icon="mdi:fire"></ha-icon></div>
                <div class="rtemp">${hsTemp(x.temp)}°</div>
                <div class="rsub">${hsEsc(sub)}</div>
              </div>`;
          }).join("")
        : `<div class="empty">Aggiungi le stanze in Tado Heating Manager.</div>`;

      const foot = [];
      if (this._config.show_planner && rooms.length) {
        const hub = this._st("switch.hp_all_enabled");
        const hubOn = !!hub && hub.state === "on";
        const nexts = rooms.map((x) => x.next).filter(Boolean).sort((a, b) => new Date(a.when) - new Date(b.when));
        // un cambio per stanza; quelli alla stessa ora stanno sulla stessa riga
        const groups = [];
        nexts.forEach((n) => {
          const label = hsTime(n.when);
          const g = groups.find((x) => x.label === label);
          const item = `${hsEsc(n.name)} → ${hsEsc(hsShortValue(n.value))}`;
          if (g) g.items.push(item);
          else groups.push({ label, items: [item] });
        });
        const MAX = 4;
        const head = !hubOn ? "Programmi sospesi" : groups.length ? "Prossimi cambi" : "Nessun cambio in programma";
        const rows = hubOn
          ? groups.slice(0, MAX).map((g) => `<div class="ch"><span class="w">${hsEsc(g.label)}</span><span class="a">${g.items.join(", ")}</span></div>`)
          : [];
        if (hubOn && groups.length > MAX) rows.push(`<div class="ch"><span class="w"></span><span class="a">e altri ${groups.length - MAX} orari…</span></div>`);
        foot.push(`<div class="plan"><div class="line"><ha-icon icon="mdi:calendar-clock"></ha-icon><span class="t">${head}</span>
          <span class="pill ${hubOn ? "on" : ""}">${hubOn ? "Programmi attivi" : "Programmi spenti"}</span></div>${rows.join("")}</div>`);
      }
      if (this._config.show_quota) {
        const q = (k) => this._st(this._quotaIds[k]);
        const pct = hsNum(q("quota_percent") && q("quota_percent").state);
        if (pct !== null) {
          const status = q("quota_status") ? q("quota_status").state : "ok";
          const color = status === "critical" ? HS_RED : status === "warning" ? HS_ORANGE : HS_GREEN;
          const rem = hsNum(q("quota_remaining") && q("quota_remaining").state);
          const reset = q("quota_reset") ? hsTime(q("quota_reset").state) : "";
          const parts = [rem !== null ? `${rem} residue` : "", reset ? `reset ${reset}` : ""].filter(Boolean).join(" · ");
          foot.push(`<div class="line"><ha-icon icon="mdi:api" style="color:${color}"></ha-icon>
            <div class="q"><div style="display:flex;gap:8px"><span class="t">Quota Tado <b>${pct.toFixed(0)}%</b></span><span>${hsEsc(parts)}</span></div>
            <div class="bar"><div style="width:${Math.min(100, Math.max(0, pct))}%;background:${color}"></div></div></div></div>`);
        }
      }
      e.foot.innerHTML = foot.join("");
    }
  }

  if (!customElements.get("heating-summary-card")) {
    customElements.define("heating-summary-card", HeatingSummaryCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-summary-card",
    name: "Heating Summary",
    description: "Riepilogo del riscaldamento per la Home: termosifoni, programmi e quota. Un tocco apre la plancia.",
    preview: true,
  });
}

// ===== heating-ac-card.js =====
{
  /* Heating AC card: riga compatta per un climatizzatore (sostituisce il button-card "clima_row").
   * Uso:
   *   type: custom:heating-ac-card
   *   entity: climate.condizionatore_cucina
   *   name: Cucina                 # opzionale
   * Non richiede button-card.
   */
  const AC_LABEL = { off: "Spento", cool: "Freddo", heat: "Caldo", dry: "Deumidifica", fan_only: "Ventola", heat_cool: "Auto" };
  const AC_ICON = {
    off: "mdi:power", cool: "mdi:snowflake", heat: "mdi:fire", dry: "mdi:water-percent",
    fan_only: "mdi:fan", heat_cool: "mdi:sun-snowflake-variant",
  };
  const AC_COLOR = { cool: "#29b6f6", heat: "#ff8a3d", dry: "#26a69a", fan_only: "#90a4ae", heat_cool: "#4caf50" };
  const AC_TINT = { cool: "rgba(41,182,246,.24)", heat: "rgba(255,122,40,.24)", dry: "rgba(38,166,154,.24)" };
  const AC_ANIM = {
    cool: "ac-spin 8s linear infinite", heat_cool: "ac-spin 8s linear infinite", fan_only: "ac-spin 1s linear infinite",
    heat: "ac-flame .9s ease-in-out infinite", dry: "ac-drop 1.6s ease-in-out infinite",
  };
  const AC_SWING = {
    Off: "Swing off", Top: "Alto", MiddleTop1: "Medio-alto 1", MiddleTop2: "Medio-alto 2",
    MiddleBottom2: "Medio-basso 2", MiddleBottom1: "Medio-basso 1", Bottom: "Basso", Swing: "Oscilla",
  };

  const acEsc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  class HeatingAcCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._sig = "";
    }

    setConfig(config) {
      if (!config || !config.entity) throw new Error("Manca 'entity' (climate.*)");
      this._config = config;
      this._sig = "";
      this._build();
    }

    getCardSize() {
      return 1;
    }

    getGridOptions() {
      return { columns: "full" };
    }

    static getStubConfig(hass) {
      const e = Object.keys(hass.states).find((k) => k.startsWith("climate."));
      return { entity: e || "climate.example" };
    }

    set hass(hass) {
      this._hass = hass;
      const s = hass.states[this._config.entity];
      const sig = s ? s.state + JSON.stringify(s.attributes) : "-";
      if (sig === this._sig) return;
      this._sig = sig;
      this._update();
    }

    _build() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; }
          ha-card {
            box-sizing: border-box; min-height: 68px; border-radius: 15px; padding: 10px 14px;
            box-shadow: none; overflow: hidden; cursor: pointer; color: var(--primary-text-color);
            display: grid; align-items: center; column-gap: 8px;
            grid-template-columns: 44px minmax(0, 1fr) auto auto auto;
            border: 2px solid transparent;
          }
          .icon {
            width: 44px; height: 44px; border-radius: 50%; background: rgba(128,128,128,.22);
            display: flex; align-items: center; justify-content: center;
          }
          .info { min-width: 0; overflow: hidden; text-align: left; }
          .name { font-weight: 600; font-size: 15px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .line { margin-top: 3px; font-size: 11px; line-height: 1.3; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .btn {
            position: relative; width: 38px; height: 38px; border-radius: 50%; background: rgba(128,128,128,.22);
            display: flex; align-items: center; justify-content: center; justify-self: end; --mdc-icon-size: 20px;
          }
          .btn ha-icon { display: inline-block; pointer-events: none; }
          .btn select {
            position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;
            font-size: 16px; border: none;
          }
          .temp {
            height: 38px; border-radius: 14px; background: rgba(128,128,128,.22); justify-self: end;
            display: grid; grid-template-columns: 32px 44px 32px; align-items: center; padding: 0 4px;
          }
          .temp .v { font-size: 14px; font-weight: 500; text-align: center; }
          .temp .s {
            width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
            cursor: pointer; --mdc-icon-size: 18px; border-radius: 50%; color: #4f78a8;
          }
          @keyframes ac-spin { to { transform: rotate(360deg); } }
          @keyframes ac-flame {
            0%   { transform: scale(1, 1) rotate(0deg);       filter: brightness(1); }
            20%  { transform: scale(1.06, .94) rotate(-3deg); filter: brightness(1.15); }
            40%  { transform: scale(.95, 1.08) rotate(2deg);  filter: brightness(.95); }
            60%  { transform: scale(1.05, .96) rotate(-2deg); filter: brightness(1.2); }
            80%  { transform: scale(.97, 1.05) rotate(3deg);  filter: brightness(1); }
            100% { transform: scale(1, 1) rotate(0deg);       filter: brightness(1); }
          }
          @keyframes ac-drop { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-2px) scale(1.1); } }
          @keyframes ac-sway { from { transform: rotate(-18deg); } to { transform: rotate(18deg); } }
        </style>
        <ha-card>
          <div class="icon"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="10" rx="3"/><path d="M6.5 7.4v9.2"/><path d="M8.5 14.3h11"/><circle cx="18.6" cy="10.2" r=".5" fill="currentColor" stroke="none"/></svg></div>
          <div class="info"><div class="name"></div><div class="line"></div></div>
          <div class="btn mode"><ha-icon></ha-icon><select></select></div>
          <div class="btn swing"><ha-icon></ha-icon><select></select></div>
          <div class="temp">
            <div class="s" data-a="minus"><ha-icon icon="mdi:minus"></ha-icon></div>
            <div class="v"></div>
            <div class="s" data-a="plus"><ha-icon icon="mdi:plus"></ha-icon></div>
          </div>
        </ha-card>`;
      const $ = (q) => this.shadowRoot.querySelector(q);
      this._card = $("ha-card");
      this._el = {
        iconWrap: $(".icon"),
        name: $(".name"),
        line: $(".line"),
        mode: $(".btn.mode"),
        modeIcon: $(".btn.mode ha-icon"),
        modeSel: $(".btn.mode select"),
        swing: $(".btn.swing"),
        swingIcon: $(".btn.swing ha-icon"),
        swingSel: $(".btn.swing select"),
        value: $(".temp .v"),
      };

      this._card.addEventListener("click", () =>
        this.dispatchEvent(
          new CustomEvent("hass-more-info", { detail: { entityId: this._config.entity }, bubbles: true, composed: true })
        )
      );
      // i controlli non devono aprire i dettagli
      this.shadowRoot.querySelectorAll(".btn, .temp .s").forEach((el) =>
        el.addEventListener("click", (ev) => ev.stopPropagation())
      );
      this._el.modeSel.addEventListener("change", (ev) =>
        this._hass.callService("climate", "set_hvac_mode", { entity_id: this._config.entity, hvac_mode: ev.target.value })
      );
      this._el.swingSel.addEventListener("change", (ev) =>
        this._hass.callService("climate", "set_swing_mode", { entity_id: this._config.entity, swing_mode: ev.target.value })
      );
      this.shadowRoot.querySelectorAll(".temp .s").forEach((el) =>
        el.addEventListener("click", () => this._step(el.dataset.a === "plus" ? 1 : -1))
      );
    }

    _step(dir) {
      const c = this._hass.states[this._config.entity];
      if (!c) return;
      const a = c.attributes;
      const step = Number(a.target_temp_step ?? 1);
      const base = Number(a.temperature ?? a.current_temperature ?? 22);
      const t = Math.min(Number(a.max_temp ?? 30), Math.max(Number(a.min_temp ?? 16), base + dir * step));
      this._hass.callService("climate", "set_temperature", { entity_id: this._config.entity, temperature: t });
    }

    _update() {
      if (!this._el || !this._hass) return;
      const cfg = this._config;
      const c = this._hass.states[cfg.entity];
      const e = this._el;
      const bad = !c || c.state === "unavailable" || c.state === "unknown";

      this._card.style.backgroundImage = c && AC_TINT[c.state] ? `linear-gradient(${AC_TINT[c.state]}, ${AC_TINT[c.state]})` : "";
      this._card.style.borderColor = (c && AC_COLOR[c.state]) || "transparent";
      e.iconWrap.style.color = (c && AC_COLOR[c.state]) || "var(--primary-text-color)";

      const name = cfg.name || (c && c.attributes.friendly_name) || "";
      let line;
      if (!c) line = "Entità non trovata";
      else if (c.state === "unavailable") line = "Non disponibile";
      else if (c.state === "unknown") line = "Stato sconosciuto";
      else {
        const t = c.attributes.current_temperature;
        const tt = t === undefined || t === null || isNaN(Number(t)) ? "--" : Number(t).toFixed(1);
        line = `${tt}°C • ${AC_LABEL[c.state] || c.state}`;
      }
      e.name.textContent = name;
      e.line.textContent = line;

      // pulsante modalità
      e.mode.style.display = bad ? "none" : "";
      if (!bad) {
        e.modeIcon.setAttribute("icon", AC_ICON[c.state] || "mdi:thermostat");
        e.modeIcon.style.color = AC_COLOR[c.state] || "var(--primary-text-color)";
        e.modeIcon.style.transformOrigin = c.state === "heat" ? "50% 90%" : "50% 50%";
        e.modeIcon.style.animation = AC_ANIM[c.state] || "none";
        e.modeSel.innerHTML = (c.attributes.hvac_modes || [])
          .map((m) => `<option value="${acEsc(m)}"${m === c.state ? " selected" : ""}>${acEsc(AC_LABEL[m] || m)}</option>`)
          .join("");
      }

      // pulsante oscillazione
      const list = c && c.attributes.swing_modes;
      const showSwing = !bad && list && list.length;
      e.swing.style.display = showSwing ? "" : "none";
      if (showSwing) {
        const cur = c.attributes.swing_mode;
        const isOff = cur === undefined || cur === null || cur === "Off";
        const running = c.state !== "off" && cur === "Swing";
        e.swingIcon.setAttribute("icon", isOff ? "mdi:arrow-oscillating-off" : "mdi:arrow-oscillating");
        e.swingIcon.style.color = isOff ? "var(--secondary-text-color)" : "var(--primary-text-color)";
        e.swingIcon.style.animation = running ? "ac-sway 1.6s ease-in-out infinite alternate" : "none";
        e.swingSel.innerHTML = list
          .map((s) => `<option value="${acEsc(s)}"${s === cur ? " selected" : ""}>${acEsc(AC_SWING[s] || s)}</option>`)
          .join("");
      }
      this._card.style.gridTemplateColumns =
        "44px minmax(0, 1fr)" + (bad ? "" : " auto") + (showSwing ? " auto" : "") + " auto";

      const t = c && c.attributes.temperature;
      e.value.textContent = bad || t === undefined || t === null || isNaN(Number(t)) ? "--" : Number(t).toFixed(0) + "°";
    }
  }

  if (!customElements.get("heating-ac-card")) {
    customElements.define("heating-ac-card", HeatingAcCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-ac-card",
    name: "Heating AC",
    description: "Riga climatizzatore: modalità, oscillazione, temperatura target e stato.",
  });
}

// ===== tado-quota-card.js =====
{
  /* Quota API Tado: stato, indicatori, dettaglio delle chiamate e grafico.
   * Uso:  type: custom:tado-quota-card
   * Opzioni (tutte facoltative):
   *   title: "Quota API Tado"
   *   hours_to_show: 48        ore del grafico (0 = niente grafico)
   *   entities:                 entity_id da usare al posto di quelli trovati in automatico
   *     quota_status: sensor.xxx
   * Le entita' si trovano da sole (piattaforma tado_heating_manager + chiave), quindi la card funziona
   * qualunque sia l'entity_id; se non le trova usa i nomi storici sensor.system_tado_offset_manager_*.
   */
  const TQ_PLATFORM = "tado_heating_manager";
  const TQ_LEGACY = {
    quota_status: "sensor.system_tado_offset_manager_quota_tado_stato",
    quota_percent: "sensor.system_tado_offset_manager_quota_tado_usata",
    quota_used: "sensor.system_tado_offset_manager_quota_tado_usate",
    quota_remaining: "sensor.system_tado_offset_manager_quota_tado_residue",
    quota_limit: "sensor.system_tado_offset_manager_quota_tado_limite",
    quota_reset: "sensor.system_tado_offset_manager_quota_tado_prossimo_reset",
    quota_minutes_to_reset: "sensor.system_tado_offset_manager_quota_tado_minuti_al_reset",
    tado_ce_tracked: "sensor.system_tado_offset_manager_chiamate_contate_da_tado_ce",
    api_calls_today: "sensor.system_tado_offset_manager_chiamate_tado_oggi_questa_integrazione",
    unexplained_calls: "sensor.system_tado_offset_manager_chiamate_tado_non_spiegate",
    tado_ce_offset_services: "sensor.system_tado_offset_manager_chiamate_offset_via_tado_ce_manuali_automazioni",
    tado_ce_untracked: null, // solo dal registro (Tado Heating Manager >= 1.0.0 con la stima, H8)
  };
  // chiamate contate da tado_ce, per tipo (attributi di tado_ce_tracked)
  const TQ_TRACKED_TYPES = [
    ["zoneStates", "mdi:eye", "stato delle stanze"],
    ["zones", "mdi:format-list-bulleted", "elenco delle stanze"],
    ["overlay", "mdi:send", "comandi alle valvole"],
    ["weather", "mdi:weather-partly-cloudy", "meteo"],
    ["mobileDevices", "mdi:cellphone", "posizione dei telefoni"],
    ["homeState", "mdi:home-account", "casa / fuori casa"],
    ["presenceLock", "mdi:home-lock", "presenza forzata"],
    ["capabilities", "mdi:tune", "caratteristiche delle zone"],
  ];
  // chiamate che tado_ce fa e non conta (attributi di tado_ce_untracked)
  const TQ_UNTRACKED_TYPES = [
    ["home_devices", "mdi:devices", "elenco dei dispositivi, ogni ora"],
    ["offset_full_sync", "mdi:thermometer-lines", "offset di ogni valvola, ogni ora"],
    ["offset_refresh", "mdi:refresh", "ricontrollo di un offset, ogni 30 min"],
    ["heating_circuits", "mdi:pipe", "circuiti di riscaldamento"],
  ];
  const TQ_GREEN = "#43a047";
  const TQ_ORANGE = "#fb8c00";
  const TQ_RED = "#e53935";
  const TQ_STATUS = {
    ok: { dot: TQ_GREEN, text: "Tutto ok" },
    warning: { dot: TQ_ORANGE, text: "Attenzione: quota quasi esaurita" },
    critical: { dot: TQ_RED, text: "Quota critica: Tado CE sospende il polling fino al reset" },
  };

  const tqEsc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const tqNum = (s) => (s && !isNaN(Number(s.state)) ? Number(s.state) : null);

  class TadoQuotaCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._sig = "";
      this._ids = null;
    }

    setConfig(config) {
      this._config = { title: "Quota API Tado", hours_to_show: 48, ...(config || {}) };
      this._sig = "";
      this._ids = null;
      this._graph = null;
      this._graphPending = false;
      this._build();
    }

    getCardSize() {
      return this._config && Number(this._config.hours_to_show) > 0 ? 9 : 6;
    }

    getGridOptions() {
      return { columns: "full" };
    }

    static getStubConfig() {
      return {};
    }

    static getConfigForm() {
      return {
        schema: [
          { name: "title", selector: { text: {} } },
          { name: "hours_to_show", selector: { number: { min: 0, max: 168, step: 1, mode: "box", unit_of_measurement: "h" } } },
        ],
        computeLabel: (s) => ({ title: "Titolo", hours_to_show: "Ore del grafico" }[s.name] || s.name),
        computeHelper: (s) => (s.name === "hours_to_show" ? "0 = senza grafico." : undefined),
      };
    }

    set hass(hass) {
      this._hass = hass;
      // il registro puo' arrivare dopo il primo hass: finche' manca si riprova
      if (!this._ids || !this._idsFromReg) this._ids = this._resolve();
      if (this._graph) this._graph.hass = hass;
      else this._makeGraph();
      const sig = Object.values(this._ids)
        .map((id) => {
          const s = hass.states[id];
          return s ? s.state + JSON.stringify(s.attributes) : "-";
        })
        .join("|");
      if (sig === this._sig) return;
      this._sig = sig;
      this._update();
    }

    // entity_id per chiave: configurazione > registro (piattaforma + chiave) > nomi storici
    _resolve() {
      const out = {};
      const reg = this._hass.entities || {};
      this._idsFromReg = Object.keys(reg).length > 0;
      const found = {};
      Object.values(reg).forEach((e) => {
        if (e.platform === TQ_PLATFORM && e.translation_key && e.entity_id.startsWith("sensor.")) found[e.translation_key] = e.entity_id;
      });
      const over = this._config.entities || {};
      Object.keys(TQ_LEGACY).forEach((k) => {
        const id = over[k] || found[k] || TQ_LEGACY[k];
        if (id) out[k] = id;
      });
      return out;
    }

    _st(key) {
      return this._hass && this._ids ? this._hass.states[this._ids[key]] : undefined;
    }

    _more(key) {
      const id = this._ids && this._ids[key];
      if (!id) return;
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
    }

    async _makeGraph() {
      const hours = Number(this._config.hours_to_show);
      if (!(hours > 0) || this._graphPending || !this._hass || !window.loadCardHelpers) return;
      this._graphPending = true;
      try {
        const helpers = await window.loadCardHelpers();
        const card = helpers.createCardElement({
          type: "history-graph",
          hours_to_show: hours,
          entities: [
            { entity: this._ids.quota_used, name: "Usate" },
            { entity: this._ids.quota_remaining, name: "Residue" },
          ],
        });
        card.hass = this._hass;
        this._graph = card;
        this._e.graph.replaceChildren(card);
      } catch (err) {
        this._e.graph.textContent = "Grafico non disponibile";
      }
    }

    _build() {
      this.shadowRoot.innerHTML = `
        <style>
          ha-card { padding: 16px; color: var(--primary-text-color); }
          .head { display:flex; align-items:center; gap:10px; }
          .title { font-size: 1.25em; font-weight: 600; flex: 1; }
          .badge { padding: 4px 10px; border-radius: 12px; font-size: .85em; font-weight: 600; color: #fff; }
          .msg { margin-top: 6px; display:flex; align-items:center; gap:8px; }
          .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
          .reset { margin-top: 4px; color: var(--secondary-text-color); font-size: .95em; }
          .gauges { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 14px; }
          .gauge { text-align:center; cursor:pointer; border-radius: 12px; padding: 6px 4px;
                   background: color-mix(in srgb, var(--primary-text-color) 4%, transparent); }
          .gauge svg { width: 100%; max-width: 180px; display:block; margin: 0 auto; }
          .gauge .v { font-size: 1.4em; font-weight: 600; margin-top: 2px; }
          .gauge .l { color: var(--secondary-text-color); font-size: .9em; }
          .sec { margin: 16px 0 6px; font-weight: 600; color: var(--secondary-text-color); font-size: .85em;
                 text-transform: uppercase; letter-spacing: .04em; }
          .row { display:flex; align-items:center; gap:10px; padding: 7px 2px; cursor:pointer; border-radius: 8px; }
          .row:hover { background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
          .row ha-icon { color: var(--state-icon-color, var(--secondary-text-color)); --mdc-icon-size: 20px; flex: none; }
          .row .n { flex: 1; min-width: 0; }
          .row .x { font-variant-numeric: tabular-nums; white-space: nowrap; }
          .row.sub { padding-left: 30px; font-size: .92em; color: var(--secondary-text-color); }
          .note { padding: 0 2px 6px 32px; margin-top: -4px; font-size: .82em; line-height: 1.35;
                  color: var(--secondary-text-color); }
          .bar { height: 8px; border-radius: 4px; overflow: hidden; display:flex; margin: 6px 2px 4px;
                 background: color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
          .bar span { height: 100%; }
          .legend { display:flex; flex-wrap:wrap; gap: 4px 14px; font-size: .85em; color: var(--secondary-text-color); margin: 0 2px; }
          .legend i { display:inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; }
          .graph { margin: 14px -16px -16px; }
          .graph:empty { display:none; }
        </style>
        <ha-card>
          <div class="head"><div class="title"></div><div class="badge"></div></div>
          <div class="msg"><span class="dot"></span><span class="mtxt"></span></div>
          <div class="reset"></div>
          <div class="gauges">
            <div class="gauge" data-k="quota_percent"><div class="g1"></div><div class="v v1"></div><div class="l">Usata</div></div>
            <div class="gauge" data-k="quota_remaining"><div class="g2"></div><div class="v v2"></div><div class="l">Residue</div></div>
          </div>
          <div class="sec">Dettaglio</div>
          <div class="detail"></div>
          <div class="sec srcsec">Chi ha usato le chiamate</div>
          <div class="bar"></div>
          <div class="legend"></div>
          <div class="sources"></div>
          <div class="graph"></div>
        </ha-card>`;
      const $ = (s) => this.shadowRoot.querySelector(s);
      this._e = {
        title: $(".title"), badge: $(".badge"), dot: $(".dot"), mtxt: $(".mtxt"), reset: $(".reset"),
        g1: $(".g1"), g2: $(".g2"), v1: $(".v1"), v2: $(".v2"),
        detail: $(".detail"), srcsec: $(".srcsec"), bar: $(".bar"), legend: $(".legend"), sources: $(".sources"), graph: $(".graph"),
      };
      this.shadowRoot.addEventListener("click", (ev) => {
        const el = ev.target.closest("[data-k]");
        if (el) this._more(el.dataset.k);
      });
    }

    // semicerchio con segmenti colorati e lancetta; value e segmenti in [0, max]
    _gauge(value, max, segments) {
      const R = 40, CX = 50, CY = 50, W = 10;
      const pt = (f) => {
        const a = Math.PI * (1 - f);
        return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
      };
      const arc = (f0, f1, color) => {
        const [x0, y0] = pt(f0);
        const [x1, y1] = pt(f1);
        return `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" stroke="${color}" stroke-width="${W}" fill="none"/>`;
      };
      let paths = "";
      segments.forEach((s, i) => {
        const end = i + 1 < segments.length ? segments[i + 1].from : max;
        paths += arc(Math.max(0, s.from / max), Math.min(1, end / max), s.color);
      });
      let needle = "";
      if (value !== null) {
        const f = Math.max(0, Math.min(1, value / max));
        const a = Math.PI * (1 - f);
        const x = CX + (R - 2) * Math.cos(a), y = CY - (R - 2) * Math.sin(a);
        needle = `<line x1="${CX}" y1="${CY}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" stroke="var(--primary-text-color)" stroke-width="2.5" stroke-linecap="round"/>
                  <circle cx="${CX}" cy="${CY}" r="4" fill="var(--primary-text-color)"/>`;
      }
      return `<svg viewBox="0 0 100 56">${paths}${needle}</svg>`;
    }

    _row(key, icon, name, value, sub) {
      return `<div class="row${sub ? " sub" : ""}" data-k="${key}"><ha-icon icon="${icon}"></ha-icon>` +
        `<span class="n">${tqEsc(name)}</span><span class="x">${tqEsc(value)}</span></div>`;
    }

    _update() {
      if (!this._e || !this._hass) return;
      const e = this._e;
      const fmt = (s) => (s && s.state !== "unavailable" && s.state !== "unknown" ? s.state : "--");

      e.title.textContent = this._config.title;
      const status = this._st("quota_status");
      const st = TQ_STATUS[status && status.state] || { dot: "var(--disabled-text-color, #999)", text: "Stato non disponibile" };
      e.dot.style.background = st.dot;
      e.badge.style.background = st.dot;
      e.badge.textContent = status ? ({ ok: "OK", warning: "Attenzione", critical: "Critica" }[status.state] || status.state) : "--";
      e.mtxt.textContent = st.text;

      const resetS = this._st("quota_reset");
      const mins = tqNum(this._st("quota_minutes_to_reset"));
      let resetTxt = "";
      if (resetS && !isNaN(Date.parse(resetS.state))) {
        const d = new Date(resetS.state);
        resetTxt = `Reset alle ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        if (mins !== null) resetTxt += ` (tra ${Math.floor(mins / 60)} h ${Math.round(mins % 60)} min)`;
      }
      e.reset.textContent = resetTxt;
      e.srcsec.textContent = resetS && !isNaN(Date.parse(resetS.state))
        ? `Chi ha usato le chiamate (dalle ${new Date(resetS.state).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`
        : "Chi ha usato le chiamate";

      const pct = tqNum(this._st("quota_percent"));
      const rem = tqNum(this._st("quota_remaining"));
      const limit = tqNum(this._st("quota_limit")) || 1000;
      e.g1.innerHTML = this._gauge(pct, 100, [
        { from: 0, color: TQ_GREEN }, { from: 70, color: TQ_ORANGE }, { from: 90, color: TQ_RED },
      ]);
      e.v1.textContent = pct === null ? "--" : `${pct.toFixed(1).replace(/\.0$/, "")}%`;
      e.g2.innerHTML = this._gauge(rem, limit, [
        { from: 0, color: TQ_RED }, { from: limit * 0.1, color: TQ_ORANGE }, { from: limit * 0.3, color: TQ_GREEN },
      ]);
      e.v2.textContent = rem === null ? "--" : String(rem);

      e.detail.innerHTML =
        this._row("quota_limit", "mdi:gauge-full", "Quota giornaliera", fmt(this._st("quota_limit"))) +
        this._row("quota_used", "mdi:counter", "Usate", fmt(this._st("quota_used"))) +
        this._row("quota_remaining", "mdi:battery-60", "Residue", fmt(this._st("quota_remaining"))) +
        this._row("quota_reset", "mdi:timer-refresh", "Prossimo reset",
          resetS && !isNaN(Date.parse(resetS.state)) ? new Date(resetS.state).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "--");

      // fonti: tado_ce contate e non contate, questa integrazione, servizi offset di tado_ce, non spiegate
      const n = (v) => (v === undefined || v === null || isNaN(Number(v)) ? 0 : Number(v));
      const ok = (st) => st && st.state !== "unavailable" && st.state !== "unknown";
      const ce = this._st("tado_ce_tracked");
      const hid = this._st("tado_ce_untracked");
      const own = this._st("api_calls_today");
      const svc = this._st("tado_ce_offset_services");
      const unk = this._st("unexplained_calls");
      const ca = (ce && ce.attributes) || {};
      const ha = (hid && hid.attributes) || {};
      const ownN = own ? n(own.attributes.since_quota_reset ?? own.state) : 0;
      const parts = [
        { k: "tado_ce_tracked", label: "Tado CE", v: n(ce && ce.state), color: "#1e88e5" },
        { k: "tado_ce_untracked", label: "Tado CE extra", v: n(hid && hid.state), color: "#64b5f6", show: ok(hid) },
        { k: "api_calls_today", label: "Offset automatico", v: ownN, color: "#ff8a3d" },
        { k: "tado_ce_offset_services", label: "Offset a mano", v: n(svc && svc.state), color: "#fdd835", show: ok(svc) },
        { k: "unexplained_calls", label: "Sconosciute", v: n(unk && unk.state), color: "#8e24aa" },
      ].filter((p) => p.show !== false);
      const tot = parts.reduce((a, p) => a + p.v, 0);
      e.bar.innerHTML = tot ? parts.filter((p) => p.v).map((p) => `<span style="width:${(p.v / tot) * 100}%;background:${p.color}"></span>`).join("") : "";
      e.legend.innerHTML = parts.map((p) => `<span><i style="background:${p.color}"></i>${tqEsc(p.label)} ${p.v}</span>`).join("");

      const note = (t) => `<div class="note">${tqEsc(t)}</div>`;
      let src = this._row("tado_ce_tracked", "mdi:home-thermometer", "Tado CE", fmt(ce)) +
        note("Tado CE legge e comanda le valvole dal cloud. Queste le conta da solo.");
      const known = new Set(TQ_TRACKED_TYPES.map((t) => t[0]));
      const byType = ca.by_type || {};
      [...TQ_TRACKED_TYPES, ...Object.keys(byType).filter((k) => !known.has(k)).map((k) => [k, "mdi:api", k])]
        .forEach(([a, icon, label]) => {
          const v = byType[a] ?? ca[a];
          if (v) src += this._row("tado_ce_tracked", icon, label, String(v), true);
        });
      if (ok(hid)) {
        src += this._row("tado_ce_untracked", "mdi:eye-off-outline", "Tado CE, controlli extra", fmt(hid)) +
          note("Le fa sempre Tado CE, ma non le segna nel suo contatore: le calcoliamo dai suoi aggiornamenti (stima).");
        TQ_UNTRACKED_TYPES.forEach(([a, icon, label]) => {
          if (n(ha[a])) src += this._row("tado_ce_untracked", icon, label, String(ha[a]), true);
        });
      }
      src += this._row("api_calls_today", "mdi:thermometer-auto", "Offset automatico", own ? String(ownN) : "--") +
        note("Letture e scritture dell'offset fatte da Tado Heating Manager.");
      if (ok(svc)) {
        src += this._row("tado_ce_offset_services", "mdi:gesture-tap", "Offset a mano o da automazioni", fmt(svc)) +
          note("Offset cambiati con i servizi di Tado CE (interfaccia, automazioni, script).");
      }
      const syncZones = (unk && unk.attributes && unk.attributes.tado_ce_offset_sync_zones) || [];
      src += this._row("unexplained_calls", "mdi:help-network", "Sconosciute", fmt(unk)) +
        note(syncZones.length
          ? `Probabilmente l'Offset Sync di Tado CE, acceso sulle zone ${syncZones.join(", ")}.`
          : "Il resto: altre app o integrazioni collegate allo stesso account Tado.");
      e.sources.innerHTML = src;
    }
  }

  if (!customElements.get("tado-quota-card")) {
    customElements.define("tado-quota-card", TadoQuotaCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "tado-quota-card",
    name: "Tado Quota",
    description: "Quota API Tado: stato, indicatori, provenienza delle chiamate e grafico.",
  });
}

