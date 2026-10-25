# SkyBite (Parts 1 and 2: website, WhatsApp phone page)

## Run it on Windows
1. Install Python from https://www.python.org/downloads/ . On the first screen, tick **Add python.exe to PATH**.
2. Unzip this folder. Double-click **run.bat**. A black window opens and stays open while the site runs.
3. Open http://localhost:5000 in Chrome.

To stop the site, close the black window.


## V11: 3D sky + new meal picker
Signed-in page is rebuilt: `templates/passenger_home.html`, `static/css/passenger.css`, `static/js/passenger.js` (Three.js is bundled in `static/js/vendor/`, no internet needed for it). A 3D cloud sky flies forward as you scroll and shifts from daylight to dusk; a 3D plane follows the route in the pinned hero; the menu is a 3D horizontal carousel driven by vertical scroll; meals are chosen in a full-size picker panel. Login, crew and WhatsApp pages are unchanged.

## V13: 2D plane + living sky
The 3D plane and Three.js are gone. A crisp SVG airliner (`templates/_plane.html`) flies the Delhi to Mumbai route as you scroll, with a contrail and a shadow that grows as it climbs. A small plane also rides the thin flight bar under the top bar for the whole page. The background is the cloud photo colour-graded by a sky gradient that moves from daylight to golden hour to dusk to night, with drifting 2D cloud layers on a canvas. Menu cards glide sideways with a flat scale-and-lift effect, so the plates never clip. Nothing is pinned.

## V18: Late meal change approval workflow

Late changes can be demonstrated from both the passenger website and WhatsApp simulator. The four-hour kitchen cutoff is shown on the passenger booking page and is based on the demo flight departure. Before cutoff, a selected meal updates normally. After cutoff, selecting a meal creates a **pending request**; it does not overwrite the passenger’s confirmed meal.

On the crew dashboard, stay in **Seat Plan** and use **Live Activity → Late meal requests**. Crew can:
- **Approve** a request when the frozen forecast-based planned stock has an unassigned unit.
- **Decline** with a short reason, leaving the current meal unchanged.
- **Offer alternative** from an actually available meal in the flight’s menu. The chosen unit is held while the passenger decides; accepting updates the meal, while declining releases the hold.

Statuses sync back to the passenger booking page, and an existing WhatsApp chat receives a decision message. The meal breakdown and Demand Forecast reflect an approved change. The demo stock snapshot is derived from the forecast plan and is an illustrative stock proxy—not a live connection to an airline caterer’s physical inventory. For a quick demo, sign in to `/staff` (`SB1001` / `crew123`) and use the timeline controls in order: **Jump to 48-hour reminder**, **Jump to 6-hour WhatsApp reminder** (two hours left to choose), then **Close meal selection at 4 hours**. The WhatsApp simulator receives a distinct message at each stage. At the four-hour cutoff, normal choices close; late changes go to crew review. Submit a meal change from the passenger page or tap **Choose meal** in the WhatsApp simulator, then review it under **Live Activity → Late meal requests**. Reset demo data before rehearsals.

## V17: Premium forecast table + interactive waste-avoidance chart
The Demand Forecast table has refined spacing, clearer value hierarchy, smoother row entrances, more legible demand bars, and calmer hover states. The historical comparison chart now labels the meal unit and each point, marks the value-to-baseline distance, and lets crew hover, focus, or tap a point to compare the flat 15% buffer with SkyBite’s targeted buffer and the estimated difference. On narrow screens, the chart can be swiped horizontally rather than shrinking flight labels to unreadable sizes. The total remains an illustrative estimate based on seeded sample records, not verified food waste or a measured reduction in waste. Animations respect `prefers-reduced-motion`.

## V16: Polished forecast table + waste-avoidance trend
The Demand Forecast table now has a clearer loading-plan header, a small visual key, staggered row entrances, demand-share bars, and highlighted preparation totals. A compact animated line chart compares the targeted buffer against a simple flat 15% buffer on each of the ten illustrative reference flights. The chart reports **potential overstock avoided**, not measured meals saved: actual food waste savings can only be confirmed by recording post-flight leftovers and consumption.

## V15: Separate Seat Plan + Demand Forecast workspaces
The crew dashboard now has two independent sections. **Seat Plan** retains the existing cabin map, live updates, meal breakdown, service snapshot and demo controls. **Demand Forecast** is a separate tab with a meal-by-meal table, confirmed choices, estimated choices from undecided passengers, the previous-flight meal mix, and final preparation quantities.

The forecast uses the historical meal-choice mix to distribute undecided passengers as a group. To make the hackathon demo work end to end, the database includes **sample reference data for four Navratri flights and six regular DEL–BOM flights**. The interface explicitly labels this as sample history; it is not real airline operating data and should be replaced by actual history before operational use.

The transparent buffer rule is calculated flight-wide, then allocated to meal rows so the total never grows from repeatedly rounding each row up:
- **Standard safety stock:** 5% of total forecast demand, rounded up once for the flight.
- **Festival reserve:** 10% of forecast demand for meal options aligned with an active festival, rounded up once and allocated only across those options.

No extra meal is added just because a meal category exists. Each row shows its current count, estimate from undecided passengers, forecast demand, buffer breakdown and preparation total. This is a planning estimate based on sample demand mix, not a trained predictive model.

## Older design notes (V10) — V10 full-page cloudscape + scroll-linked route

The interface uses a premium aviation-and-food identity: midnight navy, brushed champagne accents, expressive editorial typography, controlled glass surfaces, subtle lighting, and real food imagery. Motion is layered and purposeful rather than applied to every element.

- Passenger sign-in keeps the booking form and food-led hero clear and usable; it does not contain the airplane scroll animation. After a passenger signs in, a continuous fixed cloudscape remains behind the full passenger page. The aircraft follows the dotted route as the user naturally scrolls past the hero; the page is never pinned or scroll-locked, and route progress is updated with one requestAnimationFrame callback per scroll frame.
- The signed-in passenger page has an animated Delhi-to-Mumbai-style route panel, flight detail chips, seasonal meal notice, traveller-specific meal status, and expandable meal selection. The displayed route labels come from the current flight data.
- Meal choices use inline SVG food illustrations, hover depth, keyboard focus states, selected states, and a clear save action.
- Crew operations uses a purpose-built flight overview, count-up metrics, animated demand bars, service summary, and collapsible demo tools.
- The phone simulator keeps WhatsApp’s familiar light chat appearance: deep green header, pale doodle wallpaper, white incoming bubbles, pale-green outgoing bubbles, and a light composer. It includes animated messages, meal-option cards in a bottom sheet, and a hideable briefing panel; the functional simulator and server-side sync remain at `/whatsapp`.
- The signed-in passenger experience uses a natural scroll sequence: atmospheric flight hero, curated meal showcase, traveller-specific meal selection, flight details and a warm closing call-to-action. Individual sections reveal on entry, meal cards lift slightly on hover, and the route and aircraft respond to natural scroll progress without pinning the page.
- Motion includes staggered section reveals, scroll-linked route/aircraft movement, count-up metrics, demand bars that draw when their panels enter view, subtle pointer lighting, meal-card feedback, and polished button states. Scrolling is never hijacked or pinned. It honours `prefers-reduced-motion`; controls remain usable without decorative effects.

## The three parts
| Part | Address | Login |
|---|---|---|
| Passenger website | http://localhost:5000 | PNR `VM4K9Z`, last name `Mehta` |
| Crew + kitchen dashboard | http://localhost:5000/staff | `SB1001` / `crew123` |
| Passenger's phone (WhatsApp simulator) | http://localhost:5000/whatsapp | none |

The staff and phone pages are not linked from the passenger website on purpose.
Passenger and staff identities now persist independently in the same browser session, so you can keep the passenger booking and crew dashboard open in separate tabs without signing each other out. Signing out of one workspace leaves the other signed in. The session cookie persists through refresh and for up to seven days unless you sign out; don't use this convenience setting on a shared public computer.

## Demo in 5 steps
1. Open the phone page on a second phone or laptop. It is empty: the airline writes first.
2. Sign in to the crew dashboard. Under **Demo controls**, click **Fast-forward to 48 hours before**.
3. The message "Hey Varun, how are you?" appears on the phone by itself.
4. On the phone: **Choose meal**, pick **Varun**, **See meal options**, choose **Navratri vrat thali**, **Send**. You can also type, for example `Neha is fasting for navratri`.
5. Refresh the crew dashboard (counts change) and the passenger website (the meal shows "Updated on WhatsApp"). Change a meal on the website and a message appears on the phone.

**Reset demo data** on the crew dashboard puts the clock, meals and messages back at the start. Do this before every rehearsal.

## Open it on a real phone
Phone and laptop on the same Wi-Fi (or the laptop's hotspot). Find the laptop's IP with `ipconfig` (IPv4 address), then open `http://<that-ip>:5000/whatsapp` on the phone. If it does not load, allow Python through Windows Firewall when asked.

## Files
- `app.py` routes, logins, role checks, fast-forward, phone endpoints
- `chat.py` all the WhatsApp conversation logic (the message, the who/which-meal steps, typed text)
- `db.py` tables and demo data (flight, 138 passengers, meal choices, festival calendar and clearly labelled sample historical meal counts)
- `templates/` pages, `static/css/` all the design, `static/js/phone.js` the phone page

## For the pitch
- Passenger and crew pages are separated on the server. Each protected request checks that the matching passenger or crew identity is present; missing identity redirects to that workspace’s login. Both identities may coexist in one browser session.
- A passenger can only change meals on their own booking. The phone page re-checks every tap on the server, so a forged request changes nothing.
- Festival meals appear only if the flight date falls in the festival calendar.
- The phone page is a simulator. Production would send the same messages through the WhatsApp Business API using approved message templates and passenger opt-in.
- Typed messages are understood with keyword rules (for example "peanut" gives nut-free). An AI model is the planned upgrade for free-text understanding.
- Set `DEMO_HINTS = False` in app.py to hide the demo login shortcuts.


## V19: Four-hour cutoff + staged WhatsApp reminders + persistent workspaces

Normal meal selection now closes four hours before departure. The crew demo timeline sends three once-per-booking WhatsApp simulator messages: the 48-hour planning reminder, a six-hour last call saying selection closes in two hours, and a four-hour cutoff notice explaining that late requests need crew approval. Each stage has its own demo control and sent status; run them in order for the clearest presentation. These are simulated WhatsApp messages in the local project; a production rollout would connect the same events to an approved WhatsApp Business API/provider and a scheduler.

Passenger and crew login state is now stored under separate keys within the signed Flask session. Refreshing either page keeps that workspace signed in, and one browser can hold the passenger and crew workspaces concurrently. Sign-out is scoped to the active workspace. The locally persisted secret key keeps sessions valid across local server restarts.

## V20: Passenger language selector + specific dish selections
The passenger booking page now includes the language selector from the parallel passenger branch (English, Hindi, Bengali, Marathi, Telugu, Tamil and Japanese). The selected language is saved in the passenger session and applies to the passenger page and meal-picker interface; food and dish names remain in their recognizable menu language.

Passengers choose both a broad catering category and one specific dish, for example **Vegetarian → Paneer Bhurji** or **Vegetarian → Paneer Paratha**. The dish code is persisted separately from the catering category. The exact dish is carried into normal meal changes and post-cutoff late-change requests, while the broad category remains the unit used by the current forecast and planned-stock proxy. If the WhatsApp simulator receives a category-only meal button, it assigns the menu's default dish for that category and keeps the dish/category data aligned.

In the crew dashboard's **Seat Plan**, click a category such as Vegetarian to expand its live dish breakdown. Each dish row shows how many passengers chose that exact item, with animated share bars. Live Activity shows the previous and requested dishes for late requests, lets crew approve/decline or offer a specific dish alternative, and synchronizes the selected dish back to the passenger booking after approval/acceptance. The current stock proxy is tracked by broad category rather than independently by each dish, so it should not be treated as a real caterer's item-level inventory feed.

## V21: passenger notes become crew Live Activity alerts

The passenger meal picker now reveals an optional short note field after a specific dish is selected (160 characters maximum). For normal website meal updates, the note is saved with the meal event and appears as a highlighted **Passenger note · alert** in the crew Live Activity feed, including the new-activity toast. For post-cutoff changes, the note is saved on the late request and appears at the top of its crew-review card and in a new-request toast. The note is carried forward when a late request is approved or an offered alternative is accepted. Existing demo databases are migrated automatically to add the optional note columns.

On the passenger traveller cards, the small green status label reads **MEAL CHOSEN** when a meal is confirmed and **MEAL NOT CHOSEN** when no meal has been selected; the chosen dish itself remains visible in the card details. The optional note is a short request to the crew, not a guarantee of service or a substitute for formal allergy/disability notification procedures.

## V22: Reversible meal picker + stable live dish breakdown

The passenger meal picker now has explicit steps: choose a meal category, choose a specific dish, optionally add the crew note, and save. Passengers can return to the category list at any time; if reopening an existing meal, the current category/dish is preselected and a visible “Continue to dishes” action lets them proceed without needing to click an already-selected radio. The footer stays pinned and the Save action is visibly labelled on mobile; Save is disabled only until a valid dish has been selected.

The crew meal breakdown keeps its current row order stable during 2-second live polling. Counts and bars update in place, while open dish-detail rows remain mounted unless their data actually changes. This prevents the detail panel’s entrance animation from restarting or flickering on every poll.


## V24: On-flight delivery tracking + discounted meal exchange

The staff Seat Plan has an **On-flight mode** switch. While it is enabled, opening a passenger seat reveals actions to mark the selected dish **Delivered**, **Not delivered**, or release an undelivered/canceled meal as a single-use offer for another passenger at **20% off**. Seat markers and the on-flight counters update through the existing live seat-map data poll. Releasing a meal is serialized on the server to prevent double offers from rapid or simultaneous crew clicks. A meal already marked delivered cannot be canceled and resold.

When a meal is released, signed-in passenger pages poll the exchange feed while open and show an animated new-offer notification/card with the specific dish, original price, discounted price, and savings. The first purchase wins; the server serializes claims so the same meal cannot be sold twice. To keep crew delivery tracking unambiguous, each passenger may have only one discounted exchange purchase awaiting a delivery outcome at a time. Crew marks that exchange order delivered/not delivered from the buyer's seat drawer. Turning off On-flight mode expires any unclaimed offers.

The demo prices in `onflight.py` are illustrative INR prices. The Buy action records a simulated purchase only; it does not charge a card or move money. The exchange and stock counts use SkyBite's demo meal categories and specific-dish selections, not a caterer's real inventory feed.

The **Learning from cabin service** panel uses recorded outcomes as a next-flight planning signal. A not-delivered meal can raise the recommended buffer; an expired/unclaimed canceled meal can lower it; meals resold through exchange are considered reassigned rather than waste. The signal is capped at 30% of the existing buffer and requires at least four closed outcomes. Staff should review the reason for a missed delivery before applying the guidance, and the current flight's loaded stock is never changed automatically.
