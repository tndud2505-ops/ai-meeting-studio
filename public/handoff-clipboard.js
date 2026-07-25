// Browser-only clipboard proof helper. It never runs by itself; the visible handoff button is its only caller.
(() => {
  const encoder = new TextEncoder();
  const utf8Bytes = value => encoder.encode(String(value)).byteLength;

  async function sha256Hex(value) {
    if (!window.crypto?.subtle) throw clipboardError('CLIPBOARD_UNAVAILABLE', 'unavailable', false);
    const hash = await window.crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function clipboardError(code, stage, writeOk, cause = null) {
    const error = new Error(code);
    error.code = code;
    error.stage = stage;
    error.writeOk = writeOk;
    if (cause) error.cause = cause;
    return error;
  }

  async function copyConfirmedText(pkg) {
    const clipboard = window.__rtClipboard ?? window.navigator?.clipboard;
    if (!clipboard?.writeText || !clipboard?.readText) {
      throw clipboardError('CLIPBOARD_UNAVAILABLE', 'unavailable', false);
    }
    if (!pkg || !pkg.userConfirmedAt || pkg.invalidatedAt
      || typeof pkg.fullText !== 'string' || typeof pkg.fullTextSha256 !== 'string') {
      throw clipboardError('CONFIRMED_PACKAGE_REQUIRED', 'unavailable', false);
    }
    try {
      await clipboard.writeText(pkg.fullText);
    } catch (cause) {
      throw clipboardError('CLIPBOARD_WRITE_FAILED', 'write', false, cause);
    }
    let readback;
    try {
      readback = await clipboard.readText();
    } catch (cause) {
      throw clipboardError('CLIPBOARD_READ_FAILED', 'read', true, cause);
    }
    const readbackBytes = utf8Bytes(readback);
    let readbackSha256;
    try { readbackSha256 = await sha256Hex(readback); }
    catch (cause) { throw clipboardError('CLIPBOARD_UNAVAILABLE', 'unavailable', true, cause); }
    if (readback !== pkg.fullText
      || readbackBytes !== pkg.fullTextBytes
      || readbackSha256 !== pkg.fullTextSha256) {
      const error = clipboardError('CLIPBOARD_MISMATCH', 'mismatch', true);
      error.readbackBytes = readbackBytes;
      error.readbackSha256 = readbackSha256;
      throw error;
    }
    return { readbackOk: true, writeOk: true, readback, readbackBytes, readbackSha256 };
  }

  window.RTHandoffClipboard = Object.freeze({ copyConfirmedText, sha256Hex, utf8Bytes });
})();
