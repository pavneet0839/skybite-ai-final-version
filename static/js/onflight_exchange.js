(() => {
  'use strict';

  const root = document.querySelector('[data-exchange-root]');
  if (!root) return;

  const url = root.dataset.url;
  const purchaseTemplate = root.dataset.purchaseUrl;
  const csrf = root.dataset.csrf || '';
  const nav = document.getElementById('pw-exchange-nav');
  const modeLabel = root.querySelector('[data-px-mode-label]');
  const offersEl = root.querySelector('[data-px-offers]');
  const ownEl = root.querySelector('[data-px-own]');
  const purchasesEl = root.querySelector('[data-px-purchases]');
  const emptyEl = root.querySelector('[data-px-empty]');
  const notification = root.querySelector('[data-px-notification]');
  const notificationCopy = root.querySelector('[data-px-notification-copy]');
  let initialized = false;
  let previousOfferIds = new Set();
  const offerCards = new Map();
  let notificationTimer = 0;
  let requestInFlight = false;
  let pendingReload = false;

  const money = (value) => new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0
  }).format(Number(value || 0));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function showNotification(message, title) {
    notificationCopy.textContent = message;
    const titleNode = notification.querySelector('b');
    if (titleNode) titleNode.textContent = title || 'New meal available onboard';
    notification.hidden = false;
    notification.classList.remove('is-visible');
    void notification.offsetWidth;
    notification.classList.add('is-visible');
    window.clearTimeout(notificationTimer);
    notificationTimer = window.setTimeout(() => {
      notification.classList.remove('is-visible');
      notification.hidden = true;
    }, 6500);
  }

  function buildOfferCard(offer, canPurchase, purchaseBlockReason) {
    const card = el('article', 'px-offer-card');
    card.dataset.offerId = offer.id;
    const top = el('div', 'px-offer-top');
    top.append(el('span', 'px-offer-live', '● LIVE OFFER'), el('span', 'px-offer-discount', `${offer.discount_percent}% OFF`));

    const body = el('div', 'px-offer-body');
    body.append(el('span', 'px-offer-kicker', offer.meal_name || 'Meal exchange'));
    body.append(el('h3', 'px-offer-name', offer.dish_name || 'Available meal'));
    body.append(el('p', 'px-offer-copy', 'Released by the crew before delivery. One passenger can claim this meal.'));

    const price = el('div', 'px-offer-price');
    const oldPrice = el('del', 'px-price-old', money(offer.original_price));
    const currentPrice = el('strong', 'px-price-current', money(offer.discounted_price));
    const saving = el('span', 'px-price-saving', `You save ${money(Number(offer.original_price) - Number(offer.discounted_price))}`);
    price.append(oldPrice, currentPrice, saving);

    const form = el('form', 'px-buy-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      if (!button || button.disabled) return;
      button.disabled = true;
      button.classList.add('is-loading');
      button.textContent = 'Confirming…';
      try {
        const purchaseUrl = purchaseTemplate.replace(/\/0\/purchase$/, `/${offer.id}/purchase`);
        const response = await fetch(purchaseUrl, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'Accept': 'application/json' },
          body: new URLSearchParams({ csrf_token: csrf })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.message || 'This meal is no longer available.');
        showNotification(`${offer.dish_name} has been reserved for ${money(payload.amount_paid)}. No real payment was processed.`, 'Meal exchange confirmed');
        await loadData(true);
      } catch (err) {
        showNotification(err.message || 'Could not claim this meal. Please refresh and try again.', 'Offer not completed');
        button.disabled = false;
        button.classList.remove('is-loading');
        button.textContent = `Buy meal · ${money(offer.discounted_price)}`;
        await loadData(true);
      }
    });
    const buy = el('button', 'px-buy-button', canPurchase
      ? `Buy meal · ${money(offer.discounted_price)}`
      : 'Current order awaiting delivery');
    buy.type = 'submit';
    buy.disabled = !canPurchase;
    if (!canPurchase) {
      buy.title = purchaseBlockReason || 'Wait for the crew to finish your current exchange order.';
      buy.setAttribute('aria-label', buy.title);
      form.append(el('small', 'px-buy-blocked', buy.title));
    }
    form.append(buy);
    body.append(price, form);
    card.append(top, body);
    return card;
  }

  function syncOfferCardAvailability(card, offer, canPurchase, purchaseBlockReason) {
    const button = card.querySelector('.px-buy-button');
    const form = card.querySelector('.px-buy-form');
    if (!button || !form) return;
    let blocked = form.querySelector('.px-buy-blocked');
    if (canPurchase) {
      button.disabled = false;
      button.textContent = `Buy meal · ${money(offer.discounted_price)}`;
      button.removeAttribute('title');
      button.removeAttribute('aria-label');
      if (blocked) blocked.remove();
    } else {
      const reason = purchaseBlockReason || 'Wait for the crew to finish your current exchange order.';
      button.disabled = true;
      button.textContent = 'Current order awaiting delivery';
      button.title = reason;
      button.setAttribute('aria-label', reason);
      if (!blocked) {
        blocked = el('small', 'px-buy-blocked', reason);
        form.insertBefore(blocked, button);
      } else {
        blocked.textContent = reason;
      }
    }
  }

  function renderOfferCards(offers, canPurchase, purchaseBlockReason) {
    const activeIds = new Set(offers.map((offer) => String(offer.id)));
    for (const [id, card] of offerCards.entries()) {
      if (!activeIds.has(id)) {
        card.remove();
        offerCards.delete(id);
      }
    }

    let cursor = offersEl.firstElementChild;
    offers.forEach((offer, index) => {
      const id = String(offer.id);
      let card = offerCards.get(id);
      if (!card) {
        card = buildOfferCard(offer, canPurchase, purchaseBlockReason);
        offerCards.set(id, card);
      } else {
        // Update only the disabled/enabled state; don't replace the card on every poll,
        // which would replay the entrance animation and make the market look jittery.
        syncOfferCardAvailability(card, offer, canPurchase, purchaseBlockReason);
      }
      card.style.setProperty('--offer-index', index);
      if (card !== cursor) offersEl.insertBefore(card, cursor);
      cursor = card.nextElementSibling;
    });
  }

  function renderOwnOffers(items) {
    ownEl.replaceChildren();
    if (!items || !items.length) {
      ownEl.hidden = true;
      return;
    }
    ownEl.hidden = false;
    const head = el('div', 'px-mini-heading');
    head.append(el('h3', null, 'Your meal release'), el('span', null, 'CREW UPDATE'));
    ownEl.append(head);
    items.forEach((item) => {
      const line = el('div', 'px-own-line');
      const copy = el('div', 'px-own-copy');
      copy.append(el('b', null, item.meal_name || 'Your canceled meal'));
      let status = 'Available to other passengers';
      if (item.status === 'sold' || item.sold) status = 'Claimed by another passenger';
      else if (item.status === 'expired') status = 'Offer closed';
      else if (item.status === 'withdrawn') status = 'Offer withdrawn';
      copy.append(el('small', null, status));
      line.append(copy, el('strong', 'px-own-price', money(item.discounted_price)));
      ownEl.append(line);
    });
  }

  function renderPurchases(items) {
    purchasesEl.replaceChildren();
    if (!items || !items.length) {
      purchasesEl.hidden = true;
      return;
    }
    purchasesEl.hidden = false;
    const head = el('div', 'px-mini-heading');
    head.append(el('h3', null, 'Your discounted meals'), el('span', null, 'ORDER STATUS'));
    purchasesEl.append(head);
    items.forEach((item) => {
      const line = el('div', 'px-purchase-line');
      const copy = el('div', 'px-purchase-copy');
      copy.append(el('b', null, item.dish_name || item.meal_name));
      const statusText = item.service_status === 'delivered' ? 'Delivered to your seat' :
        item.service_status === 'not_delivered' ? 'Crew recorded: not delivered' : 'Purchase confirmed · awaiting delivery';
      copy.append(el('small', null, statusText));
      line.append(copy, el('strong', 'px-purchase-price', money(item.amount_paid)));
      purchasesEl.append(line);
    });
  }

  async function loadData(fromAction) {
    if (requestInFlight) {
      if (fromAction) pendingReload = true;
      return;
    }
    requestInFlight = true;
    try {
      const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const data = await response.json();
      const offers = Array.isArray(data.offers) ? data.offers : [];
      const canPurchase = data.can_purchase !== false;
      const purchaseBlockReason = data.purchase_block_reason || '';
      const isFirstLoad = !initialized;
      const nextIds = new Set(offers.map((item) => String(item.id)));
      if (initialized && !fromAction) {
        const newOffers = offers.filter((item) => !previousOfferIds.has(String(item.id)));
        if (newOffers.length) showNotification(`${newOffers[0].dish_name} is available at 20% off. Open this section to claim it.`, 'New meal available onboard');
      }
      previousOfferIds = nextIds;
      initialized = true;

      const shouldShow = Boolean(data.enabled || (data.own_offers || []).length || (data.purchases || []).length);
      const wasHidden = root.hidden;
      root.hidden = !shouldShow;
      if (nav) nav.hidden = !shouldShow;
      if (wasHidden && shouldShow) {
        root.classList.remove('is-opening');
        void root.offsetWidth;
        root.classList.add('is-opening');
      }
      modeLabel.textContent = data.enabled ? 'ON-FLIGHT MARKET LIVE' : 'MARKET CLOSED';
      root.classList.toggle('is-live', Boolean(data.enabled));

      renderOfferCards(offers, canPurchase, purchaseBlockReason);
      if (isFirstLoad && offers.length) {
        showNotification(`${offers[0].dish_name} is available at 20% off. Open this section to claim it.`, 'New meal available onboard');
      }
      renderOwnOffers(data.own_offers || []);
      renderPurchases(data.purchases || []);
      emptyEl.hidden = !data.enabled || offers.length > 0;
      if (!data.enabled && !offers.length && !shouldShow) root.hidden = true;
    } catch (_err) {
      // Keep the rest of the passenger page usable during a brief connection interruption.
    } finally {
      requestInFlight = false;
      if (pendingReload) {
        pendingReload = false;
        window.setTimeout(() => loadData(true), 0);
      }
    }
  }

  loadData(false);
  window.setInterval(() => { if (!document.hidden) loadData(false); }, 6500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadData(false); });
})();
