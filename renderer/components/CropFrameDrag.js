// renderer/components/CropFrameDrag.js
// Drag-Handler für das Crop-Frame im Image-Pipeline-Dialog.
// Phase 3 Block 9: pure Funktion, keine App-State-Coupling.

/**
 * Macht das Crop-Frame draggable, constrained auf die Image-Bounds.
 * `displayScale` ist das image-pixel-zu-display-pixel-Verhältnis
 * (1.0 = kein Skalieren). Wenn das Bild kleiner als seine Natural-
 * Size gerendert wird, sind die CSS-Werte in Display-Pixeln, aber
 * die Bounds-Checks und der zurückgegebene Positions-Wert in
 * Image-Pixeln. Konvertierung findet an der Boundary statt.
 *
 * @param {HTMLElement} frame            Das zu draggende Frame-Element
 * @param {HTMLElement} stage            Stage-Container (für Bounds)
 * @param {() => number} getImageW      Image-Breite in Pixeln
 * @param {() => number} getImageH      Image-Höhe in Pixeln
 * @param {(x: number, y: number) => void} [onMove]
 *   Optional callback mit der neuen Position in Image-Pixeln
 * @param {number} [displayScale=1]
 */
function setupCropFrameDrag(frame, stage, getImageW, getImageH, onMove, displayScale = 1) {
  let dragging = false;
  let startX, startY, frameStartImgX, frameStartImgY;
  function onDown(e) {
    e.preventDefault();
    dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX; startY = pt.clientY;
    // The frame's CSS left/top is in display pixels. Convert to
    // image pixels so the move deltas below are in the right space.
    frameStartImgX = Math.round((parseInt(frame.style.left, 10) || 0) / displayScale);
    frameStartImgY = Math.round((parseInt(frame.style.top, 10) || 0) / displayScale);
    document.addEventListener('mousemove', onMv);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMv, { passive: false });
    document.addEventListener('touchend', onUp);
  }
  function onMv(e) {
    if (!dragging) return;
    e.preventDefault && e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    // Frame size in image pixels = CSS size / displayScale.
    const w = Math.round((parseInt(frame.style.width, 10) || 1) / displayScale);
    const h = Math.round((parseInt(frame.style.height, 10) || 1) / displayScale);
    const iw = getImageW() || 1;
    const ih = getImageH() || 1;
    // Convert display-pixel mouse deltas to image pixels.
    const dImgX = Math.round(dx / displayScale);
    const dImgY = Math.round(dy / displayScale);
    let nx = Math.max(0, Math.min(frameStartImgX + dImgX, iw - w));
    let ny = Math.max(0, Math.min(frameStartImgY + dImgY, ih - h));
    // Write back as display pixels.
    frame.style.left = (nx * displayScale) + 'px';
    frame.style.top = (ny * displayScale) + 'px';
    if (onMove) onMove(nx, ny);
  }
  function onUp() {
    dragging = false;
    document.removeEventListener('mousemove', onMv);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMv);
    document.removeEventListener('touchend', onUp);
  }
  frame.addEventListener('mousedown', onDown);
  frame.addEventListener('touchstart', onDown, { passive: false });
}

window.CropFrameDrag = { setupCropFrameDrag };
