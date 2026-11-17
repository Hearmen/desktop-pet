const root = document.getElementById('root');
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
let editing = false;
let data = null;

async function load() {
  try {
    data = await window.gallery.data();
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(el('p', null, 'Could not load the gallery: ' + e));
    return;
  }
  render();
}

function render() {
  root.innerHTML = '';
  document.body.classList.toggle('editing', editing);
  data.characters.forEach((c, ci) => {
    if (ci) root.appendChild(el('hr'));
    root.appendChild(el('h1', null, c.label));
    c.skins.forEach((s) => {
      root.appendChild(el('h2', null, s.label));
      s.poses.forEach((p) => {
        const head = el('div', 'pose');
        head.appendChild(document.createTextNode(p.label + ' '));
        head.appendChild(el('span', 'count', '· ' + p.frames.length + ' variants'));
        root.appendChild(head);
        const row = el('div', 'row');
        p.frames.forEach((f) => row.appendChild(frameFig(c, p, f)));
        if (editing) {
          const add = el('button', 'addbtn');
          add.innerHTML = '<span>＋</span>Add variant';
          add.onclick = () => startAdd(c, p);
          row.appendChild(add);
        }
        root.appendChild(row);
      });
    });
  });
}

function frameFig(c, p, f) {
  const fig = el('figure', (p.key === 'chibi' ? 'chibi' : 'full') + (f.name === 'neutral' ? ' neutral' : ''));
  const img = el('img');
  img.src = f.src;
  img.alt = c.label + ' ' + p.label + ' ' + f.name;
  img.loading = 'lazy';
  fig.appendChild(img);
  if (editing && f.name !== 'neutral') {
    const cap = el('input', 'namefield');
    cap.value = f.name;
    cap.onchange = async () => {
      const r = await window.gallery.rename(p.form, f.name, cap.value.trim());
      if (r && r.error) {
        alert(r.error);
        cap.value = f.name;
      } else {
        load();
      }
    };
    fig.appendChild(cap);
    const del = el('button', 'delbtn', '✕');
    del.title = 'Remove this variant';
    del.onclick = async () => {
      if (!confirm('Remove the "' + f.name + '" variant?')) return;
      const r = await window.gallery.remove(p.form, f.name);
      if (r && r.error) alert(r.error);
      else load();
    };
    fig.appendChild(del);
  } else {
    fig.appendChild(el('figcaption', null, f.name));
  }
  return fig;
}

// ---------- in-app processing: crop to the figure, drop stray bits, feather, scale ----------

// Keep only the largest blob of opaque pixels, so stray petals or scraps at the edge are dropped.
function keepLargest(d, w, h) {
  const a = d.data;
  const lab = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let best = -1;
  let bestSize = 0;
  let cur = 0;
  for (let i = 0; i < w * h; i++) {
    if (lab[i] !== -1 || a[i * 4 + 3] <= 24) continue;
    let sp = 0;
    stack[sp++] = i;
    lab[i] = cur;
    let size = 0;
    while (sp) {
      const q = stack[--sp];
      size++;
      const x = q % w;
      const y = (q / w) | 0;
      const nb = [];
      if (x > 0) nb.push(q - 1);
      if (x < w - 1) nb.push(q + 1);
      if (y > 0) nb.push(q - w);
      if (y < h - 1) nb.push(q + w);
      for (const n of nb) if (lab[n] === -1 && a[n * 4 + 3] > 24) {
        lab[n] = cur;
        stack[sp++] = n;
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = cur;
    }
    cur++;
  }
  for (let i = 0; i < w * h; i++) if (lab[i] !== best) a[i * 4 + 3] = 0;
}

// Measure the opaque bounding box.
function bbox(d, w, h) {
  const a = d.data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (a[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Where the source itself cut the figure at an edge, fade the alpha instead of a hard line.
function feather(ctx, w, h, width) {
  const d = ctx.getImageData(0, 0, w, h);
  const a = d.data;
  const op = (i) => a[i * 4 + 3] > 128;
  const edge = (pts) => pts.filter((i) => op(i)).length > 3;
  if (edge(Array.from({ length: w }, (_, x) => x))) for (let x = 0; x < w; x++) for (let r = 0; r < width; r++) a[(r * w + x) * 4 + 3] *= (r + 0.5) / width;
  if (edge(Array.from({ length: w }, (_, x) => (h - 1) * w + x))) for (let x = 0; x < w; x++) for (let r = 0; r < width; r++) a[((h - 1 - r) * w + x) * 4 + 3] *= (r + 0.5) / width;
  if (edge(Array.from({ length: h }, (_, y) => y * w))) for (let y = 0; y < h; y++) for (let r = 0; r < width; r++) a[(y * w + r) * 4 + 3] *= (r + 0.5) / width;
  if (edge(Array.from({ length: h }, (_, y) => y * w + w - 1))) for (let y = 0; y < h; y++) for (let r = 0; r < width; r++) a[(y * w + (w - 1 - r)) * 4 + 3] *= (r + 0.5) / width;
  ctx.putImageData(d, 0, 0);
}

// Render a source image onto the set's canvas: cleaned, scaled by `scale`, feet on the floor.
// `scale` of 1 makes the figure's height equal to `targetH` display px.
function processToCanvas(srcImg, canvasW, canvasH, targetH, scale) {
  // 1. clean + crop the source
  const c1 = document.createElement('canvas');
  c1.width = srcImg.naturalWidth;
  c1.height = srcImg.naturalHeight;
  const x1 = c1.getContext('2d', { willReadFrequently: true });
  x1.drawImage(srcImg, 0, 0);
  const d = x1.getImageData(0, 0, c1.width, c1.height);
  keepLargest(d, c1.width, c1.height);
  x1.putImageData(d, 0, 0);
  const b = bbox(d, c1.width, c1.height);
  if (!b) return null;
  // 2. scale so the cropped figure is targetH*scale tall, but never wider/taller than the canvas
  let s = (targetH * scale) / b.h;
  if (b.w * s > canvasW) s = canvasW / b.w;
  if (b.h * s > canvasH) s = canvasH / b.h;
  const dw = Math.max(1, Math.round(b.w * s));
  const dh = Math.max(1, Math.round(b.h * s));
  // 3. draw cropped+scaled onto a tight canvas, feather its cut edges
  const c2 = document.createElement('canvas');
  c2.width = dw;
  c2.height = dh;
  const x2 = c2.getContext('2d', { willReadFrequently: true });
  x2.imageSmoothingQuality = 'high';
  x2.drawImage(c1, b.x0, b.y0, b.w, b.h, 0, 0, dw, dh);
  feather(x2, dw, dh, 7);
  // 4. place bottom-centre on the set canvas
  const out = document.createElement('canvas');
  out.width = canvasW;
  out.height = canvasH;
  const xo = out.getContext('2d');
  xo.drawImage(c2, Math.round((canvasW - dw) / 2), canvasH - dh);
  return out;
}

// Measure a frame's figure height (display px) from its PNG, for sizing new variants to match.
function measureHeight(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth;
      cv.height = im.naturalHeight;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(im, 0, 0);
      const b = bbox(cx.getImageData(0, 0, cv.width, cv.height), cv.width, cv.height);
      resolve(b ? b.h : im.naturalHeight * 0.8);
    };
    im.onerror = () => resolve(0);
    im.src = src;
  });
}

// ---------- add-variant preview panel ----------

async function startAdd(c, p) {
  const picked = await window.gallery.pick(c.key);
  if (!picked) return;
  const src = new Image();
  src.onload = async () => {
    const neutral = p.frames.find((f) => f.name === 'neutral');
    const targetH = (await measureHeight(neutral.src)) || p.h * 0.8;
    openPanel(c, p, src, targetH, picked.path);
  };
  src.src = picked.dataURL;
}

function openPanel(c, p, src, targetH, srcName) {
  const back = el('div', 'panelback');
  const panel = el('div', 'panel');
  panel.appendChild(el('h3', null, 'Add variant — ' + c.label + ' · ' + p.label));
  panel.appendChild(el('div', 'srcname', srcName.split('/').pop()));

  const preview = el('div', 'preview');
  const cvWrap = el('div', 'cvwrap');
  preview.appendChild(cvWrap);
  panel.appendChild(preview);

  const controls = el('div', 'controls');
  const nameRow = el('label', 'ctl');
  nameRow.appendChild(el('span', null, 'Name'));
  const nameIn = el('input');
  nameIn.placeholder = 'e.g. laugh, angry, sit';
  nameIn.value = guessName(srcName, p);
  nameRow.appendChild(nameIn);
  controls.appendChild(nameRow);

  const scaleRow = el('label', 'ctl');
  scaleRow.appendChild(el('span', null, 'Size'));
  const scaleIn = el('input');
  scaleIn.type = 'range';
  scaleIn.min = '0.5';
  scaleIn.max = '1.6';
  scaleIn.step = '0.02';
  scaleIn.value = '1';
  const scaleVal = el('span', 'val', '1.00×');
  scaleRow.appendChild(scaleIn);
  scaleRow.appendChild(scaleVal);
  controls.appendChild(scaleRow);
  panel.appendChild(controls);

  const buttons = el('div', 'buttons');
  const cancel = el('button', 'ghost', 'Cancel');
  const save = el('button', 'primary', 'Save variant');
  buttons.appendChild(cancel);
  buttons.appendChild(save);
  panel.appendChild(buttons);

  // live preview, scaled to fit the panel
  let outCanvas = null;
  const redraw = () => {
    const scale = parseFloat(scaleIn.value);
    scaleVal.textContent = scale.toFixed(2) + '×';
    outCanvas = processToCanvas(src, p.w, p.h, targetH, scale);
    cvWrap.innerHTML = '';
    if (outCanvas) {
      outCanvas.classList.add('shot');
      cvWrap.appendChild(outCanvas);
    }
  };
  scaleIn.oninput = redraw;
  redraw();

  cancel.onclick = () => back.remove();
  save.onclick = async () => {
    if (!outCanvas) return;
    const r = await window.gallery.save(p.form, nameIn.value, outCanvas.toDataURL('image/png'));
    if (r && r.error) {
      alert(r.error);
      return;
    }
    back.remove();
    load();
  };

  back.appendChild(panel);
  back.onclick = (e) => {
    if (e.target === back) back.remove();
  };
  document.body.appendChild(back);
  nameIn.focus();
}

// A first guess at the variant name from the file name, else the next free slot number.
function guessName(file, p) {
  const stem = file.split('/').pop().replace(/\.[a-z]+$/i, '');
  const word = (stem.match(/[a-z]{3,}/i) || [])[0];
  if (word && !p.frames.some((f) => f.name === word.toLowerCase())) return word.toLowerCase();
  return '';
}

document.getElementById('editToggle').onclick = () => {
  editing = !editing;
  document.getElementById('editToggle').textContent = editing ? 'Done' : 'Edit';
  render();
};

// Exposed for an automated round-trip test of the add/remove pipeline (no file dialog).
window.__galleryTest = async () => {
  const p = data.characters[0].skins.find((s) => s.poses.some((q) => q.key === 'full')).poses.find((q) => q.key === 'full');
  const neutral = p.frames.find((f) => f.name === 'neutral');
  const targetH = await measureHeight(neutral.src);
  const src = await new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.src = neutral.src;
  });
  const out = processToCanvas(src, p.w, p.h, targetH, 1);
  const added = await window.gallery.save(p.form, 'zztest', out.toDataURL('image/png'));
  const after = await window.gallery.data();
  const pa = after.characters[0].skins.flatMap((s) => s.poses).find((q) => q.form === p.form);
  const has = pa.frames.some((f) => f.name === 'zztest');
  const removed = await window.gallery.remove(p.form, 'zztest');
  const after2 = await window.gallery.data();
  const pb = after2.characters[0].skins.flatMap((s) => s.poses).find((q) => q.form === p.form);
  const gone = !pb.frames.some((f) => f.name === 'zztest');
  return { form: p.form, targetH: Math.round(targetH), outSize: out && [out.width, out.height], added, has, removed, gone };
};

// Exposed so a test run can exercise the processing on an arbitrary image.
window.__visCheck = async (form, relpath) => {
  const p = data.characters.flatMap((c) => c.skins).flatMap((s) => s.poses).find((q) => q.form === form);
  const targetH = await measureHeight(p.frames.find((f) => f.name === 'neutral').src);
  const src = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = relpath;
  });
  const out = processToCanvas(src, p.w, p.h, targetH, 1);
  document.body.innerHTML = '';
  document.body.style.background = '#5a785a';
  out.style.height = '560px';
  document.body.appendChild(out);
  return { w: out.width, h: out.height };
};

load();
