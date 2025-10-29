
// ===== Helper: Match Tasks to Assets =====
/**
 * Matches tasks to assets by comparing audio URLs and asset src filenames (case-insensitive, ignores query params).
 * If a match is found, attaches validSrc and assetTitle to the task.
 * Logs each match and returns the updated tasks array.
 * @param {Array} tasks
 * @param {Array} assets
 * @returns {Array}
 */
function matchTasksToAssets(tasks = [], assets = []) {
    function extractFilename(url) {
        if (!url || typeof url !== 'string') return '';
        try {
            const urlNoQuery = url.split('?')[0];
            return urlNoQuery.substring(urlNoQuery.lastIndexOf('/') + 1).toLowerCase();
        } catch {
            return '';
        }
    }

    function collectAllAudioUrls(task) {
        const urls = new Set();
        if (task.audioUrl) urls.add(task.audioUrl);
        if (Array.isArray(task.targets)) {
            for (const t of task.targets) {
                if (t.url) urls.add(t.url);
                if (t.audioUrl) urls.add(t.audioUrl);
            }
        }
        if (task.rawTask && Array.isArray(task.rawTask.targets)) {
            for (const t of task.rawTask.targets) {
                if (t.url) urls.add(t.url);
                if (t.audioUrl) urls.add(t.audioUrl);
            }
        }
        if (Array.isArray(task.audioSources)) {
            for (const s of task.audioSources) {
                if (s.url) urls.add(s.url);
            }
        }
        if (task.preferredAudioUrl) urls.add(task.preferredAudioUrl);
        return [...urls];
    }

    for (const task of tasks) {
        const audioUrls = collectAllAudioUrls(task);
        const taskFilenames = audioUrls.map(extractFilename).filter(Boolean);
        if (!taskFilenames.length) continue;

        for (const asset of assets) {
            const assetFilename = extractFilename(asset.src);
            if (!assetFilename) continue;

            if (taskFilenames.includes(assetFilename)) {
                task.validSrc = asset.src;
                task.assetTitle = asset.title || assetFilename;
                console.log(`[matchTasksToAssets] Matched "${assetFilename}" to task "${task.id}"`);
                break;
            }
        }
    }

    return tasks;
}
// ===== Constants & Elements =====
const API_BASE = 'https://api.audioshake.ai';
const DB_NAME = 'audioshake_alignment_demo';
const STORE_SETTINGS = 'settings';

// ===== Filter Helpers =====
const FILTER_MODEL = 'alignment';
const FILTER_MEDIA_TYPES = ['audio/mpeg', 'video/mp4', "audio/wav"];

function filterTasksBy(tasks, model = FILTER_MODEL) {
    return (tasks || []).filter(t =>
        Array.isArray(t.targets) && t.targets.some(tt => tt.model === model)
    );
}

function filterAssetsBy(assets, allowed = FILTER_MEDIA_TYPES) {
    return (assets || []).filter(a =>
        !a.format || allowed.includes(a.format)
    );
}


const els = {
    authBtn: document.getElementById('authBtn'),
    authModal: document.getElementById('authModal'),
    authForm: document.getElementById('authForm'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    saveKeyBtn: document.getElementById('saveKeyBtn'),
    cancelKeyBtn: document.getElementById('cancelKeyBtn'),
    audioUrl: document.getElementById('audioUrl'),
    startBtn: document.getElementById('startBtn'),
    taskIdInput: document.getElementById('taskIdInput'),
    checkBtn: document.getElementById('checkBtn'),
    progress: document.getElementById('progress'),
    player: document.getElementById('player'),
    lyrics: document.getElementById('lyricsContainer'),
    alignmentList: document.getElementById('alignmentList'),
    loadBtn: document.getElementById('loadBtn'),
    output: document.getElementById('output'),

    // These are initally hidden
    assetList: document.getElementById('assetsList'),
    loadAssetBtn: document.getElementById('loadAssetBtn'),

    // for audio mixer 
    panControl: document.getElementById('pan'),
    mixToggle: document.getElementById('mixToBoth'),

    associatedAlignmentList: document.getElementById('associatedAlignmentList'),
    loadAssociatedAssetBtn: document.getElementById('loadAssociatedAssetBtn'),
    associatedDemoAssetList: document.getElementById('associatedDemoAssetList'),
    loadAssociatedDemoAssetBtn: document.getElementById('loadAssociatedDemoAssetBtn'),
};

let API_KEY = '';
// audio mixing
let ctx, src, split, merge, gainL, gainR;

let demoAssetsCache = [];
let tasksCache = [];
function setDemoAssetsMode(hasAssets) {
    const noDataElement = document.getElementById('noData');
    const hasDataElement = document.getElementById('hasData');
    if (!noDataElement || !hasDataElement) return;
    noDataElement.hidden = hasAssets;
    hasDataElement.hidden = !hasAssets;
}

setDemoAssetsMode(false);
updateAssociatedAlignmentsForAsset(null);
updateAssociatedDemoAssetsForTask(null);

function normalizeDemoAssets(payload) {
    if (!payload) return [];
    const candidates = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.assets)
            ? payload.assets
            : [];
    const now = Date.now();
    const withExpiryFilter = candidates.filter(item => {
        if (!item || typeof item.src !== 'string' || !item.src.trim()) return false;
        if (!item.expiry) return true;
        const expiryTime = Date.parse(item.expiry);
        if (Number.isNaN(expiryTime)) return true;
        return expiryTime > now;
    });
    return filterAssetsBy(withExpiryFilter);
}

function renderDemoAssetOptions(assets) {
    const select = els.assetList;
    if (!select) return null;

    const previousValue = select.value;
    select.innerHTML = '';

    if (!assets.length) {
        const placeholder = document.createElement('option');
        placeholder.textContent = 'No demo assets available';
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);
        return null;
    }

    const fragment = document.createDocumentFragment();
    for (const asset of assets) {
        if (!asset?.src) continue;
        const option = document.createElement('option');
        option.value = asset.src;
        option.textContent = asset.title || asset.src;
        fragment.appendChild(option);
    }
    select.appendChild(fragment);

    const preferred = assets.find(a => a?.src === previousValue)?.src || assets[0]?.src || null;
    if (preferred) {
        select.value = preferred;
    }
    return select.value || null;
}

function applyDemoAssets(payload, source = 'unknown') {
    const assets = normalizeDemoAssets(payload);
    demoAssetsCache = assets;

    if (!assets.length) {
        setDemoAssetsMode(false);
        renderDemoAssetOptions([]);
        console.warn(`[demoAssets] No valid assets provided from ${source}.`);
        return [];
    }

    setDemoAssetsMode(true);
    const selectedValue = renderDemoAssetOptions(assets);

    if (tasksCache.length) {
        tasksCache = matchTasksToAssets(tasksCache, demoAssetsCache);
    }

    if (selectedValue) {
        loadAssetAndLyrics(selectedValue).catch(err => {
            console.error('[demoAssets] Failed to load asset after apply', err);
        });
    }

    console.log(`[demoAssets] Applied ${assets.length} demo assets from ${source}.`);
    return assets;
}

// Ensure modal starts hidden regardless of prior state
if (els.authModal) {
    els.authModal.hidden = true;
    els.authModal.style.display = 'none';
}

//============= Load Demo assets
// Loads demo assets and wires up the assetsList and els.loadAssetBtn

// drag and drop support

async function addDragDropSupport() {
    const dropZone = document.getElementById('drop-zone');
    const jsonDisplay = document.getElementById('json-display');

    if (!dropZone || !jsonDisplay) return;

    // Prevent default drag and drop behavior on the entire window
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    // Add visual feedback for the drop zone
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    // Handle the dropped file
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');

        const file = e.dataTransfer.files[0];

        if (file && file.type === 'application/json') {
            const reader = new FileReader();

            reader.onload = async (event) => {
                try {
                    const jsonContent = JSON.parse(event.target.result);
                    const assets = applyDemoAssets(jsonContent, 'drag-drop');
                    if (assets.length) {
                        jsonDisplay.textContent = JSON.stringify(assets[0], null, 2);
                    } else {
                        jsonDisplay.textContent = 'No assets found in JSON file.';
                    }
                    console.log('[dragDrop] Successfully loaded JSON file via drag/drop:', assets.length);
                } catch (error) {
                    jsonDisplay.textContent = 'Error parsing JSON file. Please check the file format.';
                    console.error('Error parsing JSON:', error);
                }
            };

            reader.readAsText(file);
        } else {
            jsonDisplay.textContent = 'Please drop a valid JSON file.';
        }
    });


}



async function loadDemoAssets() {
    try {
        const res = await fetch('./demo-assets.json', { cache: 'no-store' });
        if (!res.ok) {
            throw new Error(`Failed to load demo-assets.json: ${res.status}`);
        }

        const json = await res.json();
        const assets = applyDemoAssets(json, 'local-file');
        console.log(`[loadDemoAssets] Loaded ${assets.length} assets from local file.`);
        return assets;
    } catch (err) {
        console.error('[loadDemoAssets] Error loading demo-assets.json', err);
        setDemoAssetsMode(false);
        return [];
    }
}




//======== Audio Mixer feature ===========

function initAudio() {
    if (ctx) return;
    ctx = new AudioContext();
    src = ctx.createMediaElementSource(els.player)

    split = ctx.createChannelSplitter(2);
    merge = ctx.createChannelMerger(2);
    gainL = ctx.createGain();
    gainR = ctx.createGain();

    src.connect(split);

    // default stereo routing
    split.connect(gainL, 0);
    split.connect(gainR, 1);
    gainL.connect(merge, 0, 0);
    gainR.connect(merge, 0, 1);
    merge.connect(ctx.destination);
}

// Safari AudioContext unlock shim
document.addEventListener('click', () => {
    if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(() => console.log('[AudioContext] resumed by user click (Safari unlock)'));
    }
}, { once: true });




// init our mixer 
els.player.addEventListener('play', () => { initAudio(); ctx.resume(); });

els.audioUrl.addEventListener('change', () => {

    console.log("Audio URL Changed", els.audioUrl.value)
});

// PAN CONTROL  (-1 = left, +1 = right)
els.panControl.addEventListener('input', e => {
    const p = parseFloat(e.target.value);
    if (!gainL || !gainR) return;
    // Linear fade: left louder as p→-1, right louder as p→+1
    gainL.gain.value = p <= 0 ? 1 : 1 - p;
    gainR.gain.value = p >= 0 ? 1 : 1 + p;
});

// MIX TO BOTH SPEAKERS toggle
els.mixToggle.addEventListener('change', e => {
    const mono = e.target.checked;
    if (!split) return;

    gainL.disconnect(); gainR.disconnect();

    if (mono) {
        // duplicate current L/R mix to both speakers
        split.connect(gainL, 0);
        split.connect(gainR, 1);
        gainL.connect(merge, 0, 0);
        gainL.connect(merge, 0, 1);
        gainR.connect(merge, 0, 0);
        gainR.connect(merge, 0, 1);
    } else {
        // restore stereo
        split.connect(gainL, 0);
        split.connect(gainR, 1);
        gainL.connect(merge, 0, 0);
        gainR.connect(merge, 0, 1);
    }
});

// ===== IndexedDB helpers =====
function openDb(version = 1) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, version);
        req.onupgradeneeded = (event) => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbSetSetting(key, value) {
    const db = await openDb();
    console.log("DB Set", db)
    return new Promise((res, rej) => {
        const tx = db.transaction(STORE_SETTINGS, 'readwrite');
        tx.objectStore(STORE_SETTINGS).put(value, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

async function dbGetSetting(key) {
    const db = await openDb();
    console.log("DB Get", db)
    return new Promise((resolve) => {
        const tx = db.transaction(STORE_SETTINGS, 'readonly');
        const req = tx.objectStore(STORE_SETTINGS).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
    });
}

// ===== API helpers =====
async function createTask(audioUrl) {
    console.log('[createTask] Creating task for URL:', audioUrl);
    const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: {
            'x-api-key': API_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: audioUrl, targets: [{ model: 'alignment', formats: ['json'] }] }),
    });
    console.log('[createTask] Response status:', res.status, res.statusText);
    if (!res.ok) {
        let err = {};
        try { err = await res.json(); } catch { }
        throw new Error(`API Error: ${res.status} ${res.statusText} - ${err.message || JSON.stringify(err)}`);
    }
    const data = await res.json();
    console.log('[createTask] Task ID:', data?.id, 'Status:', data?.status, 'Outputs:', (data?.outputs || []).map(o => o.status));
    return data;
}

async function getTask(id) {
    console.log('[getTask] Fetching task:', id);
    const res = await fetch(`${API_BASE}/tasks/${id}`, { headers: { 'x-api-key': API_KEY } });
    console.log('[getTask] Response status:', res.status, res.statusText);
    const data = await res.json();
    console.log('[getTask] Task status:', data?.status, 'Outputs:', (data?.outputs || []).map(o => o.status));
    return data;
}

async function listTasks(limit = 50) {
    console.log('[listTasks] Fetching recent tasks, limit:', limit);
    const res = await fetch(`${API_BASE}/tasks?limit=${limit}`, {
        headers: { 'x-api-key': API_KEY },
    });
    console.log('[listTasks] Response status:', res.status, res.statusText);
    if (!res.ok) {
        let err = {};
        try { err = await res.json(); } catch { }
        throw new Error(`Failed to list tasks: ${res.status} ${res.statusText} - ${err.message || JSON.stringify(err)}`);
    }
    const data = await res.json();
    console.log('[listTasks] Received task payload keys:', Object.keys(data || {}));
    return data;
}
function getTaskStatusInfo(task) {
    const entries = [];
    if (typeof task?.status === 'string') {
        const raw = task.status.trim();
        if (raw) entries.push({ raw, normalized: raw.toLowerCase() });
    }
    if (Array.isArray(task?.targets)) {
        for (const target of task.targets) {
            if (typeof target?.status === 'string') {
                const raw = target.status.trim();
                if (raw) entries.push({ raw, normalized: raw.toLowerCase() });
            }
        }
    }
    const priority = ['completed', 'complete', 'failed', 'processing', 'running', 'pending'];
    for (const desired of priority) {
        const match = entries.find(entry => entry.normalized === desired);
        if (match) return match;
    }
    return entries[0] || { raw: '', normalized: '' };
}

function getTaskAudioUrl(task) {
    if (typeof task?.audioUrl === 'string' && task.audioUrl.trim()) return task.audioUrl.trim();
    if (Array.isArray(task?.targets)) {
        for (const target of task.targets) {
            if (typeof target?.url === 'string' && target.url.trim()) return target.url.trim();
            if (typeof target?.audioUrl === 'string' && target.audioUrl.trim()) return target.audioUrl.trim();
        }
    }
    return '';
}

function collectTaskOutputs(task) {
    const outputs = [];
    if (Array.isArray(task?.outputs)) {
        outputs.push(...task.outputs);
    }
    if (Array.isArray(task?.targets)) {
        for (const target of task.targets) {
            if (Array.isArray(target?.output)) {
                outputs.push(...target.output);
            }
        }
    }
    return outputs;
}

function findAlignmentOutput(task, outputsOverride) {
    const outputs = outputsOverride || collectTaskOutputs(task);
    const checks = [
        (o) => ['alignment', 'Alignment'].includes(o?.name) && ['json', 'JSON'].includes(o?.format),
        (o) => ['json', 'JSON'].includes(o?.format),
        (o) => typeof o?.type === 'string' && o.type.toLowerCase().includes('json'),
    ];
    for (const check of checks) {
        const found = outputs.find(item => check(item));
        if (found) return found;
    }
    return null;
}

function choosePlayableAudio(primary, fallback) {
    const fallbackList = Array.isArray(fallback) ? fallback : (fallback ? [fallback] : []);
    const candidates = [];
    const seen = new Set();
    [primary, ...fallbackList].forEach(u => {
        const value = typeof u === 'string' ? u.trim() : u;
        if (value && !seen.has(value)) {
            seen.add(value);
            candidates.push(value);
        }
    });
    if (candidates.length === 0) {
        console.warn('[choosePlayableAudio] No candidate URLs provided.');
        return null;
    }
    console.log('[choosePlayableAudio] Using first available URL:', candidates[0]);
    return candidates[0];
}

async function pollTask(id, onProgress) {
    els.progress.hidden = false;
    let p = 0;
    while (true) {
        const task = await getTask(id);
        const statusInfo = getTaskStatusInfo(task);
        const statusText = statusInfo.raw || statusInfo.normalized || 'unknown';
        console.log('[pollTask] Poll iteration - status:', statusText, 'Task ID:', id);
        const normalized = statusInfo.normalized;
        if (normalized === 'completed' || normalized === 'complete') {
            els.progress.value = 100;
            return task;
        }
        if (normalized === 'failed') throw new Error('Task failed');
        p = Math.min(p + 10, 95);
        els.progress.value = p;
        if (onProgress) onProgress(p);
        await new Promise(r => setTimeout(r, 4000));
    }
}

function extractTaskArray(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.tasks)) return payload.tasks;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.results)) return payload.results;
    return [];
}

async function syncAlignmentsFromApi() {
    try {
        const payload = await listTasks();
        const tasks = filterTasksBy(extractTaskArray(payload));
        tasksCache = matchTasksToAssets(tasks, demoAssetsCache);
        console.log('[syncAlignmentsFromApi] Cached alignment tasks:', tasksCache.length);
        refreshAlignmentList();
        const currentAsset = els.assetList?.value;
        if (currentAsset) updateAssociatedAlignmentsForAsset(currentAsset);
    } catch (err) {
        console.error('[syncAlignmentsFromApi] Failed to sync tasks:', err);
    }
}

// ===== Lyrics rendering =====
async function renderLyricsFromJson(url) {
    // const res = await fetch(url);
    // const data = await res.json();
    let data;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Fetch failed with ${res.status}`);
        data = await res.json();
    } catch (error) {
        console.error('[renderLyricsFromJson] Failed to fetch JSON:', error);
        setOutput('Alignment data expired or unavailable. Please recreate task or refresh demo assets.');
        return;
    }

    const container = els.lyrics;
    container.innerHTML = '';
    const words = [];
    (data.lines || []).forEach(line => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'line';
        (line.words || []).forEach(w => {
            const span = document.createElement('span');
            span.className = 'word';
            span.textContent = (w.text || '') + ' ';
            span.dataset.start = w.start;
            span.dataset.end = w.end;
            lineDiv.appendChild(span);
            words.push(span);
        });
        container.appendChild(lineDiv);
    });
    els.player.ontimeupdate = () => {
        const t = els.player.currentTime;
        const container = els.lyrics;
        // Ensure container does not exceed max height (matches player max 480px)
        container.style.maxHeight = '480px';
        const containerRect = container.getBoundingClientRect();
        const containerHeight = container.clientHeight;
        const maxScroll = container.scrollHeight - containerHeight;

        for (const w of words) {
            const s = parseFloat(w.dataset.start);
            const e = parseFloat(w.dataset.end);
            const active = t >= s && t < e;
            w.classList.toggle('active', active);

            if (active) {
                const wordRect = w.getBoundingClientRect();
                const isVisible = wordRect.top >= containerRect.top && wordRect.bottom <= containerRect.bottom;

                if (!isVisible) {
                    // Calculate centered scroll target
                    let scrollTarget = w.offsetTop - containerHeight / 2 + w.clientHeight / 2;
                    // Clamp to valid scroll range
                    scrollTarget = Math.max(0, Math.min(scrollTarget, maxScroll));
                    container.scrollTo({
                        top: scrollTarget,
                        behavior: 'smooth'
                    });
                }
            }
        }
    };
}

// ===== UI Wiring =====
function setOutput(msg) { els.output.textContent = msg; }

function populateTaskSelect(list) {
    // Alignment list is managed by refreshAlignmentList().
}

function populateAssetSelect(list) {
    if (!els.assetList) return;
    els.assetList.innerHTML = '';
    list.forEach(a => {
        const opt = new Option(a.title || a.src, a.src);
        els.assetList.add(opt);
    });
    if (list.length) {
        els.assetList.value = list[0].src;
        els.assetList.dispatchEvent(new Event('change'));
    }
}

// ====== Metadata Rendering ======
function renderAlignmentMeta(task) {
    const metaDiv = document.getElementById('alignmentMeta');
    if (!metaDiv) return;

    if (!task) {
        metaDiv.innerHTML = '<em>No alignment selected</em>';
        return;
    }

    const target = (task.targets || [])[0] || {};
    const model = target.model || 'unknown';
    const language = target.language || '—';
    const duration = typeof target.duration === 'number'
        ? target.duration.toFixed(1) + ' s'
        : '—';
    const updated = new Date(task.updatedAt || task.completedAt || task.createdAt || '').toLocaleString();

    metaDiv.innerHTML = `
        <strong>Alignment Info:</strong><br>
        Model: ${model}<br>
        Language: ${language}<br>
        Duration: ${duration}<br>
        Updated: ${updated}
    `;
}

// Debug/test output function for alignment meta
function testOutput(obj) {
    const meta = document.getElementById('alignmentMeta');
    if (!meta) return;
    const text = JSON.stringify(obj, null, 2);
    if (meta.tagName === 'TEXTAREA') {
        meta.value = text;
    } else {
        meta.innerHTML = '<pre style="white-space: pre-wrap; font-size: 0.85em;">' + text + '</pre>';
    }
}

// Auth
els.authBtn.addEventListener('click', async () => {
    const saved = await dbGetSetting('api_key');
    els.apiKeyInput.value = saved || '';
    els.authModal.hidden = false;
    els.authModal.style.display = 'flex';
});
els.cancelKeyBtn.addEventListener('click', (event) => {
    event.preventDefault();
    els.authForm.reset();
    els.authModal.hidden = true;
    els.authModal.style.display = 'none';
});
els.authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = els.apiKeyInput.value.trim();
    if (!key) return alert('Enter API key.');
    await dbSetSetting('api_key', key);
    API_KEY = key;
    els.authForm.reset();
    els.authModal.hidden = true;
    els.authModal.style.display = 'none';
    alert('API key saved.');
});

// Close modal when clicking backdrop
els.authModal.addEventListener('click', (event) => {
    if (event.target === els.authModal) {
        els.authModal.hidden = true;
        els.authModal.style.display = 'none';
    }
});

// Load API key on startup
(async () => {
    await addDragDropSupport();
    const saved = await dbGetSetting('api_key');
    if (saved) {
        API_KEY = saved;
        console.log('[init] Loaded API key from IndexedDB');
        await syncAlignmentsFromApi();
    } else {
        setOutput('Authorize to use the demo. Visit http://dashboard.audioshake.ai to create an API key, then click "Authorize" to save it here.');
        els.authModal.hidden = true;
        els.authModal.style.display = 'none';
    }
    refreshAlignmentList();
})();

// Start alignment
els.startBtn.addEventListener('click', async () => {
    try {
        if (!API_KEY) return alert('Authorize first.');
       const sourceUrl = els.audioUrl.value.trim();
       if (!sourceUrl) return alert('Enter an audio URL.');

        setOutput('Creating task...');
        const task = await createTask(sourceUrl);
        const result = await pollTask(task.id);
        upsertTaskCache(result);
        const normalized = getTaskFromCache(result.id);
        if (!normalized) throw new Error('Task response did not include an alignment output.');
        els.alignmentList.value = normalized.id;
        await loadAlignmentTask(normalized);
    } catch (e) {
        setOutput('Error: ' + (e.message || String(e)));
    }
});



// Check status by task ID
els.checkBtn.addEventListener('click', async () => {
    try {
        if (!API_KEY) return alert('Authorize first.');
        const id = (els.taskIdInput.value || '').trim();
        if (!id) return alert('Enter a Task ID.');

        setOutput(`Fetching task ${id}...`);
        const rawTask = await getTask(id);
        upsertTaskCache(rawTask);
        const task = getTaskFromCache(id);
        if (!task) {
            setOutput(`Task ${id} does not include an alignment target yet.`);
            return;
        }

        const statusInfo = getTaskStatusInfo(task);
        const normalized = statusInfo.normalized;
        if (!(normalized === 'completed' || normalized === 'complete')) {
            setOutput(`Task ${id} is ${statusInfo.raw || statusInfo.normalized || 'pending'}...`);
            return;
        }

        await loadAlignmentTask(task);
    } catch (e) {
        setOutput('Error: ' + (e.message || String(e)));
    }
});

// ===== Alignment helpers =====
function shortFilename(url) {
    if (!url || typeof url !== 'string') return '(no file)';
    try {
        const clean = url.split('?')[0];
        const lastSlash = clean.lastIndexOf('/');
        if (lastSlash === -1) return clean || '(no file)';
        const name = clean.substring(lastSlash + 1);
        return name || '(no file)';
    } catch {
        return '(no file)';
    }
}

function stripExtension(filename) {
    if (!filename) return '';
    const lastDot = filename.lastIndexOf('.');
    return lastDot > 0 ? filename.slice(0, lastDot) : filename;
}

function baseNameFromUrl(url) {
    return stripExtension(shortFilename(url)).toLowerCase();
}

function taskTimestamp(task) {
    return Date.parse(task.updatedAt || task.completedAt || task.createdAt || '') || 0;
}

function normalizeTaskForCache(task) {
    if (!task) return null;
    const candidates = filterTasksBy([task]);
    return candidates[0] || null;
}

function upsertTaskCache(task) {
    const normalized = normalizeTaskForCache(task);
    if (!normalized) return;
    const index = tasksCache.findIndex(t => t.id === normalized.id);
    if (index >= 0) {
        tasksCache[index] = normalized;
    } else {
        tasksCache.push(normalized);
    }
    tasksCache = matchTasksToAssets(tasksCache, demoAssetsCache);
    refreshAlignmentList();
    if (els.assetList && els.assetList.value) {
        updateAssociatedAlignmentsForAsset(els.assetList.value);
    }
}

function getTaskFromCache(id) {
    return tasksCache.find(t => t.id === id) || null;
}

function refreshAlignmentList() {
    if (!els.alignmentList) return;
    const previousValue = els.alignmentList.value;
    const items = tasksCache.slice().sort((a, b) => taskTimestamp(b) - taskTimestamp(a));
    els.alignmentList.innerHTML = '';
    if (items.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'No alignments loaded';
        opt.disabled = true;
        opt.selected = true;
        els.alignmentList.appendChild(opt);
        testOutput({});
        renderAlignmentMeta(null);
        updateAssociatedDemoAssetsForTask(null);
        return;
    }

    for (const task of items) {
        const audioUrl = getTaskAudioUrl(task) || task.validSrc || '';
        const filename = shortFilename(audioUrl);
        const labelDate = new Date(taskTimestamp(task)).toLocaleString();
        const status = getTaskStatusInfo(task);

        const opt = document.createElement('option');
        opt.value = task.id;
        opt.textContent = `${filename} | ${task.id} | ${status.raw || status.normalized || 'unknown'} | ${labelDate}`;
        els.alignmentList.appendChild(opt);
    }

    if (previousValue && items.some(task => task.id === previousValue)) {
        els.alignmentList.value = previousValue;
    } else {
        els.alignmentList.value = items[0].id;
    }

    handleAlignmentSelection(els.alignmentList.value);
}

function updateAssociatedAlignmentsForAsset(assetSrc) {
    if (!els.associatedAlignmentList) return;
    const select = els.associatedAlignmentList;
    const previousValue = select.value;
    select.innerHTML = '';

    if (!assetSrc) {
        const opt = document.createElement('option');
        opt.textContent = 'Select a demo asset first';
        opt.disabled = true;
        opt.selected = true;
        select.appendChild(opt);
        return;
    }

    const assetBase = baseNameFromUrl(assetSrc);
    const matches = tasksCache.filter(task => {
        const taskUrls = [
            task.validSrc,
            getTaskAudioUrl(task),
            ...(Array.isArray(task.audioSources) ? task.audioSources.map(s => s.url) : []),
        ].filter(Boolean);
        return taskUrls.some(url => baseNameFromUrl(url) === assetBase);
    });

    if (!matches.length) {
        const opt = document.createElement('option');
        opt.textContent = 'No alignments yet';
        opt.disabled = true;
        opt.selected = true;
        select.appendChild(opt);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const task of matches) {
        const opt = document.createElement('option');
        const status = getTaskStatusInfo(task);
        const updated = new Date(taskTimestamp(task)).toLocaleString();
        opt.value = task.id;
        opt.textContent = `${task.id} (${status.raw || status.normalized || 'unknown'}) – ${updated}`;
        fragment.appendChild(opt);
    }
    select.appendChild(fragment);
    if (previousValue && matches.some(task => task.id === previousValue)) {
        select.value = previousValue;
    } else {
        select.value = matches[0].id;
    }
}

function cleanKey(str) {
    return (str || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function tokenizeName(str) {
    return (str || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function fuzzyEquals(a, b) {
    if (!a || !b) return false;
    const ca = cleanKey(a);
    const cb = cleanKey(b);
    if (!ca || !cb) return false;
    if (ca === cb) return true;
    if (ca.includes(cb) || cb.includes(ca)) return true;

    const tokensA = tokenizeName(a);
    const tokensB = tokenizeName(b);
    if (!tokensA.length || !tokensB.length) return false;

    const shared = tokensB.filter(token => tokensA.includes(token));
    if (shared.length >= 2) return true;
    if (tokensA[0] && tokensA[0] === tokensB[0] && shared.length >= 1) return true;

    return false;
}

function updateAssociatedDemoAssetsForTask(task) {
    if (!els.associatedDemoAssetList) return;
    const select = els.associatedDemoAssetList;
    const previousValue = select.value;
    select.innerHTML = '';

    if (!task || !demoAssetsCache.length) {
        const opt = document.createElement('option');
        opt.textContent = demoAssetsCache.length ? 'Select an alignment to see demo assets' : 'No demo assets loaded';
        opt.disabled = true;
        opt.selected = true;
        select.appendChild(opt);
        return;
    }

    const taskBaseNames = new Set();
    [
        task.validSrc,
        getTaskAudioUrl(task),
        ...(Array.isArray(task.audioSources) ? task.audioSources.map(s => s.url) : []),
    ].forEach(url => {
        const base = baseNameFromUrl(url);
        if (base) taskBaseNames.add(base);
    });

    const matches = demoAssetsCache.filter(asset => {
        const assetBase = baseNameFromUrl(asset.src);
        if (!assetBase) return false;
        for (const taskBase of taskBaseNames) {
            if (!taskBase) continue;
            if (fuzzyEquals(assetBase, taskBase)) return true;
        }
        return false;
    });

    if (!matches.length) {
        const opt = document.createElement('option');
        opt.textContent = 'No matching demo assets';
        opt.disabled = true;
        opt.selected = true;
        select.appendChild(opt);
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const asset of matches) {
        const opt = document.createElement('option');
        opt.value = asset.src;
        opt.textContent = asset.title || shortFilename(asset.src);
        fragment.appendChild(opt);
    }
    select.appendChild(fragment);
    if (previousValue && matches.some(asset => asset.src === previousValue)) {
        select.value = previousValue;
    } else {
        select.value = matches[0].src;
    }
}

async function loadAlignmentTask(task) {
    if (!task) return;
    const outputs = collectTaskOutputs(task);
    const alignmentOutput = findAlignmentOutput(task, outputs);
    const jsonUrl = alignmentOutput?.link || alignmentOutput?.url;
    if (!jsonUrl) {
        setOutput('Selected alignment has no JSON output.');
        return;
    }

    try {
        await renderLyricsFromJson(jsonUrl);
    } catch (err) {
        console.error('[loadAlignmentTask] Failed to render lyrics', err);
        setOutput('Failed to load alignment lyrics.');
        return;
    }

    const candidateUrls = [];
    if (task.validSrc) candidateUrls.push(task.validSrc);
    const taskAudio = getTaskAudioUrl(task);
    if (taskAudio) candidateUrls.push(taskAudio);
    const typedSource = els.audioUrl.value.trim();
    if (typedSource) candidateUrls.push(typedSource);
    const [primary, ...fallback] = candidateUrls;
    const resolved = choosePlayableAudio(primary, fallback);
    if (resolved) {
        els.player.src = resolved;
        setOutput(`Loaded alignment ${task.id}`);
    } else {
        els.player.pause();
        els.player.src = '';
        setOutput(`Lyrics loaded for ${task.id}, but no playable audio found. Use Associated Demo Assets to pick audio.`);
    }

    renderAlignmentMeta(task);
    testOutput(task);
    els.taskIdInput.value = task.id;
    localStorage.setItem('lastSelectedAlignment', task.id);
    updateAssociatedDemoAssetsForTask(task);
}

async function handleAlignmentSelection(id) {
    if (!id) return;
    if (els.alignmentList) {
        els.alignmentList.value = id;
    }
    let task = getTaskFromCache(id);
    if (!task) {
        try {
            const raw = await getTask(id);
            upsertTaskCache(raw);
            task = getTaskFromCache(id);
        } catch (err) {
            console.error('[handleAlignmentSelection] Failed to fetch task', err);
            setOutput('Failed to fetch alignment from API.');
            return;
        }
    }

    await loadAlignmentTask(task);

    if (els.associatedAlignmentList) {
        const option = Array.from(els.associatedAlignmentList.options || []).find(opt => opt.value === id);
        if (option) els.associatedAlignmentList.value = id;
    }
}

// ===== App Initialization =====
async function initApp() {
    try {
        const savedKey = await dbGetSetting('api_key');
        if (!savedKey) {
            if (els.authModal) {
                els.authModal.hidden = false;
                els.authModal.style.display = 'flex';
            }
            return;
        }
        API_KEY = savedKey;
        console.log('[initApp] Loaded API key');
        await syncAlignmentsFromApi();
        populateTaskSelect(tasksCache);
    } catch (err) {
        console.error('[initApp] Failed to load tasks', err);
    }
}


// Loads the selected asset and attempts to render lyrics/alignment if available
async function loadAssetAndLyrics(selectedSrc) {
    if (!selectedSrc || !els?.player) return;

    if (els.lyrics) els.lyrics.innerHTML = '';

    const selectedAsset = demoAssetsCache.find(a => a?.src === selectedSrc);
    if (!selectedAsset) {
        setOutput('Selected asset not found.');
        return;
    }

    els.player.src = selectedAsset.src;
    els.audioUrl.value = selectedAsset.src;
    els.audioUrl.dispatchEvent(new Event('change'));
    localStorage.setItem('lastSelectedAsset', selectedAsset.src);
    updateAssociatedAlignmentsForAsset(selectedAsset.src);
    updateAssociatedDemoAssetsForTask(null);
    testOutput(selectedAsset);
    setOutput(`Loaded demo asset: ${selectedAsset.title || shortFilename(selectedAsset.src)}. Pick an associated alignment to view lyrics.`);
}

// Modified to use loadAssetAndLyrics
function loadSelectedDemoAsset() {
    if (!els?.assetList || !els?.player) return;
    const selected = els.assetList.value;
    if (!selected) return;
    loadAssetAndLyrics(selected).catch(err => {
        console.error('[demoAssets] Failed to load selected asset', err);
        setOutput('Failed to load selected demo asset.');
    });
}

async function initializeDemoAssetsSelect() {
    if (!els?.assetList) return;
    if (demoAssetsCache.length) {
        setDemoAssetsMode(true);
        const selected = renderDemoAssetOptions(demoAssetsCache);
        if (selected) {
            loadAssetAndLyrics(selected).catch(err => {
                console.error('[demoAssets] Failed to load cached asset during init', err);
            });
        }
        return;
    }
    await loadDemoAssets();
}

document.addEventListener('DOMContentLoaded', () => {

    initializeDemoAssetsSelect().then(() => {
        initApp().then(() => {
            // After initApp resolves, match tasks to assets
            tasksCache = matchTasksToAssets(tasksCache, demoAssetsCache);

            // Restore last selected asset and alignment from localStorage
            const lastAsset = localStorage.getItem('lastSelectedAsset');
            const lastAlignment = localStorage.getItem('lastSelectedAlignment');
            if (lastAsset && els.assetList) {
                els.assetList.value = lastAsset;
                loadAssetAndLyrics(lastAsset).catch(err => {
                    console.error('[restoreState] Failed to load restored asset', err);
                });
                console.log('[restoreState] Restored asset', lastAsset);
            }
            if (lastAlignment && els.alignmentList && getTaskFromCache(lastAlignment)) {
                els.alignmentList.value = lastAlignment;
                handleAlignmentSelection(lastAlignment);
                console.log('[restoreState] Restored alignment', lastAlignment);
            }

            // If no saved asset was restored, ensure we populate associated alignments now that tasks are loaded
            if (!lastAsset && els.assetList && els.assetList.value) {
                loadAssetAndLyrics(els.assetList.value).catch(err => {
                    console.error('[init] Failed to load asset after tasks loaded', err);
                });
                console.log('[init] Populated associated alignments after tasks loaded for asset', els.assetList.value);
            }
        });
    });
    if (els.assetList) {
        els.assetList.addEventListener('change', loadSelectedDemoAsset);
    }
    if (els.loadAssetBtn) {
        els.loadAssetBtn.addEventListener('click', loadSelectedDemoAsset);
    }
    if (els.alignmentList) {
        els.alignmentList.addEventListener('change', () => handleAlignmentSelection(els.alignmentList.value));
    }
    if (els.loadBtn) {
        els.loadBtn.addEventListener('click', () => handleAlignmentSelection(els.alignmentList?.value));
    }
});

els.associatedAlignmentList?.addEventListener('change', () => {
    const id = els.associatedAlignmentList.value;
    handleAlignmentSelection(id);
});

els.loadAssociatedAssetBtn?.addEventListener('click', () => {
    const id = els.associatedAlignmentList?.value;
    if (!id) return alert('Select an alignment first.');
    handleAlignmentSelection(id);
});

els.associatedDemoAssetList?.addEventListener('change', e => {
    const src = e.target.value;
    if (!src) return;
    const asset = demoAssetsCache.find(a => a?.src === src);
    if (asset) testOutput(asset);
});

els.loadAssociatedDemoAssetBtn?.addEventListener('click', () => {
    const option = els.associatedDemoAssetList?.selectedOptions?.[0];
    if (!option || option.disabled) return alert('Select a demo asset first.');
    const asset = demoAssetsCache.find(a => a?.src === option.value);
    if (!asset) return alert('Asset not found.');
    els.player.src = asset.src;
    els.audioUrl.value = asset.src;
    els.audioUrl.dispatchEvent(new Event('change'));
    if (els.assetList) els.assetList.value = asset.src;
    setOutput(`Loaded demo asset ${asset.title || shortFilename(asset.src)} for playback.`);
});
// ===== Debug/Test UI Section Event Listeners =====
/// clear output
document.getElementById('clearMetaBtn')?.addEventListener('click', () => {
    const meta = document.getElementById('alignmentMeta');
    if (meta) meta.value = '';
    setOutput('Cleared JSON output.');
});

// refresh demo assets
const testDemoAssetsBtn = document.getElementById('testDemoAssetsBtn');
if (testDemoAssetsBtn) {
    testDemoAssetsBtn.addEventListener('click', async () => {
        try {
            testOutput("");
            await loadDemoAssets();
            const result = demoAssetsCache;
            setOutput('Demo assets loaded (see debug below).');
            testOutput(result);
        } catch (e) {
            setOutput('Error loading demo content: ' + (e.message || String(e)));
            testOutput({ error: e.message || String(e) });
        }
    });
}

// Create Task (POST /tasks)

const testCreateBtn = document.getElementById('testCreateBtn');
if (testCreateBtn) {
    testCreateBtn.addEventListener('click', async () => {
        if (!API_KEY) return alert('Authorize first.');
        const url = els.audioUrl.value.trim();
        if (!url) return alert('Enter an audio URL.');
        setOutput('Testing: Creating task...');
        try {
            testOutput("");
            const result = await createTask(url);
            setOutput('Task created (see debug below).');
            testOutput(result);
        } catch (e) {
            setOutput('Error creating task: ' + (e.message || String(e)));
            testOutput({ error: e.message || String(e) });
        }
    });
}

// List Tasks (GET /tasks)
const testListBtn = document.getElementById('testListBtn');
if (testListBtn) {
    testListBtn.addEventListener('click', async () => {
        if (!API_KEY) return alert('Authorize first.');
        setOutput('Testing: Listing tasks...');
        try {
            testOutput("");
            const result = await listTasks(10);
            setOutput('Tasks listed (see debug below).');
            testOutput(result);
        } catch (e) {
            setOutput('Error listing tasks: ' + (e.message || String(e)));
            testOutput({ error: e.message || String(e) });
        }
    });
}



// Get Task by ID (GET /tasks/:id)
const testGetByIdBtn = document.getElementById('testGetByIdBtn');
if (testGetByIdBtn) {
    testGetByIdBtn.addEventListener('click', async () => {
        if (!API_KEY) return alert('Authorize first.');
        const id = els.taskIdInput.value.trim();
        if (!id) return alert('Enter a Task ID.');
        setOutput('Testing: Getting task by ID...');
        try {
            testOutput("");
            const result = await getTask(id);
            setOutput('Task fetched (see debug below).');
            testOutput(result);
        } catch (e) {
            setOutput('Error fetching task: ' + (e.message || String(e)));
            testOutput({ error: e.message || String(e) });
        }
    });
}
