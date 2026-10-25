// Seat map for the crew dashboard. Everything here starts with "sm" so it cannot clash with other features.
// It asks the server for the seats every 3 seconds and changes only the seats that changed.
(() => {
  "use strict";

  const root = document.getElementById("sm-root");
  if (!root) return;

  const url = root.dataset.url;
  const $ = (id) => document.getElementById(id);
  const stage = $("sm-stage"), tabsEl = $("sm-tabs"), legendEl = $("sm-legend"), tickerEl = $("sm-ticker");
  const drawer = $("sm-drawer"), drawerBody = $("sm-drawer-body"), scrim = $("sm-scrim");
  const liveEl = $("sm-live"), liveText = $("sm-live-text"), searchEl = $("sm-search");
  const modeToggle = $("sm-flight-mode-toggle"), modeState = $("sm-flight-mode-state"), modeLabel = $("sm-flight-mode-label");
  const feedbackCard = document.getElementById("sm-buffer-feedback");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const LETTERS = ["A", "B", "C", "D", "E", "F"];
  const EXIT_ROWS = [12, 13];
  const WING_ROWS = [10, 11, 12, 13, 14, 15];

  const state = { data: null, cabin: "all", filter: null, query: "", selected: null };
  let meals = {}, bySeat = {}, seatEls = {}, tickerTimer = null, legendSig = "";

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function mealName(code) { return code && meals[code] ? meals[code].name : "No meal chosen"; }
  function cabinOf(row) { return state.data.cabins.find((c) => row >= c.first && row <= c.last); }
  function seatsIn(cab) { return state.data.seats.filter((s) => s.row >= cab.first && s.row <= cab.last); }

  function stats(cab) {
    const list = seatsIn(cab);
    const seated = list.filter((s) => !s.empty);
    return {
      total: list.length, seated: seated.length,
      alerts: seated.filter((s) => s.alert).length,
      none: seated.filter((s) => !s.meal).length,
    };
  }

  // ------------------------------------------------------------------ filtering
  function matches(s) {
    if (s.empty) return false;
    if (state.filter === "alert" && !s.alert) return false;
    if (state.filter === "none" && s.meal) return false;
    if (state.filter && state.filter !== "alert" && state.filter !== "none" && s.meal !== state.filter) return false;
    const q = state.query.trim().toLowerCase();
    if (q && !(s.seat.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.pnr.toLowerCase().includes(q))) return false;
    return true;
  }

  function applyDim() {
    const active = Boolean(state.filter) || state.query.trim() !== "";
    state.data.seats.forEach((s) => {
      const el = seatEls[s.seat];
      if (!el) return;
      el.classList.toggle("is-dim", active && !matches(s));
      el.classList.toggle("is-hit", active && matches(s));
    });
  }

  // ------------------------------------------------------------------ seats
  function look(el, s) {
    el.classList.toggle("is-empty", s.empty);
    el.classList.toggle("is-none", !s.empty && !s.meal);
    el.classList.toggle("is-alert", Boolean(s.alert));
    const serviceStatus = s.service_status || "pending";
    el.classList.toggle("is-service-delivered", serviceStatus === "delivered");
    el.classList.toggle("is-service-not-delivered", serviceStatus === "not_delivered");
    el.classList.toggle("is-service-cancelled", serviceStatus === "cancelled");
    el.classList.toggle("has-exchange-order", Boolean(s.exchange_purchase));
    el.disabled = s.empty;
    if (s.empty) {
      el.removeAttribute("style");
      el.setAttribute("aria-label", "Seat " + s.seat + ", empty");
      el.title = "Seat " + s.seat + " is empty";
      return;
    }
    if (s.meal && meals[s.meal]) el.style.setProperty("--meal", meals[s.meal].color);
    const categoryLabel = mealName(s.meal);
    const dishLabel = s.dish_name ? " → " + s.dish_name : "";
    const label = "Seat " + s.seat + ", " + s.name + ", " + categoryLabel + dishLabel + (s.alert ? ", alert: " + s.care.title : "");
    el.setAttribute("aria-label", label);
    el.title = s.seat + " · " + s.first + " · " + categoryLabel + dishLabel;
  }

  function makeSeat(s, order) {
    const el = h("button", "sm-seat");
    el.type = "button";
    el.dataset.seat = s.seat;
    el.style.setProperty("--d", Math.min(order * 14, 900) + "ms");
    el.append(h("span", "sm-back"), h("span", "sm-cush"), h("i", "sm-flag"), h("i", "sm-service-mark"));
    look(el, s);
    el.addEventListener("click", () => openSeat(s.seat));
    seatEls[s.seat] = el;
    return el;
  }

  // ------------------------------------------------------------------ cabins
  function countUp(el, to) {
    if (reduced || to === 0) { el.textContent = to; return; }
    const start = performance.now(), dur = 700;
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function statCell(label, value, kind) {
    const cell = h("span", "sm-stat" + (kind ? " sm-stat-" + kind : ""));
    const num = h("b", null, "0");
    num.dataset.stat = label;
    cell.append(num, h("small", null, label));
    num.dataset.target = value;
    return cell;
  }

  function buildCabin(cab, index) {
    const st = stats(cab);
    const fig = h("section", "sm-cabin");
    fig.dataset.cabin = cab.key;
    fig.style.setProperty("--ci", index);

    const head = h("header", "sm-cabin-head");
    const title = h("div");
    title.append(h("h3", null, cab.name), h("p", null, "Rows " + cab.first + " to " + cab.last + " · Cabin lead " + cab.lead));
    const row = h("div", "sm-stats");
    row.append(statCell("Seated", st.seated), statCell("Alerts", st.alerts, "alert"), statCell("No meal", st.none, "none"));
    head.append(title, row);
    fig.append(head);

    const fuse = h("div", "sm-fuse sm-fuse-" + cab.key);
    if (cab.key === "fwd") fuse.append(h("div", "sm-zone", "Doors 1L and 1R · Galley"));
    const cols = h("div", "sm-cols");
    ["A", "B", "C", "", "D", "E", "F"].forEach((c) => cols.append(h("span", null, c)));
    fuse.append(cols);

    let order = 0;
    for (let r = cab.first; r <= cab.last; r++) {
      const rowEl = h("div", "sm-row" + (EXIT_ROWS.includes(r) ? " sm-row-exit" : "") + (WING_ROWS.includes(r) ? " sm-row-wing" : ""));
      rowEl.dataset.row = r;
      LETTERS.forEach((l, i) => {
        if (i === 3) {
          const rn = h("span", "sm-rn", String(r));
          if (EXIT_ROWS.includes(r)) { rn.title = "Exit row"; rn.dataset.exit = "EXIT"; }
          rowEl.append(rn);
        }
        rowEl.append(makeSeat(bySeat[r + l], order++));
      });
      fuse.append(rowEl);
    }
    if (cab.key === "aft") fuse.append(h("div", "sm-zone", "Lavatories · Door 4 · Galley"));
    fig.append(fuse);

    fig.querySelectorAll(".sm-stat b").forEach((b) => countUp(b, Number(b.dataset.target)));
    return fig;
  }

  function buildStage() {
    seatEls = {};
    stage.replaceChildren();
    stage.className = "sm-stage " + (state.cabin === "all" ? "sm-view-all" : "sm-view-one") + " sm-intro";
    const list = state.cabin === "all" ? state.data.cabins : state.data.cabins.filter((c) => c.key === state.cabin);
    list.forEach((cab, i) => stage.append(buildCabin(cab, i)));
    placeWings();
    applyDim();
    markSelected();
    window.setTimeout(() => stage.classList.remove("sm-intro"), 1600);
  }

  // Wings are drawn beside the rows over the wing, so they need the rows' real position on the page.
  function placeWings() {
    stage.querySelectorAll(".sm-fuse").forEach((fuse) => {
      const rows = fuse.querySelectorAll(".sm-row-wing");
      if (!rows.length) return;
      const first = rows[0], last = rows[rows.length - 1];
      ["l", "r"].forEach((side) => {
        const wing = h("span", "sm-wing sm-wing-" + side);
        wing.style.top = first.offsetTop + "px";
        wing.style.height = (last.offsetTop + last.offsetHeight - first.offsetTop) + "px";
        fuse.append(wing);
      });
    });
  }

  function refreshCabinStats() {
    state.data.cabins.forEach((cab) => {
      const fig = stage.querySelector('.sm-cabin[data-cabin="' + cab.key + '"]');
      if (!fig) return;
      const st = stats(cab);
      const set = { "Seated": st.seated, "Alerts": st.alerts, "No meal": st.none };
      fig.querySelectorAll(".sm-stat b").forEach((b) => {
        const v = set[b.dataset.stat];
        if (String(v) !== b.textContent) { b.textContent = v; b.classList.remove("sm-bump"); void b.offsetWidth; b.classList.add("sm-bump"); }
      });
    });
  }

  // ------------------------------------------------------------------ tabs and legend
  function buildTabs() {
    tabsEl.replaceChildren();
    const defs = [{ key: "all", name: "Whole plane", sub: "Rows 1 to " + state.data.rows, alerts: state.data.seats.filter((s) => s.alert).length }]
      .concat(state.data.cabins.map((c) => ({ key: c.key, name: c.name.replace(" cabin", ""), sub: "Rows " + c.first + " to " + c.last, alerts: stats(c).alerts })));
    defs.forEach((d) => {
      const b = h("button", "sm-tab");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.key = d.key;
      b.setAttribute("aria-selected", String(d.key === state.cabin));
      const text = h("span");
      text.append(h("b", null, d.name), h("small", null, d.sub));
      b.append(text);
      const badge = h("em", "sm-tab-badge", String(d.alerts));
      badge.title = d.alerts + " alert seats";
      b.append(badge);
      b.addEventListener("click", () => {
        if (state.cabin === d.key) return;
        state.cabin = d.key;
        tabsEl.querySelectorAll(".sm-tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.key === d.key)));
        buildStage();
      });
      tabsEl.append(b);
    });
  }

  function refreshTabBadges() {
    const alerts = { all: state.data.seats.filter((s) => s.alert).length };
    state.data.cabins.forEach((c) => { alerts[c.key] = stats(c).alerts; });
    tabsEl.querySelectorAll(".sm-tab").forEach((t) => { t.querySelector(".sm-tab-badge").textContent = alerts[t.dataset.key]; });
  }

  function buildLegend() {
    const seated = state.data.seats.filter((s) => !s.empty);
    const items = state.data.meals.filter((m) => m.count > 0).sort((a, b) => b.count - a.count);
    const alerts = seated.filter((s) => s.alert).length, none = seated.filter((s) => !s.meal).length;
    const sig = items.map((m) => m.code + m.count).join() + "|" + alerts + "|" + none + "|" + state.filter;
    if (sig === legendSig) return;
    legendSig = sig;
    legendEl.replaceChildren();
    function chip(key, label, count, extra, color) {
      const b = h("button", "sm-chip" + (extra ? " " + extra : ""));
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.filter === key));
      if (color) b.style.setProperty("--meal", color);
      b.append(h("i", "sm-dot"), h("span", null, label), h("b", null, String(count)));
      b.addEventListener("click", () => {
        state.filter = state.filter === key ? null : key;
        legendSig = "";
        buildLegend();
        applyDim();
      });
      legendEl.append(b);
    }
    chip("alert", "Alerts", alerts, "sm-chip-alert");
    chip("none", "No meal", none, "sm-chip-none");
    items.forEach((m) => chip(m.code, m.name, m.count, "", m.color));
  }

  // ------------------------------------------------------------------ onboard service, exchange and feedback controls
  function postForm(url, values) {
    const body = new URLSearchParams(Object.assign({ csrf_token: root.dataset.csrf || "" }, values || {}));
    return fetch(url, { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "Accept": "application/json" }, body })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.ok) throw new Error(payload.message || "The action could not be completed.");
        return payload;
      });
  }

  function serviceUrlFor(passengerId) {
    return root.dataset.serviceUrl.replace(/\/0\/service$/, "/" + passengerId + "/service");
  }
  function exchangeServiceUrlFor(purchaseId) {
    return root.dataset.exchangeServiceUrl.replace(/\/0\/service$/, "/" + purchaseId + "/service");
  }

  async function updateSeatService(s, action) {
    try {
      const result = await postForm(serviceUrlFor(s.passenger_id), { action });
      say(result.message || "Service status updated.");
      await load(false);
      if (state.selected) fillDrawer();
    } catch (err) {
      say(err.message || "Could not update meal service.");
    }
  }

  async function updateExchangeService(s, action) {
    if (!s.exchange_purchase) return;
    try {
      const result = await postForm(exchangeServiceUrlFor(s.exchange_purchase.id), { action });
      say(result.message || "Exchange meal status updated.");
      await load(false);
      if (state.selected) fillDrawer();
    } catch (err) {
      say(err.message || "Could not update exchange meal.");
    }
  }

  function actionButton(label, action, klass, disabled, callback) {
    const button = h("button", "sm-service-action" + (klass ? " " + klass : ""), label);
    button.type = "button";
    button.disabled = Boolean(disabled);
    button.addEventListener("click", callback || (() => {}));
    return button;
  }

  function renderFlightOps(data) {
    const enabled = Boolean(data.on_flight_mode);
    if (modeToggle) {
      modeToggle.setAttribute("aria-pressed", String(enabled));
      modeToggle.classList.toggle("is-on", enabled);
      modeToggle.disabled = false;
    }
    if (modeLabel) modeLabel.textContent = enabled ? "Turn off" : "Turn on";
    if (modeState) {
      modeState.textContent = enabled ? "ON · SERVICE IN PROGRESS" : "OFF · PRE-SERVICE";
      modeState.classList.toggle("is-active", enabled);
    }
    const stats = data.service_feedback || {};
    document.querySelectorAll("[data-sm-outcome]").forEach((node) => {
      const key = node.dataset.smOutcome;
      const value = Number(stats[key] || 0);
      if (node.textContent !== String(value)) {
        node.textContent = String(value);
        if (!reduced) { node.classList.remove("sm-stat-bump"); void node.offsetWidth; node.classList.add("sm-stat-bump"); }
      }
    });
    renderBufferFeedback(stats);
  }

  function renderBufferFeedback(summary) {
    if (!feedbackCard) return;
    const base = Number(summary.base_buffer ?? feedbackCard.dataset.baseBuffer ?? 0);
    const setText = (selector, text) => { const node = feedbackCard.querySelector(selector); if (node) node.textContent = text; };
    setText("[data-fb-delivered]", summary.delivered ?? 0);
    setText("[data-fb-not-delivered]", summary.not_delivered ?? 0);
    setText("[data-fb-sold]", summary.offers_sold ?? 0);
    setText("[data-fb-unclaimed]", summary.unclaimed_canceled ?? 0);
    const sample = Number(summary.outcomes_count || 0);
    setText("[data-fb-sample]", `${sample}/4 min.`);
    setText("[data-fb-base]", base);
    const adjustment = Number(summary.adjustment || 0);
    setText("[data-fb-adjustment]", summary.ready ? Math.abs(adjustment) : "—");
    setText("[data-fb-operator]", adjustment < 0 ? "−" : "+");
    setText("[data-fb-next]", Math.max(0, base + adjustment));
    const status = feedbackCard.querySelector("[data-fb-status]");
    const foot = feedbackCard.querySelector("[data-fb-footnote]");
    feedbackCard.classList.toggle("is-feedback-ready", Boolean(summary.ready));
    if (status) status.textContent = summary.ready ? "Feedback sample ready" : `Collecting service outcomes · ${Math.min(sample, 4)} of 4 recorded`;
    if (foot) foot.textContent = summary.ready
      ? `Not-delivered rate: ${Number(summary.not_delivered_rate || 0).toFixed(1)}%; unclaimed-cancellation rate: ${Number(summary.unclaimed_rate || 0).toFixed(1)}%. Not-delivered outcomes can raise the next-flight buffer; unclaimed canceled meals can lower it. Review delivery failure causes before using this planning signal. It never changes meals already loaded.`
      : "Record at least four closed meal outcomes before the demo recommends a next-flight buffer adjustment. Resold meals count as reassigned, not wasted; this does not change current loaded stock.";
  }

  if (modeToggle) {
    modeToggle.addEventListener("click", async () => {
      if (!state.data) return;
      const enabling = !state.data.on_flight_mode;
      if (enabling && !window.confirm("Start on-flight service mode? Seat details will show delivery controls and meal cancellations can create a 20% discounted offer for other passengers.")) return;
      modeToggle.disabled = true;
      try {
        const result = await postForm(root.dataset.modeUrl, { enabled: enabling ? "1" : "0" });
        say(result.message || "On-flight mode updated.");
        await load(false);
      } catch (err) {
        say(err.message || "Could not change on-flight mode.");
      } finally {
        modeToggle.disabled = false;
      }
    });
  }

  // ------------------------------------------------------------------ drawer
  function markSelected() {
    Object.values(seatEls).forEach((el) => el.classList.remove("is-selected", "is-kin"));
    if (!state.selected) return;
    const s = bySeat[state.selected];
    if (!s) return;
    if (seatEls[s.seat]) seatEls[s.seat].classList.add("is-selected");
    state.data.seats.forEach((o) => { if (!o.empty && o.pnr === s.pnr && o.seat !== s.seat && seatEls[o.seat]) seatEls[o.seat].classList.add("is-kin"); });
  }

  function appendServicePanel(s) {
    const panel = h("section", "sm-d-service");
    const head = h("div", "sm-d-service-head");
    const copy = h("div");
    copy.append(h("small", null, "ON-FLIGHT SERVICE"), h("b", null, "Meal delivery"));
    const status = s.service_status || "pending";
    const statusLabel = status === "delivered" ? "Delivered" : status === "not_delivered" ? "Not delivered" : status === "cancelled" ? "Canceled · offer released" : "Awaiting service";
    const badge = h("span", "sm-d-service-badge is-" + status, statusLabel);
    head.append(copy, badge);
    panel.append(head);

    if (!state.data.on_flight_mode) {
      panel.append(h("p", "sm-d-service-copy", "Turn on On-flight mode above the seat map to record deliveries and release canceled meals to other passengers."));
    } else if (!s.meal) {
      panel.append(h("p", "sm-d-service-copy", "No meal is selected for this passenger."));
    } else if (status === "cancelled") {
      panel.append(h("p", "sm-d-service-copy", "This meal is canceled and was made available to other passengers at 20% off. The passenger’s original selection remains in the booking history."));
    } else if (status === "delivered") {
      if (s.service_updated_at) panel.append(h("p", "sm-d-service-copy", `Updated ${s.service_updated_at}${s.service_updated_by ? " by " + s.service_updated_by : ""}.`));
      panel.append(h("p", "sm-d-service-copy", "Delivery is recorded as complete. This meal is locked and cannot be canceled or re-offered."));
    } else {
      if (s.service_updated_at) panel.append(h("p", "sm-d-service-copy", `Updated ${s.service_updated_at}${s.service_updated_by ? " by " + s.service_updated_by : ""}.`));
      const actions = h("div", "sm-d-service-actions");
      actions.append(actionButton("✓ Mark delivered", "delivered", "is-delivered", false, () => updateSeatService(s, "delivered")));
      actions.append(actionButton("× Not delivered", "not_delivered", "is-not-delivered", status === "not_delivered", () => updateSeatService(s, "not_delivered")));
      const cancel = actionButton("Release meal · 20% off", "cancel_meal", "is-cancel", false, () => {
        const dish = s.dish_name || mealName(s.meal);
        if (window.confirm(`Cancel ${dish} for seat ${s.seat} and offer this meal to other passengers at 20% off?`)) updateSeatService(s, "cancel_meal");
      });
      actions.append(cancel);
      panel.append(actions);
    }
    drawerBody.append(panel);

    if (s.exchange_purchase) {
      const order = s.exchange_purchase;
      const exchange = h("section", "sm-d-service sm-d-exchange");
      const xhead = h("div", "sm-d-service-head");
      const xcopy = h("div");
      xcopy.append(h("small", null, "MEAL EXCHANGE ORDER"), h("b", null, order.dish_name));
      const xstatus = order.status === "delivered" ? "Delivered" : order.status === "not_delivered" ? "Not delivered" : "Awaiting delivery";
      xhead.append(xcopy, h("span", "sm-d-service-badge is-" + order.status, xstatus));
      exchange.append(xhead, h("p", "sm-d-service-copy", `Discounted purchase · ₹${order.amount_paid} paid in the demo.`));
      if (state.data.on_flight_mode && order.status !== "delivered") {
        const xactions = h("div", "sm-d-service-actions");
        xactions.append(actionButton("✓ Exchange delivered", "delivered", "is-delivered", false, () => updateExchangeService(s, "delivered")));
        xactions.append(actionButton("× Not delivered", "not_delivered", "is-not-delivered", false, () => updateExchangeService(s, "not_delivered")));
        exchange.append(xactions);
      }
      drawerBody.append(exchange);
    }
  }

  function fillDrawer() {
    const s = bySeat[state.selected];
    if (!s) return;
    const cab = cabinOf(s.row);
    const m = s.meal ? meals[s.meal] : null;
    drawerBody.replaceChildren();

    const top = h("div", "sm-d-top");
    const id = h("div", "sm-d-seat");
    id.append(h("small", null, cab.name.toUpperCase()), h("b", null, s.seat));
    const close = h("button", "sm-d-close");
    close.type = "button";
    close.setAttribute("aria-label", "Close seat details");
    close.textContent = "×";
    close.addEventListener("click", closeDrawer);
    top.append(id, close);

    const who = h("div", "sm-d-who");
    who.append(h("b", null, s.name), h("small", null, "Booking " + s.pnr));

    const meal = h("div", "sm-d-meal");
    if (m) meal.style.setProperty("--meal", m.color);
    meal.append(h("i", "sm-dot"), (() => {
      const d = h("div");
      d.append(h("b", null, m ? m.name : "No meal chosen yet"));
      if (m && s.dish_name) {
        const dish = h("p", "sm-d-dish", "Selected dish · " + s.dish_name);
        d.append(dish);
      }
      d.append(h("p", null, m ? m.about : "Check with the passenger before service. The meal list closes at the kitchen cutoff."));
      return d;
    })());

    const meta = h("div", "sm-d-meta");
    if (s.source) meta.append(h("span", "sm-pill sm-pill-" + s.source.toLowerCase().replace(" ", ""), s.source));
    if (s.at) meta.append(h("span", "sm-when", "Updated " + s.at));

    drawerBody.append(top, who, meal, meta);

    if (s.note) {
      const note = h("div", "sm-d-passenger-note");
      note.append(h("small", null, "PASSENGER NOTE · ALERT"), h("p", null, s.note));
      drawerBody.append(note);
    }

    if (s.care) {
      const box = h("div", "sm-d-care sm-care-" + s.care.level);
      box.append(h("small", null, s.care.level === "critical" ? "ALERT · " + s.care.title.toUpperCase() : "HANDLING · " + s.care.title.toUpperCase()), h("p", null, s.care.tip));
      drawerBody.append(box);
    }

    appendServicePanel(s);

    const kin = state.data.seats.filter((o) => !o.empty && o.pnr === s.pnr && o.seat !== s.seat);
    if (kin.length) {
      const wrap = h("div", "sm-d-kin");
      wrap.append(h("small", null, "TRAVELLING WITH"));
      kin.forEach((o) => {
        const b = h("button", "sm-kin");
        b.type = "button";
        if (o.meal && meals[o.meal]) b.style.setProperty("--meal", meals[o.meal].color);
        b.append(h("i", "sm-dot"), h("span", null, o.first + " · " + o.seat), h("em", null, mealName(o.meal)));
        b.addEventListener("click", () => openSeat(o.seat, true));
        wrap.append(b);
      });
      drawerBody.append(wrap);
    }
  }

  function openSeat(seat, fromKin) {
    const s = bySeat[seat];
    if (!s || s.empty) return;
    state.selected = seat;
    if (state.cabin !== "all" && !seatEls[seat]) {
      state.cabin = cabinOf(s.row).key;
      buildTabs();
      buildStage();
    }
    fillDrawer();
    markSelected();
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    scrim.hidden = false;
    if (!fromKin) drawer.focus({ preventScroll: true });
  }

  function closeDrawer() {
    const had = state.selected;
    state.selected = null;
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    scrim.hidden = true;
    markSelected();
    if (had && seatEls[had]) seatEls[had].focus({ preventScroll: true });
  }

  scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.selected) closeDrawer(); });

  // ------------------------------------------------------------------ search and keyboard
  searchEl.addEventListener("input", () => { state.query = searchEl.value; if (state.data) applyDim(); });
  searchEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !state.data) return;
    e.preventDefault();
    const hit = state.data.seats.find(matches);
    if (hit) openSeat(hit.seat);
  });

  stage.addEventListener("keydown", (e) => {
    const el = document.activeElement;
    if (!el || !el.classList.contains("sm-seat")) return;
    const m = /^(\d+)([A-F])$/.exec(el.dataset.seat);
    if (!m) return;
    let row = Number(m[1]), col = LETTERS.indexOf(m[2]);
    if (e.key === "ArrowRight") col++; else if (e.key === "ArrowLeft") col--;
    else if (e.key === "ArrowDown") row++; else if (e.key === "ArrowUp") row--; else return;
    const next = seatEls[row + LETTERS[col]];
    if (next && !next.disabled) { e.preventDefault(); next.focus(); }
  });

  // ------------------------------------------------------------------ data
  function index(data) {
    meals = {};
    data.meals.forEach((m) => { meals[m.code] = m; });
    bySeat = {};
    data.seats.forEach((s) => { bySeat[s.seat] = s; });
  }

  function say(text) {
    tickerEl.textContent = text;
    tickerEl.classList.remove("is-on");
    void tickerEl.offsetWidth;
    tickerEl.classList.add("is-on");
    window.clearTimeout(tickerTimer);
    tickerTimer = window.setTimeout(() => tickerEl.classList.remove("is-on"), 9000);
  }

  function applyUpdate(next) {
    const before = bySeat;
    state.data = next;
    index(next);
    const changed = [];
    next.seats.forEach((s) => {
      const old = before[s.seat];
      if (!old || old.empty !== s.empty || old.meal !== s.meal || old.dish_name !== s.dish_name || old.note !== s.note || old.source !== s.source || old.at !== s.at || old.service_status !== s.service_status || JSON.stringify(old.exchange_purchase) !== JSON.stringify(s.exchange_purchase)) changed.push(s);
    });
    changed.forEach((s) => {
      const el = seatEls[s.seat];
      if (el) {
        look(el, s);
        el.classList.remove("is-flip"); void el.offsetWidth; el.classList.add("is-flip");
      }
    });
    const real = changed.filter((s) => !s.empty && before[s.seat] && (before[s.seat].meal !== s.meal || before[s.seat].dish_name !== s.dish_name));
    if (real.length) {
      const s = real[real.length - 1];
      const dish = s.dish_name ? " → " + s.dish_name : "";
      say("Seat " + s.seat + " · " + s.name + (s.meal ? " chose " + mealName(s.meal) + dish : " has no meal") + (s.source ? " (" + s.source + ")" : "") + (s.note ? " · Note: " + s.note : ""));
    } else {
      const noted = changed.filter((s) => !s.empty && s.note && before[s.seat] && before[s.seat].note !== s.note);
      if (noted.length) {
        const s = noted[noted.length - 1];
        say("Passenger note · " + s.name + " · " + s.note);
      }
    }
    if (changed.length) {
      refreshCabinStats(); refreshTabBadges(); buildLegend(); applyDim();
      if (state.selected) { fillDrawer(); markSelected(); }
    }
  }

  function setLive(ok) {
    liveEl.classList.toggle("is-offline", !ok);
    liveText.textContent = ok ? "LIVE" : "RECONNECTING";
  }

  async function load(first) {
    try {
      const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setLive(true);
      renderFlightOps(data);
      if (first || !state.data) {
        state.data = data;
        index(data);
        buildTabs(); buildLegend(); buildStage();
      } else {
        applyUpdate(data);
        if (state.selected) fillDrawer();
      }
    } catch (err) {
      setLive(false);
      if (!state.data) stage.replaceChildren(h("p", "sm-loading", "The seat map could not load. It will try again."));
    }
  }

  load(true);
  window.setInterval(() => { if (!document.hidden) load(false); }, 3000);
})();
