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
  const modelSel = /** @type {any} */ (root.querySelector('[data-select="model"]'));
  /** @type {HTMLSelectElement} */
  const yearSel = /** @type {any} */ (root.querySelector('[data-select="year"]'));
  const paintGrid = root.querySelector('[data-paint-grid]');
  const paintUnavailable = root.querySelector('[data-paint-unavailable]');
  const inputPaintName = root.querySelector('[data-input="paint-name"]');
  const inputPaintCode = root.querySelector('[data-input="paint-code"]');
  const inputPaintHex = root.querySelector('[data-input="paint-hex"]');
  const sizeGrid = root.querySelector('[data-size-grid]');
  const sizeHidden = root.querySelector('[data-size-value]');
  const variantHidden = root.querySelector('[data-variant-id-value]');
  const summaryPaint = root.querySelector('[data-summary-paint]');
  const summaryVehicle = root.querySelector('[data-summary-vehicle]');
  const neutralBtn = root.querySelector('[data-neutral-preview]');
  const qtyInput = root.querySelector('[data-quantity-input]');
  const qtyValue = root.querySelector('[data-quantity-value]');
  const decreaseBtn = root.querySelector('[data-quantity-decrease]');
  const increaseBtn = root.querySelector('[data-quantity-increase]');
  const addBtn = root.querySelector('[data-add-btn]');
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
  let vehicleData = null;
  let selectedPaint = null;
  let selectedSize = null;

  /* Variant map from data attribute */
  const variantMap = JSON.parse(root.dataset.variantMap || '{}');

  /* ===== VEHICLE DATA ===== */
  async function loadVehicleData() {
    try {
      const url = root.dataset.vehicleDataUrl;
      const res = await fetch(url);
      const json = await res.json();
      vehicleData = json.vehicle_tree || json;
      populateMakes();
    } catch (e) {
      console.error('VeloForge: Failed to load vehicle data', e);
    }
  }

  function populateMakes() {
    const makes = Object.keys(vehicleData);
    makeSel.innerHTML = '<option value="">Select Make</option>' +
      makes.map(m => `<option value="${m}">${m}</option>`).join('');
    modelSel.innerHTML = '<option value="">Select Model</option>';
    yearSel.innerHTML = '<option value="">Select Year</option>';
  }

  function onMakeChange() {
    const make = makeSel.value;
    modelSel.innerHTML = '<option value="">Select Model</option>';
    yearSel.innerHTML = '<option value="">Select Year</option>';
    clearPaints();
    if (!make || !vehicleData?.[make]) return;
    const models = Object.keys(vehicleData[make]);
    modelSel.innerHTML += models.map(m => `<option value="${m}">${m}</option>`).join('');
    updateSummaryVehicle();
  }

  function onModelChange() {
    const make = makeSel.value;
    const model = modelSel.value;
    yearSel.innerHTML = '<option value="">Select Year</option>';
    clearPaints();
    if (!make || !model || !vehicleData?.[make]?.[model]) return;
    const years = Object.keys(vehicleData[make][model]);
    yearSel.innerHTML += years.map(y => `<option value="${y}">${y}</option>`).join('');
    updateSummaryVehicle();
  }

  function onYearChange() {
    const make = makeSel.value;
    const model = modelSel.value;
    const year = yearSel.value;
    clearPaints();
    if (!make || !model || !year) return;
    const paints = vehicleData?.[make]?.[model]?.[year];
    if (paints?.length) {
      renderPaints(paints);
    } else {
      paintUnavailable.style.display = '';
    }
    updateSummaryVehicle();
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
    }
    updateSummaryPaint();
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
      selectedSize = btn.dataset.size;
      sizeHidden.value = selectedSize;
      /* Resolve variant */
      const vid = variantMap[selectedSize];
      if (vid) variantHidden.value = vid;
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
    const parts = [makeSel.value, modelSel.value, yearSel.value].filter(Boolean);
    summaryVehicle.textContent = parts.length ? parts.join(' ') : '—';
  }

  /* ===== FORM SUBMIT ===== */
  form.addEventListener('submit', (e) => {
    if (!selectedSize) {
      e.preventDefault();
      showStatus('Please select a ring size.');
      return;
    }
    if (!makeSel.value || !modelSel.value || !yearSel.value) {
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

  /* ===== INIT ===== */
  if (makeSel) makeSel.addEventListener('change', onMakeChange);
  if (modelSel) modelSel.addEventListener('change', onModelChange);
  if (yearSel) yearSel.addEventListener('change', onYearChange);

  /* Also listen via event delegation as fallback */
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-select="make"]')) onMakeChange();
    else if (t.matches('[data-select="model"]')) onModelChange();
    else if (t.matches('[data-select="year"]')) onYearChange();
  });

  applyRingMask();
  loadVehicleData();
})();
