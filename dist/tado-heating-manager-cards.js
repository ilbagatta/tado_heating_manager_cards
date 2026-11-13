/* Tado Heating Manager Cards
 * Card Lovelace per l'integrazione Tado Heating Manager (custom_components/tado_heating_manager).
 * Un solo file con tre card, senza dipendenze e senza build:
 *   custom:heating-planner-card    programmi a fasce di tutte le stanze (Feriali / Weekend)
 *   custom:heating-radiator-card   riga di un termosifone
 *   custom:heating-ac-card         riga di un climatizzatore
 * Ogni card e' racchiusa in un blocco { } cosi' le costanti non si scontrano.
 */
const THM_CARDS_VERSION = "2.0.1";
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
      if (this._room !== "summary" && this._room !== "all" && !allRooms.some((r) => r.slug === this._room)) this._room = "summary";
      const summary = this._room === "summary";
      const single = !summary && this._room !== "all";
      if (summary || single) this._orderMode = false;
      const rooms = single ? allRooms.filter((r) => r.slug === this._room) : allRooms;
      const title = this._config.title || "Riscaldamento";
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
          .title { font-size:1.25em; font-weight:500; }
          .roomsel { width:100%; box-sizing:border-box; margin-bottom:10px; padding:10px; border-radius:10px; font-size:1em;
                     border:1px solid var(--divider-color); background:var(--card-background-color); color:var(--primary-text-color); }
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
          <div class="top">
            <div class="title">${hpEsc(title)}</div>
            ${summary || single ? "" : `<button class="ord ${this._orderMode ? "sel" : ""}" data-order-toggle="1">${this._orderMode ? "Fatto" : "Ordina stanze"}</button>`}
            <label class="toggle" title="Tutti i programmi attivi">
              <input type="checkbox" data-switch="switch.hp_all_enabled" ${hubOn ? "checked" : ""}>
              <span></span>
            </label>
          </div>
          <select class="roomsel" aria-label="Termosifone">
            <option value="summary" ${summary ? "selected" : ""}>Riepilogo (fasce attive)</option>
            <option value="all" ${this._room === "all" ? "selected" : ""}>Tutti (modifica)</option>
            ${allRooms.map((r) => `<option value="${hpEsc(r.slug)}" ${r.slug === this._room ? "selected" : ""}>${hpEsc(r.name)}</option>`).join("")}
          </select>
          ${summary ? "" : `<div class="tabs">
            ${Object.entries(HP_KINDS)
              .map(([key, label]) => `<button class="tab ${key === k ? "sel" : ""}" data-kind="${key}">${label}</button>`)
              .join("")}
          </div>`}
          <div class="grid ${summary ? "compact" : ""}">${(summary ? summaryHtml : roomHtml) || '<div class="empty">Nessun termosifone configurato.</div>'}</div>
        </ha-card>`;

      const root = this.shadowRoot;
      const sel = root.querySelector(".roomsel");
      if (sel) {
        sel.addEventListener("change", () => {
          this._room = sel.value;
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
      return this._config.offset_prioritario || this._autoOffset();
    }

    _signature() {
      const c = this._config;
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
          <div class="icon"><ha-icon icon="mdi:radiator" style="--mdc-icon-size:24px"></ha-icon></div>
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
        icon: $(".icon ha-icon"),
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
            const id = el.dataset.a === "fan" ? this._config.fan : this._config.entity;
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
      const c = this._st(this._config.entity);
      if (!c) return;
      const id = this._config.entity;
      if (a === "mode") {
        this._openModeMenu();
      } else if (a === "fan") {
        this._hass.callService("homeassistant", "toggle", { entity_id: this._config.fan });
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
      const c = this._st(this._config.entity);
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
          this._hass.callService("climate", "set_hvac_mode", { entity_id: this._config.entity, hvac_mode: mode });
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
      const cfg = this._config;
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
      const cfg = this._config;
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
      const cfg = this._config;
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
      const cfg = this._config;
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
          <div class="icon"><ha-icon icon="mdi:air-conditioner" style="--mdc-icon-size:24px"></ha-icon></div>
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
