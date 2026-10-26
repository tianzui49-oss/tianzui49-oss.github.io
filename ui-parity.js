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
    flow.replaceChildren(make('h2', 'book-comparison-title', '五档加单与撤单'), at, volume, metricsGrid, instant, coverage);

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
