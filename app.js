'use strict';

const DATA_TYPES = ['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32', 'float32', 'float64'];
const MIME_TYPES = [
  'image/png',
  'image/tiff',
  'image/tiff; application=geotiff',
  'image/tiff; application=geotiff; profile=cloud-optimized',
  'text/plain',
  'text/html',
  'application/json',
  'application/xml',
  'application/x-tar',
  'application/zip',
  'application/gzip',
  'image/jp2; profile=cloud-optimized',
  'image/jp2',
  'application/x-netcdf',
  'application/netcdf'
];

const STORAGE_KEY = 'metadata-ui-draft-v1';
const SHARE_VERSION = '1';
const SHARE_WARNING_LENGTH = 8000;
let isHydrating = false;
let saveTimer = null;
let toastTimer = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const dom = {
  preview: $('#json-preview'),
  status: $('#json-status'),
  validation: $('#validation-summary'),
  providers: $('#providers-list'),
  bands: $('#bands-list'),
  assets: $('#assets-list'),
  keywords: $('#keywords-list'),
  sources: $('#sources-list'),
  compositionSection: $('#composition-section'),
  draftStatus: $('#draft-status'),
  shareDialog: $('#share-dialog'),
  shareUrl: $('#share-url'),
  shareSize: $('#share-size'),
  shareWarning: $('#share-warning'),
  toast: $('#toast')
};

function showToast(message, timeout = 2200) {
  if (!dom.toast) return;
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  requestAnimationFrame(() => dom.toast.classList.add('visible'));
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove('visible');
    setTimeout(() => { dom.toast.hidden = true; }, 180);
  }, timeout);
}

function updateDraftStatus(message) {
  if (dom.draftStatus) dom.draftStatus.textContent = message;
}

function saveDraftNow(output) {
  if (isHydrating) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: SHARE_VERSION,
      saved_at: new Date().toISOString(),
      data: output
    }));
    updateDraftStatus('Rascunho salvo neste navegador');
  } catch (error) {
    console.warn('Não foi possível salvar o rascunho local.', error);
    updateDraftStatus('Rascunho local indisponível');
  }
}

function scheduleDraftSave(output) {
  if (isHydrating) return;
  clearTimeout(saveTimer);
  updateDraftStatus('Salvando rascunho…');
  saveTimer = setTimeout(() => saveDraftNow(output), 350);
}

function readDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
  } catch (error) {
    console.warn('Rascunho local inválido.', error);
    return null;
  }
}

function clearDraft() {
  clearTimeout(saveTimer);
  try { localStorage.removeItem(STORAGE_KEY); } catch (error) { console.warn(error); }
}

function clearShareHash() {
  if (!window.location.hash) return;
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encodeSharePayload(metadata) {
  const source = new TextEncoder().encode(JSON.stringify(metadata));

  if ('CompressionStream' in window) {
    const stream = new Blob([source]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return { codec: 'gzip', data: bytesToBase64Url(compressed) };
  }

  return { codec: 'plain', data: bytesToBase64Url(source) };
}

async function decodeSharePayload(codec, data) {
  const bytes = base64UrlToBytes(data);
  let decodedBytes = bytes;

  if (codec === 'gzip') {
    if (!('DecompressionStream' in window)) {
      throw new Error('Este navegador não oferece suporte à descompressão do link compartilhado.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    decodedBytes = new Uint8Array(await new Response(stream).arrayBuffer());
  } else if (codec !== 'plain') {
    throw new Error(`Codec de compartilhamento desconhecido: ${codec}`);
  }

  return JSON.parse(new TextDecoder().decode(decodedBytes));
}

function getSharedStateFromHash() {
  if (!window.location.hash || window.location.hash.length < 2) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const data = params.get('data');
  if (!data) return null;
  return {
    version: params.get('v') || '1',
    codec: params.get('c') || 'plain',
    data
  };
}

async function createShareLink() {
  const { output } = updatePreview({ persist: false });
  const payload = await encodeSharePayload(output);
  const base = window.location.href.split('#')[0].split('?')[0];
  const params = new URLSearchParams({
    v: SHARE_VERSION,
    c: payload.codec,
    data: payload.data
  });
  const url = `${base}#${params.toString()}`;

  dom.shareUrl.value = url;
  dom.shareSize.textContent = `${url.length.toLocaleString('pt-BR')} caracteres`;
  dom.shareWarning.hidden = url.length <= SHARE_WARNING_LENGTH;

  if (typeof dom.shareDialog.showModal === 'function') {
    dom.shareDialog.showModal();
  } else {
    await copyText(url);
    showToast('Link copiado.');
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const area = document.createElement('textarea');
    area.value = value;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

async function copyShareLink() {
  const value = dom.shareUrl.value;
  if (!value) return;
  await copyText(value);
  const button = $('#copy-share-button');
  const original = button.textContent;
  button.textContent = 'Copiado';
  showToast('Link copiado para a área de transferência.');
  setTimeout(() => { button.textContent = original; }, 1200);
}

function text(id) {
  return document.getElementById(id).value.trim();
}

function nullableText(id) {
  const value = text(id);
  return value === '' ? null : value;
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function intOrNull(id) {
  const value = document.getElementById(id).value;
  if (value === '') return null;
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => {
      if (value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === 'object' && !Array.isArray(value)) return Object.keys(value).length > 0;
      return true;
    })
  );
}

function fillSelect(select, values, includeEmpty = true) {
  select.innerHTML = includeEmpty ? '<option value="">—</option>' : '';
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function createFromTemplate(templateId) {
  return document.getElementById(templateId).content.firstElementChild.cloneNode(true);
}

function setupRepeaterCard(card, onChange = updatePreview) {
  $('.remove-item', card).addEventListener('click', () => {
    card.remove();
    renumberCards();
    updatePreview();
  });
  card.addEventListener('input', onChange);
  card.addEventListener('change', onChange);
  return card;
}

function renumberCards() {
  $$('.provider-card').forEach((card, index) => $('.card-header strong', card).textContent = `Provedor ${index + 1}`);
  $$('.band-card').forEach((card, index) => $('.card-header strong', card).textContent = `Banda ${index + 1}`);
  $$('.asset-card').forEach((card, index) => $('.card-header strong', card).textContent = `Asset ${index + 1}`);
}

function addProvider(data = {}) {
  const card = setupRepeaterCard(createFromTemplate('provider-template'));
  dom.providers.appendChild(card);

  $$('[data-key]', card).forEach(input => {
    const key = input.dataset.key;
    if (key === 'processing:software:name') {
      const sw = data['processing:software'];
      if (sw && typeof sw === 'object') input.value = Object.keys(sw)[0] || '';
    } else if (key === 'processing:software:version') {
      const sw = data['processing:software'];
      if (sw && typeof sw === 'object') input.value = Object.values(sw)[0] || '';
    } else if (data[key] !== undefined && data[key] !== null) {
      input.value = data[key];
    }
  });

  const roles = data.roles || [];
  $$('.roles input[type="checkbox"]', card).forEach(cb => cb.checked = roles.includes(cb.value));
  renumberCards();
  updatePreview();
}

function addBand(data = {}) {
  const card = setupRepeaterCard(createFromTemplate('band-template'));
  fillSelect($('.data-type-select', card), DATA_TYPES, true);
  fillSelect($('.mime-type-select', card), MIME_TYPES, true);
  dom.bands.appendChild(card);

  $$('[data-key]', card).forEach(input => {
    const key = input.dataset.key;
    let value = data[key];
    if (key === 'offset' && value === undefined) value = data.scale_add;
    if (value !== undefined && value !== null) input.value = value;
  });

  renumberCards();
  updatePreview();
}

function addAsset(key = '', data = {}) {
  const card = setupRepeaterCard(createFromTemplate('asset-template'));
  fillSelect($('.mime-type-select', card), MIME_TYPES, true);
  dom.assets.appendChild(card);

  $('[data-key="key"]', card).value = key;
  $$('[data-key]', card).forEach(input => {
    const dataKey = input.dataset.key;
    if (dataKey === 'key') return;
    if (dataKey.startsWith('bands:')) {
      const channel = dataKey.split(':')[1];
      if (data.bands?.[channel]) input.value = data.bands[channel];
    } else if (data[dataKey] !== undefined && data[dataKey] !== null) {
      input.value = data[dataKey];
    }
  });

  const roles = data.roles || [];
  $$('.roles input[type="checkbox"]', card).forEach(cb => cb.checked = roles.includes(cb.value));
  toggleThumbnailFields(card);
  card.addEventListener('change', () => toggleThumbnailFields(card));
  renumberCards();
  updatePreview();
}

function toggleThumbnailFields(card) {
  const isThumbnail = $$('input[type="checkbox"]', card).some(cb => cb.value === 'thumbnail' && cb.checked) ||
    $('[data-key="key"]', card).value.trim().toLowerCase() === 'thumbnail';
  $('.thumbnail-bands', card).hidden = !isThumbnail;
}

function addKeyword(value) {
  value = String(value || '').trim();
  if (!value) return;
  const current = getChipValues(dom.keywords);
  if (current.includes(value)) return;
  dom.keywords.appendChild(createChip(value));
  updatePreview();
}

function createChip(value) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.dataset.value = String(value);
  const label = document.createElement('span');
  label.textContent = String(value);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = 'Remover';
  remove.addEventListener('click', () => {
    chip.remove();
    updatePreview();
  });
  chip.append(label, remove);
  return chip;
}

function getChipValues(container, type = 'string') {
  return $$('.chip', container).map(chip => type === 'number' ? Number(chip.dataset.value) : chip.dataset.value);
}

function addSummaryValue(editor, value) {
  if (value === '' || value === null || value === undefined) return;
  const type = editor.dataset.type || 'string';
  const normalized = type === 'number' ? Number(value) : String(value).trim();
  if (type === 'number' && !Number.isFinite(normalized)) return;
  const container = $('.summary-values', editor);
  if (getChipValues(container, type).includes(normalized)) return;
  container.appendChild(createChip(normalized));
  updatePreview();
}

function addSource(value = '') {
  const row = document.createElement('div');
  row.className = 'simple-row';
  row.innerHTML = '<input type="url" placeholder="https://..."><button class="icon-button" type="button" title="Remover">−</button>';
  $('input', row).value = value || '';
  $('input', row).addEventListener('input', updatePreview);
  $('button', row).addEventListener('click', () => { row.remove(); updatePreview(); });
  dom.sources.appendChild(row);
  updatePreview();
}

function serializeProviders() {
  return $$('.provider-card').map(card => {
    const provider = {};
    $$('[data-key]', card).forEach(input => {
      const key = input.dataset.key;
      if (key.startsWith('processing:software:')) return;
      const value = input.value.trim();
      if (value !== '') provider[key] = value;
    });
    provider.roles = $$('.roles input:checked', card).map(cb => cb.value);

    const swName = $('[data-key="processing:software:name"]', card).value.trim();
    const swVersion = $('[data-key="processing:software:version"]', card).value.trim();
    if (swName) provider['processing:software'] = { [swName]: swVersion || '' };
    return compactObject(provider);
  }).filter(provider => provider.name || provider.url || provider.roles?.length);
}

function serializeBands() {
  const numericKeys = new Set(['min_value', 'max_value', 'nodata', 'scale', 'offset', 'resolution_x', 'resolution_y', 'center_wavelength', 'full_width_half_max']);
  return $$('.band-card').map(card => {
    const band = { common_name: $('[data-key="common_name"]', card).value.trim() };
    $$('[data-key]', card).forEach(input => {
      const key = input.dataset.key;
      const raw = input.value.trim();
      if (raw === '') return;
      band[key] = numericKeys.has(key) ? Number(raw) : raw;
    });
    return band;
  }).filter(band => band.name || band.description);
}

function serializeAssets() {
  const assets = {};
  $$('.asset-card').forEach(card => {
    const key = $('[data-key="key"]', card).value.trim();
    if (!key) return;
    const asset = {};
    ['title', 'type', 'description'].forEach(field => {
      const value = $(`[data-key="${field}"]`, card).value.trim();
      if (value) asset[field] = value;
    });
    const roles = $$('.roles input:checked', card).map(cb => cb.value);
    if (roles.length) asset.roles = roles;

    const bands = {};
    ['red', 'green', 'blue'].forEach(channel => {
      const input = $(`[data-key="bands:${channel}"]`, card);
      if (input && input.value.trim()) bands[channel] = input.value.trim();
    });
    if (Object.keys(bands).length) asset.bands = bands;
    assets[key] = asset;
  });
  return assets;
}

function serializeSummaries() {
  const summaries = {};
  $$('.tag-editor[data-summary]', document).forEach(editor => {
    const key = editor.dataset.summary;
    if (key.startsWith('__')) return;
    const type = editor.dataset.type || 'string';
    const values = getChipValues($('.summary-values', editor), type);
    if (values.length) summaries[key] = values;
  });
  return summaries;
}

function serializeTemporalComposition() {
  const step = numberOrNull($('#temporal-step').value);
  const unit = text('temporal-unit');
  const schema = text('temporal-schema');
  const cycleStep = numberOrNull($('#cycle-step').value);
  const cycleUnit = text('cycle-unit');
  if (step === null && !unit && !schema && cycleStep === null && !cycleUnit) return null;

  const temporal = {};
  if (step !== null) temporal.step = step;
  if (unit) temporal.unit = unit;
  if (schema) temporal.schema = schema;
  if (cycleStep !== null || cycleUnit) {
    temporal.cycle = {};
    if (cycleStep !== null) temporal.cycle.step = cycleStep;
    if (cycleUnit) temporal.cycle.unit = cycleUnit;
  }
  return temporal;
}

function serializeExtent() {
  const bbox = ['bbox-west', 'bbox-south', 'bbox-east', 'bbox-north'].map(id => numberOrNull(document.getElementById(id).value));
  if (bbox.every(value => value === null)) return undefined;
  if (bbox.some(value => value === null)) return { __invalid: true, bbox };
  return { spatial: { bbox: [bbox] } };
}

function serializeProperties(errors) {
  let properties = {};
  const sources = $$('.simple-row input', dom.sources).map(input => input.value.trim()).filter(Boolean);
  if (sources.length) properties.sources = sources;

  const appsEditor = $('.tag-editor[data-summary="__applications"]');
  const applications = getChipValues($('.summary-values', appsEditor));
  if (applications.length) properties['bdc:applications'] = applications;

  const raw = text('extra-properties');
  if (raw) {
    try {
      const extra = JSON.parse(raw);
      if (!extra || Array.isArray(extra) || typeof extra !== 'object') {
        errors.push('Propriedades adicionais devem ser um objeto JSON.');
      } else {
        properties = { ...extra, ...properties };
      }
    } catch (error) {
      errors.push(`JSON inválido em propriedades adicionais: ${error.message}`);
    }
  }
  return properties;
}

function buildMetadata(errors = []) {
  const collectionType = text('collection-type');
  const metadata = {};
  const providers = serializeProviders();
  metadata.providers = providers;

  const licenseType = text('license-type');
  const licenseUri = text('license-uri');
  if (licenseType || licenseUri) metadata.license = compactObject({ type: licenseType || undefined, uri: licenseUri || undefined });

  const output = {
    id: null,
    name: text('name'),
    title: text('title'),
    description: text('description'),
    temporal_composition_schema: ['cube', 'mosaic'].includes(collectionType) ? serializeTemporalComposition() : null,
    composition_function: ['cube', 'mosaic'].includes(collectionType) ? nullableText('composition-function') : null,
    grid_ref_sys: ['cube', 'mosaic'].includes(collectionType) ? nullableText('grid-ref-sys') : null,
    collection_type: collectionType,
    metadata,
    keywords: getChipValues(dom.keywords),
    is_public: $('#is-public').checked,
    is_available: $('#is-available').checked,
    category: text('category'),
    version: intOrNull('version'),
    version_predecessor: intOrNull('version-predecessor'),
    version_successor: intOrNull('version-successor')
  };

  const quicklookEditor = $('.tag-editor[data-summary="__quicklook"]');
  const quicklook = getChipValues($('.summary-values', quicklookEditor));
  if (quicklook.length) output.quicklook = quicklook;

  const extent = serializeExtent();
  if (extent?.__invalid) errors.push('Bounding box: preencha os quatro valores ou deixe todos vazios.');
  else if (extent) output.extent = extent;

  output.bands = serializeBands();
  const summaries = serializeSummaries();
  if (Object.keys(summaries).length) output.summaries = summaries;
  output.item_assets = serializeAssets();

  const properties = serializeProperties(errors);
  if (Object.keys(properties).length) output.properties = properties;

  return output;
}

function validate(output, extraErrors = []) {
  const errors = [...extraErrors];
  const required = [
    ['name', output.name, '#name'],
    ['title', output.title, '#title'],
    ['description', output.description, '#description'],
    ['version', output.version, '#version']
  ];

  $$('.invalid').forEach(el => el.classList.remove('invalid'));
  required.forEach(([label, value, selector]) => {
    if (!String(value ?? '').trim()) {
      errors.push(`Campo obrigatório: ${label}.`);
      $(selector)?.classList.add('invalid');
    }
  });

  if (output.name && /\s/.test(output.name)) {
    errors.push('name não pode conter espaços.');
    $('#name').classList.add('invalid');
  }
  if (!output.metadata.providers.length) errors.push('Adicione ao menos um provider.');
  output.metadata.providers.forEach((provider, i) => {
    if (!provider.name) errors.push(`Provider ${i + 1}: nome obrigatório.`);
    if (!provider.roles?.length) errors.push(`Provider ${i + 1}: selecione pelo menos uma role.`);
  });
  if (!output.bands.length) errors.push('Adicione ao menos uma banda.');
  output.bands.forEach((band, i) => {
    if (!band.name) errors.push(`Banda ${i + 1}: name obrigatório.`);
    if (!Object.prototype.hasOwnProperty.call(band, 'common_name')) errors.push(`Banda ${i + 1}: common_name ausente.`);
    if (band.min_value === undefined) errors.push(`Banda ${i + 1}: min_value obrigatório.`);
    if (band.max_value === undefined) errors.push(`Banda ${i + 1}: max_value obrigatório.`);
    if (band.scale === undefined) errors.push(`Banda ${i + 1}: scale obrigatório.`);
    if (!band.data_type) errors.push(`Banda ${i + 1}: data_type obrigatório.`);
    if (!band.mime_type) errors.push(`Banda ${i + 1}: mime_type obrigatório.`);
  });
  if (!Object.keys(output.item_assets).length) errors.push('Adicione ao menos um item_asset.');

  return errors;
}

function updatePreview({ persist = true } = {}) {
  const errors = [];
  const output = buildMetadata(errors);
  const validationErrors = validate(output, errors);
  dom.preview.textContent = JSON.stringify(output, null, 4);

  const valid = validationErrors.length === 0;
  dom.status.textContent = valid ? 'válido' : `${validationErrors.length} pendência(s)`;
  dom.status.className = `status ${valid ? 'ok' : 'error'}`;

  if (valid) {
    dom.validation.hidden = true;
    dom.validation.innerHTML = '';
  } else {
    dom.validation.hidden = false;
    dom.validation.innerHTML = `<strong>Revise antes de exportar:</strong><ul>${validationErrors.map(error => `<li>${escapeHtml(error)}</li>`).join('')}</ul>`;
  }

  dom.compositionSection.hidden = !['cube', 'mosaic'].includes(output.collection_type);
  if (persist) scheduleDraftSave(output);
  return { output, validationErrors };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function clearChips(container) {
  container.innerHTML = '';
}

function setSummary(key, values = []) {
  const editor = $(`.tag-editor[data-summary="${CSS.escape(key)}"]`);
  if (!editor) return;
  const container = $('.summary-values', editor);
  clearChips(container);
  values.forEach(value => container.appendChild(createChip(value)));
}

function setValue(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.value = value ?? '';
}

function loadJson(data, { persist = true, statusText = null } = {}) {
  const previousHydrationState = isHydrating;
  isHydrating = true;
  try {
    resetForm(false);
    setValue('name', data.name);
    setValue('title', data.title);
    setValue('description', data.description);
    setValue('version', data.version ?? 1);
    setValue('collection-type', data.collection_type || 'collection');
    setValue('category', data.category || 'eo');
    setValue('version-predecessor', data.version_predecessor);
    setValue('version-successor', data.version_successor);
    $('#is-public').checked = data.is_public ?? true;
    $('#is-available').checked = data.is_available ?? false;

    setValue('grid-ref-sys', data.grid_ref_sys);
    setValue('composition-function', data.composition_function);
    const temporal = data.temporal_composition_schema || {};
    setValue('temporal-step', temporal.step);
    setValue('temporal-unit', temporal.unit);
    setValue('temporal-schema', temporal.schema);
    setValue('cycle-step', temporal.cycle?.step);
    setValue('cycle-unit', temporal.cycle?.unit);

    const bbox = data.extent?.spatial?.bbox?.[0];
    if (Array.isArray(bbox) && bbox.length >= 4) {
      ['bbox-west', 'bbox-south', 'bbox-east', 'bbox-north'].forEach((id, index) => setValue(id, bbox[index]));
    }

    (data.metadata?.providers || []).forEach(addProvider);
    setValue('license-type', data.metadata?.license?.type);
    setValue('license-uri', data.metadata?.license?.uri);
    (data.keywords || []).forEach(addKeyword);
    (data.bands || []).forEach(addBand);

    Object.entries(data.summaries || {}).forEach(([key, values]) => setSummary(key, Array.isArray(values) ? values : [values]));
    Object.entries(data.item_assets || {}).forEach(([key, asset]) => addAsset(key, asset));
    setSummary('__quicklook', data.quicklook || []);

    (data.properties?.sources || []).forEach(addSource);
    setSummary('__applications', data.properties?.['bdc:applications'] || []);
    const extraProperties = { ...(data.properties || {}) };
    delete extraProperties.sources;
    delete extraProperties['bdc:applications'];
    setValue('extra-properties', Object.keys(extraProperties).length ? JSON.stringify(extraProperties, null, 2) : '');

    if (!dom.providers.children.length) addProvider();
    if (!dom.bands.children.length) addBand();
    if (!dom.assets.children.length) addAsset();
  } finally {
    isHydrating = previousHydrationState;
  }

  const result = updatePreview({ persist });
  if (statusText) updateDraftStatus(statusText);
  return result;
}

function resetForm(withDefaults = true) {
  $$('input[type="text"], input[type="url"], input[type="number"], textarea').forEach(input => input.value = '');
  $$('input[type="checkbox"]').forEach(input => input.checked = false);
  $$('select').forEach(select => select.selectedIndex = 0);
  dom.providers.innerHTML = '';
  dom.bands.innerHTML = '';
  dom.assets.innerHTML = '';
  dom.keywords.innerHTML = '';
  dom.sources.innerHTML = '';
  $$('.summary-values').forEach(clearChips);

  if (withDefaults) {
    setValue('version', '1');
    setValue('collection-type', 'collection');
    setValue('category', 'eo');
    $('#is-public').checked = true;
    $('#is-available').checked = false;
    addProvider();
    addBand();
    addAsset();
  }
  updatePreview();
}

function filenameFor(output) {
  const base = (output.name || 'collection').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'collection'}.json`;
}

function downloadJson() {
  const { output, validationErrors } = updatePreview();
  if (validationErrors.length) {
    dom.validation.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const blob = new Blob([JSON.stringify(output, null, 4) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filenameFor(output);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyJson() {
  await copyText(dom.preview.textContent);
  const button = $('#copy-button');
  button.textContent = 'Copiado';
  showToast('JSON copiado para a área de transferência.');
  setTimeout(() => { button.textContent = 'Copiar'; }, 1200);
}

function newDocument() {
  const previousHydrationState = isHydrating;
  isHydrating = true;
  try {
    resetForm(true);
  } finally {
    isHydrating = previousHydrationState;
  }
  clearDraft();
  clearShareHash();
  updatePreview({ persist: false });
  updateDraftStatus('Novo formulário');
  showToast('Novo formulário criado.');
}

async function loadSharedState(shared) {
  if (shared.version !== SHARE_VERSION) {
    console.warn(`Versão de compartilhamento ${shared.version}; versão atual ${SHARE_VERSION}.`);
  }
  const data = await decodeSharePayload(shared.codec, shared.data);
  clearShareHash();
  loadJson(data, { persist: true, statusText: 'Carregado de link compartilhado · salvando rascunho local' });
  showToast('Formulário carregado do link compartilhado.');
}


function wireEvents() {
  document.addEventListener('input', event => {
    if (!event.target.closest('.inline-add')) updatePreview();
  });
  document.addEventListener('change', updatePreview);

  $('#add-provider').addEventListener('click', () => addProvider());
  $('#add-band').addEventListener('click', () => addBand());
  $('#add-asset').addEventListener('click', () => addAsset());
  $('#add-source').addEventListener('click', () => addSource());

  const keywordInput = $('#keyword-input');
  const submitKeyword = () => { addKeyword(keywordInput.value); keywordInput.value = ''; keywordInput.focus(); };
  $('#add-keyword').addEventListener('click', submitKeyword);
  keywordInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submitKeyword(); } });

  $$('.add-summary').forEach(button => {
    const editor = button.closest('.tag-editor');
    const input = $('input', editor);
    const submit = () => { addSummaryValue(editor, input.value); input.value = ''; input.focus(); };
    button.addEventListener('click', submit);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
  });

  $('#download-button').addEventListener('click', downloadJson);
  $('#copy-button').addEventListener('click', copyJson);
  $('#share-button').addEventListener('click', createShareLink);
  $('#copy-share-button').addEventListener('click', copyShareLink);
  $('#reset-button').addEventListener('click', newDocument);

  $('#json-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      clearShareHash();
      loadJson(data, { persist: true, statusText: 'JSON importado · rascunho salvo localmente' });
      showToast('JSON importado com sucesso.');
    } catch (error) {
      alert(`Não foi possível carregar o JSON: ${error.message}`);
    } finally {
      event.target.value = '';
    }
  });
}

async function boot() {
  wireEvents();

  const shared = getSharedStateFromHash();
  if (shared) {
    try {
      await loadSharedState(shared);
      return;
    } catch (error) {
      console.error(error);
      showToast(`Não foi possível abrir o link: ${error.message}`, 4200);
    }
  }

  const draft = readDraft();
  if (draft) {
    loadJson(draft, { persist: false, statusText: 'Rascunho restaurado deste navegador' });
    showToast('Rascunho local restaurado.');
    return;
  }

  const previousHydrationState = isHydrating;
  isHydrating = true;
  try {
    resetForm(true);
  } finally {
    isHydrating = previousHydrationState;
  }
  updatePreview({ persist: false });
  updateDraftStatus('Novo formulário');
}

boot();
