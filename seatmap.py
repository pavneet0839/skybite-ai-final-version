"""Seat map for the crew dashboard (feature "sm").

Everything for this feature lives in its own files:
    seatmap.py, templates/_seatmap.html, static/css/seatmap.css, static/js/seatmap.js

It only READS the existing tables. It adds one route, /crew/seatmap/data, which the page asks for
every few seconds so a meal chosen on the phone or the website recolours its seat by itself.
"""
from datetime import datetime

from flask import Blueprint, abort, current_app, jsonify, redirect, session, url_for

import db
import passenger_features as pf
import onflight
from chat import fmt_day, fmt_time

bp = Blueprint("sm", __name__)

# key, name, first row, last row, cabin lead (demo names)
CABINS = [
    ("fwd", "Forward cabin", 1, 8, "Meera Iyer"),
    ("mid", "Middle cabin", 9, 17, "Rohan Das"),
    ("aft", "Aft cabin", 18, 25, "Anita Rao"),
]
LETTERS = "ABCDEF"

# Meals that need care. "critical" shows a red mark on the seat and counts as an alert.
# Every meal in this table also gets a handling note in the seat details drawer.
CARE = {
    "nutfree": ("critical", "Nut allergy", "Serve the sealed nut-free meal. Keep it away from nut snacks. Never swap it."),
    "gluten": ("critical", "Gluten allergy", "Rice-based meal only. Do not serve bread rolls with it. Never swap it."),
    "jain": ("critical", "Strict Jain", "No onion, garlic or root vegetables. Never swap it for another meal."),
    "diabetic": ("note", "Diabetic", "Low-sugar meal. Skip the dessert and the sugary drink."),
    "lowsodium": ("note", "Low sodium", "No pickle or papad. Keep salt sachets away."),
    "child": ("note", "Child meal", "Check with the parent before serving."),
    "navratri": ("note", "Fasting", "Vrat meal with rock salt. No grains, onion or garlic."),
    "ekadashi": ("note", "Fasting", "Fruit and light dishes with rock salt. No grains or pulses."),
    "ramzan": ("note", "Ramzan", "Serve at sunset or before dawn, as planned."),
    "sattvik": ("note", "Sattvik", "No onion, garlic, meat, eggs or alcohol."),
    "halal": ("note", "Halal", "Keep it separate from the other non-vegetarian trays."),
}

SOURCES = {"booking": "Booking", "whatsapp": "WhatsApp", "website": "Website", "late_request": "Late change"}


def _crew_only(view):
    """Require the crew identity; passenger and crew identities may share a browser session."""
    def wrapper(*args, **kwargs):
        if not (session.get("staff_id") and session.get("staff_name")):
            return redirect(url_for("staff_login"))
        return view(*args, **kwargs)
    wrapper.__name__ = view.__name__
    return wrapper


def _stamp(iso):
    if not iso:
        return None
    try:
        dt = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return f"{fmt_day(dt)}, {fmt_time(dt)}"


@bp.get("/crew/seatmap/data")
@_crew_only
def data():
    conn = db.connect()
    try:
        flight = conn.execute("SELECT number, rows FROM flights WHERE id = 1").fetchone()
        meals = conn.execute("SELECT code, name, color, description FROM meals ORDER BY sort").fetchall()
        people = conn.execute(
            """SELECT p.id, p.pnr, p.first_name, p.last_name, p.seat,
                      p.meal_code, p.meal_source, p.meal_updated_at,
                      dc.dish_code,
                      (SELECT e.note FROM meal_events e
                       WHERE e.passenger_id = p.id AND e.new_meal = p.meal_code
                       ORDER BY e.id DESC LIMIT 1) AS meal_note,
                      ms.meal_code AS service_meal_code, ms.dish_code AS service_dish_code,
                      ms.status AS raw_service_status, ms.updated_at AS service_updated_at,
                      ms.updated_by AS service_updated_by,
                      xp.id AS exchange_purchase_id, xp.dish_code AS exchange_dish_code,
                      xp.meal_code AS exchange_meal_code, xp.amount_paid AS exchange_amount_paid,
                      xp.service_status AS exchange_service_status,
                      xp.updated_at AS exchange_updated_at,
                      xp.updated_by AS exchange_updated_by
               FROM passengers p
               LEFT JOIN passenger_dish_choices dc
                 ON dc.passenger_id = p.id AND dc.meal_code = p.meal_code
               LEFT JOIN passenger_meal_service ms
                 ON ms.passenger_id = p.id AND ms.flight_id = p.flight_id
               LEFT JOIN meal_exchange_purchases xp
                 ON xp.id = (SELECT MAX(x2.id) FROM meal_exchange_purchases x2
                             WHERE x2.buyer_passenger_id = p.id AND x2.status = 'purchased')
               WHERE p.flight_id = 1""").fetchall()
    finally:
        conn.close()

    rows = flight["rows"]
    by_seat = {p["seat"]: p for p in people}
    counts = {}
    seats = []
    for r in range(1, rows + 1):
        for letter in LETTERS:
            seat = f"{r}{letter}"
            p = by_seat.get(seat)
            if p is None:
                seats.append({"seat": seat, "row": r, "col": letter, "empty": True})
                continue
            code = p["meal_code"]
            if code:
                counts[code] = counts.get(code, 0) + 1
            care = CARE.get(code)
            selected_dish = pf.dish_by_code(p["dish_code"])
            if selected_dish and selected_dish["meal_code"] != code:
                selected_dish = None
            # Ignore stale service state if a dish was changed after an earlier service event.
            service_matches_current = (p["service_meal_code"] == code and p["service_dish_code"] == (p["dish_code"] or pf.default_dish(code)))
            service_status = p["raw_service_status"] if service_matches_current else None
            exchange_dish = pf.dish_by_code(p["exchange_dish_code"])
            seats.append({
                "seat": seat, "row": r, "col": letter, "empty": False,
                "passenger_id": p["id"], "name": f"{p['first_name']} {p['last_name']}", "first": p["first_name"], "pnr": p["pnr"],
                "meal": code, "dish_name": selected_dish["name"] if selected_dish else None,
                "note": p["meal_note"] or "",
                "source": SOURCES.get(p["meal_source"], None),
                "at": _stamp(p["meal_updated_at"]),
                "service_status": service_status or "pending",
                "service_updated_at": _stamp(p["service_updated_at"]) if service_matches_current else None,
                "service_updated_by": p["service_updated_by"] if service_matches_current else None,
                "exchange_purchase": ({
                    "id": p["exchange_purchase_id"],
                    "dish_name": exchange_dish["name"] if exchange_dish else "Meal exchange",
                    "meal_code": p["exchange_meal_code"],
                    "amount_paid": p["exchange_amount_paid"],
                    "status": p["exchange_service_status"] or "pending",
                    "updated_at": _stamp(p["exchange_updated_at"]),
                    "updated_by": p["exchange_updated_by"],
                } if p["exchange_purchase_id"] else None),
                "alert": bool(care and care[0] == "critical"),
                "care": {"level": care[0], "title": care[1], "tip": care[2]} if care else None,
            })

    feedback_conn = db.connect()
    try:
        operation = feedback_conn.execute("SELECT on_flight_mode FROM flight_operations WHERE flight_id = 1").fetchone()
        mode_enabled = bool(operation and operation["on_flight_mode"])
        base_buffer = 0
        try:
            plan_fn = current_app.extensions.get("skybite_forecast_stock_plan")
            flight_fn = current_app.extensions.get("skybite_flight_from_conn")
            if plan_fn and flight_fn:
                full_flight = flight_fn(feedback_conn, 1)
                plan = plan_fn(feedback_conn, full_flight)
                pax_total = int(feedback_conn.execute("SELECT COUNT(*) FROM passengers WHERE flight_id = 1").fetchone()[0])
                base_buffer = max(0, sum(int(v) for v in plan.values()) - pax_total)
        except Exception:
            base_buffer = 0
        service_feedback = onflight.service_feedback_summary(feedback_conn, 1, base_buffer)
    finally:
        feedback_conn.close()
    return jsonify({
        "flight": flight["number"],
        "on_flight_mode": mode_enabled,
        "service_feedback": service_feedback,
        "rows": rows,
        "cabins": [{"key": k, "name": n, "first": a, "last": min(b, rows), "lead": lead} for k, n, a, b, lead in CABINS],
        "meals": [{"code": m["code"], "name": m["name"], "color": m["color"], "about": m["description"],
                   "count": counts.get(m["code"], 0)} for m in meals],
        "seats": seats,
    })


def init_app(app):
    """The one line app.py needs: seatmap.init_app(app)"""
    app.register_blueprint(bp)
