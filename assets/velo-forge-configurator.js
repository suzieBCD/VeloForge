(function () {
  'use strict';

  const root = document.querySelector('[data-vf-configurator]');
  if (!root) return;

  /* ===== DOM REFS ===== */
  const form = root.querySelector('form');
  const makeSel = root.querySelector('[data-select="make"]');
  const yearSel = root.querySelector('[data-select="year"]');
  const paintGrid = root.querySelector('[data-paint-grid]');
  const paintUnavailable = root.querySelector('[data-paint-unavailable]');
  const inputPaintName = root.querySelector('[data-input="paint-name"]');
  const inputPaintCode = root.querySelector('[data-input="paint-code"]');
  const inputPaintHex = root.querySelector('[data-input="paint-hex"]');
  const sizeGrid = root.querySelector('[data-size-grid]');
  const variantHidden = root.querySelector('[data-variant-id]');
  const summaryPaint = root.querySelector('[data-summary-paint]');
  const summaryVehicle = root.querySelector('[data-summary-vehicle]');
  const summaryCartPaint = root.querySelector('[data-summary-cart-paint]');
  const summaryCartVehicle = root.querySelector('[data-summary-cart-vehicle]');
  const propPaintName = root.querySelector('[data-prop="Paint Name"]');
  const propPaintCode = root.querySelector('[data-prop="Paint Code"]');
  const propHex = root.querySelector('[data-prop="Hex"]');
  const propOtherDetails = root.querySelector('[data-prop="Other Details"]');
  const propVehicle = root.querySelector('[data-prop="Vehicle"]');
  const propNotes = root.querySelector('[data-prop="Notes"]');
  const propNotesFallback = root.querySelector('[data-prop="Notes Fallback"]');
  const neutralBtn = root.querySelector('[data-neutral-preview]');
  const qtyInput = root.querySelector('[data-quantity-input]');
  const qtyValue = root.querySelector('[data-quantity-value]');
  const decreaseBtn = root.querySelector('[data-quantity-decrease]');
  const increaseBtn = root.querySelector('[data-quantity-increase]');
  const addBtn = root.querySelector('[data-add-to-cart]');
  const statusEl = root.querySelector('[data-status]');

  /* Ring preview layers (desktop + mobile) */
  const cwDesktop = root.querySelector('[data-ring-color-wash]');
  const tDesktop = root.querySelector('[data-ring-tint]');
  const hDesktop = root.querySelector('[data-ring-highlight]');
  const cwMobile = root.querySelector('[data-ring-color-wash-m]');
  const tMobile = root.querySelector('[data-ring-tint-m]');
  const hMobile = root.querySelector('[data-ring-highlight-m]');
  const ringInlayMask = root.dataset.ringInlay;

  /* Notes UI refs */
  const notesOpenBtn = root.querySelector('[data-notes-open]');
  const notesForm = root.querySelector('[data-notes-form]');
  const notesMakeInput = root.querySelector('[data-notes-make]');
  const notesYearInput = root.querySelector('[data-notes-year]');
  const notesPaintNameInput = root.querySelector('[data-notes-paint-name]');
  const notesPaintCodeInput = root.querySelector('[data-notes-paint-code]');
  const notesOtherDetailsInput = root.querySelector('[data-notes-other-details]');
  const notesSaveBtn = root.querySelector('[data-notes-save]');
  const notesCancelBtn = root.querySelector('[data-notes-cancel]');
  const notesPreview = root.querySelector('[data-notes-preview]');
  const notesPreviewText = root.querySelector('[data-notes-preview-text]');
  const notesEditBtn = root.querySelector('[data-notes-edit]');
  const notesDeleteBtn = root.querySelector('[data-notes-delete]');

  /* ===== STATE ===== */
  /** @type {Map<string, object>} Cache of make → model tree, populated on demand */
  const makeCache = new Map();
  let selectedPaint = null;
  let selectedSize = null;
  let qty = 1;

  let savedNotesData = null;
  let savedNotes = '';

  const STATE_KEY = 'vf_configurator_state_v2';
  const NOTES_KEY = 'vf_configurator_notes_v2';

  /* Variant map from inline JSON script tag */
  const variantMap = JSON.parse(root.querySelector('[data-variant-map]')?.textContent || '{}');

  /* ===== VEHICLE DATA ===== */

  /** Same slug logic as split-paint-data.js */
  function makeSlug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function getPaintDataUrl(make) {
    const indexUrl = root.dataset.paintIndexUrl || '';
    const slug = makeSlug(make);
    if (indexUrl) {
      return indexUrl.replace(/paint-index\.json(\?.*)?$/, `paint-data-${slug}.json`);
    }
    return `/assets/paint-data-${slug}.json`;
  }

  async function loadMakeData(make) {
    if (!make) return {};
    if (makeCache.has(make)) return makeCache.get(make);

    try {
      const res = await fetch(getPaintDataUrl(make));
      const json = await res.json();
      makeCache.set(make, json || {});
      return json || {};
    } catch (e) {
      console.error(`VeloForge: Failed to load paint data for ${make}`, e);
      makeCache.set(make, {});
      return {};
    }
  }

  function getYearsForMake(makeData) {
    const years = new Set();
    Object.values(makeData || {}).forEach((yearMap) => {
      Object.keys(yearMap || {}).forEach((year) => years.add(year));
    });

    return Array.from(years).sort((left, right) => Number(right) - Number(left) || String(right).localeCompare(String(left)));
  }

  function getPaintsForMakeYear(makeData, year) {
    const merged = [];
    const seen = new Set();

    Object.values(makeData || {}).forEach((yearMap) => {
      const paints = yearMap?.[year];
      if (!Array.isArray(paints)) return;

      paints.forEach((paint) => {
        const key = [paint.display_name, paint.paint_code, paint.hex_value].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(paint);
      });
    });

    return merged;
  }

  async function loadPaintIndex() {
    try {
      const url = root.dataset.paintIndexUrl;
      const res = await fetch(url);
      const json = await res.json();
      populateMakes(json.makes || []);
    } catch (e) {
      console.error('VeloForge: Failed to load paint index', e);
    }
  }

  function populateMakes(makes) {
    makeSel.innerHTML = '<option value="">Select Make</option>' +
      makes.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    yearSel.innerHTML = '<option value="">Select Year</option>';
  }

  async function onMakeChange() {
    const make = makeSel.value;
    yearSel.innerHTML = '<option value="">Select Year</option>';
    clearPaints();
    if (!make) {
      updateSummaryVehicle();
      updateReadiness();
      return;
    }

    const makeData = await loadMakeData(make);
    const years = getYearsForMake(makeData);
    yearSel.innerHTML += years.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join('');
    updateSummaryVehicle();
    updateReadiness();
  }

  async function onYearChange() {
    const make = makeSel.value;
    const year = yearSel.value;
    clearPaints();
    if (!make || !year) {
      updateSummaryVehicle();
      updateReadiness();
      return;
    }

    const makeData = await loadMakeData(make);
    const paints = getPaintsForMakeYear(makeData, year);
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
    if (paintGrid) paintGrid.innerHTML = '';
    if (paintUnavailable) paintUnavailable.style.display = 'none';
    selectedPaint = null;
    setColor(null);
    if (inputPaintName) inputPaintName.value = '';
    if (inputPaintCode) inputPaintCode.value = '';
    if (inputPaintHex) inputPaintHex.value = '';
    updateSummaryPaint();
  }

  function renderPaints(paints) {
    if (!paintGrid) return;
    paintGrid.innerHTML = paints.map((p, i) => `\n      <button type="button" class="vf-paint-swatch" data-paint-index="${i}" data-hex="${p.hex_value}" data-name="${escapeHtml(p.display_name)}" data-code="${escapeHtml(p.paint_code)}">\n        <span class="vf-paint-swatch__color" style="background:${p.hex_value}"></span>\n        <span class="vf-paint-swatch__info">\n          <span class="vf-paint-swatch__name">${escapeHtml(p.display_name)}</span>\n          <span class="vf-paint-swatch__code">${escapeHtml(p.paint_code)}</span>\n        </span>\n      </button>\n    `).join('');

    paintGrid.querySelectorAll('.vf-paint-swatch').forEach(btn => {
      btn.addEventListener('click', () => selectSwatch(btn));
    });
  }

  function selectSwatch(btn) {
    if (!paintGrid) return;
    paintGrid.querySelectorAll('.vf-paint-swatch').forEach(b => b.classList.remove('vf-paint-swatch--active'));
    btn.classList.add('vf-paint-swatch--active');
    const hex = btn.dataset.hex;
    const name = btn.dataset.name;
    const code = btn.dataset.code;
    selectedPaint = { hex, name, code };
    if (inputPaintName) inputPaintName.value = name || '';
    if (inputPaintCode) inputPaintCode.value = code || '';
    if (inputPaintHex) inputPaintHex.value = hex || '';
    setColor(hex);
    updateSummaryPaint();
    updateReadiness();
  }

  /* Manual paint inputs */
  function onManualPaintInput() {
    const name = inputPaintName?.value.trim() || '';
    const code = inputPaintCode?.value.trim() || '';
    const hexRaw = inputPaintHex?.value.trim() || '';
    if (hexRaw) {
      const normalizedHex = hexRaw.startsWith('#') ? hexRaw : '#' + hexRaw;
      selectedPaint = { hex: normalizedHex, name: name || 'Custom', code: code || '' };
      setColor(normalizedHex);
      if (paintGrid) paintGrid.querySelectorAll('.vf-paint-swatch').forEach(b => b.classList.remove('vf-paint-swatch--active'));
    } else {
      selectedPaint = null;
    }
    updateSummaryPaint();
    updateReadiness();
  }

  if (inputPaintName) inputPaintName.addEventListener('input', onManualPaintInput);
  if (inputPaintCode) inputPaintCode.addEventListener('input', onManualPaintInput);
  if (inputPaintHex) inputPaintHex.addEventListener('input', onManualPaintInput);

  /* ===== RING COLOR COMPOSITING ===== */
  function applyRingMask() {
    if (!ringInlayMask) return;
    const maskValue = `url("${ringInlayMask}")`;
    [cwDesktop, tDesktop, hDesktop, cwMobile, tMobile, hMobile]
      .filter(Boolean)
      .forEach((layer) => {
        try { layer.style.setProperty('--vf-ring-inlay-mask', maskValue); } catch (_) {}
      });
  }

  function setColor(hex) {
    const groups = [ [cwDesktop, tDesktop, hDesktop], [cwMobile, tMobile, hMobile] ];
    groups.forEach(([cw, t, h]) => {
      if (!cw) return;
      if (hex) {
        cw.style.backgroundColor = hex;
        if (t) t.style.backgroundColor = hex;
        if (h) h.style.backgroundColor = '#ffffff';
        cw.closest('[data-ring-preview]')?.classList.add('vf-ring-preview--active');
      } else {
        cw.style.backgroundColor = '';
        if (t) t.style.backgroundColor = '';
        if (h) h.style.backgroundColor = '';
        cw.closest('[data-ring-preview]')?.classList.remove('vf-ring-preview--active');
      }
    });
  }

  /* Neutral preview */
  if (neutralBtn) {
    neutralBtn.addEventListener('click', () => {
      setColor(null);
      if (paintGrid) paintGrid.querySelectorAll('.vf-paint-swatch').forEach(b => b.classList.remove('vf-paint-swatch--active'));
      selectedPaint = null;
      if (inputPaintName) inputPaintName.value = '';
      if (inputPaintCode) inputPaintCode.value = '';
      if (inputPaintHex) inputPaintHex.value = '';
      updateSummaryPaint();
    });
  }

  /* ===== SIZE SELECTOR ===== */
  sizeGrid?.querySelectorAll('.vf-size-btn')?.forEach(btn => {
    btn.addEventListener('click', () => {
      sizeGrid.querySelectorAll('.vf-size-btn').forEach(b => b.classList.remove('vf-size-btn--active'));
      btn.classList.add('vf-size-btn--active');
      selectedSize = btn.dataset.sizeValue;
      const vid = variantMap[selectedSize];
      if (vid && variantHidden) variantHidden.value = vid;
      updateReadiness();
    });
  });

  /* ===== QUANTITY ===== */
  if (decreaseBtn) decreaseBtn.addEventListener('click', () => { if (qty > 1) { qty--; updateQty(); } });
  if (increaseBtn) increaseBtn.addEventListener('click', () => { qty++; updateQty(); });

  function updateQty() {
    qtyValue.textContent = qty;
    if (qtyInput) qtyInput.value = qty;
  }

  /* ===== SUMMARY + HIDDEN PROPS ===== */
  function updateSummaryPaint() {
    const text = selectedPaint ? `${selectedPaint.name}${selectedPaint.code ? ' (' + selectedPaint.code + ')' : ''}` : '—';
    if (summaryPaint) summaryPaint.textContent = text;
    if (summaryCartPaint) summaryCartPaint.textContent = text;
    updateHiddenProps();
  }

  function updateSummaryVehicle() {
    const parts = [makeSel.value, yearSel.value].filter(Boolean);
    const text = parts.length ? parts.join(' ') : '—';
    if (summaryVehicle) summaryVehicle.textContent = text;
    if (summaryCartVehicle) summaryCartVehicle.textContent = text;
    updateHiddenProps();
  }

  function updateHiddenProps() {
    const setPropName = (input, name) => {
      if (!input) return;
      input.name = name;
    };

    const setPropValue = (input, value) => {
      if (!input) return;
      input.value = value;
    };

    const composePaintValue = () => {
      const name = inputPaintName?.value.trim() || '';
      const code = inputPaintCode?.value.trim() || '';

      if (name && code) return `${name} (${code})`;
      return name || code || '';
    };

    const getNotesSnapshot = () => {
      if (savedNotesData) return savedNotesData;
      return parseNotesText(savedNotes || '');
    };

    const notesSnapshot = getNotesSnapshot();
    const notesRaw = notesSnapshot.raw || savedNotes || '';
    const vehicleValue = [notesSnapshot.make, notesSnapshot.year].filter(Boolean).join(' ') || [makeSel.value, yearSel.value].filter(Boolean).join(' ');
    const paintValue = notesSnapshot.paint || composePaintValue();

    if (propPaintName) {
      setPropName(propPaintName, 'properties[Paint]');
      setPropValue(propPaintName, paintValue);
    }
    if (propPaintCode) {
      setPropName(propPaintCode, 'properties[_Paint Code]');
      setPropValue(propPaintCode, '');
    }
    if (propHex) {
      setPropName(propHex, 'properties[_Hex]');
      setPropValue(propHex, '');
    }
    if (propOtherDetails) {
      setPropName(propOtherDetails, 'properties[Other Details]');
      setPropValue(propOtherDetails, notesSnapshot.otherDetails || '');
    }
    if (propVehicle) {
      setPropName(propVehicle, 'properties[Vehicle]');
      setPropValue(propVehicle, vehicleValue);
    }
    if (propNotes) {
      setPropName(propNotes, notesSnapshot.make || notesSnapshot.year || notesSnapshot.paint || notesSnapshot.otherDetails ? 'properties[Notes]' : 'properties[_Notes]');
      setPropValue(propNotes, notesSnapshot.make || notesSnapshot.year || notesSnapshot.paint || notesSnapshot.otherDetails ? 'Paint color not found - custom' : '');
    }
    if (propNotesFallback) {
      setPropName(propNotesFallback, 'properties[_Notes]');
      setPropValue(propNotesFallback, notesRaw);
    }
  }

  function updateReadiness() {
    if (!addBtn) return;
    const hasSize = !!selectedSize;
    const hasVehicle = !!makeSel.value && !!yearSel.value;
    const hasPaint = !!(inputPaintName?.value || inputPaintHex?.value || selectedPaint);
    const ready = hasSize && (savedNotes || (hasVehicle && hasPaint));
    addBtn.disabled = !ready;
  }

  /* ===== FORM SUBMIT ===== */
  form?.addEventListener('submit', (e) => {
    updateHiddenProps();
    if (!selectedSize) {
      e.preventDefault(); showStatus('Please select a ring size.'); return;
    }
    if (!savedNotes) {
      if (!makeSel.value || !yearSel.value) { e.preventDefault(); showStatus('Please complete all vehicle fields.'); return; }
      if (!inputPaintName?.value && !inputPaintHex?.value && !selectedPaint) { e.preventDefault(); showStatus('Please select or enter a paint color.'); return; }
    }
  });

  function showStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  }

  /* ===== STATE PERSISTENCE ===== */
  function saveState() {
    const draftValues = getNotesFormValues();
    const state = {
      make: makeSel?.value || '',
      year: yearSel?.value || '',
      paintName: inputPaintName?.value || '',
      paintCode: inputPaintCode?.value || '',
      paintHex: inputPaintHex?.value || '',
      size: selectedSize || '',
      notes: savedNotes || '',
      notesDraft: draftValues,
      notesData: savedNotesData || null
    };
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
    // Also ensure saved notes are available for the notes-only restoration path
    try { sessionStorage.setItem(NOTES_KEY, JSON.stringify({ notes: savedNotes || buildNotesPreviewText(savedNotesData || draftValues || {}), notesData: savedNotesData || draftValues || null })); } catch (_) {}
  }

  async function restoreState() {
    try {
      const raw = sessionStorage.getItem(STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);

      // Restore vehicle selects if options exist
      if (state.make && makeSel.querySelector(`option[value="${CSSescape(state.make)}"]`)) {
        makeSel.value = state.make;
        await onMakeChange();
      }
      if (state.year && yearSel.querySelector(`option[value="${CSSescape(state.year)}"]`)) {
        yearSel.value = state.year;
        await onYearChange();
      }

      // Restore paint if present
      if (state.paintHex) {
        inputPaintName.value = state.paintName || '';
        inputPaintCode.value = state.paintCode || '';
        inputPaintHex.value = state.paintHex;
        const match = paintGrid.querySelector(`[data-hex="${state.paintHex}"]`);
        if (match) selectSwatch(match); else onManualPaintInput();
      }

      // Restore size
      if (state.size) {
        const sizeBtn = sizeGrid.querySelector(`[data-size-value="${CSSescape(state.size)}"]`);
        if (sizeBtn) sizeBtn.click();
      }

      // Restore saved notes (persisted) or restore a draft into the editor
      if (state.notes) {
        savedNotes = state.notes;
        savedNotesData = state.notesData || parseNotesText(savedNotes);
        try { sessionStorage.setItem(NOTES_KEY, JSON.stringify({ notes: savedNotes, notesData: savedNotesData })); } catch (_) {}
        showSavedNotePreview();
      } else if (state.notesDraft) {
        // If there's a draft but no saved note, open the editor with the draft
        if (notesForm) {
          openNotesEditor(state.notesDraft);
        }
      }

      // Clean up stored state after restore
      try { sessionStorage.removeItem(STATE_KEY); } catch (_) {}
    } catch (e) { /* ignore */ }
  }

  /* ===== NOTES UX ===== */
  function buildNotesPrefill() {
    return {
      make: makeSel.value || '',
      year: yearSel.value || '',
      paintName: inputPaintName?.value || '',
      paintCode: inputPaintCode?.value || '',
      otherDetails: '',
    };
  }

  function openNotesEditor(prefill) {
    if (!notesForm || !notesPreview) return;
    
    // Reset vehicle and paint selections if opening a fresh editor (not editing existing note)
    if (prefill === undefined) {
      makeSel.value = '';
      yearSel.innerHTML = '<option value="">Select Year</option>';
      clearPaints();
      hideVehicleGrid();
      updateSummaryVehicle();
      updateReadiness();
    }
    
    notesForm.style.display = '';
    notesPreview.style.display = 'none';
    const values = prefill === false
      ? buildNotesPrefill()
      : (prefill && typeof prefill === 'object' ? prefill : (savedNotesData || parseNotesText(savedNotes) || buildNotesPrefill()));

    if (notesMakeInput) notesMakeInput.value = values.make || '';
    if (notesYearInput) notesYearInput.value = values.year || '';
    if (notesPaintNameInput) notesPaintNameInput.value = values.paintName || '';
    if (notesPaintCodeInput) notesPaintCodeInput.value = values.paintCode || '';
    if (notesOtherDetailsInput) notesOtherDetailsInput.value = values.otherDetails || '';

    (notesMakeInput || notesYearInput || notesPaintNameInput || notesPaintCodeInput || notesOtherDetailsInput)?.focus();
  }

  function showSavedNotePreview() {
    if (!notesPreview || !notesPreviewText) return;
    notesPreviewText.textContent = savedNotes || buildNotesPreviewText(savedNotesData || parseNotesText(savedNotes));
    notesPreview.style.display = savedNotes ? '' : 'none';
    if (savedNotes) {
      if (document.querySelector('.vf__vehicle-grid')) hideVehicleGrid();
    } else {
      showVehicleGrid();
    }
    updateHiddenProps();
    updateReadiness();
  }

  function saveNotesFromEditor() {
    const parsed = {
      make: notesMakeInput?.value.trim() || '',
      year: notesYearInput?.value.trim() || '',
      paintName: notesPaintNameInput?.value.trim() || '',
      paintCode: notesPaintCodeInput?.value.trim() || '',
      otherDetails: notesOtherDetailsInput?.value.trim() || '',
    };

    if (parsed.make.length < 3) { alert('Make must be at least 3 characters.'); return; }
    if (!/^\d{4}$/.test(parsed.year)) { alert('Year must be 4 digits.'); return; }
    if (!parsed.paintName && !parsed.paintCode) { alert('Please fill in Paint Color Name or Paint Code:'); return; }

    parsed.paint = [parsed.paintName, parsed.paintCode].filter(Boolean).join(' ');
    parsed.raw = buildNotesPreviewText(parsed);

    savedNotes = parsed.raw;
    savedNotesData = parsed;
    try { sessionStorage.setItem(NOTES_KEY, JSON.stringify({ notes: savedNotes, notesData: savedNotesData })); } catch (_) {}
    if (notesForm) notesForm.style.display = 'none';
    showSavedNotePreview();
  }

  function editSavedNote() { openNotesEditor(savedNotesData || parseNotesText(savedNotes)); }

  function deleteSavedNote() {
    if (!confirm('Delete saved note?')) return;
    savedNotes = '';
    savedNotesData = null;
    try { sessionStorage.removeItem(NOTES_KEY); } catch (_) {}
    showSavedNotePreview();
  }

  function getNotesFormValues() {
    return {
      make: notesMakeInput?.value.trim() || '',
      year: notesYearInput?.value.trim() || '',
      paintName: notesPaintNameInput?.value.trim() || '',
      paintCode: notesPaintCodeInput?.value.trim() || '',
      otherDetails: notesOtherDetailsInput?.value.trim() || '',
    };
  }

  function hideVehicleGrid() { const g = document.querySelector('.vf__vehicle-grid'); if (g) g.style.display = 'none'; }
  function showVehicleGrid() { const g = document.querySelector('.vf__vehicle-grid'); if (g) g.style.display = ''; }

  /* ===== NOTES EVENT WIRING ===== */
  if (notesOpenBtn) notesOpenBtn.addEventListener('click', () => openNotesEditor());
  if (notesSaveBtn) notesSaveBtn.addEventListener('click', () => { saveNotesFromEditor(); updateHiddenProps(); updateReadiness(); });
  if (notesCancelBtn) notesCancelBtn.addEventListener('click', () => { if (notesForm) notesForm.style.display = 'none'; if (savedNotes) showSavedNotePreview(); else showVehicleGrid(); });
  if (notesEditBtn) notesEditBtn.addEventListener('click', () => editSavedNote());
  if (notesDeleteBtn) notesDeleteBtn.addEventListener('click', () => { deleteSavedNote(); updateHiddenProps(); updateReadiness(); });

  /* ===== INIT & RESTORE ===== */
  if (makeSel) makeSel.addEventListener('change', onMakeChange);
  if (yearSel) yearSel.addEventListener('change', onYearChange);

  // Preserve state when switching metal / karat (these are anchor links that navigate away)
  try {
    const optionLinks = root.querySelectorAll('.vf__option-buttons .vf-option-btn');
    optionLinks.forEach(link => {
      link.addEventListener('click', () => {
        saveState();
      });
    });
  } catch (e) { /* ignore */ }

  // Fallback: save state on unload
  try { window.addEventListener('beforeunload', saveState); } catch (e) {}

  applyRingMask();
  loadPaintIndex().then(async () => {
    // restore notes if present
    try {
      const raw = sessionStorage.getItem(NOTES_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        savedNotes = obj.notes || '';
        savedNotesData = obj.notesData || (savedNotes ? parseNotesText(savedNotes) : null);
      }
    } catch (_) {}
    await restoreState();
    showSavedNotePreview();
  });

  /* ===== UTILITIES ===== */
  function buildNotesPreviewText(data) {
    const make = data?.make || '';
    const year = data?.year || '';
    const paintLine = [data?.paintName || '', data?.paintCode || ''].filter(Boolean).join(' ');
    const lines = [
      `Make: ${make}`,
      `Year: ${year}`,
      `Paint Color Name + Code: ${paintLine}`,
    ];

    if (data?.otherDetails) {
      lines.push(`Other Details: ${data.otherDetails}`);
    }

    return lines.join('\n');
  }

  function parseNotesText(raw) {
    const lines = String(raw || '').split('\n').map((line) => line.trim());
    const make = readLabelValue(lines, ['Make:']);
    const year = readLabelValue(lines, ['Year:']);
    const paintCombo = readLabelValue(lines, ['Paint Color Name + Code:', 'Paint:']);
    const otherDetails = readMultilineLabelValue(lines, ['Other Details:']);
    const paintName = paintCombo.replace(/\s+\([^)]*\)\s*$/, '').trim() || paintCombo;
    const paintCodeMatch = paintCombo.match(/\(([^)]+)\)\s*$/);
    const paintCode = paintCodeMatch ? paintCodeMatch[1].trim() : '';
    const paint = [paintName, paintCode].filter(Boolean).join(' ').trim();

    return {
      raw: String(raw || '').trim(),
      make,
      year,
      paintName,
      paintCode,
      paint,
      otherDetails,
    };
  }

  function readLabelValue(lines, labels) {
    for (const line of lines) {
      for (const label of labels) {
        if (line.startsWith(label)) {
          return line.slice(label.length).trim();
        }
      }
    }
    return '';
  }

  function readMultilineLabelValue(lines, labels) {
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      for (const label of labels) {
        if (line.startsWith(label)) {
          const firstLine = line.slice(label.length).trim();
          const remaining = lines.slice(index + 1).filter(Boolean).join('\n');
          return [firstLine, remaining].filter(Boolean).join('\n').trim();
        }
      }
    }
    return '';
  }

  function escapeHtml(s) { return String(s).replace(/[&"'<>]/g, (c) => ({'&':'&amp;','"':'&quot;','\'':'&#39;','<':'&lt;','>':'&gt;'}[c])); }
  function CSSescape(v) { try { return CSS.escape(v); } catch (_) { return v; } }
  function CSSescapeSelector(v) { return v.replace(/"/g, '\\"'); }

})();
