// SkyBite frontend polish: the app still works without these visual enhancements.
(() => {
  "use strict";

  // Demo shortcuts on both sign-in pages.
  document.querySelectorAll("[data-fill-demo]").forEach((button) => {
    button.addEventListener("click", () => {
      const pnr = document.getElementById("pnr");
      const lastName = document.getElementById("last_name");
      if (!pnr || !lastName) return;
      pnr.value = "VM4K9Z";
      lastName.value = "Mehta";
      pnr.dispatchEvent(new Event("input", { bubbles: true }));
      pnr.form?.querySelector("button[type=submit]")?.focus();
    });
  });
  document.querySelectorAll("[data-fill-staff]").forEach((button) => {
    button.addEventListener("click", () => {
      const staffId = document.getElementById("staff_id");
      const password = document.getElementById("password");
      if (!staffId || !password) return;
      staffId.value = "SB1001";
      password.value = "crew123";
      password.form?.querySelector("button[type=submit]")?.focus();
    });
  });

  const pnr = document.getElementById("pnr");
  if (pnr) pnr.addEventListener("input", () => { pnr.value = pnr.value.toUpperCase().replace(/\s/g, ""); });

  // Keep only one traveller's menu expanded at a time.
  document.querySelectorAll("details.change").forEach((detail) => {
    detail.addEventListener("toggle", () => {
      if (!detail.open) return;
      document.querySelectorAll("details.change[open]").forEach((other) => {
        if (other !== detail) other.open = false;
      });
    });
  });

  // Accessible, progressive-reveal entrances. Nothing is hidden unless an observer is available.
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Crew workspace tabs keep the original Seat Plan intact and expose Forecast separately.
  const workspaceTabs = [...document.querySelectorAll("[data-workspace-tab]")];
  const workspacePanels = [...document.querySelectorAll("[data-workspace-panel]")];
  if (workspaceTabs.length && workspacePanels.length) {
    const activateWorkspace = (selectedTab, moveFocus = false) => {
      const selectedName = selectedTab.dataset.workspaceTab;
      workspaceTabs.forEach((tab) => {
        const selected = tab === selectedTab;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        tab.classList.toggle("is-active", selected);
      });
      workspacePanels.forEach((panel) => {
        const selected = panel.dataset.workspacePanel === selectedName;
        panel.hidden = !selected;
        panel.classList.toggle("is-active", selected);
        if (selected && !reducedMotion) {
          panel.style.animation = "none";
          void panel.offsetHeight;
          panel.style.animation = "";
        }
      });
      if (moveFocus) selectedTab.focus();
    };

    workspaceTabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateWorkspace(tab));
      tab.addEventListener("keydown", (event) => {
        let nextIndex = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % workspaceTabs.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + workspaceTabs.length) % workspaceTabs.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = workspaceTabs.length - 1;
        else return;
        event.preventDefault();
        activateWorkspace(workspaceTabs[nextIndex], true);
      });
    });
  }

  // Draw and make the waste-avoidance chart explorable by mouse, touch and keyboard.
  const wasteCharts = [...document.querySelectorAll("[data-waste-chart]")];
  wasteCharts.forEach((chart) => {
    const points = [...chart.querySelectorAll("[data-waste-flight]")];
    const card = chart.closest(".forecast-waste-card");
    const detail = card?.querySelector("[data-waste-detail]");
    if (detail && points.length) {
      const title = detail.querySelector("[data-waste-detail-title]");
      const date = detail.querySelector("[data-waste-detail-date]");
      const flat = detail.querySelector("[data-waste-flat]");
      const targeted = detail.querySelector("[data-waste-targeted]");
      const saved = detail.querySelector("[data-waste-saved]");
      let detailTimer = 0;
      const showFlight = (point) => {
        if (!point || !title || !date || !flat || !targeted || !saved) return;
        points.forEach((candidate) => candidate.classList.toggle("is-selected", candidate === point));
        title.textContent = point.dataset.wasteFlight || "Sample flight";
        date.textContent = `${point.dataset.wasteDate || "Historical reference"} · estimated buffer comparison`;
        flat.textContent = `${point.dataset.wasteFlat || 0} meals`;
        targeted.textContent = `${point.dataset.wasteTargeted || 0} meals`;
        saved.textContent = `${point.dataset.wasteSaved || 0} meals`;
        detail.classList.remove("is-updated");
        // Reflow restarts the small feedback animation only when a new point is chosen.
        void detail.offsetWidth;
        detail.classList.add("is-updated");
        window.clearTimeout(detailTimer);
        detailTimer = window.setTimeout(() => detail.classList.remove("is-updated"), 420);
      };
      points.forEach((point) => {
        point.addEventListener("pointerenter", () => showFlight(point));
        point.addEventListener("focus", () => showFlight(point));
        point.addEventListener("click", () => showFlight(point));
        point.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            showFlight(point);
          }
        });
      });
      showFlight(points[0]);
    }
  });
  if (wasteCharts.length) {
    if (!reducedMotion && "IntersectionObserver" in window) {
      wasteCharts.forEach((chart) => chart.classList.add("is-pending"));
      const wasteChartObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const chart = entry.target;
          chart.classList.remove("is-pending");
          chart.classList.add("is-drawing");
          observer.unobserve(chart);
        });
      }, { threshold: 0.18, rootMargin: "0px 0px -12px 0px" });
      wasteCharts.forEach((chart) => wasteChartObserver.observe(chart));
    } else {
      wasteCharts.forEach((chart) => chart.classList.add("is-drawing"));
    }
  }

  // Lightweight global page progress. It never drives the flight scene or blocks scrolling.
  const progressFill = document.querySelector(".scroll-progress > span");
  let pageProgressFrame = 0;
  const updatePageProgress = () => {
    pageProgressFrame = 0;
    if (!progressFill) return;
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    progressFill.style.transform = `scaleX(${Math.max(0, Math.min(1, window.scrollY / maxScroll))})`;
  };
  const queuePageProgress = () => {
    if (pageProgressFrame) return;
    pageProgressFrame = requestAnimationFrame(updatePageProgress);
  };
  if (progressFill) {
    window.addEventListener("scroll", queuePageProgress, { passive: true });
    window.addEventListener("resize", queuePageProgress, { passive: true });
    updatePageProgress();
  }

  // Scroll-linked flight route: natural page scrolling remains untouched (no sticky/pinned scene).
  // The route and plane update at most once per animation frame, only while this page's route exists.
  const flightHero = document.querySelector("[data-flight-hero]");
  if (flightHero) {
    const stage = flightHero.querySelector("[data-flight-stage]");
    const routeBase = flightHero.querySelector("[data-flight-route-base]");
    const routeProgress = flightHero.querySelector("[data-flight-route-progress]");
    const plane = flightHero.querySelector("[data-flight-plane]");
    const status = flightHero.querySelector("[data-flight-status]");
    const progressBar = flightHero.querySelector("[data-flight-progress-bar]");
    let routeLength = 0;
    let stageTop = 0;
    let travelDistance = 400;
    let framePending = false;
    const clamp01 = (value) => Math.max(0, Math.min(1, value));

    try {
      if (routeBase) routeLength = routeBase.getTotalLength();
      if (routeProgress && routeLength > 0) {
        routeProgress.style.strokeDasharray = `${routeLength} ${routeLength}`;
        routeProgress.style.strokeDashoffset = String(routeLength);
      }
    } catch (_) {
      routeLength = 0;
    }

    const measureFlight = () => {
      const rect = (stage || flightHero).getBoundingClientRect();
      stageTop = rect.top + window.scrollY;
      travelDistance = Math.max(260, Math.min(460, window.innerHeight * 0.49));
    };

    const updateFlight = () => {
      framePending = false;
      if (!stage || !routeBase || !plane || !routeLength) return;
      const progress = reducedMotion ? 1 : clamp01((window.scrollY - stageTop) / travelDistance);
      stage.classList.toggle("is-flight-revealed", progress > 0 || window.scrollY < stageTop + travelDistance);

      routeProgress.style.strokeDashoffset = String(routeLength * (1 - progress));
      if (progressBar) progressBar.style.transform = `scaleX(${progress})`;

      const distance = routeLength * progress;
      try {
        const point = routeBase.getPointAtLength(distance);
        const next = routeBase.getPointAtLength(Math.min(routeLength, distance + 3));
        const previous = routeBase.getPointAtLength(Math.max(0, distance - 3));
        const a = progress >= 0.999 ? previous : point;
        const b = progress >= 0.999 ? point : next;
        const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        plane.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(2)})`);
      } catch (_) {
        // Keep the static route and plane usable in browsers with incomplete SVG path APIs.
      }

      if (status) {
        let nextStatus;
        if (progress <= 0.015) nextStatus = "READY FOR DEPARTURE";
        else if (progress >= 0.985) nextStatus = "ROUTE COMPLETE";
        else nextStatus = `IN FLIGHT · ${flightHero.dataset.flightFrom || "DEL"} → ${flightHero.dataset.flightTo || "BOM"}`;
        if (status.textContent !== nextStatus) status.textContent = nextStatus;
      }
    };

    const scheduleFlightUpdate = () => {
      if (framePending) return;
      framePending = true;
      window.requestAnimationFrame(updateFlight);
    };

    measureFlight();
    scheduleFlightUpdate();
    window.addEventListener("scroll", scheduleFlightUpdate, { passive: true });
    window.addEventListener("resize", () => { measureFlight(); scheduleFlightUpdate(); }, { passive: true });
    window.addEventListener("load", () => { measureFlight(); scheduleFlightUpdate(); }, { once: true });
  }

  const revealSelector = [
    ".auth-copy", ".auth-visual", ".food-stage", ".welcome-row", ".journey-hero",
    ".festival-banner", ".section-heading", ".traveller-card", ".flight-details-section",
    ".ops-welcome", ".ops-flight-hero", ".metric-card", ".ops-panel", ".site-footer", ".app-footer",
    ".flight-story-copy", ".flight-story-bottom", ".meal-showcase-head", ".meal-showcase-card", ".journey-finale-card"
  ].join(",");
  const revealTargets = [...document.querySelectorAll(revealSelector)];
  if (!reducedMotion && "IntersectionObserver" in window && revealTargets.length) {
    revealTargets.forEach((node, index) => {
      if (node.classList.contains("will-reveal")) return;
      node.classList.add("will-reveal");
      node.style.setProperty("--reveal-delay", `${Math.min(index % 5, 4) * 65}ms`);
    });
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.11, rootMargin: "0px 0px -24px 0px" });
    revealTargets.forEach((node) => revealObserver.observe(node));
  }

  // Real values count up once as their metrics enter the viewport.
  const counters = document.querySelectorAll(".count-up");
  const animateCounter = (node) => {
    if (node.dataset.counted === "true") return;
    node.dataset.counted = "true";
    const end = Number(node.dataset.count || 0);
    if (reducedMotion || !Number.isFinite(end)) { node.textContent = String(end || 0); return; }
    const start = performance.now();
    const duration = 850;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      node.textContent = String(Math.round(end * (1 - Math.pow(1 - progress, 4))));
      if (progress < 1) requestAnimationFrame(tick);
    };
    node.textContent = "0";
    requestAnimationFrame(tick);
  };
  if (!reducedMotion && "IntersectionObserver" in window) {
    const countObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { animateCounter(entry.target); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.2 });
    counters.forEach((node) => countObserver.observe(node));
  } else counters.forEach(animateCounter);

  // Mouse-position tilt: intentionally restrained and completely disabled for touch/reduced motion.
  const canTilt = !reducedMotion && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (canTilt) {
    document.querySelectorAll("[data-tilt]").forEach((card) => {
      let rect = null;
      const strength = Number(card.dataset.tiltStrength || 4);
      card.addEventListener("pointerenter", () => { rect = card.getBoundingClientRect(); card.style.transition = "transform .12s ease-out, border-color .25s ease, box-shadow .25s ease"; });
      card.addEventListener("pointermove", (event) => {
        rect = rect || card.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const rotateY = (x - .5) * strength * 2;
        const rotateX = (.5 - y) * strength * 2;
        card.style.transform = `perspective(1200px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(0)`;
        card.style.setProperty("--spot-x", `${(x * 100).toFixed(1)}%`);
        card.style.setProperty("--spot-y", `${(y * 100).toFixed(1)}%`);
      });
      card.addEventListener("pointerleave", () => {
        rect = null;
        card.style.transition = "transform .45s cubic-bezier(.2,.78,.22,1), border-color .25s ease, box-shadow .25s ease";
        card.style.transform = "";
      });
    });
  }

  // Pointer-following highlights make the surfaces feel tactile without adding decorative clutter.
  if (canTilt) {
    document.querySelectorAll(".traveller-card, .metric-card, .meal-option, .ops-panel").forEach((surface) => {
      const updateSpot = (event) => {
        const rect = surface.getBoundingClientRect();
        surface.style.setProperty("--spot-x", `${Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)).toFixed(1)}%`);
        surface.style.setProperty("--spot-y", `${Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100)).toFixed(1)}%`);
      };
      surface.addEventListener("pointermove", updateSpot, { passive: true });
    });


  }

  // A useful live selection state, including the selected meal name.
  document.querySelectorAll(".meal-form").forEach((form) => {
    const radios = form.querySelectorAll('.meal-option input[type="radio"]');
    const update = () => {
      form.querySelectorAll(".meal-option").forEach((card) => {
        const radio = card.querySelector('input[type="radio"]');
        card.classList.toggle("is-selected", Boolean(radio && radio.checked));
      });
      const selected = form.querySelector('.meal-option input[type="radio"]:checked');
      const hint = form.querySelector(".meal-picker-hint");
      if (hint) hint.textContent = selected ? `Selected: ${selected.closest(".meal-option").querySelector(".meal-name").textContent.trim()}` : "Select one box";
    };
    radios.forEach((radio) => radio.addEventListener("change", update));
    update();
  });

  // Crew demo controls slide closed rather than abruptly disappearing.
  document.querySelectorAll("[data-collapse-target]").forEach((button) => {
    const target = document.getElementById(button.dataset.collapseTarget);
    if (!target) return;
    target.style.maxHeight = `${target.scrollHeight}px`;
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      const label = button.querySelector("span");
      if (label) label.textContent = expanded ? "Show" : "Hide";
      target.classList.toggle("is-collapsed", expanded);
      target.style.maxHeight = expanded ? "0px" : `${target.scrollHeight}px`;
    });
  });

  // Toasts leave quietly; they remain readable for several seconds.
  document.querySelectorAll(".toast").forEach((toast) => {
    window.setTimeout(() => {
      toast.style.transition = "opacity .35s ease, transform .35s ease";
      toast.style.opacity = "0";
      toast.style.transform = "translateY(-8px)";
      window.setTimeout(() => toast.remove(), 380);
    }, 5000);
  });

  // Highlight the correct top-nav section when the passenger scrolls around the page.
  const navLinks = [...document.querySelectorAll(".app-nav a[href^='#']")];
  const navTargets = navLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if (navTargets.length && "IntersectionObserver" in window) {
    const navObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`));
      });
    }, { rootMargin: "-25% 0px -60% 0px" });
    navTargets.forEach((target) => navObserver.observe(target));
  }
})();
