/* ============================================================
   Keystone – Hobby planner (front-end logic)
   Plain JavaScript, no framework.
   Flow: user input -> (AI function OR demo data) -> plan object
         -> save to localStorage -> render() draws the screen.
   ============================================================ */

/* ---------- 1. Constants and quick DOM helpers ---------- */
const STORAGE_KEY = "keystone.plans.v1"; // "v1" lets us change the data shape later without breaking old data
const MAX_SAVED = 6;                     // keep only the latest few plans so storage stays small
const $ = (id) => document.getElementById(id);

/* Demo plan from the design mockup. It lets judges see the whole app
   instantly, even with no internet or no AI key. */
const DEMO_PLAN = {
  hobby: "Wire and paper craft",
  budget: 1500,
  items: [
    { name: "Card board",         cost: 60,  why: "Base and backing for your paper pieces", owned: true },
    { name: "Transparent paper",  cost: 50,  why: "Gives a window / glass effect",          owned: true },
    { name: "1.5 mm copper wire", cost: 100, why: "Strong wire for the main frame",         owned: true },
    { name: "0.4 mm copper wire", cost: 60,  why: "Thin wire for details and tying",        owned: true },
    { name: "Glue",               cost: 170, why: "Sticks paper to card and wire",          owned: true },
    { name: "Foam",               cost: 50,  why: "Soft layer to stand pieces up",          owned: false },
    { name: "Masking tape",       cost: 40,  why: "Holds parts in place while glue dries",  owned: true }
  ],
  tips: [
    "Start with one small project, like a paper flower on a wire stem.",
    "Buy glue in a small tube first; test before buying more."
  ]
};

/* ---------- 2. State ---------- */
/* One single "state" object holds everything. render() only reads it.
   WHY: one source of truth means the screen can never disagree with the data. */
let state = { plans: [], activeId: null };

/* ---------- 3. localStorage (save / load) ---------- */
function loadState() {
  // try/catch: localStorage can be blocked (private mode) or hold broken JSON.
  // We must never crash the app because of that, so we just start fresh.
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.plans)) state = parsed;
    }
  } catch (e) { /* ignore: start with an empty state */ }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function activePlan() {
  return state.plans.find((p) => p.id === state.activeId) || null;
}

/* Add a plan at the front of the list and make it active. */
function addPlan(plan) {
  plan.id = String(Date.now()); // time in ms = simple unique id
  state.plans.unshift(plan);
  state.plans = state.plans.slice(0, MAX_SAVED);
  state.activeId = plan.id;
  saveState();
}

/* ---------- 4. The money / readiness math ----------
   WHY this is computed in the browser and NOT by the AI:
   - The checkboxes change every time the user taps, so the answer must update instantly (no waiting for a server).
   - AI models are sometimes wrong at arithmetic; plain JavaScript is always exact.
   - It costs zero API calls, so it works offline and never hits the free-tier limit.
   The AI only suggests WHAT to buy; our code does all the counting. */
function calc(plan) {
  const total = plan.items.reduce((sum, it) => sum + it.cost, 0);
  const toBuy = plan.items.filter((it) => !it.owned).reduce((sum, it) => sum + it.cost, 0);
  const ownedCount = plan.items.filter((it) => it.owned).length;
  // Readiness % = owned items / total items x 100 (guard against dividing by 0).
  const pct = plan.items.length ? Math.round((ownedCount / plan.items.length) * 100) : 0;
  return { total, toBuy, ownedCount, pct };
}

/* ---------- 5. Rendering ---------- */
const RING_LENGTH = 2 * Math.PI * 52; // circle length = 2*pi*r (r = 52 in the SVG)

function render() {
  const plan = activePlan();
  $("result").classList.toggle("hidden", !plan);
  renderHistory();
  if (!plan) return;

  const { total, toBuy, ownedCount, pct } = calc(plan);

  $("planTitle").textContent = plan.hobby;
  $("ownedCount").textContent = `${ownedCount} of ${plan.items.length} items owned`;
  $("totalCost").textContent = total;
  $("toBuyCost").textContent = toBuy;
  $("ringPct").textContent = pct + "%";

  // Progress ring trick: the circle's stroke is drawn as one long dash.
  // dashoffset hides part of that dash. Offset = full length means empty,
  // offset 0 means full. So offset = length * (1 - progress).
  const ring = $("ringFill");
  ring.style.strokeDasharray = RING_LENGTH;
  ring.style.strokeDashoffset = RING_LENGTH * (1 - pct / 100);

  // Warning if what is STILL to buy is more than the user's budget.
  const warn = $("warning");
  if (toBuy > plan.budget) {
    warn.textContent = `Over budget: you still need BDT ${toBuy}, but your budget is BDT ${plan.budget} (BDT ${toBuy - plan.budget} too much).`;
    warn.classList.remove("hidden");
  } else {
    warn.classList.add("hidden");
  }

  // Checklist. WHY textContent (not innerHTML): AI text is untrusted.
  // textContent shows it as plain text, so it can never inject HTML/scripts.
  const list = $("checklist");
  list.innerHTML = "";
  plan.items.forEach((it, index) => {
    const li = document.createElement("li");
    li.className = "item" + (it.owned ? " owned" : "");

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = it.owned;
    box.setAttribute("aria-label", "I already own " + it.name);
    box.addEventListener("change", () => {
      it.owned = box.checked; // update the data...
      saveState();            // ...keep it after refresh...
      render();               // ...and redraw ring, totals and warning.
    });

    const main = document.createElement("div");
    main.className = "item-main";
    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = it.name;
    if (!it.owned) {
      const tag = document.createElement("span");
      tag.className = "tag-need";
      tag.textContent = "need";
      name.appendChild(tag);
    }
    main.appendChild(name);
    if (it.why) {
      const why = document.createElement("div");
      why.className = "item-why";
      why.textContent = it.why;
      main.appendChild(why);
    }

    const cost = document.createElement("div");
    cost.className = "item-cost";
    cost.textContent = "BDT " + it.cost;

    li.append(box, main, cost);
    list.appendChild(li);
  });

  // Tips (optional, from AI).
  const tips = $("tips");
  tips.innerHTML = "";
  (plan.tips || []).forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    tips.appendChild(li);
  });
  $("tipsWrap").classList.toggle("hidden", !(plan.tips && plan.tips.length));
}

/* Saved-plan chips: tap one to switch back to it. */
function renderHistory() {
  const wrap = $("historyWrap");
  const box = $("history");
  box.innerHTML = "";
  wrap.classList.toggle("hidden", state.plans.length < 2); // only useful with 2+ plans
  state.plans.forEach((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (p.id === state.activeId ? " active" : "");
    b.textContent = p.hobby;
    b.addEventListener("click", () => {
      state.activeId = p.id;
      saveState();
      render();
    });
    box.appendChild(b);
  });
}

/* ---------- 6. Status message helper ---------- */
function setStatus(msg, isError) {
  const s = $("status");
  s.textContent = msg || "";
  s.classList.toggle("error", !!isError);
}

/* ---------- 7. Load demo data (works with NO AI) ---------- */
$("demoBtn").addEventListener("click", () => {
  // JSON copy so changing checkboxes never edits the original DEMO_PLAN constant.
  const plan = JSON.parse(JSON.stringify(DEMO_PLAN));
  $("hobby").value = plan.hobby;
  $("budget").value = plan.budget;
  addPlan(plan);
  setStatus("Demo plan loaded.");
  render();
});

/* ---------- 8. Plan with AI ----------
   The browser never talks to Gemini directly.
   WHY: a direct call would need the API key inside this file, and
   anyone could copy it from the browser. Instead we call OUR Netlify
   function, which holds the key on the server side. */
$("planForm").addEventListener("submit", async (event) => {
  event.preventDefault(); // stop the page from reloading
  const hobby = $("hobby").value.trim();
  const budget = Number($("budget").value);
  if (!hobby || !(budget > 0)) {
    setStatus("Please enter a hobby and a budget.", true);
    return;
  }

  const btn = $("planBtn");
  btn.disabled = true; // WHY: stops double-taps that would send two requests
  btn.textContent = "Planning…";
  setStatus("The AI is building your checklist…");

  try {
    const res = await fetch("/.netlify/functions/ai-hobby", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hobby, budget })
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      // The function already sends a friendly message; show it as is.
      setStatus(data.error || "Something went wrong. Please try again.", true);
      return;
    }

    // Turn the AI answer into our own plan shape.
    // "owned: false" at first: the user ticks what they already have.
    addPlan({
      hobby: data.hobby || hobby,
      budget,
      items: data.items.map((it) => ({
        name: it.name,
        cost: it.estimated_cost_bdt,
        why: it.why_needed,
        owned: false
      })),
      tips: data.tips || []
    });
    setStatus("Done. Tick what you already own.");
    render();
  } catch (err) {
    // Network down, or the function is not deployed yet.
    setStatus("Could not reach the AI. Check your internet and try again.", true);
  } finally {
    // "finally" runs on success AND failure, so the button never stays stuck.
    btn.disabled = false;
    btn.textContent = "Plan with AI";
  }
});

/* ---------- 9. Start ---------- */
loadState();
render();
