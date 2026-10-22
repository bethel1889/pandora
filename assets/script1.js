(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const VERDICTS = ['suitable', 'conditional', 'unlikely', 'unsuitable'];

  /* Keys rendered by dedicated sections; anything else on a listing is shown under "Additional information". */
  const KNOWN = new Set([
    'id', 'added_date', 'status', 'url', 'source_platform', 'listing_code', 'title', 'type',
    'location', 'price', 'details', 'landlord', 'requirements_stated', 'remote_signing_possible',
    'viewing_required_in_person', 'features', 'assessment', 'raw_text_excerpt', 'notes'
  ]);

  let DATA = null;
  const state = { q: '', verdicts: new Set(), city: '', ltype: '', status: '', sort: 'score-desc' };

  /* ---------- tiny DOM helper (uses textContent only: safe for any data) ---------- */
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  /* ---------- formatting ---------- */
  const eur = (n) => '€ ' + Number(n).toLocaleString('de-AT', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

  function labelOf(key) {
    let s = String(key).replace(/_eur$/, '').replace(/_sqm$/, ' (m²)').replace(/_/g, ' ');
    s = s.replace(/\bmeldezettel\b/i, 'Meldezettel').replace(/\bnag\b/i, 'NAG');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function fmtDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    const d = new Date(s + 'T00:00:00');
    return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* turn URLs and e-mail addresses inside text into links */
  function linkify(text) {
    const out = [];
    const re = /(https?:\/\/[^\s)]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const t = m[0];
      const href = t.includes('@') && !t.startsWith('http') ? 'mailto:' + t : t;
      out.push(el('a', { href, target: href.startsWith('http') ? '_blank' : null, rel: 'noopener noreferrer', text: t }));
      last = m.index + t.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  /* Render ANY json value. key lets us format euro amounts. */
  function renderValue(v, key = '') {
    if (v === null || v === undefined || v === '') return el('span', { class: 'muted', text: '—' });
    if (typeof v === 'boolean') return el('span', { class: 'badge ' + (v ? 'b-info' : 'b-neutral'), text: v ? 'Yes' : 'No' });
    if (typeof v === 'number') return document.createTextNode(/_eur$/.test(key) ? eur(v) : v.toLocaleString('de-AT'));
    if (typeof v === 'string') {
      if (key === 'added_date' || key === 'last_updated' || key === 'available_from') return document.createTextNode(fmtDate(v));
      return el('span', null, linkify(v));
    }
    if (Array.isArray(v)) {
      if (!v.length) return el('span', { class: 'muted', text: '—' });
      return el('ul', { class: 'plain' }, v.map((x) => el('li', null, renderValue(x, key))));
    }
    if (typeof v === 'object') return kv(v);
    return document.createTextNode(String(v));
  }

  function kv(obj, skip = []) {
    const entries = Object.entries(obj).filter(([k]) => !skip.includes(k));
    if (!entries.length) return el('span', { class: 'muted', text: '—' });
    return el('dl', { class: 'kv' }, entries.map(([k, v]) =>
      el('div', null, el('dt', { text: labelOf(k) }), el('dd', null, renderValue(v, k)))));
  }

  const sec = (title, body, wide) => el('div', { class: 'sec' + (wide ? ' wide' : '') }, el('h3', { text: title }), body);
  const list = (arr, cls) => el('ul', { class: 'plain ' + (cls || '') }, (arr || []).map((x) => el('li', null, renderValue(x))));

  /* ---------- derived values ---------- */
  const verdictOf = (l) => (l.assessment && l.assessment.verdict) || 'unknown';
  const scoreOf = (l) => (l.assessment && typeof l.assessment.score === 'number') ? l.assessment.score : -1;
  const rentOf = (l) => (l.price && typeof l.price.rent_monthly_eur === 'number') ? l.price.rent_monthly_eur : Infinity;
  const moveOf = (l) => (l.price && typeof l.price.total_move_in_cost_eur === 'number') ? l.price.total_move_in_cost_eur : Infinity;
  const cityOf = (l) => (l.location && l.location.city) || '';
  const ltypeOf = (l) => (l.landlord && l.landlord.type) || '';

  /* ---------- meta / profile / assumptions ---------- */
  function renderMeta(meta) {
    const box = $('meta-section');
    box.replaceChildren();
    box.hidden = false;
    box.className = 'panel';
    const d = el('details', { class: 'panel', style: 'margin:0;border:0;box-shadow:none;padding:0' });
    d.append(el('summary', { text: 'About this list: applicants & assumptions' }));
    const body = el('div', { class: 'panel-body' });

    const top = {};
    for (const k of ['schema_version', 'purpose', 'last_updated']) if (k in meta) top[k] = meta[k];
    body.append(sec('Overview', kv(top)));

    if (meta.applicant_profile) body.append(sec('Applicant profile', kv(meta.applicant_profile)));
    if (meta.assumptions) body.append(sec('Assumptions', list(meta.assumptions)));

    if (meta.verdict_values) {
      body.append(sec('Verdict values', el('div', { class: 'pills' },
        meta.verdict_values.map((v) => el('span', { class: 'badge b-' + v, text: v })))));
    }
    if (meta.status_values) {
      body.append(sec('Status values', el('div', { class: 'pills' },
        meta.status_values.map((v) => el('span', { class: 'badge b-neutral', text: labelOf(v) })))));
    }
    const rest = {};
    for (const [k, v] of Object.entries(meta)) {
      if (!['schema_version', 'purpose', 'last_updated', 'applicant_profile', 'assumptions', 'verdict_values', 'status_values'].includes(k)) rest[k] = v;
    }
    if (Object.keys(rest).length) body.append(sec('Other meta', kv(rest)));

    d.append(body);
    box.append(d);
  }

  function renderTemplate(tpl) {
    const box = $('template-section');
    if (!tpl) return;
    box.replaceChildren();
    box.hidden = false;
    const d = el('details', { class: 'panel', style: 'margin:0;border:0;box-shadow:none;padding:0' });
    d.append(el('summary', { text: 'Schema template (blank listing structure)' }));
    d.append(el('div', { class: 'panel-body' }, renderValue(tpl)));
    box.append(d);
  }

  /* ---------- summary tiles ---------- */
  function renderSummary(listings) {
    const box = $('summary');
    box.replaceChildren();
    const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
    let best = null;
    for (const l of listings) {
      const v = verdictOf(l);
      if (v in counts) counts[v]++;
      if (!best || scoreOf(l) > scoreOf(best)) best = l;
    }
    const tile = (n, t) => el('div', { class: 'tile' }, el('b', { text: n }), el('span', { text: t }));
    box.append(tile(listings.length, 'Listings'));
    VERDICTS.forEach((v) => box.append(tile(counts[v], v)));
    box.append(tile(best ? best.id : '—', 'Top pick'));
    box.append(tile(best ? scoreOf(best) : '—', 'Top score'));
    box.hidden = false;
  }

  /* ---------- a single listing card ---------- */
  function renderCard(l) {
    const a = l.assessment || {};
    const loc = l.location || {};
    const price = l.price || {};
    const v = verdictOf(l);
    const rejected = l.status === 'rejected';

    const place = [loc.district, loc.city].filter(Boolean).join(', ');
    const rentTxt = typeof price.rent_monthly_eur === 'number' ? eur(price.rent_monthly_eur) : '—';
    const pct = Math.max(0, Math.min(100, scoreOf(l)));

    const summary = el('summary', null,
      el('div', { class: 'c-top' },
        el('span', { class: 'c-id', text: l.id }),
        el('span', null,
          el('span', { class: 'badge b-' + v, text: v }), ' ',
          el('span', { class: 'badge ' + (rejected ? 'b-unsuitable' : 'b-neutral'), text: labelOf(l.status || '') }))),
      el('div', { class: 'c-title', text: l.title || '(untitled)' }),
      el('div', { class: 'c-loc', text: [place, l.type].filter(Boolean).join(' · ') }),
      el('div', { class: 'c-meta' },
        el('span', { class: 'c-rent' }, rentTxt, el('small', null, ' / month')),
        price.total_move_in_cost_eur != null ? el('span', { class: 'c-stat', text: 'Move-in ' + eur(price.total_move_in_cost_eur) }) : null,
        l.details && l.details.size_sqm ? el('span', { class: 'c-stat', text: l.details.size_sqm + ' m²' }) : null),
      el('div', { class: 'scorebar', 'aria-label': 'Score ' + scoreOf(l) + ' of 100' },
        el('div', { class: 'track' }, el('div', { class: 'fill', style: 'width:' + pct + '%' })),
        el('b', { text: scoreOf(l) + ' / 100' })),
      el('span', { class: 'c-more', text: 'toggle' }));

    const body = el('div', { class: 'card-body' });

    /* Identity */
    body.append(sec('Listing', kv({
      id: l.id, added_date: l.added_date, status: l.status, source_platform: l.source_platform,
      listing_code: l.listing_code, type: l.type
    })));

    /* Location */
    body.append(sec('Location', kv(loc)));

    /* Price */
    body.append(sec('Price', kv(price)));

    /* Details */
    body.append(sec('Details', kv(l.details || {})));

    /* Landlord */
    body.append(sec('Landlord / agent', kv(l.landlord || {})));

    /* Process flags */
    body.append(sec('Process', kv({
      remote_signing_possible: l.remote_signing_possible,
      viewing_required_in_person: l.viewing_required_in_person
    })));

    /* Requirements */
    body.append(sec('Requirements stated', (l.requirements_stated && l.requirements_stated.length)
      ? list(l.requirements_stated) : el('span', { class: 'muted', text: 'None stated' }), true));

    /* Features */
    if ('features' in l) {
      body.append(sec('Features', (l.features && l.features.length)
        ? el('div', { class: 'pills' }, l.features.map((f) => el('span', { class: 'badge b-neutral', text: f })))
        : el('span', { class: 'muted', text: '—' }), true));
    }

    /* Assessment */
    body.append(sec('Assessment', kv({ verdict: a.verdict, score: a.score, scam_risk: a.scam_risk }), true));
    body.append(sec('Reasons for', a.reasons_for && a.reasons_for.length ? list(a.reasons_for, 'ok') : el('span', { class: 'muted', text: '—' })));
    body.append(sec('Risks', a.risks && a.risks.length ? list(a.risks, 'risk') : el('span', { class: 'muted', text: '—' })));
    body.append(sec('Questions to ask', a.questions_to_ask && a.questions_to_ask.length ? list(a.questions_to_ask, 'q') : el('span', { class: 'muted', text: '—' })));
    body.append(sec('Documents likely needed', a.documents_likely_needed && a.documents_likely_needed.length ? list(a.documents_likely_needed, 'doc') : el('span', { class: 'muted', text: '—' })));

    /* any extra assessment keys */
    const extraAssess = Object.fromEntries(Object.entries(a).filter(([k]) =>
      !['verdict', 'score', 'scam_risk', 'reasons_for', 'risks', 'questions_to_ask', 'documents_likely_needed'].includes(k)));
    if (Object.keys(extraAssess).length) body.append(sec('More assessment', kv(extraAssess), true));

    /* Irregular / additional keys (price_discrepancy, deposit_note, financing_contribution, options, ...) */
    const extra = Object.fromEntries(Object.entries(l).filter(([k]) => !KNOWN.has(k)));
    if (Object.keys(extra).length) body.append(sec('Additional information', kv(extra), true));

    /* Notes */
    if (l.notes) body.append(sec('Notes', el('div', { class: 'note-box' }, linkify(l.notes)), true));

    /* Raw text */
    if (l.raw_text_excerpt) {
      body.append(sec('Original listing excerpt', el('div', { class: 'raw', text: l.raw_text_excerpt }), true));
    }

    /* Actions */
    const actions = el('div', { class: 'card-actions sec wide' });
    if (l.url) actions.append(el('a', { class: 'btn', href: l.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open original listing ↗' }));
    else actions.append(el('span', { class: 'badge b-neutral', text: 'No source URL saved' }));
    body.append(actions);

    const card = el('details', { class: 'card v-' + v + (rejected ? ' is-rejected' : ''), id: l.id }, summary, body);
    return card;
  }

  /* ---------- filtering & sorting ---------- */
  function filtered() {
    const q = state.q.trim().toLowerCase();
    let out = DATA.listings.filter((l) => {
      if (state.verdicts.size && !state.verdicts.has(verdictOf(l))) return false;
      if (state.city && cityOf(l) !== state.city) return false;
      if (state.ltype && ltypeOf(l) !== state.ltype) return false;
      if (state.status && l.status !== state.status) return false;
      if (q && !JSON.stringify(l).toLowerCase().includes(q)) return false;
      return true;
    });
    const by = {
      'score-desc': (a, b) => scoreOf(b) - scoreOf(a) || a.id.localeCompare(b.id),
      'rent-asc': (a, b) => rentOf(a) - rentOf(b) || scoreOf(b) - scoreOf(a),
      'rent-desc': (a, b) => (rentOf(b) === Infinity ? -1 : rentOf(b)) - (rentOf(a) === Infinity ? -1 : rentOf(a)),
      'move-asc': (a, b) => moveOf(a) - moveOf(b) || scoreOf(b) - scoreOf(a),
      'id-asc': (a, b) => a.id.localeCompare(b.id),
      'id-desc': (a, b) => b.id.localeCompare(a.id)
    }[state.sort];
    return out.sort(by);
  }

  const cardCache = new Map();
  function renderList() {
    const items = filtered();
    const box = $('list');
    box.replaceChildren();
    for (const l of items) {
      if (!cardCache.has(l.id)) cardCache.set(l.id, renderCard(l));
      box.append(cardCache.get(l.id));
    }
    $('empty').hidden = items.length > 0;
    $('result-count').textContent = `Showing ${items.length} of ${DATA.listings.length} listings`;
  }

  /* ---------- controls ---------- */
  function fillSelect(sel, values, allLabel, fmt = (x) => x) {
    sel.replaceChildren(el('option', { value: '', text: allLabel }));
    values.forEach((v) => sel.append(el('option', { value: v, text: fmt(v) })));
  }
  const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));

  function setupControls() {
    const L = DATA.listings;
    fillSelect($('city'), uniq(L.map(cityOf)), 'All towns');
    fillSelect($('ltype'), uniq(L.map(ltypeOf)), 'All types', labelOf);
    fillSelect($('status'), uniq(L.map((l) => l.status)), 'All statuses', labelOf);

    const chips = $('verdict-chips');
    chips.replaceChildren();
    VERDICTS.forEach((v) => {
      const n = L.filter((l) => verdictOf(l) === v).length;
      chips.append(el('button', {
        class: 'chip', type: 'button', 'aria-pressed': 'false', 'data-v': v,
        text: `${labelOf(v)} (${n})`,
        on: {
          click: (e) => {
            const b = e.currentTarget;
            const on = b.getAttribute('aria-pressed') !== 'true';
            b.setAttribute('aria-pressed', String(on));
            on ? state.verdicts.add(v) : state.verdicts.delete(v);
            renderList();
          }
        }
      }));
    });

    let t;
    $('q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; renderList(); }, 150); });
    $('city').addEventListener('change', (e) => { state.city = e.target.value; renderList(); });
    $('ltype').addEventListener('change', (e) => { state.ltype = e.target.value; renderList(); });
    $('status').addEventListener('change', (e) => { state.status = e.target.value; renderList(); });
    $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });

    $('reset').addEventListener('click', () => {
      Object.assign(state, { q: '', city: '', ltype: '', status: '', sort: 'score-desc' });
      state.verdicts.clear();
      $('q').value = ''; $('city').value = ''; $('ltype').value = ''; $('status').value = ''; $('sort').value = 'score-desc';
      chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      renderList();
    });
    const setAll = (open) => $('list').querySelectorAll('details.card').forEach((d) => { d.open = open; });
    $('expand-all').addEventListener('click', () => setAll(true));
    $('collapse-all').addEventListener('click', () => setAll(false));

    const btn = $('toggle-filters'), panel = $('filters');
    btn.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---------- boot ---------- */
  function init(data) {
    DATA = data;
    cardCache.clear();
    $('load-error').hidden = true;
    const m = data.meta || {};
    $('subtitle').textContent = `${data.listings.length} listings · updated ${fmtDate(m.last_updated) || '—'}`;
    renderMeta(m);
    renderSummary(data.listings);
    setupControls();
    renderList();
    renderTemplate(data.schema_template);

    /* open a card directly via #L016 */
    if (location.hash) {
      const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (t && t.tagName === 'DETAILS') { t.open = true; t.scrollIntoView(); }
    }
  }

  function showLoadError() {
    $('subtitle').textContent = 'Data file not loaded';
    $('load-error').hidden = false;
    $('file-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then((txt) => init(JSON.parse(txt))).catch((err) => alert('Invalid JSON file: ' + err.message));
    });
  }

  fetch('listings.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(showLoadError);
})();
