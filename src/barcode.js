'use strict';
// Product lookup never writes inventory. Saving still uses the existing household RPC.
window.FoodOSBarcode = (() => {
  const el = id => document.getElementById(id);
  let selected = null, controller = null, lookupToken = 0, scanToken = 0;
  let controls = null, scanTimer = null;
  const message = text => { el('barcodeStatus').textContent = text; };

  function normalize(value) {
    const code = String(value || '').replace(/[\s-]/g, '');
    if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) {
      throw new Error('Enter an 8, 12, 13, or 14 digit grocery barcode.');
    }
    let sum = 0;
    for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) {
      sum += Number(code[i]) * weight;
    }
    if ((10 - sum % 10) % 10 !== Number(code.at(-1))) {
      throw new Error('That barcode has an invalid check digit. Check the numbers or add the item manually.');
    }
    return code; // Keep leading zeroes; barcodes are identifiers, not numbers.
  }

  function invalidate() {
    lookupToken++;
    if (controller) controller.abort();
    controller = null;
    if (selected) el('foodName').value = '';
    selected = null;
    el('foodReviewed').checked = false;
    el('barcodeDetails').textContent = '';
    el('barcodeLookup').disabled = false;
    message('Look up the barcode, or clear it to add food manually.');
  }

  async function lookup() {
    stopScan();
    invalidate();
    let barcode;
    try { barcode = normalize(el('foodBarcode').value); }
    catch (e) { message(e.message); return; }
    el('foodBarcode').value = barcode;
    const token = ++lookupToken;
    const abort = new AbortController();
    controller = abort;
    selected = { barcode, status: 'pending' };
    el('barcodeLookup').disabled = true;
    message('Looking up this product…');
    const timeout = setTimeout(() => abort.abort(), 10000);
    const result = { barcode, status: 'unavailable', source: 'Open Food Facts' };
    try {
      const url = 'https://world.openfoodfacts.org/api/v3/product/' + encodeURIComponent(barcode)
        + '?fields=code,product_name,product_name_en,brands,quantity&lc=en&cc=us';
      const response = await fetch(url, { signal: abort.signal, credentials: 'omit' });
      if (response.status === 404) result.status = 'not_found';
      else {
        if (!response.ok) throw new Error('Lookup unavailable');
        const data = await response.json();
        const p = data.product;
        // A missing name or a mismatched code is not a usable product match.
        const rawName = p && (p.product_name_en || p.product_name);
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        const responseCode = String(data.code || (p && p.code) || '');
        if (name && responseCode.replace(/^0+/, '') === barcode.replace(/^0+/, '')) {
          result.status = 'matched';
          result.product_name = name;
          if (typeof p.brands === 'string' && p.brands.trim()) result.brand = p.brands.trim();
          if (typeof p.quantity === 'string' && p.quantity.trim()) result.package_quantity = p.quantity.trim();
        } else result.status = 'not_found';
      }
    } catch (_) { /* Network, timeout, or malformed response: offer manual entry. */ }
    finally { clearTimeout(timeout); }
    if (token !== lookupToken) return; // A changed barcode invalidates an older response.
    controller = null;
    result.retrieved_at = new Date().toISOString();
    selected = result;
    el('barcodeLookup').disabled = false;
    el('foodQty').value = '';
    el('foodStorage').value = '';
    el('foodReviewed').checked = false;
    if (result.status === 'matched') {
      el('foodName').value = result.product_name;
      el('barcodeDetails').textContent = [result.product_name, result.brand,
        result.package_quantity ? 'Package: ' + result.package_quantity : ''].filter(Boolean).join(' · ');
      message('Product found in Open Food Facts. Check the match against your package, then enter the amount you have and its storage location.');
    } else {
      el('foodName').value = '';
      message(result.status === 'not_found'
        ? 'No named product found. Enter the food name manually; this barcode will still be saved.'
        : 'Product lookup is unavailable. Enter the food name manually; this barcode will still be saved.');
    }
    el('foodName').focus();
  }

  function metadata() {
    const raw = el('foodBarcode').value.trim();
    if (!raw) return { source: 'manual' };
    const code = normalize(raw);
    if (!selected || selected.barcode !== code || selected.status === 'pending') {
      throw new Error('Look up this barcode first, or clear it to add food manually.');
    }
    return { source: 'barcode', barcode: code, product_lookup: { ...selected },
      product_reviewed: true, quantity_storage_reviewed: true };
  }

  function stopScan() {
    scanToken++;
    clearTimeout(scanTimer);
    scanTimer = null;
    if (controls) controls.stop();
    controls = null;
    const video = el('barcodeVideo');
    if (video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
    el('barcodeCamera').classList.add('hidden');
    el('barcodeScan').disabled = false;
  }

  async function scan() {
    stopScan();
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      message('Camera access needs HTTPS and a supported browser. You can type the barcode below.'); return;
    }
    if (!window.ZXingBrowser) { message('Camera scanner could not load. Type the barcode below.'); return; }
    const token = scanToken;
    el('barcodeScan').disabled = true;
    el('barcodeCamera').classList.remove('hidden');
    message('Allow camera access, then point the rear camera at the product barcode.');
    scanTimer = setTimeout(() => {
      if (token === scanToken) { stopScan(); message('No barcode found yet. Try scanning again or type the number.'); }
    }, 45000);
    try {
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      const started = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false }, el('barcodeVideo'),
        (result, error, active) => {
          if (token !== scanToken) { if (active) active.stop(); return; }
          if (!result) return;
          let code;
          try { code = normalize(result.getText()); } catch (_) { return; }
          if (active) active.stop();
          stopScan();
          el('foodBarcode').value = code;
          lookup();
        });
      if (token !== scanToken) { started.stop(); }
      else controls = started;
    } catch (_) {
      if (token === scanToken) {
        stopScan(); message('Camera could not start. Allow camera access in your browser, or type the barcode below.');
      }
    }
  }

  function reset() {
    stopScan();
    invalidate();
    el('foodBarcode').value = '';
    el('foodName').value = '';
    el('foodQty').value = '';
    el('foodStorage').value = '';
    message('Scan a package or type its barcode. Manual entry also works.');
  }
  function leave() {
    stopScan();
    if (selected && selected.status === 'pending') invalidate();
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(); });
  window.addEventListener('pagehide', stopScan);
  return { normalize, lookup, invalidate, metadata, scan, stopScan, reset, leave };
})();
