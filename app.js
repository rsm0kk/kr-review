/* 국장 복기 대시보드 — 화면 로직 (데이터는 data/*.json, UI 와 분리) */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = {}; // 데이터
const PX = new Map(); // 가격 캐시
const COLORS = ['#d92d20', '#175cd3', '#079455', '#dc6803', '#7a5af8', '#0e9384', '#c11574', '#4e5ba6'];
const CATS = ['해외 영향', '거시·정책', '산업', '섹터·테마', '기업 고유', '실적', '수급', '자본변동', '기타'];
const GRADE_TXT = { A: 'A 공시·공식자료 확인', B: 'B 당시 보도로 뒷받침', C: 'C 시간적 일치·해석' };
const KIND_TXT = { H1: '상반기', H2: '하반기', FY: '연간' };

const S = {
  tab: 'home', year: null, kind: 'FY', mkt: 'ALL', filt: 'all', sector: '', theme: '',
  sel: [], primary: null, mode: 'norm', log: false, vol: true, ev: true, bench: { KOSPI: true, KOSDAQ: false },
  view: null, range: null, focus: null, stock: null, pit: null, pitAfter: false,
  groupType: 'th', groupVal: '', noteKey: null,
};

// ── 포맷 ──
const fmtP = (v, d = 2) => v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%';
const fmtPP = (v, d = 2) => v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d) + '%p';
const cls = (v) => v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '';
const arrow = (v) => v == null ? '' : v > 0 ? '▲' : v < 0 ? '▼' : '';
const pctHtml = (v) => `<span class="${cls(v)}">${arrow(v)} ${fmtP(v)}</span>`;
const fmtN = (v, d = 0) => v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });
const dstr = (d) => d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : '';
const dnum = (s) => s ? s.replace(/-/g, '').slice(0, 8) : null;

// ── 로딩 ──
async function j(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.json();
}
async function loadAll() {
  const [meta, rank, idx, sec, dq] = await Promise.all([
    j('data/meta.json'), j('data/rankings.json'), j('data/index.json'), j('data/securities.json'), j('data/data_quality.json')]);
  Object.assign(D, { meta, rank, idx, sec, dq });
  D.res = await j('data/research.json').catch(() => ({ events: [], rows: {}, stocks: {}, market: {} }));
  D.fund = await j('data/fundamentals.json').catch(() => ({}));
  D.cal = meta.calendar;
  D.ci = new Map(D.cal.map((d, i) => [d, i]));
  mergeImported();
  D.evById = new Map(D.res.events.map((e) => [e.id, e]));
  for (const e of D.res.events) e._i = idxOnOrAfter(e.react || e.date);
}
function idxOnOrAfter(d) {
  d = dnum(d);
  if (!d) return null;
  let lo = 0, hi = D.cal.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (D.cal[m] < d) lo = m + 1; else hi = m; }
  return lo < D.cal.length ? lo : null;
}
function idxOnOrBefore(d) {
  d = dnum(d);
  let lo = 0, hi = D.cal.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (D.cal[m] <= d) lo = m + 1; else hi = m; }
  return lo - 1;
}
async function px(code) {
  if (PX.has(code)) return PX.get(code);
  const p = j(`data/px/${code}.json`).then((o) => {
    const idx = o.t || o.c.map((_, k) => o.t0 + k);
    return { idx, c: o.c, v: o.v, raw: o.raw, b0: o.b0, brk: o.brk || [], pos: new Map(idx.map((t, k) => [t, k])) };
  }).catch(() => null);
  PX.set(code, p);
  return p;
}
function idxSeries(key) {
  const arr = D.idx[key];
  const idx = [], c = [];
  arr.forEach((v, i) => { if (v != null) { idx.push(i); c.push(v); } });
  return { idx, c, v: null, pos: new Map(idx.map((t, k) => [t, k])), b0: D.idx.base0[key], isIndex: true };
}

// ── 당시 정보 모드 ──
const pitIdx = () => S.pit ? idxOnOrBefore(S.pit) : null;
const hideFuture = () => !!S.pit && !S.pitAfter;
function evVisible(e) {
  if (!hideFuture()) return true;
  return dnum(e.seen || e.date) <= S.pit;
}
function maxIdx() { return hideFuture() ? pitIdx() : D.cal.length - 1; }

// ── 기간·순위 ──
const pid = () => `${S.year}${S.kind}`;
const period = (id = pid()) => D.meta.periods.find((p) => p.id === id) || D.meta.covid.find((p) => p.id === id);
const uniKey = () => `${S.mkt}.${S.filt}`;
const secOf = (c) => D.sec[c] || { n: c };
const rowRes = (p, c) => D.res.rows[`${p}|${c}`];
const stockRes = (c) => D.res.stocks[c];
function evsForCodes(codes, { market = true } = {}) {
  const set = new Set(codes);
  const sec = new Set(codes.map((c) => secOf(c).s).filter(Boolean));
  const th = new Set(codes.flatMap((c) => secOf(c).th || []));
  return D.res.events.filter((e) => {
    if (!evVisible(e)) return false;
    if ((e.codes || []).some((c) => set.has(c))) return true;
    if (!market) return false;
    if (!(e.codes || []).length && !(e.themes || []).length && !(e.sectors || []).length) return true; // 시장 전체
    if ((e.themes || []).some((t) => th.has(t))) return true;
    if ((e.sectors || []).some((t) => sec.has(t))) return true;
    return false;
  });
}
function evScope(e, codes) {
  if ((e.codes || []).some((c) => codes.includes(c))) {
    const hit = e.codes.filter((c) => codes.includes(c));
    return hit.length > 1 ? 'common' : 'co:' + hit[0];
  }
  return 'common';
}
const gradeScore = { A: 3, B: 2, C: 1 };
function evScore(e, codes) {
  let s = gradeScore[e.grade] || 0;
  if ((e.codes || []).some((c) => codes.includes(c))) s += 1.5;
  if (e.react != null || e.pr != null) s += Math.min(3, Math.abs(e.pr || 0) / 10);
  if (e.importance) s += e.importance;
  return s;
}

// ── 라우팅·상태 ──
function saveHash() {
  const h = new URLSearchParams();
  h.set('tab', S.tab); h.set('p', pid()); h.set('u', uniKey());
  if (S.sel.length) h.set('s', S.sel.join(','));
  if (S.stock) h.set('st', S.stock);
  if (S.range) h.set('r', `${D.cal[S.range[0]]}-${D.cal[S.range[1]]}`);
  if (S.view) h.set('v', `${D.cal[S.view[0]]}-${D.cal[S.view[1]]}`);
  if (S.mode !== 'norm') h.set('m', S.mode);
  if (S.log) h.set('log', '1');
  if (S.sector) h.set('sec', S.sector);
  if (S.theme) h.set('th', S.theme);
  if (S.pit) { h.set('pit', S.pit); if (S.pitAfter) h.set('after', '1'); }
  S._lastHash = h.toString();
  history.replaceState(null, '', '#' + h.toString());
}
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const p = h.get('p');
  if (p && period(p)) { S.year = +p.slice(0, 4); S.kind = p.slice(4); }
  const u = h.get('u');
  if (u) { const [m, f] = u.split('.'); S.mkt = m; S.filt = f; }
  if (h.get('s')) S.sel = h.get('s').split(',').filter((c) => D.sec[c]).slice(0, 8);
  S.primary = S.sel[0] || null;
  if (h.get('st') && D.sec[h.get('st')]) S.stock = h.get('st');
  const rg = (k) => { const v = h.get(k); if (!v) return null; const [a, b] = v.split('-'); const i0 = D.ci.get(a), i1 = D.ci.get(b); return i0 != null && i1 != null ? [i0, i1] : null; };
  S.range = rg('r'); S.view = rg('v');
  if (h.get('m')) S.mode = h.get('m');
  S.log = h.get('log') === '1';
  S.sector = h.get('sec') || ''; S.theme = h.get('th') || '';
  if (h.get('pit')) { S.pit = h.get('pit'); S.pitAfter = h.get('after') === '1'; }
  if (h.get('tab')) S.tab = h.get('tab');
}

// ── 공통 렌더 ──
function setTab(t) {
  S.tab = t;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + t));
  render();
}
function syncFilters() {
  $$('#fKind button').forEach((b) => b.classList.toggle('on', b.dataset.k === S.kind));
  $$('#fMkt button').forEach((b) => b.classList.toggle('on', b.dataset.m === S.mkt));
  $$('#fFilt button').forEach((b) => b.classList.toggle('on', b.dataset.f === S.filt));
  $('#fYear').value = S.year;
  $('#fSector').value = S.sector; $('#fTheme').value = S.theme;
  $('#pitOn').checked = !!S.pit; $('#pitDate').disabled = !S.pit; $('#pitAfter').disabled = !S.pit; $('#pitAfter').checked = S.pitAfter;
  if (S.pit) $('#pitDate').value = dstr(S.pit);
  const ban = $('#pitBanner');
  if (S.pit) {
    ban.hidden = false;
    ban.textContent = S.pitAfter
      ? `당시 정보 모드 · 기준 ${dstr(S.pit)} — '이후 결과 보기'가 켜져 있어 그 뒤의 사건·실적·수익률도 보입니다.`
      : `당시 정보 모드 · ${dstr(S.pit)}까지 공개된 사건·실적만 보입니다. 차트도 이 날에서 멈춥니다. 순위표는 기간이 끝난 뒤에야 알 수 있는 정보라 사전 판단 검증용이 아닙니다.`;
  } else ban.hidden = true;
}
function render() {
  syncFilters(); saveHash();
  const t = S.tab;
  const fail = (e) => {
    console.error(e);
    $('#tab-' + t).innerHTML = `<div class="card"><div class="empty">화면을 그리다 오류가 났습니다: ${esc(e.message)}</div></div>`;
  };
  try {
    let r;
    if (t === 'home') renderHome();
    else if (t === 'chart') r = renderChartTab();
    else if (t === 'stock') r = renderStock();
    else if (t === 'group') renderGroup();
    else if (t === 'persist') renderPersist();
    else if (t === 'pattern') renderPattern();
    else if (t === 'newlist') renderNewlist();
    else if (t === 'notes') renderNotes();
    else if (t === 'data') renderData();
    if (r && r.catch) r.catch(fail);
  } catch (e) { fail(e); }
}

// ── 시장 복기 홈 ──
function rowsFiltered(rows) {
  return rows.filter((r) => {
    const s = secOf(r.code);
    if (S.sector && s.s !== S.sector) return false;
    if (S.theme && !(s.th || []).includes(S.theme)) return false;
    return true;
  });
}
function reasonCell(p, r) {
  const rr = rowRes(p, r.code);
  if (hideFuture() && period(p) && period(p).endDate > S.pit) return '<span class="muted">기간 종료 후 정보 — 숨김</span>';
  if (!rr || !rr.reason) return '<span class="pend">원인 조사 미완료 (수익률만 계산됨)</span>';
  return esc(rr.reason);
}
function gradeBadge(g, status) {
  if (!g) return `<span class="badge no">${esc(status || '미조사')}</span>`;
  return `<span class="badge ${g}" title="${esc(GRADE_TXT[g] || '')}">근거 ${g}</span>`;
}
function rankTable(p, rows, dir) {
  const hideRet = hideFuture() && period(p).endDate > S.pit;
  const body = rows.map((r) => {
    const s = secOf(r.code);
    const rr = rowRes(p, r.code);
    const flags = (r.flags || []).map((f) => `<span class="badge flag">${esc(f)}</span>`).join(' ');
    return `<tr data-code="${r.code}" class="${S.stock === r.code ? 'rowsel' : ''}">
      <td class="n">${r.rank}</td>
      <td>${esc(s.s || '–')}</td><td>${esc(s.ss || s.ind || '–')}</td>
      <td>${(s.th || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('') || '–'}</td>
      <td><b>${esc(r.name)}</b><div class="muted" style="font-size:11.5px">${r.code} · ${r.market === 'KOSPI' ? '코스피' : '코스닥'}${s.listed === false ? ' · 상장폐지' : ''}</div>${flags ? `<div class="row-flags">${flags}</div>` : ''}</td>
      <td class="n">${hideRet ? '–' : pctHtml(r.ret)}</td>
      <td class="n">${hideRet ? '–' : pctHtml(r.ytd)}</td>
      <td class="reason">${reasonCell(p, r)}</td>
      <td>${hideRet ? '' : gradeBadge(rr?.grade, rr?.status)}</td>
      <td><button class="btn sm add" data-code="${r.code}" title="비교 차트에 추가">+차트</button></td></tr>`;
  }).join('');
  return `<div class="tw" style="max-height:760px"><table class="rank" data-dir="${dir}">
    <thead><tr><th class="n">순위</th><th>대섹터</th><th>소섹터</th><th>핵심 테마</th><th>종목</th><th class="n">기간 수익률</th><th class="n">YTD</th><th>${dir === 'top' ? '상승' : '하락'} 핵심 이유</th><th>근거</th><th></th></tr></thead>
    <tbody>${body || `<tr><td colspan="10"><div class="empty">필터에 맞는 종목이 없습니다</div></td></tr>`}</tbody></table></div>`;
}
function histSvg(h, bench, n) {
  const W = 560, H = 210, L = 36, R = 10, T = 16, B = 44;
  const max = Math.max(...h.count, 1);
  const bw = (W - L - R) / h.count.length;
  const lab = h.edges.map((e, i) => i < h.edges.length - 1 ? `${e}~${h.edges[i + 1] === '∞' ? '' : h.edges[i + 1]}` : '');
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px" role="img" aria-label="수익률 분포">`;
  h.count.forEach((c, i) => {
    const x = L + i * bw, bh = (H - T - B) * c / max, y = H - B - bh;
    const lo = h.edges[i];
    const col = lo >= 0 ? 'var(--up)' : 'var(--down)';
    s += `<rect class="hb" data-i="${i}" x="${x + 2}" y="${y}" width="${bw - 4}" height="${Math.max(bh, 0.5)}" fill="${col}" opacity=".78"><title>${lab[i]}% 구간 ${c}개 (${(c / n * 100).toFixed(1)}%)</title></rect>`;
    if (c > 0) s += `<text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" font-size="10.5" fill="var(--ink-2)">${c}</text>`;
    s += `<text x="${x + bw / 2}" y="${H - B + 14}" text-anchor="middle" font-size="9.5" fill="var(--ink-3)">${lo}</text>`;
  });
  s += `<text x="${L}" y="${H - 8}" font-size="10.5" fill="var(--ink-3)">구간 하한(%) · 막대 위 숫자 = 종목 수</text>`;
  s += '</svg>';
  return s;
}
function sectorBars(top, bot) {
  const cnt = {};
  for (const [arr, k] of [[top, 't'], [bot, 'b']]) for (const r of arr) {
    const s = secOf(r.code).s || '미분류';
    cnt[s] = cnt[s] || { t: 0, b: 0 }; cnt[s][k]++;
  }
  const rows = Object.entries(cnt).sort((a, b) => (b[1].t + b[1].b) - (a[1].t + a[1].b));
  const max = Math.max(1, ...rows.map(([, v]) => Math.max(v.t, v.b)));
  return `<table><thead><tr><th>대섹터</th><th class="n">상위 15</th><th></th><th class="n">하위 15</th><th></th></tr></thead><tbody>${rows.map(([k, v]) =>
    `<tr style="cursor:default"><td>${esc(k)}</td><td class="n">${v.t}</td><td style="width:28%"><div style="height:9px;border-radius:4px;background:var(--up);width:${v.t / max * 100}%"></div></td><td class="n">${v.b}</td><td style="width:28%"><div style="height:9px;border-radius:4px;background:var(--down);width:${v.b / max * 100}%"></div></td></tr>`).join('')}</tbody></table>
    <div class="legend-note">상위·하위 15개(30개 행) 기준 분포입니다. 전체 시장 분포가 아닙니다.</div>`;
}
function renderHome() {
  const P = period(), R = D.rank[pid()], U = R.universe[uniKey()];
  const el = $('#tab-home');
  const top = rowsFiltered(U.top), bot = rowsFiltered(U.bot);
  const mk = D.res.market[pid()];
  const evs = D.res.events.filter((e) => evVisible(e) && !(e.codes || []).length && dnum(e.date) > P.startRef && dnum(e.date) <= P.endDate)
    .sort((a, b) => a.date < b.date ? -1 : 1);
  const done = [...U.top, ...U.bot].filter((r) => rowRes(pid(), r.code)?.reason).length;
  const hideRet = hideFuture() && P.endDate > S.pit;
  el.innerHTML = `
  <div class="card">
    <h2>${esc(P.label)} <span class="hint">기준 ${dstr(P.startRef)} 종가 → ${dstr(P.endDate)} 종가${P.ongoing ? ' · 진행 중' : ''} · ${S.mkt === 'ALL' ? '코스피+코스닥' : S.mkt === 'KOSPI' ? '코스피' : '코스닥'} · ${S.filt === 'inv' ? '투자 가능 종목' : '전 종목'}</span></h2>
    <div class="kpis">
      <div class="kpi"><div class="l">대상 종목</div><div class="v">${fmtN(U.n)}</div></div>
      <div class="kpi"><div class="l">중앙값 수익률</div><div class="v ${cls(U.median)}">${hideRet ? '–' : fmtP(U.median)}</div></div>
      <div class="kpi"><div class="l">상승 / 하락 종목</div><div class="v">${hideRet ? '–' : `<span class="pos">${fmtN(U.up)}</span> / <span class="neg">${fmtN(U.down)}</span>`}</div></div>
      <div class="kpi"><div class="l">코스피 지수</div><div class="v ${cls(R.bench.KOSPI)}">${hideRet ? '–' : fmtP(R.bench.KOSPI)}</div></div>
      <div class="kpi"><div class="l">코스닥 지수</div><div class="v ${cls(R.bench.KOSDAQ)}">${hideRet ? '–' : fmtP(R.bench.KOSDAQ)}</div></div>
      <div class="kpi"><div class="l">원인 조사 완료</div><div class="v">${done} / ${U.top.length + U.bot.length}</div></div>
      <div class="kpi"><div class="l">기간 중 거래 종료(제외)</div><div class="v">${fmtN(R.excluded.filter((x) => S.mkt === 'ALL' || x.market === S.mkt).length)}</div></div>
    </div>
  </div>
  <div class="grid-home">
    <div>
      <div class="card"><h2>이 기간 핵심 5줄</h2>${mk && mk.lines && mk.lines.length && !(hideFuture() && P.endDate > S.pit)
        ? `<ol class="lines">${mk.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>${mk.src ? `<div class="legend-note">${mk.src.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">출처${i + 1}</a>`).join(' · ')}</div>` : ''}`
        : '<div class="empty">이 기간 요약은 아직 정리되지 않았습니다.</div>'}</div>
      <div class="card"><h2>상위 15 <span class="hint">수익률 내림차순 · 전체 대상에서 먼저 계산한 순위${S.sector || S.theme ? ' · 필터는 표시만 줄이며 순위 번호는 그대로' : ''}</span>
        <button class="btn sm csv" data-dir="top" style="margin-left:auto">CSV</button></h2>${rankTable(pid(), top, 'top')}</div>
      <div class="card"><h2>하위 15 <span class="hint">수익률 오름차순 (하위라도 음수가 아닐 수 있음)</span>
        <button class="btn sm csv" data-dir="bot" style="margin-left:auto">CSV</button></h2>${rankTable(pid(), bot, 'bot')}</div>
    </div>
    <div>
      <div class="card"><h2>수익률 분포 <span class="hint">전체 대상 ${fmtN(U.n)}개 기준</span></h2>${hideRet ? '<div class="empty">당시 정보 모드에서는 숨김</div>' : histSvg(U.hist, R.bench, U.n)}
        <div class="legend-note">벤치마크: 코스피 ${fmtP(R.bench.KOSPI)} · 코스닥 ${fmtP(R.bench.KOSDAQ)} · 코스피200 ${fmtP(R.bench.K200)}</div></div>
      <div class="card"><h2>상위·하위 산업 분포</h2>${sectorBars(U.top, U.bot)}</div>
      <div class="card"><h2>주요 사건 타임라인 <span class="hint">거시·정책·해외·산업</span></h2>${evs.length ? `<ul class="evlist">${evs.map(evItem).join('')}</ul>` : '<div class="empty">이 기간 시장 사건이 아직 정리되지 않았습니다.</div>'}</div>
    </div>
  </div>`;
  el.querySelectorAll('table.rank tbody tr[data-code]').forEach((tr) => tr.addEventListener('click', (ev) => {
    if (ev.target.closest('.add')) return;
    openStock(tr.dataset.code);
  }));
  el.querySelectorAll('.add').forEach((b) => b.addEventListener('click', () => { addSel(b.dataset.code); setTab('chart'); }));
  el.querySelectorAll('.csv').forEach((b) => b.addEventListener('click', () => exportRankCsv(b.dataset.dir)));
}
function evItem(e) {
  const dirc = e.dir === '+' ? 'dir-p' : e.dir === '-' ? 'dir-n' : 'dir-m';
  const dirt = e.dir === '+' ? '긍정' : e.dir === '-' ? '부정' : '혼합';
  const names = (e.codes || []).map((c) => secOf(c).n).slice(0, 4).join(', ');
  return `<li data-ev="${esc(e.id)}"><div class="h"><b class="num">${esc(e.date)}</b>${e.seen && e.seen !== e.date ? `<span class="muted">공개 ${esc(e.seen)}</span>` : ''}
    <span class="tag">${esc(e.cat || '기타')}</span><span class="${dirc}">${dirt}</span>${gradeBadge(e.grade)}${e.pr != null ? `<span class="${cls(e.pr)}">반응 ${fmtP(e.pr, 1)}</span>` : ''}${names ? `<span class="muted">${esc(names)}</span>` : ''}</div>
    <div class="t">${esc(e.title)}</div>
    ${e.fact ? `<div class="fact">${esc(e.fact)}</div>` : ''}${e.interp ? `<div class="interp">${esc(e.interp)}</div>` : ''}
    ${!e.fact && e.desc ? `<div class="x">${esc(e.desc)}</div>` : ''}
    ${e.timeNote ? `<div class="muted" style="font-size:12px">${esc(e.timeNote)}</div>` : ''}
    <div style="font-size:12px">${(e.urls || [e.url]).filter(Boolean).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(e.src && i === 0 ? e.src : '출처' + (i + 1))}</a>`).join(' · ')}</div></li>`;
}

// ── 선택 종목 ──
function addSel(code) {
  if (!S.sel.includes(code)) {
    if (S.sel.length >= 8) S.sel.shift();
    S.sel.push(code);
  }
  S.primary = code;
}
function openStock(code) { S.stock = code; setTab('stock'); }

// ── 차트 컴포넌트 ──
class Chart {
  constructor(host, opts) {
    this.host = host; this.o = opts; this.drag = null;
  }
  // series: [{key,name,color,s:{idx,c,v,pos},market}]
  draw(series, st) {
    this.series = series; this.st = st;
    const host = this.host;
    const W = Math.max(host.clientWidth || 800, 640), H = st.vol ? 486 : 390;
    const L = 58, R = 16, T = 14, MH = 330, VT = MH + T + 42, VH = st.vol ? 62 : 0, B = 22;
    this.geo = { W, H, L, R, T, MH, VT, VH };
    const [v0, v1] = st.view;
    const lastI = st.maxI;
    const x = (i) => L + (i - v0) / Math.max(1, v1 - v0) * (W - L - R);
    this.x = x;
    // 기준점
    const base = st.base;
    const vals = [];
    const lines = [];
    for (const se of series) {
      const s = se.s;
      if (!s) continue;
      let bk;
      if (st.mode === 'list') {
        bk = s.idx.findIndex((t) => t >= v0);
      } else if (st.mode === 'price') {
        bk = 0;
      } else {
        bk = s.pos.get(base);
        if (bk == null) { // 기준일 가격 없음 → 비교 불가 (몰래 다른 기준일로 정규화하지 않음)
          const prev = s.idx.findIndex((t) => t > base);
          if (prev > 0 && s.idx[prev - 1] < base) bk = prev - 1; // 기준일이 정지일 등으로 빠졌으면 직전 관측
          else { se.nobase = true; continue; }
        }
      }
      if (bk < 0) { se.nobase = true; continue; }
      se.nobase = false;
      const bv = s.c[bk];
      const pts = [];
      for (let k = 0; k < s.idx.length; k++) {
        const t = s.idx[k];
        if (t < v0 || t > v1 || t > lastI) continue;
        if (st.mode !== 'price' && st.mode !== 'list' && t < base) continue;
        let y = st.mode === 'price' ? s.c[k] : s.c[k] / bv * 100;
        if (st.mode === 'pct') y = y - 100;
        pts.push([t, y, k]);
        vals.push(y);
      }
      se.bv = bv; se.bk = bk;
      lines.push({ se, pts });
    }
    const useLog = st.log && st.mode !== 'pct';
    let ymin = Math.min(...vals), ymax = Math.max(...vals);
    if (!isFinite(ymin)) { ymin = 0; ymax = 1; }
    if (st.mode === 'pct') { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
    const pad = (ymax - ymin) * 0.06 || 1;
    let lo = useLog ? Math.max(ymin * 0.94, 1e-6) : ymin - pad, hi = useLog ? ymax * 1.06 : ymax + pad;
    const f = useLog ? Math.log : (v) => v;
    const y = (v) => T + MH - (f(v) - f(lo)) / (f(hi) - f(lo)) * MH;
    this.y = y;
    const css = getComputedStyle(document.documentElement);
    const ink3 = 'var(--ink-3)', line = 'var(--line-soft)';
    let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    // y grid
    const ticks = useLog ? logTicks(lo, hi) : niceTicks(lo, hi, 6);
    for (const tv of ticks) {
      const yy = y(tv);
      if (yy < T - 1 || yy > T + MH + 1) continue;
      svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="${line}"/>`;
      svg += `<text x="${L - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="${ink3}">${st.mode === 'pct' ? (tv > 0 ? '+' : '') + fmtN(tv, Math.abs(tv) < 10 ? 1 : 0) + '%' : fmtN(tv, tv < 10 ? 1 : 0)}</text>`;
    }
    if (st.mode === 'norm') svg += `<line x1="${L}" x2="${W - R}" y1="${y(100)}" y2="${y(100)}" stroke="var(--ink-3)" stroke-dasharray="4 3"/>`;
    if (st.mode === 'pct') svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--ink-3)" stroke-dasharray="4 3"/>`;
    // x ticks
    const span = v1 - v0;
    let lastLab = -1e9;
    for (let i = v0; i <= v1; i++) {
      const d = D.cal[i], pd = D.cal[i - 1];
      if (!pd) continue;
      const newY = d.slice(0, 4) !== pd.slice(0, 4), newM = d.slice(4, 6) !== pd.slice(4, 6);
      const q = ['01', '04', '07', '10'].includes(d.slice(4, 6));
      let lab = null;
      if (span > 900 ? newY : span > 300 ? (newM && q) : newM) lab = newY ? d.slice(0, 4) : `${+d.slice(4, 6)}월`;
      if (lab && x(i) - lastLab > 46) {
        svg += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${T + MH}" stroke="${line}"/>`;
        svg += `<text x="${x(i)}" y="${T + MH + 15}" text-anchor="middle" font-size="11" fill="${ink3}">${lab}</text>`;
        lastLab = x(i);
      }
    }
    // 선택 구간
    if (st.range) {
      const a = Math.max(st.range[0], v0), b = Math.min(st.range[1], v1);
      if (b > a) svg += `<rect x="${x(a)}" y="${T}" width="${x(b) - x(a)}" height="${MH}" fill="var(--sel)"/>`;
    }
    if (st.focus != null && st.focus >= v0 && st.focus <= v1) svg += `<line x1="${x(st.focus)}" x2="${x(st.focus)}" y1="${T}" y2="${T + MH}" stroke="var(--warn)" stroke-width="2" stroke-dasharray="3 3"/>`;
    // 거래량 (주 종목)
    if (st.vol) {
      const ps = lines.find((l) => l.se.key === st.primary && l.se.s.v);
      if (ps) {
        const vv = ps.pts.map((p) => ps.se.s.v[p[2]]);
        const vm = Math.max(1, ...vv);
        const bw = Math.max(1, (W - L - R) / Math.max(1, span) * 0.8);
        let path = '';
        ps.pts.forEach((p, k) => { const h = vv[k] / vm * VH; path += `M${x(p[0]).toFixed(1)} ${VT + VH}v${-h.toFixed(1)}`; });
        svg += `<path d="${path}" stroke="${ps.se.color}" stroke-opacity=".55" stroke-width="${bw.toFixed(1)}"/>`;
        svg += `<text x="${L}" y="${VT - 4}" font-size="11" fill="${ink3}">거래량 · ${esc(ps.se.name)} (최대 ${fmtN(vm)}주)</text>`;
      }
    }
    // 선
    for (const { se, pts } of lines) {
      if (!pts.length) continue;
      let d = '';
      pts.forEach((p, k) => { d += (k ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); });
      svg += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="${se.key === st.primary ? 2.4 : 1.6}" ${se.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
    }
    // 연속성 단절(기준가 재설정) 표시
    for (const { se } of lines) {
      for (const bi of (se.s.brk || [])) {
        if (bi < v0 || bi > v1) continue;
        svg += `<line x1="${x(bi)}" x2="${x(bi)}" y1="${T}" y2="${T + MH}" stroke="${se.color}" stroke-width="1.5" stroke-dasharray="2 3" opacity=".8"><title>${esc(se.name)} ${dstr(D.cal[bi])} 연속성 단절: 기준가 재설정(분할·합병·재상장·장기정지 후 재평가 등). 이 날을 걸친 수익률은 기계적 연결값</title></line>`;
      }
    }
    // 사건 마커
    this.marks = [];
    if (st.ev && st.events) {
      const byI = new Map();
      for (const e of st.events) {
        if (e._i == null || e._i < v0 || e._i > v1 || e._i > lastI) continue;
        if (!byI.has(e._i)) byI.set(e._i, []);
        byI.get(e._i).push(e);
      }
      for (const [i, es] of byI) {
        const xx = x(i), yy = T + MH - 4;
        const dir = es.some((e) => e.dir === '+') && es.some((e) => e.dir === '-') ? 'm' : es[0].dir === '+' ? 'p' : es[0].dir === '-' ? 'n' : 'm';
        const col = dir === 'p' ? 'var(--up)' : dir === 'n' ? 'var(--down)' : 'var(--warn)';
        svg += `<path d="M${xx} ${yy - 9}l5 9h-10z" fill="${col}" stroke="var(--panel)" stroke-width="1"/>`;
        this.marks.push({ i, x: xx, es });
      }
    }
    svg += `<rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${MH + (st.vol ? VH + 42 : 0)}" fill="transparent"/>`;
    svg += `<line class="gl" x1="0" x2="0" y1="${T}" y2="${T + MH}" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/>`;
    svg += `<rect class="dr" x="0" y="${T}" width="0" height="${MH}" fill="var(--accent)" opacity=".15" visibility="hidden"/>`;
    svg += `<g class="dots"></g></svg>`;
    host.innerHTML = svg;
    this.lines = lines;
    this.bind();
  }
  idxAt(px) {
    const { L, R, W } = this.geo;
    const [v0, v1] = this.st.view;
    const i = Math.round(v0 + (px - L) / (W - L - R) * (v1 - v0));
    return Math.max(v0, Math.min(Math.min(v1, this.st.maxI), i));
  }
  bind() {
    const svg = this.host.querySelector('svg');
    const hit = svg.querySelector('.hit'), gl = svg.querySelector('.gl'), dr = svg.querySelector('.dr'), dots = svg.querySelector('.dots');
    const tip = $('#tip');
    const pos = (ev) => { const r = svg.getBoundingClientRect(); const p = ev.touches ? ev.touches[0] : ev; return { x: p.clientX - r.left, y: p.clientY - r.top, cx: p.clientX, cy: p.clientY }; };
    const hide = () => { gl.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; tip.hidden = true; };
    const show = (p) => {
      const i = this.idxAt(p.x);
      const xx = this.x(i);
      gl.setAttribute('x1', xx); gl.setAttribute('x2', xx); gl.setAttribute('visibility', 'visible');
      let h = `<div class="d">${dstr(D.cal[i])}</div>`, dd = '';
      for (const { se, pts } of this.lines) {
        const k = se.s.pos.get(i);
        if (k == null || (this.st.mode !== 'price' && this.st.mode !== 'list' && i < this.st.base)) continue;
        const pt = pts.find((q) => q[0] === i);
        if (!pt) continue;
        dd += `<circle cx="${xx}" cy="${this.y(pt[1])}" r="4" fill="${se.color}" stroke="var(--panel)" stroke-width="1.5"/>`;
        const chg = k > 0 ? (se.s.c[k] / se.s.c[k - 1] - 1) * 100 : null;
        const val = this.st.mode === 'pct' ? fmtP(pt[1]) : this.st.mode === 'price' ? fmtN(pt[1], se.s.isIndex ? 2 : 0) + (se.s.isIndex ? 'pt' : '원(수정)') : fmtN(pt[1], 1);
        const cum = this.st.mode === 'price' ? '' : ` <span class="${cls(pt[1] - (this.st.mode === 'pct' ? 0 : 100))}">${this.st.mode === 'norm' || this.st.mode === 'list' ? fmtP(pt[1] - 100) : ''}</span>`;
        h += `<div class="r"><span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${se.color}"></i> ${esc(se.name)}</span><span>${val}${cum} <span class="muted">일 ${fmtP(chg)}</span></span></div>`;
        if (se.key === this.st.primary && se.s.v) h += `<div class="r muted"><span>거래량</span><span>${fmtN(se.s.v[k])}주</span></div>`;
      }
      const evs = this.marks.filter((m) => Math.abs(m.i - i) <= 0).flatMap((m) => m.es);
      if (evs.length) h += `<div class="ev">${evs.slice(0, 4).map((e) => `<div>● ${esc(e.title)} <span class="muted">[${esc(e.cat || '')} · ${e.grade || '-'}]</span></div>`).join('')}</div>`;
      h += `<div class="muted" style="margin-top:4px;font-size:11px">${this.st.mode === 'norm' ? `${dstr(D.cal[this.st.base])} = 100` : this.st.mode === 'pct' ? `${dstr(D.cal[this.st.base])} 대비 누적` : this.st.mode === 'list' ? '각 종목 첫 표시일 = 100' : '수정주가'} · KRX 종가</div>`;
      dots.innerHTML = dd;
      tip.innerHTML = h; tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let lx = p.cx + 16, ly = p.cy + 14;
      if (lx + tw > innerWidth - 8) lx = p.cx - tw - 16;
      if (ly + th > innerHeight - 8) ly = p.cy - th - 14;
      tip.style.left = Math.max(8, lx) + 'px'; tip.style.top = Math.max(8, ly) + 'px';
    };
    hit.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'touch') return;
      const p = pos(ev);
      this.drag = { a: this.idxAt(p.x), x0: p.x };
      hit.setPointerCapture(ev.pointerId);
    });
    hit.addEventListener('pointermove', (ev) => {
      const p = pos(ev);
      show(p);
      if (this.drag) {
        const a = Math.min(this.drag.x0, p.x), w = Math.abs(p.x - this.drag.x0);
        dr.setAttribute('x', a); dr.setAttribute('width', w); dr.setAttribute('visibility', 'visible');
      }
    });
    hit.addEventListener('pointerup', (ev) => {
      if (!this.drag) return;
      const p = pos(ev);
      const b = this.idxAt(p.x), a = this.drag.a;
      const moved = Math.abs(p.x - this.drag.x0);
      this.drag = null; dr.setAttribute('visibility', 'hidden');
      if (moved > 6 && Math.abs(b - a) >= 2) this.o.onSelect(Math.min(a, b), Math.max(a, b));
      else {
        const m = this.marks.find((mm) => Math.abs(mm.x - p.x) <= 7 && p.y > this.geo.T + this.geo.MH - 20);
        if (m) this.o.onEvent && this.o.onEvent(m.es);
        else this.o.onClick && this.o.onClick(this.idxAt(p.x));
      }
    });
    hit.addEventListener('pointerleave', () => { if (!this.drag) hide(); });
    hit.addEventListener('touchstart', (ev) => show(pos(ev)), { passive: true });
    hit.addEventListener('touchmove', (ev) => show(pos(ev)), { passive: true });
    hit.addEventListener('touchend', () => setTimeout(hide, 1800));
  }
}
function niceTicks(lo, hi, n) {
  const span = hi - lo; if (!(span > 0)) return [lo];
  const step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= lo && v <= hi) out.push(v); }
  return out.length >= 2 ? out : niceTicks(lo, hi, 5);
}

// ── 구간 계산 ──
function rangeStats(s, a, b) {
  if (!s) return null;
  let ka = s.pos.get(a), kb = s.pos.get(b);
  if (ka == null) { const k = s.idx.findIndex((t) => t >= a); if (k <= 0) return null; ka = s.idx[k] === a ? k : k - 1; if (ka < 0) return null; }
  if (kb == null) { let k = -1; for (let q = 0; q < s.idx.length && s.idx[q] <= b; q++) k = q; if (k < 0) return null; kb = k; }
  if (s.idx[ka] > a) return null; // 기준일에 가격 없음
  const ret = (s.c[kb] / s.c[ka] - 1) * 100;
  let peak = s.c[ka], mdd = 0, pkI = s.idx[ka], trI = s.idx[ka], bestPk = pkI;
  for (let k = ka; k <= kb; k++) {
    if (s.c[k] > peak) { peak = s.c[k]; pkI = s.idx[k]; }
    const dd = s.c[k] / peak - 1;
    if (dd < mdd) { mdd = dd; trI = s.idx[k]; bestPk = pkI; }
  }
  return { ret, mdd: mdd * 100, peakI: bestPk, troughI: trI, endI: s.idx[kb] };
}
function benchFor(code) { return secOf(code).m === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI'; }

// ── 비교 차트 탭 ──
let mainChart = null;
async function renderChartTab() {
  const el = $('#tab-chart');
  if (!S.sel.length) {
    const U = D.rank[pid()].universe[uniKey()];
    S.sel = U.top.slice(0, 3).map((r) => r.code);
    S.primary = S.sel[0];
  }
  const P = period();
  if (!S.view) S.view = [Math.max(0, (P.s_ti ?? D.ci.get(P.startRef) ?? 0) - 60), D.cal.length - 1];
  el.innerHTML = `
  <div class="grid3">
    <div class="card">
      <div class="toolbar">
        <div class="seg" id="cMode"><button data-m="norm">기준일=100</button><button data-m="pct">누적 수익률</button><button data-m="price">수정주가</button><button data-m="list">상장일 기준</button></div>
        <label><input type="checkbox" id="cLog"> 로그</label>
        <label><input type="checkbox" id="cVol"> 거래량</label>
        <label><input type="checkbox" id="cEv"> 사건</label>
        <span class="sep"></span>
        <label><input type="checkbox" id="bK"> 코스피</label><label><input type="checkbox" id="bQ"> 코스닥</label>
        <span class="sep"></span>
        <button class="btn sm" data-z="period">선택 기간</button><button class="btn sm" data-z="6m">6개월</button><button class="btn sm" data-z="1y">1년</button><button class="btn sm" data-z="3y">3년</button><button class="btn sm" data-z="all">전체</button>
        <button class="btn sm" id="zSel" title="드래그한 구간으로 확대">선택 구간 확대</button>
      </div>
      <div class="chips" id="chips"></div>
      <div class="chartbox" id="cbox"><div class="empty">가격 불러오는 중…</div></div>
      <div class="legend-note" id="cNote"></div>
      <div class="toolbar" style="margin-top:8px">
        <span class="muted" style="font-size:12px">드래그 = 구간 선택 · 사건 ▲ 클릭 = 상세 · 휴대폰은 아래에서 날짜 지정</span>
        <input type="date" id="rA"> ~ <input type="date" id="rB"> <button class="btn sm" id="rGo">구간 적용</button>
      </div>
      <h3>핵심 날짜 이동 <span class="hint">주 종목 기준 · 추세 전환 후보는 사후 계산</span></h3>
      <div id="keydates" class="kd"></div>
    </div>
    <div class="card side" id="side"></div>
  </div>
  <div class="card"><h2>화면 구간의 사건 목록 <button class="btn sm" id="evCsv" style="margin-left:auto">CSV</button></h2><div id="evTable"></div></div>`;
  $$('#cMode button').forEach((b) => { b.classList.toggle('on', b.dataset.m === S.mode); b.onclick = () => { S.mode = b.dataset.m; renderChartTab(); }; });
  $('#cLog').checked = S.log; $('#cLog').onchange = (e) => { S.log = e.target.checked; drawMain(); };
  $('#cVol').checked = S.vol; $('#cVol').onchange = (e) => { S.vol = e.target.checked; drawMain(); };
  $('#cEv').checked = S.ev; $('#cEv').onchange = (e) => { S.ev = e.target.checked; drawMain(); };
  $('#bK').checked = S.bench.KOSPI; $('#bK').onchange = (e) => { S.bench.KOSPI = e.target.checked; drawMain(); };
  $('#bQ').checked = S.bench.KOSDAQ; $('#bQ').onchange = (e) => { S.bench.KOSDAQ = e.target.checked; drawMain(); };
  $$('[data-z]').forEach((b) => b.onclick = () => { zoom(b.dataset.z); });
  $('#zSel').onclick = () => { if (S.range) { S.view = [Math.max(0, S.range[0] - 5), Math.min(D.cal.length - 1, S.range[1] + 5)]; drawMain(); } };
  $('#rGo').onclick = () => { const a = idxOnOrAfter($('#rA').value), b = idxOnOrBefore($('#rB').value); if (a != null && b > a) { S.range = [a, b]; drawMain(); } };
  $('#evCsv').onclick = exportEvCsv;
  mainChart = new Chart($('#cbox'), {
    onSelect: (a, b) => { S.range = [a, b]; drawMain(); },
    onEvent: (es) => showEvents(es),
    onClick: () => {},
  });
  await drawMain();
}
function zoom(z) {
  const last = D.cal.length - 1, P = period();
  const s = D.ci.get(P.startRef) ?? 0, e = D.ci.get(P.endDate) ?? last;
  if (z === 'period') { S.view = [s, e]; S.range = [s, e]; }
  else if (z === '6m') S.view = [Math.max(0, last - 125), last];
  else if (z === '1y') S.view = [Math.max(0, last - 250), last];
  else if (z === '3y') S.view = [Math.max(0, last - 750), last];
  else S.view = [0, last];
  drawMain();
}
async function seriesFor(codes) {
  const out = [];
  for (let k = 0; k < codes.length; k++) {
    const c = codes[k];
    out.push({ key: c, name: secOf(c).n, color: COLORS[k % COLORS.length], s: await px(c), market: secOf(c).m });
  }
  if (S.bench.KOSPI) out.push({ key: 'KOSPI', name: '코스피', color: '#667085', s: idxSeries('KOSPI'), dash: true });
  if (S.bench.KOSDAQ) out.push({ key: 'KOSDAQ', name: '코스닥', color: '#98a2b3', s: idxSeries('KOSDAQ'), dash: true });
  return out;
}
async function drawMain() {
  saveHash();
  const series = await seriesFor(S.sel);
  const maxI = maxIdx();
  let [v0, v1] = S.view;
  v1 = Math.min(v1, maxI); if (v1 - v0 < 5) v0 = Math.max(0, v1 - 60);
  const view = [v0, v1];
  const base = S.mode === 'norm' || S.mode === 'pct' ? v0 : v0;
  const events = evsForCodes(S.sel);
  mainChart.draw(series, { view, base, maxI, mode: S.mode, log: S.log, vol: S.vol, ev: S.ev, range: S.range, focus: S.focus, primary: S.primary, events });
  // 칩
  $('#chips').innerHTML = series.map((se) => `<span class="chip" ${se.s && se.s.isIndex ? '' : `data-c="${se.key}"`}><i style="background:${se.color}"></i>${esc(se.name)}${se.key === S.primary ? ' <b style="font-size:11px">주</b>' : ''}${se.nobase ? ' <span class="badge flag">기준일 가격 없음 → 상장일 기준 모드에서 비교</span>' : ''}${se.s && !se.s.isIndex ? `<button data-x="${se.key}" aria-label="빼기">×</button>` : ''}</span>`).join('');
  $$('#chips [data-x]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); S.sel = S.sel.filter((c) => c !== b.dataset.x); if (S.primary === b.dataset.x) S.primary = S.sel[0] || null; drawMain(); });
  $$('#chips .chip[data-c]').forEach((ch) => ch.onclick = () => { S.primary = ch.dataset.c; drawMain(); });
  $('#cNote').textContent = `${S.mode === 'norm' ? `공통 기준일 ${dstr(D.cal[base])} 종가 = 100` : S.mode === 'pct' ? `${dstr(D.cal[base])} 종가 대비 누적 수익률` : S.mode === 'list' ? '각 종목의 화면 첫 표시일(상장일이 늦으면 상장일) = 100 — 공통 기준일 비교가 아님' : '수정주가(원) — 액면분할·무상증자 등 반영, 배당 미반영'} · 최대 8종목 · 이름 칩 클릭 = 주 종목 지정`;
  if (S.range) { $('#rA').value = dstr(D.cal[S.range[0]]); $('#rB').value = dstr(D.cal[S.range[1]]); }
  renderSide(series, events);
  renderKeyDates(series);
  renderEvTable(events, view);
}
function showEvents(es) {
  $('#modalBody').innerHTML = `<h2 style="margin-bottom:8px">사건 상세</h2><ul class="evlist">${es.map(evItem).join('')}</ul>`;
  $('#modal').hidden = false;
}
function renderSide(series, events) {
  const side = $('#side');
  if (!S.range) {
    side.innerHTML = `<h2>구간 복기 요약</h2><div class="empty">차트에서 시작일~종료일을 드래그하면 이 패널이 그 구간의 수익률·최대 낙폭·주요 사건·원인 구분으로 바뀝니다.</div>`;
    return;
  }
  const [a, b] = S.range;
  const codes = S.sel;
  const stats = series.filter((se) => se.s && !se.s.isIndex).map((se) => {
    const st = rangeStats(se.s, a, b);
    const bk = benchFor(se.key);
    const bs = rangeStats(idxSeries(bk), a, b);
    return { se, st, bk, bs };
  });
  const prim = stats.find((x) => x.se.key === S.primary) || stats[0];
  const inR = events.filter((e) => e._i != null && e._i >= a && e._i <= b);
  const seen = new Set();
  const ranked = inR.sort((x, y) => evScore(y, codes) - evScore(x, codes)).filter((e) => { const k = e.group || e.id; if (seen.has(k)) return false; seen.add(k); return true; });
  const top = ranked.slice(0, 7);
  const before = events.filter((e) => e._i != null && e._i < a && e._i >= a - 10).sort((x, y) => evScore(y, codes) - evScore(x, codes)).slice(0, 2);
  // 결론
  let concl;
  if (!prim || !prim.st) concl = '선택 구간 시작일에 주 종목 가격이 없어 수익률을 계산할 수 없습니다.';
  else {
    const lead = top.filter((e) => (e.codes || []).includes(prim.se.key))[0] || top[0];
    const nm = prim.se.name;
    concl = `${nm} ${fmtP(prim.st.ret)} (${prim.bk === 'KOSPI' ? '코스피' : '코스닥'} ${fmtP(prim.bs?.ret)}, 초과 ${fmtPP(prim.bs ? prim.st.ret - prim.bs.ret : null)}).`;
    if (lead) {
      concl += ` 기록된 사건 중 가장 관련성이 높은 것은 ${lead.date} ‘${lead.title}’(${lead.cat || '기타'}, 근거 ${lead.grade || '-'})`;
      concl += lead.grade === 'C' ? ' — 시간적 일치 수준이라 원인은 ‘가능한 해석’입니다.' : (top.length > 1 ? `이고, 이후 ${top.filter((e) => e !== lead && e._i > lead._i).slice(0, 1).map((e) => `‘${e.title}’`).join('') || '추가 사건'}로 이어진 흐름으로 해석됩니다.` : '입니다.');
    } else concl += ' 이 구간에 연결된 사건 기록이 없어 원인 미확인입니다.';
  }
  const catCnt = {};
  for (const e of top) catCnt[e.cat || '기타'] = (catCnt[e.cat || '기타'] || 0) + 1;
  const sr = prim ? stockRes(prim.se.key) : null;
  // 실적 연결: 구간 안(및 60일 뒤까지) 발표된 분기 실적
  const fund = prim ? D.fund[prim.se.key] : null;
  let fundTxt = '';
  if (fund && fund.q) {
    const qs = fund.q.filter((q) => q.rcept && D.ci.has(q.rcept) ? true : q.rcept).filter((q) => { const i = idxOnOrAfter(q.rcept); return i != null && i >= a && i <= Math.min(b + 60, D.cal.length - 1) && (!hideFuture() || q.rcept <= S.pit); });
    if (qs.length) fundTxt = qs.map((q) => `${q.q} 영업이익 ${fmtN(q.op, 0)}억 (YoY ${fmtP(q.opYoY, 1)}, 발표 ${dstr(q.rcept)})`).join(' · ');
  }
  const multi = codes.length > 1;
  const common = multi ? top.filter((e) => evScope(e, codes) === 'common') : [];
  const own = multi ? codes.map((c) => ({ c, es: top.filter((e) => evScope(e, codes) === 'co:' + c) })) : [];
  const rowsMissing = prim ? Object.entries(D.rank).filter(([p]) => { const P = period(p); return P && D.ci.get(P.endDate) >= a && D.ci.get(P.startRef) <= b; }).filter(([p, R]) => [...R.universe[uniKey()].top, ...R.universe[uniKey()].bot].some((r) => r.code === prim.se.key) && !rowRes(p, prim.se.key)?.reason).map(([p]) => period(p).label) : [];
  side.innerHTML = `
    <h2>구간 복기 요약 <span class="hint">${dstr(D.cal[a])} ~ ${dstr(D.cal[b])} · ${b - a}거래일</span></h2>
    <h3>① 한 줄 결론</h3><div>${esc(concl)}</div>
    <h3>② 선택 구간 수치</h3>
    <div class="tw"><table><thead><tr><th>종목</th><th class="n">수익률</th><th class="n">벤치마크</th><th class="n">초과</th><th class="n">최대 낙폭</th></tr></thead><tbody>
    ${stats.map(({ se, st, bk, bs }) => `<tr style="cursor:default"><td><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${se.color}"></i> ${esc(se.name)}${(se.s.brk || []).some((i) => i > a && i <= b) ? ' <span class="badge flag" title="구간 안에 기준가 재설정(분할·합병·재상장 등)이 있어 수익률은 기계적 연결값">연속성 단절 포함</span>' : ''}</td>${st ? `<td class="n">${pctHtml(st.ret)}</td><td class="n">${fmtP(bs?.ret)}<div class="muted" style="font-size:11px">${bk === 'KOSPI' ? '코스피' : '코스닥'}</div></td><td class="n ${cls(bs ? st.ret - bs.ret : null)}">${fmtPP(bs ? st.ret - bs.ret : null)}</td><td class="n neg">${fmtP(st.mdd)}<div class="muted" style="font-size:11px">${dstr(D.cal[st.peakI]).slice(2)}→${dstr(D.cal[st.troughI]).slice(2)}</div></td>` : '<td colspan="4" class="muted">기준일 가격 없음</td>'}</tr>`).join('')}
    </tbody></table></div>
    <h3>③ 주요 사건 ${top.length ? `${top.length}건` : ''} <span class="hint">중요도순 · 재전송 기사는 하나로</span></h3>
    ${multi ? `${common.length ? `<div class="muted" style="font-size:12px;font-weight:700">공통 사건</div><ul class="evlist">${common.map(evItem).join('')}</ul>` : ''}${own.filter((o) => o.es.length).map((o) => `<div class="muted" style="font-size:12px;font-weight:700;margin-top:6px">${esc(secOf(o.c).n)} 고유</div><ul class="evlist">${o.es.map(evItem).join('')}</ul>`).join('')}` : (top.length ? `<ul class="evlist">${top.map(evItem).join('')}</ul>` : '')}
    ${!top.length ? '<div class="empty">이 구간에 연결된 사건 기록이 없습니다 — 원인 미확인</div>' : ''}
    ${before.length ? `<div class="muted" style="font-size:12px;font-weight:700;margin-top:6px">구간 직전 (10거래일 이내)</div><ul class="evlist">${before.map(evItem).join('')}</ul>` : ''}
    <h3>④ 원인 구분</h3><div class="cats">${CATS.map((c) => `<span class="badge ${catCnt[c] ? 'B' : 'no'}">${c} ${catCnt[c] || 0}</span>`).join('')}</div>
    <h3>⑤ 복기 포인트</h3>
    <ul class="lines">
      <li><b>움직임 전 확인 가능했던 신호</b> · ${sr && sr.signals && !(hideFuture()) ? esc(listTxt(sr.signals)) : sr && sr.signals ? esc(listTxt(sr.signals)) : '<span class="muted">정리 전</span>'}</li>
      <li><b>기대가 숫자로 연결됐나</b> · ${fundTxt ? esc(fundTxt) : '<span class="muted">구간 안에 발표된 분기 실적 자료 없음</span>'}</li>
      <li><b>지속·반전 확인 지표</b> · ${sr && (sr.sustain || sr.recheck) ? esc(listTxt(sr.sustain || sr.recheck)) : '<span class="muted">정리 전</span>'}</li>
    </ul>
    <h3>⑥ 근거가 부족한 부분</h3>
    <ul class="lines">
      ${top.filter((e) => e.grade === 'C').length ? `<li>근거 C(시간적 일치) 사건 ${top.filter((e) => e.grade === 'C').length}건 — 원인으로 단정하지 않음</li>` : ''}
      ${rowsMissing.length ? `<li>원인 조사 미완료 기간: ${esc(rowsMissing.join(', '))}</li>` : ''}
      ${!top.length ? '<li>사건 기록 없음 → 원인 미확인</li>' : ''}
      ${top.length && !top.filter((e) => e.grade === 'C').length && !rowsMissing.length ? '<li class="muted">특이 사항 없음 (A 등급도 엄밀한 인과 증명은 아님)</li>' : ''}
    </ul>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" id="sNote">이 구간 메모</button><button class="btn sm" id="sClr">선택 해제</button></div>`;
  $('#sClr').onclick = () => { S.range = null; drawMain(); };
  $('#sNote').onclick = () => { openNote({ code: S.primary, period: `${D.cal[a]}-${D.cal[b]}` }); };
  side.querySelectorAll('[data-ev]').forEach((li) => li.style.cursor = 'default');
}
const listTxt = (v) => Array.isArray(v) ? v.join(' / ') : String(v || '');
function renderKeyDates(series) {
  const se = series.find((x) => x.key === S.primary);
  const el = $('#keydates');
  if (!se || !se.s) { el.innerHTML = '<span class="muted">주 종목이 없습니다</span>'; return; }
  const s = se.s, maxI = maxIdx();
  const rets = [];
  for (let k = 1; k < s.idx.length; k++) if (s.idx[k] <= maxI) rets.push([s.idx[k], (s.c[k] / s.c[k - 1] - 1) * 100]);
  const ups = [...rets].sort((x, y) => y[1] - x[1]).slice(0, 5), dns = [...rets].sort((x, y) => x[1] - y[1]).slice(0, 5);
  // 추세 전환 후보: 지그재그 25%
  const zz = [];
  let dir = 0, ext = 0, extI = s.idx[0];
  for (let k = 1; k < s.idx.length && s.idx[k] <= maxI; k++) {
    const v = s.c[k];
    if (dir >= 0) { if (v > s.c[ext]) { ext = k; } else if (v < s.c[ext] * 0.75) { zz.push([s.idx[ext], '고점']); dir = -1; ext = k; } }
    if (dir < 0) { if (v < s.c[ext]) { ext = k; } else if (v > s.c[ext] * 1.25) { zz.push([s.idx[ext], '저점']); dir = 1; ext = k; } }
  }
  const fund = D.fund[S.primary];
  const earn = fund && fund.q ? fund.q.filter((q) => q.rcept && (!hideFuture() || q.rcept <= S.pit)).slice(-12).map((q) => [idxOnOrAfter(q.rcept), `${q.q} 실적`]) : [];
  const big = evsForCodes([S.primary], { market: false }).filter((e) => e.grade === 'A').slice(-10).map((e) => [e._i, e.title.slice(0, 14)]);
  const btn = (i, lab, c = '') => i == null ? '' : `<button class="btn sm ${c}" data-i="${i}">${dstr(D.cal[i]).slice(2)} ${esc(lab)}</button>`;
  el.innerHTML = `
    <div style="width:100%"><b style="font-size:12px">급등일</b> ${ups.map(([i, r]) => btn(i, fmtP(r, 1))).join(' ')}</div>
    <div style="width:100%"><b style="font-size:12px">급락일</b> ${dns.map(([i, r]) => btn(i, fmtP(r, 1))).join(' ')}</div>
    <div style="width:100%"><b style="font-size:12px">추세 전환 후보(±25% 되돌림, 사후 계산)</b> ${zz.slice(-10).map(([i, l]) => btn(i, l)).join(' ') || '<span class="muted">없음</span>'}</div>
    <div style="width:100%"><b style="font-size:12px">실적 발표일</b> ${earn.map(([i, l]) => btn(i, l)).join(' ') || '<span class="muted">자료 없음</span>'}</div>
    <div style="width:100%"><b style="font-size:12px">공시·수주·정책(근거 A)</b> ${big.map(([i, l]) => btn(i, l)).join(' ') || '<span class="muted">자료 없음</span>'}</div>
    <div class="legend-note">통계적으로 움직임이 컸다는 사실만으로 원인이 확정되지 않습니다. 날짜를 누르면 앞뒤 40거래일로 이동합니다.</div>`;
  el.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { const i = +b.dataset.i; S.focus = i; S.view = [Math.max(0, i - 40), Math.min(D.cal.length - 1, i + 40)]; drawMain(); });
}
function renderEvTable(events, view) {
  const rows = events.filter((e) => e._i != null && e._i >= view[0] && e._i <= view[1]).sort((a, b) => a.date < b.date ? -1 : 1);
  S._evRows = rows;
  $('#evTable').innerHTML = rows.length ? `<div class="tw" style="max-height:420px"><table><thead><tr><th>날짜</th><th>공개 시점</th><th>대상</th><th>사건</th><th>범주</th><th>방향</th><th class="n">가격 반응</th><th>근거</th><th>출처</th></tr></thead><tbody>${rows.map((e) => `<tr style="cursor:default"><td class="n">${esc(e.date)}</td><td>${esc(e.seen || e.date)}${e.timeNote ? `<div class="muted" style="font-size:11px">${esc(e.timeNote)}</div>` : ''}</td><td>${esc((e.codes || []).map((c) => secOf(c).n).join(', ') || '시장 전체')}</td><td><b>${esc(e.title)}</b>${e.fact ? `<div style="font-size:12px">${esc(e.fact)}</div>` : ''}</td><td>${esc(e.cat || '')}</td><td>${e.dir === '+' ? '<span class="dir-p">긍정</span>' : e.dir === '-' ? '<span class="dir-n">부정</span>' : '<span class="dir-m">혼합</span>'}</td><td class="n">${e.pr != null ? pctHtml(e.pr) : '–'}</td><td>${gradeBadge(e.grade)}</td><td>${(e.urls || [e.url]).filter(Boolean).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${i + 1}</a>`).join(' ')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">화면 구간에 기록된 사건이 없습니다.</div>';
}

// ── 종목 복기 ──
let stockChart = null;
async function renderStock() {
  const el = $('#tab-stock');
  const code = S.stock || S.primary || D.rank[pid()].universe[uniKey()].top[0]?.code;
  S.stock = code;
  const s = secOf(code), sr = stockRes(code);
  const apps = [];
  for (const P of D.meta.periods) {
    const R = D.rank[P.id];
    for (const [u, U] of Object.entries(R.universe)) {
      if (u !== uniKey()) continue;
      const t = U.top.find((r) => r.code === code), b = U.bot.find((r) => r.code === code);
      if (t) apps.push({ P, r: t, dir: '상위' }); if (b) apps.push({ P, r: b, dir: '하위' });
    }
  }
  const hf = hideFuture();
  const phases = (sr?.phases || []).filter((p) => !hf || dnum(p.from) <= S.pit);
  el.innerHTML = `
  <div class="card">
    <h2>${esc(s.n)} <span class="hint">${code} · ${s.m === 'KOSPI' ? '코스피' : s.m === 'KOSDAQ' ? '코스닥' : esc(s.m || '')}${s.listed === false ? ` · 상장폐지(마지막 ${dstr(s.last)})` : ''}${s.fg ? ' · 해외기업' : ''}</span>
      <button class="btn sm" id="stAdd" style="margin-left:auto">비교 차트에 추가</button><button class="btn sm" id="stNote">복기 메모</button></h2>
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span class="tag">대섹터 ${esc(s.s || '미분류')}</span><span class="tag">소섹터 ${esc(s.ss || '–')}</span>${(s.th || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join('')}
      <span class="muted" style="font-size:12px">KRX 업종: ${esc(s.ind || '–')}${s.prod ? ' · 주요제품: ' + esc(s.prod) : ''}${s.clsNote ? ' · ' + esc(s.clsNote) : ''}</span>
    </div>
    <div style="margin-top:10px;font-size:15px;font-weight:700">${sr?.conclusion && !hf ? esc(sr.conclusion) : sr?.conclusion ? '<span class="muted">결론은 사후 정보라 당시 정보 모드에서 숨김</span>' : '<span class="muted">한 문장 복기 결론: 원인 조사 미완료</span>'}</div>
  </div>
  <div class="grid3">
    <div class="card">
      <h2>주가·거래량과 사건 <span class="hint">드래그하면 비교 차트 탭에서 구간 분석</span></h2>
      <div class="chartbox" id="sbox"></div>
      <h3>순위 등장 이력 <span class="hint">${S.mkt === 'ALL' ? '전체' : S.mkt} · ${S.filt === 'inv' ? '투자 가능' : '전 종목'} 기준</span></h3>
      <div class="tw"><table><thead><tr><th>기간</th><th>구분</th><th class="n">순위</th><th class="n">기간 수익률</th><th class="n">최대 낙폭</th><th>핵심 이유</th><th>근거</th></tr></thead><tbody>
      ${apps.map(({ P, r, dir }) => { const rr = rowRes(P.id, code); const hid = hf && P.endDate > S.pit; return `<tr data-p="${P.id}"><td>${esc(P.label)}</td><td>${dir}</td><td class="n">${r.rank}</td><td class="n">${hid ? '–' : pctHtml(r.ret)}</td><td class="n">${hid ? '–' : fmtP(r.mdd)}</td><td class="reason">${hid ? '<span class="muted">숨김</span>' : rr?.reason ? esc(rr.reason) : '<span class="pend">원인 조사 미완료</span>'}</td><td>${hid ? '' : gradeBadge(rr?.grade, rr?.status)}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">이 기준의 상위·하위 15에 든 적이 없습니다.</td></tr>'}
      </tbody></table></div>
      <h3>기간별 수익률 <span class="hint">전 기간 계산값 (순위 진입 여부와 무관)</span></h3>
      ${periodHeat([code])}
    </div>
    <div class="card side">
      <h2>복기 흐름</h2>
      ${phases.length ? `<div class="phase">${phases.map((p) => `<div><b>${esc(p.stage)}</b><span class="num">${esc(p.from || '')}${p.to ? ' ~ ' + esc(p.to) : ''}</span><div>${esc(p.desc)}</div></div>`).join('')}</div>` : '<div class="empty">시작 → 기대 확대 → 실적 확인 → 과열 → 논리 훼손 흐름이 아직 정리되지 않았습니다.</div>'}
      <h3>당시 확인할 수 있었던 신호</h3>${sr?.signals ? `<ul class="lines">${[].concat(sr.signals).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="muted">정리 전</div>'}
      ${hf ? '<div class="empty" style="margin-top:8px">이후 결과·교훈은 당시 정보 모드에서 숨김</div>' : `
      <h3>이후 확인된 결과</h3>${sr?.outcome ? `<ul class="lines">${[].concat(sr.outcome).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="muted">정리 전</div>'}
      <h3>상승 지속 / 하락 전환 조건</h3>${sr?.sustain || sr?.breakc ? `<ul class="lines">${[].concat(sr.sustain || []).map((x) => `<li>지속 · ${esc(x)}</li>`).join('')}${[].concat(sr.breakc || []).map((x) => `<li>전환 · ${esc(x)}</li>`).join('')}</ul>` : '<div class="muted">정리 전</div>'}
      <h3>복기 교훈</h3>${sr?.lessons ? `<ul class="lines">${[].concat(sr.lessons).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div class="muted">정리 전</div>'}
      ${sr?.metrics?.length ? `<h3>사업 지표</h3><div class="tw"><table><thead><tr><th>지표</th><th class="n">값</th><th>시점</th><th>출처</th></tr></thead><tbody>${sr.metrics.map((m) => `<tr style="cursor:default"><td>${esc(m.name)}</td><td class="n">${esc(m.value)} ${esc(m.unit || '')}</td><td>${esc(m.date || '')}</td><td>${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">링크</a>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}`}
    </div>
  </div>
  <div class="card"><h2>분기 실적 <span class="hint">DART 주요계정 · 억원 · 대상 분기와 발표(접수)일 구분 · 성장률 우선</span></h2><div id="fundBox"></div></div>
  <div class="card"><h2>주요 사건과 출처</h2><div id="stEv"></div></div>`;
  $('#stAdd').onclick = () => { addSel(code); setTab('chart'); };
  $('#stNote').onclick = () => openNote({ code, period: pid() });
  el.querySelectorAll('tr[data-p]').forEach((tr) => tr.onclick = () => { S.year = +tr.dataset.p.slice(0, 4); S.kind = tr.dataset.p.slice(4); setTab('home'); });
  renderFund(code);
  const evs = evsForCodes([code], { market: false }).sort((a, b) => a.date < b.date ? -1 : 1);
  $('#stEv').innerHTML = evs.length ? `<ul class="evlist">${evs.map(evItem).join('')}</ul>` : '<div class="empty">이 종목에 연결된 사건이 아직 없습니다 (원인 조사 미완료).</div>';
  const s0 = await px(code);
  if (!s0) { $('#sbox').innerHTML = '<div class="empty">가격 파일이 없습니다</div>'; return; }
  stockChart = new Chart($('#sbox'), {
    onSelect: (a, b) => { S.sel = [code, ...S.sel.filter((c) => c !== code)].slice(0, 8); S.primary = code; S.range = [a, b]; S.view = [Math.max(0, a - 40), Math.min(D.cal.length - 1, b + 40)]; setTab('chart'); },
    onEvent: (es) => showEvents(es),
  });
  const bk = benchFor(code);
  const series = [{ key: code, name: s.n, color: COLORS[0], s: s0 }, { key: bk, name: bk === 'KOSPI' ? '코스피' : '코스닥', color: '#667085', s: idxSeries(bk), dash: true }];
  const v0 = s0.idx[0], v1 = Math.min(s0.idx[s0.idx.length - 1], maxIdx());
  stockChart.draw(series, { view: [v0, v1], base: v0, maxI: maxIdx(), mode: 'norm', log: true, vol: true, ev: true, range: null, primary: code, events: evsForCodes([code], { market: false }) });
}
function periodHeat(codes) {
  const ps = D.meta.periods;
  const hf = hideFuture();
  const cell = (v, P) => {
    if (hf && P.endDate > S.pit) return '<td class="muted">–</td>';
    if (v == null) return '<td class="muted">–</td>';
    const a = Math.min(1, Math.abs(v) / 100);
    const bg = v >= 0 ? `rgba(180,35,24,${0.08 + a * 0.55})` : `rgba(23,92,211,${0.08 + a * 0.55})`;
    return `<td style="background:${bg};${a > 0.55 ? 'color:#fff;' : ''}" title="${esc(P.label)} ${fmtP(v)}">${fmtP(v, 1)}</td>`;
  };
  return `<div class="tw"><table class="heat"><thead><tr><th>종목</th>${ps.map((P) => `<th class="n" title="${esc(P.label)}">${String(P.year).slice(2)}${P.kind === 'FY' ? '년' : P.kind === 'H1' ? '상' : '하'}</th>`).join('')}</tr></thead><tbody>
  ${codes.map((c) => `<tr data-code="${c}"><td style="text-align:left"><b>${esc(secOf(c).n)}</b></td>${ps.map((P) => cell((secOf(c).pr || {})[P.id], P)).join('')}</tr>`).join('')}</tbody></table></div>
  <div class="legend-note">빨강=상승, 파랑=하락, 진할수록 큼(±100% 이상 최대). ‘–’ = 기간 시작 시 미상장·기간 중 거래 종료 등으로 정규 계산 불가.</div>`;
}
function renderFund(code) {
  const f = D.fund[code];
  const box = $('#fundBox');
  if (!f || !f.q || !f.q.length) { box.innerHTML = '<div class="empty">DART 분기 주요계정 자료가 없습니다 (해외 기업·결산월 차이·상장폐지 법인 매핑 실패 등). 원인은 데이터·검증 탭에 기록.</div>'; return; }
  let q = f.q;
  if (hideFuture()) q = q.filter((x) => x.rcept && x.rcept <= S.pit);
  const W = 760, H = 200, L = 50, R = 10, T = 16, B = 28;
  const vals = q.map((x) => x.op).filter((v) => v != null);
  const mx = Math.max(1, ...vals.map(Math.abs));
  const bw = (W - L - R) / Math.max(1, q.length);
  const y0 = T + (H - T - B) / 2;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;min-width:560px">`;
  svg += `<line x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}" stroke="var(--line)"/>`;
  svg += `<text x="${L - 6}" y="${T + 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">${fmtN(mx)}</text><text x="${L - 6}" y="${H - B}" text-anchor="end" font-size="10" fill="var(--ink-3)">−${fmtN(mx)}</text>`;
  q.forEach((x, k) => {
    if (x.op == null) return;
    const h = Math.abs(x.op) / mx * (H - T - B) / 2;
    const yy = x.op >= 0 ? y0 - h : y0;
    svg += `<rect x="${L + k * bw + 2}" y="${yy}" width="${Math.max(2, bw - 4)}" height="${Math.max(0.5, h)}" fill="${x.op >= 0 ? 'var(--up)' : 'var(--down)'}" opacity=".75"><title>${x.q} 영업이익 ${fmtN(x.op)}억원 · YoY ${fmtP(x.opYoY, 1)} · 발표 ${dstr(x.rcept)}</title></rect>`;
    if (k % Math.ceil(q.length / 12) === 0) svg += `<text x="${L + k * bw + bw / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--ink-3)">${x.q.slice(2)}</text>`;
  });
  svg += '</svg>';
  box.innerHTML = `<div class="legend-note">${esc(f.basis || '')} · 단위 억원 · 2·3분기는 당시 공시된 3개월 값, 4분기는 연간 − 3분기 누적 · 막대=영업이익(마우스 올리면 값) · ‘정정’은 정정본만 남아 법정 제출기한을 공개일로 씀</div><div class="tw">${svg}</div>
  <div class="tw" style="max-height:420px"><table><thead><tr><th>대상 분기</th><th>발표(접수)일</th><th>보고서</th><th class="n">매출액</th><th class="n">매출 YoY</th><th class="n">영업이익</th><th class="n">영업이익 YoY</th><th class="n">영업이익률</th><th class="n">이익률 YoY 변화</th><th class="n">순이익</th></tr></thead><tbody>
  ${[...q].reverse().map((x) => `<tr style="cursor:default"><td>${x.q}</td><td class="n">${dstr(x.rcept)}${x.rnote ? ` <span class="badge flag" title="${esc(x.rnote)}">정정</span>` : ''}</td><td>${esc(x.rep || '')}${x.basis ? ` <span class="muted">${esc(x.basis)}</span>` : ''}</td><td class="n">${fmtN(x.rev)}</td><td class="n ${cls(x.revYoY)}">${fmtP(x.revYoY, 1)}</td><td class="n">${fmtN(x.op)}</td><td class="n ${cls(x.opYoY)}">${fmtP(x.opYoY, 1)}</td><td class="n">${x.opm == null ? '–' : x.opm.toFixed(1) + '%'}</td><td class="n ${cls(x.opmChg)}">${fmtPP(x.opmChg, 1)}</td><td class="n">${fmtN(x.ni)}</td></tr>`).join('')}
  </tbody></table></div><div class="legend-note">YoY 는 전년 같은 분기 대비. 직전·당기 중 하나라도 적자면 증감률 대신 흑자전환·적자전환 판단은 숫자로 확인하세요(증감률 미계산). 잠정실적 공시와 정기보고서 확정치는 다를 수 있으며 여기 값은 정기보고서 기준입니다.</div>`;
}

// ── 섹터·테마 비교 ──
function renderGroup() {
  const el = $('#tab-group');
  const codes = Object.keys(D.sec).filter((c) => D.sec[c].ranked);
  const vals = {};
  for (const c of codes) {
    const s = D.sec[c];
    const arr = S.groupType === 'th' ? (s.th || []) : S.groupType === 'ss' ? [s.ss].filter(Boolean) : [s.s].filter(Boolean);
    for (const v of arr) (vals[v] = vals[v] || []).push(c);
  }
  const opts = Object.entries(vals).sort((a, b) => b[1].length - a[1].length);
  if (!S.groupVal || !vals[S.groupVal]) S.groupVal = opts[0]?.[0] || '';
  const members = vals[S.groupVal] || [];
  const stat = members.map((c) => {
    let t = 0, b = 0, flip = [];
    let prev = null;
    for (const P of D.meta.periods) {
      if (P.kind === 'FY') continue;
      const U = D.rank[P.id].universe[uniKey()];
      const inT = U.top.some((r) => r.code === c), inB = U.bot.some((r) => r.code === c);
      if (inT) t++; if (inB) b++;
      if (inB && prev === 'T') flip.push(P.label);
      if (inT) prev = 'T'; else if (inB) prev = 'B';
    }
    return { c, t, b, flip };
  }).sort((x, y) => (y.t + y.b) - (x.t + x.b));
  el.innerHTML = `
  <div class="card">
    <h2>섹터·테마 비교 <span class="hint">순위(어느 기준이든)에 한 번이라도 든 종목만 분류돼 있음 · 반기 기준 등장 횟수</span></h2>
    <div class="toolbar">
      <div class="seg" id="gType"><button data-g="th">테마</button><button data-g="ss">소섹터</button><button data-g="s">대섹터</button></div>
      <select id="gVal">${opts.map(([k, v]) => `<option value="${esc(k)}" ${k === S.groupVal ? 'selected' : ''}>${esc(k)} (${v.length})</option>`).join('')}</select>
      <button class="btn sm pri" id="gChart">상위 8종목 비교 차트로</button>
    </div>
    <div class="tw"><table><thead><tr><th>종목</th><th>소섹터</th><th class="n">상위15 진입(반기)</th><th class="n">하위15 진입(반기)</th><th>상위→하위 전환</th><th class="n">최근 연간 매출 YoY</th><th class="n">최근 연간 영업이익률</th><th></th></tr></thead><tbody>
    ${stat.map((x) => { const s = secOf(x.c); const fy = lastFY(x.c); return `<tr data-code="${x.c}"><td><b>${esc(s.n)}</b> <span class="muted">${x.c}</span></td><td>${esc(s.ss || '')}</td><td class="n">${x.t}</td><td class="n">${x.b}</td><td>${esc(x.flip.join(', ')) || '–'}</td><td class="n ${cls(fy?.revYoY)}">${fmtP(fy?.revYoY, 1)}<div class="muted" style="font-size:11px">${fy ? fy.y : ''}</div></td><td class="n">${fy?.opm == null ? '–' : fy.opm.toFixed(1) + '%'}</td><td><button class="btn sm add" data-code="${x.c}">+차트</button></td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="legend-note">이 묶음은 상위·하위에 선정된 종목만 모은 ‘선정 종목 비교’이며 실제 섹터 지수가 아닙니다.</div>
  </div>
  <div class="card"><h2>기간별 수익률 히트맵 <span class="hint">${esc(S.groupVal)}</span></h2>${periodHeat(stat.map((x) => x.c))}</div>`;
  $$('#gType button').forEach((b) => { b.classList.toggle('on', b.dataset.g === S.groupType); b.onclick = () => { S.groupType = b.dataset.g; S.groupVal = ''; renderGroup(); }; });
  $('#gVal').onchange = (e) => { S.groupVal = e.target.value; renderGroup(); };
  $('#gChart').onclick = () => { S.sel = stat.slice(0, 8).map((x) => x.c); S.primary = S.sel[0]; S.view = [0, D.cal.length - 1]; S.range = null; setTab('chart'); };
  el.querySelectorAll('tr[data-code]').forEach((tr) => tr.onclick = (ev) => { if (ev.target.closest('.add')) return; openStock(tr.dataset.code); });
  el.querySelectorAll('.add').forEach((b) => b.onclick = () => { addSel(b.dataset.code); setTab('chart'); });
}
function lastFY(code) {
  const f = D.fund[code];
  if (!f || !f.fy || !f.fy.length) return null;
  const fy = hideFuture() ? f.fy.filter((x) => x.rcept && x.rcept <= S.pit) : f.fy;
  return fy[fy.length - 1] || null;
}

// ── 지속성·반전 ──
function renderPersist() {
  const el = $('#tab-persist');
  const P = period(), U = D.rank[pid()].universe[uniKey()];
  const hf = hideFuture();
  const tbl = (rows, dir) => `<div class="tw" style="max-height:640px"><table><thead><tr><th class="n">순위</th><th>종목</th><th class="n">기간 수익률</th><th class="n">최대 낙폭</th><th class="n">벤치마크 초과</th><th class="n">사후 1개월</th><th class="n">3개월</th><th class="n">6개월</th><th class="n">12개월</th><th>이후 이익</th><th>최초 논리</th></tr></thead><tbody>
    ${rows.map((r) => { const rr = rowRes(pid(), r.code); const ea = afterEarn(r.code, P.endDate); return `<tr data-code="${r.code}"><td class="n">${r.rank}</td><td><b>${esc(r.name)}</b></td><td class="n">${pctHtml(r.ret)}</td><td class="n neg">${fmtP(r.mdd)}</td><td class="n ${cls(r.excess)}">${fmtPP(r.excess)}</td>${['1', '3', '6', '12'].map((m) => { const f = r.fwd?.[m]; return `<td class="n">${hf ? '<span class="muted">숨김</span>' : f?.v != null ? pctHtml(f.v) : `<span class="muted">${esc(f?.st || '–')}</span>`}</td>`; }).join('')}<td>${hf ? '–' : ea}</td><td>${hf ? '–' : rr?.thesis ? `<span class="badge ${rr.thesis === '유지' ? 'A' : rr.thesis === '훼손' ? 'C' : 'B'}">${esc(rr.thesis)}</span>` : '<span class="muted">미판정</span>'}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  el.innerHTML = `
  <div class="card"><h2>${esc(P.label)} · 단기 급등과 장기 지속 구분 <span class="hint">사후 수익률은 순위 선정 뒤 계산한 설명용이며 예측 성과가 아닙니다</span></h2>
    <div class="legend-note">사후 n개월 = 기간 종료일(${dstr(P.endDate)})에서 달력 n개월 뒤 마지막 거래일까지. 기준일(${dstr(D.meta.asof)})을 넘으면 ‘미관찰’. 이후 이익 = 기간 종료 뒤 발표된 4개 분기 영업이익 합 vs 그 직전 4개 분기 합(DART, 발표일 기준).</div></div>
  <div class="card"><h2>상위 15</h2>${tbl(U.top, 'top')}</div>
  <div class="card"><h2>하위 15</h2>${tbl(U.bot, 'bot')}</div>`;
  el.querySelectorAll('tr[data-code]').forEach((tr) => tr.onclick = () => openStock(tr.dataset.code));
}
function afterEarn(code, endDate) {
  const f = D.fund[code];
  if (!f || !f.q) return '<span class="muted">자료 없음</span>';
  const q = f.q.filter((x) => x.rcept && x.op != null);
  const after = q.filter((x) => x.rcept > endDate).slice(0, 4);
  const before = q.filter((x) => x.rcept <= endDate).slice(-4);
  if (after.length < 4 || before.length < 4) return `<span class="muted">${after.length < 4 ? `발표 ${after.length}/4분기` : '직전 자료 부족'}</span>`;
  const a = after.reduce((s, x) => s + x.op, 0), b = before.reduce((s, x) => s + x.op, 0);
  const lab = a > b ? (b <= 0 && a > 0 ? '흑자 전환' : '개선') : (a <= 0 && b > 0 ? '적자 전환' : '악화');
  return `<span class="${a > b ? 'pos' : 'neg'}">${lab}</span> <span class="muted num" style="font-size:11px">${fmtN(b)}→${fmtN(a)}억</span>`;
}

// ── 복기 패턴 ──
function renderPattern() {
  const el = $('#tab-pattern');
  const groups = {};
  for (const [c, sr] of Object.entries(D.res.stocks)) if (sr.pattern) (groups[sr.pattern] = groups[sr.pattern] || []).push([c, sr]);
  const hf = hideFuture();
  const keys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
  el.innerHTML = `<div class="card"><h2>복기 패턴 카드 <span class="hint">‘다음 급등주’를 고르는 기능이 아닙니다. 과거 흐름을 지금 기업에 대 볼 조건과 질문입니다.</span></h2>
    ${keys.length ? '' : '<div class="empty">아직 패턴으로 분류된 종목이 없습니다.</div>'}</div>
    ${keys.map((k) => `<div class="card"><h2>${esc(k)} <span class="hint">${groups[k].length}개 종목</span></h2>
      <div class="split">${groups[k].slice(0, S.patMore === k ? 999 : 12).map(([c, sr]) => { const cd = sr.card || {}; return `<div class="card" style="margin-top:0;box-shadow:none">
        <h3 style="margin-top:0"><a href="#" data-code="${c}">${esc(secOf(c).n)}</a> <span class="muted" style="font-size:12px">${esc(secOf(c).ss || '')}</span></h3>
        <table style="font-size:12.5px"><tbody>
        ${[['최초 촉발 사건', cd.trigger], ['수혜 전달 경로', cd.path], ['먼저 확인할 지표', cd.firstIndicator], ['기대→실적 전환 시점', cd.toEarnings], ['상승을 지속시킨 조건', cd.sustain], ['상승을 끝낸 조건', hf ? '숨김' : cd.end], ['같은 테마의 실패 사례', hf ? '숨김' : cd.peersFailed], ['적용 시 차이점', cd.diff], ['지금 다시 확인할 지표', cd.recheck]].map(([a, b]) => `<tr style="cursor:default"><th style="position:static;width:34%;cursor:default">${a}</th><td>${b ? esc(listTxt(b)) : '<span class="muted">–</span>'}</td></tr>`).join('')}
        </tbody></table></div>`; }).join('')}</div>${groups[k].length > 12 && S.patMore !== k ? `<button class="btn sm" data-more="${esc(k)}" style="margin-top:8px">${groups[k].length - 12}개 더 보기</button>` : ''}</div>`).join('')}`;
  el.querySelectorAll('a[data-code]').forEach((a) => a.onclick = (e) => { e.preventDefault(); openStock(a.dataset.code); });
  el.querySelectorAll('[data-more]').forEach((b) => b.onclick = () => { S.patMore = b.dataset.more; renderPattern(); });
}

// ── 신규 상장·코로나 ──
function renderNewlist() {
  const el = $('#tab-newlist');
  const R = D.rank[pid()], N = R.newListings;
  const hf = hideFuture() && period().endDate > S.pit;
  const nt = (rows) => `<div class="tw"><table><thead><tr><th>종목</th><th>상장일</th><th class="n">첫날 기준가</th><th class="n">첫날 종가</th><th class="n">첫날 종가 → 기간말</th><th class="n">기준가 → 기간말</th><th>비고</th></tr></thead><tbody>
    ${rows.map((r) => `<tr data-code="${r.code}"><td><b>${esc(r.name)}</b> <span class="muted">${r.code} · ${r.market}</span></td><td class="n">${dstr(r.listDate)}</td><td class="n">${fmtN(r.firstBase)}</td><td class="n">${fmtN(r.firstClose)}</td><td class="n">${hf ? '–' : pctHtml(r.retFromClose)}</td><td class="n">${hf ? '–' : pctHtml(r.retFromBase)}</td><td>${r.endedEarly ? `<span class="badge flag">기간 중 거래 종료 ${dstr(r.endDate)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  const covid = D.meta.covid.map((C) => {
    const U = D.rank[C.id].universe[uniKey()];
    return `<div class="card"><h2>${esc(C.label)} <span class="hint">${dstr(C.startRef)} → ${dstr(C.endDate)} · 대상 ${fmtN(U.n)} · 중앙값 ${fmtP(U.median)} · 코스피 ${fmtP(D.rank[C.id].bench.KOSPI)} · 코스닥 ${fmtP(D.rank[C.id].bench.KOSDAQ)}</span></h2>
      <div class="split"><div><h3>상위 15</h3>${rankTable(C.id, U.top, 'top')}</div><div><h3>하위 15</h3>${rankTable(C.id, U.bot, 'bot')}</div></div></div>`;
  }).join('');
  el.innerHTML = `<div class="card"><h2>${esc(period().label)} 신규 상장 <span class="hint">기간 시작 기준가가 없어 정규 순위에서 뺀 종목 ${fmtN(N.n)}개 · 재상장·이전상장 포함</span></h2>
    <div class="legend-note">첫날 기준가 = 상장일 거래소 기준가(종가 − 대비). 2023-06-26 이전 상장은 시초가 결정 방식이라 공모가와 다를 수 있습니다.</div>
    <div class="split"><div><h3>상위 15 (첫날 종가 기준)</h3>${nt(N.top)}</div><div><h3>하위 15</h3>${nt(N.bot)}</div></div></div>
    <div class="card"><h2>2020 코로나 급락·반등 보조 구간 <span class="hint">정규 반기·연간 순위와 별개 · KOSPI 종가로 고점·저점을 데이터에서 찾음</span></h2></div>${covid}`;
  el.querySelectorAll('tr[data-code]').forEach((tr) => tr.onclick = (ev) => { if (ev.target.closest('.add')) { addSel(ev.target.dataset.code); setTab('chart'); return; } openStock(tr.dataset.code); });
}

// ── 메모 ──
const NOTE_KEY = 'krreview.notes.v1';
function notes() { try { return JSON.parse(localStorage.getItem(NOTE_KEY) || '{}'); } catch { return {}; } }
function saveNotes(n) { try { localStorage.setItem(NOTE_KEY, JSON.stringify(n)); return true; } catch { return false; } }
const NOTE_F = [['why', '내가 당시 판단한 이유'], ['missed', '놓친 신호'], ['recheck', '다시 나타나면 확인할 지표'], ['change', '판단을 바꿔야 할 조건']];
function openNote({ code, period: p }) {
  const key = `${code || '시장'}|${p}`;
  const n = notes()[key] || {};
  $('#modalBody').innerHTML = `<h2 style="margin-bottom:6px">복기 메모 · ${esc(code ? secOf(code).n : '시장')} · ${esc(period(p)?.label || p)}</h2>
    <div class="legend-note">이 브라우저에만 저장됩니다(다른 기기와 공유되지 않음). Markdown 으로 내보낼 수 있습니다.</div>
    <div class="note-grid" style="margin-top:8px">${NOTE_F.map(([k, l]) => `<div><label style="font-size:12px;font-weight:700">${l}</label><textarea data-k="${k}">${esc(n[k] || '')}</textarea></div>`).join('')}</div>
    <div style="margin-top:10px;display:flex;gap:8px"><button class="btn pri" id="nSave">저장</button><span id="nMsg" class="muted"></span></div>`;
  $('#modal').hidden = false;
  $('#nSave').onclick = () => {
    const all = notes();
    const o = { code, period: p, updated: new Date().toISOString() };
    $$('#modalBody textarea').forEach((t) => { o[t.dataset.k] = t.value; });
    all[key] = o;
    $('#nMsg').textContent = saveNotes(all) ? '저장했습니다' : '저장 실패(브라우저 저장소 막힘)';
  };
}
function notesMd() {
  const n = Object.values(notes()).sort((a, b) => (a.period > b.period ? 1 : -1));
  return `# 국장 복기 메모\n\n내보낸 날: ${new Date().toISOString().slice(0, 10)}\n\n` + n.map((o) => `## ${o.code ? secOf(o.code).n + ' (' + o.code + ')' : '시장'} · ${period(o.period)?.label || o.period}\n\n` + NOTE_F.map(([k, l]) => `**${l}**\n\n${o[k] || '-'}\n`).join('\n')).join('\n---\n\n');
}
function renderNotes() {
  const el = $('#tab-notes');
  const n = Object.entries(notes());
  el.innerHTML = `<div class="card"><h2>복기 메모 <span class="hint">${n.length}건 · 이 브라우저 저장</span>
    <button class="btn sm" id="nNew" style="margin-left:auto">현재 기간 시장 메모</button><button class="btn sm pri" id="nMd">Markdown 내보내기</button></h2>
    ${n.length ? `<div class="tw"><table><thead><tr><th>종목</th><th>기간</th><th>내가 당시 판단한 이유</th><th>놓친 신호</th><th>수정</th></tr></thead><tbody>${n.map(([k, o]) => `<tr data-k="${esc(k)}"><td>${esc(o.code ? secOf(o.code).n : '시장')}</td><td>${esc(period(o.period)?.label || o.period)}</td><td>${esc((o.why || '').slice(0, 80))}</td><td>${esc((o.missed || '').slice(0, 80))}</td><td class="muted">${esc((o.updated || '').slice(0, 10))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">아직 메모가 없습니다. 종목 복기·구간 요약에서 ‘메모’를 누르세요.</div>'}</div>`;
  $('#nMd').onclick = () => download('국장복기_메모.md', notesMd(), 'text/markdown');
  $('#nNew').onclick = () => openNote({ code: null, period: pid() });
  el.querySelectorAll('tr[data-k]').forEach((tr) => tr.onclick = () => { const o = notes()[tr.dataset.k]; openNote({ code: o.code, period: o.period }); });
}

// ── 데이터·검증 ──
function renderData() {
  const el = $('#tab-data');
  const R = D.rank[pid()], m = D.meta, dq = D.dq;
  const allRows = D.meta.periods.flatMap((P) => { const U = D.rank[P.id].universe['ALL.all']; return [...U.top, ...U.bot].map((r) => `${P.id}|${r.code}`); });
  const doneRows = allRows.filter((k) => D.res.rows[k]?.reason).length;
  el.innerHTML = `
  <div class="card"><h2>데이터 기준 <span class="hint">기준일 ${dstr(m.asof)} 종가 · 생성 ${esc(m.generatedAt)}</span></h2>
    <table><tbody>${Object.entries(m.rules).map(([k, v]) => `<tr style="cursor:default"><th style="position:static;width:180px;cursor:default">${esc({ returnFormula: '수익률 산식', adjust: '수정주가', start2020: '2020 시작 기준', universe: '대상 종목', eligibility: '편입·예외', tie: '동률', investable: '투자 가능 필터', market: '시장 구분', halt: '거래정지', fwd: '사후 수익률', source: '출처' }[k] || k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>
  <div class="card"><h2>확보 범위와 검증 상태</h2>
    <div class="kpis">
      <div class="kpi"><div class="l">거래일</div><div class="v">${fmtN(dq.tradingDays)}</div></div>
      <div class="kpi"><div class="l">시세 기간</div><div class="v" style="font-size:14px">${dstr(dq.first)} ~ ${dstr(dq.asof)}</div></div>
      <div class="kpi"><div class="l">종목(전 시장·우선주 포함)</div><div class="v">${fmtN(dq.securities)}</div></div>
      <div class="kpi"><div class="l">기업행동 반영일</div><div class="v">${fmtN(dq.corporateActionDays)}</div></div>
      <div class="kpi"><div class="l">순위 행(전체·전 종목)</div><div class="v">${fmtN(allRows.length)}</div></div>
      <div class="kpi"><div class="l">원인 조사 완료</div><div class="v">${fmtN(doneRows)} / ${fmtN(allRows.length)}</div></div>
      <div class="kpi"><div class="l">사건 기록</div><div class="v">${fmtN(D.res.events.length)}</div></div>
      <div class="kpi"><div class="l">분기 실적 종목</div><div class="v">${fmtN(Object.keys(D.fund).length)}</div></div>
    </div>
    ${dq.checks ? `<h3>검증 결과</h3><div class="tw"><table><thead><tr><th>검사</th><th>결과</th><th>내용</th></tr></thead><tbody>${dq.checks.map((c) => `<tr style="cursor:default"><td>${esc(c.name)}</td><td>${c.ok ? '<span class="badge A">통과</span>' : '<span class="badge C">확인 필요</span>'}</td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${dq.notes ? `<h3>남은 누락·한계</h3><ul class="lines">${dq.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
  </div>
  <div class="card"><h2>${esc(period().label)} 제외 종목 <span class="hint">기간 중 거래 종료(상장폐지·합병 등) — −100% 로 처리하지 않음 · ${R.excluded.length}개</span>
    <button class="btn sm" id="exCsv" style="margin-left:auto">CSV</button></h2>
    <div class="tw" style="max-height:420px"><table><thead><tr><th>종목</th><th>시장</th><th>마지막 거래일</th><th class="n">그때까지 수익률</th><th>사유</th></tr></thead><tbody>
    ${[...R.excluded].sort((a, b) => (a.retToLast ?? 1e9) - (b.retToLast ?? 1e9)).map((x) => `<tr style="cursor:default"><td>${esc(x.name)} <span class="muted">${x.code}</span></td><td>${x.market}</td><td class="n">${dstr(x.lastDate)}</td><td class="n">${pctHtml(x.retToLast)}</td><td>${esc(x.delistReason || x.reason)}</td></tr>`).join('')}</tbody></table></div>
    <div class="legend-note">거래 종료 종목이 끝까지 거래됐다면 하위 순위에 들었을 수 있습니다. 그때까지 수익률이 하위 15위 경계보다 낮은 종목 수: <b>${R.excluded.filter((x) => x.retToLast != null && x.retToLast < (R.universe['ALL.all'].bot.at(-1)?.ret ?? -1e9)).length}</b>개. 연속성 단절 종목 <b>${R.excluded.filter((x) => x.brkDate).length}</b>개는 기간 수익률을 계산하지 않았습니다(순위 정확성에 미치는 영향: 이 종목들은 어느 쪽에도 들지 않음).</div></div>
  <div class="card"><h2>추가 데이터 가져오기 <span class="hint">이 브라우저에만 반영 · 사건 JSON 규격</span></h2>
    <pre style="white-space:pre-wrap;font-size:12px;background:var(--panel-2);padding:10px;border-radius:8px">[{"id":"고유값","date":"2024-03-15","seen":"2024-03-15 18:05","codes":["000660"],"themes":["HBM"],"title":"사건 제목","fact":"직접 확인한 사실","interp":"해석","cat":"기업 고유","dir":"+","pr":5.2,"grade":"A","url":"https://..."}]
cat: ${CATS.join(' / ')} · dir: + / - / ± · grade: A / B / C · CSV 는 같은 열 이름(헤더)으로</pre>
    <input type="file" id="imp" accept=".json,.csv"> <button class="btn sm" id="impClr">가져온 데이터 지우기</button> <span id="impMsg" class="muted"></span></div>`;
  $('#exCsv').onclick = () => download(`제외종목_${pid()}.csv`, toCsv(R.excluded, ['code', 'name', 'market', 'lastDate', 'retToLast', 'reason']), 'text/csv');
  $('#imp').onchange = importFile;
  $('#impClr').onclick = () => { try { localStorage.removeItem('krreview.import.v1'); } catch { } location.reload(); };
}
function importFile(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      let arr;
      if (f.name.endsWith('.csv')) {
        const lines = rd.result.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
        const hd = parseCsvLine(lines[0]);
        arr = lines.slice(1).map((l) => { const c = parseCsvLine(l); const o = {}; hd.forEach((h, i) => o[h] = c[i]); if (o.codes) o.codes = o.codes.split(/[;|]/); if (o.themes) o.themes = o.themes.split(/[;|]/); if (o.pr) o.pr = +o.pr; return o; });
      } else arr = JSON.parse(rd.result);
      const bad = arr.filter((e) => !e.id || !e.date || !e.title);
      if (bad.length) throw new Error(`id·date·title 없는 행 ${bad.length}개`);
      localStorage.setItem('krreview.import.v1', JSON.stringify(arr));
      $('#impMsg').textContent = `${arr.length}건 저장 — 새로고침하면 반영됩니다`;
    } catch (e) { $('#impMsg').textContent = '실패: ' + e.message; }
  };
  rd.readAsText(f, 'utf-8');
}
function mergeImported() {
  try {
    const arr = JSON.parse(localStorage.getItem('krreview.import.v1') || '[]');
    for (const e of arr) { e.imported = true; e.src = e.src || '가져온 자료'; D.res.events.push(e); }
  } catch { }
}
function parseCsvLine(l) { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }

// ── 내보내기 ──
function toCsv(rows, cols, heads) {
  const q = (v) => { v = v == null ? '' : Array.isArray(v) ? v.join(';') : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  return '﻿' + [(heads || cols).join(','), ...rows.map((r) => cols.map((c) => q(typeof c === 'function' ? c(r) : r[c])).join(','))].join('\n');
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportRankCsv(dir) {
  const U = D.rank[pid()].universe[uniKey()];
  const rows = (dir === 'top' ? U.top : U.bot).map((r) => { const s = secOf(r.code), rr = rowRes(pid(), r.code); return { ...r, sector: s.s, sub: s.ss, themes: (s.th || []).join(';'), reason: rr?.reason || '원인 조사 미완료', grade: rr?.grade || '', flags: (r.flags || []).join(';'), f1: r.fwd?.['1']?.v, f3: r.fwd?.['3']?.v, f6: r.fwd?.['6']?.v, f12: r.fwd?.['12']?.v }; });
  download(`순위_${pid()}_${uniKey()}_${dir}.csv`, toCsv(rows, ['rank', 'sector', 'sub', 'themes', 'name', 'code', 'market', 'ret', 'ytd', 'mdd', 'benchRet', 'excess', 'f1', 'f3', 'f6', 'f12', 'reason', 'grade', 'flags'],
    ['순위', '대섹터', '소섹터', '테마', '종목명', '종목코드', '시장', '기간수익률%', 'YTD%', '최대낙폭%', '벤치마크%', '초과%p', '사후1M%', '사후3M%', '사후6M%', '사후12M%', '핵심이유', '근거', '경고']), 'text/csv');
}
function exportEvCsv() {
  const rows = (S._evRows || []).map((e) => ({ ...e, names: (e.codes || []).map((c) => secOf(c).n).join(';'), url1: (e.urls || [e.url]).filter(Boolean).join(' ') }));
  download('사건목록.csv', toCsv(rows, ['date', 'seen', 'names', 'title', 'fact', 'interp', 'cat', 'dir', 'pr', 'grade', 'url1'], ['날짜', '공개시점', '대상', '사건', '사실', '해석', '범주', '방향', '가격반응%', '근거', '출처']), 'text/csv');
}

// ── 검색 ──
function initSearch() {
  const q = $('#q'), list = $('#qList');
  const names = Object.entries(D.sec).map(([c, s]) => [c, s.n, (s.nh || []).join(' ')]);
  let act = 0, hits = [];
  const draw = () => { list.innerHTML = hits.map(([c, n], i) => `<div data-c="${c}" class="${i === act ? 'act' : ''}"><span>${esc(n)}</span><span class="muted">${c} · ${esc(secOf(c).m || '')}${secOf(c).listed === false ? ' · 폐지' : ''}</span></div>`).join(''); list.hidden = !hits.length; };
  q.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase();
    if (!v) { hits = []; draw(); return; }
    hits = names.filter(([c, n, h]) => c.includes(v) || n.toLowerCase().includes(v) || h.toLowerCase().includes(v)).sort((a, b) => (a[1].toLowerCase().startsWith(v) ? 0 : 1) - (b[1].toLowerCase().startsWith(v) ? 0 : 1) || (D.sec[b[0]].ranked ? 1 : 0) - (D.sec[a[0]].ranked ? 1 : 0)).slice(0, 12);
    act = 0; draw();
  });
  const pick = (c) => { q.value = ''; hits = []; draw(); addSel(c); if (S.tab === 'stock') { S.stock = c; renderStock(); } else setTab('chart'); };
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { act = Math.min(hits.length - 1, act + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { act = Math.max(0, act - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && hits[act]) pick(hits[act][0]);
    else if (e.key === 'Escape') { hits = []; draw(); }
  });
  list.addEventListener('mousedown', (e) => { const d = e.target.closest('[data-c]'); if (d) pick(d.dataset.c); });
  q.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
}

// ── 표 정렬 (머리글 클릭) ──
function initSort() {
  document.addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th || th.closest('.nosort')) return;
    const table = th.closest('table'), tb = table && table.tBodies[0];
    if (!tb || !table.tHead || !table.tHead.contains(th)) return;
    const col = [...th.parentNode.children].indexOf(th);
    const dir = th.dataset.sort === 'asc' ? 'desc' : 'asc';
    table.querySelectorAll('th').forEach((x) => { delete x.dataset.sort; x.removeAttribute('aria-sort'); });
    th.dataset.sort = dir; th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    const val = (tr) => {
      const t = (tr.children[col]?.innerText || '').trim();
      const m = t.replace(/,/g, '').replace('−', '-').match(/^[▲▼\s]*([+-]?\d+(\.\d+)?)/);
      return m ? parseFloat(m[1]) : t;
    };
    const rows = [...tb.rows].filter((r) => r.children.length > 1);
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
      return dir === 'asc' ? c : -c;
    });
    rows.forEach((r) => tb.appendChild(r));
  });
}

// ── 테마 ──
function isDark() { const a = document.documentElement.getAttribute('data-theme'); if (a === 'dark') return true; if (a === 'light') return false; return matchMedia('(prefers-color-scheme: dark)').matches; }
function initTheme() {
  try { const t = localStorage.getItem('krreview.theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch { }
  const b = $('#themeBtn');
  const lab = () => { b.textContent = isDark() ? '라이트' : '다크'; };
  lab();
  b.onclick = () => { const t = isDark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('krreview.theme', t); } catch { } lab(); };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', lab);
}

// ── 시작 ──
async function main() {
  initTheme();
  try { await loadAll(); } catch (e) {
    $('#main').innerHTML = `<div class="card"><div class="empty">데이터를 불러오지 못했습니다: ${esc(e.message)}<br>파일로 직접 열었다면(file://) 브라우저가 막습니다. 공유 링크로 여세요.</div></div>`;
    return;
  }
  const years = [...new Set(D.meta.periods.map((p) => p.year))];
  $('#fYear').innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
  S.year = years[years.length - 2] || years[0];
  const secs = [...new Set(Object.values(D.sec).filter((s) => s.ranked).map((s) => s.s).filter(Boolean))].sort();
  $('#fSector').innerHTML = '<option value="">전체</option>' + secs.map((s) => `<option>${esc(s)}</option>`).join('');
  const ths = {};
  Object.values(D.sec).forEach((s) => (s.th || []).forEach((t) => ths[t] = (ths[t] || 0) + 1));
  $('#fTheme').innerHTML = '<option value="">전체</option>' + Object.entries(ths).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<option value="${esc(t)}">${esc(t)} (${n})</option>`).join('');
  readHash();
  $('#asofLine').textContent = `기준일 ${dstr(D.meta.asof)} 종가(최신 완료 거래일) · 2020-01-02부터 ${fmtN(D.cal.length)}거래일 · 코스피·코스닥 보통주 · 원인 분석 진행 상태는 데이터·검증 탭`;
  $('#fYear').onchange = (e) => { S.year = +e.target.value; S.range = null; S.view = null; render(); };
  $$('#fKind button').forEach((b) => b.onclick = () => { S.kind = b.dataset.k; S.range = null; S.view = null; render(); });
  $$('#fMkt button').forEach((b) => b.onclick = () => { S.mkt = b.dataset.m; render(); });
  $$('#fFilt button').forEach((b) => b.onclick = () => { S.filt = b.dataset.f; render(); });
  $('#fSector').onchange = (e) => { S.sector = e.target.value; render(); };
  $('#fTheme').onchange = (e) => { S.theme = e.target.value; render(); };
  $$('#tabs button').forEach((b) => b.onclick = () => setTab(b.dataset.tab));
  $('#pitOn').onchange = (e) => { S.pit = e.target.checked ? (period().startRef > '20200101' ? period().startRef : D.cal[60]) : null; S.pitAfter = false; render(); };
  $('#pitDate').onchange = (e) => { if (e.target.value) { S.pit = dnum(e.target.value); render(); } };
  $('#pitAfter').onchange = (e) => { S.pitAfter = e.target.checked; render(); };
  $('#modalX').onclick = () => { $('#modal').hidden = true; if (S.tab === 'notes') renderNotes(); };
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') { $('#modal').hidden = true; if (S.tab === 'notes') renderNotes(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });
  initSearch();
  initSort();
  addEventListener('hashchange', () => { if (location.hash.slice(1) !== S._lastHash) { readHash(); render(); } });
  $('#shareBtn').onclick = async () => {
    saveHash();
    try { await navigator.clipboard.writeText(location.href); $('#shareBtn').textContent = '복사됨'; }
    catch { prompt('이 주소를 복사하세요', location.href); }
    setTimeout(() => { $('#shareBtn').textContent = '현재 화면 링크'; }, 1500);
  };
  new MutationObserver(() => { if (S.tab === 'chart' && mainChart) drawMain(); else if (S.tab === 'stock') renderStock(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (S.tab === 'chart') drawMain(); else if (S.tab === 'stock') renderStock(); }, 200); });
  setTab(S.tab);
}
main();
