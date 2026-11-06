(function () {
  'use strict';

  var DB_NAME = 'geotab-maintenance-documents';
  var STORE_NAME = 'pending';
  var MAX_FILE_BYTES = 10 * 1024 * 1024;
  var appState = { api: null, state: null, device: null, driver: null, online: true };
  var dbPromise;
  var selectedFile = null;

  function byId(id) { return document.getElementById(id); }
  function openDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador no permite guardar la cola local.'));
    if (!dbPromise) dbPromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () { request.result.createObjectStore(STORE_NAME, { keyPath: 'localId' }); };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
    return dbPromise;
  }
  function storeDocument(documentRecord) {
    return openDb().then(function (db) { return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(documentRecord);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    }); });
  }
  function listDocuments() {
    return openDb().then(function (db) { return new Promise(function (resolve, reject) {
      var request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = function () { resolve(request.result || []); };
      request.onerror = function () { reject(request.error); };
    }); });
  }
  function showNotice(message, isError) {
    var notice = byId('notice'); notice.textContent = message; notice.className = isError ? 'notice error' : 'notice'; notice.hidden = false;
  }
  function displayName(doc) {
    return { repair: 'Albarán de reparación', receipt: 'Ticket / factura', maintenance: 'Mantenimiento preventivo', other: 'Otro documento' }[doc.type] || 'Documento';
  }
  function renderQueue() {
    listDocuments().then(function (docs) {
      byId('queue-count').textContent = String(docs.length);
      var list = byId('queue-list'); list.textContent = '';
      if (!docs.length) { var empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'Todavía no hay documentos guardados.'; list.appendChild(empty); return; }
      docs.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }).forEach(function (doc) {
        var row = document.createElement('div'); row.className = 'queue-item';
        var image = document.createElement('img'); image.className = 'queue-thumb'; image.alt = ''; image.src = URL.createObjectURL(doc.file);
        var meta = document.createElement('div'); meta.className = 'queue-meta';
        var title = document.createElement('strong'); title.textContent = displayName(doc);
        var details = document.createElement('small'); details.textContent = (doc.provider || 'Sin proveedor') + ' · ' + doc.date + (doc.vehicleName ? ' · ' + doc.vehicleName : '');
        meta.append(title, details);
        var status = document.createElement('span'); status.className = 'status-pill'; status.textContent = 'Pendiente';
        row.append(image, meta, status); list.appendChild(row);
      });
    }).catch(function () { showNotice('No se pudo abrir el almacenamiento local de documentos.', true); });
  }
  function fileToPreview(file) {
    selectedFile = file;
    byId('file-prompt').textContent = file ? file.name : 'Hacer foto o elegir archivo';
    byId('preview-wrap').hidden = !file;
    if (file) byId('preview').src = URL.createObjectURL(file);
  }
  function setOnline(online) {
    appState.online = online;
    byId('connection').textContent = online ? 'Con conexión' : 'Sin conexión';
    byId('connection').classList.toggle('offline', !online);
  }
  function init(api, state) {
    appState.api = api;
    appState.state = state || {};
    appState.device = state && (state.device || (state.deviceInfo && state.deviceInfo.device) || state.activeDevice) || null;
    appState.driver = state && (state.driver || (state.deviceInfo && state.deviceInfo.driver) || state.activeUser) || null;
    appState.online = !(state && state.online === false);
    if (!byId('vehicle-name')) return;
    byId('vehicle-name').textContent = appState.device ? (appState.device.name || appState.device.id) : 'Vehículo no detectado';
    byId('driver-name').textContent = appState.driver ? (appState.driver.name || appState.driver.id || 'Conductor activo') : 'Conductor de Drive';
    setOnline(appState.online);
    renderQueue();
  }
  function registerAddin() {
    if (!window.geotab) window.geotab = {};
    if (!geotab.addin) geotab.addin = {};
    geotab.addin.DriveAppLink = function () {
      return {
        initialize: function (api, state, callback) { init(api, state); callback(); },
        focus: function (api, state) { init(api, state); },
        blur: function () {}
      };
    };
  }
  // Geotab Drive may evaluate the Add-In script in its host page before the
  // Add-In view has mounted. Register the lifecycle entry point first; only
  // attach UI handlers when this document actually contains the Add-In markup.
  registerAddin();

  function bindUi() {
    var form = byId('document-form');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    byId('doc-date').value = new Date().toISOString().slice(0, 10);
    byId('doc-file').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { showNotice('Selecciona una imagen JPG, PNG o WebP.', true); event.target.value = ''; return; }
    if (file.size > MAX_FILE_BYTES) { showNotice('La imagen supera el máximo de 10 MB.', true); event.target.value = ''; return; }
    fileToPreview(file);
    });
    byId('remove-file').addEventListener('click', function () { byId('doc-file').value = ''; fileToPreview(null); });
    form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!selectedFile) { showNotice('Haz una foto o selecciona la imagen del documento.', true); return; }
    var target = document.querySelector('input[name="association"]:checked').value;
    var entity = target === 'vehicle' ? appState.device : appState.driver;
    if (!entity || !entity.id) { showNotice(target === 'vehicle' ? 'Drive no ha proporcionado un vehículo activo.' : 'Drive no ha proporcionado un conductor activo.', true); return; }
    var record = {
      localId: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
      type: byId('doc-type').value, date: byId('doc-date').value,
      cost: byId('doc-cost').value || '', provider: byId('doc-provider').value.trim(), notes: byId('doc-notes').value.trim(),
      association: target, entityId: entity.id, vehicleId: appState.device && appState.device.id || '',
      driverId: appState.driver && appState.driver.id || '', vehicleName: appState.device && appState.device.name || '',
      driverName: appState.driver && appState.driver.name || '', file: selectedFile, createdAt: new Date().toISOString(), status: 'pending'
    };
    byId('save-button').disabled = true;
    storeDocument(record).then(function () {
      byId('document-form').reset(); byId('doc-date').value = new Date().toISOString().slice(0, 10);
      fileToPreview(null); byId('notice').hidden = true; renderQueue();
      showNotice(appState.online ? 'Documento guardado en la cola local. Para sincronizarlo con Geotab, configura la SolutionId y el permiso ManageMedia de esta solución.' : 'Documento guardado en el dispositivo y pendiente de sincronizar cuando vuelva la conexión.');
    }).catch(function (error) { showNotice(error.message || 'No se pudo guardar el documento.', true); }).finally(function () { byId('save-button').disabled = false; });
    });
    window.addEventListener('online', function () { if (byId('connection')) setOnline(true); });
    window.addEventListener('offline', function () { if (byId('connection')) setOnline(false); });
    init(appState.api, appState.state);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi);
  else bindUi();
}());
