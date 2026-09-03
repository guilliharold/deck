// NOTE: @ffmpeg/ffmpeg and @ffmpeg/util are loaded with a dynamic import()
// inside loadFFmpeg() below, not a static top-of-file import. A static import
// of an external URL fails the whole module (silently, with zero errors shown
// to the user) if that one request has any hiccup — which would also kill the
// file-picker and drag-and-drop code further down, since none of this file
// would run at all. Dynamic import keeps the UI wiring independent of it.

const slot = document.getElementById('slot');
const fileInput = document.getElementById('fileInput');
const slotPrompt = document.getElementById('slotPrompt');
const loadedFile = document.getElementById('loadedFile');
const fileNameEl = document.getElementById('fileName');
const fileMetaEl = document.getElementById('fileMeta');
const formatSwitch = document.getElementById('formatSwitch');
const convertBtn = document.getElementById('convertBtn');
const meterFill = document.getElementById('meterFill');
const logEl = document.getElementById('log');
const outputWrap = document.getElementById('outputWrap');
const outName = document.getElementById('outName');
const outSize = document.getElementById('outSize');
const downloadLink = document.getElementById('downloadLink');

let currentFile = null;
let targetFormat = 'mp3';
let ffmpeg = null;
let ffmpegLoading = null;
let fetchFileRef = null;

function bytesToSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

function log(msg, cls) {
  logEl.classList.add('show');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setFile(file) {
  currentFile = file;
  slotPrompt.style.display = 'none';
  loadedFile.classList.add('show');
  fileNameEl.textContent = file.name;
  fileMetaEl.textContent = bytesToSize(file.size);
  convertBtn.disabled = false;
  outputWrap.classList.remove('show');
  logEl.classList.remove('show');
  logEl.innerHTML = '';
}

slot.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});

['dragenter', 'dragover'].forEach(evt =>
  slot.addEventListener(evt, (e) => {
    e.preventDefault();
    slot.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach(evt =>
  slot.addEventListener(evt, (e) => {
    e.preventDefault();
    slot.classList.remove('drag');
  })
);
slot.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

formatSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  formatSwitch.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  targetFormat = btn.dataset.fmt;
});

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpegLoading = (async () => {
    log('loading engine…');

    let FFmpeg, toBlobURL, fetchFile;
    try {
      [{ FFmpeg }, { toBlobURL, fetchFile }] = await Promise.all([
        import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js'),
        import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js'),
      ]);
    } catch (err) {
      log('could not load the conversion library from unpkg.com', 'err');
      log('check your connection, or that unpkg.com is not blocked (ad blockers/extensions sometimes do this)', 'err');
      throw err;
    }
    fetchFileRef = fetchFile;

    const instance = new FFmpeg();
    instance.on('log', ({ message }) => log(message));
    instance.on('progress', ({ progress }) => {
      meterFill.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    });

    // Multi-threaded core — needs the cross-origin isolation headers that
    // coi-serviceworker injects. Falls back to single-thread if that fails.
    try {
      const base = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';
      await instance.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        workerURL: await toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript'),
      });
      log('engine ready (multi-thread)', 'ok');
    } catch (err) {
      log('multi-thread core unavailable, falling back…', 'err');
      const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await instance.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      log('engine ready (single-thread)', 'ok');
    }

    ffmpeg = instance;
    return instance;
  })();

  return ffmpegLoading;
}

convertBtn.addEventListener('click', async () => {
  if (!currentFile) return;

  convertBtn.disabled = true;
  convertBtn.textContent = 'Working…';
  outputWrap.classList.remove('show');
  meterFill.style.width = '0%';
  logEl.innerHTML = '';
  logEl.classList.add('show');

  try {
    const engine = await loadFFmpeg();

    const inName = currentFile.name;
    const dot = inName.lastIndexOf('.');
    const baseName = dot > -1 ? inName.slice(0, dot) : inName;
    const outFileName = `${baseName}.${targetFormat}`;

    log(`writing ${inName} into engine…`);
    await engine.writeFile(inName, await fetchFileRef(currentFile));

    log(`converting to ${targetFormat.toUpperCase()}…`);
    await engine.exec(['-i', inName, outFileName]);

    const data = await engine.readFile(outFileName);
    const blob = new Blob([data.buffer], { type: `audio/${targetFormat}` });
    const url = URL.createObjectURL(blob);

    outName.textContent = outFileName;
    outSize.textContent = bytesToSize(blob.size);
    downloadLink.href = url;
    downloadLink.setAttribute('download', outFileName);
    outputWrap.classList.add('show');

    log('done', 'ok');

    // clean up engine FS
    await engine.deleteFile(inName);
    await engine.deleteFile(outFileName);
  } catch (err) {
    console.error(err);
    log(`error: ${err.message || err}`, 'err');
  } finally {
    convertBtn.disabled = false;
    convertBtn.textContent = 'Convert';
  }
});
