/* Tado Heating Manager Cards
 * Card Lovelace per l'integrazione Tado Heating Manager (custom_components/tado_heating_manager).
 * Un solo file con nove card, senza dipendenze e senza build:
 *   custom:heating-planner-card    programmi a fasce di tutte le stanze (Feriali / Weekend)
 *   custom:heating-radiator-card   riga (o blocco, layout: tile) di un termosifone
 *   custom:heating-radiators-card  una riga per ogni termosifone di Tado Heating Manager
 *   custom:heating-summary-card    riepilogo per la Home (termosifoni, programmi, quota); al tocco apre i popup
 *   custom:heating-summary-editable-card  come heating-summary-card, con +/- e tasto della modalita' in ogni riquadro
 *   custom:heating-ac-card         riga (o blocco, layout: tile) di un climatizzatore
 *   custom:heating-acs-card        una riga (o un blocco) per ogni climatizzatore, trovati da soli
 *   custom:heating-usage-card      ore di riscaldamento / valvola chiusa per stanza (oggi, ieri, 7 e 30 giorni)
 *   custom:tado-quota-card         quota API Tado (stato, indicatori, provenienza delle chiamate, voci espandibili)
 * Ogni card e' racchiusa in un blocco { } cosi' le costanti non si scontrano.
 *
 * © 2026 ilbagatta — SPDX-License-Identifier: GPL-3.0-or-later
 * https://github.com/ilbagatta/tado_heating_manager_cards
 */
const THM_CARDS_VERSION = "2.27.0";
// Pagina dell'integrazione (per aggiungere le stanze): navigazione interna del frontend di HA.
const THM_CONFIG_PATH = "/config/integrations/integration/tado_heating_manager";
const thmOpenConfig = () => {
  window.history.pushState(null, "", THM_CONFIG_PATH);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
};
// Colonne dei blocchi delle card di gruppo (heating-radiators-card, heating-acs-card).
const THM_COLUMNS_SELECTOR = {
  select: {
    mode: "dropdown",
    options: [
      { value: "auto", label: "Automatico" },
      { value: "2", label: "2 colonne" },
      { value: "3", label: "3 colonne" },
    ],
  },
};
const THM_COLUMNS_HELPER = "Solo con Aspetto: Blocco. Automatico: quanti blocchi ci stanno (almeno 140 px l'uno).";
// 2 o 3 (stringa dall'editor o numero dal YAML), altrimenti 0 = automatico.
const thmColumns = (v) => {
  const n = parseInt(v, 10);
  return n === 2 || n === 3 ? n : 0;
};
// Stile della lista delle card di gruppo: righe in colonna o blocchi in griglia (.tile, .c2, .c3).
const THM_LIST_CSS = `
          :host { display: block; }
          .list { display: flex; flex-direction: column; gap: 8px; }
          .list.tile { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
          .list.tile.c2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .list.tile.c3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .list.tile ha-card.empty { grid-column: 1 / -1; }
          ha-card.empty { padding: 16px; color: var(--secondary-text-color); }`;

// Ordine scelto nella card: prima gli id di `order` (nell'ordine dato), poi gli altri nell'ordine di partenza.
const thmOrder = (ids, order) => {
  const pos = new Map();
  (Array.isArray(order) ? order : []).forEach((id, i) => id && !pos.has(id) && pos.set(id, i));
  const rank = (id) => (pos.has(id) ? pos.get(id) : Infinity);
  return ids.map((id, i) => [id, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
};
const THM_ORDER_HELPER = "Questi per primi, nell'ordine dell'elenco; gli altri dopo. Solo in questa card.";

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
   *   layout: tile                 # opzionale: blocco come nel riepilogo (predefinito: riga)
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
    layout: "Aspetto",
    temp_termometro: "Termometro della stanza",
    temp_valvola: "Temperatura della valvola",
    fan: "Ventola",
    door: "Porta o finestra",
    offset_prioritario: "Offset mostrato (prioritario)",
    offset_sensor: "Offset di riserva",
  };
  const HR_HELPERS = {
    name: "Vuoto: nome della stanza in Tado Heating Manager.",
    layout: "Blocco: stessi comandi della riga (modalità, ventola, −/+), tre per riga.",
    temp_termometro: "Vuoto: il termometro configurato nella stanza.",
    temp_valvola: "Vuoto: il sensore della valvola HomeKit della stanza.",
    fan: "Vuoto: la ventola configurata nella stanza (se c'è).",
    offset_prioritario: "Vuoto: l'offset gestito da Tado Heating Manager.",
    offset_sensor: "Usato solo se il climate non ha l'attributo offset_celsius.",
  };

  const HR_LAYOUT_SELECTOR = {
    select: { mode: "dropdown", options: [{ value: "row", label: "Riga" }, { value: "tile", label: "Blocco" }] },
  };
  window.THM_HR_LAYOUT_SELECTOR = HR_LAYOUT_SELECTOR;

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

    _isTile() {
      return !!this._config && this._config.layout === "tile";
    }

    getCardSize() {
      return this._isTile() ? 2 : 1;
    }

    getGridOptions() {
      return this._isTile() ? { columns: 4, min_columns: 4 } : { columns: "full" };
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
          { name: "layout", selector: HR_LAYOUT_SELECTOR },
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
      this._closeModeMenu();
      if (this._isTile()) return this._buildTile();
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
          ha-card.heating { background-image: radial-gradient(120% 100% at 50% 100%, rgba(255,122,40,.38), rgba(255,122,40,0) 70%); }
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
          .temp .v.txt { font-size: 11.5px; font-weight: 400; color: var(--secondary-text-color); }
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
      this._bindButtons();
    }

    // pulsanti [data-a]: tocco = azione, pressione lunga = dettagli
    _bindButtons() {
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

    // ---- blocco (layout: tile): stile delle tessere di heating-summary-card, comandi della riga ----
    _buildTile() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; height: 100%; }
          ha-card {
            box-sizing: border-box; height: 100%; padding: 10px 12px 12px; border-radius: var(--ha-card-border-radius, 14px);
            box-shadow: none; overflow: hidden; cursor: pointer; color: var(--primary-text-color);
            border: 2px solid transparent; transition: border-color .4s ease, background .4s ease;
            display: flex; flex-direction: column; gap: 6px; container-type: inline-size;
          }
          ha-card.heat { border-color: rgba(255,138,61,.45); }
          ha-card.hot { border-color: ${HR_ORANGE}; }
          ha-card.heating { background-image: radial-gradient(120% 100% at 50% 100%, rgba(255,122,40,.38), rgba(255,122,40,0) 70%); }
          ha-card.auto { border-color: ${HR_GREEN}; }
          ha-card.off .mid, ha-card.off .roff { opacity: .72; }
          .top { display: flex; align-items: center; gap: 4px; min-height: 32px; }
          .rname { font-size: 14px; font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .btn {
            width: 32px; height: 32px; border-radius: 50%; background: rgba(128,128,128,.18); flex: none;
            display: flex; align-items: center; justify-content: center; cursor: pointer; --mdc-icon-size: 18px;
          }
          .btn ha-icon { display: inline-flex; transform-origin: 50% 90%; }
          .btn.flame.on ha-icon { animation: fiamma-flicker .9s ease-in-out infinite; }
          .mid { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
          .sub { display: flex; align-items: center; gap: 6px; min-height: 18px; margin-top: -4px; }
          .rfan {
            margin-left: auto; flex: none; cursor: pointer; display: inline-flex;
            --mdc-icon-size: 16px; color: var(--secondary-text-color);
          }
          .rfan ha-icon { display: inline-flex; transform-origin: 50% 50%; }
          .rfan.on { color: #29b6f6; }
          .rfan.on ha-icon { animation: ventola-spin 1.2s linear infinite; }
          .rfan.bad { color: var(--disabled-text-color, #9e9e9e); }
          .rtemp { font-size: 26px; font-weight: 400; line-height: 1.1; white-space: nowrap; }
          .rv { font-size: 12px; color: ${HR_VALVE}; font-weight: 500; white-space: nowrap; }
          .rv:empty, .roff:empty { display: none; }
          .roff { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; font-variant-numeric: tabular-nums; }
          .temp {
            height: 36px; border-radius: 14px; background: rgba(128,128,128,.18); margin-top: auto;
            display: grid; grid-template-columns: 36px minmax(0, 1fr) 36px; align-items: center;
          }
          .temp .v { font-size: 15px; font-weight: 500; text-align: center; white-space: nowrap; }
          .temp .v.txt { font-size: 13px; font-weight: 400; color: var(--secondary-text-color); }
          .temp .s {
            width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
            cursor: pointer; --mdc-icon-size: 18px; border-radius: 50%;
          }
          .btn:hover, .temp .s:hover { background: rgba(128,128,128,.3); }
          @container (max-width: 135px) {
            .rname { font-size: 13px; }
            .btn { width: 28px; height: 28px; --mdc-icon-size: 16px; }
            .rtemp { font-size: 21px; }
            .rv, .roff { font-size: 10.5px; }
            .mid { flex-wrap: wrap; row-gap: 0; gap: 4px; }
            .rfan { --mdc-icon-size: 14px; }
            .temp { grid-template-columns: 30px minmax(0, 1fr) 30px; }
            .temp .s { width: 30px; }
          }
          @keyframes fiamma-flicker {
            0%, 100% { transform: scale(1, 1) rotate(0deg); }
            25% { transform: scale(1.06, .94) rotate(-3deg); }
            50% { transform: scale(.95, 1.07) rotate(2deg); }
            75% { transform: scale(1.04, .97) rotate(-2deg); }
          }
          @keyframes ventola-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
        </style>
        <ha-card tabindex="0" role="button">
          <div class="top">
            <div class="rname"></div>
            <div class="btn flame" data-a="mode"><ha-icon icon="mdi:fire"></ha-icon></div>
          </div>
          <div class="mid">
            <span class="rtemp"></span><span class="rv" title="Temperatura della valvola"></span>
          </div>
          <div class="sub">
            <span class="roff" title="Offset della valvola"></span>
            <span class="rfan" data-a="fan"><ha-icon icon="mdi:fan"></ha-icon></span>
          </div>
          <div class="temp">
            <div class="s" data-a="minus"><ha-icon icon="mdi:minus"></ha-icon></div>
            <div class="v"></div>
            <div class="s" data-a="plus"><ha-icon icon="mdi:plus"></ha-icon></div>
          </div>
        </ha-card>`;
      const $ = (q) => this.shadowRoot.querySelector(q);
      this._card = $("ha-card");
      this._el = {
        tile: true,
        name: $(".rname"),
        flame: $(".btn.flame"),
        fan: $(".rfan"),
        fanIcon: $(".rfan ha-icon"),
        temp: $(".rtemp"),
        valve: $(".rv"),
        off: $(".roff"),
        value: $(".temp .v"),
      };
      this._closeDialog();
      this._card.addEventListener("click", () => this._openDialog());
      this._card.addEventListener("keydown", (ev) => {
        if (ev.target === this._card && (ev.key === "Enter" || ev.key === " ")) {
          ev.preventDefault();
          this._openDialog();
        }
      });
      this._bindButtons();
    }

    // offset mostrato: entita' prioritaria / gestita, poi attributo offset_celsius, poi offset_sensor
    _offsetNum(c) {
      let ov;
      const prio = this._offsetEntity();
      if (prio) {
        const p = this._st(prio);
        if (!this._bad(p) && p.state !== "" && !isNaN(Number(p.state))) ov = p.state;
      }
      if (ov === undefined && c) ov = c.attributes.offset_celsius;
      if ((ov === undefined || ov === null) && this._cfg.offset_sensor) {
        const o = this._st(this._cfg.offset_sensor);
        if (!this._bad(o)) ov = o.state;
      }
      return ov === undefined || ov === null || ov === "" || isNaN(Number(ov)) ? null : Number(ov);
    }

    // stessi colori e stati della riga
    _updateTile() {
      const cfg = this._cfg;
      const c = this._st(cfg.entity);
      const e = this._el;
      const fmt = (v) => (v === undefined || v === null || v === "" || isNaN(Number(v)) ? "--" : Number(v).toFixed(1));
      const bad = this._bad(c);
      const heating = !bad && c.state !== "off" && c.attributes.hvac_action === "heating";
      const cls = [];
      if (bad || c.state === "off") cls.push("off");
      if (heating) cls.push("heating");
      if (c && c.state === "auto") cls.push("auto");
      else if (heating) cls.push("hot");
      else if (c && c.state === "heat") cls.push("heat");
      this._card.className = cls.join(" ");

      const color = c && c.state === "auto" ? HR_GREEN : c && c.state === "heat" ? HR_ORANGE : "var(--primary-text-color)";
      e.flame.style.color = color;
      e.flame.classList.toggle("on", heating);
      const pm = c && c.state === "auto" ? HR_GREEN : c && c.state === "heat" ? HR_ORANGE : HR_BLUE;
      this.shadowRoot.querySelectorAll(".temp .s").forEach((x) => (x.style.color = pm));

      e.name.textContent = cfg.name || (c && c.attributes.friendly_name) || cfg.entity;
      const ts = this._st(cfg.temp_termometro);
      const temp = !this._bad(ts) && !isNaN(Number(ts.state)) ? ts.state : c && c.attributes.current_temperature;
      e.temp.textContent = !c ? "n.d." : c.state === "unavailable" ? "n.d." : `${fmt(temp)}°`;
      const vs = this._st(cfg.temp_valvola);
      e.valve.textContent = cfg.temp_valvola && !this._bad(vs) && !isNaN(Number(vs.state)) ? `V ${fmt(vs.state)}°` : "";
      const o = bad ? null : this._offsetNum(c);
      e.off.textContent = o === null ? "" : `Δ ${o > 0 ? "+" : ""}${o.toFixed(1)}°`;
      const isOff = !bad && c.state === "off";
      e.value.classList.toggle("txt", isOff);
      e.value.textContent = bad ? "--" : isOff ? "Spento" : fmt(c.attributes.temperature) === "--" ? "--" : `${fmt(c.attributes.temperature)}°`;

      if (cfg.fan) {
        const f = this._st(cfg.fan);
        const fb = this._bad(f);
        e.fan.style.display = "";
        e.fanIcon.setAttribute("icon", fb ? "mdi:fan-off" : "mdi:fan");
        e.fan.classList.toggle("bad", fb);
        e.fan.classList.toggle("on", !fb && f.state === "on");
        e.fan.title = fb ? "Ventola non disponibile" : f.state === "on" ? "Ventola accesa" : "Ventola spenta";
      } else {
        e.fan.style.display = "none";
      }
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
        const d = a === "plus" ? 0.5 : -0.5;
        if (c.state === "off") {
          // da spento il target di Tado (5 °C) non conta: si riparte dalla temperatura della stanza e si accende
          const ts = this._st(this._cfg.temp_termometro);
          const room = !this._bad(ts) && !isNaN(Number(ts.state)) ? Number(ts.state) : Number(c.attributes.current_temperature ?? 20);
          const t = Math.min(25, Math.max(5, Math.round(room * 2) / 2 + d));
          this._hass.callService("climate", "set_temperature", { entity_id: id, temperature: t, hvac_mode: "heat" });
          return;
        }
        const base = Number(c.attributes.temperature ?? c.attributes.current_temperature ?? 20);
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
      if (this._el.tile) {
        this._updateTile();
        this._dlgUpdate();
        return;
      }
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

      const isOff = !!c && c.state === "off";
      e.value.classList.toggle("txt", isOff);
      e.value.textContent = !c || this._bad(c) ? "--" : isOff ? "Spento" : fmt(c.attributes.temperature);
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
      q(".tset .v").textContent = !c || this._bad(c) ? "--" : c.state === "off" ? "Spento" : fmt(c.attributes.temperature) + "°";

    }
  }

  if (!customElements.get("heating-radiator-card")) {
    customElements.define("heating-radiator-card", HeatingRadiatorCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-radiator-card",
    name: "Heating Radiator",
    description: "Termosifone a riga o a blocco: modalità, ventola, temperatura target, valvola e offset.",
  });
}

// ===== heating-radiators-card.js =====
{
  /* Heating Radiators card: una heating-radiator-card per ogni stanza di Tado Heating Manager, nell'ordine delle stanze.
   * Uso:  type: custom:heating-radiators-card
   *       exclude: [climate.xxx]   # opzionale: stanze da non mostrare
   *       order: [climate.yyy]     # opzionale: questi per primi, in quest'ordine (gli altri nell'ordine delle stanze)
   *       layout: tile             # opzionale: blocchi affiancati invece delle righe
   *       columns: 3               # opzionale, solo con layout: tile: blocchi per riga (2 o 3; predefinito: automatico)
   *       names:                   # opzionale: nome mostrato al posto di quello della stanza
   *         - entity: climate.xxx
   *           name: Scala
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
        schema: [
          { name: "layout", selector: window.THM_HR_LAYOUT_SELECTOR },
          { name: "columns", selector: THM_COLUMNS_SELECTOR },
          { name: "order", selector: { entity: { domain: "climate", multiple: true } } },
          { name: "exclude", selector: { entity: { domain: "climate", multiple: true } } },
          {
            name: "names",
            selector: {
              object: {
                multiple: true,
                label_field: "name",
                fields: {
                  entity: { label: "Termostato (climate)", required: true, selector: { entity: { domain: "climate" } } },
                  name: { label: "Nome", required: true, selector: { text: {} } },
                },
              },
            },
          },
        ],
        computeLabel: (s) =>
          ({
            exclude: "Stanze da non mostrare",
            order: "Ordine",
            layout: "Aspetto",
            columns: "Colonne dei blocchi",
            names: "Nomi personalizzati",
          }[s.name] || s.name),
        computeHelper: (s) =>
          ({
            columns: THM_COLUMNS_HELPER,
            order: THM_ORDER_HELPER,
            exclude: "Le altre stanze di Tado Heating Manager compaiono da sole, nell'ordine delle stanze.",
            names: "Solo in questa card. Le stanze non elencate usano il nome di Tado Heating Manager.",
          }[s.name]),
      };
    }

    _rooms() {
      const st = this._hass.states["sensor.hp_all_rooms"];
      const rooms = (st && st.attributes.rooms) || [];
      const skip = new Set(this._config.exclude || []);
      const list = rooms.filter((r) => r.climate && !skip.has(r.climate));
      const byId = new Map(list.map((r) => [r.climate, r]));
      return thmOrder(list.map((r) => r.climate), this._config.order).map((id) => byId.get(id));
    }

    // Nomi personalizzati: elenco [{entity, name}] (editor) o mappa {climate: nome} (YAML).
    _names() {
      const n = this._config.names;
      const out = {};
      if (Array.isArray(n)) n.forEach((x) => x && x.entity && x.name && (out[x.entity] = String(x.name)));
      else if (n && typeof n === "object") Object.keys(n).forEach((k) => n[k] && (out[k] = String(n[k])));
      return out;
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      const rooms = this._rooms();
      const sig = (this._config.layout || "row") + ":" + thmColumns(this._config.columns) + ":" + rooms.map((r) => r.climate).join("|") + ":" +
        JSON.stringify(this._names());
      if (sig !== this._sig) {
        this._sig = sig;
        this._build(rooms);
      }
      this._cards.forEach((c) => (c.hass = hass));
    }

    _build(rooms) {
      this.shadowRoot.innerHTML = `
        <style>${THM_LIST_CSS}
        </style>
        <div class="list"></div>`;
      const list = this.shadowRoot.querySelector(".list");
      const tile = this._config.layout === "tile";
      list.classList.toggle("tile", tile);
      const cols = tile ? thmColumns(this._config.columns) : 0;
      if (cols) list.classList.add("c" + cols);
      this._cards = [];
      if (!rooms.length) {
        list.innerHTML = `<ha-card class="empty">Nessun termosifone: aggiungi le stanze in Tado Heating Manager.<br>${THM_EMPTY_BTN}</ha-card>`;
        list.querySelector(".thm-cfg").addEventListener("click", thmOpenConfig);
        return;
      }
      const names = this._names();
      rooms.forEach((r) => {
        const card = document.createElement("heating-radiator-card");
        const cfg = { entity: r.climate };
        if (tile) cfg.layout = "tile";
        if (names[r.climate]) cfg.name = names[r.climate];
        card.setConfig(cfg);
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
  /* Heating Summary card: riepilogo per la Home (termosifoni, programmi, quota).
   * Tocco su una stanza: popup della heating-radiator-card (grafico); sui programmi: heating-planner-card in un popup;
   * sulla quota: tado-quota-card in un popup.
   * Uso:  type: custom:heating-summary-card
   *       title: Riscaldamento          # facoltativo
   *       columns: 3                     # facoltativo: tessere delle stanze su 2 o 3 colonne (predefinito 3)
   *       show_planner: true             # facoltativo: prossimo cambio dei programmi
   *       show_quota: true               # facoltativo: barra della quota Tado (se ci sono i sensori)
   *       show_turn_off: true            # facoltativo: tasto "spegni tutti" (button.hp_all_turn_off, due tocchi)
   *       show_actions: true             # facoltativo: tasti "Boost" e "Super boost"
   *                                      # (con il tasto in basso a destra la card si gira: stanze e condizionatori
   *                                      #  di boost e super boost, servizio set_boost_targets)
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
  const HS_OFF_ID = "button.hp_all_turn_off";
  const HS_BOOST_ACTIVE = "binary_sensor.hp_all_boost_active";
  // tasti in fondo: lo stato del pulsante e' l'ora dell'ultima pressione
  const HS_ACTIONS = [
    // short = etichetta sul tasto (tre in una riga), name = nome intero (suggerimento); rgb = colore del tasto
    { id: "button.hp_all_boost", name: "Boost", short: "Boost", icon: "mdi:radiator", rgb: "255,138,61", anim: "heat", active: HS_BOOST_ACTIVE, super: false },
    // super boost: anche i condizionatori; solo se l'integrazione ne ha (attributo climates del pulsante)
    { id: "button.hp_all_super_boost", name: "Super boost (termosifoni e condizionatori)", short: "Super boost", icon: "mdi:rocket-launch", rgb: "171,71,188", anim: "rocket", active: HS_BOOST_ACTIVE, super: true, needsClimates: true },
  ];
  const HS_RTF = typeof Intl !== "undefined" && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat("it", { numeric: "auto" }) : null;
  // "5 giorni fa", "2 ore fa", "ieri"
  const hsAgo = (iso) => {
    const t = Date.parse(iso);
    if (isNaN(t)) return "mai usato";
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 60) return "adesso";
    const steps = [[60, "minute"], [3600, "hour"], [86400, "day"], [86400 * 30, "month"], [86400 * 365, "year"]];
    let unit = steps[0];
    for (const x of steps) if (sec >= x[0]) unit = x;
    const n = Math.floor(sec / unit[0]);
    return HS_RTF ? HS_RTF.format(-n, unit[1]) : `${n} ${unit[1]} fa`;
  };
  const HS_OFF_ARM_MS = 3000;
  // tasto "spegni tutti": tondo; al primo tocco rosso con la domanda, il secondo entro 3 s spegne
  const HS_OFF_CSS = `
          .offb { flex: none; height: 36px; min-width: 36px; padding: 0; border-radius: 18px; box-sizing: border-box;
            display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; user-select: none;
            background: rgba(128,128,128,.18); color: var(--primary-text-color); --mdc-icon-size: 20px;
            font-size: 12.5px; font-weight: 600; white-space: nowrap; transition: background .2s ease, color .2s ease; }
          .offb:hover { background: rgba(128,128,128,.3); }
          .offb span:empty { display: none; }
          .offb.armed { background: ${"#e53935"}; color: #fff; padding: 0 12px 0 9px; }
          .offb.dis { opacity: .4; cursor: default; pointer-events: none; }
          .offb:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }`;
  // retro della card: stanze e condizionatori di boost e super boost
  const HS_BOOST_ID = "button.hp_all_boost";
  const HS_SUPER_ID = "button.hp_all_super_boost";
  const HS_PICK_HOLD = 10000; // scelta mostrata finche' HA la conferma (al massimo 10 s)
  const HS_AC_MODES = ["cool", "dry", "fan_only"];
  // temperature sul retro: campo del servizio -> pulsante, attributo, limiti (come le opzioni dell'integrazione)
  const HS_TEMPS = {
    boost_temperature: { id: "button.hp_all_boost", attr: "temperature", min: 5, max: 25 },
    super_boost_temperature: { id: "button.hp_all_super_boost", attr: "temperature", min: 5, max: 25 },
    super_boost_ac_temperature: { id: "button.hp_all_super_boost", attr: "ac_temperature", min: 16, max: 30 },
    super_boost_ac_temperature_after: { id: "button.hp_all_super_boost", attr: "ac_temperature_after", min: 16, max: 30 },
  };
  const HS_TEMP_DEBOUNCE = 900; // i tocchi su -/+ si sommano: una chiamata dopo la pausa
  const hsShortValue = (v) => (!v ? "" : v === "Spento" ? "spento" : String(v).replace(" °C", "°"));

  class HeatingSummaryCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._sig = "";
      this._rads = {}; // climate -> heating-radiator-card nascosta (serve solo per il suo popup)
      this._pop = null; // popup con heating-planner-card o tado-quota-card
      this._offOn = 0; // termosifoni accesi (per abilitare "spegni tutti")
      this._flipped = false; // retro: stanze e condizionatori del boost
      this._pick = {}; // boost|super|acs -> { list, t } scelta inviata, non ancora confermata
      this._tpend = {}; // campo della temperatura -> { v, t, timer } valore scelto, non ancora confermato
    }

    connectedCallback() {
      // "x minuti fa" va avanti anche senza cambi di stato
      clearInterval(this._tick);
      this._tick = setInterval(() => { this._sig = ""; this._update(); }, 60000);
    }

    disconnectedCallback() {
      clearInterval(this._tick);
      this._tick = null;
      this._closePop();
    }

    setConfig(config) {
      this._config = { title: "Riscaldamento", show_planner: true, show_quota: true, show_turn_off: true, show_actions: true, ...(config || {}) };
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
          {
            name: "columns",
            selector: { select: { mode: "dropdown", options: [{ value: "2", label: "2 colonne" }, { value: "3", label: "3 colonne" }] } },
          },
          {
            type: "grid", name: "", flatten: true,
            schema: [
              { name: "show_planner", selector: { boolean: {} } },
              { name: "show_quota", selector: { boolean: {} } },
              { name: "show_turn_off", selector: { boolean: {} } },
              { name: "show_actions", selector: { boolean: {} } },
            ],
          },
          { name: "exclude", selector: { entity: { domain: "climate", multiple: true } } },
        ],
        computeLabel: (s) =>
          ({ title: "Titolo", columns: "Colonne delle stanze", show_planner: "Prossimo cambio", show_quota: "Quota Tado", show_turn_off: "Tasto spegni tutti", show_actions: "Tasti Boost / Super boost", exclude: "Stanze da non mostrare" }[s.name] || s.name),
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
      Object.values(this._rads).forEach((el) => (el.hass = hass));
      if (this._pop) this._pop.el.hass = hass;
      if (!this._config) return;
      if (!this._quotaIds || !this._quotaFromReg) this._quotaIds = this._resolveQuota();
      const ids = ["sensor.hp_all_rooms", "switch.hp_all_enabled", HS_OFF_ID, HS_BOOST_ACTIVE, ...HS_ACTIONS.map((a) => a.id), ...Object.values(this._quotaIds)];
      this._rooms().forEach((r) => ids.push(r.climate, r.thermometer, r.valve_temperature, r.valve, r.offset_entity, r.fan, `sensor.hp_${r.slug}_current`, `switch.hp_${r.slug}_enabled`));
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
            position: relative; overflow: hidden; padding: 16px; border-radius: var(--ha-card-border-radius, 16px);
            color: var(--primary-text-color); transition: background .6s ease;
          }
          ha-card::before {
            content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .6s ease;
            /* in heating: alone leggero dal bordo alto, alto in px (non segue l'altezza della card): finisce sopra le stanze */
            background: radial-gradient(ellipse 75% 85px at 50% 0%, rgba(255,138,61,.22), rgba(255,138,61,0) 100%);
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
          .rooms { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 14px; }
          .rooms.c2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .room {
            border-radius: 14px; padding: 10px 11px; background: rgba(128,128,128,.10); border: 1.5px solid transparent;
            min-width: 0; transition: all .4s ease;
          }
          .room.on { border-color: rgba(255,138,61,.35); }
          /* in heating: alone dal bordo inferiore, come la heating-radiator-card */
          .room.heating { background-image: radial-gradient(120% 100% at 50% 100%, rgba(255,122,40,.38), rgba(255,122,40,0) 70%); border-color: rgba(255,138,61,.6); }
          .room.auto { border-color: rgba(76,175,80,.55); }
          .room.off { opacity: .72; }
          [data-room], [data-pop] { cursor: pointer; -webkit-tap-highlight-color: transparent; }
          [data-room]:hover { background-color: rgba(128,128,128,.18); }
          [data-pop] { border-radius: 10px; margin: -4px -6px; padding: 4px 6px; transition: background .2s ease; }
          [data-pop]:hover { background: rgba(128,128,128,.12); }
          [data-room]:focus-visible, [data-pop]:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
          .rads { display: none; }
          .head .offb { position: relative; }
          .head.arming .avg { display: none; }${HS_OFF_CSS}
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
          .roff { flex: none; font-size: 10.5px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
          .rv { font-size: 11px; color: #ba68c8; margin-left: 5px; font-weight: 500; white-space: nowrap; vertical-align: 2px; }
          .rsub { font-size: 11.5px; color: var(--secondary-text-color); margin-top: 2px; white-space: nowrap; display: flex; justify-content: space-between; gap: 6px; }
          .room.heating .rsub > span:first-child { color: ${HS_ORANGE}; }
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
          /* tasti in fondo: tutti su una riga, colorati ognuno col suo colore (--c = r,g,b) */
          .acts { display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: 8px; }
          .act { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 5px; min-width: 0;
            padding: 10px 6px 9px; border-radius: 14px; cursor: pointer; overflow: hidden; -webkit-tap-highlight-color: transparent;
            background: rgba(128,128,128,.10); border: 1.5px solid transparent;
            transition: border-color .3s ease, background-color .2s ease, transform .1s ease; }
          /* spento: fondo neutro come i riquadri delle stanze, colore solo nell'icona; acceso: tutto colorato */
          .act:hover { background-color: rgba(128,128,128,.16); border-color: rgba(var(--c), .35); }
          .act:active { transform: scale(.97); }
          .act:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
          .act .ic { width: 34px; height: 34px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center;
            background: rgba(var(--c), .22); color: rgb(var(--c)); --mdc-icon-size: 19px; transition: all .3s ease; }
          .act .n { font-size: 12.5px; font-weight: 600; line-height: 1.15; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .act .w { font-size: 11px; color: var(--secondary-text-color); line-height: 1.1; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .act.on { border-color: rgba(var(--c), .75);
            background: radial-gradient(120% 90% at 50% 100%, rgba(var(--c), .38), rgba(var(--c), 0) 75%), rgba(var(--c), .08); }
          .act.on .ic { background: rgb(var(--c)); color: #fff; box-shadow: 0 0 0 4px rgba(var(--c), .18); animation: hs-pulse 1.8s ease-in-out infinite; }
          .act.on .w { color: rgb(var(--c)); font-weight: 600; }
          .act.sent .ic { background: rgb(var(--c)); color: #fff; }
          /* icona animata quando il tasto e' acceso: termosifone che "scalda", razzo che vibra in partenza */
          .act.on .ic ha-icon { display: inline-flex; }
          .act.on.a-heat .ic ha-icon { animation: hs-flicker 1s ease-in-out infinite; transform-origin: 50% 90%; }
          .act.on.a-rocket .ic ha-icon { animation: hs-rocket .9s ease-in-out infinite; }
          @keyframes hs-rocket {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            20% { transform: translate(-1px, 1px) rotate(-4deg); }
            40% { transform: translate(1px, -2px) rotate(3deg); }
            60% { transform: translate(-1px, -1px) rotate(-2deg); }
            80% { transform: translate(1px, 1px) rotate(2deg); }
          }
          @keyframes hs-pulse { 0%, 100% { box-shadow: 0 0 0 3px rgba(var(--c), .18); } 50% { box-shadow: 0 0 0 7px rgba(var(--c), .06); } }
          .empty { position: relative; margin-top: 12px; font-size: 13px; color: var(--secondary-text-color); }
          /* tasto in basso a destra: gira la card (retro = stanze e condizionatori del boost) */
          .fliprow { position: relative; display: flex; justify-content: flex-end; margin: 6px -8px -10px 0; }
          .fliprow[hidden] { display: none; }
          .flipb { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
            cursor: pointer; color: var(--secondary-text-color); --mdc-icon-size: 18px; -webkit-tap-highlight-color: transparent;
            transition: background .2s ease, color .2s ease; }
          .flipb:hover { background: rgba(128,128,128,.16); color: var(--primary-text-color); }
          .flipb:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
          ha-card.flipped .flipb { background: var(--primary-color); color: var(--text-primary-color, #fff); }
          .back { display: none; position: relative; }
          ha-card.flipped .back { display: block; }
          ha-card.flipped::before, ha-card.flipped > .head, ha-card.flipped > .rooms, ha-card.flipped > .foot { display: none; }
          .bsec { margin-top: 14px; }
          .bt { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
          .bt ha-icon { --mdc-icon-size: 18px; color: rgb(var(--c)); flex: none; }
          .bt .cnt { margin-left: auto; font-size: 11.5px; font-weight: 500; color: var(--secondary-text-color); }
          .chips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
          .chip { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 8px 10px; border-radius: 12px; cursor: pointer;
            background: rgba(128,128,128,.10); border: 1.5px solid transparent; font-size: 12.5px; color: var(--secondary-text-color);
            -webkit-tap-highlight-color: transparent; user-select: none; transition: all .2s ease; }
          .chip span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .chip ha-icon { --mdc-icon-size: 18px; flex: none; display: inline-flex; }
          .chip:hover { background: rgba(128,128,128,.16); }
          .chip:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
          .chip.on { border-color: rgba(var(--c), .6); background: rgba(var(--c), .14); color: var(--primary-text-color); font-weight: 600; }
          .chip.on ha-icon { color: rgb(var(--c)); }
          .chip.wait { opacity: .65; }
          .trow { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12.5px; color: var(--secondary-text-color); }
          .trow > span { flex: 1; min-width: 0; }
          .stp { display: flex; align-items: center; gap: 4px; flex: none; }
          .stp b { min-width: 52px; text-align: center; font-size: 15px; font-weight: 600; color: var(--primary-text-color);
            font-variant-numeric: tabular-nums; }
          .stp b.wait { color: rgb(var(--c)); }
          .sb { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer;
            background: rgba(var(--c), .16); color: rgb(var(--c)); --mdc-icon-size: 18px; user-select: none;
            -webkit-tap-highlight-color: transparent; transition: background .2s ease; }
          .sb:hover { background: rgba(var(--c), .28); }
          .sb:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
          .sb.dis { opacity: .35; pointer-events: none; }
          .bnote { font-size: 11.5px; color: var(--secondary-text-color); margin-top: 6px; }
          @keyframes hs-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes hs-flicker {
            0%, 100% { transform: scale(1, 1) rotate(0deg); }
            25% { transform: scale(1.06, .94) rotate(-3deg); }
            50% { transform: scale(.95, 1.07) rotate(2deg); }
            75% { transform: scale(1.04, .97) rotate(-2deg); }
          }
          @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
        </style>
        <ha-card>
          <div class="head">
            <div class="hicon"><ha-icon icon="mdi:fire"></ha-icon></div>
            <div class="htxt"><div class="title"></div><div class="sub"></div></div>
            <div class="avg"><div class="v"></div><div class="l">media</div></div>
            <div class="offb" data-off role="button" tabindex="0" title="Spegni tutti i termosifoni"><ha-icon icon="mdi:power"></ha-icon><span></span></div>
          </div>
          <div class="rooms"></div>
          <div class="foot"></div>
          <div class="back"></div>
          <div class="fliprow" hidden><div class="flipb" data-flip role="button" tabindex="0"><ha-icon></ha-icon></div></div>
        </ha-card>
        <div class="rads"></div>`;
      const $ = (q) => this.shadowRoot.querySelector(q);
      this._el = { card: $("ha-card"), title: $(".title"), sub: $(".sub"), avg: $(".avg .v"), avgWrap: $(".avg"), rooms: $(".rooms"), foot: $(".foot"), rads: $(".rads"), off: $(".offb"), back: $(".back"), flipRow: $(".fliprow"), flip: $(".flipb") };
      this._flipped = false;
      this._pick = {};
      // le card nascoste vecchie (setConfig rifatto) non servono piu'
      Object.values(this._rads).forEach((el) => el.remove());
      this._rads = {};
      const go = (ev) => {
        const room = ev.target.closest("[data-room]");
        const pop = ev.target.closest("[data-pop]");
        const off = ev.target.closest("[data-off]");
        const press = ev.target.closest("[data-press]");
        const flip = ev.target.closest("[data-flip]");
        const pick = ev.target.closest("[data-pick]");
        const temp = ev.target.closest("[data-temp]");
        if (flip) this._flip();
        else if (temp) this._tempTap(temp.dataset.temp, Number(temp.dataset.d));
        else if (pick) this._pickTap(pick.dataset.pick, pick.dataset.id);
        else if (off) this._offTap(off);
        else if (press) this._press(press);
        else if (room) this._openRoom(room.dataset.room);
        else if (pop) this._openPop(pop.dataset.pop);
        else return false;
        return true;
      };
      this._el.card.addEventListener("click", go);
      this._el.card.addEventListener("keydown", (ev) => {
        if ((ev.key === "Enter" || ev.key === " ") && go(ev)) ev.preventDefault();
      });
    }

    // Boost / Super boost: un tocco preme il pulsante dell'integrazione; sul boost in corso lo ferma
    // (stop_boost rimette termosifoni e condizionatori com'erano prima)
    _press(el) {
      if (!this._hass) return;
      if (el.dataset.stop) this._hass.callService("tado_heating_manager", "stop_boost", {});
      else this._hass.callService("button", "press", { entity_id: el.dataset.press });
      el.classList.add("sent");
      setTimeout(() => el.classList.remove("sent"), 700);
    }

    // Gira la card (mezzo giro, cambio faccia, mezzo giro); l'altezza resta quella del fronte se il retro e' piu' basso
    _flip() {
      const card = this._el.card;
      const swap = () => {
        if (!this._flipped) card.style.minHeight = `${card.offsetHeight}px`;
        else card.style.minHeight = "";
        this._flipped = !this._flipped;
        card.classList.toggle("flipped", this._flipped);
        this._update();
      };
      const still = !card.animate || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      if (still) return swap();
      if (this._flipping) return;
      this._flipping = true;
      // cambio faccia con un timer e non con animation.finished: se l'animazione non gira (scheda in background)
      // la card non resta girata a meta'
      const half = (from, to, easing) =>
        card.animate([{ transform: `perspective(1200px) rotateY(${from}deg)` }, { transform: `perspective(1200px) rotateY(${to}deg)` }], { duration: 170, easing, fill: "none" });
      const first = half(0, 90, "ease-in");
      setTimeout(() => {
        first.cancel();
        swap();
        const second = half(-90, 0, "ease-out");
        setTimeout(() => { second.cancel(); this._flipping = false; }, 200);
      }, 170);
    }

    // scelta di boost (stanze), super boost (stanze) e condizionatori: quella confermata da HA, o quella appena inviata
    _picked(kind) {
      const b = this._st(HS_BOOST_ID);
      const sb = this._st(HS_SUPER_ID);
      const attr = kind === "boost" ? b && b.attributes.rooms : kind === "super" ? sb && sb.attributes.rooms : sb && sb.attributes.climates;
      const server = Array.isArray(attr) ? attr : [];
      const p = this._pick[kind];
      if (p) {
        const same = p.list.length === server.length && p.list.every((x) => server.includes(x));
        if (same || Date.now() - p.t > HS_PICK_HOLD) delete this._pick[kind];
        else return { list: p.list, wait: true };
      }
      return { list: server, wait: false };
    }

    // condizionatori proponibili: caldo + un modo da condizionatore, non termostati delle stanze, non nascosti; piu' i gia' scelti
    _acCandidates(rooms, chosen) {
      const used = new Set();
      rooms.forEach((r) => [r.climate, r.valve].forEach((id) => id && used.add(id)));
      const reg = this._hass.entities || {};
      const out = Object.values(this._hass.states).filter((s) => {
        if (!s.entity_id.startsWith("climate.") || used.has(s.entity_id)) return false;
        if (reg[s.entity_id] && reg[s.entity_id].hidden) return false;
        const modes = s.attributes.hvac_modes || [];
        return modes.includes("heat") && modes.some((m) => HS_AC_MODES.includes(m));
      }).map((s) => s.entity_id);
      chosen.forEach((id) => !out.includes(id) && out.push(id));
      const name = (id) => { const s = this._st(id); return String((s && s.attributes.friendly_name) || id); };
      return out.map((id) => ({ id, name: name(id) })).sort((a, b) => a.name.localeCompare(b.name, "it"));
    }

    _pickTap(kind, id) {
      if (!this._hass) return;
      const cur = this._picked(kind).list;
      const set = new Set(cur);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      // ordine: quello delle stanze / dei condizionatori proposti
      const st = this._st("sensor.hp_all_rooms");
      const rooms = (st && st.attributes.rooms) || [];
      const order = kind === "acs" ? this._acCandidates(rooms, [...set]).map((x) => x.id) : rooms.map((r) => r.slug);
      const list = order.filter((x) => set.has(x));
      this._pick[kind] = { list, t: Date.now() };
      const field = { boost: "boost_rooms", super: "super_boost_rooms", acs: "super_boost_climates" }[kind];
      Promise.resolve(this._hass.callService("tado_heating_manager", "set_boost_targets", { [field]: list })).catch(() => {
        delete this._pick[kind];
        this._update();
      });
      this._update();
      setTimeout(() => this._update(), HS_PICK_HOLD + 100);
    }

    // temperatura sul retro: quella confermata da HA o quella appena scelta (null se l'integrazione non la espone)
    _tempVal(field) {
      const def = HS_TEMPS[field];
      const st = this._st(def.id);
      const server = hsNum(st && st.attributes[def.attr]);
      const p = this._tpend[field];
      if (p) {
        if (!p.timer && (server === p.v || Date.now() - p.t > HS_PICK_HOLD)) delete this._tpend[field];
        else return { v: p.v, wait: true };
      }
      return { v: server, wait: false };
    }

    _tempTap(field, d) {
      const def = HS_TEMPS[field];
      const cur = this._tempVal(field).v;
      if (!this._hass || !def || cur === null || !d) return;
      const v = Math.min(def.max, Math.max(def.min, Math.round((cur + d) * 2) / 2));
      const p = this._tpend[field] || {};
      clearTimeout(p.timer);
      p.v = v;
      p.t = Date.now();
      p.timer = setTimeout(() => {
        p.timer = null;
        p.t = Date.now();
        Promise.resolve(this._hass.callService("tado_heating_manager", "set_boost_targets", { [field]: p.v })).catch(() => {
          delete this._tpend[field];
          this._update();
        });
        setTimeout(() => this._update(), HS_PICK_HOLD + 100);
      }, HS_TEMP_DEBOUNCE);
      this._tpend[field] = p;
      this._update();
    }

    _tempHtml(field, label) {
      const def = HS_TEMPS[field];
      const x = this._tempVal(field);
      if (x.v === null) return "";
      const btn = (d, icon) => `<div class="sb${(d < 0 ? x.v <= def.min : x.v >= def.max) ? " dis" : ""}" data-temp="${field}" data-d="${d}" role="button" tabindex="0" title="${d < 0 ? "Meno" : "Piu'"}"><ha-icon icon="${icon}"></ha-icon></div>`;
      return `<div class="trow"><span>${hsEsc(label)}</span><div class="stp">${btn(-0.5, "mdi:minus")}<b class="${x.wait ? "wait" : ""}">${x.v.toFixed(1)}°</b>${btn(0.5, "mdi:plus")}</div></div>`;
    }

    _chipsHtml(kind, items, rgb) {
      const p = this._picked(kind);
      const html = items.map((it) => {
        const on = p.list.includes(it.id);
        return `<div class="chip${on ? " on" : ""}${p.wait ? " wait" : ""}" data-pick="${kind}" data-id="${hsEsc(it.id)}" role="checkbox" aria-checked="${on}" tabindex="0">
            <ha-icon icon="${on ? "mdi:check-circle" : "mdi:circle-outline"}"></ha-icon><span>${hsEsc(it.name)}</span></div>`;
      }).join("");
      const n = items.filter((it) => p.list.includes(it.id)).length;
      return { html: `<div class="chips" style="--c:${rgb}">${html}</div>`, n };
    }

    _renderBack() {
      const st = this._st("sensor.hp_all_rooms");
      const rooms = (st && st.attributes.rooms) || [];
      const items = rooms.map((r) => ({ id: r.slug, name: r.name }));
      const boost = this._chipsHtml("boost", items, "255,138,61");
      const sup = this._chipsHtml("super", items, "171,71,188");
      const acItems = this._acCandidates(rooms, this._picked("acs").list);
      const acs = this._chipsHtml("acs", acItems, "171,71,188");
      const sec = (rgb, icon, title, c, total, body) => `<div class="bsec" style="--c:${rgb}">
          <div class="bt"><ha-icon icon="${icon}"></ha-icon><span>${title}</span><span class="cnt">${c}/${total}</span></div>${body}</div>`;
      this._el.back.innerHTML = `
        <div class="head"><div class="hicon"><ha-icon icon="mdi:tune-variant"></ha-icon></div>
          <div class="htxt"><div class="title">Boost e super boost</div><div class="sub">Tocca per cambiare · vale dal prossimo avvio</div></div></div>
        ${sec("255,138,61", "mdi:radiator", "Boost · termosifoni", boost.n, items.length,
          boost.html + this._tempHtml("boost_temperature", "Temperatura"))}
        ${sec("171,71,188", "mdi:rocket-launch", "Super boost · termosifoni", sup.n, items.length,
          sup.html + this._tempHtml("super_boost_temperature", "Temperatura"))}
        ${sec("171,71,188", "mdi:air-conditioner", "Super boost · condizionatori", acs.n, acItems.length,
          (acItems.length ? acs.html : '<div class="bnote">Nessun condizionatore con il caldo trovato.</div>')
          + this._tempHtml("super_boost_ac_temperature", "All'inizio")
          + this._tempHtml("super_boost_ac_temperature_after", "Dopo"))}
        ${acItems.length && !acs.n ? '<div class="bnote">Senza condizionatori il tasto Super boost non compare.</div>' : ""}`;
    }

    // "Spegni tutti": primo tocco = conferma (3 s), secondo = button.hp_all_turn_off
    _offTap(btn) {
      if (!this._hass || btn.classList.contains("dis")) return;
      if (btn._armT) {
        clearTimeout(btn._armT);
        btn._armT = null;
        this._offArm(btn, false);
        this._hass.callService("button", "press", { entity_id: HS_OFF_ID });
        return;
      }
      this._offArm(btn, true);
      btn._armT = setTimeout(() => {
        btn._armT = null;
        this._offArm(btn, false);
      }, HS_OFF_ARM_MS);
    }

    _offArm(btn, on) {
      btn.classList.toggle("armed", on);
      if (btn.parentElement) btn.parentElement.classList.toggle("arming", on); // nella card: la media lascia spazio
      btn.querySelector("span").textContent = on ? "Spegni tutti?" : "";
    }

    // stato dei tasti (card e popup dei programmi): nascosti senza il pulsante, disattivati se tutto e' spento
    _offSync() {
      const btns = [this._el && this._el.off, this._pop && this._pop.off].filter(Boolean);
      const has = !!this._st(HS_OFF_ID) && this._config.show_turn_off !== false;
      btns.forEach((b) => {
        b.style.display = has ? "" : "none";
        const dis = has && (!this._offOn || this._st(HS_OFF_ID).state === "unavailable");
        if (has && dis && b._armT) { clearTimeout(b._armT); b._armT = null; this._offArm(b, false); }
        b.classList.toggle("dis", has && dis);
      });
    }

    // Popup della heating-radiator-card (grafico, modi, temperatura): card nascosta dentro questa, cosi' i suoi
    // eventi (more-info) arrivano a HA.
    _openRoom(climate) {
      if (!this._hass || !climate) return;
      let el = this._rads[climate];
      if (!el) {
        if (!customElements.get("heating-radiator-card")) return;
        el = document.createElement("heating-radiator-card");
        el.setConfig({ entity: climate });
        this._el.rads.appendChild(el);
        this._rads[climate] = el;
      }
      el.hass = this._hass;
      el._openDialog();
    }

    // Popup con un'altra card del file (programmi o quota).
    _openPop(kind) {
      if (this._pop || !this._hass) return;
      const tag = kind === "planner" ? "heating-planner-card" : "tado-quota-card";
      if (!customElements.get(tag)) return;
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          .ov { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.55);
            display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
          .dlg { position: relative; background: var(--card-background-color, #1c1c1c); color: var(--primary-text-color);
            border-radius: 20px; width: min(${kind === "planner" ? 720 : 560}px, 100%); max-height: 100%; overflow-y: auto;
            box-sizing: border-box; font-family: var(--paper-font-body1_-_font-family, inherit);
            --ha-card-box-shadow: none; --ha-card-border-width: 0; }
          .x { position: absolute; top: 8px; right: 8px; z-index: 1; width: 36px; height: 36px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; cursor: pointer; background: var(--card-background-color, #1c1c1c); }
          .x:hover { background: rgba(128,128,128,.32); }
          .body { padding-top: 4px; }
          .dlg > .offb { position: absolute; top: 8px; right: 52px; z-index: 1; }${HS_OFF_CSS}
        </style>
        <div class="ov"><div class="dlg">
          ${kind === "planner" ? '<div class="offb" data-off role="button" tabindex="0" title="Spegni tutti i termosifoni"><ha-icon icon="mdi:power"></ha-icon><span></span></div>' : ""}
          <div class="x" title="Chiudi"><ha-icon icon="mdi:close"></ha-icon></div>
          <div class="body"></div>
        </div></div>`;
      const el = document.createElement(tag);
      el.setConfig(kind === "planner" ? { title: this._config.title || "Riscaldamento" } : {});
      el.hass = this._hass;
      root.querySelector(".body").appendChild(el);
      document.body.appendChild(host);
      this._pop = { host, el, off: root.querySelector(".offb") };
      if (this._pop.off) {
        this._pop.off.addEventListener("click", () => this._offTap(this._pop.off));
        this._pop.off.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); this._offTap(this._pop.off); }
        });
        this._offSync();
      }
      root.querySelector(".ov").addEventListener("click", (ev) => {
        if (ev.target.classList.contains("ov")) this._closePop();
      });
      root.querySelector(".x").addEventListener("click", () => this._closePop());
      // il popup sta fuori da HA: il more-info lo rimanda questa card (e chiude il popup, che starebbe sopra)
      host.addEventListener("hass-more-info", (ev) => {
        ev.stopPropagation();
        this._closePop();
        this.dispatchEvent(new CustomEvent("hass-more-info", { detail: ev.detail, bubbles: true, composed: true }));
      });
      this._popKey = (ev) => ev.key === "Escape" && this._closePop();
      this._popNav = () => this._closePop(); // es. "Aggiungi le stanze" del planner
      document.addEventListener("keydown", this._popKey);
      window.addEventListener("location-changed", this._popNav);
    }

    _closePop() {
      if (!this._pop) return;
      document.removeEventListener("keydown", this._popKey);
      window.removeEventListener("location-changed", this._popNav);
      this._pop.host.remove();
      this._pop = null;
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
      // valvola: sensore HomeKit della temperatura, altrimenti l'attributo del climate HomeKit
      const vs = this._st(r.valve_temperature);
      const vc = this._st(r.valve);
      const valve = hsNum(vs && vs.state) ?? hsNum(vc && vc.attributes.current_temperature);
      // offset: quello gestito da Tado Heating Manager, altrimenti l'attributo del climate
      const os = this._st(r.offset_entity);
      const offset = hsNum(os && os.state) ?? hsNum(c && c.attributes.offset_celsius);
      const f = this._st(r.fan);
      const fan = !r.fan ? null : !f || f.state === "unavailable" || f.state === "unknown" ? "bad" : f.state === "on" ? "on" : "off";
      return { r, c, temp, valve, offset, bad, off, heating, target, next, fan, auto: !off && c.state === "auto" };
    }

    // riquadro di una stanza (la versione modificabile lo allunga)
    _tileHtml(x) {
      const cls = ["room", x.off ? "off" : "on", x.heating ? "heating" : "", x.auto ? "auto" : ""].join(" ");
      const sub = x.bad ? "n.d." : x.off ? "spento" : x.target !== null ? `→ ${x.target.toFixed(1)}°` : "acceso";
      const fan = x.fan
        ? `<span class="rfan ${x.fan === "on" ? "on" : ""}" title="Ventola ${x.fan === "on" ? "accesa" : x.fan === "off" ? "spenta" : "non disponibile"}"><ha-icon icon="${x.fan === "bad" ? "mdi:fan-off" : "mdi:fan"}"></ha-icon></span>`
        : "";
      return `<div class="${cls}" data-room="${hsEsc(x.r.climate)}" tabindex="0" role="button">
          <div class="rtop"><div class="rname">${hsEsc(x.r.name)}</div>${fan}<ha-icon class="rflame" icon="mdi:fire"></ha-icon></div>
          <div class="rtemp">${hsTemp(x.temp)}°${x.valve !== null ? `<span class="rv" title="Temperatura della valvola">V ${hsTemp(x.valve)}°</span>` : ""}</div>
          <div class="rsub"><span>${hsEsc(sub)}</span>${x.offset !== null ? `<span class="roff" title="Offset della valvola">Δ ${x.offset > 0 ? "+" : ""}${x.offset.toFixed(1)}°</span>` : ""}</div>
        </div>`;
    }

    _update() {
      if (!this._el || !this._hass) return;
      const e = this._el;
      const rooms = this._rooms().map((r) => this._room(r));
      const on = rooms.filter((x) => !x.off).length;
      const heating = rooms.filter((x) => x.heating).length;
      this._offOn = on;
      this._offSync();
      const temps = rooms.map((x) => x.temp).filter((t) => t !== null);
      const avg = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;

      e.card.classList.toggle("warm", heating > 0);
      e.rooms.classList.toggle("c2", thmColumns(this._config.columns) === 2);
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
        ? rooms.map((x) => this._tileHtml(x)).join("")
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
        foot.push(`<div class="plan" data-pop="planner" tabindex="0" role="button"><div class="line"><ha-icon icon="mdi:calendar-clock"></ha-icon><span class="t">${head}</span>
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
          foot.push(`<div class="line" data-pop="quota" tabindex="0" role="button"><ha-icon icon="mdi:api" style="color:${color}"></ha-icon>
            <div class="q"><div style="display:flex;gap:8px"><span class="t">Quota Tado <b>${pct.toFixed(0)}%</b></span><span>${hsEsc(parts)}</span></div>
            <div class="bar"><div style="width:${Math.min(100, Math.max(0, pct))}%;background:${color}"></div></div></div></div>`);
        }
      }
      if (this._config.show_actions) {
        const acts = HS_ACTIONS.filter((a) => {
          const st = this._st(a.id);
          return st && (!a.needsClimates || (Array.isArray(st.attributes.climates) && st.attributes.climates.length));
        }).map((a) => {
          const st = this._st(a.id);
          const act = a.active ? this._st(a.active) : null;
          const on = !!act && act.state === "on" && !!act.attributes.super === a.super;
          const until = on ? hsTime(act.attributes.until) : "";
          const when = on ? (until ? `fino alle ${until}` : "attivo") : st.state === "unavailable" ? "non disponibile" : hsAgo(st.state);
          return `<div class="act${on ? " on" : ""} a-${a.anim}" style="--c:${a.rgb}" data-press="${hsEsc(a.id)}"${on ? ' data-stop="1"' : ""} role="button" tabindex="0" title="${hsEsc(a.name)} · ${hsEsc(when)}${on ? " · tocca per fermare" : ""}">
              <div class="ic"><ha-icon icon="${hsEsc(st.attributes.icon || a.icon)}"></ha-icon></div>
              <div class="n">${hsEsc(a.short)}</div><div class="w">${hsEsc(when)}</div></div>`;
        });
        if (acts.length) foot.push(`<div class="acts">${acts.join("")}</div>`);
      }
      e.foot.innerHTML = foot.join("");
      // tasto del retro: solo con i tasti in fondo e un'integrazione che espone le stanze del boost
      const b = this._st(HS_BOOST_ID);
      const canFlip = !!this._config.show_actions && !!b && Array.isArray(b.attributes.rooms);
      if (!canFlip && this._flipped) {
        this._flipped = false;
        e.card.classList.remove("flipped");
        e.card.style.minHeight = "";
      }
      e.flipRow.hidden = !canFlip;
      e.flip.title = this._flipped ? "Fatto: torna al riepilogo" : "Stanze e condizionatori di boost e super boost";
      e.flip.querySelector("ha-icon").setAttribute("icon", this._flipped ? "mdi:check" : "mdi:tune-variant");
      if (this._flipped) this._renderBack();
    }
  }

  if (!customElements.get("heating-summary-card")) {
    customElements.define("heating-summary-card", HeatingSummaryCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-summary-card",
    name: "Heating Summary",
    description: "Riepilogo del riscaldamento per la Home: termosifoni, programmi e quota, ognuno con il suo popup.",
    preview: true,
  });

  /* Heating Summary Editable card: come heating-summary-card, ma ogni riquadro ha, su una riga, -/+ della temperatura
   * e un tasto con la modalita' attuale che apre la tendina (Caldo / Auto / Spento). Il resto del riquadro apre il
   * popup del termosifone.
   * Uso:  type: custom:heating-summary-editable-card   (stesse opzioni; columns predefinito 2)
   * I tocchi su -/+ si sommano: una sola climate.set_temperature dopo HSE_DEBOUNCE ms di pausa (meno chiamate Tado).
   */
  const HSE_ORDER = ["heat", "auto", "off"];
  const HSE_MODE = {
    heat: { icon: "mdi:fire", label: "Caldo", color: HS_ORANGE },
    auto: { icon: "mdi:calendar-clock", label: "Auto", color: HS_GREEN },
    off: { icon: "mdi:power", label: "Spento", color: "var(--primary-text-color)" },
  };
  const HSE_BAD = { icon: "mdi:help", label: "Non disponibile" };
  const HSE_DEBOUNCE = 900;
  const HSE_HOLD = 10000; // valore scelto mostrato finche' HA non lo conferma (al massimo 10 s)
  const hseClamp = (v) => Math.min(25, Math.max(5, Math.round(v * 2) / 2));

  class HeatingSummaryEditableCard extends HeatingSummaryCard {
    constructor() {
      super();
      this._pend = {}; // climate -> { v, on, timer, sent }
      this._menu = null; // tendina dei modi aperta: { el, id, off }
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this._closeMenu();
    }

    setConfig(config) {
      super.setConfig({ columns: 2, ...(config || {}) });
    }

    getCardSize() {
      return 6;
    }

    _build() {
      super._build();
      const style = document.createElement("style");
      style.textContent = `
          .ctl { display: flex; align-items: center; gap: 3px; margin-top: 8px; }
          .ctl .tv { flex: 1; min-width: 0; text-align: center; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .ctl .tv.pend { color: var(--primary-color); }
          .room.off .ctl .tv { font-weight: 400; font-size: 12px; color: var(--secondary-text-color); }
          .b { flex: none; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
            background: rgba(128,128,128,.2); cursor: pointer; --mdc-icon-size: 18px; user-select: none; transition: background .15s ease; }
          .b:hover { background: rgba(128,128,128,.34); }
          .b:active { transform: scale(.92); }
          .b:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
          .ctl .mb { margin-left: 2px; color: #fff; }
          .ctl .mb.heat { background: ${HS_ORANGE}; }
          .ctl .mb.auto { background: ${HS_GREEN}; }
          .ctl .mb.off, .ctl .mb.bad { background: rgba(128,128,128,.55); }
          .ctl .mb:hover { filter: brightness(1.1); }
          .room.off { opacity: 1; }
          .room.off .rtop, .room.off .rtemp, .room.off .rsub { opacity: .72; }
          .rsub .tv2 { display: none; }
          .rsub .tv2.pend { color: var(--primary-color); }
          /* 3 colonne: il valore va nel sottotitolo, -/+ ai lati */
          .rooms.c3 .room { padding: 10px 8px; }
          .rooms.c3 .rsub .tv2 { display: inline; }
          .rooms.c3 .ctl .tv { display: none; }
          .rooms.c3 .ctl { justify-content: space-between; gap: 2px; }
          .rooms.c3 .ctl .b { width: 26px; height: 26px; }
          .rooms.c3 .ctl .mb { margin-left: 0; }`;
      this.shadowRoot.appendChild(style);
      // i tasti vengono prima del tocco sul riquadro (fase di cattura: il popup non si apre)
      const act = (ev) => {
        const b = ev.target.closest("[data-act]");
        if (!b) return false;
        ev.stopPropagation();
        ev.preventDefault();
        if (b.dataset.act === "menu") this._toggleMenu(b);
        else this._step(b.dataset.c, b.dataset.act === "plus" ? 0.5 : -0.5);
        return true;
      };
      this._el.card.addEventListener("click", act, true);
      this._el.card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") act(ev);
      }, true);
    }

    _tileHtml(x) {
      const id = x.r.climate;
      const p = this._pend[id];
      if (p && p.sent && !x.off && x.target === p.v) this._dropPend(id); // HA ha confermato
      const pend = this._pend[id];
      const html = super._tileHtml(x);
      const e = hsEsc(id);
      const val = pend ? `${pend.v.toFixed(1)}°` : x.bad ? "n.d." : x.off ? "Spento" : x.target !== null ? `${x.target.toFixed(1)}°` : "--";
      const cur = x.c && HSE_MODE[x.c.state] ? x.c.state : null;
      const mi = cur ? HSE_MODE[cur] : HSE_BAD;
      const ctl = `
                <div class="ctl">
                  <div class="b" data-act="minus" data-c="${e}" role="button" tabindex="0" title="Meno 0,5°"><ha-icon icon="mdi:minus"></ha-icon></div>
                  <span class="tv${pend ? " pend" : ""}">${val}</span>
                  <div class="b" data-act="plus" data-c="${e}" role="button" tabindex="0" title="Più 0,5°"><ha-icon icon="mdi:plus"></ha-icon></div>
                  <div class="b mb ${cur || "bad"}" data-act="menu" data-c="${e}" role="button" tabindex="0" title="Modalità: ${mi.label}"><ha-icon icon="${mi.icon}"></ha-icon></div>
                </div>`;
      // l'obiettivo sta gia' nei tasti: nel sottotitolo resta solo l'offset
      return html
        .replace(/<div class="rsub"><span>[^<]*<\/span>/, `<div class="rsub"><span>${x.bad ? "n.d." : ""}<span class="tv2${pend ? " pend" : ""}">${x.bad ? "" : pend ? val : x.off ? "spento" : `→ ${val}`}</span></span>`)
        .replace(/<\/div>\s*$/, `${ctl}\n              </div>`);
    }

    _step(id, d) {
      const c = this._st(id);
      if (!c || c.state === "unavailable" || c.state === "unknown") return;
      const room = this._rooms().find((r) => r.climate === id);
      const x = room ? this._room(room) : null;
      let p = this._pend[id];
      if (p && p.sent) { this._dropPend(id); p = null; }
      let base;
      if (p) base = p.v;
      else if (c.state === "off") {
        // da spento il target di Tado (5 °C) non conta: si parte dalla temperatura della stanza e si accende
        base = Math.round((x && x.temp !== null ? x.temp : Number(c.attributes.current_temperature ?? 20)) * 2) / 2;
      } else base = Number(c.attributes.temperature ?? c.attributes.current_temperature ?? 20);
      const v = hseClamp(base + d);
      p = this._pend[id] = { v, on: p ? p.on : c.state === "off", timer: p && p.timer, sent: false };
      clearTimeout(p.timer);
      p.timer = setTimeout(() => this._send(id), HSE_DEBOUNCE);
      this._refresh();
    }

    _send(id) {
      const p = this._pend[id];
      if (!p || !this._hass) return;
      const data = { entity_id: id, temperature: p.v };
      if (p.on) data.hvac_mode = "heat";
      this._hass.callService("climate", "set_temperature", data);
      p.sent = true;
      p.timer = setTimeout(() => { this._dropPend(id); this._refresh(); }, HSE_HOLD);
    }

    _dropPend(id) {
      const p = this._pend[id];
      if (p) clearTimeout(p.timer);
      delete this._pend[id];
    }

    _setMode(id, mode) {
      const c = this._st(id);
      if (!c || !this._hass) return;
      const p = this._pend[id];
      if (p && !p.sent) {
        // temperatura scelta e non ancora mandata: con "Caldo" va insieme, altrimenti si scarta
        this._dropPend(id);
        if (mode === "heat") {
          this._hass.callService("climate", "set_temperature", { entity_id: id, temperature: p.v, hvac_mode: "heat" });
          return;
        }
      }
      if (c.state === mode) return;
      this._hass.callService("climate", "set_hvac_mode", { entity_id: id, hvac_mode: mode });
    }

    // tendina dei modi sotto (o sopra) il tasto; un secondo tocco sul tasto la chiude
    _toggleMenu(btn) {
      const id = btn.dataset.c;
      const open = this._menu && this._menu.id === id;
      this._closeMenu();
      if (open) return;
      const c = this._st(id);
      if (!c || !this._hass) return;
      const avail = Array.isArray(c.attributes.hvac_modes) ? HSE_ORDER.filter((m) => c.attributes.hvac_modes.includes(m)) : HSE_ORDER;
      const m = document.createElement("div");
      m.style.cssText =
        "position:fixed;z-index:9999;min-width:150px;padding:6px;border-radius:14px;" +
        "background:var(--card-background-color,#fff);color:var(--primary-text-color);" +
        "box-shadow:0 6px 24px rgba(0,0,0,.35);font-family:var(--paper-font-body1_-_font-family,inherit);";
      m.innerHTML = avail
        .map((k) =>
          `<div data-m="${k}" style="display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border-radius:10px;cursor:pointer;font-size:14px;` +
          `${c.state === k ? "background:rgba(128,128,128,.25);font-weight:600;" : ""}">` +
          `<ha-icon icon="${HSE_MODE[k].icon}" style="--mdc-icon-size:20px;color:${HSE_MODE[k].color}"></ha-icon>${HSE_MODE[k].label}</div>`)
        .join("");
      document.body.appendChild(m);
      const r = btn.getBoundingClientRect();
      const w = m.offsetWidth;
      const h = m.offsetHeight;
      const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      m.style.left = left + "px";
      m.style.top = top + "px";
      m.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const t = ev.target.closest("[data-m]");
        if (!t) return;
        this._closeMenu();
        this._setMode(id, t.dataset.m);
      });
      // fuori dalla tendina la chiude, tranne il tasto che l'ha aperta (ci pensa il suo click)
      const away = (ev) => {
        const path = ev.composedPath();
        if (path.includes(m)) return;
        if (path.some((x) => x.dataset && x.dataset.act === "menu" && x.dataset.c === id)) return;
        this._closeMenu();
      };
      const key = (ev) => ev.key === "Escape" && this._closeMenu();
      const close = () => this._closeMenu();
      document.addEventListener("pointerdown", away, true);
      document.addEventListener("keydown", key);
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
      this._menu = {
        el: m, id,
        off: () => {
          document.removeEventListener("pointerdown", away, true);
          document.removeEventListener("keydown", key);
          window.removeEventListener("scroll", close, true);
          window.removeEventListener("resize", close);
        },
      };
    }

    _closeMenu() {
      if (!this._menu) return;
      this._menu.off();
      this._menu.el.remove();
      this._menu = null;
    }

    _refresh() {
      this._sig = "";
      this._update();
    }

    _update() {
      super._update();
      if (this._el) this._el.rooms.classList.toggle("c3", thmColumns(this._config.columns) !== 2);
    }
  }

  if (!customElements.get("heating-summary-editable-card")) {
    customElements.define("heating-summary-editable-card", HeatingSummaryEditableCard);
  }
  window.customCards.push({
    type: "heating-summary-editable-card",
    name: "Heating Summary (modificabile)",
    description: "Come Heating Summary, con +/- della temperatura e modalità in ogni riquadro.",
    preview: true,
  });
}

// ===== heating-ac-card.js =====
{
  /* Heating AC card: climatizzatore a riga o a blocco, con le stesse funzioni di heating-radiator-card.
   * Uso:
   *   type: custom:heating-ac-card
   *   entity: climate.condizionatore_cucina
   *   name: Cucina                 # opzionale
   *   layout: tile                 # opzionale: blocco come nel riepilogo (predefinito: riga)
   *   temp_termometro: sensor.xxx  # opzionale: temperatura ambiente (al posto di current_temperature)
   *   fan: switch.ventola          # opzionale: ventilatore separato (icona accanto al nome)
   *   door: binary_sensor.porta    # opzionale: porta/finestra aperta (nel popup)
   * I campi lasciati vuoti si prendono dalla stanza di Tado Heating Manager con lo stesso climate, se c'e'
   * (nome, termometro, ventola). Configurabile anche dall'editor visuale.
   * Un tocco sul corpo apre un popup con modalita', velocita', oscillazione, interruttori e grafico;
   * la pressione lunga sui tasti apre i dettagli di HA. Non richiede button-card.
   */
  const AC_ORDER = ["heat_cool", "auto", "cool", "heat", "dry", "fan_only", "off"];
  const AC_LABEL = {
    off: "Spento", cool: "Freddo", heat: "Caldo", dry: "Deumidifica", fan_only: "Ventola", heat_cool: "Auto", auto: "Auto",
  };
  const AC_ICON = {
    off: "mdi:power", cool: "mdi:snowflake", heat: "mdi:fire", dry: "mdi:water-percent",
    fan_only: "mdi:fan", heat_cool: "mdi:sun-snowflake-variant", auto: "mdi:thermostat-auto",
  };
  const AC_COLOR = {
    cool: "#29b6f6", heat: "#ff8a3d", dry: "#26a69a", fan_only: "#90a4ae", heat_cool: "#4caf50", auto: "#4caf50",
  };
  // attivita' in corso (hvac_action): colore del bordo, dello sfondo e delle bande del grafico
  const AC_ACT_COLOR = { cooling: "#29b6f6", heating: "#ff8a3d", drying: "#26a69a", fan: "#90a4ae" };
  const AC_ACT = { cooling: "Raffredda", heating: "Riscalda", drying: "Deumidifica", fan: "Ventila", idle: "Inattivo", off: "Spento" };
  const AC_ANIM = {
    cool: "ac-spin 8s linear infinite", heat_cool: "ac-spin 8s linear infinite", auto: "ac-spin 8s linear infinite",
    fan_only: "ac-spin 1s linear infinite", heat: "ac-flame .9s ease-in-out infinite", dry: "ac-drop 1.6s ease-in-out infinite",
  };
  const AC_SWING = {
    Off: "Swing off", Top: "Alto", MiddleTop1: "Medio-alto 1", MiddleTop2: "Medio-alto 2",
    MiddleBottom2: "Medio-basso 2", MiddleBottom1: "Medio-basso 1", Bottom: "Basso", Swing: "Oscilla",
    off: "Fermo", on: "Oscilla", vertical: "Verticale", horizontal: "Orizzontale", both: "Entrambi",
  };
  const AC_FAN = {
    auto: "Auto", low: "Bassa", medium: "Media", middle: "Media", high: "Alta", quiet: "Silenziosa", silent: "Silenziosa",
    turbo: "Turbo", strong: "Forte", focus: "Focus", diffuse: "Diffusa", on: "Accesa", off: "Spenta",
  };
  const AC_BLUE = "#4f78a8";

  const AC_LABELS = {
    entity: "Climatizzatore (climate)",
    name: "Nome",
    layout: "Aspetto",
    temp_termometro: "Termometro della stanza",
    fan: "Ventola",
    door: "Porta o finestra",
  };
  const AC_HELPERS = {
    name: "Vuoto: nome della stanza in Tado Heating Manager (se il climatizzatore è in una stanza) o del climate.",
    layout: "Blocco: stessi comandi della riga (modalità, oscillazione, ventola, −/+), tre per riga.",
    temp_termometro: "Vuoto: il termometro della stanza, altrimenti la temperatura del climatizzatore.",
    fan: "Vuoto: la ventola configurata nella stanza (se c'è).",
  };
  const AC_LAYOUT_SELECTOR = {
    select: { mode: "dropdown", options: [{ value: "row", label: "Riga" }, { value: "tile", label: "Blocco" }] },
  };

  const acEsc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const acRgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const acNum = (v) => v !== undefined && v !== null && v !== "" && !isNaN(Number(v));
  const acFmt = (v) => (acNum(v) ? Number(v).toFixed(1) : "--");
  const AC_SVG =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="10" rx="3"/><path d="M6.5 7.4v9.2"/><path d="M8.5 14.3h11"/><circle cx="18.6" cy="10.2" r=".5" fill="currentColor" stroke="none"/></svg>';
  const AC_KEYFRAMES = `
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
          @keyframes ventola-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`;

  class HeatingAcCard extends HTMLElement {
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
      const auto = { name: room.name, temp_termometro: room.thermometer, fan: room.fan };
      const out = { ...this._config };
      Object.keys(auto).forEach((k) => {
        if (!out[k] && auto[k]) out[k] = auto[k];
      });
      return out;
    }

    _isTile() {
      return !!this._config && this._config.layout === "tile";
    }

    getCardSize() {
      return this._isTile() ? 2 : 1;
    }

    getGridOptions() {
      return this._isTile() ? { columns: 4, min_columns: 4 } : { columns: "full" };
    }

    static getStubConfig(hass) {
      const e = Object.keys(hass.states).find((k) => k.startsWith("climate."));
      return { entity: e || "climate.example" };
    }

    // Editor visuale di HA (nessun elemento personalizzato: lo disegna HA dallo schema).
    static getConfigForm() {
      return {
        schema: [
          { name: "entity", required: true, selector: { entity: { domain: "climate" } } },
          { name: "name", selector: { text: {} } },
          { name: "layout", selector: AC_LAYOUT_SELECTOR },
          {
            type: "expandable", name: "", title: "Altre entità (facoltative)", flatten: true,
            schema: [
              { name: "temp_termometro", selector: { entity: { domain: "sensor", device_class: "temperature" } } },
              { name: "fan", selector: { entity: { domain: ["fan", "switch"] } } },
              { name: "door", selector: { entity: { domain: ["binary_sensor", "input_boolean", "switch"] } } },
            ],
          },
        ],
        computeLabel: (s) => AC_LABELS[s.name] || s.name,
        computeHelper: (s) => AC_HELPERS[s.name],
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

    _signature() {
      const c = this._cfg;
      return [c.entity, c.temp_termometro, c.fan, c.door]
        .map((id) => {
          const s = this._st(id);
          return s ? s.state + JSON.stringify(id === c.entity ? s.attributes : "") : "-";
        })
        .join("|");
    }

    _more(entityId) {
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
    }

    // attivita' in corso: hvac_action se c'e', altrimenti dedotta dalla modalita'
    _actOf(st, a) {
      if (!st || st === "off" || st === "unavailable" || st === "unknown") return null;
      const h = a && a.hvac_action;
      if (h !== undefined && h !== null) return AC_ACT_COLOR[h] ? h : null;
      return { cool: "cooling", heat: "heating", dry: "drying", fan_only: "fan" }[st] || "on";
    }

    _active(c) {
      return c ? this._actOf(c.state, c.attributes) : null;
    }

    // temperatura della stanza: termometro se valido, altrimenti quella del climatizzatore
    _roomTemp(c) {
      const ts = this._st(this._cfg.temp_termometro);
      if (!this._bad(ts) && acNum(ts.state)) return Number(ts.state);
      return c ? c.attributes.current_temperature : undefined;
    }

    _stepOf(c) {
      const s = Number(c && c.attributes.target_temp_step);
      return s > 0 ? s : 1;
    }

    // temperatura target; da spento si mostra attenuata (se il climate la conserva) o "Spento"
    _targetText(c) {
      if (this._bad(c)) return { t: "--", dim: false };
      const t = c.attributes.temperature;
      const v = acNum(t) ? `${Number(t).toFixed(this._stepOf(c) < 1 ? 1 : 0)}°` : null;
      if (c.state === "off") return { t: v || "Spento", dim: true };
      return { t: v || "--", dim: false };
    }

    _orderedModes(c) {
      const modes = (c && c.attributes.hvac_modes) || [];
      return AC_ORDER.filter((m) => modes.includes(m)).concat(modes.filter((m) => !AC_ORDER.includes(m)));
    }

    // ---- riga ----
    _build() {
      this._closeMenu();
      this._closeDialog();
      if (this._isTile()) return this._buildTile();
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; }
          ha-card {
            box-sizing: border-box; min-height: 68px; border-radius: 15px; padding: 10px 14px;
            box-shadow: none; overflow: hidden; cursor: pointer; color: var(--primary-text-color);
            display: grid; align-items: center; column-gap: 8px;
            grid-template-columns: 44px minmax(0, 1fr) auto auto;
            border: 2px solid transparent;
          }
          .icon {
            width: 44px; height: 44px; border-radius: 50%; background: rgba(128,128,128,.22);
            display: flex; align-items: center; justify-content: center;
          }
          .info { min-width: 0; overflow: hidden; text-align: left; }
          .nrow { display: flex; align-items: center; gap: 6px; min-width: 0; }
          .name { font-weight: 600; font-size: 15px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
          .rfan { flex: none; cursor: pointer; display: inline-flex; --mdc-icon-size: 16px; color: var(--secondary-text-color); }
          .rfan ha-icon { display: inline-flex; transform-origin: 50% 50%; }
          .rfan.on { color: #29b6f6; }
          .rfan.on ha-icon { animation: ventola-spin 1.2s linear infinite; }
          .rfan.bad { color: var(--disabled-text-color, #9e9e9e); }
          .line { margin-top: 3px; font-size: 11px; line-height: 1.2; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .line:empty { display: none; }
          .btn {
            width: 38px; height: 38px; border-radius: 50%; background: rgba(128,128,128,.22);
            display: flex; align-items: center; justify-content: center; cursor: pointer; justify-self: end;
            --mdc-icon-size: 20px;
          }
          .btn ha-icon { display: inline-block; transform-origin: 50% 50%; }
          .temp {
            height: 38px; border-radius: 14px; background: rgba(128,128,128,.22); justify-self: end;
            display: grid; grid-template-columns: 32px 44px 32px; align-items: center; padding: 0 4px;
          }
          .temp .v { font-size: 14px; font-weight: 500; text-align: center; }
          .temp .v.txt { font-size: 11.5px; font-weight: 400; color: var(--secondary-text-color); }
          .temp .v.dim { color: var(--secondary-text-color); }
          .temp .s {
            width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
            cursor: pointer; --mdc-icon-size: 18px; border-radius: 50%;
          }
          ${AC_KEYFRAMES}
        </style>
        <ha-card>
          <div class="icon">${AC_SVG}</div>
          <div class="info">
            <div class="nrow"><div class="name"></div><span class="rfan" data-a="fan"><ha-icon icon="mdi:fan"></ha-icon></span></div>
            <div class="line"></div>
          </div>
          <div class="btn mode" data-a="mode"><ha-icon></ha-icon></div>
          <div class="btn swing" data-a="swing"><ha-icon></ha-icon></div>
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
        swing: $(".btn.swing"),
        swingIcon: $(".btn.swing ha-icon"),
        fan: $(".rfan"),
        fanIcon: $(".rfan ha-icon"),
        value: $(".temp .v"),
      };
      this._card.addEventListener("click", () => this._openDialog());
      this._bindButtons();
    }

    // ---- blocco (layout: tile): stile delle tessere di heating-summary-card, comandi della riga ----
    _buildTile() {
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; height: 100%; }
          ha-card {
            box-sizing: border-box; height: 100%; padding: 10px 12px 12px; border-radius: var(--ha-card-border-radius, 14px);
            box-shadow: none; overflow: hidden; cursor: pointer; color: var(--primary-text-color);
            border: 2px solid transparent; transition: border-color .4s ease, background .4s ease;
            display: flex; flex-direction: column; gap: 6px; container-type: inline-size; position: relative;
          }
          ha-card.off .mid, ha-card.off .rst { opacity: .72; }
          .top { display: flex; align-items: center; gap: 4px; min-height: 32px; }
          /* modalita' e oscillazione una sopra l'altra, in alto a destra */
          .btns { position: absolute; top: 10px; right: 12px; display: flex; flex-direction: column; gap: 4px; }
          .top, .mid { padding-right: 36px; }
          .rname { font-size: 14px; font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .btn {
            width: 32px; height: 32px; border-radius: 50%; background: rgba(128,128,128,.18); flex: none;
            display: flex; align-items: center; justify-content: center; cursor: pointer; --mdc-icon-size: 18px;
          }
          .btn ha-icon { display: inline-flex; transform-origin: 50% 50%; }
          .mid { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
          .sub { display: flex; align-items: center; gap: 6px; min-height: 18px; margin-top: -4px; }
          .rfan {
            margin-left: auto; flex: none; cursor: pointer; display: inline-flex;
            --mdc-icon-size: 16px; color: var(--secondary-text-color);
          }
          .rfan ha-icon { display: inline-flex; transform-origin: 50% 50%; }
          .rfan.on { color: #29b6f6; }
          .rfan.on ha-icon { animation: ventola-spin 1.2s linear infinite; }
          .rfan.bad { color: var(--disabled-text-color, #9e9e9e); }
          .rtemp { font-size: 26px; font-weight: 400; line-height: 1.1; white-space: nowrap; }
          .rh { font-size: 12px; color: #26a69a; font-weight: 500; white-space: nowrap; }
          .rh:empty, .rst:empty { display: none; }
          .rst { font-size: 12px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
          .temp {
            height: 36px; border-radius: 14px; background: rgba(128,128,128,.18); margin-top: auto;
            display: grid; grid-template-columns: 36px minmax(0, 1fr) 36px; align-items: center;
          }
          .temp .v { font-size: 15px; font-weight: 500; text-align: center; white-space: nowrap; }
          .temp .v.txt { font-size: 13px; font-weight: 400; color: var(--secondary-text-color); }
          .temp .v.dim { color: var(--secondary-text-color); }
          .temp .s {
            width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
            cursor: pointer; --mdc-icon-size: 18px; border-radius: 50%;
          }
          .btn:hover, .temp .s:hover { background: rgba(128,128,128,.3); }
          @container (max-width: 135px) {
            .rname { font-size: 13px; }
            .btn { width: 28px; height: 28px; --mdc-icon-size: 16px; }
            .top, .mid { padding-right: 32px; }
            .rtemp { font-size: 21px; }
            .rh, .rst { font-size: 10.5px; }
            .mid { flex-wrap: wrap; row-gap: 0; gap: 4px; }
            .rfan { --mdc-icon-size: 14px; }
            .temp { grid-template-columns: 30px minmax(0, 1fr) 30px; }
            .temp .s { width: 30px; }
          }
          ${AC_KEYFRAMES}
        </style>
        <ha-card tabindex="0" role="button">
          <div class="top">
            <div class="rname"></div>
          </div>
          <div class="btns">
            <div class="btn mode" data-a="mode"><ha-icon></ha-icon></div>
            <div class="btn swing" data-a="swing"><ha-icon></ha-icon></div>
          </div>
          <div class="mid">
            <span class="rtemp"></span><span class="rh" title="Umidità"></span>
          </div>
          <div class="sub">
            <span class="rst"></span>
            <span class="rfan" data-a="fan"><ha-icon icon="mdi:fan"></ha-icon></span>
          </div>
          <div class="temp">
            <div class="s" data-a="minus"><ha-icon icon="mdi:minus"></ha-icon></div>
            <div class="v"></div>
            <div class="s" data-a="plus"><ha-icon icon="mdi:plus"></ha-icon></div>
          </div>
        </ha-card>`;
      const $ = (q) => this.shadowRoot.querySelector(q);
      this._card = $("ha-card");
      this._el = {
        tile: true,
        name: $(".rname"),
        mode: $(".btn.mode"),
        modeIcon: $(".btn.mode ha-icon"),
        swing: $(".btn.swing"),
        swingIcon: $(".btn.swing ha-icon"),
        fan: $(".rfan"),
        fanIcon: $(".rfan ha-icon"),
        temp: $(".rtemp"),
        hum: $(".rh"),
        state: $(".rst"),
        value: $(".temp .v"),
      };
      this._card.addEventListener("click", () => this._openDialog());
      this._card.addEventListener("keydown", (ev) => {
        if (ev.target === this._card && (ev.key === "Enter" || ev.key === " ")) {
          ev.preventDefault();
          this._openDialog();
        }
      });
      this._bindButtons();
    }

    // pulsanti [data-a]: tocco = azione, pressione lunga = dettagli
    _bindButtons() {
      this.shadowRoot.querySelectorAll("[data-a]").forEach((el) => {
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this._action(el.dataset.a, el);
        });
        let t;
        el.addEventListener("pointerdown", () => {
          t = setTimeout(() => {
            t = null;
            el._held = true;
            const id = el.dataset.a === "fan" ? this._cfg.fan : this._cfg.entity;
            this._more(id);
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

    _action(a, anchor) {
      const c = this._st(this._cfg.entity);
      if (!c) return;
      const id = this._cfg.entity;
      if (a === "mode") {
        const items = this._orderedModes(c).map((m) => ({
          v: m, label: AC_LABEL[m] || m, icon: AC_ICON[m] || "mdi:thermostat", color: AC_COLOR[m],
        }));
        this._openMenu(anchor || this._el.mode, items, c.state, (m) =>
          this._hass.callService("climate", "set_hvac_mode", { entity_id: id, hvac_mode: m })
        );
      } else if (a === "swing") {
        const items = (c.attributes.swing_modes || []).map((s) => ({
          v: s, label: AC_SWING[s] || s,
          icon: s === "Off" || s === "off" ? "mdi:arrow-oscillating-off" : "mdi:arrow-oscillating",
        }));
        this._openMenu(anchor || this._el.swing, items, c.attributes.swing_mode, (s) =>
          this._hass.callService("climate", "set_swing_mode", { entity_id: id, swing_mode: s })
        );
      } else if (a === "fan") {
        if (this._cfg.fan) this._hass.callService("homeassistant", "toggle", { entity_id: this._cfg.fan });
      } else if (a === "minus" || a === "plus") {
        this._stepTemp(a === "plus" ? 1 : -1);
      }
    }

    // -/+ della temperatura target (passo e limiti del climate); da spento cambia solo il target
    _stepTemp(dir) {
      const c = this._st(this._cfg.entity);
      if (this._bad(c)) return;
      const a = c.attributes;
      const step = this._stepOf(c);
      const room = this._roomTemp(c);
      const base = acNum(a.temperature) ? Number(a.temperature) : acNum(room) ? Number(room) : 22;
      const lo = acNum(a.min_temp) ? Number(a.min_temp) : 16;
      const hi = acNum(a.max_temp) ? Number(a.max_temp) : 30;
      const t = Math.min(hi, Math.max(lo, Math.round((base + dir * step) / step) * step));
      this._hass.callService("climate", "set_temperature", { entity_id: this._cfg.entity, temperature: Number(t.toFixed(2)) });
    }

    // tendina di scelta (modalita' / oscillazione): una sola chiamata al servizio
    _closeMenu() {
      if (this._menu) {
        this._menu.remove();
        this._menu = null;
      }
      if (this._menuOff) {
        this._menuOff();
        this._menuOff = null;
      }
      this._menuAnchor = null;
    }

    _openMenu(anchor, items, cur, pick) {
      if (this._menu) {
        const same = this._menuAnchor === anchor;
        this._closeMenu();
        if (same) return;
      }
      if (!items.length || !anchor) return;
      const r = anchor.getBoundingClientRect();
      const m = document.createElement("div");
      m.style.cssText =
        "position:fixed;z-index:9999;min-width:150px;max-height:70vh;overflow-y:auto;padding:6px;border-radius:14px;" +
        "background:var(--card-background-color,#fff);color:var(--primary-text-color);" +
        "box-shadow:0 6px 24px rgba(0,0,0,.35);font-family:var(--paper-font-body1_-_font-family,inherit);";
      m.innerHTML = items
        .map(
          (it) =>
            `<div data-m="${acEsc(it.v)}" style="display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border-radius:10px;cursor:pointer;font-size:14px;` +
            `${cur === it.v ? "background:rgba(128,128,128,.25);font-weight:600;" : ""}">` +
            `<ha-icon icon="${acEsc(it.icon || "mdi:circle-small")}" style="--mdc-icon-size:20px;color:${it.color || "var(--primary-text-color)"}"></ha-icon>${acEsc(it.label)}</div>`
        )
        .join("");
      document.body.appendChild(m);
      const w = m.offsetWidth;
      const h = m.offsetHeight;
      const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      m.style.left = left + "px";
      m.style.top = top + "px";
      m.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const t = ev.target.closest("[data-m]");
        if (!t) return;
        const v = t.dataset.m;
        this._closeMenu();
        if (v !== cur) pick(v);
      });
      const away = (ev) => {
        if (!ev.composedPath().includes(m) && !ev.composedPath().includes(anchor)) this._closeMenu();
      };
      const key = (ev) => ev.key === "Escape" && this._closeMenu();
      const close = () => this._closeMenu();
      // listener registrati dopo il click corrente, per non chiudere subito la tendina
      setTimeout(() => {
        if (this._menu !== m) return;
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
      this._menuAnchor = anchor;
    }

    _update() {
      if (!this._el || !this._hass) return;
      const cfg = this._cfg;
      const c = this._st(cfg.entity);
      const e = this._el;
      const bad = this._bad(c);
      const isOff = !bad && c.state === "off";
      const act = this._active(c);
      const mc = (!bad && AC_COLOR[c.state]) || "";
      const ac = act ? AC_ACT_COLOR[act] || mc : "";
      const tint = e.tile ? 0.18 : 0.24;

      // bordo: colore pieno quando lavora (con sfondo colorato), attenuato quando la modalita' e' attiva ma e' fermo
      this._card.classList.toggle("off", bad || isOff);
      this._card.style.borderColor = ac || (mc ? acRgba(mc, 0.45) : "transparent");
      this._card.style.backgroundImage = ac ? `radial-gradient(120% 100% at 50% 100%, ${acRgba(ac, 0.38)}, ${acRgba(ac, 0)} 70%)` : "";
      if (e.iconWrap) e.iconWrap.style.color = mc || "var(--primary-text-color)";
      this.shadowRoot.querySelectorAll(".temp .s").forEach((x) => (x.style.color = mc || AC_BLUE));

      // modalita'
      e.mode.style.display = bad ? "none" : "";
      if (!bad) {
        e.modeIcon.setAttribute("icon", AC_ICON[c.state] || "mdi:thermostat");
        e.modeIcon.style.color = mc || "var(--primary-text-color)";
        e.modeIcon.style.transformOrigin = c.state === "heat" ? "50% 90%" : "50% 50%";
        e.modeIcon.style.animation = act ? AC_ANIM[c.state] || "none" : "none";
        e.mode.title = AC_LABEL[c.state] || c.state;
      }

      // oscillazione
      const list = !bad && c.attributes.swing_modes;
      const showSwing = !!(list && list.length);
      e.swing.style.display = showSwing ? "" : "none";
      if (showSwing) {
        const cur = c.attributes.swing_mode;
        const sOff = cur === undefined || cur === null || cur === "Off" || cur === "off";
        const running = !isOff && (cur === "Swing" || cur === "on" || cur === "both" || cur === "vertical" || cur === "horizontal");
        e.swingIcon.setAttribute("icon", sOff ? "mdi:arrow-oscillating-off" : "mdi:arrow-oscillating");
        e.swingIcon.style.color = sOff ? "var(--secondary-text-color)" : "var(--primary-text-color)";
        e.swingIcon.style.animation = running ? "ac-sway 1.6s ease-in-out infinite alternate" : "none";
        e.swing.title = AC_SWING[cur] || cur || "";
      }

      // ventola separata
      if (cfg.fan) {
        const f = this._st(cfg.fan);
        const fb = this._bad(f);
        const on = !fb && f.state === "on";
        e.fan.style.display = "";
        e.fanIcon.setAttribute("icon", fb ? "mdi:fan-off" : "mdi:fan");
        e.fan.classList.toggle("on", on);
        e.fan.classList.toggle("bad", fb);
        e.fan.title = fb ? "Ventola non disponibile" : on ? "Ventola accesa" : "Ventola spenta";
      } else {
        e.fan.style.display = "none";
      }
      if (!e.tile) {
        this._card.style.gridTemplateColumns =
          "44px minmax(0, 1fr)" + (bad ? "" : " auto") + (showSwing ? " auto" : "") + " auto";
      }

      // testi
      const temp = this._roomTemp(c);
      const hum = c && c.attributes.current_humidity;
      const humTxt = !bad && acNum(hum) ? `${Math.round(Number(hum))}%` : "";
      e.name.textContent = cfg.name || (c && c.attributes.friendly_name) || cfg.entity;
      if (e.tile) {
        e.temp.textContent = !c || c.state === "unavailable" ? "n.d." : `${acFmt(temp)}°`;
        e.hum.textContent = humTxt;
        e.state.textContent = bad ? "" : (act && AC_ACT[act]) || AC_LABEL[c.state] || c.state;
      } else {
        let line;
        if (!c) line = "Entità non trovata";
        else if (c.state === "unavailable") line = "Non disponibile";
        else if (c.state === "unknown") line = "Stato sconosciuto";
        else {
          line = `T: ${acFmt(temp)}°C`;
          if (humTxt) line += ` • U: ${humTxt}`;
          line += ` • ${AC_LABEL[c.state] || c.state}`;
        }
        e.line.textContent = line;
      }

      const tv = this._targetText(c);
      e.value.textContent = tv.t;
      e.value.classList.toggle("txt", tv.t === "Spento");
      e.value.classList.toggle("dim", tv.dim);
      this._dlgUpdate();
    }

    disconnectedCallback() {
      this._closeMenu();
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
          .row:empty { display: none; }
          .lbl { font-size: 12px; opacity: .7; width: 100%; margin-bottom: -4px; }
          .mode, .chip, .rng { height: 38px; padding: 0 14px; border-radius: 19px; background: rgba(128,128,128,.22);
            display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; --mdc-icon-size: 20px; user-select: none; }
          .mode.on, .rng.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
          .chip.ro { cursor: default; }
          .chip.active { background: rgba(41,182,246,.28); color: #29b6f6; }
          .chip.alert { background: rgba(255,138,61,.28); color: #ff8a3d; }
          .tset { margin-left: auto; height: 44px; border-radius: 16px; background: rgba(128,128,128,.22);
            display: grid; grid-template-columns: 44px 70px 44px; align-items: center; }
          .tset .v { text-align: center; font-size: 20px; font-weight: 600; }
          .tset .v.dim { color: var(--secondary-text-color); font-weight: 400; }
          .tset .s { height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 50%; }
          .graph { min-height: 160px; margin: 4px 0 8px; }
          .more { text-align: center; font-size: 12px; opacity: .7; cursor: pointer; padding: 6px; }
          .more:hover { opacity: 1; }
        </style>
        <div class="ov"><div class="dlg">
          <div class="hd"><div class="t"></div><div class="x" data-d="close"><ha-icon icon="mdi:close"></ha-icon></div></div>
          <div class="sub"></div>
          <div class="row modes"></div>
          <div class="row fmodes"></div>
          <div class="row smodes"></div>
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
      this._dlg = { host, root, q, hours: 24 };

      root.querySelector(".ov").addEventListener("click", (ev) => {
        if (ev.target.classList.contains("ov")) this._closeDialog();
      });
      root.addEventListener("click", (ev) => {
        const d = ev.target.closest("[data-d]");
        const h = ev.target.closest("[data-h]");
        const m = ev.target.closest("[data-m]");
        const fm = ev.target.closest("[data-f]");
        const sm = ev.target.closest("[data-s]");
        const t = ev.target.closest("[data-t]");
        const id = cfg.entity;
        if (h) {
          this._dlg.hours = Number(h.dataset.h);
          root.querySelectorAll(".rng").forEach((x) => x.classList.toggle("on", x === h));
          this._dlgGraph();
        } else if (m) {
          this._hass.callService("climate", "set_hvac_mode", { entity_id: id, hvac_mode: m.dataset.m });
        } else if (fm) {
          this._hass.callService("climate", "set_fan_mode", { entity_id: id, fan_mode: fm.dataset.f });
        } else if (sm) {
          this._hass.callService("climate", "set_swing_mode", { entity_id: id, swing_mode: sm.dataset.s });
        } else if (t) {
          this._hass.callService("homeassistant", "toggle", { entity_id: t.dataset.t });
        } else if (d) {
          if (d.dataset.d === "close") this._closeDialog();
          else if (d.dataset.d === "more") this._more(id);
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
      const bandsArr = []; // [t0, t1, attivita']
      const seen = new Set();
      let attrs = {};
      let cur = null;
      let curStart = null;
      (res[cfg.entity] || []).forEach((p) => {
        const t = Math.max(ts(p), start);
        const st = p.s ?? p.state;
        attrs = Object.assign({}, attrs, p.a ?? p.attributes ?? {});
        if (acNum(attrs.current_temperature)) temp.push({ t, v: Number(attrs.current_temperature) });
        const off = st === "off" || st === "unavailable" || st === "unknown";
        target.push({ t, v: off || !acNum(attrs.temperature) ? null : Number(attrs.temperature) });
        const act = this._actOf(st, attrs);
        if (act !== cur) {
          if (cur) bandsArr.push([curStart, t, cur]);
          cur = act;
          curStart = t;
        }
      });
      if (cur) bandsArr.push([curStart, end, cur]);
      if (cfg.temp_termometro) {
        const sensor = [];
        (res[cfg.temp_termometro] || []).forEach((p) => {
          const raw = p.s ?? p.state;
          if (acNum(raw)) sensor.push({ t: Math.max(ts(p), start), v: Number(raw) });
        });
        if (sensor.length) {
          temp.length = 0;
          temp.push(...sensor);
        }
      }
      [temp, target].forEach((a) => {
        if (a.length) a.push({ t: end, v: a[a.length - 1].v });
      });

      const vals = temp.concat(target).map((x) => x.v).filter((v) => v !== null);
      if (temp.length < 1 || !vals.length) {
        box.textContent = "Nessun dato nel periodo";
        return;
      }
      let lo = Math.floor(Math.min(...vals) - 0.5);
      let hi = Math.ceil(Math.max(...vals) + 0.5);
      if (hi - lo < 4) hi = lo + 4;
      const W = 600, H = 220, L = 36, R = 10, T = 10, B = 24;
      const X = (t) => L + ((t - start) / (end - start)) * (W - L - R);
      const Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
      const line = (arr, step) => {
        let d = "";
        let pen = false;
        arr.forEach((p) => {
          if (p.v === null) {
            pen = false;
            return;
          }
          if (!pen) d += `M${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`;
          else if (step) d += `H${X(p.t).toFixed(1)}V${Y(p.v).toFixed(1)}`;
          else d += `L${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`;
          pen = true;
        });
        return d;
      };
      let grid = "";
      const stepY = hi - lo > 12 ? 5 : hi - lo > 6 ? 2 : 1;
      for (let v = Math.ceil(lo / stepY) * stepY; v <= hi; v += stepY)
        grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="currentColor" opacity=".15"/><text x="${L - 5}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="currentColor" opacity=".7">${v}</text>`;
      const fmtT = (t) => {
        const d = new Date(t);
        return dlg.hours > 24
          ? d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" })
          : d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
      };
      let xl = "";
      for (let i = 0; i <= 4; i++) {
        const t = start + ((end - start) * i) / 4;
        xl += `<text x="${X(t)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}" font-size="11" fill="currentColor" opacity=".7">${fmtT(t)}</text>`;
      }
      const bandColor = (a) => AC_ACT_COLOR[a] || "#4caf50";
      const bands = bandsArr
        .map(([a, b, act]) => {
          seen.add(act);
          return `<rect x="${X(a)}" y="${T}" width="${Math.max(1, X(b) - X(a))}" height="${H - T - B}" fill="${bandColor(act)}" opacity=".18"/>`;
        })
        .join("");
      const legendBands = [...seen]
        .map((a) => `<span><b style="color:${bandColor(a)};opacity:.5">&#9608;</b> ${AC_ACT[a] || "Acceso"}</span>`)
        .join("");
      box.innerHTML = `
        <div style="position:relative">
          <svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;touch-action:none">
            ${grid}${xl}${bands}
            <path d="${line(target, true)}" fill="none" stroke="currentColor" stroke-opacity=".6" stroke-width="1.8" stroke-dasharray="5 3"/>
            <path d="${line(temp, false)}" fill="none" stroke="#29b6f6" stroke-width="2.2" stroke-linejoin="round"/>
            <line class="cur" y1="${T}" y2="${H - B}" stroke="currentColor" opacity=".5" style="display:none"/>
          </svg>
          <div class="tip" style="position:absolute;top:0;left:40px;font-size:12px;padding:2px 8px;border-radius:8px;background:rgba(128,128,128,.3);display:none"></div>
        </div>
        <div style="display:flex;gap:14px;font-size:12px;opacity:.85;padding:2px 10px 0;flex-wrap:wrap">
          <span><b style="color:#29b6f6">&#9644;</b> ${cfg.temp_termometro ? "Termometro" : "Temperatura"}</span>
          <span><b style="opacity:.6">&#9548;</b> Target</span>
          ${legendBands}
        </div>`;
      const svg = box.querySelector("svg");
      const curLine = box.querySelector(".cur");
      const tip = box.querySelector(".tip");
      const at = (arr, t) => {
        let r = null;
        for (const p of arr) {
          if (p.t <= t) r = p;
          else break;
        }
        return r;
      };
      const move = (ev) => {
        const r = svg.getBoundingClientRect();
        const x = ((ev.clientX - r.left) / r.width) * W;
        if (x < L || x > W - R) return;
        const t = start + ((x - L) / (W - L - R)) * (end - start);
        const a = at(temp, t);
        const g = at(target, t);
        curLine.setAttribute("x1", x);
        curLine.setAttribute("x2", x);
        curLine.style.display = "";
        tip.textContent =
          `${fmtT(t)}  •  T: ${a ? a.v.toFixed(1) : "--"}°` + (g && g.v !== null ? `  •  Target: ${g.v.toFixed(1)}°` : "");
        tip.style.display = "";
      };
      svg.addEventListener("pointermove", move);
      svg.addEventListener("pointerdown", move);
      svg.addEventListener("pointerleave", () => {
        curLine.style.display = "none";
        tip.style.display = "none";
      });
    }

    _dlgUpdate() {
      const dlg = this._dlg;
      if (!dlg || !this._hass) return;
      const cfg = this._cfg;
      const c = this._st(cfg.entity);
      const q = dlg.q;
      q(".t").textContent = cfg.name || (c && c.attributes.friendly_name) || "";

      const temp = this._roomTemp(c);
      const hum = c && c.attributes.current_humidity;
      const a = c && (c.attributes.hvac_action || (c.state === "off" ? "off" : ""));
      const st = c ? (a && AC_ACT[a]) || AC_LABEL[c.state] || c.state : "";
      q(".sub").textContent = c
        ? `${st || "--"} • T: ${acFmt(temp)}°C` + (acNum(hum) ? ` • U: ${Math.round(Number(hum))}%` : "")
        : "Entità non trovata";

      q(".modes").innerHTML = this._orderedModes(c)
        .map(
          (m) =>
            `<div class="mode${c && c.state === m ? " on" : ""}" data-m="${acEsc(m)}"><ha-icon icon="${AC_ICON[m] || "mdi:thermostat"}"></ha-icon>${acEsc(AC_LABEL[m] || m)}</div>`
        )
        .join("");

      const fms = (c && c.attributes.fan_modes) || [];
      q(".fmodes").innerHTML = fms.length
        ? `<div class="lbl">Velocità</div>` +
          fms
            .map((f) => `<div class="mode${c.attributes.fan_mode === f ? " on" : ""}" data-f="${acEsc(f)}">${acEsc(AC_FAN[f] || f)}</div>`)
            .join("")
        : "";

      const sms = (c && c.attributes.swing_modes) || [];
      q(".smodes").innerHTML = sms.length
        ? `<div class="lbl">Oscillazione</div>` +
          sms
            .map((s) => `<div class="mode${c.attributes.swing_mode === s ? " on" : ""}" data-s="${acEsc(s)}">${acEsc(AC_SWING[s] || s)}</div>`)
            .join("")
        : "";

      const chips = [];
      if (cfg.fan) {
        const f = this._st(cfg.fan);
        const on = !this._bad(f) && f.state === "on";
        chips.push(`<div class="chip${on ? " active" : ""}" data-t="${acEsc(cfg.fan)}"><ha-icon icon="${on ? "mdi:fan" : "mdi:fan-off"}"></ha-icon>Ventola</div>`);
      }
      if (cfg.door) {
        const d = this._st(cfg.door);
        const open = !this._bad(d) && d.state === "on";
        const ro = cfg.door.startsWith("binary_sensor.");
        chips.push(`<div class="chip${ro ? " ro" : ""}${open ? " alert" : ""}" ${ro ? "" : `data-t="${acEsc(cfg.door)}"`}><ha-icon icon="${open ? "mdi:door-open" : "mdi:door-closed"}"></ha-icon>${open ? "Porta aperta" : "Porta chiusa"}</div>`);
      }
      q(".chips").innerHTML = chips.join("");
      const tv = this._targetText(c);
      const v = q(".tset .v");
      v.textContent = tv.t;
      v.classList.toggle("dim", tv.dim);
    }
  }

  if (!customElements.get("heating-ac-card")) {
    customElements.define("heating-ac-card", HeatingAcCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-ac-card",
    name: "Heating AC",
    description: "Climatizzatore a riga o a blocco: modalità, oscillazione, ventola, temperatura target e popup con grafico.",
  });
}

// ===== heating-acs-card.js =====
{
  /* Heating ACs card: una heating-ac-card per ogni climatizzatore.
   * Uso:  type: custom:heating-acs-card
   *       entities: [climate.xxx]  # opzionale: solo questi, in quest'ordine (predefinito: trovati da soli)
   *       exclude: [climate.yyy]   # opzionale: climatizzatori da non mostrare
   *       order: [climate.zzz]     # opzionale: questi per primi, in quest'ordine (gli altri per nome)
   *       layout: tile             # opzionale: blocchi affiancati invece delle righe
   *       columns: 3               # opzionale, solo con layout: tile: blocchi per riga (2 o 3; predefinito: automatico)
   *       names:                   # opzionale: nome mostrato al posto di quello del climatizzatore
   *         - entity: climate.xxx
   *           name: Cucina
   * Trovati da soli: i climate che hanno tra gli hvac_modes cool, dry o fan_only (i termosifoni Tado no),
   * non nascosti, in ordine di nome. Nome, termometro e ventola arrivano dalla stanza se ce n'e' una (vedi heating-ac-card).
   */
  const ACS_MODES = ["cool", "dry", "fan_only"];

  class HeatingAcsCard extends HTMLElement {
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
        schema: [
          { name: "layout", selector: window.THM_HR_LAYOUT_SELECTOR },
          { name: "columns", selector: THM_COLUMNS_SELECTOR },
          { name: "entities", selector: { entity: { domain: "climate", multiple: true } } },
          { name: "order", selector: { entity: { domain: "climate", multiple: true } } },
          { name: "exclude", selector: { entity: { domain: "climate", multiple: true } } },
          {
            name: "names",
            selector: {
              object: {
                multiple: true,
                label_field: "name",
                fields: {
                  entity: { label: "Climatizzatore (climate)", required: true, selector: { entity: { domain: "climate" } } },
                  name: { label: "Nome", required: true, selector: { text: {} } },
                },
              },
            },
          },
        ],
        computeLabel: (s) =>
          ({
            layout: "Aspetto",
            columns: "Colonne dei blocchi",
            entities: "Climatizzatori da mostrare",
            order: "Ordine",
            exclude: "Climatizzatori da non mostrare",
            names: "Nomi personalizzati",
          }[s.name] || s.name),
        computeHelper: (s) =>
          ({
            columns: THM_COLUMNS_HELPER,
            entities: "Vuoto: tutti i climate con modalità freddo, deumidifica o ventola, in ordine di nome.",
            order: THM_ORDER_HELPER,
            names: "Solo in questa card. Gli altri usano il nome della stanza o del climate.",
          }[s.name]),
      };
    }

    _name(id) {
      const st = this._hass.states[id];
      return String((st && st.attributes.friendly_name) || id);
    }

    _acs() {
      const skip = new Set(this._config.exclude || []);
      const chosen = Array.isArray(this._config.entities) ? this._config.entities.filter(Boolean) : [];
      if (chosen.length) return thmOrder(chosen.filter((id) => !skip.has(id)), this._config.order);
      const reg = this._hass.entities || {};
      const found = Object.keys(this._hass.states)
        .filter((id) => {
          if (!id.startsWith("climate.") || skip.has(id)) return false;
          if (reg[id] && reg[id].hidden) return false;
          const modes = this._hass.states[id].attributes.hvac_modes || [];
          return modes.some((m) => ACS_MODES.includes(m));
        })
        .sort((a, b) => this._name(a).localeCompare(this._name(b), "it"));
      return thmOrder(found, this._config.order);
    }

    // Nomi personalizzati: elenco [{entity, name}] (editor) o mappa {climate: nome} (YAML).
    _names() {
      const n = this._config.names;
      const out = {};
      if (Array.isArray(n)) n.forEach((x) => x && x.entity && x.name && (out[x.entity] = String(x.name)));
      else if (n && typeof n === "object") Object.keys(n).forEach((k) => n[k] && (out[k] = String(n[k])));
      return out;
    }

    set hass(hass) {
      this._hass = hass;
      if (!this._config) return;
      const acs = this._acs();
      const sig = (this._config.layout || "row") + ":" + thmColumns(this._config.columns) + ":" + acs.join("|") + ":" +
        JSON.stringify(this._names());
      if (sig !== this._sig) {
        this._sig = sig;
        this._build(acs);
      }
      this._cards.forEach((c) => (c.hass = hass));
    }

    _build(acs) {
      this.shadowRoot.innerHTML = `
        <style>${THM_LIST_CSS}
        </style>
        <div class="list"></div>`;
      const list = this.shadowRoot.querySelector(".list");
      const tile = this._config.layout === "tile";
      list.classList.toggle("tile", tile);
      const cols = tile ? thmColumns(this._config.columns) : 0;
      if (cols) list.classList.add("c" + cols);
      this._cards = [];
      if (!acs.length) {
        list.innerHTML = `<ha-card class="empty">Nessun climatizzatore trovato: sceglili in "Climatizzatori da mostrare".</ha-card>`;
        return;
      }
      const names = this._names();
      acs.forEach((id) => {
        const card = document.createElement("heating-ac-card");
        const cfg = { entity: id };
        if (tile) cfg.layout = "tile";
        if (names[id]) cfg.name = names[id];
        card.setConfig(cfg);
        list.appendChild(card);
        this._cards.push(card);
      });
    }
  }

  if (!customElements.get("heating-acs-card")) {
    customElements.define("heating-acs-card", HeatingAcsCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-acs-card",
    name: "Heating ACs",
    description: "Una riga (o un blocco) per ogni climatizzatore, trovati da soli o scelti a mano.",
  });
}

// ===== heating-usage-card.js =====
{
  /* Heating Usage card: ore di riscaldamento e di valvola chiusa di ogni termosifone di Tado Heating Manager.
   * Uso:  type: custom:heating-usage-card
   *       title: Termosifoni                 # opzionale ("" = senza titolo)
   *       periods: [today, yesterday, 7d]    # opzionale: today, yesterday, 7d, 30d (sempre in quest'ordine)
   *       exclude: [climate.xxx]             # opzionale: stanze da non mostrare
   *       order: [climate.yyy]               # opzionale: questi per primi
   *       names: [{entity: climate.xxx, name: Camera}]   # opzionale
   * Le stanze arrivano da sensor.hp_all_rooms; le ore si calcolano dallo storico (recorder) dell'attributo hvac_action
   * del climate (heating / idle / off; non disponibile non conta). 7d/30d = oggi e i 6/29 giorni prima.
   * I giorni gia' chiusi si chiedono una volta sola e restano in cache nel browser (localStorage); oggi si rilegge
   * ogni 5 minuti e intanto si allunga con lo stato attuale.
   */
  const HU_COL = { heating: "#ff7043", idle: "#42a5f5", off: "#757575" };
  const HU_PERIODS = {
    today: { label: "Oggi", days: 1, skip: 0 },
    yesterday: { label: "Ieri", days: 1, skip: 1 },
    "7d": { label: "7 gg", days: 7, skip: 0 },
    "30d": { label: "30 gg", days: 30, skip: 0 },
  };
  const HU_DEFAULT = ["today", "yesterday", "7d"];
  const HU_STORE = "thm-usage-v1";
  const HU_KEEP_DAYS = 40;
  const HU_TODAY_REFRESH = 5 * 60e3;

  const huEsc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const huPad = (n) => String(n).padStart(2, "0");
  // mezzanotte locale di "i giorni fa"
  const huMidnight = (ago) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ago);
  };
  const huKey = (d) => `${d.getFullYear()}-${huPad(d.getMonth() + 1)}-${huPad(d.getDate())}`;
  // stato contato: hvac_action, altrimenti lo stato del climate (come il package delle ore)
  const huAct = (s, a) => {
    const v = (a && a.hvac_action) || s;
    return v === "heating" || v === "idle" || v === "off" ? v : null;
  };

  // Cache condivisa fra le card: "climate|AAAA-MM-GG" -> [secondi heating, idle, off] dei giorni chiusi.
  const HU_CACHE = (() => {
    try {
      const raw = JSON.parse(window.localStorage.getItem(HU_STORE) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (e) {
      return {};
    }
  })();
  const huSave = () => {
    const oldest = huKey(huMidnight(HU_KEEP_DAYS));
    Object.keys(HU_CACHE).forEach((k) => k.split("|")[1] < oldest && delete HU_CACHE[k]);
    try {
      window.localStorage.setItem(HU_STORE, JSON.stringify(HU_CACHE));
    } catch (e) {
      /* senza localStorage si ricalcola a ogni apertura */
    }
  };
  const HU_INFLIGHT = new Map();

  // punti {t (ms), act} di ogni entita' tra start e end
  const huFetch = async (hass, ids, start, end) => {
    const res = await hass.callWS({
      type: "history/history_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: ids,
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: false,
      no_attributes: false,
    });
    const out = {};
    ids.forEach((id) => {
      out[id] = ((res && res[id]) || []).map((p) => {
        const v = p.lu ?? p.lc ?? p.last_updated ?? p.last_changed;
        const t = typeof v === "string" ? Date.parse(v) : v * 1000;
        return { t: Math.max(t, start.getTime()), act: huAct(p.s ?? p.state, p.a ?? p.attributes) };
      });
    });
    return out;
  };

  // secondi [heating, idle, off] fra start e end (ms) dai punti ordinati
  const huSum = (points, start, end) => {
    const tot = [0, 0, 0];
    const idx = { heating: 0, idle: 1, off: 2 };
    points.forEach((p, i) => {
      const a = Math.max(p.t, start);
      const b = Math.min(i + 1 < points.length ? points[i + 1].t : end, end);
      if (b > a && p.act) tot[idx[p.act]] += (b - a) / 1000;
    });
    return tot;
  };

  // giorno chiuso (ago >= 1): dalla cache o dallo storico (una richiesta per giorno, condivisa fra le card)
  const huDay = (hass, ids, ago) => {
    const start = huMidnight(ago);
    const key = huKey(start);
    const missing = ids.filter((id) => !HU_CACHE[`${id}|${key}`]);
    if (!missing.length) return Promise.resolve();
    const fk = key + "|" + missing.join(",");
    if (HU_INFLIGHT.has(fk)) return HU_INFLIGHT.get(fk);
    const end = huMidnight(ago - 1);
    const pr = huFetch(hass, missing, start, end)
      .then((pts) => {
        missing.forEach((id) => (HU_CACHE[`${id}|${key}`] = huSum(pts[id], start.getTime(), end.getTime()).map(Math.round)));
        huSave();
      })
      .finally(() => HU_INFLIGHT.delete(fk));
    HU_INFLIGHT.set(fk, pr);
    return pr;
  };

  class HeatingUsageCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._today = {}; // climate -> punti di oggi
      this._todayKey = null;
      this._todayAt = 0;
      this._loading = false;
      this._error = "";
      this._sig = null;
    }

    setConfig(config) {
      this._config = config || {};
      const p = Array.isArray(this._config.periods) ? this._config.periods : HU_DEFAULT;
      this._periods = Object.keys(HU_PERIODS).filter((k) => p.includes(k));
      if (!this._periods.length) this._periods = HU_DEFAULT.slice();
      this._sig = null;
      this._build();
      if (this._hass) this.hass = this._hass;
    }

    getCardSize() {
      return 2 + (this._rooms ? this._rooms.length : 3);
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
          {
            name: "periods",
            selector: {
              select: {
                multiple: true,
                mode: "list",
                options: Object.keys(HU_PERIODS).map((k) => ({ value: k, label: HU_PERIODS[k].label })),
              },
            },
          },
          { name: "order", selector: { entity: { domain: "climate", multiple: true } } },
          { name: "exclude", selector: { entity: { domain: "climate", multiple: true } } },
          {
            name: "names",
            selector: {
              object: {
                multiple: true,
                label_field: "name",
                fields: {
                  entity: { label: "Termostato (climate)", required: true, selector: { entity: { domain: "climate" } } },
                  name: { label: "Nome", required: true, selector: { text: {} } },
                },
              },
            },
          },
        ],
        computeLabel: (s) =>
          ({
            title: "Titolo",
            periods: "Periodi",
            exclude: "Stanze da non mostrare",
            order: "Ordine",
            names: "Nomi personalizzati",
          }[s.name] || s.name),
        computeHelper: (s) =>
          ({
            periods: "Predefiniti: Oggi, Ieri, 7 gg. 7 e 30 gg comprendono oggi.",
            order: THM_ORDER_HELPER,
            exclude: "Le altre stanze di Tado Heating Manager compaiono da sole, nell'ordine delle stanze.",
            names: "Solo in questa card. Le stanze non elencate usano il nome di Tado Heating Manager.",
          }[s.name]),
      };
    }

    connectedCallback() {
      if (!this._timer) this._timer = window.setInterval(() => this._tick(), 60e3);
      if (this._hass) this._tick();
    }

    disconnectedCallback() {
      if (this._timer) window.clearInterval(this._timer);
      this._timer = null;
    }

    _roomList() {
      const st = this._hass.states["sensor.hp_all_rooms"];
      const rooms = (st && st.attributes.rooms) || [];
      const skip = new Set(this._config.exclude || []);
      const list = rooms.filter((r) => r.climate && !skip.has(r.climate));
      const byId = new Map(list.map((r) => [r.climate, r]));
      const names = {};
      const n = this._config.names;
      if (Array.isArray(n)) n.forEach((x) => x && x.entity && x.name && (names[x.entity] = String(x.name)));
      else if (n && typeof n === "object") Object.keys(n).forEach((k) => n[k] && (names[k] = String(n[k])));
      return thmOrder(list.map((r) => r.climate), this._config.order).map((id) => {
        const r = byId.get(id);
        return { climate: id, name: names[id] || r.name || id, thermometer: r.thermometer };
      });
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (!this._config) return;
      this._rooms = this._roomList();
      // ridisegno solo se cambiano le stanze o lo stato dei loro climate/termometri
      const sig = this._rooms
        .map((r) => {
          const c = hass.states[r.climate];
          const t = r.thermometer && hass.states[r.thermometer];
          return r.climate + r.name + (c ? c.last_updated : "-") + (t ? t.state : "-");
        })
        .join("|");
      if (sig !== this._sig) {
        const roomsChanged = !this._sig || this._sig.split("|").length !== this._rooms.length;
        this._sig = sig;
        if (roomsChanged || first) this._tick();
        else this._render();
      }
    }

    _ids() {
      return this._rooms.map((r) => r.climate);
    }

    _maxDays() {
      return Math.max(...this._periods.map((k) => HU_PERIODS[k].days + HU_PERIODS[k].skip));
    }

    // carica oggi (ogni 5 minuti o al cambio di giorno/stanze) e i giorni chiusi mancanti, dal piu' recente
    async _tick() {
      if (!this._hass || !this._config || !this._rooms || this._loading) {
        this._render();
        return;
      }
      const ids = this._ids();
      if (!ids.length) {
        this._render();
        return;
      }
      this._loading = true;
      try {
        const key = huKey(huMidnight(0));
        const idsSig = ids.join(",");
        if (key !== this._todayKey || idsSig !== this._todayIds || Date.now() - this._todayAt > HU_TODAY_REFRESH) {
          const pts = await huFetch(this._hass, ids, huMidnight(0), new Date());
          this._today = pts;
          this._todayKey = key;
          this._todayIds = idsSig;
          this._todayAt = Date.now();
          this._render();
        }
        const max = this._maxDays();
        for (let ago = 1; ago < max; ago++) {
          const before = huKey(huMidnight(ago));
          const had = ids.every((id) => HU_CACHE[`${id}|${before}`]);
          await huDay(this._hass, ids, ago);
          if (!had) this._render();
        }
        this._error = "";
      } catch (err) {
        this._error = "Storico non disponibile: " + ((err && err.message) || err);
      } finally {
        this._loading = false;
      }
      this._render();
    }

    // secondi [heating, idle, off] di oggi fino ad adesso, allungati con lo stato attuale del climate
    _todayTotals(id) {
      const pts = (this._today[id] || []).slice();
      const st = this._hass.states[id];
      if (st) {
        const t = Date.parse(st.last_updated);
        const act = huAct(st.state, st.attributes);
        const last = pts[pts.length - 1];
        if (!last) pts.push({ t: Math.max(t, huMidnight(0).getTime()), act });
        else if (t > last.t && act !== last.act) pts.push({ t, act });
      }
      return huSum(pts, huMidnight(0).getTime(), Date.now());
    }

    // totali del periodo, null se mancano ancora dei giorni
    _period(id, k) {
      const p = HU_PERIODS[k];
      const tot = [0, 0, 0];
      for (let ago = p.skip; ago < p.skip + p.days; ago++) {
        let d;
        if (ago === 0) {
          if (this._todayKey !== huKey(huMidnight(0))) return null;
          d = this._todayTotals(id);
        } else {
          d = HU_CACHE[`${id}|${huKey(huMidnight(ago))}`];
          if (!d) return null;
        }
        d.forEach((v, i) => (tot[i] += v));
      }
      return tot;
    }

    _build() {
      this.shadowRoot.innerHTML = `
        <style>
          ha-card { padding: 12px 14px 10px; color: var(--primary-text-color); }
          .title { font-size: 1.2em; font-weight: 600; margin: 0 2px 8px; }
          .title:empty { display: none; }
          table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
          th { font-size: .8em; font-weight: 500; color: var(--secondary-text-color); text-align: right; padding: 0 0 4px 6px; }
          th:first-child { text-align: left; padding-left: 0; }
          td { text-align: right; padding: 6px 0 6px 6px; border-top: 1px solid var(--divider-color); vertical-align: middle; white-space: nowrap; }
          td.room { text-align: left; padding-left: 0; white-space: normal; }
          .room-in { display: flex; align-items: center; gap: 6px; min-width: 0; }
          .room ha-icon { --mdc-icon-size: 22px; cursor: pointer; flex: none; }
          .room a { color: var(--primary-text-color); text-decoration: none; cursor: pointer; overflow: hidden; text-overflow: ellipsis; }
          .room a:hover { text-decoration: underline; }
          b { font-weight: 600; }
          small { font-size: .78em; }
          .heat { color: ${HU_COL.heating}; }
          .idle { color: ${HU_COL.idle}; }
          .sub { color: var(--secondary-text-color); }
          .legend { margin-top: 8px; font-size: .75em; color: var(--secondary-text-color); line-height: 1.5; }
          .msg { color: var(--secondary-text-color); padding: 8px 2px; }
        </style>
        <ha-card>
          <div class="title"></div>
          <div class="body"></div>
          <div class="legend">
            <span class="heat">●</span> ore riscaldamento &nbsp; <span class="idle">●</span> ore idle (valvola chiusa)
            &nbsp; <span style="color:${HU_COL.off}">●</span> spento · % = quota di tempo in riscaldamento sul tempo acceso
          </div>
          <div class="msg err" hidden></div>
        </ha-card>`;
      this._e = {
        title: this.shadowRoot.querySelector(".title"),
        body: this.shadowRoot.querySelector(".body"),
        err: this.shadowRoot.querySelector(".err"),
      };
      this.shadowRoot.addEventListener("click", (ev) => {
        const more = ev.target.closest("[data-more]");
        if (more) {
          this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: more.dataset.more }, bubbles: true, composed: true }));
          return;
        }
        const hist = ev.target.closest("[data-history]");
        if (hist) {
          ev.preventDefault();
          window.history.pushState(null, "", "/history?entity_id=" + encodeURIComponent(hist.dataset.history));
          window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
        }
      });
    }

    _cell(t) {
      if (!t) return `<td class="sub">…</td>`;
      const h = (s) => (s / 3600).toFixed(1);
      const on = t[0] + t[1];
      const perc = on > 0 ? Math.round((t[0] / on) * 100) : 0;
      return `<td><span class="heat">${h(t[0])} h</span><br><small class="idle">${h(t[1])} h · ${perc}%</small></td>`;
    }

    _render() {
      if (!this._e || !this._hass || !this._rooms) return;
      const title = this._config.title === undefined ? "Termosifoni" : String(this._config.title || "");
      this._e.title.textContent = title;
      this._e.err.hidden = !this._error;
      this._e.err.textContent = this._error;
      if (!this._rooms.length) {
        this._e.body.innerHTML = `<div class="msg">Nessun termosifone: aggiungi le stanze in Tado Heating Manager.<br>${THM_EMPTY_BTN}</div>`;
        this._e.body.querySelector(".thm-cfg").addEventListener("click", thmOpenConfig);
        return;
      }
      const head = this._periods.map((k) => `<th>${HU_PERIODS[k].label}</th>`).join("");
      const rows = this._rooms
        .map((r) => {
          const c = this._hass.states[r.climate];
          const a = (c && c.attributes) || {};
          const act = c ? huAct(c.state, a) || "off" : "off";
          const th = r.thermometer && this._hass.states[r.thermometer];
          let temp = th && !isNaN(parseFloat(th.state)) ? parseFloat(th.state) : a.current_temperature;
          temp = temp === undefined || temp === null || isNaN(Number(temp)) ? "--" : Number(temp).toFixed(1);
          const sub = !c || c.state === "off" ? "off" : a.temperature != null ? `→ ${huEsc(a.temperature)}°` : huEsc(c.state);
          return `<tr>
            <td class="room"><div class="room-in">
              <ha-icon icon="mdi:radiator" style="color:${HU_COL[act]}" data-more="${huEsc(r.climate)}"></ha-icon>
              <a href="/history?entity_id=${encodeURIComponent(r.climate)}" data-history="${huEsc(r.climate)}">${huEsc(r.name)}</a>
            </div></td>
            <td><b>${huEsc(temp)}°</b><br><small class="sub">${sub}</small></td>
            ${this._periods.map((k) => this._cell(this._period(r.climate, k))).join("")}
          </tr>`;
        })
        .join("");
      this._e.body.innerHTML = `<table><tr><th>Stanza</th><th>Temp</th>${head}</tr>${rows}</table>`;
    }
  }

  if (!customElements.get("heating-usage-card")) {
    customElements.define("heating-usage-card", HeatingUsageCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "heating-usage-card",
    name: "Heating Usage",
    description: "Ore di riscaldamento e valvola chiusa per stanza (oggi, ieri, 7 e 30 giorni), dallo storico di HA.",
  });
}

// ===== tado-quota-card.js =====
{
  /* Quota API Tado: stato, indicatori, dettaglio delle chiamate e utilizzo.
   * Uso:  type: custom:tado-quota-card
   * Opzioni (tutte facoltative):
   *   title: "Quota API Tado"
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
      this._config = { title: "Quota API Tado", ...(config || {}) };
      this._sig = "";
      this._ids = null;
      this._open = this._open || new Set();
      this._build();
    }

    getCardSize() {
      return 7;
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
        ],
        computeLabel: (s) => ({ title: "Titolo" }[s.name] || s.name),
      };
    }

    set hass(hass) {
      this._hass = hass;
      // il registro puo' arrivare dopo il primo hass: finche' manca si riprova
      if (!this._ids || !this._idsFromReg) this._ids = this._resolve();
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
          .chev { --mdc-icon-size: 20px; flex: none; cursor: pointer; transition: transform .15s; color: var(--secondary-text-color); padding: 2px; }
          .chev.open { transform: rotate(90deg); }
          .subs { display: none; }
          .subs.open { display: block; }
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
          <div class="sources"></div>
          <div class="sec">Utilizzo chiamate</div>
          <div class="bar"></div>
          <div class="legend"></div>
        </ha-card>`;
      const $ = (s) => this.shadowRoot.querySelector(s);
      this._e = {
        title: $(".title"), badge: $(".badge"), dot: $(".dot"), mtxt: $(".mtxt"), reset: $(".reset"),
        g1: $(".g1"), g2: $(".g2"), v1: $(".v1"), v2: $(".v2"),
        detail: $(".detail"), srcsec: $(".srcsec"), bar: $(".bar"), legend: $(".legend"), sources: $(".sources"),
      };
      this.shadowRoot.addEventListener("click", (ev) => {
        const ch = ev.target.closest("[data-tg]");
        if (ch) {
          const k = ch.dataset.tg;
          if (this._open.has(k)) this._open.delete(k);
          else this._open.add(k);
          const on = this._open.has(k);
          ch.classList.toggle("open", on);
          const box = this.shadowRoot.querySelector(`.subs[data-g="${k}"]`);
          if (box) box.classList.toggle("open", on);
          return;
        }
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

    _row(key, icon, name, value, sub, toggle) {
      const chev = toggle
        ? `<ha-icon class="chev${this._open.has(toggle) ? " open" : ""}" data-tg="${toggle}" icon="mdi:chevron-right"></ha-icon>`
        : "";
      return `<div class="row${sub ? " sub" : ""}" data-k="${key}"><ha-icon icon="${icon}"></ha-icon>` +
        `<span class="n">${tqEsc(name)}</span><span class="x">${tqEsc(value)}</span>${chev}</div>`;
    }

    // blocco chiudibile: riga madre (con freccia) + note + sottovoci nascoste finche' non si apre
    _group(g, key, icon, name, value, noteHtml, subs) {
      if (!subs) return this._row(key, icon, name, value) + noteHtml;
      return this._row(key, icon, name, value, false, g) + noteHtml +
        `<div class="subs${this._open.has(g) ? " open" : ""}" data-g="${g}">${subs}</div>`;
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
      let src = "";
      let subs = "";
      const known = new Set(TQ_TRACKED_TYPES.map((t) => t[0]));
      const byType = ca.by_type || {};
      [...TQ_TRACKED_TYPES, ...Object.keys(byType).filter((k) => !known.has(k)).map((k) => [k, "mdi:api", k])]
        .forEach(([a, icon, label]) => {
          const v = byType[a] ?? ca[a];
          if (v) subs += this._row("tado_ce_tracked", icon, label, String(v), true);
        });
      src += this._group("ce", "tado_ce_tracked", "mdi:home-thermometer", "Tado CE", fmt(ce),
        note("Tado CE legge e comanda le valvole dal cloud. Queste le conta da solo."), subs);
      if (ok(hid)) {
        let hs = "";
        TQ_UNTRACKED_TYPES.forEach(([a, icon, label]) => {
          if (n(ha[a])) hs += this._row("tado_ce_untracked", icon, label, String(ha[a]), true);
        });
        src += this._group("hid", "tado_ce_untracked", "mdi:eye-off-outline", "Tado CE, controlli extra", fmt(hid),
          note("Le fa sempre Tado CE, ma non le segna nel suo contatore: le calcoliamo dai suoi aggiornamenti (stima)."), hs);
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
    description: "Quota API Tado: stato, indicatori, provenienza delle chiamate (voci espandibili) e utilizzo.",
  });
}

