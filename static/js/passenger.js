const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, v) => { v = clamp((v - a) / (b - a)); return v * v * (3 - 2 * v); };

/* ---------- reveals, tilt, nav highlight ---------- */
const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .12 });
$$("[data-reveal]").forEach((el) => {
  el.style.setProperty("--d", [...el.parentElement.children].filter((c) => c.hasAttribute("data-reveal")).indexOf(el) * .12 + "s");
  io.observe(el);
});
$$("[data-tilt]").forEach((el) => {
  el.addEventListener("pointermove", (e) => { const r = el.getBoundingClientRect(); el.style.setProperty("--ry", ((e.clientX - r.left) / r.width - .5) * 9 + "deg"); el.style.setProperty("--rx", -((e.clientY - r.top) / r.height - .5) * 9 + "deg"); });
  el.addEventListener("pointerleave", () => { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); });
});
const links = $$(".topbar nav a");
const secIO = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.hash === "#" + e.target.id)); }), { rootMargin: "-45% 0px -50% 0px" });
["journey", "meals", "travellers", "details"].forEach((id) => secIO.observe($("#" + id)));

/* ---------- meal picker ---------- */
const dlg = $("#picker");
$$("[data-open-picker]").forEach((b) => b.addEventListener("click", () => {
  const late = b.dataset.late === "true";
  $("#picker-pax").value = b.dataset.pax;
  $("#picker-title").textContent = (late ? "Request a late change for " : "Choose a meal for ") + b.dataset.name;
  const kicker = $("[data-picker-kicker]", dlg);
  const notice = $("[data-picker-notice]", dlg);
  const footnote = $("[data-picker-footnote]", dlg);
  const submitLabel = $("[data-picker-submit-label]", dlg);
  dlg.dataset.late = String(late);
  kicker.textContent = late ? "CREW APPROVAL REQUIRED" : "MADE TO SUIT YOU";
  notice.hidden = !late;
  footnote.textContent = late ? "Your current meal stays confirmed" : "Select one meal";
  submitLabel.textContent = late ? "Send late request" : "Save this meal";
  $$("input[name=meal_code]", dlg).forEach((r) => { r.checked = r.value === b.dataset.current; });
  const noteField = $("#passenger-note", dlg);
  const noteCount = $("#passenger-note-count", dlg);
  if (noteField) noteField.value = "";
  if (noteCount) noteCount.textContent = "0 / 160";
  document.body.style.overflow = "hidden"; dlg.showModal();
}));
$("[data-close]").addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener("close", () => { document.body.style.overflow = ""; });
const passengerNoteField = $("#passenger-note", dlg);
const passengerNoteCount = $("#passenger-note-count", dlg);
passengerNoteField?.addEventListener("input", () => {
  if (passengerNoteCount) passengerNoteCount.textContent = `${passengerNoteField.value.length} / 160`;
});

/* ---------- passenger-side late-change status sync ---------- */
const lateStatusRoot = $("#late-status-live");
let lateStatusPollBusy = false;
async function pollLateRequestStatus() {
  if (!lateStatusRoot || lateStatusPollBusy || document.hidden) return;
  lateStatusPollBusy = true;
  try {
    const res = await fetch(lateStatusRoot.dataset.url, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return;
    const data = await res.json();
    let changed = false;
    $$("[data-pax-id][data-late-status]").forEach((card) => {
      const serverStatus = (data.requests || {})[card.dataset.paxId] || "";
      if (serverStatus !== card.dataset.lateStatus) changed = true;
    });
    if (changed) {
      document.documentElement.classList.add("late-status-refreshing");
      window.setTimeout(() => window.location.reload(), reduce ? 0 : 420);
    }
  } catch (_) {
    // A transient polling failure should not interrupt meal selection.
  } finally {
    lateStatusPollBusy = false;
  }
}
if (lateStatusRoot) {
  pollLateRequestStatus();
  window.setInterval(pollLateRequestStatus, 3500);
  document.addEventListener("visibilitychange", pollLateRequestStatus);
}

/* ---------- sky: day -> golden hour -> dusk -> night, tinted by page progress ---------- */
const STOPS = [ // [progress, top, bottom, cloud tint]
  [0.00, [20, 62, 112], [118, 164, 204], [255, 255, 255]],
  [0.32, [34, 48, 98], [236, 160, 108], [255, 226, 190]],
  [0.68, [26, 30, 78], [128, 92, 140], [214, 190, 235]],
  [1.00, [7, 12, 34], [34, 46, 84], [170, 186, 225]],
];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function skyAt(p) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const A = STOPS[i], B = STOPS[i + 1];
    if (p <= B[0]) { const t = sm(0, 1, (p - A[0]) / (B[0] - A[0])); return [mix3(A[1], B[1], t), mix3(A[2], B[2], t), mix3(A[3], B[3], t)]; }
  }
  const L = STOPS[STOPS.length - 1]; return [L[1], L[2], L[3]];
}
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/* ---------- soft 2D clouds on a canvas (crisp at any size, cheap to draw) ---------- */
const cv = $("#clouds"), cx = cv.getContext("2d");
const sprite = document.createElement("canvas"); sprite.width = sprite.height = 256;
{ const g = sprite.getContext("2d"), r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  r.addColorStop(0, "rgba(255,255,255,.95)"); r.addColorStop(.45, "rgba(255,255,255,.5)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 256, 256); }
const tinted = document.createElement("canvas"); tinted.width = tinted.height = 256; const tg = tinted.getContext("2d");
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const LAYERS = [ // depth: parallax vs scroll, drift speed, alpha, puff size
  { k: .10, v: 6,  a: .30, s: 170, n: 7 },
  { k: .26, v: 11, a: .36, s: 260, n: 6 },
  { k: .62, v: 20, a: .42, s: 420, n: 4 },
].map((L) => ({ ...L, clouds: Array.from({ length: L.n }, () => ({
  x: rnd(), y: rnd(), puffs: Array.from({ length: 6 + (rnd() * 4 | 0) }, () => ({ dx: (rnd() - .5) * 1.7, dy: (rnd() - .5) * .45, r: .55 + rnd() * .75 })) })) }));
function drawClouds(T, page, mxv, myv, tint) {
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.clearRect(0, 0, cv.width, cv.height);
  const dpr = cv.width / W; cx.scale(dpr, dpr);
  tg.globalCompositeOperation = "source-over"; tg.clearRect(0, 0, 256, 256); tg.drawImage(sprite, 0, 0);
  tg.globalCompositeOperation = "source-in"; tg.fillStyle = rgb(tint); tg.fillRect(0, 0, 256, 256);
  LAYERS.forEach((L) => {
    const span = W + L.s * 3, tall = H + L.s * 2;
    cx.globalAlpha = L.a;
    L.clouds.forEach((c) => {
      const x = ((c.x * span + T * L.v - mxv * L.k * 60) % span + span) % span - L.s * 1.5;
      const y = ((c.y * tall - scrollY * L.k - myv * L.k * 40) % tall + tall) % tall - L.s;
      c.puffs.forEach((p) => { const d = L.s * p.r * 1.5; cx.drawImage(tinted, x + p.dx * L.s - d / 2, y + p.dy * L.s - d / 2, d, d); });
    });
  });
  cx.globalAlpha = 1;
}

/* ---------- layout: route + canvas sizing ---------- */
const hero = $("[data-hero]"), stage = $("[data-stage]"), heroCopy = $("[data-hero-copy]");
const routeBase = $("[data-route-base]"), routeTrail = $("[data-route-trail]"), routeDone = $("[data-route-done]");
const planeEl = $("[data-plane]"), status = $("[data-status]"), skyimg = $("[data-skyimg]"), skybase = $("[data-skybase]");
const fbDone = $("[data-fbdone]"), fbPlane = $("[data-fbplane]");
const sc = $("[data-scroller]"), track = $("[data-track]"), cards = $$("[data-mcard]");
let W = innerWidth, H = innerHeight, routeLen = 1, menuDist = 0, lefts = [];
function layout() {
  W = innerWidth; H = innerHeight;
  const P = (fx, fy) => `${(fx * W).toFixed(1)} ${(fy * H).toFixed(1)}`;
  const d = `M${P(.1, .8)} C${P(.28, .6)} ${P(.4, .86)} ${P(.56, .7)} S${P(.74, .6)} ${P(.9, .55)}`;
  [routeBase, routeTrail, routeDone].forEach((p) => p.setAttribute("d", d));
  routeLen = routeBase.getTotalLength(); routeDone.style.strokeDasharray = routeLen;
  const dpr = Math.min(devicePixelRatio || 1, 1.5); cv.width = W * dpr; cv.height = H * dpr;
}
addEventListener("resize", layout); layout();

/* ---------- menu cards: vertical scroll glides them sideways (the page is never pinned) ---------- */
let curTx = 0;
function measure() { track.style.transform = "none"; menuDist = Math.max(0, track.scrollWidth - sc.clientWidth); lefts = cards.map((c) => c.offsetLeft + c.offsetWidth / 2); }
function placeCards(snap) {
  const r = sc.getBoundingClientRect(), p = clamp((.9 * H - r.top) / (.9 * H + r.height * .25));
  curTx = snap || reduce ? -p * menuDist : lerp(curTx, -p * menuDist, .14);
  track.style.transform = `translate3d(${curTx.toFixed(1)}px,0,0)`;
  cards.forEach((c, i) => {
    const d = (lefts[i] + curTx - sc.clientWidth / 2) / sc.clientWidth, a = Math.abs(d);
    c.style.transform = `translate3d(0,${(a * 26).toFixed(1)}px,0) scale(${(1 - Math.min(a, 1) * .07).toFixed(3)})`;
  });
}
measure(); placeCards(true); document.fonts?.ready.then(() => { measure(); placeCards(true); });
addEventListener("resize", () => { measure(); placeCards(true); });

/* ---------- frame loop ---------- */
let smooth = scrollY, mx = 0, my = 0, tmx = 0, tmy = 0, angle = 0, t0 = null;
addEventListener("pointermove", (e) => { tmx = e.clientX / innerWidth - .5; tmy = e.clientY / innerHeight - .5; });
const ease = (x) => 1 - Math.pow(1 - x, 3);
function frame(time) {
  if (t0 === null) t0 = time;
  const T = (time - t0) / 1000;
  smooth = reduce ? scrollY : lerp(smooth, scrollY, .12);
  const maxS = Math.max(1, document.documentElement.scrollHeight - H), page = clamp(scrollY / maxS);
  mx = lerp(mx, tmx, .05); my = lerp(my, tmy, .05);

  // sky colour follows how far down the page you are
  const [top, bot, tint] = skyAt(page);
  skybase.style.background = `linear-gradient(180deg,${rgb(top)} 0%,${rgb(mix3(top, bot, .55))} 55%,${rgb(bot)} 100%)`;
  skyimg.style.transform = `translate3d(${-mx * 18}px,${-page * 4 * H / 100 - my * 10}px,0) scale(${1.08 + page * .08})`;
  drawClouds(reduce ? 0 : T, page, mx, my, tint);

  // whole-page flight bar: a small plane rides it from top to bottom of the page
  fbDone.style.transform = `scaleX(${page})`; fbPlane.style.left = (page * 100) + "%";

  // hero: plane flies the route. It lifts off on its own, then scroll takes over.
  const intro = reduce ? 0 : ease(clamp(T / 2.2)) * .1;
  const t = Math.max(clamp(smooth / (H * .4)), intro);
  const lift = smooth * .45, fade = 1 - sm(H * .3, H * .58, smooth);
  stage.style.opacity = fade; stage.style.transform = `translate3d(0,${-lift}px,0)`;
  stage.style.visibility = fade < .01 ? "hidden" : "visible";
  heroCopy.style.opacity = 1 - sm(H * .02, H * .4, smooth); heroCopy.style.transform = `translate3d(0,${-smooth * .3}px,0)`;
  routeDone.style.strokeDashoffset = routeLen * (1 - t);
  const head = t * routeLen, trail = Math.min(head, Math.min(W * .28, 380));
  routeTrail.style.strokeDasharray = `${trail} ${routeLen}`; routeTrail.style.strokeDashoffset = -(head - trail);
  status.textContent = t < .03 ? "READY FOR DEPARTURE" : t < .985 ? "IN FLIGHT · " + Math.round(t * 100) + "%" : "ARRIVED";

  const p = routeBase.getPointAtLength(head), a = routeBase.getPointAtLength(clamp(t + .015) * routeLen), b = routeBase.getPointAtLength(clamp(t - .015) * routeLen);
  const target = Math.atan2(a.y - b.y, a.x - b.x); angle = lerp(angle, target, .18);
  const alt = sm(0, .3, t), pw = clamp(W * .17, 120, 230);
  const bob = reduce ? 0 : Math.sin(T * 1.6) * 3;
  planeEl.style.width = pw + "px";
  planeEl.style.setProperty("--alt", alt.toFixed(3));
  planeEl.style.transform = `translate3d(${(p.x - pw / 2).toFixed(1)}px,${(p.y - pw / 4 + bob).toFixed(1)}px,0) rotate(${(angle * 57.2958).toFixed(2)}deg) scale(${(.78 + .22 * alt).toFixed(3)})`;

  placeCards();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
