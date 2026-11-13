/* Presentation-only alignment. Existing calculations, data, controls and persistence remain intact. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const watch = (node, update) => {
    if (!node) return;
    new MutationObserver(update).observe(node, { childList: true, subtree: true, characterData: true });
    update();
  };

  function arrangeWatchlist() {
    const fold = document.querySelector('.watchlist-fold');
    const foldBody = document.querySelector('.watchlist-fold-content');
    const summary = fold?.querySelector(':scope > summary');
    const favorites = byId('watchlistItems');
    if (!fold || !foldBody || !summary || !favorites || fold.dataset.uiAligned) return null;
    fold.dataset.uiAligned = 'true';

    const oldStatus = byId('watchlistStatus');
    const actions = [...foldBody.children].find(node => node.classList.contains('watchlist-actions'));
    const reset = byId('rateResetAll');
    const pause = byId('watchlistPause');
    const clear = byId('localClearLink');
    const resetStatus = byId('rateResetStatus');
    const collectionSelection = byId('collectionSelection');
    const collectionActionStatus = byId('collectionActionStatus');
    const resetExplanation = resetStatus?.textContent.trim() || '';

    const overallStatus = make('p', 'small watchlist-overall-status', '日历/采集状态待确认');
    overallStatus.id = 'watchlistOverallStatus'; overallStatus.setAttribute('role', 'status'); overallStatus.setAttribute('aria-live', 'polite');
    const headActions = make('div', 'watchlist-head-actions');
    const manageButton = make('button', 'secondary', '管理');
    manageButton.type = 'button';
    manageButton.setAttribute('aria-pressed', 'false');
    manageButton.setAttribute('aria-label', '显示或隐藏自选管理功能');
    headActions.append(manageButton);
    if (reset) {
      reset.textContent = '重置';
      reset.title = '重置今日比率累计（全部自选＋当前股）';
      headActions.append(reset);
    }
    summary.append(headActions);
    summary.after(overallStatus);
    headActions.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); });

    const management = make('details', 'watchlist-management');
    management.append(make('summary', '', '更多管理功能'));
    const managementBody = make('div', 'watchlist-management-body');
    management.append(managementBody);

    const managementActions = make('div', 'watchlist-actions');
    if (pause) managementActions.append(pause);
    if (clear) managementActions.append(clear);
    if (managementActions.childNodes.length) managementBody.append(managementActions);

    const info = make('details', 'watchlist-info');
    info.append(make('summary', '', '采集与记录说明'));
    const infoBody = make('div', 'watchlist-info-body');
    if (resetExplanation) infoBody.append(make('p', 'small', resetExplanation));
    info.append(infoBody);
    if (oldStatus) managementBody.append(oldStatus);

    const originalChildren = [...foldBody.children];
    for (const child of originalChildren) {
      if (child === favorites || child === actions || child === resetStatus || child === collectionSelection || child === collectionActionStatus) continue;
      if (child.tagName === 'P' || child.tagName === 'DIV' || child.tagName === 'SECTION') infoBody.append(child);
      else infoBody.append(child);
    }
    if (actions) actions.remove();
    if (resetStatus) {
      resetStatus.textContent = '';
      resetStatus.classList.add('watchlist-reset-result');
    }
    if (collectionSelection) managementBody.append(collectionSelection);
    if (collectionActionStatus) managementBody.append(collectionActionStatus);
    managementBody.append(info);

    foldBody.replaceChildren();
    foldBody.append(favorites);
    if (resetStatus) foldBody.append(resetStatus);
    foldBody.append(management);

    const formatFavorites = () => {
      for (const row of [...favorites.children]) {
        if (row.tagName !== 'DIV') {
          if (row.tagName === 'SPAN' && row.textContent.trim().startsWith('暂无自选') && row.textContent.trim() !== '暂无自选') row.textContent = '暂无自选';
          continue;
        }
        const buttons = [...row.querySelectorAll('button')];
        const open = buttons[0], remove = buttons.at(-1);
        if (open && !row.dataset.uiFavoriteAligned) {
          row.dataset.uiFavoriteAligned = 'true';
          const rowStatus = row.querySelector('span.small');
          if (rowStatus) {
            const details = rowStatus.textContent.trim();
            if (details) open.title = `${open.title || '查看该股行情、已有记录和导出'}；${details}`;
            rowStatus.remove();
          }
          const match = open.textContent.trim().match(/^(.*)（([^（）]+)）$/);
          if (match) {
            const identity = make('span', 'watchlist-identity');
            identity.append(make('span', 'watchlist-stock-name', match[1]), make('span', 'watchlist-stock-code', match[2]));
            open.replaceChildren(identity);
          }
          open.classList.add('watchlist-open');
        }
        if (remove) remove.classList.add('watchlist-remove');
      }
    };
    new MutationObserver(formatFavorites).observe(favorites, { childList: true, subtree: true, characterData: true });
    formatFavorites();

    const updateOverallStatus = () => {
      const detail = oldStatus?.textContent || '';
      if (/无法|失败|存储问题|读取错误/.test(detail)) {
        overallStatus.textContent = detail.split('｜')[0];
        return;
      }
      try {
        const phase = typeof marketPhase === 'function' ? marketPhase() : null;
        overallStatus.textContent = phase?.label || '日历/采集状态待确认';
      } catch {
        overallStatus.textContent = '日历/采集状态待确认';
      }
    };
    if (oldStatus) new MutationObserver(updateOverallStatus).observe(oldStatus, { childList: true, characterData: true, subtree: true });
    updateOverallStatus();
    manageButton.addEventListener('click', () => {
      const enabled = fold.classList.toggle('ui-manage-mode');
      manageButton.setAttribute('aria-pressed', String(enabled));
    });
    fold.addEventListener('toggle', () => {
      if (!fold.open) {
        fold.classList.remove('ui-manage-mode');
        manageButton.setAttribute('aria-pressed', 'false');
      }
      updateOverallStatus();
    });
    return { fold, foldBody, managementBody };
  }

  // Four detail charts. Reads settled windows published by the page; never recalculates statistics.
  function buildBookWaves() {
    const NS = 'http://www.w3.org/2000/svg', W = 400, H = 240, MID = H / 2, Q = H / 4;
    const RED = '#d93025', GREEN = '#188038', ROLL_MS = 60000;
    const KEYS = ['bidAdded', 'askAdded', 'bidCancelled', 'askCancelled'];
    const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
    const minuteOf = t => { const d = new Date(t + 8 * 3600000), m = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000; return m <= 570 ? 0 : m <= 690 ? m - 570 : m < 780 ? 120 : m <= 900 ? m - 660 : 240; };
    const xOf = t => minuteOf(t) / 240 * W;
    const clock = t => new Date(t + 8 * 3600000).toISOString().slice(11, 19);
    const lots = n => Number.isFinite(n) ? (n / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
    const signed = n => Number.isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + lots(Math.abs(n)) : '—';
    const minuteLabel = m => { const total = m < 120 ? 570 + m : 780 + m - 120; return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0'); };

    const section = make('section', 'book-wave'); section.id = 'bookWavePanel';
    const title = make('h3', '', '五档挂单与成交详细图'); title.id = 'bookWaveTitle';
    section.setAttribute('aria-labelledby', title.id);
    const status = make('p', 'small book-wave-status', '查询后从开始观测的时刻画起；横轴为北京时间，与上方分时图对齐。');
    status.id = 'bookWaveStatus'; status.setAttribute('role', 'status');
    const grid = make('div', 'book-wave-grid');
    const tip = make('div', 'book-wave-tip'); tip.hidden = true; tip.setAttribute('aria-hidden', 'true');
    const panels = [['added', '加单详细图'], ['cancelled', '撤单详细图'], ['net', '净加单详细图'], ['active', '主动买卖详细图']].map(([kind, name]) => {
      const cell = make('div', 'book-wave-cell'); cell.dataset.kind = kind;
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': name });
      svg.append(svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' }));
      const layer = svgEl('g', { class: 'book-wave-data' });
      const zero = svgEl('line', { class: 'book-wave-zero', x1: 0, y1: MID, x2: W, y2: MID, stroke: '#111', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' });
      const cross = svgEl('line', { class: 'book-wave-cross', x1: 0, y1: 0, x2: 0, y2: H, stroke: '#444', 'stroke-width': 1, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke', display: 'none' });
      const frame = svgEl('rect', { class: 'book-wave-frame', x: 0, y: 0, width: W, height: H, fill: 'none', stroke: '#111', 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke' });
      svg.append(layer, zero, cross, frame);
      const ticks = make('div', 'book-wave-ticks');
      for (const [pct, label] of [[0, '09:30'], [25, '10:30'], [50, '11:30/13:00'], [75, '14:00'], [100, '15:00']]) { const span = make('span', '', label); span.style.left = pct + '%'; ticks.append(span); }
      cell.append(svg, ticks, make('div', 'book-wave-name', name)); grid.append(cell);
      return { kind, cell, svg, layer, cross };
    });
    grid.append(tip);
    const legend = make('p', 'small book-wave-legend');
    const swatch = (color, dashed) => { const s = make('span', 'book-wave-swatch'); s.style.background = dashed ? 'repeating-linear-gradient(90deg,#b8c0cc 0 4px,transparent 4px 7px)' : color; return s; };
    legend.append(swatch(RED), '红线＝买盘（黑线上方）　', swatch(GREEN), '绿线＝卖盘（黑线下方）。',
      make('br'), '加单、撤单图：线在起点上方＝近1分钟比开始观测以来的平均多，下方＝比平均少；净加单图：从开始观测累计（加单−撤单）；主动买卖图：每根柱为1分钟，红柱＝主动买入，绿柱＝主动卖出。滑动图表查看该时刻详情。');
    section.append(title, status, grid, legend);

    let model = { pts: [], real: [], bars: null, t0: null }, latest = null, drawQueued = false, active = null, lastHover = null;
    function build(data) {
      const rows = (data?.windows || []).filter(w => Number.isFinite(w.end)).sort((a, b) => a.end - b.end);
      const open = Date.parse(`${data?.day}T09:30:00+08:00`), close = Date.parse(`${data?.day}T15:00:00+08:00`);
      if (!rows.length) return { pts: [], real: [], bars: null, t0: null, open, coverage: [] };
      const firstSpan = (rows[0].spans || []).filter(s => Number.isFinite(s[0])).sort((a, b) => a[0] - b[0])[0];
      const started = Date.parse(data?.started_at);
      const t0 = Number.isFinite(started) ? Math.max(open, started) : firstSpan ? firstSpan[0] : Number.isFinite(rows[0].start) ? rows[0].start : rows[0].end;
      const zeroDev = Object.fromEntries(KEYS.map(k => [k, 0]));
      const anchors = [{ t: open, dev: zeroDev, net: { bid: 0, ask: 0 }, hold: true }, { t: t0, dev: zeroDev, net: { bid: 0, ask: 0 }, hold: true }], real = [], parts = [], coverage = [];
      const cum = { obs: 0, bidNet: 0, askNet: 0, activeBuy: 0, activeSell: 0, volume: 0, ...zeroDev }, win = { obs: 0, ...zeroDev };
      let covered = t0, j = 0;
      const bars = { buy: new Float64Array(240), sell: new Float64Array(240), has: new Uint8Array(240) };
      rows.forEach((w, i) => {
        const spans = (w.spans || []).filter(s => Number.isFinite(s[0]) && Number.isFinite(s[1]) && s[1] >= s[0]).sort((a, b) => a[0] - b[0]);
        let observed = 0;
        for (const [a, b] of spans) {
          const lastCoverage = coverage[coverage.length - 1];
          if (lastCoverage && a <= lastCoverage[1]) lastCoverage[1] = Math.max(lastCoverage[1], b); else coverage.push([a, b]);
          observed += Math.max(0, b - Math.max(a, covered));
          covered = Math.max(covered, b);
        }
        const amount = Object.fromEntries(KEYS.map(k => [k, Number(w[k]) || 0]));
        parts.push({ observed, amount });
        cum.obs += observed; win.obs += observed;
        for (const k of KEYS) { cum[k] += amount[k]; win[k] += amount[k]; }
        while (j < i && win.obs - parts[j].observed >= ROLL_MS) { win.obs -= parts[j].observed; for (const k of KEYS) win[k] -= parts[j].amount[k]; j++; }
        const rate = {}, avg = {}, dev = {};
        for (const k of KEYS) { rate[k] = win[k] / Math.max(win.obs, 1000) * ROLL_MS; avg[k] = cum[k] / Math.max(cum.obs, 1000) * ROLL_MS; dev[k] = j === 0 ? 0 : rate[k] - avg[k]; }
        cum.bidNet += Number(w.bidNet) || 0; cum.askNet += Number(w.askNet) || 0;
        cum.activeBuy += Number(w.activeBuy) || 0; cum.activeSell += Number(w.activeSell) || 0; cum.volume += Number(w.volume) || 0;
        const point = { t: w.end, w, dev, rate, avg, net: { bid: cum.bidNet, ask: cum.askNet }, cum: { activeBuy: cum.activeBuy, activeSell: cum.activeSell, volume: cum.volume } };
        // Queue-flow values belong to the actual snapshot span, not a delayed trade-response arrival.
        const plotAt = Math.max(anchors[anchors.length - 1].t, spans.length ? Math.min(w.end, spans[spans.length - 1][1]) : w.end);
        anchors.push({ ...point, t: plotAt }); real.push(point);
        const m = Math.min(239, Math.max(0, Math.ceil(minuteOf(w.end)) - 1));
        bars.buy[m] += Number(w.activeBuy) || 0; bars.sell[m] += Number(w.activeSell) || 0; bars.has[m] = 1;
      });
      // Interpolate the line only over observed time. Freeze it exactly at each gap's
      // start/end; do not extend a gap backwards over earlier valid observations.
      const pts = [anchors[0]];
      let coverageIndex = 0;
      for (let i = 1; i < anchors.length; i++) {
        const a = anchors[i - 1], b = anchors[i], blocks = [];
        while (coverageIndex < coverage.length && coverage[coverageIndex][1] <= a.t) coverageIndex++;
        let duration = 0;
        for (let n = coverageIndex; n < coverage.length && coverage[n][0] < b.t; n++) {
          const from = Math.max(a.t, coverage[n][0]), to = Math.min(b.t, coverage[n][1]);
          if (to > from) { blocks.push([from, to]); duration += to - from; }
        }
        const interpolate = (t, ratio) => ({ t, hold: true,
          dev: Object.fromEntries(KEYS.map(k => [k, a.dev[k] + (b.dev[k] - a.dev[k]) * ratio])),
          net: { bid: a.net.bid + (b.net.bid - a.net.bid) * ratio, ask: a.net.ask + (b.net.ask - a.net.ask) * ratio } });
        let cursor = a.t, elapsed = 0;
        for (const [from, to] of blocks) {
          if (from > cursor) {
            const ratio = elapsed / duration;
            if (cursor > pts[pts.length - 1].t) pts.push(interpolate(cursor, ratio));
            pts.push(interpolate(from, ratio));
          }
          elapsed += to - from; cursor = to;
        }
        if (cursor < b.t) {
          const ratio = duration ? elapsed / duration : 0;
          if (cursor > pts[pts.length - 1].t) pts.push(interpolate(cursor, ratio));
          pts.push(interpolate(b.t, ratio));
        }
        pts.push(b);
      }
      const last = pts[pts.length - 1];
      if (close > last.t) pts.push({ t: close, dev: last.dev, net: last.net, hold: true });
      return { pts, real, bars, t0, open, coverage };
    }
    function pathFor(pts, value, center, range) {
      let d = '', bucket = null, group = [];
      const flush = () => {
        if (!group.length) return;
        let lo = group[0], hi = group[0];
        for (const p of group) { if (p.y < lo.y) lo = p; if (p.y > hi.y) hi = p; }
        for (const p of [...new Set([group[0], lo, hi, group[group.length - 1]])].sort((a, b) => a.i - b.i)) d += (d ? 'L' : 'M') + p.x.toFixed(2) + ' ' + p.y.toFixed(2);
        group = [];
      };
      pts.forEach((p, i) => { const v = value(p); if (!Number.isFinite(v)) return; const x = xOf(p.t), b = Math.round(x * 2); if (b !== bucket || p.hold) { flush(); bucket = b; } group.push({ x, y: center - v / range * Q, i }); if (p.hold) flush(); });
      flush(); return d;
    }
    function drawLines(panel, bidValue, askValue) {
      let max = 0;
      for (const p of model.pts) max = Math.max(max, Math.abs(bidValue(p)), Math.abs(askValue(p)));
      // The range only grows when a new extreme appears; earlier lines then shrink proportionally.
      const range = Math.max(1, max * 1.12), nodes = [];
      for (const [value, center, color, side] of [[bidValue, Q, RED, 'bid'], [askValue, MID + Q, GREEN, 'ask']]) {
        const d = model.pts.length ? pathFor(model.pts, value, center, range) : '';
        if (d) nodes.push(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', 'data-side': side }));
      }
      panel.layer.replaceChildren(...nodes);
    }
    function drawBars(panel) {
      const nodes = [], b = model.bars;
      if (b) {
        let max = 0;
        for (let m = 0; m < 240; m++) max = Math.max(max, b.buy[m], b.sell[m]);
        const top = Math.max(1, max / 0.9), bw = W / 240;
        for (let m = 0; m < 240; m++) {
          if (!b.has[m]) continue;
          for (const [v, color, kind] of [[b.buy[m], RED, 'buy'], [b.sell[m], GREEN, 'sell']].filter(x => x[0] > 0).sort((x, y) => y[0] - x[0])) {
            const h = v / top * (MID - 2);
            nodes.push(svgEl('rect', { x: (m * bw + 0.15).toFixed(2), y: (MID - h).toFixed(2), width: (bw * 0.82).toFixed(2), height: h.toFixed(2), fill: color, 'data-kind': kind }));
          }
        }
      }
      panel.layer.replaceChildren(...nodes);
    }
    function setStatus(data) {
      if (!data?.code) { status.textContent = '查询后从开始观测的时刻画起；横轴为北京时间，与上方分时图对齐。'; return; }
      const n = model.real.length;
      if (!n) {
        status.textContent = data.day === data.today ? `${data.day}：暂无已结算的观测记录。交易时段保持页面打开即从开始观测的时刻画起；也可在上方切换到本机有记录的交易日查看。` : `${data.day}：本机没有这一天的观测记录，无法画图，不用其他日期代替。`;
        return;
      }
      status.textContent = `${data.day}｜${clock(model.t0)}（北京时间）开始观测｜已结算 ${n.toLocaleString('zh-CN')} 次成交更新｜未观测时段画平线｜${data.live ? '随记录实时更新' : '本机历史记录'}`;
    }
    function draw() {
      drawQueued = false;
      model = build(latest);
      drawLines(panels[0], p => p.dev.bidAdded, p => p.dev.askAdded);
      drawLines(panels[1], p => p.dev.bidCancelled, p => p.dev.askCancelled);
      drawLines(panels[2], p => p.net.bid, p => p.net.ask);
      drawBars(panels[3]);
      setStatus(latest);
      section.dataset.points = String(model.real.length);
      if (lastHover && !tip.hidden) show(lastHover.index, lastHover.frac, lastHover.fingerX); else hide();
    }
    function schedule(data) { latest = data; if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); } }

    function nearest(x) {
      const real = model.real; if (!real.length) return null;
      let lo = 0, hi = real.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (xOf(real[mid].t) < x) lo = mid + 1; else hi = mid; }
      if (lo > 0 && Math.abs(xOf(real[lo - 1].t) - x) <= Math.abs(xOf(real[lo].t) - x)) lo--;
      return real[lo];
    }
    function hide() { tip.hidden = true; for (const p of panels) p.cross.setAttribute('display', 'none'); }
    function show(index, frac, fingerX) {
      const p = nearest(frac * W);
      lastHover = { index, frac, fingerX };
      const mAtFinger = frac * 240;
      const target = model.open + mAtFinger * 60000 + (mAtFinger >= 120 ? 90 * 60000 : 0);
      let lo = 0, hi = model.coverage.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (model.coverage[mid][1] < target) lo = mid + 1; else hi = mid; }
      const observed = p && target >= model.t0 && (model.coverage[lo]?.[0] <= target || Math.abs(target - p.t) <= 1);
      const x = (observed ? xOf(p.t) : frac * W).toFixed(2);
      for (const panel of panels) { panel.cross.setAttribute('x1', x); panel.cross.setAttribute('x2', x); panel.cross.removeAttribute('display'); }
      const w = p?.w, m = p ? Math.min(239, Math.max(0, Math.ceil(minuteOf(p.t)) - 1)) : 0, b = model.bars;
      const lines = !observed ? [
        `${clock(target)}（北京时间）· 此时未观测`,
        !p ? '本日暂无已结算观测记录。' : target < model.t0 ? `尚未开始观测；起点 ${clock(model.t0)}。` : target > model.real[model.real.length - 1].t ? `最后已结算记录 ${clock(model.real[model.real.length - 1].t)}；之后尚无观测结果。` : '观测中断；此时没有可比较的盘口记录。',
        '水平线仅保持显示位置，不表示成交或挂单变化为0。',
        '不使用附近记录冒充该时刻的成交、加单或撤单。'
      ] : [
        `${clock(p.t)}（北京时间）· 本次成交 ${lots(w.volume)} 手`,
        `主动买入 ${lots(w.activeBuy)} 手 · 主动卖出 ${lots(w.activeSell)} 手`,
        `买盘：加单 ${lots(w.bidAdded)} · 撤单 ${lots(w.bidCancelled)} · 净加单 ${signed(w.bidNet)}`,
        `卖盘：加单 ${lots(w.askAdded)} · 撤单 ${lots(w.askCancelled)} · 净加单 ${signed(w.askNet)}`,
        `近1分钟/平均（手/分钟）：买加 ${lots(p.rate.bidAdded)}/${lots(p.avg.bidAdded)} · 买撤 ${lots(p.rate.bidCancelled)}/${lots(p.avg.bidCancelled)}`,
        `卖加 ${lots(p.rate.askAdded)}/${lots(p.avg.askAdded)} · 卖撤 ${lots(p.rate.askCancelled)}/${lots(p.avg.askCancelled)}`,
        `${minuteLabel(m)} 这1分钟：主动买入 ${lots(b.buy[m])} · 主动卖出 ${lots(b.sell[m])}`,
        `累计：买盘净加单 ${signed(p.net.bid)} · 卖盘净加单 ${signed(p.net.ask)} · 主动买入 ${lots(p.cum.activeBuy)} · 主动卖出 ${lots(p.cum.activeSell)}`
      ];
      tip.replaceChildren(...lines.map(text => make('div', '', text)));
      tip.hidden = false;
      // Show details over the other chart row so the chart under the finger stays visible.
      const cell = panels[index < 2 ? 2 : 0].cell, gridWidth = grid.clientWidth, tipWidth = tip.offsetWidth;
      tip.style.top = (cell.offsetTop + 4) + 'px';
      tip.style.left = Math.max(0, fingerX < gridWidth / 2 ? Math.min(gridWidth - tipWidth, fingerX + 18) : fingerX - tipWidth - 18) + 'px';
    }
    panels.forEach((panel, index) => {
      const locate = event => {
        const rect = panel.svg.getBoundingClientRect(), gridRect = grid.getBoundingClientRect();
        if (!rect.width) return;
        show(index, Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), event.clientX - gridRect.left);
      };
      panel.svg.addEventListener('pointerdown', event => { active = panel.svg; if (event.pointerType !== 'mouse') { try { panel.svg.setPointerCapture(event.pointerId); } catch { /* optional */ } } locate(event); });
      panel.svg.addEventListener('pointermove', event => { if (event.pointerType === 'mouse' || active === panel.svg) locate(event); });
      for (const type of ['pointerup', 'pointercancel']) panel.svg.addEventListener(type, event => { if (event.pointerType !== 'mouse') { active = null; lastHover = null; hide(); } });
      panel.svg.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') { active = null; lastHover = null; hide(); } });
    });
    document.addEventListener('bookwaves', event => schedule(event.detail));
    schedule(window.__bookWaveData || null);
    return section;
  }

  function arrange() {
    const flow = byId('bookFlowPanel');
    const three = byId('bookThreeSecondPanel');
    const trades = byId('thsdkTicks');
    const recorder = byId('bookRecorder');
    if (!flow || !three || !trades || !recorder || byId('bookRecordsPanel')) return;

    const watchlist = arrangeWatchlist();
    const dataBridge = make('div', 'book-data-bridge');
    dataBridge.hidden = true;
    dataBridge.setAttribute('aria-hidden', 'true');

    const methods = make('details', 'book-record-subsection book-methods');
    methods.append(make('summary', '', '加单与撤单统计说明'));
    const explanation = flow.querySelector('p.small');
    const additionExplanation = three.querySelector('p.hint');
    if (explanation) methods.append(explanation);
    if (additionExplanation) methods.append(additionExplanation);

    const metricsGrid = make('div', 'book-side-grid');
    const fields = [
      ['added', '累计加单（手）', /(?:累计)?加单\s+(.+?)\s*手/],
      ['cancelled', '累计撤单（手）', /(?:累计)?撤单\s+(.+?)\s*手/],
      ['net', '净加单（手）', /净加单\s+(.+?)\s*手/],
      ['netRate', '净加单率', /净加单率\s+(.+?)(?:；|。|$)/],
      ['reduced', '合计减少（手）', /(?:观察|合计)减少\s+(.+?)\s*手/],
      ['tradeCredit', '成交抵扣（手）', /(?:成交解释|成交抵扣)\s+(.+?)\s*手/],
      ['volume', '共同成交量（手）', /共同成交分母\s+(.+?)\s*手/]
    ];
    for (const [suffix, label] of [['Bid', '买盘'], ['Ask', '卖盘']]) {
      const card = make('section', 'book-side-card');
      card.dataset.side = suffix.toLowerCase();
      card.id = 'bookSide' + suffix;
      const heading = make('h3', '', label + '五档'); heading.id = card.id + 'Title';
      card.setAttribute('aria-labelledby', heading.id); card.append(heading);
      for (const id of ['bookFlow' + suffix, 'book' + suffix + 'Addition']) {
        const row = make('div', 'book-side-rate');
        const original = byId(id);
        original.classList.add('book-side-primary');
        row.append(original);
        card.append(row);
      }
      const source = byId('bookFlow' + suffix + 'Detail');
      const activeSource = byId('bookFlow' + suffix + 'Active');
      const additionSource = byId('book' + suffix + 'AdditionDetail');
      dataBridge.append(...[source, additionSource, activeSource].filter(Boolean));
      const dl = make('dl', 'book-side-fields');
      const cells = [];
      for (const [key, labelText, pattern] of fields) {
        const row = make('div'); row.dataset.field = key;
        const value = make('dd', '', '—');
        row.append(make('dt', '', labelText), value); dl.append(row);
        cells.push({ value, pattern });
      }
      const activeRow = make('div');
      activeRow.dataset.field = suffix === 'Bid' ? 'activeBuy' : 'activeSell';
      const activeValue = make('dd', '', '—');
      activeRow.append(make('dt', '', suffix === 'Bid' ? '主动买入（手）' : '主动卖出（手）'), activeValue);
      const refreshActive = () => {
        const text = activeSource?.textContent || '';
        const match = text.match(/：\s*(.+)$/);
        const displayed = match ? match[1].trim() : '—';
        if (activeValue.textContent !== displayed) activeValue.textContent = displayed;
      };
      if (activeSource) watch(activeSource, refreshActive);
      dl.append(activeRow);
      // Copy displayed totals from the application's existing result strings; do not recalculate.
      const refresh = () => {
        const fragments = source.textContent.split(/[；。]/).map(text => text.trim());
        for (const { value, pattern } of cells) {
          let displayed = '—';
          for (const fragment of fragments) {
            const match = fragment.match(pattern);
            if (match) { displayed = match[1].trim(); break; }
          }
          if (value.textContent !== displayed) value.textContent = displayed;
        }
      };
      watch(source, refresh);
      card.append(dl); metricsGrid.append(card);
    }

    const additionAt = byId('bookAdditionAt'), duplicateVolume = byId('bookThreeSource');
    if (additionAt) dataBridge.append(additionAt);
    if (duplicateVolume) dataBridge.append(duplicateVolume);
    const at = byId('bookFlowAt'), volume = byId('bookFlowVolume');
    const instant = byId('bookFlowInstant'), coverage = byId('bookFlowCoverage');
    flow.removeAttribute('style'); flow.className = 'book-comparison';
    flow.replaceChildren(make('h2', 'book-comparison-title', '五档加单与撤单'), at, volume, metricsGrid, instant, coverage, buildBookWaves());

    const records = make('section', 'card');
    records.id = 'bookRecordsPanel';
    records.setAttribute('aria-labelledby', 'bookRecordsTitle');
    const title = make('h2', '', '记录'); title.id = 'bookRecordsTitle'; records.append(title);
    trades.before(records);

    const originalBody = byId('bookThreeRows');
    const originalWrap = originalBody.closest('.table-wrap');
    const sourceDetails = make('details', 'book-record-source');
    sourceDetails.append(make('summary', '', '逐档成交更新明细（扩展）'), originalWrap);
    const tableViews = make('div', 'book-side-grid'); tableViews.id = 'bookTradeDetailGrid';
    const headers = ['成交更新区间（北京）', '结算确认时间（北京）', '本区间共同成交量（手）', '观察增加（手）', '合计减少（手）', '成交抵扣（手）', '加单（手）', '撤单（手）', '净加单（手）', '加单率', '撤单率', '净加单率'];
    const views = [];
    for (const [side, label] of [['bid', '买盘'], ['ask', '卖盘']]) {
      const section = make('section', 'book-side-card'); section.dataset.side = side;
      section.append(make('h3', '', label + '成交更新明细'), make('p', 'small', '按成交更新逐次列出 · 数量单位：手'));
      const wrap = make('div', 'table-wrap');
      wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label + '成交更新明细表，可横向滚动');
      const table = make('table'), head = make('thead'), headerRow = make('tr'), body = make('tbody');
      for (const text of headers) headerRow.append(make('th', '', text));
      head.append(headerRow); table.append(head, body); wrap.append(table); section.append(wrap); tableViews.append(section);
      views.push({ body, side });
    }
    const sourceValue = (row, side, field) => row.dataset['ui' + (side === 'bid' ? 'Bid' : 'Ask') + field] || '—';
    let mirroredSignature = null;
    const refreshTables = () => {
      const signature = JSON.stringify([...originalBody.rows].map(row => ({ ...row.dataset })));
      if (signature === mirroredSignature) return;
      mirroredSignature = signature;
      for (const { body: mirrorBody, side } of views) {
        const rows = [...originalBody.rows].map(sourceRow => {
          const values = [
            sourceRow.dataset.uiInterval,
            sourceRow.dataset.uiConfirmed,
            sourceRow.dataset.uiVolume,
            sourceValue(sourceRow, side, 'VisibleAdded'),
            sourceValue(sourceRow, side, 'ObservedReduction'),
            sourceValue(sourceRow, side, 'TradeCredit'),
            sourceValue(sourceRow, side, 'Added'),
            sourceValue(sourceRow, side, 'Cancelled'),
            sourceValue(sourceRow, side, 'Net'),
            sourceValue(sourceRow, side, 'AdditionRate'),
            sourceValue(sourceRow, side, 'ReductionRate'),
            sourceValue(sourceRow, side, 'NetRate')
          ];
          const row = make('tr');
          for (let i = 0; i < headers.length; i++) {
            const cell = make('td', '', values[i] || '—');
            cell.dataset.label = headers[i];
            row.append(cell);
          }
          return row;
        });
        if (!rows.length) {
          const row = make('tr'), cell = make('td', 'empty', '尚无已结算的成交更新，实时快照仍在下方保留。');
          cell.colSpan = headers.length; row.append(cell); rows.push(row);
        }
        mirrorBody.replaceChildren(...rows);
      }
    };
    const exportButton = byId('bookThreeCSV'), summary = byId('bookThreeSummary');
    three.replaceChildren(make('h3', '', '成交更新明细'), exportButton, summary, tableViews);
    watch(originalBody, refreshTables);

    const ledger = byId('bookLedger'), ledgerBody = byId('bookLedgerRows');
    let ledgerSourceDetails = null, ledgerTitle = null, ledgerDescription = null;
    if (ledger && ledgerBody) {
      const originalLedgerWrap = ledgerBody.closest('.table-wrap');
      ledgerTitle = ledger.querySelector(':scope > h3');
      ledgerDescription = [...ledger.children].find(node => node.tagName === 'P' && !node.id);
      const filter = byId('bookLedgerFilter'), filterLabel = filter?.closest('label');
      const ledgerExport = byId('bookLedgerCSV'), ledgerSummary = byId('bookLedgerSummary');
      const pager = byId('bookLedgerPrev')?.parentElement;
      pager?.classList.add('book-ledger-pager');
      const sideTables = make('div', 'book-ledger-sides');
      const ledgerViews = [];
      const ledgerHeaders = ['时间', '盘口 / 价格', '挂量变化（手）', '变动（手）'];
      for (const [side, label, suffix] of [['bid', '买盘', 'Bid'], ['ask', '卖盘', 'Ask']]) {
        const section = make('section', 'book-ledger-side');
        section.id = 'bookLedger' + suffix; section.dataset.side = side;
        section.setAttribute('aria-labelledby', section.id + 'Title');
        const heading = make('h4', '', label + '明细'); heading.id = section.id + 'Title'; section.append(heading);
        const wrap = make('div', 'table-wrap');
        wrap.style.maxHeight = '420px'; wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label + '价位变化明细');
        const table = make('table'); table.style.minWidth = '0';
        const thead = make('thead'), headerRow = make('tr'), tbody = make('tbody');
        for (const text of ledgerHeaders) headerRow.append(make('th', '', text));
        thead.append(headerRow); table.append(thead, tbody); wrap.append(table); section.append(wrap); sideTables.append(section);
        ledgerViews.push({ side, label, section, tbody });
      }
      let ledgerSignature = null;
      const refreshLedgerTables = () => {
        const sourceRows = [...ledgerBody.rows];
        const signature = JSON.stringify(sourceRows.map(row => [...row.cells].map(cell => cell.textContent)));
        if (signature !== ledgerSignature) {
          ledgerSignature = signature;
          for (const { side, label, tbody } of ledgerViews) {
            const rows = sourceRows.filter(row => (row.cells[1]?.textContent || '').trim().startsWith(label));
            const mirrors = rows.map(sourceRow => {
              const mirror = make('tr');
              for (const [index, sourceIndex] of [0, 1, 2, 5].entries()) {
                const cell = make('td', '', sourceRow.cells[sourceIndex]?.textContent || '—');
                cell.dataset.label = ledgerHeaders[index]; mirror.append(cell);
              }
              return mirror;
            });
            if (!mirrors.length) {
              const row = make('tr'), cell = make('td', 'empty', `本页暂无${label}价位变化记录`);
              cell.colSpan = 4; row.append(cell); mirrors.push(row);
            }
            tbody.replaceChildren(...mirrors);
          }
        }
        const activeFilter = filter?.value || 'all';
        for (const { side, section } of ledgerViews) section.hidden = activeFilter !== 'all' && activeFilter !== side;
      };
      ledgerSourceDetails = make('details', 'book-record-source');
      ledgerSourceDetails.append(make('summary', '', '完整原始盘口变化与快照（扩展）'), originalLedgerWrap);
      ledger.replaceChildren(...[filterLabel, ledgerExport, ledgerSummary, sideTables, pager].filter(Boolean));
      watch(ledgerBody, refreshLedgerTables);
    }

    for (const section of [three, trades, ledger, recorder].filter(Boolean)) {
      section.classList.remove('card'); section.classList.add('book-record-subsection');
      if (section === three || section === ledger) section.removeAttribute('style');
      records.append(section);
    }

    const methodsDetail = byId('bookMethodsDetail');
    if (methodsDetail && methodsDetail !== methods) methods.append(methodsDetail);
    records.append(methods);

    // Hosted-only controls and data tools remain available under the same self-list management area.
    const managementBody = watchlist?.managementBody;
    if (managementBody) {
      const recordTools = make('details', 'watchlist-record-tools');
      recordTools.append(make('summary', '', '本机记录与扩展工具'));
      const recordToolsBody = make('div', 'watchlist-record-tools-body');
      recordTools.append(recordToolsBody);

      const settings = make('details', 'watchlist-record-settings');
      settings.append(make('summary', '', '采集设置与说明'));
      const settingsBody = make('div', 'watchlist-record-settings-body');
      const settingsControls = make('div', 'watchlist-record-controls');
      const recordEnabled = byId('bookRecordEnabled');
      const recordEnabledLabel = recordEnabled?.closest('label');
      const restart = byId('bookRecordRestart');
      if (recordEnabledLabel) settingsControls.append(recordEnabledLabel);
      if (restart) settingsControls.append(restart);
      if (settingsControls.childNodes.length) settingsBody.append(settingsControls);
      settings.append(settingsBody); recordToolsBody.append(settings);

      const savedHistory = byId('bookSavedHistory');
      if (savedHistory) {
        savedHistory.classList.remove('card');
        const historyEntry = make('details', 'book-record-subsection book-advanced');
        historyEntry.append(make('summary', '', '本地历史记录（只读）'), savedHistory);
        recordToolsBody.append(historyEntry);
      }
      if (ledgerTitle || ledgerDescription) {
        const ledgerNotes = make('details', 'watchlist-record-notes');
        ledgerNotes.append(make('summary', '', '盘口变化说明'));
        const ledgerNotesBody = make('div', 'watchlist-record-notes-body');
        if (ledgerTitle) ledgerNotesBody.append(ledgerTitle);
        if (ledgerDescription) ledgerNotesBody.append(ledgerDescription);
        ledgerNotes.append(ledgerNotesBody); recordToolsBody.append(ledgerNotes);
      }
      if (ledgerSourceDetails) recordToolsBody.append(ledgerSourceDetails);
      const audit = byId('bookAuditPanel');
      if (audit) {
        audit.removeAttribute('style'); audit.classList.add('book-record-subsection');
        const auditSummary = audit.querySelector('summary');
        if (auditSummary) auditSummary.textContent = '数量核对（扩展功能）';
        recordToolsBody.append(audit);
      }
      recordToolsBody.append(sourceDetails);
      managementBody.append(recordTools);
    }

    records.append(dataBridge);
    const depth = byId('thsdkDepthBody')?.closest('table');
    if (depth && !depth.parentElement.classList.contains('table-scroll')) {
      const scroll = make('div', 'table-scroll'); depth.before(scroll); scroll.append(depth);
    }
    const loaded = byId('thsdkLoadedSummary');
    if (loaded) dataBridge.append(loaded);
    document.documentElement.dataset.uiParity = 'production-structure-20261026-r4';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrange, { once: true });
  else arrange();
})();
