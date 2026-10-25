// Live updates for the crew dashboard. Every name here starts with "lv" so it cannot clash with other features.
// Every 2 seconds the page asks the server what changed, then animates only that: numbers roll, bars grow,
// meal rows glow and re-sort, and a "Latest changes" panel with a small pop-up announces each new choice.
(() => {
  "use strict";

  const root = document.getElementById("lv-root");
  if (!root) return;

  const url = root.dataset.url;
  const csrfToken = root.dataset.csrf || "";
  const decisionBaseUrl = root.dataset.decisionUrl || "";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EASE = "cubic-bezier(.2,.78,.22,1)";
  const $ = (sel, from) => (from || document).querySelector(sel);
  const $$ = (sel, from) => Array.from((from || document).querySelectorAll(sel));

  const cards = $$(".metric-grid .metric-card");
  const summaryNums = $$(".summary-list dd .count-up");
  const tbody = $(".meal-table tbody");
  const panelCount = $(".panel-count b");
  const rightCol = $(".ops-right-column");
  if (cards.length < 4 || !tbody) return;

  document.body.classList.add("lv-on");

  function h(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ------------------------------------------------------------------ small animation helpers
  const rafs = new WeakMap();
  function tween(node, to) {
    const from = Number(node.textContent) || 0;
    if (rafs.has(node)) cancelAnimationFrame(rafs.get(node));
    if (reduced || from === to) { node.textContent = String(to); return; }
    const t0 = performance.now(), dur = 900;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      node.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) rafs.set(node, requestAnimationFrame(tick));
    };
    rafs.set(node, requestAnimationFrame(tick));
  }

  // The page's own first count-up may not have run yet (card below the fold); retarget it instead.
  function setCount(node, value) {
    if (!node) return;
    node.dataset.count = String(value);
    if (node.dataset.counted === "true") tween(node, value);
  }

  function setBar(bar, pct) {
    if (!bar) return;
    const before = bar.offsetWidth;
    bar.style.setProperty("--w", pct.toFixed(1) + "%");
    if (reduced) return;
    const after = bar.offsetWidth;
    if (before !== after) bar.animate([{ width: before + "px" }, { width: after + "px" }], { duration: 900, easing: EASE });
  }

  function restart(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), ms);
  }

  function delta(card, d) {
    if (reduced || !d) return;
    const chip = h("span", "lv-delta " + (d > 0 ? "lv-up" : "lv-down"), (d > 0 ? "+" : "−") + Math.abs(d));
    card.append(chip);
    chip.addEventListener("animationend", () => chip.remove());
  }

  // ------------------------------------------------------------------ numbers and bars
  let prev = null;
  let latestLiveData = null;
  const expandedDishTypes = new Set();

  function updateNumbers(d) {
    const total = Math.max(1, d.total);
    const map = [
      { key: "total", card: cards[0], bar: null },
      { key: "chosen", card: cards[1], bar: d.chosen / total * 100 },
      { key: "not_chosen", card: cards[2], bar: d.not_chosen / total * 100 },
      { key: "whatsapp", card: cards[3], bar: d.whatsapp / total * 100 },
    ];
    map.forEach((m) => {
      const diff = d[m.key] - prev[m.key];
      setCount($(".metric-number", m.card), d[m.key]);
      if (m.bar !== null) setBar($(".metric-mini-bar i", m.card), m.bar);
      if (diff !== 0) { restart(m.card, "lv-flash", 1400); delta(m.card, diff); }
    });
    const pct = $(".metric-bottom > span:last-child", cards[1]);
    if (pct) pct.textContent = Math.round(d.chosen / total * 100) + "%";

    [["total", 0], ["not_chosen", 1], ["whatsapp", 2], ["website", 3]].forEach(([key, i]) => {
      const node = summaryNums[i];
      if (!node) return;
      setCount(node, d[key]);
      if (d[key] !== prev[key]) restart(node.closest("dd") || node, "lv-pulse", 1300);
    });
  }

  // ------------------------------------------------------------------ meal table
  function buildRow(r) {
    const tr = h("tr");
    tr.dataset.lvCode = r.code;
    const th = h("th");
    th.scope = "row";
    const dot = h("span", "meal-dot");
    dot.style.setProperty("--meal", r.color);
    const trigger = h("button", "meal-type-trigger");
    trigger.type = "button";
    trigger.dataset.toggleDishes = r.code;
    trigger.setAttribute("aria-expanded", expandedDishTypes.has(r.code) ? "true" : "false");
    trigger.setAttribute("aria-label", "Show " + r.name + " dish breakdown");
    trigger.append(h("span", null, r.name), h("span", "meal-type-chevron", "＋"));
    trigger.lastElementChild.setAttribute("aria-hidden", "true");
    th.append(dot, trigger);
    const num = h("td", "num");
    num.append(h("strong", null, String(r.n)));
    const cell = h("td", "bar-cell");
    const track = h("span", "bar-track");
    const bar = h("span", "bar");
    bar.style.setProperty("--meal", r.color);
    bar.style.setProperty("--w", "0%");
    track.append(bar);
    cell.append(track);
    tr.append(th, num, cell);
    return tr;
  }

  function tagRows(d) {
    const byName = new Map(d.rows.map((r) => [r.name, r.code]));
    $$("tr", tbody).forEach((tr) => {
      if (tr.classList.contains("row-open")) { tr.dataset.lvCode = "__open"; return; }
      const name = (tr.querySelector("th") || {}).textContent;
      const code = byName.get((name || "").trim());
      if (code) tr.dataset.lvCode = code;
    });
  }

  function updateTable(d) {
    const biggest = Math.max(1, d.not_chosen, ...d.rows.map((r) => r.n));
    const open = $(".row-open", tbody);
    const existing = new Map(
      $$("tr[data-lv-code]", tbody)
        .filter((tr) => !tr.classList.contains("row-open"))
        .map((tr) => [tr.dataset.lvCode, tr])
    );
    const fresh = [], glow = [];

    // Keep the current DOM order stable between polls. The API returns rows sorted by count,
    // which can flip back and forth as counts change; reordering every 2 seconds made expanded
    // dish details jump and replay their entrance animation. Existing rows now stay put while
    // their counts and bars update in place. New categories are appended once, above the
    // unchosen row, and removed categories take their detail row with them.
    d.rows.forEach((r) => {
      let tr = existing.get(r.code);
      if (tr) {
        existing.delete(r.code);
        const num = $("td.num strong", tr);
        if (num && num.textContent !== String(r.n)) {
          tween(num, r.n);
          glow.push(tr);
        }
      } else {
        tr = buildRow(r);
        fresh.push(tr);
        tbody.insertBefore(tr, open || null);
      }
      tr.dataset.lvCode = r.code;
      const bar = $(".bar", tr);
      setBar(bar, r.n / biggest * 100);
    });

    // Remove zero-count categories and any expanded detail attached to them.
    existing.forEach((tr, code) => {
      expandedDishTypes.delete(code);
      const detail = $$("tr.meal-dish-detail-row", tbody).find((row) => row.dataset.lvDetailFor === code);
      if (detail) detail.remove();
      tr.remove();
    });

    if (open) {
      const num = $("td.num strong", open);
      if (num && num.textContent !== String(d.not_chosen)) {
        tween(num, d.not_chosen);
        glow.push(open);
      }
      setBar($(".bar", open), d.not_chosen / biggest * 100);
    }

    // Only animate actual new rows or changed values. Do not transform detail rows during a
    // live poll: table-row transforms can render inconsistently across browsers.
    if (!reduced) {
      fresh.forEach((tr) => {
        tr.animate(
          [{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }],
          { duration: 420, easing: EASE }
        );
        glow.push(tr);
      });
    }
    glow.forEach((tr) => restart(tr, "lv-row", 1700));

    if (panelCount) tween(panelCount, d.rows.length + (d.not_chosen ? 1 : 0));
  }

  // ------------------------------------------------------------------ clickable category → selected dish breakdown
  function renderDishDetails(d) {
    if (!d || !tbody) return;
    $$('[data-toggle-dishes]', tbody).forEach((button) => {
      const expanded = expandedDishTypes.has(button.dataset.toggleDishes);
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      const chevron = $(".meal-type-chevron", button);
      if (chevron) chevron.textContent = expanded ? "−" : "＋";
    });
    // Remove only collapsed details. Keep an unchanged open row in place so the 2-second
    // live poll doesn't replay the entrance animation or make the table flicker.
    $$('tr.meal-dish-detail-row', tbody).forEach((row) => {
      if (!expandedDishTypes.has(row.dataset.lvDetailFor)) row.remove();
    });
    expandedDishTypes.forEach((code) => {
      const categoryRow = $$('tr[data-lv-code]', tbody).find((tr) => tr.dataset.lvCode === code);
      if (!categoryRow) return;
      const dishes = (d.dishes_by_meal && d.dishes_by_meal[code]) || [];
      const signature = JSON.stringify(dishes);
      let detailRow = $$('tr.meal-dish-detail-row', tbody).find((tr) => tr.dataset.lvDetailFor === code);
      if (detailRow && detailRow.dataset.signature === signature) return;
      if (detailRow) detailRow.remove();
      detailRow = h("tr", "meal-dish-detail-row");
      detailRow.dataset.lvDetailFor = code;
      detailRow.dataset.signature = signature;
      const cell = h("td");
      cell.colSpan = 3;
      const inner = h("div", "meal-dish-detail-inner");
      const total = dishes.reduce((sum, dish) => sum + (Number(dish.n) || 0), 0);
      const head = h("div", "meal-dish-detail-head");
      head.append(h("span", null, "Specific dishes"), h("span", "meal-dish-detail-total", total + " passenger" + (total === 1 ? "" : "s")));
      inner.append(head);
      if (!dishes.length) {
        inner.append(h("p", "meal-dish-empty", "No specific dish selections have been recorded for this category yet."));
      } else {
        const list = h("div", "meal-dish-list");
        const max = Math.max(1, ...dishes.map((dish) => Number(dish.n) || 0));
        dishes.forEach((dish, index) => {
          const line = h("div", "meal-dish-item");
          const name = h("span", "meal-dish-name", dish.name);
          const count = h("strong", "meal-dish-count", String(dish.n));
          const track = h("span", "meal-dish-track");
          const bar = h("span", "meal-dish-bar");
          bar.style.setProperty("--dish-w", ((Number(dish.n) || 0) / max * 100).toFixed(1) + "%");
          track.append(bar);
          line.append(name, count, track);
          list.append(line);
          if (!reduced) line.animate([
            { opacity: 0, transform: "translateY(4px)" },
            { opacity: 1, transform: "translateY(0)" },
          ], { duration: 260, delay: Math.min(index * 35, 210), easing: EASE, fill: "both" });
        });
        inner.append(list);
      }
      cell.append(inner);
      detailRow.append(cell);
      categoryRow.after(detailRow);
    });
  }

  tbody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-toggle-dishes]");
    if (!button || !tbody.contains(button)) return;
    const code = button.dataset.toggleDishes;
    if (expandedDishTypes.has(code)) expandedDishTypes.delete(code);
    else expandedDishTypes.add(code);
    if (latestLiveData) renderDishDetails(latestLiveData);
  });

  // ------------------------------------------------------------------ latest changes panel
  const panel = h("aside", "ops-panel lv-panel");
  panel.setAttribute("aria-labelledby", "lv-title");
  panel.innerHTML =
    '<div class="panel-heading compact-heading"><div><span class="micro-label">LIVE ACTIVITY</span><h2 id="lv-title">Live activity</h2></div>' +
    '<span class="lv-live" id="lv-live"><i></i><span id="lv-live-text">LIVE</span></span></div>' +
    '<section class="lv-request-zone" aria-labelledby="lv-request-title">' +
      '<div class="lv-subhead"><div><span class="lv-section-kicker">CREW REVIEW</span><h3 id="lv-request-title">Late meal requests</h3></div>' +
      '<span class="lv-request-count" id="lv-request-count">0 open</span></div>' +
      '<p class="lv-request-empty" id="lv-request-empty">No late changes waiting. New passenger requests will appear here automatically.</p>' +
      '<ol class="lv-request-feed" id="lv-request-feed" aria-live="polite"></ol>' +
    '</section>' +
    '<div class="lv-changes-subhead"><span class="lv-section-kicker">PASSENGER ACTIVITY</span><h3>Latest changes</h3></div>' +
    '<p class="lv-empty" id="lv-empty">Meal choices from WhatsApp and the website appear here as they happen.</p>' +
    '<ol class="lv-feed" id="lv-feed" aria-live="polite"></ol>';
  const summary = $(".summary-panel");
  if (rightCol && summary) summary.after(panel); else if (rightCol) rightCol.prepend(panel);
  const feedEl = $("#lv-feed", panel), emptyEl = $("#lv-empty", panel);
  const requestFeed = $("#lv-request-feed", panel);
  const requestEmpty = $("#lv-request-empty", panel);
  const requestCount = $("#lv-request-count", panel);
  let requestSignature = null;
  let seenRequestIds = null;
  let feedMax = null;

  function itemFor(e) {
    const li = h("li", "lv-item");
    li.dataset.id = e.id;
    li.style.setProperty("--meal", e.color);
    const dot = h("i", "lv-dot");
    const body = h("div", "lv-body");
    const top = h("div", "lv-top");
    top.append(h("b", null, e.name), h("span", "lv-seat", "Seat " + e.seat));
    body.append(top, h("p", "lv-line", e.line));
    if (e.note) {
      const noteBox = h("div", "lv-passenger-note-alert");
      noteBox.append(h("span", "lv-note-eyebrow", "PASSENGER NOTE · ALERT"), h("p", null, e.note));
      body.append(noteBox);
    }
    body.append(h("time", null, e.at));
    const badge = h("span", "lv-badge lv-badge-" + e.source.toLowerCase().replace(/\s/g, ""), e.source);
    li.append(dot, body, badge);
    return li;
  }

  function slideIn(li, delay) {
    if (reduced) return;
    const hgt = li.offsetHeight;
    li.animate([
      { height: "0px", opacity: 0, transform: "translateY(-16px) scale(.97)" },
      { height: hgt + "px", opacity: 1, transform: "none" },
    ], { duration: 650, delay: delay || 0, easing: EASE, fill: "backwards" });
  }

  function renderFeed(d) {
    emptyEl.hidden = d.feed.length > 0;
    if (feedMax === null || d.max_event < feedMax) {
      feedEl.replaceChildren();
      d.feed.forEach((e, i) => { const li = itemFor(e); feedEl.append(li); slideIn(li, i * 90); });
    } else if (d.max_event > feedMax) {
      d.feed.filter((e) => e.id > feedMax).reverse().forEach((e) => {
        const li = itemFor(e);
        li.classList.add("lv-fresh");
        feedEl.prepend(li);
        slideIn(li, 0);
        window.setTimeout(() => li.classList.remove("lv-fresh"), 5200);
        toast(e);
      });
      while (feedEl.children.length > 6) feedEl.lastElementChild.remove();
    }
    feedMax = d.max_event;
  }

  // ------------------------------------------------------------------ late meal change queue
  function renderRequests(items) {
    items = Array.isArray(items) ? items : [];
    const idsNow = new Set(items.map((r) => r.id));
    if (seenRequestIds !== null) {
      items.filter((r) => r.status === "pending" && !seenRequestIds.has(r.id)).forEach((r) => {
        const requested = r.requested_dish_name || r.requested_name || "a meal";
        toast({
          color: r.requested_color || "#d4b982", name: r.name, seat: r.seat,
          line: "requested a late change to " + requested, source: "Late meal request",
          note: r.passenger_note || ""
        });
      });
    }
    seenRequestIds = idsNow;
    const signature = JSON.stringify(items);
    if (signature === requestSignature) return;
    requestSignature = signature;
    requestFeed.replaceChildren();
    requestEmpty.hidden = items.length > 0;
    const pendingCount = items.filter((r) => r.status === "pending").length;
    requestCount.textContent = items.length + " open" + (pendingCount ? " · " + pendingCount + " to review" : "");
    items.forEach((r, index) => {
      const li = h("li", "lv-request-card" + (r.status === "pending" ? " is-pending" : " is-awaiting"));
      li.dataset.requestId = r.id;
      const top = h("div", "lv-request-top");
      const who = h("div", "lv-request-who");
      who.append(h("strong", null, r.name), h("span", "lv-seat", "Seat " + r.seat));
      const status = h("span", "lv-request-status " + (r.status === "pending" ? "is-pending" : "is-awaiting"),
        r.status === "pending" ? "Needs review" : "Awaiting passenger");
      top.append(who, status);
      const route = h("div", "lv-request-meals");
      const currentDisplay = (r.current_name || "No meal selected") + (r.current_dish_name ? " → " + r.current_dish_name : "");
      const requestedDisplay = (r.requested_name || "Meal") + (r.requested_dish_name ? " → " + r.requested_dish_name : "");
      const old = h("span", "lv-request-meal-old", currentDisplay);
      const arrow = h("span", "lv-request-arrow", "→");
      const next = h("span", "lv-request-meal-new", requestedDisplay);
      next.style.setProperty("--meal", r.requested_color || "#d4b982");
      route.append(old, arrow, next);
      const meta = h("div", "lv-request-stockline");
      let passengerNoteBox = null;
      if (r.passenger_note) {
        passengerNoteBox = h("div", "lv-passenger-note-alert lv-request-note-alert");
        passengerNoteBox.append(h("span", "lv-note-eyebrow", "PASSENGER NOTE · ALERT"), h("p", null, r.passenger_note));
      }
      if (r.status === "pending") {
        if (r.same_category) {
          meta.textContent = "Dish substitution within the existing meal category · no extra category unit · requested " + r.requested_at;
          meta.classList.remove("is-short");
        } else {
          meta.textContent = r.requested_spare > 0
            ? r.requested_spare + " unassigned planned " + (r.requested_spare === 1 ? "meal" : "meals") + " · requested " + r.requested_at
            : "No unassigned planned stock for this category · " + r.requested_at;
          meta.classList.toggle("is-short", r.requested_spare < 1);
        }
      } else {
        meta.textContent = "Alternative offered: " + (r.alternative_name || "meal") + " · " + r.requested_at;
      }
      if (passengerNoteBox) li.append(top, route, passengerNoteBox, meta);
      else li.append(top, route, meta);
      if (r.status === "pending") {
        const reason = h("input", "lv-request-reason");
        reason.type = "text";
        reason.maxLength = 250;
        reason.autocomplete = "off";
        reason.placeholder = "Reason if declining (required)";
        reason.setAttribute("aria-label", "Reason if declining " + r.name + "'s late meal request");
        const actions = h("div", "lv-request-actions");
        const approve = h("button", "lv-request-btn lv-request-approve", "Approve");
        approve.type = "button";
        approve.dataset.decision = "approve";
        approve.disabled = !r.same_category && r.requested_spare < 1;
        const decline = h("button", "lv-request-btn lv-request-decline", "Decline");
        decline.type = "button";
        decline.dataset.decision = "decline";
        const alternative = h("button", "lv-request-btn lv-request-alternative", "Offer alternative");
        alternative.type = "button";
        alternative.dataset.decision = "alternative";
        alternative.disabled = !r.alternatives || r.alternatives.length === 0;
        const select = h("select", "lv-request-alt-select");
        select.setAttribute("aria-label", "Alternative meal for " + r.name);
        const placeholder = h("option", null, r.alternatives && r.alternatives.length ? "Choose stocked alternative…" : "No alternative stock available");
        placeholder.value = "";
        placeholder.selected = true;
        select.append(placeholder);
        const alternativeGroups = new Map();
        (r.alternatives || []).forEach((a) => {
          let group = alternativeGroups.get(a.meal_code);
          if (!group) {
            const groupLabel = a.same_category
              ? a.meal_name + " · same category, no extra category unit"
              : a.meal_name + " · " + a.spare + " unassigned " + (a.spare === 1 ? "meal" : "meals");
            group = h("optgroup");
            group.label = groupLabel;
            alternativeGroups.set(a.meal_code, group);
            select.append(group);
          }
          const op = h("option", null, a.name);
          op.value = a.code;
          group.append(op);
        });
        const message = h("p", "lv-request-feedback");
        message.hidden = true;
        message.setAttribute("role", "status");
        actions.append(approve, decline);
        li.append(select, reason, actions, alternative, message);
        li.addEventListener("click", (event) => {
          const button = event.target.closest("button[data-decision]");
          if (!button || button.disabled || button.dataset.busy === "true") return;
          const action = button.dataset.decision;
          const note = reason.value.trim();
          if (action === "decline" && !note) {
            message.textContent = "Add a short reason before declining this request.";
            message.classList.add("is-error");
            message.hidden = false;
            reason.focus();
            return;
          }
          if (action === "alternative" && !select.value) {
            message.textContent = "Choose an available alternative first.";
            message.classList.add("is-error");
            message.hidden = false;
            select.focus();
            return;
          }
          submitLateDecision(r, action, note, select.value, li, message, button);
        });
      } else {
        const altDisplay = (r.alternative_dish_name || "Alternative dish") + (r.alternative_name ? " · " + r.alternative_name : "");
        const waiting = h("div", "lv-request-awaiting-copy", "Offered: " + altDisplay + ". The confirmed meal remains unchanged until the passenger responds.");
        li.append(waiting);
      }
      requestFeed.append(li);
      if (!reduced) li.animate([
        { opacity: 0, transform: "translateY(9px) scale(.99)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ], { duration: 420, delay: Math.min(index * 55, 220), easing: EASE, fill: "both" });
    });
  }

  async function submitLateDecision(request, action, reason, alternativeCode, card, feedback, button) {
    const buttons = $$('button[data-decision]', card);
    buttons.forEach((b) => { b.disabled = true; b.dataset.busy = "true"; });
    const oldLabel = button.textContent;
    button.textContent = action === "approve" ? "Approving…" : action === "decline" ? "Declining…" : "Sending…";
    feedback.hidden = true;
    feedback.classList.remove("is-error");
    try {
      const url = decisionBaseUrl.replace(/\/0$/, "/" + request.id);
      const body = new URLSearchParams({ csrf_token: csrfToken, action, reason, alternative_dish_code: alternativeCode || "" });
      const response = await fetch(url, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "Accept": "application/json" },
        body,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "The decision could not be saved.");
      feedback.textContent = data.message;
      feedback.classList.remove("is-error");
      feedback.hidden = false;
      card.classList.add("is-resolved");
      if (!reduced) card.animate([{ transform: "scale(1)" }, { transform: "scale(1.012)" }, { transform: "scale(1)" }], { duration: 420, easing: EASE });
      window.setTimeout(() => window.location.reload(), 950);
    } catch (error) {
      feedback.textContent = error.message || "Something went wrong. Please try again.";
      feedback.classList.add("is-error");
      feedback.hidden = false;
      buttons.forEach((b) => { b.disabled = false; b.dataset.busy = "false"; });
      button.textContent = oldLabel;
      // When stock changed in the meantime, the next normal poll refreshes the options.
      requestSignature = null;
    }
  }

  // ------------------------------------------------------------------ pop-up
  const toasts = h("div", "lv-toasts");
  toasts.setAttribute("aria-live", "polite");
  document.body.append(toasts);

  function toast(e) {
    const t = h("div", "lv-toast");
    t.style.setProperty("--meal", e.color);
    const body = h("div");
    body.append(h("b", null, e.name + " · Seat " + e.seat), h("span", null, e.line + " via " + e.source));
    if (e.note) body.append(h("span", "lv-toast-note", "Passenger note: " + e.note));
    t.append(h("i", "lv-dot"), body);
    toasts.append(t);
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
    window.setTimeout(() => {
      t.classList.add("is-out");
      window.setTimeout(() => t.remove(), 450);
    }, 5200);
  }

  // ------------------------------------------------------------------ polling
  function setLive(ok) {
    const pill = $("#lv-live", panel);
    pill.classList.toggle("is-offline", !ok);
    $("#lv-live-text", panel).textContent = ok ? "LIVE" : "RECONNECTING";
  }

  async function poll() {
    try {
      const res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setLive(true);
      if (prev === null) {
        tagRows(d);
        renderFeed(d);
      } else {
        updateNumbers(d);
        updateTable(d);
        renderFeed(d);
      }
      latestLiveData = d;
      renderDishDetails(d);
      renderRequests(d.late_requests || []);
      prev = d;
    } catch (err) {
      setLive(false);
    }
  }

  poll();
  window.setInterval(() => { if (!document.hidden) poll(); }, 2000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
})();
