(function () {
  'use strict';
  var D = window.BOARD;
  var root = document.getElementById('app');
  if (!D) { root.innerHTML = '<div class="error">dashboard/data.js is missing.</div>'; return; }
  var ranks = {};
  D.rows.forEach(function (r, i) { ranks[r.slug] = i + 1; });
  var state = { q: '', cat: 'all', chain: 'all', sort: 'implied', dir: -1, detail: null };
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return ENT[c]; }); }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(d) { return d === null || d === undefined ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd'; }
  function conf(c) { return c >= 0.78 ? 'High' : c >= 0.62 ? 'Medium' : 'Low'; }
  function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function cls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }
  function cap(r) { return r.tvl_usd >= 1e9 ? 250 : r.tvl_usd >= 4e8 ? 150 : r.tvl_usd >= 1.5e8 ? 100 : 50; }
  function hold(r) { var a = r.age_days; return a === null ? 30 : a < 180 ? 60 : a < 365 ? 45 : 30; }
  function chainList(r) { return r.ci.map(function (i) { return D.chains[i]; }).filter(Boolean); }
  function phrase(r) {
    var k = norm(r.category);
    return D.phrases[k] || (k.indexOf('lend') >= 0 ? D.phrases.lending : k.indexOf('dex') >= 0 ? D.phrases.dexs : 'an active user base that can be rewarded at launch');
  }
  function thesis(r) {
    var g = r.change_7d || 0;
    var flow = g > 5 ? pct(g) + ' 7d inflow' : g < -5 ? pct(g) + ' 7d outflow' : 'flat 7d (' + pct(g) + ')';
    var a = r.age_days;
    var life = a === null ? 'age unknown' : a < 180 ? Math.max(1, Math.round(a / 30)) + 'mo live' : a < 730 ? (a / 365).toFixed(1) + 'y live' : Math.floor(a / 365) + 'y live';
    var p = phrase(r);
    return r.name + ': ' + usd(r.tvl_usd) + ' TVL on ' + r.chain + ', ' + flow + ', ' + life + '; ' + r.comp_multiple.toFixed(2) + 'x comp implies ' + usd(r.implied_value_usd) + ' FDV. ' + p.charAt(0).toUpperCase() + p.slice(1) + '.';
  }
  function plan(r) {
    var t = D.plans[r.plan] || D.plans.generic;
    var c = cap(r), h = hold(r), gas = c >= 150 ? 8 : 6;
    return t.map(function (s) {
      return s.replaceAll('{{name}}', r.name).replaceAll('{{chain}}', r.chain)
        .replaceAll('{{$cap}}', '$' + c).replaceAll('{{$gas}}', '$' + gas)
        .replaceAll('{{hold}}', h + ' days');
    });
  }

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    state.detail = null;
    if (h.indexOf('/protocol/') === 0) { state.detail = decodeURIComponent(h.slice(10)); return; }
    var q = h.charAt(0) === '?' ? h.slice(1) : h.indexOf('?') >= 0 ? h.slice(h.indexOf('?') + 1) : '';
    if (!q) return;
    var p = new URLSearchParams(q);
    state.q = p.get('q') || '';
    state.cat = p.get('category') || 'all';
    state.chain = p.get('chain') || 'all';
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat !== 'all') p.set('category', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    var s = p.toString();
    history.replaceState(null, '', s ? '#/?' + s : '#/');
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && chainList(r).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, chainList(r).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -999 : a.change_7d; bv = b.change_7d === null ? -999 : b.change_7d; }
      else if (key === 'confidence') { av = a.confidence; bv = b.confidence; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return ranks[a.slug] - ranks[b.slug];
    });
  }

  function header() {
    return '<header class="top"><div class="brand"><span class="mark">R</span><span class="brand-name">TOKEN RADAR</span><span class="brand-tag">pre-token intelligence</span></div>' +
      '<div class="top-meta"><span class="live-dot"></span> Sealed snapshot ' + esc(D.as_of) + '</div></header>';
  }
  function hero() {
    var s = D.summary;
    return '<section class="hero"><div class="hero-copy"><span class="eyebrow">DEFILLAMA · WATCHLIST SCREEN · ' + esc(D.as_of) + '</span>' +
      '<h1>Find the protocol<br><em>before the token.</em></h1>' +
      '<p>Every watchlist protocol is screened for a live token and for wrapper or staked-derivative products. Survivors are ranked by implied fully diluted value from TVL, category comps, 7-day flow and time live. Each row carries a concrete farm plan.</p>' +
      '<div class="formula-inline">TVL × category comp × momentum × age → implied FDV</div></div>' +
      '<div class="kpis"><div class="kpi"><span>Watchlist covered</span><b>' + s.watchlist + '<small>/' + s.watchlist + '</small></b></div>' +
      '<div class="kpi"><span>Ranked candidates</span><b>' + s.included + '</b></div>' +
      '<div class="kpi"><span>Screened out</span><b>' + s.excluded + '</b></div>' +
      '<div class="kpi"><span>Early radar below floor</span><b>' + s.early + '</b></div></div></section>';
  }
  function controls(categories, chains) {
    function opts(values, current) {
      return values.map(function (v) { return '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    }
    return '<section class="controls"><div class="field search"><label for="q">Search</label><input id="q" type="search" placeholder="Name, slug, chain…" value="' + esc(state.q) + '"></div>' +
      '<div class="field"><label for="cat">Category</label><select id="cat"><option value="all">All categories</option>' + opts(categories, state.cat) + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain"><option value="all">All chains</option>' + opts(chains, state.chain) + '</select></div>' +
      '<div class="field"><label for="sort">Sort by</label><select id="sort">' +
      ['implied:Implied FDV', 'tvl:TVL', 'name:Name', 'growth:7d flow', 'confidence:Confidence'].map(function (x) { var p = x.split(':'); return '<option value="' + p[0] + '"' + (p[0] === state.sort ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></div>' +
      '<button class="clear" id="clear" type="button">Clear</button></section>';
  }
  function th(key, label) { return '<th><button class="sort" data-sort="' + key + '" type="button">' + label + (state.sort === key ? '<span class="arrow">' + (state.dir < 0 ? '↓' : '↑') + '</span>' : '') + '</button></th>'; }
  function tableHTML() {
    var list = sorted(filtered());
    var count = '<div class="count" id="count">' + list.length + ' of ' + D.rows.length + ' ranked protocols</div>';
    if (!list.length) return count + '<div class="panel empty"><h3>No protocol matches these filters</h3><p>Clear the search or choose another category and chain.</p><button class="button" id="clear2" type="button">Reset filters</button></div>';
    var max = list[0].implied_value_usd || 1;
    var rows = list.map(function (r) {
      var g = r.change_7d || 0;
      return '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + ranks[r.slug] + '</td>' +
        '<td><div class="pname">' + esc(r.name) + '</div><div class="pmeta">' + esc(r.category || 'Other') + ' · ' + esc(r.chain) + (r.ci.length > 1 ? ' +' + (r.ci.length - 1) : '') + '</div></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num ' + cls(g) + '">' + pct(g) + '</td>' +
        '<td class="num">' + usd(r.implied_value_usd) + '</td>' +
        '<td><div class="barwrap"><div class="bar"><i style="width:' + Math.max(2, Math.round(r.implied_value_usd / max * 100)) + '%"></i></div><span>' + r.comp_multiple.toFixed(2) + '×</span></div></td>' +
        '<td><span class="conf ' + conf(r.confidence).toLowerCase() + '">' + conf(r.confidence) + '</span></td>' +
        '<td class="go"><a href="#/protocol/' + encodeURIComponent(r.slug) + '" aria-label="Open ' + esc(r.name) + '">→</a></td></tr>';
    }).join('');
    return count + '<div class="panel tablewrap"><table><thead><tr>' + th('implied', '#') + th('name', 'Protocol') + th('tvl', 'TVL') + th('growth', '7d') + th('implied', 'Implied FDV') + '<th>Comp</th>' + th('confidence', 'Confidence') + '<th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function screenedHTML() {
    return '<section class="screened"><h2>Screened out <span>' + D.screened.length + '</span></h2><p>Still part of the watchlist, with the reason recorded — not silently dropped.</p><div class="screen-grid">' +
      D.screened.map(function (r) { return '<article><div><b>' + esc(r.name) + '</b><span>' + usd(r.tvl_usd) + ' TVL</span></div><p>' + esc(r.reason) + '</p></article>'; }).join('') + '</div></section>';
  }
  function methodHTML() {
    var comps = D.comps.slice().sort(function (a, b) { return b.multiple - a.multiple; }).slice(0, 8);
    return '<section class="method"><div><h2>How the number is built</h2><p>FDV/TVL comps are anchored per category and shrunk toward the median of tokened protocols in the same sealed snapshot. Momentum is capped at ±40%/±60% and weighted 0.35; age adds a small early-stage premium. Confidence weights comp sample size, TVL, flow and listing data. Nothing is fetched from the network.</p></div>' +
      '<div class="compchips">' + comps.map(function (c) { return '<span><b>' + esc(c.category) + '</b> ' + c.multiple.toFixed(2) + '× <small>n=' + c.observations + '</small></span>'; }).join('') + '</div></section>';
  }
  function boardView() {
    var categories = [];
    D.rows.forEach(function (r) { if (r.category && categories.indexOf(r.category) < 0) categories.push(r.category); });
    categories.sort();
    var chains = [];
    D.rows.forEach(function (r) { chainList(r).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
    chains.sort();
    return header() + '<div class="shell">' + hero() + controls(categories, chains) +
      '<div id="table-region">' + tableHTML() + '</div>' + screenedHTML() + methodHTML() +
      '<footer>Source: ' + esc(D.source) + ' · Model v1 · Implied FDV is an estimate, not a price target or financial advice.</footer></div>';
  }
  function detailView(r) {
    var vals = [
      { label: 'Implied FDV', v: r.implied_value_usd, note: 'ranked estimate' },
      { label: 'Category comp × TVL', v: r.tvl_usd * r.comp_multiple, note: r.comp_multiple.toFixed(2) + '× ' + esc(r.category || 'Other') },
      { label: 'TVL today', v: r.tvl_usd, note: 'sealed snapshot' }
    ];
    var max = Math.max.apply(null, vals.map(function (x) { return x.v; })) || 1;
    var g = r.change_7d || 0;
    return header() + '<div class="shell detail"><a class="back" href="#/">← Back to the board</a>' +
      '<div class="detail-head"><div><span class="eyebrow">CANDIDATE ' + ranks[r.slug] + ' / ' + D.rows.length + '</span><h1>' + esc(r.name) + '</h1>' +
      '<div class="chips"><span>' + esc(r.category || 'Other') + '</span>' + chainList(r).slice(0, 5).map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + (r.ci.length > 5 ? '<span>+' + (r.ci.length - 5) + ' chains</span>' : '') + '</div></div>' +
      '<div class="headvalue"><span>Implied FDV</span><b>' + usd(r.implied_value_usd) + '</b></div></div>' +
      '<div class="detail-grid"><div class="maincol">' +
      '<section class="card"><h2>Thesis</h2><p class="thesis">' + esc(thesis(r)) + '</p></section>' +
      '<section class="card"><h2>Comparison</h2><div class="compare">' + vals.map(function (x, i) {
        return '<div class="crow"><div class="clabel"><span>' + x.label + '</span><b>' + usd(x.v) + '</b></div><div class="ctrack"><i class="c' + i + '" style="width:' + Math.max(3, Math.round(x.v / max * 100)) + '%"></i></div><small>' + x.note + '</small></div>';
      }).join('') + '</div><p class="note">Implied FDV is ' + (r.implied_value_usd / r.tvl_usd).toFixed(2) + '× current TVL after flow and age adjustments.</p></section>' +
      '<section class="card"><h2>Farm plan <span>' + plan(r).length + ' steps · $' + cap(r) + ' size</span></h2><ol class="steps">' + plan(r).map(function (s, i) {
        return '<li><span class="stepno">' + (i + 1 < 10 ? '0' : '') + (i + 1) + '</span><p>' + esc(s) + '</p></li>';
      }).join('') + '</ol></section></div>' +
      '<aside class="side"><section class="card stats"><h2>Snapshot facts</h2><dl>' +
      '<div><dt>TVL</dt><dd>' + usd(r.tvl_usd) + '</dd></div><div><dt>7-day TVL change</dt><dd class="' + cls(g) + '">' + pct(g) + '</dd></div>' +
      '<div><dt>Age with no token</dt><dd>' + age(r.age_days) + '</dd></div><div><dt>Category comp</dt><dd>' + r.comp_multiple.toFixed(2) + '×</dd></div>' +
      '<div><dt>Confidence</dt><dd><span class="conf ' + conf(r.confidence).toLowerCase() + '">' + conf(r.confidence) + ' · ' + r.confidence.toFixed(2) + '</span></dd></div>' +
      '<div><dt>Watchlist</dt><dd>' + (r.w ? 'core' : 'early radar') + '</dd></div></dl></section>' +
      '<section class="card"><h2>Model inputs</h2><p class="note">Momentum uses the snapshot’s 7-day TVL change, clamped between −40% and +60% and weighted 0.35. Age adds up to 14% for newly listed protocols and fades to 0% after about five years. TVL and comps are the only value drivers.</p></section></aside></div>' +
      '<footer>Data: ' + esc(D.source) + ' · Implied FDV is a model output, not a token price forecast.</footer></div>';
  }
  function render() {
    root.classList.toggle('is-detail', !!state.detail);
    var d = state.detail ? D.rows.filter(function (r) { return r.slug === state.detail; })[0] : null;
    root.innerHTML = d ? detailView(d) : boardView();
    root.setAttribute('aria-busy', 'false');
    document.title = d ? d.name + ' · Token Radar' : 'Token Radar · pre-token launch board';
    if (!d) window.scrollTo(0, 0);
  }
  function reset() { state.q = ''; state.cat = 'all'; state.chain = 'all'; writeHash(); render(); }
  root.addEventListener('input', function (e) {
    if (e.target.id !== 'q') return;
    state.q = e.target.value;
    writeHash();
    document.getElementById('table-region').innerHTML = tableHTML();
  });
  root.addEventListener('change', function (e) {
    if (e.target.id === 'cat') state.cat = e.target.value;
    else if (e.target.id === 'chain') state.chain = e.target.value;
    else if (e.target.id === 'sort') state.sort = e.target.value;
    else return;
    writeHash();
    render();
  });
  root.addEventListener('click', function (e) {
    var s = e.target.closest('[data-sort]');
    if (s) { if (state.sort === s.dataset.sort) state.dir = -state.dir; else { state.sort = s.dataset.sort; state.dir = -1; } render(); return; }
    if (e.target.id === 'clear' || e.target.id === 'clear2') { reset(); return; }
    var row = e.target.closest('tr[data-slug]');
    if (row && !e.target.closest('a')) location.hash = '#/protocol/' + encodeURIComponent(row.dataset.slug);
  });
  window.addEventListener('hashchange', function () { parseHash(); render(); });
  parseHash();
  render();
})();
