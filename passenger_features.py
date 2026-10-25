"""Passenger language and dish-level selection support for SkyBite.

The broad meal category remains the catering category, while each passenger's
specific dish is recorded separately and carried through late-change decisions.
"""
import json
from datetime import datetime, timedelta

from flask import Blueprint, abort, jsonify, request, session

import db

passenger_features = Blueprint("passenger_features", __name__)

SUPPORTED_LANGUAGES = {"en", "hi", "bn", "mr", "te", "ta", "ja"}
MEAL_PREFERENCES = {
    "navratri-vrat-thali", "strict-jain", "sattvik", "halal-non-vegetarian",
    "vegetarian", "non-vegetarian", "child-meal-standard", "diabetic-friendly",
    "low-sodium", "nut-free", "gluten-free",
}

# Each dish belongs to one existing catering category. The category is still used
# for stock planning; the dish is the passenger-facing choice shown to the crew.
DISH_CATALOG = {
    "navratri": [
        {"code": "sabudana-sweet-potato-tikkis", "name": "Sabudana & Sweet Potato Tikkis", "description": "A fasting-friendly savoury bite with rock salt."},
        {"code": "baked-samak-rice-arancini-balls", "name": "Baked Samak Rice Arancini Balls", "description": "Light baked samak rice bites for vrat meals."},
        {"code": "paneer-makhana-mini-patties", "name": "Paneer & Makhana Mini Patties", "description": "Soft paneer and makhana patties."},
        {"code": "sweet-potato-halwa-bites", "name": "Sweet Potato Halwa Bites", "description": "A small naturally sweet festival dessert."},
        {"code": "singhare-atta-paneer-rolls", "name": "Singhare Atta Paneer Rolls", "description": "Paneer rolls made with water-chestnut flour."},
        {"code": "creamy-curd-rice-pomegranate", "name": "Creamy Curd Rice with Pomegranate", "description": "Cooling curd rice finished with pomegranate."},
    ],
    "ekadashi": [
        {"code": "ekadashi-fruit-makhana-bowl", "name": "Fruit & Makhana Bowl", "description": "Fresh fruit with roasted makhana."},
        {"code": "ekadashi-rock-salt-potato-box", "name": "Rock-Salt Potato & Fruit Box", "description": "A light potato and fruit fasting box."},
        {"code": "ekadashi-sweet-potato-bites", "name": "Sweet Potato Fasting Bites", "description": "Small sweet-potato bites with rock salt."},
    ],
    "ramzan": [
        {"code": "ramzan-dates-fruit-chaat", "name": "Dates & Fruit Chaat", "description": "Dates and fresh fruit for iftar or suhoor."},
        {"code": "ramzan-halal-chicken-keema-roll", "name": "Halal Chicken Keema Roll", "description": "A mild halal chicken roll."},
        {"code": "ramzan-chicken-rice-box", "name": "Chicken & Rice Iftar Box", "description": "A warm, filling halal-style chicken and rice meal."},
    ],
    "jain": [
        {"code": "strict-jain-mini-paneer-sweet-corn-parathas", "name": "Mini Paneer & Sweet Corn Parathas", "description": "Small parathas with paneer and sweet corn."},
        {"code": "strict-jain-banana-cheese-toast-soldiers", "name": "Banana & Cheese Toast Soldiers", "description": "Easy-to-hold toast fingers."},
        {"code": "strict-jain-raw-banana-green-pea-tikkis", "name": "Raw Banana & Green Pea Tikkis", "description": "Mild banana and pea patties."},
        {"code": "strict-jain-sweet-corn-fried-rice-wheels", "name": "Sweet Corn Fried Rice Wheels", "description": "Mild rice bites with sweet corn."},
        {"code": "strict-jain-makhana-paneer-mini-pops", "name": "Makhana & Paneer Mini Pops", "description": "Bite-sized makhana and paneer."},
        {"code": "strict-jain-creamy-tomato-corn-pasta-wheels", "name": "Creamy Tomato-Corn Pasta Wheels", "description": "Pasta wheels with a mild tomato-corn sauce."},
    ],
    "sattvik": [
        {"code": "sattvik-moong-dal-khichdi-ghee", "name": "Moong Dal Khichdi with Ghee", "description": "Soft khichdi cooked with a little ghee."},
        {"code": "sattvik-mini-spinach-curd-parathas", "name": "Mini Spinach & Curd Parathas", "description": "Soft spinach and curd parathas."},
        {"code": "sattvik-sweet-corn-green-pea-pulao", "name": "Sweet Corn & Green Pea Pulao", "description": "Light pulao with sweet corn and peas."},
        {"code": "sattvik-paneer-oats-mini-idlis", "name": "Paneer & Oats Mini Idlis", "description": "Soft mini idlis with oats and paneer."},
        {"code": "sattvik-apple-cinnamon-oats-porridge", "name": "Apple & Cinnamon Oats Porridge", "description": "Warm porridge with apple and cinnamon."},
        {"code": "sattvik-makhana-kheer-pops", "name": "Makhana Kheer Pops", "description": "A small milk-based makhana dessert."},
    ],
    "halal": [
        {"code": "halal-mild-chicken-keema-roll", "name": "Mild Halal Chicken Keema Roll", "description": "Mildly spiced halal chicken in a soft wrap."},
        {"code": "halal-baked-chicken-nuggets", "name": "Baked Halal Chicken Nuggets", "description": "Oven-baked halal chicken bites."},
        {"code": "halal-shredded-chicken-mayo-sandwich", "name": "Shredded Halal Chicken Mayo Sandwich", "description": "Shredded chicken in a soft sandwich."},
        {"code": "halal-mild-chicken-shami-kebabs", "name": "Mild Halal Chicken Shami Kebabs", "description": "Small, mildly seasoned chicken kebabs."},
        {"code": "halal-chicken-cheese-meatballs", "name": "Halal Chicken & Cheese Meatballs", "description": "Small chicken and cheese meatballs."},
        {"code": "halal-mild-chicken-biryani", "name": "Mild Halal Chicken Biryani", "description": "A mild chicken biryani with rice."},
    ],
    "veg": [
        {"code": "paneer-bhurji", "name": "Paneer Bhurji", "description": "Scrambled paneer with gentle spices."},
        {"code": "paneer-paratha", "name": "Paneer Paratha", "description": "A soft paneer-stuffed paratha."},
        {"code": "paneer-butter-masala", "name": "Paneer Butter Masala", "description": "Paneer in a creamy tomato-cashew gravy."},
        {"code": "palak-paneer", "name": "Palak Paneer", "description": "Paneer simmered in spinach gravy."},
        {"code": "dal-makhani", "name": "Dal Makhani", "description": "Slow-cooked black lentils and kidney beans."},
        {"code": "aloo-gobi", "name": "Aloo Gobi", "description": "Potato and cauliflower curry."},
        {"code": "chole-masala", "name": "Chole Masala", "description": "Chickpea curry with warming spices."},
        {"code": "malai-kofta", "name": "Malai Kofta", "description": "Vegetable or paneer dumplings in creamy gravy."},
    ],
    "nonveg": [
        {"code": "mild-chicken-shami-kebabs", "name": "Mild Chicken Shami Kebabs", "description": "Soft, mildly spiced chicken kebabs."},
        {"code": "chicken-cheese-meatballs", "name": "Chicken & Cheese Meatballs", "description": "Chicken meatballs with a cheese centre."},
        {"code": "egg-white-frittata-bites", "name": "Egg White Frittata Bites", "description": "Small frittata bites made with egg whites."},
        {"code": "mild-chicken-biryani", "name": "Mild Chicken Biryani", "description": "Chicken and rice with a gentle spice blend."},
        {"code": "egg-fried-rice-wheels", "name": "Egg Fried Rice Wheels", "description": "Fried rice with egg in bite-sized portions."},
        {"code": "shredded-chicken-mayo-sandwich", "name": "Shredded Chicken Mayo Sandwich", "description": "A soft sandwich with shredded chicken."},
        {"code": "chicken-keema-paratha-roll", "name": "Chicken Keema Paratha Roll", "description": "Spiced chicken keema rolled in paratha."},
        {"code": "butter-chicken", "name": "Butter Chicken", "description": "Tender chicken in a creamy tomato-butter gravy."},
    ],
    "diabetic": [
        {"code": "diabetic-oat-ragi-mini-idlis", "name": "Oat & Ragi Mini Idlis", "description": "Whole-grain mini idlis with no added sugar."},
        {"code": "diabetic-paneer-besan-chilla-strips", "name": "Paneer & Besan Chilla Strips", "description": "Besan chilla strips with paneer filling."},
        {"code": "diabetic-moong-dal-spinach-tikkis", "name": "Moong Dal & Spinach Tikkis", "description": "Moong and spinach patties."},
        {"code": "diabetic-roasted-chana-seed-mix-pops", "name": "Roasted Chana & Seed Mix Pops", "description": "A savoury roasted chana and seed mix."},
        {"code": "diabetic-sprouted-moong-sweet-corn-salad", "name": "Sprouted Moong & Sweet Corn Salad", "description": "A fresh bowl of sprouts and sweet corn."},
        {"code": "diabetic-egg-vegetable-quiche-bites", "name": "Egg & Vegetable Quiche Bites", "description": "Crustless quiche with egg and vegetables."},
        {"code": "diabetic-quinoa-vegetable-upma-bites", "name": "Quinoa & Vegetable Upma Bites", "description": "Small quinoa and vegetable upma portions."},
        {"code": "diabetic-baked-ragi-spinach-crackers", "name": "Baked Ragi & Spinach Crackers", "description": "Baked ragi crackers with spinach."},
        {"code": "diabetic-cottage-cheese-skewers", "name": "Grilled Cottage Cheese Skewers", "description": "Grilled paneer skewers with mint."},
        {"code": "diabetic-zucchini-egg-muffins", "name": "Zucchini & Egg Muffins", "description": "Small savoury egg and zucchini muffins."},
        {"code": "diabetic-yellow-moong-lentil-pancakes", "name": "Yellow Moong Lentil Mini Pancakes", "description": "Small lentil pancakes."},
        {"code": "diabetic-avocado-cucumber-rollups", "name": "Avocado & Cucumber Roll-Ups", "description": "Fresh avocado and cucumber roll-ups."},
    ],
    "lowsodium": [
        {"code": "low-sodium-herb-grilled-paneer", "name": "Herb-Grilled Paneer Cubes", "description": "Paneer with herbs, lemon and coriander."},
        {"code": "low-sodium-green-pea-pulao", "name": "Green Pea Pulao", "description": "Plain green pea pulao with light seasoning."},
        {"code": "low-sodium-makhana-coconut-pops", "name": "Unsalted Makhana & Coconut Pops", "description": "A lightly toasted, unsalted snack."},
        {"code": "low-sodium-fresh-fruit-salad", "name": "Fresh Fruit Salad", "description": "Fresh fruit with mint zest."},
        {"code": "low-sodium-egg-scramble-rolls", "name": "No-Salt Egg Scramble Rolls", "description": "Egg scramble in a soft roll."},
        {"code": "low-sodium-sweet-potato-corn-mash", "name": "Sweet Potato & Corn Mash", "description": "A soft sweet-potato and corn side."},
    ],
    "nutfree": [
        {"code": "nutfree-makhana-sunflower-banana-sandwich", "name": "Makhana & Banana Sandwich", "description": "A banana sandwich with sunflower seed spread; verify cross-contact controls."},
        {"code": "nutfree-herb-rice-bowl", "name": "Herb Rice & Vegetable Bowl", "description": "A rice-based option prepared with allergen controls."},
        {"code": "nutfree-fruit-yogurt-cup", "name": "Fruit & Yogurt Cup", "description": "A simple fruit and yogurt cup."},
    ],
    "gluten": [
        {"code": "glutenfree-neer-dosa-paneer", "name": "Neer Dosa with Paneer Filling", "description": "Rice-flour crepes with a mild filling; cross-contact must be checked."},
        {"code": "glutenfree-rice-vegetable-pulao", "name": "Rice & Vegetable Pulao", "description": "A rice-based vegetable meal."},
        {"code": "glutenfree-potato-curd-bowl", "name": "Potato & Curd Bowl", "description": "A light potato bowl served with curd."},
    ],
    "child": [
        {"code": "child-cheese-tomato-pasta-wheels", "name": "Mild Cheese & Tomato Pasta Wheels", "description": "Mild pasta with cheese and tomato."},
        {"code": "child-potato-paneer-burgers", "name": "Mini Potato & Paneer Burgers", "description": "Small paneer patties in mini buns."},
        {"code": "child-banana-pancakes-honey", "name": "Banana Pancakes with Honey", "description": "Soft pancakes with banana and honey."},
        {"code": "child-macaroni-sweet-corn", "name": "Creamy Macaroni & Sweet Corn", "description": "Creamy macaroni with sweet corn."},
        {"code": "child-baked-smileys-yogurt-dip", "name": "Baked Smileys with Yogurt Dip", "description": "Baked potato bites with a yogurt dip."},
        {"code": "child-fruit-skewers", "name": "Bite-Sized Fruit Skewers", "description": "Fresh fruit in small, easy-to-hold pieces."},
    ],
}

DISH_TO_MEAL = {dish["code"]: meal_code for meal_code, dishes in DISH_CATALOG.items() for dish in dishes}
DISH_BY_CODE = {dish["code"]: {**dish, "meal_code": meal_code}
                for meal_code, dishes in DISH_CATALOG.items() for dish in dishes}
DEFAULT_DISH_BY_MEAL = {meal_code: dishes[0]["code"] for meal_code, dishes in DISH_CATALOG.items()}


def is_passenger_session():
    """This app supports passenger and crew identities in parallel browser tabs."""
    return bool(session.get("pnr") and session.get("pax_id"))


def dish_by_code(code):
    return DISH_BY_CODE.get(code or "")


def dish_label(code):
    dish = dish_by_code(code)
    return dish["name"] if dish else "Specific dish not selected"


def dish_for_meal(code, dish_code):
    dish = dish_by_code(dish_code)
    return dish if dish and dish["meal_code"] == code else None


def default_dish(code):
    return DEFAULT_DISH_BY_MEAL.get(code)


def save_current_dish(conn, passenger_id, meal_code, dish_code, stamp, source="website"):
    """Record the current, confirmed specific dish for a passenger."""
    if meal_code not in DISH_CATALOG:
        return
    if not dish_for_meal(meal_code, dish_code):
        dish_code = default_dish(meal_code)
    conn.execute(
        """INSERT INTO passenger_dish_choices (passenger_id, meal_code, dish_code, updated_at, source)
           VALUES (?,?,?,?,?) ON CONFLICT(passenger_id) DO UPDATE SET
           meal_code=excluded.meal_code, dish_code=excluded.dish_code,
           updated_at=excluded.updated_at, source=excluded.source""",
        (passenger_id, meal_code, dish_code, stamp, source),
    )


def current_dish(conn, passenger_id, meal_code=None):
    row = conn.execute("SELECT meal_code, dish_code FROM passenger_dish_choices WHERE passenger_id = ?",
                       (passenger_id,)).fetchone()
    if row and (meal_code is None or row["meal_code"] == meal_code):
        return row["dish_code"]
    return None


def reconcile_current_dishes(conn, source="whatsapp", stamp=None):
    """Keep dish-level selections aligned when legacy category-based channels update meals."""
    stamp = stamp or datetime.now().isoformat(timespec="seconds")
    people = conn.execute("SELECT id, meal_code FROM passengers WHERE meal_code IS NOT NULL").fetchall()
    for person in people:
        current = current_dish(conn, person["id"])
        if not dish_for_meal(person["meal_code"], current):
            save_current_dish(conn, person["id"], person["meal_code"],
                              default_dish(person["meal_code"]), stamp, source=source)


def dish_catalog_for_frontend():
    return {code: [{"code": item["code"], "name": item["name"], "description": item["description"]}
                   for item in items] for code, items in DISH_CATALOG.items()}


def _signed_in_booking_passenger(conn, passenger_id=None):
    if not is_passenger_session():
        abort(403)
    if not passenger_id:
        passenger_id = session.get("pax_id")
    row = conn.execute(
        "SELECT id, flight_id FROM passengers WHERE id = ? AND pnr = ?",
        (passenger_id, session.get("pnr")),
    ).fetchone()
    if row is None:
        abort(403)
    return row


@passenger_features.post("/passenger-features/language")
def save_language():
    if not is_passenger_session():
        abort(403)
    language = (request.form.get("language") or "").strip().lower()
    if language not in SUPPORTED_LANGUAGES:
        return jsonify(ok=False, error="Unsupported language"), 400
    session["pw_language"] = language
    return jsonify(ok=True, language=language)


@passenger_features.get("/passenger-features/dishes")
def get_dishes():
    if not is_passenger_session():
        abort(403)
    meal_code = (request.args.get("meal_code") or "").strip()
    if meal_code not in DISH_CATALOG:
        return jsonify(ok=False, error="No dishes for that meal category."), 404
    return jsonify(ok=True, meal_code=meal_code, dishes=DISH_CATALOG[meal_code])


@passenger_features.get("/passenger-features/meal-preferences")
def get_meal_preferences():
    if not is_passenger_session():
        abort(403)
    conn = db.connect()
    try:
        passenger = _signed_in_booking_passenger(conn)
        row = conn.execute("SELECT preferences FROM pw_meal_preferences WHERE passenger_id = ?",
                           (passenger["id"],)).fetchone()
        return jsonify(ok=True, preferences=json.loads(row["preferences"]) if row else [])
    finally:
        conn.close()


@passenger_features.post("/passenger-features/meal-preferences")
def save_meal_preferences():
    if not is_passenger_session():
        abort(403)
    raw = request.form.get("preferences", "[]")
    try:
        selected = json.loads(raw)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="Invalid preference list"), 400
    if not isinstance(selected, list) or any(not isinstance(item, str) for item in selected):
        return jsonify(ok=False, error="Invalid preference list"), 400
    selected = list(dict.fromkeys(selected))
    if any(item not in MEAL_PREFERENCES for item in selected):
        return jsonify(ok=False, error="Unsupported meal preference"), 400
    conn = db.connect()
    try:
        passenger = _signed_in_booking_passenger(conn)
        conn.execute(
            "INSERT INTO pw_meal_preferences (passenger_id, preferences, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(passenger_id) DO UPDATE SET preferences=excluded.preferences, updated_at=excluded.updated_at",
            (passenger["id"], json.dumps(selected), datetime.now().isoformat(timespec="seconds")),
        )
        conn.commit()
        return jsonify(ok=True, preferences=selected)
    finally:
        conn.close()


@passenger_features.get("/passenger-features/meal-selections")
def get_meal_selections():
    if not is_passenger_session():
        abort(403)
    conn = db.connect()
    try:
        passenger_id = request.args.get("pax_id", type=int) or session.get("pax_id")
        passenger = _signed_in_booking_passenger(conn, passenger_id)
        row = conn.execute("SELECT meal_code, dish_code, updated_at FROM passenger_dish_choices WHERE passenger_id = ?",
                           (passenger["id"],)).fetchone()
        return jsonify(ok=True, passenger_id=passenger["id"], meal_code=row["meal_code"] if row else None,
                       dish_code=row["dish_code"] if row else None,
                       dish_name=dish_label(row["dish_code"]) if row else None)
    finally:
        conn.close()


def _seed_demo_dishes(conn):
    """Give the fake starter passenger dataset illustrative product choices for the demo."""
    now_row = conn.execute("SELECT value FROM settings WHERE key='demo_now'").fetchone()
    stamp = now_row["value"] if now_row else datetime.now().isoformat(timespec="seconds")
    people = conn.execute("SELECT id, meal_code FROM passengers WHERE meal_code IS NOT NULL ORDER BY id").fetchall()
    for person in people:
        present = conn.execute("SELECT 1 FROM passenger_dish_choices WHERE passenger_id=?", (person["id"],)).fetchone()
        if present:
            continue
        options = DISH_CATALOG.get(person["meal_code"], [])
        if not options:
            continue
        # Deterministic variation so staff see an informative sample breakdown immediately.
        dish = options[(int(person["id"]) * 7) % len(options)]
        conn.execute(
            "INSERT OR IGNORE INTO passenger_dish_choices (passenger_id, meal_code, dish_code, updated_at, source) VALUES (?,?,?,?,?)",
            (person["id"], person["meal_code"], dish["code"], stamp, "demo"),
        )
    conn.commit()


def init_app(app):
    """Register feature endpoints and migrate existing demo DBs safely."""
    conn = db.connect()
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS pw_meal_preferences (
            passenger_id INTEGER PRIMARY KEY, preferences TEXT NOT NULL, updated_at TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS pw_meal_selections (
            passenger_id INTEGER PRIMARY KEY, preferences TEXT NOT NULL, dishes TEXT NOT NULL, updated_at TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS passenger_dish_choices (
            passenger_id INTEGER PRIMARY KEY REFERENCES passengers(id),
            meal_code TEXT NOT NULL REFERENCES meals(code), dish_code TEXT NOT NULL,
            updated_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'demo')""")
        late_cols = {row["name"] for row in conn.execute("PRAGMA table_info(late_meal_requests)")}
        for col in ("old_dish_code", "requested_dish_code", "alternative_dish_code"):
            if col not in late_cols:
                conn.execute(f"ALTER TABLE late_meal_requests ADD COLUMN {col} TEXT")
        event_cols = {row["name"] for row in conn.execute("PRAGMA table_info(meal_events)")}
        for col in ("old_dish_code", "new_dish_code"):
            if col not in event_cols:
                conn.execute(f"ALTER TABLE meal_events ADD COLUMN {col} TEXT")
        conn.commit()
        _seed_demo_dishes(conn)
    finally:
        conn.close()
    app.register_blueprint(passenger_features)

    @app.after_request
    def pw_clear_preferences_after_demo_reset(response):
        # The base demo reset rebuilds legacy tables. Clear feature data so reused passenger IDs
        # cannot inherit previous-language preferences or product selections, then reseed samples.
        if request.method == "POST" and request.endpoint == "reset_demo":
            conn = db.connect()
            try:
                for table in ("pw_meal_preferences", "pw_meal_selections", "passenger_dish_choices"):
                    conn.execute(f"DELETE FROM {table}")
                conn.commit()
                _seed_demo_dishes(conn)
            finally:
                conn.close()
        return response
