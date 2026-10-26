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

  function arrange() {
    const flow = byId('bookFlowPanel');
    const three = byId('bookThreeSecondPanel');
    const trades = byId('thsdkTicks');
    const recorder = byId('bookRecorder');
    if (!flow || !three || !trades || !recorder || byId('bookRecordsPanel')) return;

    // Retain script-facing source nodes and IDs without showing duplicate text or tables.
    const dataBridge = make('div', 'book-data-bridge');
    dataBridge.hidden = true;
    dataBridge.setAttribute('aria-hidden', 'true');

    const foldBody = document.querySelector('.watchlist-fold-content');
    const favorites = byId('watchlistItems');
    if (foldBody && favorites) {
      const management = make('details', 'watchlist-management');
      management.append(make('summary', '', '管理 / 采集设置'));
      const controls = make('div', 'watchlist-management-body');
      for (const child of [...foldBody.childNodes]) if (child !== favorites) controls.append(child);
      management.append(controls);
      foldBody.append(favorites, management);
    }

    const methods = make('details', 'book-record-subsection book-methods');
    methods.append(make('summary', '', '加单与撤单统计说明'));
    const explanation = flow.querySelector('p.small');
    const additionExplanation = three.querySelector('p.hint');
    if (explanation) methods.append(explanation);
    if (additionExplanation) methods.append(additionExplanation);

    const metricsGrid = make('div', 'book-side-grid');
    const fields = [
      ['added', '累计加单（手）', /^(?:累计)?加单\s+(.+?)\s*手$/],
      ['cancelled', '累计撤单（手）', /^(?:累计)?撤单\s+(.+?)\s*手$/],
      ['net', '净加单（手）', /^净加单\s+(.+?)\s*手$/],
      ['netRate', '净加单率', /^净加单率\s+(.+)$/],
      ['reduced', '合计减少（手）', /^(?:观察|合计)减少\s+(.+?)\s*手$/],
      ['volume', '共同成交量（手）', /^共同成交分母\s+(.+?)\s*手$/]
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
      const additionSource = byId('book' + suffix + 'AdditionDetail');
      dataBridge.append(source, additionSource);
      const dl = make('dl', 'book-side-fields');
      const cells = [];
      for (const [key, labelText, pattern] of fields) {
        const row = make('div'); row.dataset.field = key;
        const value = make('dd', '', '—');
        row.append(make('dt', '', labelText), value); dl.append(row);
        cells.push({ value, pattern });
      }
      // Copy the application's existing display strings; do not calculate or round values here.
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
    flow.replaceChildren(make('h2', 'book-comparison-title', '五档加单与撤单'), at, volume, metricsGrid, instant, coverage);

    const records = make('section', 'card');
    records.id = 'bookRecordsPanel';
    records.setAttribute('aria-labelledby', 'bookRecordsTitle');
    const title = make('h2', '', '记录'); title.id = 'bookRecordsTitle'; records.append(title);
    trades.before(records);

    // Show the existing data as paired buy/sell tables; keep the old table only as a script data source.
    const originalBody = byId('bookThreeRows');
    const originalWrap = originalBody.closest('.table-wrap');
    dataBridge.append(originalWrap);
    const tableViews = make('div', 'book-side-grid'); tableViews.id = 'bookTradeDetailGrid';
    const headers = ['成交更新区间（北京）', '共同成交量（手）', '加单（手）', '撤单（手）', '净加单（手）', '加单率', '撤单率', '净加单率', '逐档明细'];
    const views = [];
    for (const [side, label, detailSide, indices] of [
      ['bid', '买盘', '买', [0, 1, 2, 3, 4, 5, 6, 7]],
      ['ask', '卖盘', '卖', [0, 1, 8, 9, 10, 11, 12, 13]]
    ]) {
      const section = make('section', 'book-side-card'); section.dataset.side = side;
      section.append(make('h3', '', label + '成交更新明细'), make('p', 'small', '按成交更新逐次列出 · 数量单位：手'));
      const wrap = make('div', 'table-wrap');
      wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', label + '成交更新明细表，可横向滚动');
      const table = make('table'), head = make('thead'), headerRow = make('tr'), body = make('tbody');
      for (const text of headers) headerRow.append(make('th', '', text));
      head.append(headerRow); table.append(head, body); wrap.append(table); section.append(wrap); tableViews.append(section);
      views.push({ body, indices, side, detailSide });
    }
    let mirroredSignature = null;
    const refreshTables = () => {
      const signature = JSON.stringify([...originalBody.rows].map(row => [...row.cells].map(cell => cell.textContent)));
      if (signature === mirroredSignature) return;
      mirroredSignature = signature;
      for (const { body: mirrorBody, indices, detailSide } of views) {
        const rows = [...originalBody.rows].map(sourceRow => {
          const row = make('tr');
          for (const index of indices) row.append(make('td', '', sourceRow.cells[index]?.textContent || '—'));
          const detailCell = make('td', 'book-level-cell');
          const sourceDetails = sourceRow.cells[16]?.querySelector('details');
          if (sourceDetails) {
            const details = sourceDetails.cloneNode(true);
            details.className = 'book-level-detail';
            const summary = details.querySelector('summary');
            if (summary) summary.textContent = '展开';
            const pre = details.querySelector('pre');
            if (pre) {
              let active = false;
              const lines = [];
              for (const line of pre.textContent.split(/\r?\n/)) {
                if (/^[买卖]\s/.test(line)) active = line.startsWith(detailSide + ' ');
                if (active) lines.push(line);
              }
              pre.textContent = lines.join('\n') || '暂无逐档明细';
            }
            detailCell.append(details);
          } else detailCell.textContent = '—';
          row.append(detailCell);
          return row;
        });
        if (!rows.length) {
          const row = make('tr'), cell = make('td', 'empty', '暂无已结算的成交更新区间');
          cell.colSpan = headers.length; row.append(cell); rows.push(row);
        }
        mirrorBody.replaceChildren(...rows);
      }
    };
    const exportButton = byId('bookThreeCSV'), summary = byId('bookThreeSummary');
    three.replaceChildren(make('h3', '', '成交更新明细'), exportButton, summary, tableViews);
    watch(originalBody, refreshTables);

    for (const section of [three, trades, recorder]) {
      section.classList.remove('card'); section.classList.add('book-record-subsection');
      if (section === three) section.removeAttribute('style');
      records.append(section);
    }

    const savedHistory = byId('bookSavedHistory');
    if (savedHistory) {
      savedHistory.classList.remove('card');
      const historyEntry = make('details', 'book-record-subsection book-advanced');
      historyEntry.append(make('summary', '', '本地历史记录（只读）'), savedHistory);
      records.append(historyEntry);
    }

    // Keep the existing filtering/pagination and audit interactions as concise feature entries.
    const ledger = byId('bookLedger');
    if (ledger) {
      ledger.removeAttribute('style'); ledger.classList.add('book-record-subsection');
      const ledgerEntry = make('details', 'book-record-subsection book-advanced');
      ledgerEntry.append(make('summary', '', '逐次盘口变化（筛选 / 分页）'), ledger);
      records.append(ledgerEntry);
    }
    const audit = byId('bookAuditPanel');
    if (audit) {
      audit.removeAttribute('style'); audit.classList.add('book-record-subsection');
      const auditSummary = audit.querySelector('summary');
      if (auditSummary) auditSummary.textContent = '数量核对（扩展功能）';
      records.append(audit);
    }
    const methodsDetail = byId('bookMethodsDetail');
    if (methodsDetail) methods.append(methodsDetail);
    records.append(methods, dataBridge);

    // Match the official page's compact export toolbar while preserving the hosted CSV action.
    const ledgerCSV = byId('bookLedgerCSV'), statsCSV = byId('bookStatsCSV');
    if (ledgerCSV && statsCSV) statsCSV.after(ledgerCSV);

    const depth = byId('thsdkDepthBody')?.closest('table');
    if (depth && !depth.parentElement.classList.contains('table-scroll')) {
      const scroll = make('div', 'table-scroll'); depth.before(scroll); scroll.append(depth);
    }
    const loaded = byId('thsdkLoadedSummary');
    if (loaded) dataBridge.append(loaded);
    document.documentElement.dataset.uiParity = 'production-structure-20261026-r2';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrange, { once: true });
  else arrange();
})();
