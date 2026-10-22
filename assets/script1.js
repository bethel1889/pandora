(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const VERDICTS = ['suitable', 'conditional', 'unlikely', 'unsuitable'];

  const KNOWN = new Set([
    'id', 'added_date', 'status', 'url', 'source_platform', 'listing_code', 'title', 'type',
    'location', 'price', 'details', 'landlord', 'requirements_stated', 'remote_signing_possible',
    'viewing_required_in_person', 'features', 'assessment', 'raw_text_excerpt', 'notes'
  ]);

  let DATA = null;
  const state = { q: '', verdicts: new Set(), city: '', ltype: '', status: '', sort: 'score-desc' };

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

  const eur = (n) => '€ ' + Number(n).toLocaleString('de-AT', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

  function labelOf(key) {
    let s = String(key).replace(/_eur$/, '').replace(/_sqm$/, ' (m²)').replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function fmtDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    const d = new Date(s + 'T00:00:00');
    return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function linkify(text, includePhones = false) {
    const out = [];
    const re = includePhones
      ? /(https?:\/\/[^\s)]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\+?\d[\d ()/-]{5,}\d)/g
      : /(https?:\/\/[^\s)]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const t = m[0];
      const isEmail = t.includes('@') && !t.startsWith('http');
      const isPhone = includePhones && !isEmail && !t.startsWith('http');
      const href = isEmail ? 'mailto:' + t : isPhone ? 'tel:' + t.replace(/[^\d+]/g, '') : t;
      out.push(el('a', {
        class: isPhone || isEmail ? 'contact-link' : null,
        href,
        target: href.startsWith('http') ? '_blank' : null,
        rel: 'noopener noreferrer',
        text: t
      }));
      last = m.index + t.length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

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

  const verdictOf = (l) => (l.assessment && l.assessment.verdict) || 'unknown';
  const scoreOf = (l) => (l.assessment && typeof l.assessment.score === 'number') ? l.assessment.score : -1;
  const rentOf = (l) => (l.price && typeof l.price.rent_monthly_eur === 'number') ? l.price.rent_monthly_eur : Infinity;
  const moveOf = (l) => (l.price && typeof l.price.total_move_in_cost_eur === 'number') ? l.price.total_move_in_cost_eur : Infinity;
  const cityOf = (l) => (l.location && l.location.city) || '';
  const ltypeOf = (l) => (l.landlord && l.landlord.type) || '';

  function renderMeta(meta) {
    const box = $('meta-section');
    box.replaceChildren();
    box.hidden = false;
    box.className = 'panel';
    const d = el('details', { class: 'panel', style: 'margin:0;border:0;box-shadow:none;padding:0' });
    d.append(el('summary', { text: 'About this list: applicants & assumptions' }));
    const body = el('div', { class: 'panel-body' });
    body.append(sec('Overview', kv({ schema_version: meta.schema_version, purpose: meta.purpose, last_updated: meta.last_updated })));
    d.append(body);
    box.append(d);
  }

  function renderSummary(listings) {
    const box = $('summary');
    box.replaceChildren();
    const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
    for (const l of listings) {
      const v = verdictOf(l);
      if (v in counts) counts[v]++;
    }
    const tile = (n, t) => el('div', { class: 'tile' }, el('b', { text: n }), el('span', { text: t }));
    box.append(tile(listings.length, 'Total'));
    VERDICTS.forEach((v) => box.append(tile(counts[v], v.charAt(0).toUpperCase() + v.slice(1))));
    box.hidden = false;
  }

  function renderCard(l) {
    const a = l.assessment || {};
    const loc = l.location || {};
    const price = l.price || {};
    const v = verdictOf(l);
    const rejected = l.status === 'rejected';

    const place = [loc.district, loc.city].filter(Boolean).join(', ');
    const rentTxt = typeof price.rent_monthly_eur === 'number' ? eur(price.rent_monthly_eur) : '—';
    const pct = Math.max(0, Math.min(100, scoreOf(l)));

    // Extract Contact Info vs Other Details
    const landlordRaw = l.landlord || {};
    const contactInfo = {};
    const landlordDetails = {};
    
    // Search for keywords or values indicating an email or phone number
    const contactKeys = ['phone', 'email', 'contact', 'whatsapp', 'tel'];
    const hasContactDetails = (val) => {
        if(typeof val !== 'string') return false;
        return val.includes('@') || /\+?[0-9]{5,}/.test(val);
    };
    
    let hasContact = false;

    for (const [k, val] of Object.entries(landlordRaw)) {
      if (contactKeys.some(ck => k.toLowerCase().includes(ck)) || hasContactDetails(val)) {
        contactInfo[k] = val;
        hasContact = true;
      }
      else landlordDetails[k] = val;
    }

    const extraRaw = Object.fromEntries(Object.entries(l).filter(([k]) => !KNOWN.has(k)));
    const otherDetails = {};
    for (const [k, val] of Object.entries(extraRaw)) {
      if (contactKeys.some(ck => k.toLowerCase().includes(ck)) || hasContactDetails(val)) {
        contactInfo[k] = val;
        hasContact = true;
      }
      else otherDetails[k] = val;
    }

    const topSummary = el('div', { class: 'card-header' },
      el('div', { class: 'c-top' },
        el('span', { class: 'badge b-' + v, text: v }),
        el('span', { class: 'c-id', text: l.id })
      ),
      el('div', { class: 'c-title', text: l.title || '(untitled)' }),
      el('div', { class: 'c-loc', text: [place, l.type].filter(Boolean).join(' • ') }),
      el('div', { class: 'c-meta' },
        el('div', null, 
          el('span', { class: 'c-rent' }, rentTxt), 
          el('small', null, '/mo')
        ),
        el('div', { class: 'scorebar', 'aria-label': 'Score ' + scoreOf(l) },
          el('b', { text: scoreOf(l) }),
          el('div', { class: 'track' }, el('div', { class: 'fill', style: 'width:' + pct + '%' }))
        )
      )
    );

    const card = el('div', { class: 'card v-' + v + (rejected ? ' is-rejected' : ''), id: l.id }, topSummary);

    const actionRow = el('div', { class: 'dual-actions' });
    
    // MORE INFO DRAWER
    const moreInfoBody = el('div', { class: 'card-body' });
    moreInfoBody.append(sec('Location', kv(loc)));
    moreInfoBody.append(sec('Price & Details', kv({...price, ...(l.details || {})})));
    if (Object.keys(landlordDetails).length) moreInfoBody.append(sec('Landlord / Agent', kv(landlordDetails)));
    moreInfoBody.append(sec('Requirements', (l.requirements_stated && l.requirements_stated.length)
      ? list(l.requirements_stated) : el('span', { class: 'muted', text: 'None' }), true));
    moreInfoBody.append(sec('Assessment', kv({ verdict: a.verdict, score: a.score, scam_risk: a.scam_risk }), true));
    if (a.reasons_for && a.reasons_for.length) moreInfoBody.append(sec('Pros', list(a.reasons_for, 'ok')));
    if (a.risks && a.risks.length) moreInfoBody.append(sec('Risks', list(a.risks, 'risk')));
    if (Object.keys(otherDetails).length) moreInfoBody.append(sec('Other Details', kv(otherDetails), true));
    if (l.notes) moreInfoBody.append(sec('Notes', el('div', { class: 'note-box' }, linkify(l.notes)), true));
    
    const moreActions = el('div', { class: 'card-actions sec wide' });
    if (l.url) moreActions.append(el('a', { class: 'btn primary', href: l.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open Original Listing' }));
    moreInfoBody.append(moreActions);

    const moreInfoDetails = el('details', {class: 'drawer details-drawer'}, 
      el('summary', {class: 'btn ghost drawer-btn'}, 'More Info ↓'),
      moreInfoBody
    );

    // CONTACT DRAWER (Only if contact info exists)
    if(hasContact) {
      const contactBody = el('div', { class: 'card-body contact-body' });
      const contactRows = el('dl', { class: 'kv contact-kv' }, Object.entries(contactInfo).map(([key, value]) => {
        const isContactText = typeof value === 'string' && /(?:phone|tel|whatsapp|mobile|call|email)/i.test(key + ' ' + value);
        const renderedValue = typeof value === 'string'
          ? el('span', { class: 'contact-value' }, linkify(value, isContactText))
          : renderValue(value, key);
        return el('div', { class: 'contact-entry' },
          el('dt', { text: labelOf(key) }),
          el('dd', null, renderedValue)
        );
      }));
      contactBody.append(sec('Contact Details', contactRows, true));
      
      const contactDetails = el('details', {class: 'drawer contact-drawer'}, 
        el('summary', {class: 'btn ghost drawer-btn'}, 'Contact Info ↓'),
        contactBody
      );
      
      // Auto-close one when the other opens
      contactDetails.addEventListener('toggle', (e) => { if(e.target.open) moreInfoDetails.open = false; });
      moreInfoDetails.addEventListener('toggle', (e) => { if(e.target.open) contactDetails.open = false; });
      
      actionRow.append(contactDetails);
    } else {
        moreInfoDetails.classList.add('full-width');
    }

    actionRow.append(moreInfoDetails);
    card.append(actionRow);

    return card;
  }

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
        on: { click: (e) => {
            const b = e.currentTarget;
            const on = b.getAttribute('aria-pressed') !== 'true';
            b.setAttribute('aria-pressed', String(on));
            on ? state.verdicts.add(v) : state.verdicts.delete(v);
            renderList();
          }}
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
    
    // Handle global expand/collapse safely for the new drawer structure
    const setAll = (open) => $('list').querySelectorAll('.details-drawer').forEach((d) => { d.open = open; });
    $('expand-all').addEventListener('click', () => setAll(true));
    $('collapse-all').addEventListener('click', () => setAll(false));

    const btn = $('toggle-filters'), panel = $('filters');
    btn.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  function init(data) {
    DATA = data;
    cardCache.clear();
    $('load-error').hidden = true;
    const m = data.meta || {};
    $('subtitle').textContent = `${data.listings.length} properties found`;
    renderMeta(m);
    renderSummary(data.listings);
    setupControls();
    renderList();

    if (location.hash) {
      const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (t && t.querySelector('.details-drawer')) { 
          t.querySelector('.details-drawer').open = true; 
          t.scrollIntoView(); 
      }
    }
  }

  function showLoadError() {
    $('subtitle').textContent = 'Awaiting JSON File';
    $('load-error').hidden = false;
    $('file-input').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then((txt) => init(JSON.parse(txt))).catch((err) => alert('Invalid JSON: ' + err.message));
    });
  }

  fetch('listings.json', { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(showLoadError);
})();