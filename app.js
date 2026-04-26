// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const CITIES = [
  'Lymhurst', 'Bridgewatch', 'Martlock',
  'Thetford', 'Fort Sterling', 'Caerleon', 'Brecilien'
];

const RAW_IDS = {
  WOOD:  'T{T}_WOOD',
  FIBER: 'T{T}_FIBER',
  ROCK:  'T{T}_ROCK',
  ORE:   'T{T}_ORE',
  HIDE:  'T{T}_HIDE',
};

const REF_IDS = {
  WOOD:  'T{T}_PLANKS',
  FIBER: 'T{T}_CLOTH',
  ROCK:  'T{T}_STONEBLOCK',
  ORE:   'T{T}_METALBAR',
  HIDE:  'T{T}_LEATHER',
};

const RES_LBL = { WOOD:'Madera', FIBER:'Fibra', ROCK:'Piedra', ORE:'Metal', HIDE:'Cuero' };
const REF_LBL = { WOOD:'Tablones', FIBER:'Tela', ROCK:'Bloques', ORE:'Barras', HIDE:'Cuero Ref.' };

// Raw needed + refined_prev needed to produce 1 refined output
const RECIPES = {
  2: { r: 2, p: 0 },
  3: { r: 2, p: 1 },
  4: { r: 2, p: 1 },
  5: { r: 3, p: 1 },
  6: { r: 3, p: 1 },
  7: { r: 4, p: 1 },
  8: { r: 4, p: 1 },
};

const RETURN_NO_FOCUS = 0.367;
const RETURN_FOCUS    = 0.539;

// ── STATE ─────────────────────────────────────────────────────────────────────

const state = { server: 'west', resource: 'WOOD', tier: 4, enchant: 0, qty: 1000, tax: 8 };

// ── TOGGLE GROUPS ─────────────────────────────────────────────────────────────

const GROUP_KEYS = {
  gServer: 'server', gResource: 'resource',
  gTier: 'tier', gEnchant: 'enchant', gTax: 'tax'
};

Object.entries(GROUP_KEYS).forEach(([gid, key]) => {
  document.getElementById(gid).querySelectorAll('.tog').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(gid).querySelectorAll('.tog').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      const v = btn.dataset.v;
      state[key] = isNaN(v) ? v : Number(v);
    });
  });
});

document.getElementById('qty').addEventListener('input', e => {
  state.qty = Math.max(1, parseInt(e.target.value) || 1);
});

// ── HELPERS ───────────────────────────────────────────────────────────────────

function mkId(template, tier, enchant) {
  return template.replace('{T}', tier) + (enchant > 0 ? `@${enchant}` : '');
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('es-CO');
}

function groupPrices(data) {
  const map = {};
  for (const e of data) {
    if (!map[e.item_id]) map[e.item_id] = {};
    map[e.item_id][e.city] = {
      sell: e.sell_price_min,
      buy:  e.buy_price_max,
    };
  }
  return map;
}

function sortedCities(priceMap, itemId, ascending) {
  return CITIES
    .map(city => ({ city, price: priceMap[itemId]?.[city]?.sell || 0 }))
    .filter(x => x.price > 0)
    .sort((a, b) => ascending ? a.price - b.price : b.price - a.price);
}

// ── FETCH ─────────────────────────────────────────────────────────────────────

async function fetchPrices(server, ids) {
  const url = `https://${server}.albion-online-data.com/api/v2/stats/prices/${ids.join(',')}.json?locations=${CITIES.join(',')}&_=${Date.now()}`;
  const res = await fetch(url);

  // 200 or 304 are both fine
  if (!res.ok && res.status !== 304) {
    throw new Error(`Error HTTP ${res.status}`);
  }

  const text = await res.text();
  if (!text || text.trim() === '') {
    throw new Error('La API devolvió respuesta vacía. Intenta de nuevo en unos segundos.');
  }

  const data = JSON.parse(text);
  console.log('API response sample:', data.slice(0, 3));
  return data;
}

// ── RENDER HELPERS ────────────────────────────────────────────────────────────

function renderTable(tbodyId, rows, accentColor) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = '';

  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" class="no-data">Sin datos de precios</td></tr>`;
    return;
  }

  rows.slice(0, 7).forEach((row, i) => {
    const tr = document.createElement('tr');
    if (i === 0) tr.className = 'best';
    tr.innerHTML = `
      <td>${row.city}</td>
      <td style="color:${i === 0 ? accentColor : '#a09060'}">${fmt(row.price)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderMatRow(container, label, value) {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = `<span class="rl">${label}</span><span class="rv">${value}</span>`;
  container.appendChild(d);
}

function setProfit(elId, value) {
  const el = document.getElementById(elId);
  el.textContent = fmt(value);
  el.style.color = value > 0 ? 'var(--green)' : value < 0 ? 'var(--red)' : 'var(--gold)';
}

// ── CALCULATE ─────────────────────────────────────────────────────────────────

document.getElementById('calcBtn').addEventListener('click', async () => {
  const { server, resource, tier, enchant, qty, tax } = state;

  // Reset UI
  document.getElementById('results').style.display   = 'none';
  document.getElementById('error').style.display     = 'none';
  document.getElementById('error').textContent       = '';
  document.getElementById('loading').style.display   = 'block';
  document.getElementById('calcBtn').disabled        = true;

  try {
    const rec        = RECIPES[tier];
    const rawId      = mkId(RAW_IDS[resource],  tier,     enchant);
    const refOutId   = mkId(REF_IDS[resource],  tier,     enchant);
    const refPrevId  = tier > 2 ? mkId(REF_IDS[resource], tier - 1, enchant) : null;

    const ids  = [rawId, refOutId, ...(refPrevId ? [refPrevId] : [])];
    const data = await fetchPrices(server, ids);

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('La API no devolvió datos. Puede que no haya precios registrados para estos ítems aún.');
    }

    const pm       = groupPrices(data);
    const rawRows  = sortedCities(pm, rawId,    true);
    const sellRows = sortedCities(pm, refOutId, false);
    const prevRows = refPrevId ? sortedCities(pm, refPrevId, true) : [];

    // Check if we have any usable prices
    if (rawRows.length === 0 && sellRows.length === 0) {
      throw new Error(
        'No hay precios registrados para este ítem en este momento. ' +
        'Prueba con otro tier o recurso, o intenta más tarde cuando haya más jugadores reportando precios.'
      );
    }

    const pRaw  = rawRows[0]?.price  || 0;
    const pSell = sellRows[0]?.price || 0;
    const pPrev = prevRows[0]?.price || 0;

    // Calculations
    const outs       = Math.floor(qty / rec.r);
    const costRaw    = qty  * pRaw;
    const costPrev   = outs * rec.p * pPrev;
    const totalCost  = costRaw + costPrev;
    const perBatch   = rec.r * pRaw + rec.p * pPrev;
    const retNF      = outs * RETURN_NO_FOCUS * perBatch;
    const retF       = outs * RETURN_FOCUS    * perBatch;
    const gross      = outs * pSell;
    const taxAmt     = gross * (tax / 100);
    const net        = gross - taxAmt;
    const profNF     = net + retNF - totalCost;
    const profF      = net + retF  - totalCost;

    // ── RENDER ───────────────────────────────────────────────────────────────

    // Profit label + accent
    document.getElementById('profitLabel').textContent =
      `${qty.toLocaleString()} × T${tier}${enchant > 0 ? '.' + enchant : ''} ${RES_LBL[resource]} → ${outs.toLocaleString()} ${REF_LBL[resource]}`;

    const pc = document.getElementById('profitCard');
    pc.className = 'card ' + (profNF >= 0 ? 'accent-green' : 'accent-red');

    setProfit('pvNF', profNF);
    setProfit('pvF',  profF);

    // Desglose
    document.getElementById('dCost').textContent  = `-${fmt(totalCost)}`;
    document.getElementById('dRetNF').textContent = `+${fmt(retNF)}`;
    document.getElementById('dRetF').textContent  = `+${fmt(retF)}`;
    document.getElementById('dGross').textContent = fmt(gross);
    document.getElementById('dTax').textContent   = `-${fmt(taxAmt)}`;
    document.getElementById('dNet').textContent   = fmt(net);

    // Buy raw table
    document.getElementById('tagRaw').textContent =
      `${rawId} — ${qty.toLocaleString()} unidades`;
    renderTable('tbRaw', rawRows, 'var(--cyan)');

    // Buy prev refined table
    if (refPrevId && prevRows.length > 0) {
      document.getElementById('divPrev').style.display  = 'block';
      document.getElementById('tblPrev').style.display  = 'table';
      document.getElementById('tagPrev').textContent =
        `${refPrevId} — ${(outs * rec.p).toLocaleString()} unidades`;
      renderTable('tbPrev', prevRows, 'var(--cyan)');
    } else {
      document.getElementById('divPrev').style.display  = 'none';
      document.getElementById('tblPrev').style.display  = 'none';
      document.getElementById('tagPrev').textContent    = '';
    }

    // Sell table
    document.getElementById('tagSell').textContent =
      `${refOutId} — ${outs.toLocaleString()} unidades`;
    renderTable('tbSell', sellRows, 'var(--green)');

    // Materials list
    const ml = document.getElementById('matList');
    ml.innerHTML = '';
    renderMatRow(ml,
      `${qty.toLocaleString()} × ${rawId}`,
      `${fmt(pRaw)} c/u = ${fmt(costRaw)} plata`
    );
    if (refPrevId) {
      renderMatRow(ml,
        `${(outs * rec.p).toLocaleString()} × ${refPrevId}`,
        `${fmt(pPrev)} c/u = ${fmt(costPrev)} plata`
      );
    }

    document.getElementById('results').style.display = 'block';

  } catch (err) {
    const el = document.getElementById('error');
    el.textContent = '⚠ ' + err.message;
    el.style.display = 'block';
    console.error(err);
  } finally {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('calcBtn').disabled      = false;
  }
});
