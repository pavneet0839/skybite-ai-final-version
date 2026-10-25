// The passenger's phone. It asks the server for new messages every 2 seconds, so a message sent
// from the crew dashboard shows up here by itself.
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const chat = $("chat"), emptyEl = $("empty"), statusEl = $("wa-sub");
  const composer = $("composer"), input = $("text"), sendBtn = $("send");
  const backdrop = $("sheet-backdrop"), sheetTitle = $("sheet-title"), sheetRows = $("sheet-rows");
  const sheetSend = $("sheet-send"), sheetClose = $("sheet-close");
  const briefing = $("phone-briefing"), briefingToggle = $("briefing-toggle");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DEFAULT_STATUS = "online";

  const TICKS = '<svg viewBox="0 0 17 11" width="17" height="11" aria-hidden="true"><path d="M1 6l3 3 6.5-7.5M6.5 8.6 7.6 9.7 15.5 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_REPLY = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M10 8V4l-8 8 8 8v-4c5 0 8.5 1.5 11 5-1-6-4.5-11-11-11Z" fill="currentColor"/></svg>';
  const ICON_LIST = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 6h2M9 6h11M4 12h2M9 12h11M4 18h2M9 18h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  let lastId = 0, lastDay = "", serverToday = "", busy = false, selected = null, opener = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  // WhatsApp writes bold as *text*. Build real nodes, never raw HTML, so message text stays safe.
  function formatBody(text) {
    const frag = document.createDocumentFragment();
    text.split(/(\*[^*\n]+\*)/).forEach((part) => {
      if (part.length > 2 && part[0] === "*" && part[part.length - 1] === "*") {
        const b = document.createElement("b");
        b.textContent = part.slice(1, -1);
        frag.append(b);
      } else if (part) {
        frag.append(part);
      }
    });
    return frag;
  }

  // Both dates are plain "YYYY-MM-DD" strings from the server, so time zones cannot shift them.
  const dayNumber = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };

  function dayLabel(iso) {
    const diff = serverToday ? dayNumber(serverToday) - dayNumber(iso) : 0;
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return new Date(dayNumber(iso) * 86400000).toLocaleDateString(
      undefined, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  }

  function toBottom(instant) {
    chat.scrollTo({ top: chat.scrollHeight, behavior: instant || reduced ? "auto" : "smooth" });
  }

  function setStatus(text) { statusEl.textContent = text; }

  function setComposer(enabled) {
    input.disabled = !enabled;
    sendBtn.disabled = !enabled;
    input.placeholder = enabled ? "Type a message" : "Waiting for the airline's message";
  }

  // ---------------------------------------------------------------- drawing messages
  function actionButton(label, icon, onClick) {
    const btn = el("button", "act");
    btn.type = "button";
    btn.insertAdjacentHTML("beforeend", icon);
    btn.append(label);
    btn.addEventListener("click", onClick);
    return btn;
  }

  function render(m) {
    if (emptyEl.isConnected) emptyEl.remove();
    setComposer(true);

    if (m.day !== lastDay) {
      const chip = el("div", "day-chip");
      chip.textContent = dayLabel(m.day);
      chat.append(chip);
      lastDay = m.day;
    }

    const mine = m.direction === "in";      // the passenger's own message
    const wrap = el("div", "msg " + (mine ? "msg-out" : "msg-in"));
    const bubble = el("div", "bubble");
    bubble.append(formatBody(m.body));
    const meta = el("span", "meta");
    meta.append(m.time);
    if (mine) meta.insertAdjacentHTML("beforeend", TICKS);
    bubble.append(meta);
    wrap.append(bubble);

    if (m.actions) {
      const box = el("div", "actions");
      (m.actions.buttons || []).forEach((b) => {
        box.append(actionButton(b.label, ICON_REPLY, (event) => act(b.payload, event.currentTarget)));
      });
      if (m.actions.list) {
        const list = m.actions.list;
        box.append(actionButton(list.label, ICON_LIST, (event) => openSheet(list, event.currentTarget)));
      }
      wrap.append(box);
    }
    chat.append(wrap);
  }

  async function typing(ms) {
    const wrap = el("div", "msg msg-in");
    const bubble = el("div", "bubble typing");
    bubble.setAttribute("aria-label", "SkyBite Meals is typing");
    bubble.append(el("span"), el("span"), el("span"));
    wrap.append(bubble);
    chat.append(wrap);
    toBottom();
    await sleep(ms);
    wrap.remove();
  }

  function resetChat() {
    chat.replaceChildren(emptyEl);
    lastId = 0;
    lastDay = "";
    setComposer(false);
    closeSheet();
  }

  // ---------------------------------------------------------------- talking to the server
  async function load(animate, instant) {
    while (busy) await sleep(40);
    busy = true;
    try {
      const res = await fetch("/whatsapp/messages?after=" + lastId, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      serverToday = data.today;
      if (data.max_id < lastId) resetChat();     // the demo was reset on the crew side
      for (const m of data.messages) {
        if (animate && m.direction === "out") {
          await typing(reduced ? 0 : Math.min(650 + m.body.length * 5, 1500));
        }
        render(m);
        lastId = Math.max(lastId, m.id);
      }
      if (data.messages.length) toBottom(instant);
      if (statusEl.textContent !== DEFAULT_STATUS) setStatus(DEFAULT_STATUS);
    } catch (err) {
      setStatus("Waiting for connection…");
    } finally {
      busy = false;
    }
  }

  async function post(url, fields) {
    const res = await fetch(url, { method: "POST", body: new URLSearchParams(fields) });
    if (!res.ok) throw new Error(String(res.status));
  }

  async function submit(url, fields) {
    try {
      await post(url, fields);
      await load(true);
    } catch (err) {
      setStatus("Could not send. Check the connection.");
      setTimeout(() => setStatus(DEFAULT_STATUS), 3000);
    }
  }

  const act = (payload) => submit("/whatsapp/act", { payload });

  // Slide the explainer away for a clean phone-only demo, with a persistent edge tab to restore it.
  if (briefing && briefingToggle) {
    briefingToggle.addEventListener("click", () => {
      const expanded = briefingToggle.getAttribute("aria-expanded") === "true";
      briefingToggle.setAttribute("aria-expanded", String(!expanded));
      briefing.classList.toggle("is-hidden", expanded);
      briefingToggle.querySelector("span").textContent = expanded ? "Show briefing" : "Hide briefing";
      briefingToggle.setAttribute("aria-label", expanded ? "Show demo briefing" : "Hide demo briefing");
    });
  }

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || input.disabled) return;
    input.value = "";
    submit("/whatsapp/text", { text });
  });

  // ---------------------------------------------------------------- meal list sheet
  function openSheet(list, trigger) {
    opener = trigger;
    sheetTitle.textContent = list.title;
    sheetRows.replaceChildren();
    selected = null;
    sheetSend.disabled = true;

    list.rows.forEach((row) => {
      const label = el("label", "row");
      label.style.setProperty("--meal", row.color);
      const radio = el("input");
      radio.type = "radio";
      radio.name = "meal";
      radio.value = row.payload;
      radio.addEventListener("change", () => { selected = row.payload; sheetSend.disabled = false; });

      const text = el("span", "row-text");
      const name = el("span", "row-name");
      name.textContent = row.title;
      if (row.festival) {
        const tag = el("span", "row-tag");
        tag.textContent = "Festival special";
        name.append(tag);
      }
      const desc = el("span", "row-desc");
      desc.textContent = row.desc;
      text.append(name, desc);

      label.append(radio, text, el("span", "row-mark"));
      sheetRows.append(label);
    });

    backdrop.classList.add("is-open");
    sheetClose.focus();
  }

  function closeSheet() {
    backdrop.classList.remove("is-open");
    if (opener && opener.isConnected) opener.focus();
    opener = null;
  }

  sheetClose.addEventListener("click", closeSheet);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) closeSheet(); });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && backdrop.classList.contains("is-open")) closeSheet();
  });
  sheetSend.addEventListener("click", () => {
    if (!selected) return;
    const payload = selected;
    opener = null;                       // do not move focus back to a button that is about to scroll away
    backdrop.classList.remove("is-open");
    act(payload);
  });

  // ---------------------------------------------------------------- start
  load(false, true);
  setInterval(() => load(false), 2000);
})();
