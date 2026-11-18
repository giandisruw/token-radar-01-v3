// Launch Radar v3 — dashboard logic.
//
// Rows arrive in window.RADAR.rows as compact arrays:
// [slug, name, category, chain, tvl, change7d, ageDays, anchor, implied,
//  farmCost, farmMinutes, farmCapital, watchlist, nChains]
// The top 10 rows also carry their farm steps verbatim in
// window.RADAR.topSteps; every other row's steps are rebuilt here from
// the same templates the model uses (same gas table, same capital tier,
// same category action), so the detail view shows the exact steps the
// board holds for that row.

var D = window.RADAR;
var ROWS = D.rows;
var META = D.meta;

function $(id) { return document.getElementById(id); }
function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
function shortUsd(n) {
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "k";
  return "$" + Math.round(n);
}
function fullUsd(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
function pct(ch) {
  if (ch === null || ch === undefined) return "—";
  return (ch >= 0 ? "+" : "") + ch.toFixed(1) + "%";
}
function money(n) { return n >= 100 ? "$" + Math.round(n) : "$" + n.toFixed(2); }

// --- farm steps: the same generator as lib/model.ts, kept in sync ---
var GAS = { ethereum: 2.5, base: 0.05, arbitrum: 0.08, optimism: 0.08, solana: 0.01, bsc: 0.12, "bnb chain": 0.12, polygon: 0.05, avalanche: 0.15 };
var CORE = {
  Dexs: "swap half of it for the paired asset and add both sides as liquidity in the main pool",
  Lending: "supply it as collateral and borrow a small amount against it, keeping the loan-to-value under 50%",
  Yield: "deposit it into the highest-TVL yield vault the app lists",
  "Yield Aggregator": "deposit it into the highest-TVL auto-compounding vault the app lists",
  Derivatives: "open a small isolated-margin perpetual position, sized so a 20% move cannot liquidate it",
  RWA: "subscribe it to the tokenised-asset vault the app lists",
  "Onchain Capital Allocator": "allocate it to the fund or vault the app lists with the longest track record",
  "Risk Curators": "deposit it into the curated vault with the longest track record the app lists"
};
function farmStepsFor(r) {
  var name = r[1], cat = r[2], chain = r[3], tvl = r[4];
  var cap = r[11];
  var gas = GAS[chain.toLowerCase()] === undefined ? 0.3 : GAS[chain.toLowerCase()];
  var half = Math.round(cap / 2);
  var fund = 2 * gas, core = 2 * gas, second = 2 * gas;
  var weekly = 2 * gas, eight = 16 * gas, exit = 2 * gas;
  var action = CORE[cat] === undefined
    ? "use the protocol's core feature with it (deposit, swap or stake, whichever the app offers)"
    : CORE[cat];
  return [
    "Set up: make a fresh wallet, fund it with " + money(cap) + " in stablecoins on " + chain + " and connect it to " + name + ". Cost ~" + money(fund) + " in network fees. Time ~10 min.",
    "Core position: " + action + ", starting with " + money(cap) + ". Cost ~" + money(core) + " in gas for 2 transactions. Time ~15 min.",
    "Second touch: use a different feature of " + name + " with a further " + money(half) + " (stake, lend or add liquidity, whichever the app offers). Cost ~" + money(second) + " in gas. Time ~15 min.",
    "Stay active: repeat the core action once a week for 8 weeks and finish any quests the protocol lists. Cost ~" + money(weekly) + " a week (" + money(eight) + " over 8 weeks). Time ~20 min a week.",
    "Track and exit: check " + name + "'s announcements weekly; when a token or points claim opens, claim it and unstake. Cost ~" + money(exit) + " in gas. Time ~20 min."
  ];
}
window.RADAR_STEPS = farmStepsFor;

function growthOf(ch) { return ch === null || ch === undefined ? 1 : 1 + clamp(ch, -50, 100) / 200; }
function maturityOf(age) { return age === null || age === undefined ? 1 : 0.85 + (0.3 * Math.min(age, 1095)) / 1095; }
function breadthOf(n) { return 0.95 + 0.05 * Math.min(Math.max(n, 1), 5); }
function catMedian(cat) {
  for (var i = 0; i < META.catMedians.length; i++) {
    if (META.catMedians[i].category === cat) return META.catMedians[i];
  }
  return null;
}

var selected = null;

function renderMeta() {
  var c = META.counts;
  $("meta").textContent = "Snapshot " + META.asOf + " (DefiLlama) — " + c.protocols +
    " protocols, " + c.preToken + " pre-token, " + c.tokenised + " tokenised comps — " +
    META.rows + " ranked rows, watchlist " + c.watchlist + "/40 covered.";
  $("fitline").textContent = "log(mcap) = " + META.intercept + " + " + META.slope +
    " x log(TVL), fitted to " + META.peers + " tokenised peers.";
  $("blindline").textContent = "median error curve " + (META.curveMedApe * 100).toFixed(1) +
    "% vs flat median " + (META.flatMedApe * 100).toFixed(1) + "% (curve wins " +
    META.curveWins + " of 5 seeds).";
  $("coverline").textContent = "All " + c.watchlist + " watchlist protocols are ranked, plus the top 200 " +
    "other pre-token protocols that pass the eligibility rule (no exchange, bridge, liquid-staking or " +
    "wrapped/staked product, no versioned copy) out of " + c.eligible + " eligible — " + META.rows +
    " rows in all. Tokenised protocols are the comps, not the ranked board.";
  var b = "<tr><th>TVL bucket</th><th>Peers</th><th>Median mcap/TVL</th></tr>";
  META.buckets.forEach(function (x) {
    b += "<tr><td>" + x.label + "</td><td class='num'>" + x.n + "</td><td class='num'>" + x.anchor.toFixed(3) + "</td></tr>";
  });
  $("buckets").innerHTML = "<caption>The curve's shape: the multiple falls as TVL grows.</caption>" + b;
  var h = "<tr><th>Blind seed</th><th>Hold-out n</th><th>Curve error</th><th>Flat-median error</th><th>Winner</th></tr>";
  META.seeds.forEach(function (s) {
    h += "<tr><td>" + s.seed + "</td><td class='num'>" + s.nHold + "</td><td class='num'>" +
      (s.curve * 100).toFixed(1) + "%</td><td class='num'>" + (s.flat * 100).toFixed(1) +
      "%</td><td>" + (s.curve < s.flat ? "curve" : s.curve > s.flat ? "flat" : "tie") + "</td></tr>";
  });
  $("blind").innerHTML = "<caption>Blind 70/30 hold-outs, median abs. % error on mcap.</caption>" + h;
}

function fillSelects() {
  var cats = {}, chains = {};
  ROWS.forEach(function (r) { cats[r[2] || "Uncategorised"] = 1; chains[r[3]] = 1; });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement("option"); o.value = c; o.textContent = c; $("cat").appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement("option"); o.value = c; o.textContent = c; $("chain").appendChild(o);
  });
}

function visibleRows() {
  var q = $("q").value.trim().toLowerCase();
  var cat = $("cat").value, chain = $("chain").value, wo = $("watchonly").checked;
  var list = ROWS.filter(function (r) {
    if (q && r[1].toLowerCase().indexOf(q) < 0 && r[0].toLowerCase().indexOf(q) < 0) return false;
    if (cat && (r[2] || "Uncategorised") !== cat) return false;
    if (chain && r[3] !== chain) return false;
    if (wo && !r[12]) return false;
    return true;
  });
  var sort = $("sort").value;
  var key = {
    implied: function (r) { return -r[8]; },
    tvl: function (r) { return -r[4]; },
    growth: function (r) { return r[5] === null ? 1e9 : -r[5]; },
    age: function (r) { return r[6] === null ? 1e9 : -r[6]; },
    cost: function (r) { return r[9]; },
    eff: function (r) { return -(r[8] / Math.max(r[9], 0.01)); }
  }[sort];
  list.sort(function (a, b) { return (key(a) - key(b)) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); });
  return list;
}

function renderTable() {
  var list = visibleRows();
  var html = "";
  list.forEach(function (r, i) {
    html += "<tr data-slug='" + r[0] + "'" + (selected === r[0] ? " class='sel'" : "") + ">" +
      "<td class='num'>" + (i + 1) + "</td>" +
      "<td>" + r[1] + (r[12] ? "<span class='badge'>WATCHLIST</span>" : "") + "<br><span style='color:#93a5c4;font-size:11px'>" + r[0] + "</span></td>" +
      "<td>" + (r[2] || "—") + "</td><td>" + r[3] + "</td>" +
      "<td class='num'>" + shortUsd(r[4]) + "</td>" +
      "<td class='num'>" + pct(r[5]) + "</td>" +
      "<td class='num'>" + (r[6] === null ? "—" : r[6] + "d") + "</td>" +
      "<td class='num'>" + r[7].toFixed(3) + "</td>" +
      "<td class='num'><b>" + fullUsd(r[8]) + "</b></td>" +
      "<td class='num'>~" + money(r[9]) + "</td>" +
      "<td class='num'>" + r[10] + " min</td></tr>";
  });
  $("rows").innerHTML = html;
  $("count").textContent = "Showing " + list.length + " of " + ROWS.length + " ranked rows.";
  var tbody = $("rows");
  var trs = tbody.getElementsByTagName("tr");
  for (var i = 0; i < trs.length; i++) {
    trs[i].addEventListener("click", function () { showDetail(this.getAttribute("data-slug")); });
  }
}

function stepsFor(r) {
  return D.topSteps[r[0]] ? D.topSteps[r[0]] : farmStepsFor(r);
}

function showDetail(slug) {
  var r = null;
  ROWS.forEach(function (x) { if (x[0] === slug) r = x; });
  if (!r) return;
  selected = slug;
  var cm = catMedian(r[2]);
  var steps = stepsFor(r);
  var li = "";
  steps.forEach(function (s) { li += "<li>" + s + "</li>"; });
  $("detail").innerHTML =
    "<h2>Detail — " + r[1] + (r[12] ? " <span class='badge'>WATCHLIST</span>" : "") + "</h2>" +
    "<p class='facts'>Category <b>" + (r[2] || "Uncategorised") + "</b> · Main chain <b>" + r[3] + "</b> (" + r[13] + " chains) · " +
    "TVL <b>" + fullUsd(r[4]) + "</b> · 7-day growth <b>" + pct(r[5]) + "</b> · Tracked <b>" +
    (r[6] === null ? "unknown" : r[6] + " days") + "</b> with no token recorded.</p>" +
    "<p class='facts'>Model: " + shortUsd(r[4]) + " TVL &times; anchor " + r[7].toFixed(3) +
    " &times; growth " + growthOf(r[5]).toFixed(3) + " &times; maturity " + maturityOf(r[6]).toFixed(3) +
    " &times; breadth " + breadthOf(r[13]).toFixed(3) + " = <b>" + fullUsd(r[8]) + " implied value</b>. " +
    (cm ? "Same-category median anchor is " + cm.anchor.toFixed(3) + " (" + cm.n + " peers) — shown for comparison; the rank uses the curve, not the category median." : "") + "</p>" +
    "<h2>Costed farm plan — " + r[1] + "</h2><ol>" + li + "</ol>" +
    "<p class='totals'>Plan total: <b>~" + money(r[9]) + " in network fees</b> + <b>" + money(r[11]) +
    " working capital</b> (capital is yours to keep, fees are spent) · <b>" + r[10] +
    " minutes</b> over 8 weeks. Fees use the model's gas table for " + r[3] + "; dear chains cost visibly more than cheap ones.</p>";
  renderTable();
  var el = $("detail");
  if (el.scrollIntoView) el.scrollIntoView();
}

if (typeof document !== "undefined") {
  renderMeta();
  fillSelects();
  ["q", "cat", "chain", "watchonly", "sort"].forEach(function (id) {
    $(id).addEventListener("input", renderTable);
    $(id).addEventListener("change", renderTable);
  });
  renderTable();
  var hash = (window.location.hash || "").replace(/^#/, "");
  var params = {};
  hash.split("&").forEach(function (kv) {
    var p = kv.split("=");
    if (p[0]) params[p[0]] = decodeURIComponent(p[1] || "");
  });
  if (params.filter === "watchlist") { $("watchonly").checked = true; renderTable(); }
  if (params.detail) showDetail(params.detail);
}
