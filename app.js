// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const CITIES = [
  'Lymhurst','Bridgewatch','Martlock',
  'Thetford','Fort Sterling','Caerleon','Brecilien'
];

const RAW_IDS = {
  WOOD:'T{T}_WOOD', FIBER:'T{T}_FIBER', ROCK:'T{T}_ROCK',
  ORE:'T{T}_ORE',   HIDE:'T{T}_HIDE',
};

// Raw enchanted resources use _LEVEL1/_LEVEL2/_LEVEL3 format (NOT @1/@2/@3)
// Refined resources and outputs use @1/@2/@3 format
function mkRawId(resource, tier, enchant) {
  const base = RAW_IDS[resource].replace('{T}', tier);
  if (enchant === 0) return base;
  return base + '_LEVEL' + enchant;
}

// Refined items (prev ref + output) use @enc format
function mkRefId(resource, tier, enchant) {
  return REF_IDS[resource].replace('{T}', tier) + (enchant > 0 ? '@' + enchant : '');
}
const REF_IDS = {
  WOOD:'T{T}_PLANKS', FIBER:'T{T}_CLOTH',       ROCK:'T{T}_STONEBLOCK',
  ORE:'T{T}_METALBAR', HIDE:'T{T}_LEATHER',
};

const RES_LBL  = { WOOD:'Madera', FIBER:'Fibra', ROCK:'Piedra', ORE:'Metal', HIDE:'Cuero' };
const RES_EMOJI= { WOOD:'🪵', FIBER:'🌿', ROCK:'🪨', ORE:'⚙️', HIDE:'🐾' };
const REF_LBL  = { WOOD:'Tablones', FIBER:'Tela', ROCK:'Bloques', ORE:'Barras', HIDE:'Cuero Ref.' };

// r = raw per output, p = refined_prev per output
// Verified against official recipe table:
// T2: 1x raw | T3: 2x raw + 1x T2ref | T4: 2x raw + 1x T3ref
// T5: 3x raw + 1x T4ref | T6: 4x raw + 1x T5ref
// T7: 5x raw + 1x T6ref | T8: 5x raw + 1x T7ref
const RECIPES = {
  2:{r:1,p:0}, 3:{r:2,p:1}, 4:{r:2,p:1},
  5:{r:3,p:1}, 6:{r:4,p:1}, 7:{r:5,p:1}, 8:{r:5,p:1},
};

const RETURN_NO_FOCUS = 0.367;
const RETURN_FOCUS    = 0.539;
const RESOURCES       = ['WOOD','FIBER','ROCK','ORE','HIDE'];
const TIERS           = [2,3,4,5,6,7,8];
const ENCHANTS        = [0,1,2,3,4];

// ── STATE ─────────────────────────────────────────────────────────────────────

const state = { server:'west', resource:'WOOD', tier:4, enchant:0, qty:1000, tax:8 };

// ── TOGGLE GROUPS ─────────────────────────────────────────────────────────────

const GROUP_KEYS = {
  gServer:'server', gResource:'resource',
  gTier:'tier', gEnchant:'enchant', gTax:'tax'
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

// Correct prev refined ID per Albion's refining rules:
// .0 (normal): prev refined is always tier-1 .0
// T4 enchanted: prev refined is T3 .0 (T4 is the exception — always uses normal T3)
// T5-T8 enchanted: prev refined is tier-1 with SAME enchant level
function getPrevRefId(resource, tier, enchant) {
  if (tier <= 2) return null;
  if (enchant === 0) return mkRefId(resource, tier - 1, 0);
  if (tier === 4)    return mkRefId(resource, tier - 1, 0); // T4 exception
  return mkRefId(resource, tier - 1, enchant); // T5+ same enchant
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('es-CO');
}

function groupPrices(data) {
  const map = {};
  for (const e of data) {
    if (e.quality !== 1) continue;
    if (!map[e.item_id]) map[e.item_id] = {};
    map[e.item_id][e.city] = { sell: e.sell_price_min, buy: e.buy_price_max };
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
  if (!res.ok && res.status !== 304) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text || text.trim() === '') throw new Error('Respuesta vacía');
  return JSON.parse(text);
}

// ── PROFIT CALC ───────────────────────────────────────────────────────────────

function calcProfit(pm, resource, tier, enchant, qty, tax) {
  const rec       = RECIPES[tier];
  const rawId     = mkRawId(resource, tier, enchant);
  const refOutId  = mkRefId(resource, tier, enchant);
  const refPrevId = getPrevRefId(resource, tier, enchant);

  const rawRows  = sortedCities(pm, rawId,    true);
  const sellRows = sortedCities(pm, refOutId, false);
  const prevRows = refPrevId ? sortedCities(pm, refPrevId, true) : [];

  const pRaw  = rawRows[0]?.price  || 0;
  const pSell = sellRows[0]?.price || 0;
  const pPrev = prevRows[0]?.price || 0;

  if (pRaw === 0 || pSell === 0) return null;

  const outs       = Math.floor(qty / rec.r);
  const costRaw    = qty  * pRaw;
  const costPrev   = outs * rec.p * pPrev;
  const totalCost  = costRaw + costPrev;
  const inputValue = qty * pRaw + outs * rec.p * pPrev;
  const retNF      = inputValue * RETURN_NO_FOCUS;
  const retF       = inputValue * RETURN_FOCUS;
  const gross      = outs * pSell;
  const net        = gross * (1 - tax / 100);
  const profNF     = net + retNF - totalCost;
  const profF      = net + retF  - totalCost;

  return {
    resource, tier, enchant,
    rawId, refOutId,
    buyCity:  rawRows[0]?.city,
    sellCity: sellRows[0]?.city,
    profNF, profF,
    pRaw, pSell,
  };
}

// ── MAIN CALCULATE ────────────────────────────────────────────────────────────

document.getElementById('calcBtn').addEventListener('click', async () => {
  const { server, resource, tier, enchant, qty, tax } = state;

  document.getElementById('results').style.display   = 'none';
  document.getElementById('error').style.display     = 'none';
  document.getElementById('error').textContent       = '';
  document.getElementById('loading').style.display   = 'block';
  document.getElementById('calcBtn').disabled        = true;

  try {
    const rec       = RECIPES[tier];
    const rawId     = mkRawId(resource, tier, enchant);
    const refOutId  = mkRefId(resource, tier, enchant);
    const refPrevId = getPrevRefId(resource, tier, enchant);

    const ids  = [rawId, refOutId, ...(refPrevId ? [refPrevId] : [])];
    const data = await fetchPrices(server, ids);

    if (!Array.isArray(data) || data.length === 0)
      throw new Error('La API no devolvió datos para estos ítems.');

    const pm      = groupPrices(data);
    const rawRows = sortedCities(pm, rawId,    true);
    const sellRows= sortedCities(pm, refOutId, false);
    const prevRows= refPrevId ? sortedCities(pm, refPrevId, true) : [];

    if (rawRows.length === 0 && sellRows.length === 0)
      throw new Error(
        `Sin datos de mercado para ${rawId} o ${refOutId}. ` +
        (enchant > 0
          ? 'Los materiales encantados tienen menos volumen — prueba en servidor Europa o intenta más tarde.'
          : 'Prueba otro tier o recurso.')
      );

    const pRaw  = rawRows[0]?.price  || 0;
    const pSell = sellRows[0]?.price || 0;
    const pPrev = prevRows[0]?.price || 0;

    // outputs = qty / raw_per_unit (T2=1:1, T3+=2:1 etc)
    const outs      = Math.floor(qty / rec.r);
    const costRaw   = qty  * pRaw;
    const costPrev  = outs * rec.p * pPrev;
    const totalCost = costRaw + costPrev;
    // Return is value of raw materials returned (qty * rate * raw_price)
    // For tiers with prev refined: return applies to all input materials
    const inputValue = qty * pRaw + outs * rec.p * pPrev;
    const retNF     = inputValue * RETURN_NO_FOCUS;
    const retF      = inputValue * RETURN_FOCUS;
    const gross     = outs * pSell;
    const taxAmt    = gross * (tax / 100);
    const net       = gross - taxAmt;
    const profNF    = net + retNF - totalCost;
    const profF     = net + retF  - totalCost;

    document.getElementById('profitLabel').textContent =
      `${qty.toLocaleString()} × T${tier}${enchant > 0 ? '.' + enchant : ''} ${RES_LBL[resource]} → ${outs.toLocaleString()} ${REF_LBL[resource]}`;

    const pc = document.getElementById('profitCard');
    pc.className = 'card ' + (profNF >= 0 ? 'accent-green' : 'accent-red');

    setProfit('pvNF', profNF);
    setProfit('pvF',  profF);

    document.getElementById('dCost').textContent  = `-${fmt(totalCost)}`;
    document.getElementById('dRetNF').textContent = `+${fmt(retNF)}`;
    document.getElementById('dRetF').textContent  = `+${fmt(retF)}`;
    document.getElementById('dGross').textContent = fmt(gross);
    document.getElementById('dTax').textContent   = `-${fmt(taxAmt)}`;
    document.getElementById('dNet').textContent   = fmt(net);

    document.getElementById('tagRaw').textContent = `${rawId} — ${qty.toLocaleString()} uds`;
    renderTable('tbRaw', rawRows, 'var(--cyan)');

    if (refPrevId && prevRows.length > 0) {
      document.getElementById('divPrev').style.display = 'block';
      document.getElementById('tblPrev').style.display = 'table';
      document.getElementById('tagPrev').textContent   = `${refPrevId} — ${(outs * rec.p).toLocaleString()} uds`;
      renderTable('tbPrev', prevRows, 'var(--cyan)');
    } else {
      document.getElementById('divPrev').style.display = 'none';
      document.getElementById('tblPrev').style.display = 'none';
      document.getElementById('tagPrev').textContent   = '';
    }

    document.getElementById('tagSell').textContent = `${refOutId} — ${outs.toLocaleString()} uds`;
    renderTable('tbSell', sellRows, 'var(--green)');

    const ml = document.getElementById('matList');
    ml.innerHTML = '';
    renderMatRow(ml, `${qty.toLocaleString()} × ${rawId}`,
      `${fmt(pRaw)} c/u = ${fmt(costRaw)} plata`);
    if (refPrevId)
      renderMatRow(ml, `${(outs * rec.p).toLocaleString()} × ${refPrevId}`,
        `${fmt(pPrev)} c/u = ${fmt(costPrev)} plata`);

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

function setProfit(elId, value) {
  const el = document.getElementById(elId);
  el.textContent = fmt(value);
  el.style.color = value > 0 ? 'var(--green)' : value < 0 ? 'var(--red)' : 'var(--gold)';
}

function renderTable(tbodyId, rows, accentColor) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = '';
  if (!rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" class="no-data">Sin datos</td></tr>`;
    return;
  }
  rows.slice(0, 7).forEach((row, i) => {
    const tr = document.createElement('tr');
    if (i === 0) tr.className = 'best';
    tr.innerHTML = `<td>${row.city}</td>
      <td style="color:${i === 0 ? accentColor : '#a09878'}">${fmt(row.price)}</td>`;
    tbody.appendChild(tr);
  });
}

function renderMatRow(container, label, value) {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = `<span class="rl">${label}</span><span class="rv">${value}</span>`;
  container.appendChild(d);
}

// ── SCANNER ───────────────────────────────────────────────────────────────────

let scanAbort = false;

document.getElementById('scanBtn').addEventListener('click', async () => {
  if (document.getElementById('scanBtn').dataset.scanning === 'true') {
    scanAbort = true;
    return;
  }
  await runScan();
});

async function runScan() {
  const { server, qty, tax } = state;
  scanAbort = false;

  const btn      = document.getElementById('scanBtn');
  const progress = document.getElementById('scanProgress');
  const bar      = document.getElementById('scanBar');
  const scanList = document.getElementById('scanList');
  const scanInfo = document.getElementById('scanInfo');

  btn.textContent    = '⛔ Detener';
  btn.dataset.scanning = 'true';
  btn.classList.add('scanning');
  progress.style.display = 'block';
  scanList.innerHTML = '<div class="scan-empty">Escaneando…</div>';
  scanInfo.textContent = '';

  // Build all combos: resource × tier × enchant
  // Batch items together to minimize API calls
  // Each call: rawId + refOutId + refPrevId for one combo = up to 3 items
  // We batch multiple combos per call to stay efficient
  // Strategy: per resource+enchant, fetch all tiers at once
  const results = [];
  const combos  = [];

  for (const res of RESOURCES)
    for (const enc of ENCHANTS)
      combos.push({ res, enc });

  const total = combos.length; // 25 batches
  let done = 0;

  for (const { res, enc } of combos) {
    if (scanAbort) break;

    // Build all item IDs for this resource+enchant across all tiers
    const ids = new Set();
    for (const t of TIERS) {
      ids.add(mkRawId(res, t, enc));
      ids.add(mkRefId(res, t, enc));
      const prevId = getPrevRefId(res, t, enc);
      if (prevId) ids.add(prevId);
    }

    try {
      const data = await fetchPrices(server, [...ids]);
      const pm   = groupPrices(data);

      for (const t of TIERS) {
        const r = calcProfit(pm, res, t, enc, qty, tax);
        if (r) results.push(r);
      }
    } catch (e) {
      console.warn(`Scan skip ${res} enc${enc}:`, e.message);
    }

    done++;
    const pct = Math.round((done / total) * 100);
    bar.style.width     = pct + '%';
    scanInfo.textContent = `Escaneando… ${done}/${total} (${pct}%)`;

    // Render current top 5 while scanning
    renderTop5(results, qty);

    // Small delay to avoid hammering API
    await new Promise(r => setTimeout(r, 300));
  }

  btn.textContent      = '🔍 Escanear Mercado';
  btn.dataset.scanning = 'false';
  btn.classList.remove('scanning');
  scanInfo.textContent = scanAbort
    ? `Detenido — ${results.length} combinaciones analizadas`
    : `✅ Scan completo — ${results.length} combinaciones analizadas`;

  renderTop5(results, qty);
}

function renderTop5(results, qty) {
  const scanList = document.getElementById('scanList');
  if (!results.length) {
    scanList.innerHTML = '<div class="scan-empty">Sin datos aún…</div>';
    return;
  }

  const top = [...results]
    .sort((a, b) => b.profNF - a.profNF)
    .slice(0, 5);

  scanList.innerHTML = '';
  top.forEach((r, i) => {
    const enc    = r.enchant > 0 ? '.' + r.enchant : '.0';
    const label  = `T${r.tier}${enc} ${RES_EMOJI[r.resource]} ${RES_LBL[r.resource]}`;
    const isPos  = r.profNF > 0;
    const medal  = ['🥇','🥈','🥉','4️⃣','5️⃣'][i];

    const div = document.createElement('div');
    div.className = 'scan-item';
    div.innerHTML = `
      <div class="scan-rank">${medal}</div>
      <div class="scan-body">
        <div class="scan-name">${label}</div>
        <div class="scan-cities">
          <span class="scan-buy">↓ ${r.buyCity || '—'}</span>
          <span class="scan-sell">↑ ${r.sellCity || '—'}</span>
        </div>
      </div>
      <div class="scan-profit ${isPos ? 'pos' : 'neg'}">
        <div class="scan-pv">${fmt(r.profNF)}</div>
        <div class="scan-pl">sin foco</div>
      </div>`;

    // Click to load this combo into calculator
    div.style.cursor = 'pointer';
    div.title = 'Clic para calcular este ítem';
    div.addEventListener('click', () => loadCombo(r));

    scanList.appendChild(div);
  });
}

function loadCombo(r) {
  // Update state
  state.resource = r.resource;
  state.tier     = r.tier;
  state.enchant  = r.enchant;

  // Update toggle UI
  ['gResource','gTier','gEnchant'].forEach(gid => {
    const key = GROUP_KEYS[gid];
    document.getElementById(gid).querySelectorAll('.tog').forEach(btn => {
      btn.classList.toggle('on', Number(btn.dataset.v) === state[key] || btn.dataset.v === state[key]);
    });
  });

  // Trigger calculate
  document.getElementById('calcBtn').click();

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
