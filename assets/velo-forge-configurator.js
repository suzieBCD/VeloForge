(function () {
  'use strict';

  /** @type {HTMLElement | null} */
  const root = document.querySelector('[data-vf-configurator]');
  if (!root) return;

  /* ===== DOM REFS ===== */
  const form = root.querySelector('form');
  /** @type {HTMLSelectElement} */
  const makeSel = /** @type {any} */ (root.querySelector('[data-select="make"]'));
  /** @type {HTMLSelectElement} */
  const yearSel = /** @type {any} */ (root.querySelector('[data-select="year"]'));
  const paintGrid = root.querySelector('[data-paint-grid]');
  const paintUnavailable = root.querySelector('[data-paint-unavailable]');
  const inputPaintName = root.querySelector('[data-input="paint-name"]');
  const inputPaintCode = root.querySelector('[data-input="paint-code"]');
  const inputPaintHex = root.querySelector('[data-input="paint-hex"]');
  const sizeGrid = root.querySelector('[data-size-grid]');
  const variantHidden = root.querySelector('[data-variant-id]');
  const summaryPaint = root.querySelector('[data-summary-paint]');
  const summaryVehicle = root.querySelector('[data-summary-vehicle]');
  const neutralBtn = root.querySelector('[data-neutral-preview]');
  const qtyInput = root.querySelector('[data-quantity-input]');
  const qtyValue = root.querySelector('[data-quantity-value]');
  const decreaseBtn = root.querySelector('[data-quantity-decrease]');
  const increaseBtn = root.querySelector('[data-quantity-increase]');
  const addBtn = root.querySelector('[data-add-to-cart]');
  const statusEl = root.querySelector('[data-status]');

  /* Ring preview layers (desktop + mobile) */
  const previews = root.querySelectorAll('[data-ring-preview]');
  const cwDesktop = root.querySelector('[data-ring-color-wash]');
  const tDesktop = root.querySelector('[data-ring-tint]');
  const hDesktop = root.querySelector('[data-ring-highlight]');
  const cwMobile = root.querySelector('[data-ring-color-wash-m]');
  const tMobile = root.querySelector('[data-ring-tint-m]');
  const hMobile = root.querySelector('[data-ring-highlight-m]');
  const ringInlayMask = root.dataset.ringInlay;

  /* ===== STATE ===== */
  /** @type {Map<string, object>} Cache of make → model tree, populated on demand */
  const makeCache = new Map();
  /** Internal model key, auto-selected from fetched make data */
  let activeModelKey = null;
  let selectedPaint = null;
  let selectedSize = null;

  /* Variant map from inline JSON script tag */
  const variantMap = JSON.parse(root.querySelector('[data-variant-map]')?.textContent || '{}');

  /* ===== VEHICLE DATA ===== */

  /** Same slug logic as split-paint-data.js */
  function makeSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async function loadPaintIndex() {
    try {
      const url = root.dataset.paintIndexUrl;
      const res = await fetch(url);
      const json = await res.json();
      populateMakes(json.makes);
    } catch (e) {
      console.error('VeloForge: Failed to load paint index', e);
    }
  }

  /**
   * Fetch and cache a single make's data.
   * Returns the model subtree or null on error.
   * @param {string} make
   * @returns {Promise<object|null>}
   */
  async function fetchMakeData(make) {
    if (makeCache.has(make)) return makeCache.get(make);
    try {
      const indexUrl = root.dataset.paintIndexUrl;
      const cdnBase = indexUrl.substring(0, indexUrl.lastIndexOf('/'));
      const chunkUrl = `${cdnBase}/paint-data-${makeSlug(make)}.json`;
      const res = await fetch(chunkUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      makeCache.set(make, data);
      return data;
    } catch (e) {
      console.error(`VeloForge: Failed to load paint data for "${make}"`, e);
      return null;
    }
  }

  function populateMakes(makes) {
    makeSel.innerHTML = '<option value="">Select Make</option>' +
      makes.map(m => `<option value="${m}">${m}</option>`).join('');
    yearSel.innerHTML = '<option value="">Select Year</option>';
  }

  async function onMakeChange() {
    const make = makeSel.value;
    yearSel.innerHTML = '<option value="">Select Year</option>';
    activeModelKey = null;
    clearPaints();
    if (!make) return;
    if (statusEl) statusEl.textContent = 'Loading colors…';
    const makeData = await fetchMakeData(make);
    if (statusEl) statusEl.textContent = '';
    if (!makeData) return;
    activeModelKey = Object.keys(makeData)[0];
    const years = Object.keys(makeData[activeModelKey] || {});
    yearSel.innerHTML += years.map(y => `<option value="${y}">${y}</option>`).join('');
    updateSummaryVehicle();
    updateReadiness();
  }

  function onYearChange() {
    const make = makeSel.value;
    const year = yearSel.value;
    clearPaints();
    if (!make || !activeModelKey || !year) return;
    const paints = makeCache.get(make)?.[activeModelKey]?.[year];
    if (paints?.length) {
      renderPaints(paints);
    } else {
      paintUnavailable.style.display = '';
    }
    updateSummaryVehicle();
    updateReadiness();
  }

  /* ===== PAINT SWATCHES ===== */
  function clearPaints() {
    paintGrid.innerHTML = '';
    paintUnavailable.style.display = 'none';
    selectedPaint = null;
    setColor(null);
    inputPaintName.value = '';
    inputPaintCode.value = '';
    inputPaintHex.value = '';
    updateSummaryPaint();
  }

  function renderPaints(paints) {
    paintGrid.innerHTML = paints.map((p, i) => `
      <button type="button" class="vf-paint-swatch" data-paint-index="${i}"
        data-hex="${p.hex_value}" data-name="${p.display_name}" data-code="${p.paint_code}">
        <span class="vf-paint-swatch__color" style="background:${p.hex_value}"></span>
        <span class="vf-paint-swatch__info">
          <span class="vf-paint-swatch__name">${p.display_name}</span>
          <span class="vf-paint-swatch__code">${p.paint_code}</span>
        </span>
      </button>
    `).join('');

    paintGrid.querySelectorAll('.vf-paint-swatch').forEach(btn => {
      btn.addEventListener('click', () => selectSwatch(btn));
    });
  }

  function selectSwatch(btn) {
    paintGrid.querySelectorAll('.vf-paint-swatch').forEach(b => b.classList.remove('vf-paint-swatch--active'));
    btn.classList.add('vf-paint-swatch--active');
    const hex = btn.dataset.hex;
    const name = btn.dataset.name;
    const code = btn.dataset.code;
    selectedPaint = { hex, name, code };
    inputPaintName.value = name;
    inputPaintCode.value = code;
    inputPaintHex.value = hex;
    setColor(hex);
    updateSummaryPaint();
    updateReadiness();
  }

  /* Manual paint inputs */
  function onManualPaintInput() {
    const name = inputPaintName.value.trim();
    const code = inputPaintCode.value.trim();
    const hex = inputPaintHex.value.trim();
    if (hex) {
      const normalizedHex = hex.startsWith('#') ? hex : '#' + hex;
      selectedPaint = { hex: normalizedHex, name: name || 'Custom', code: code || '' };
      setColor(normalizedHex);
      /* Deselect swatches */
      paintGrid.querySelectorAll('.vf-paint-swatch').forEach(b => b.classList.remove('vf-paint-swatch--active'));
    } else {
      selectedPaint = null;
    }
    updateSummaryPaint();
    updateReadiness();
  }

  inputPaintName.addEventListener('input', onManualPaintInput);
  inputPaintCode.addEventListener('input', onManualPaintInput);
  inputPaintHex.addEventListener('input', onManualPaintInput);

  /* ===== RING COLOR COMPOSITING ===== */
  function applyRingMask() {
    if (!ringInlayMask) return;

    const maskValue = `url("${ringInlayMask}")`;

    [cwDesktop, tDesktop, hDesktop, cwMobile, tMobile, hMobile]
      .filter(Boolean)
      .forEach((layer) => {
        layer.style.setProperty('--vf-ring-inlay-mask', maskValue);
      });
  }

  function setColor(hex) {
    const layerGroups = [
      [cwDesktop, tDesktop, hDesktop],
      [cwMobile, tMobile, hMobile],
    ];

    layerGroups.forEach(([cw, t, h]) => {
      if (!cw) return;

      const preview =
        cw.closest('[data-ring-preview]') ||
        cw.closest('[data-ring-preview-mobile]');

      if (hex) {
        cw.style.backgroundColor = hex;
        if (t) t.style.backgroundColor = hex;
        if (h) h.style.backgroundColor = '#ffffff';
        preview?.classList.add('vf-ring-preview--active');
      } else {
        cw.style.backgroundColor = '';
        if (t) t.style.backgroundColor = '';
        if (h) h.style.backgroundColor = '';
        preview?.classList.remove('vf-ring-preview--active');
      }
    });
  }

  /* Neutral preview */
  if (neutralBtn) {
    neutralBtn.addEventListener('click', () => {
      setColor(null);
      paintGrid.querySelectorAll('.vf-paint-swatch').forEach(b => b.classList.remove('vf-paint-swatch--active'));
      selectedPaint = null;
      inputPaintName.value = '';
      inputPaintCode.value = '';
      inputPaintHex.value = '';
      updateSummaryPaint();
    });
  }

  /* ===== SIZE SELECTOR ===== */
  sizeGrid.querySelectorAll('.vf-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      sizeGrid.querySelectorAll('.vf-size-btn').forEach(b => b.classList.remove('vf-size-btn--active'));
      btn.classList.add('vf-size-btn--active');
      selectedSize = btn.dataset.sizeValue;
      /* Resolve variant and set hidden id input */
      const vid = variantMap[selectedSize];
      if (vid && variantHidden) variantHidden.value = vid;
      updateReadiness();
    });
  });

  /* ===== QUANTITY ===== */
  let qty = 1;
  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', () => {
      if (qty > 1) { qty--; updateQty(); }
    });
  }
  if (increaseBtn) {
    increaseBtn.addEventListener('click', () => {
      qty++;
      updateQty();
    });
  }

  function updateQty() {
    qtyValue.textContent = qty;
    qtyInput.value = qty;
  }

  /* ===== SUMMARY ===== */
  function updateSummaryPaint() {
    if (!summaryPaint) return;
    summaryPaint.textContent = selectedPaint
      ? `${selectedPaint.name}${selectedPaint.code ? ' (' + selectedPaint.code + ')' : ''}`
      : '—';
  }

  function updateSummaryVehicle() {
    if (!summaryVehicle) return;
    const parts = [makeSel.value, yearSel.value].filter(Boolean);
    summaryVehicle.textContent = parts.length ? parts.join(' ') : '—';
  }

  function updateReadiness() {
    if (!addBtn) return;
    const ready = !!selectedSize &&
      !!makeSel.value && !!yearSel.value &&
      !!(inputPaintName.value || inputPaintHex.value);
    addBtn.disabled = !ready;
  }

  /* ===== FORM SUBMIT ===== */
  form.addEventListener('submit', (e) => {
    if (!selectedSize) {
      e.preventDefault();
      showStatus('Please select a ring size.');
      return;
    }
    if (!makeSel.value || !yearSel.value) {
      e.preventDefault();
      showStatus('Please complete all vehicle fields.');
      return;
    }
    if (!inputPaintName.value && !inputPaintHex.value) {
      e.preventDefault();
      showStatus('Please select or enter a paint color.');
      return;
    }
  });

  function showStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  }

  /* ===== STATE PERSISTENCE (sessionStorage) ===== */
  const STATE_KEY = 'vf_configurator_state';

  function saveState() {
    const state = {
      make: makeSel.value,
      year: yearSel.value,
      paintName: inputPaintName.value,
      paintCode: inputPaintCode.value,
      paintHex: inputPaintHex.value,
      size: selectedSize,
    };
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  async function restoreState() {
    let state;
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      if (!raw) return;
      state = JSON.parse(raw);
      sessionStorage.removeItem(STATE_KEY);
    } catch (_) { return; }

    /* Restore make — also fetches make data and populates years */
    if (state.make && makeSel.querySelector(`option[value="${CSS.escape(state.make)}"]`)) {
      makeSel.value = state.make;
      await onMakeChange();
    } else { return; }

    /* Restore year and load paints */
    if (state.year && yearSel.querySelector(`option[value="${CSS.escape(state.year)}"]`)) {
      yearSel.value = state.year;
      onYearChange();
    } else { return; }

    /* Restore paint inputs */
    if (state.paintHex) {
      inputPaintName.value = state.paintName || '';
      inputPaintCode.value = state.paintCode || '';
      inputPaintHex.value = state.paintHex;
      /* Highlight matching swatch if present */
      const match = paintGrid.querySelector(`[data-hex="${state.paintHex}"]`);
      if (match) { selectSwatch(match); } else { onManualPaintInput(); }
    }

    /* Restore ring size */
    if (state.size) {
      const sizeBtn = sizeGrid.querySelector(`[data-size-value="${CSS.escape(state.size)}"]`);
      if (sizeBtn) sizeBtn.click();
    }
  }

  /* Save state when navigating via Metal / Karat option buttons */
  root.addEventListener('click', (e) => {
    if (e.target.closest('.vf-option-btn')) saveState();
  });

  /* ===== INIT ===== */
  if (makeSel) makeSel.addEventListener('change', onMakeChange);
  if (yearSel) yearSel.addEventListener('change', onYearChange);

  applyRingMask();
  loadPaintIndex().then(restoreState);
})();
