"""On-flight meal delivery tracking and passenger meal-exchange offers for SkyBite.

The payment shown by this demo is a recorded simulated purchase. It does not charge a card
or call a payment provider. Offers are single-unit: only one passenger can claim each offer.
"""
from datetime import datetime
import math
from functools import wraps

from flask import Blueprint, abort, current_app, jsonify, redirect, request, session, url_for

import db
import passenger_features as pf

bp = Blueprint("of", __name__)

# Demo menu pricing in INR. A real deployment should use the airline's live menu price feed.
CATEGORY_PRICE_INR = {
    "navratri": 320, "ekadashi": 290, "ramzan": 430, "jain": 340,
    "sattvik": 330, "halal": 450, "veg": 350, "nonveg": 450,
    "diabetic": 300, "lowsodium": 290, "nutfree": 280, "gluten": 300, "child": 250,
}
DISH_PRICE_INR = {
    "paneer-bhurji": 360, "paneer-paratha": 320, "paneer-butter-masala": 390,
    "butter-chicken": 480, "mild-chicken-biryani": 440,
    "chicken-keema-paratha-roll": 410, "chicken-cheese-meatballs": 390,
    "mild-chicken-shami-kebabs": 380,
}


def _crew_only(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not (session.get("staff_id") and session.get("staff_name")):
            return redirect(url_for("staff_login"))
        return view(*args, **kwargs)
    return wrapper


def _passenger_only(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not (session.get("pnr") and session.get("pax_id")):
            return redirect(url_for("passenger_login"))
        return view(*args, **kwargs)
    return wrapper


def _now(conn):
    row = conn.execute("SELECT value FROM settings WHERE key = 'demo_now'").fetchone()
    return datetime.fromisoformat(row["value"]) if row else datetime.now()


def _ensure_operation(conn, flight_id):
    conn.execute("INSERT OR IGNORE INTO flight_operations (flight_id, on_flight_mode) VALUES (?, 0)", (flight_id,))


def _mode_enabled(conn, flight_id):
    _ensure_operation(conn, flight_id)
    row = conn.execute("SELECT on_flight_mode FROM flight_operations WHERE flight_id = ?", (flight_id,)).fetchone()
    return bool(row and row["on_flight_mode"])


def dish_price_inr(dish_code):
    dish = pf.dish_by_code(dish_code)
    if not dish:
        return 0
    return int(DISH_PRICE_INR.get(dish_code, CATEGORY_PRICE_INR.get(dish["meal_code"], 350)))


def service_feedback_summary(conn, flight_id, base_buffer=0):
    """Summarize service outcomes and calculate a cautious next-flight buffer signal.

    A not-delivered outcome is treated as possible unmet demand and can raise the buffer
    recommendation. An unclaimed canceled meal (its offer expired without a buyer) is a
    possible surplus signal and can lower it. Sold exchange meals are reassigned stock,
    not waste. Four closed outcomes are required before suggesting any adjustment.
    """
    statuses = {row["status"]: int(row["n"] or 0) for row in conn.execute(
        "SELECT status, COUNT(*) AS n FROM passenger_meal_service WHERE flight_id = ? GROUP BY status",
        (flight_id,),
    ).fetchall()}
    offer_statuses = {row["status"]: int(row["n"] or 0) for row in conn.execute(
        "SELECT status, COUNT(*) AS n FROM meal_exchange_offers WHERE flight_id = ? GROUP BY status",
        (flight_id,),
    ).fetchall()}
    purchase_statuses = {row["service_status"]: int(row["n"] or 0) for row in conn.execute(
        "SELECT service_status, COUNT(*) AS n FROM meal_exchange_purchases WHERE flight_id = ? AND status = 'purchased' GROUP BY service_status",
        (flight_id,),
    ).fetchall()}

    delivered = statuses.get("delivered", 0) + purchase_statuses.get("delivered", 0)
    not_delivered = statuses.get("not_delivered", 0) + purchase_statuses.get("not_delivered", 0)
    canceled = statuses.get("cancelled", 0)
    offers_sold = offer_statuses.get("sold", 0)
    offers_available = offer_statuses.get("available", 0)
    # A canceled meal counts as potential surplus only when it has neither been sold nor
    # remains available to passengers. Expired/withdrawn, unclaimed offers land here.
    unclaimed_canceled = max(0, canceled - offers_sold - offers_available)
    closed_outcomes = delivered + not_delivered + unclaimed_canceled
    base_buffer = max(0, int(base_buffer or 0))
    ready = closed_outcomes >= 4

    increase = reduction = 0
    if ready and base_buffer > 0:
        cap = min(base_buffer, max(1, math.ceil(base_buffer * 0.30)))
        if not_delivered:
            increase = min(cap, max(1, round(base_buffer * 0.30 * not_delivered / closed_outcomes)))
        if unclaimed_canceled:
            reduction = min(cap, max(1, round(base_buffer * 0.30 * unclaimed_canceled / closed_outcomes)))
    adjustment = increase - reduction
    next_buffer = max(0, base_buffer + adjustment)
    return {
        "delivered": delivered,
        "not_delivered": not_delivered,
        "cancelled": canceled,
        "offers_available": offers_available,
        "offers_sold": offers_sold,
        "exchange_pending_delivery": purchase_statuses.get("pending", 0),
        "exchange_not_delivered": purchase_statuses.get("not_delivered", 0),
        "unclaimed_canceled": unclaimed_canceled,
        "outcomes_count": closed_outcomes,
        "not_delivered_rate": round((not_delivered / closed_outcomes) * 100, 1) if closed_outcomes else 0.0,
        "unclaimed_rate": round((unclaimed_canceled / closed_outcomes) * 100, 1) if closed_outcomes else 0.0,
        "base_buffer": base_buffer,
        "buffer_increase": increase,
        "buffer_reduction": reduction,
        "adjustment": adjustment,
        "next_buffer": next_buffer,
        "ready": ready,
    }


@bp.post("/crew/on-flight/mode")
@_crew_only
def set_mode():
    conn = db.connect()
    try:
        flight = conn.execute("SELECT id FROM flights ORDER BY id LIMIT 1").fetchone()
        if not flight:
            return jsonify(ok=False, message="No flight is configured."), 404
        flight_id = flight["id"]
        _ensure_operation(conn, flight_id)
        enabled = request.form.get("enabled", "0") == "1"
        stamp = _now(conn).isoformat(timespec="seconds")
        conn.execute(
            """UPDATE flight_operations
               SET on_flight_mode = ?, mode_started_at = CASE WHEN ? = 1 THEN ? ELSE mode_started_at END,
                   mode_ended_at = CASE WHEN ? = 0 THEN ? ELSE NULL END, updated_by = ?
               WHERE flight_id = ?""",
            (1 if enabled else 0, 1 if enabled else 0, stamp, 1 if enabled else 0, stamp,
             session.get("staff_name", "Crew"), flight_id),
        )
        # Ending onboard mode closes any unclaimed exchange offers; sold offers stay in history.
        if not enabled:
            conn.execute(
                "UPDATE meal_exchange_offers SET status = 'expired' WHERE flight_id = ? AND status = 'available'",
                (flight_id,),
            )
        conn.commit()
        return jsonify(ok=True, enabled=enabled, message=("On-flight mode is on." if enabled else "On-flight mode is off."))
    finally:
        conn.close()


@bp.post("/crew/on-flight/seat/<int:passenger_id>/service")
@_crew_only
def update_seat_service(passenger_id):
    conn = db.connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        flight = conn.execute("SELECT id FROM flights ORDER BY id LIMIT 1").fetchone()
        if not flight:
            return jsonify(ok=False, message="No flight is configured."), 404
        flight_id = flight["id"]
        if not _mode_enabled(conn, flight_id):
            return jsonify(ok=False, message="Turn on On-flight mode before recording service."), 409
        pax = conn.execute(
            "SELECT id, flight_id, first_name, last_name, seat, meal_code FROM passengers WHERE id = ? AND flight_id = ?",
            (passenger_id, flight_id),
        ).fetchone()
        if not pax:
            return jsonify(ok=False, message="Passenger not found for this flight."), 404
        if not pax["meal_code"]:
            return jsonify(ok=False, message="This passenger has not selected a meal."), 409
        action = (request.form.get("action") or "").strip().lower()
        if action not in {"delivered", "not_delivered", "cancel_meal"}:
            return jsonify(ok=False, message="Choose delivered, not delivered, or cancel meal."), 400

        dish_code = pf.current_dish(conn, passenger_id, pax["meal_code"]) or pf.default_dish(pax["meal_code"])
        dish = pf.dish_for_meal(pax["meal_code"], dish_code)
        if not dish:
            dish_code = pf.default_dish(pax["meal_code"])
            dish = pf.dish_by_code(dish_code)
        existing = conn.execute(
            "SELECT * FROM passenger_meal_service WHERE passenger_id = ?", (passenger_id,)
        ).fetchone()
        if existing and (existing["meal_code"] != pax["meal_code"] or existing["dish_code"] != dish_code):
            existing = None
        status = existing["status"] if existing else "pending"
        if status == "cancelled":
            return jsonify(ok=False, message="This meal was already canceled and offered for exchange."), 409
        if status == "delivered" and action != "delivered":
            return jsonify(ok=False, message="This meal is already recorded as delivered."), 409

        stamp = _now(conn).isoformat(timespec="seconds")
        if action == "cancel_meal":
            if status == "delivered":
                return jsonify(ok=False, message="A delivered meal cannot be re-offered."), 409
            price = dish_price_inr(dish_code)
            discount = 20
            discounted = int(round(price * (100 - discount) / 100))
            conn.execute(
                """INSERT INTO meal_exchange_offers
                   (flight_id, source_passenger_id, meal_code, dish_code, original_price,
                    discount_percent, discounted_price, status, created_at)
                   VALUES (?,?,?,?,?,?,?,'available',?)""",
                (flight_id, passenger_id, pax["meal_code"], dish_code, price, discount, discounted, stamp),
            )
            conn.execute(
                """INSERT INTO passenger_meal_service
                   (passenger_id, flight_id, meal_code, dish_code, status, updated_at, updated_by, note)
                   VALUES (?,?,?,?, 'cancelled',?,?, '')
                   ON CONFLICT(passenger_id) DO UPDATE SET flight_id=excluded.flight_id,
                     meal_code=excluded.meal_code, dish_code=excluded.dish_code, status='cancelled',
                     updated_at=excluded.updated_at, updated_by=excluded.updated_by, note=''""",
                (passenger_id, flight_id, pax["meal_code"], dish_code, stamp, session.get("staff_name", "Crew")),
            )
            conn.commit()
            return jsonify(ok=True, message=f"{dish['name']} canceled. A 20% discounted offer is now visible to other passengers.",
                           status="cancelled", offer={"original_price": price, "discounted_price": discounted,
                           "dish_name": dish["name"], "discount_percent": discount})

        desired = "delivered" if action == "delivered" else "not_delivered"
        conn.execute(
            """INSERT INTO passenger_meal_service
               (passenger_id, flight_id, meal_code, dish_code, status, updated_at, updated_by, note)
               VALUES (?,?,?,?,?,?,?, '')
               ON CONFLICT(passenger_id) DO UPDATE SET flight_id=excluded.flight_id,
                 meal_code=excluded.meal_code, dish_code=excluded.dish_code, status=excluded.status,
                 updated_at=excluded.updated_at, updated_by=excluded.updated_by, note=''""",
            (passenger_id, flight_id, pax["meal_code"], dish_code, desired, stamp, session.get("staff_name", "Crew")),
        )
        conn.commit()
        return jsonify(ok=True, message=f"{dish['name']} marked as {desired.replace('_', ' ')}.", status=desired)
    finally:
        conn.close()


@bp.post("/crew/on-flight/exchange/<int:purchase_id>/service")
@_crew_only
def update_exchange_service(purchase_id):
    conn = db.connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        flight = conn.execute("SELECT id FROM flights ORDER BY id LIMIT 1").fetchone()
        if not flight or not _mode_enabled(conn, flight["id"]):
            return jsonify(ok=False, message="On-flight mode is not active."), 409
        purchase = conn.execute(
            "SELECT * FROM meal_exchange_purchases WHERE id = ? AND flight_id = ? AND status = 'purchased'",
            (purchase_id, flight["id"]),
        ).fetchone()
        if not purchase:
            return jsonify(ok=False, message="Exchange order not found."), 404
        action = (request.form.get("action") or "").strip().lower()
        if action not in {"delivered", "not_delivered"}:
            return jsonify(ok=False, message="Choose delivered or not delivered."), 400
        if purchase["service_status"] == "delivered" and action != "delivered":
            return jsonify(ok=False, message="This exchange meal is already recorded as delivered."), 409
        stamp = _now(conn).isoformat(timespec="seconds")
        conn.execute(
            "UPDATE meal_exchange_purchases SET service_status = ?, updated_at = ?, updated_by = ? WHERE id = ?",
            (action, stamp, session.get("staff_name", "Crew"), purchase_id),
        )
        conn.commit()
        return jsonify(ok=True, message=f"Exchange meal marked as {action.replace('_', ' ')}.", status=action)
    finally:
        conn.close()


@bp.get("/my/exchange/data")
@_passenger_only
def passenger_exchange_data():
    conn = db.connect()
    try:
        pax = conn.execute("SELECT id, pnr, flight_id FROM passengers WHERE id = ? AND pnr = ?",
                           (session.get("pax_id"), session.get("pnr"))).fetchone()
        if not pax:
            abort(403)
        flight_id, pnr = pax["flight_id"], pax["pnr"]
        enabled = _mode_enabled(conn, flight_id)
        offers = []
        if enabled:
            rows = conn.execute(
                """SELECT o.*, m.name AS meal_name
                   FROM meal_exchange_offers o JOIN meals m ON m.code = o.meal_code
                   JOIN passengers seller ON seller.id = o.source_passenger_id
                   WHERE o.flight_id = ? AND o.status = 'available' AND seller.pnr != ?
                   ORDER BY o.created_at DESC, o.id DESC""", (flight_id, pnr)
            ).fetchall()
            for row in rows:
                dish = pf.dish_by_code(row["dish_code"])
                offers.append({
                    "id": row["id"], "meal_name": row["meal_name"],
                    "dish_name": dish["name"] if dish else "Available meal",
                    "original_price": row["original_price"], "discount_percent": row["discount_percent"],
                    "discounted_price": row["discounted_price"], "created_at": row["created_at"],
                })
        own_rows = conn.execute(
            """SELECT o.id, o.status, o.original_price, o.discount_percent, o.discounted_price,
                      o.created_at, m.name AS meal_name
               FROM meal_exchange_offers o JOIN passengers seller ON seller.id = o.source_passenger_id
               JOIN meals m ON m.code = o.meal_code
               WHERE o.flight_id = ? AND seller.pnr = ? ORDER BY o.id DESC LIMIT 5""", (flight_id, pnr)
        ).fetchall()
        own_offers = []
        for row in own_rows:
            purchase = conn.execute("SELECT 1 FROM meal_exchange_purchases WHERE offer_id = ?", (row["id"],)).fetchone()
            own_offers.append({"id": row["id"], "status": row["status"], "meal_name": row["meal_name"],
                               "original_price": row["original_price"], "discounted_price": row["discounted_price"],
                               "sold": bool(purchase)})
        purchase_rows = conn.execute(
            """SELECT x.id, x.amount_paid, x.original_price, x.discount_percent, x.service_status,
                      x.purchased_at, m.name AS meal_name, x.dish_code
               FROM meal_exchange_purchases x JOIN passengers buyer ON buyer.id = x.buyer_passenger_id
               JOIN meals m ON m.code = x.meal_code
               WHERE x.flight_id = ? AND buyer.pnr = ? AND x.status = 'purchased'
               ORDER BY x.id DESC LIMIT 5""", (flight_id, pnr)
        ).fetchall()
        pending_purchase = conn.execute(
            """SELECT id FROM meal_exchange_purchases
               WHERE buyer_passenger_id = ? AND status = 'purchased' AND service_status = 'pending'
               LIMIT 1""", (pax["id"],)
        ).fetchone()
        purchases = []
        for row in purchase_rows:
            dish = pf.dish_by_code(row["dish_code"])
            purchases.append({"id": row["id"], "amount_paid": row["amount_paid"],
                              "original_price": row["original_price"], "discount_percent": row["discount_percent"],
                              "service_status": row["service_status"], "meal_name": row["meal_name"],
                              "dish_name": dish["name"] if dish else "Meal exchange purchase"})
        return jsonify(enabled=enabled, offers=offers, own_offers=own_offers, purchases=purchases,
                       can_purchase=not bool(pending_purchase),
                       purchase_block_reason=("Your current discounted meal is awaiting crew delivery confirmation." if pending_purchase else ""))
    finally:
        conn.close()


@bp.post("/my/exchange/<int:offer_id>/purchase")
@_passenger_only
def purchase_exchange_offer(offer_id):
    conn = db.connect()
    try:
        # Serialize claim attempts so two browser tabs cannot buy the same single meal.
        conn.execute("BEGIN IMMEDIATE")
        pax = conn.execute("SELECT id, pnr, flight_id FROM passengers WHERE id = ? AND pnr = ?",
                           (session.get("pax_id"), session.get("pnr"))).fetchone()
        if not pax:
            conn.rollback()
            return jsonify(ok=False, message="Passenger session is no longer valid."), 403
        if not _mode_enabled(conn, pax["flight_id"]):
            conn.rollback()
            return jsonify(ok=False, message="Meal exchange is closed because On-flight mode is off."), 409
        offer = conn.execute(
            """SELECT o.*, seller.pnr AS seller_pnr FROM meal_exchange_offers o
               JOIN passengers seller ON seller.id = o.source_passenger_id
               WHERE o.id = ? AND o.flight_id = ?""", (offer_id, pax["flight_id"])
        ).fetchone()
        if not offer:
            conn.rollback()
            return jsonify(ok=False, message="This meal offer could not be found."), 404
        if offer["seller_pnr"] == pax["pnr"]:
            conn.rollback()
            return jsonify(ok=False, message="This offer belongs to your booking. Another passenger can claim it."), 403
        if offer["status"] != "available":
            conn.rollback()
            return jsonify(ok=False, message="Another passenger has already claimed this meal."), 409
        # Keep one exchange order awaiting delivery per seat. This ensures crew can
        # always see and update the active exchange order from that seat's drawer.
        pending_purchase = conn.execute(
            """SELECT id FROM meal_exchange_purchases
               WHERE buyer_passenger_id = ? AND status = 'purchased' AND service_status = 'pending'
               LIMIT 1""", (pax["id"],)
        ).fetchone()
        if pending_purchase:
            conn.rollback()
            return jsonify(ok=False, message="Your current discounted meal is awaiting crew delivery confirmation. Please wait until it is marked delivered or not delivered before claiming another offer."), 409
        stamp = _now(conn).isoformat(timespec="seconds")
        updated = conn.execute(
            "UPDATE meal_exchange_offers SET status = 'sold', sold_at = ? WHERE id = ? AND status = 'available'",
            (stamp, offer_id),
        )
        if updated.rowcount != 1:
            conn.rollback()
            return jsonify(ok=False, message="This meal has just been claimed by someone else."), 409
        conn.execute(
            """INSERT INTO meal_exchange_purchases
               (offer_id, flight_id, buyer_passenger_id, seller_passenger_id, meal_code, dish_code,
                original_price, discount_percent, amount_paid, status, service_status, purchased_at)
               VALUES (?,?,?,?,?,?,?,?,?,'purchased','pending',?)""",
            (offer_id, pax["flight_id"], pax["id"], offer["source_passenger_id"], offer["meal_code"],
             offer["dish_code"], offer["original_price"], offer["discount_percent"],
             offer["discounted_price"], stamp),
        )
        conn.commit()
        return jsonify(ok=True, message="Demo purchase confirmed. No real payment was processed.",
                       amount_paid=offer["discounted_price"])
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_app(app):
    """Register the crew on-flight controls and passenger exchange endpoints."""
    app.register_blueprint(bp)
