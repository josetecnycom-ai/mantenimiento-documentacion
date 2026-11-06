(function () {
  'use strict';

  // Keep this ID stable across every deployment of this add-in.
  var SOLUTION_ID = (function () {
    var base64 = btoa('d94a6c23-1e57-4ff0-8a9e-2c7c8116ad42');
    return 'a' + base64.replace(/\//g, '_').replace(/\+/g, '-').substring(1, 23);
  }());
  var DB_NAME = 'geotab-maintenance-documents';
  var STORE_NAME = 'pending';
  var MAX_FILE_BYTES = 10 * 1024 * 1024;
  var state = { api: null, driveState: {}, device: null, driver: null, online: navigator.onLine, syncing: false };
  var dbPromise;
  var selectedFile = null;
  var previewObjectUrl = null;

  function byId(id) { return document.getElementById(id); }
  function markRuntimeVersion() {
    var version = byId('build-version');
    if (version) version.textContent = 'v0.2.7 · JS activo';
  }
  function localDateValue(date) {
    date = date || new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }
  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('No se pudo leer el archivo seleccionado.')); };
      reader.readAsDataURL(file);
    });
  }
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
  function putDocument(record) {
    return openDb().then(function (db) { return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    }); });
  }
  function getDocuments() {
    return openDb().then(function (db) { return new Promise(function (resolve, reject) {
      var request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = function () { resolve(request.result || []); };
      request.onerror = function () { reject(request.error); };
    }); });
  }
  function getDocument(id) {
    return openDb().then(function (db) { return new Promise(function (resolve, reject) {
      var request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    }); });
  }
  function hasAssociationId(doc) { return doc.association === 'vehicle' ? !!doc.vehicleId : !!doc.driverId; }
  function linkWaitingDocuments() {
    if (!state.device && !state.driver) return Promise.resolve();
    return getDocuments().then(function (docs) {
      return Promise.all(docs.map(function (doc) {
        var changed = false;
        if (doc.association === 'vehicle' && !doc.vehicleId && state.device && state.device.id) {
          doc.vehicleId = state.device.id; doc.vehicleName = state.device.name || ''; changed = true;
        }
        if (doc.association === 'driver' && !doc.driverId && state.driver && state.driver.id) {
          doc.driverId = state.driver.id; doc.driverName = state.driver.name || ''; changed = true;
        }
        return changed ? putDocument(doc) : Promise.resolve();
      }));
    });
  }
  function showNotice(message, isError) {
    var notice = byId('notice');
    if (!notice) return;
    notice.textContent = message;
    notice.className = isError ? 'notice error' : 'notice';
    notice.hidden = false;
  }
  function displayName(doc) {
    return { repair: 'Albarán de reparación', receipt: 'Ticket / factura', maintenance: 'Mantenimiento preventivo', other: 'Otro documento' }[doc.type] || 'Documento';
  }
  function statusText(doc) {
    return { pending: 'Pendiente', syncing: 'Subiendo…', uploaded: 'En Geotab', error: 'Error · reintentar' }[doc.status] || 'Pendiente';
  }
  function renderQueue() {
    if (!byId('queue-list')) return;
    getDocuments().then(function (docs) {
      var list = byId('queue-list');
      byId('queue-count').textContent = String(docs.length);
      list.textContent = '';
      if (!docs.length) {
        var empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'Todavía no hay documentos guardados.'; list.appendChild(empty); return;
      }
      docs.sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }).forEach(function (doc) {
        var row = document.createElement('div'); row.className = 'queue-item';
        var thumb;
        if (doc.file && /^image\//.test(doc.file.type)) {
          thumb = document.createElement('img'); thumb.className = 'queue-thumb'; thumb.alt = '';
          readFileAsDataUrl(doc.file).then(function (dataUrl) { thumb.src = dataUrl; }).catch(function () { thumb.alt = 'Imagen'; });
        } else {
          thumb = document.createElement('span'); thumb.className = 'queue-thumb'; thumb.textContent = 'PDF'; thumb.setAttribute('aria-label', 'PDF');
        }
        var meta = document.createElement('div'); meta.className = 'queue-meta';
        var title = document.createElement('strong'); title.textContent = displayName(doc);
        var details = document.createElement('small');
        details.textContent = doc.status === 'error' && doc.lastError
          ? doc.lastError
          : (doc.provider || 'Sin proveedor') + ' · ' + doc.date + (doc.vehicleName ? ' · ' + doc.vehicleName : '');
        meta.append(title, details);
        var status = document.createElement('button'); status.type = 'button'; status.className = 'status-pill ' + (doc.status === 'uploaded' ? 'ready' : doc.status === 'error' ? 'error' : ''); status.textContent = statusText(doc);
        status.addEventListener('click', function () { if (doc.status !== 'uploaded') syncQueue(true); });
        row.append(thumb, meta, status); list.appendChild(row);
      });
    }).catch(function () { showNotice('No se pudo abrir la cola local de documentos.', true); });
  }
  function setOnline(online) {
    state.online = !!online;
    var badge = byId('connection');
    if (badge) {
      badge.textContent = state.online ? (state.api ? 'Conectado a Drive' : 'Con conexión') : 'Sin conexión';
      badge.classList.toggle('offline', !state.online);
    }
    if (state.online && state.api) syncQueue(false);
  }
  function apiCall(api, method, params) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function ok(value) { if (!settled) { settled = true; resolve(value); } }
      function fail(error, detail) {
        if (settled) return;
        settled = true;
        var source = detail instanceof Error ? detail : error;
        reject(source instanceof Error ? source : new Error((source && source.message) || String(source)));
      }
      try {
        var result = api.call(method, params, ok, fail);
        if (result && typeof result.then === 'function') result.then(ok, fail);
      } catch (error) { fail(error); }
    });
  }
  function normalizeEntity(value) {
    if (Array.isArray(value)) return value[0] || null;
    if (value && value.result) return normalizeEntity(value.result);
    return value || null;
  }
  function fetchEntity(api, typeName, id) {
    if (!id) return Promise.resolve(null);
    return apiCall(api, 'Get', { typeName: typeName, search: { id: id } }).then(normalizeEntity);
  }
  function resolveDriveContext(api, driveState) {
    var deviceState = driveState && (driveState.device || (driveState.deviceInfo && driveState.deviceInfo.device) || driveState.activeDevice);
    var driverState = driveState && (driveState.driver || (driveState.deviceInfo && driveState.deviceInfo.driver) || driveState.activeUser || driveState.user);
    var devicePromise;
    if (deviceState && typeof deviceState === 'object' && deviceState.id) devicePromise = Promise.resolve(deviceState);
    else if (typeof deviceState === 'string' && deviceState) devicePromise = fetchEntity(api, 'Device', deviceState);
    else if (api.mobile && api.mobile.vehicle && typeof api.mobile.vehicle.get === 'function') devicePromise = Promise.resolve(api.mobile.vehicle.get()).then(normalizeEntity).catch(function () { return null; });
    else devicePromise = Promise.resolve(null);
    var driverPromise;
    if (driverState && typeof driverState === 'object' && driverState.id) driverPromise = Promise.resolve(driverState);
    else if (typeof driverState === 'string' && driverState) driverPromise = fetchEntity(api, 'User', driverState);
    else if (api.mobile && api.mobile.user && typeof api.mobile.user.get === 'function') driverPromise = Promise.resolve(api.mobile.user.get()).then(normalizeEntity).catch(function () { return null; });
    else driverPromise = Promise.resolve(null);
    return Promise.all([devicePromise, driverPromise]).then(function (items) {
      state.device = items[0]; state.driver = items[1];
      if (byId('vehicle-name')) byId('vehicle-name').textContent = state.device ? (state.device.name || state.device.id) : 'Vehículo no recibido de Drive';
      if (byId('driver-name')) byId('driver-name').textContent = state.driver ? (state.driver.name || state.driver.id) : 'Conductor no recibido de Drive';
      if (byId('connection')) {
        var online = !(driveState && driveState.online === false) && navigator.onLine;
        byId('connection').textContent = online ? 'Conectado a Drive' : 'Sin conexión';
        byId('connection').classList.toggle('offline', !online);
      }
      return linkWaitingDocuments().then(function () {
        renderQueue();
        if (navigator.onLine) syncQueue(false);
      });
    });
  }
  function getSession(api) {
    if (!api || typeof api.getSession !== 'function') return Promise.reject(new Error('Drive no entregó la sesión de Geotab al add-in.'));
    return new Promise(function (resolve, reject) {
      var finished = false;
      function done(a, b) {
        if (finished) return;
        finished = true;
        if (a && a.credentials) resolve({ credentials: a.credentials, server: a.server || a.path || b });
        else if (a && (a.database || a.userName || a.sessionId)) resolve({ credentials: a, server: b });
        else reject(new Error('No se pudieron leer las credenciales activas de Drive.'));
      }
      try {
        if (api.getSession.length > 0) api.getSession(done);
        else {
          var result = api.getSession();
          if (result && typeof result.then === 'function') result.then(function (value) { done(value); }, reject);
          else done(result);
        }
      } catch (error) { reject(error); }
    });
  }
  function resolveUploadUrl(server) {
    var host = typeof server === 'string' ? server : (server && (server.url || server.name || server.host));
    if (!host || host === 'ThisServer') host = window.location.hostname;
    host = String(host).replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return 'https://' + host + '/apiv1';
  }
  function uploadBinary(api, mediaFileId, file) {
    return getSession(api).then(function (session) {
      var form = new FormData();
      form.append('method', 'UploadMediaFile');
      form.append('params', JSON.stringify({ credentials: session.credentials, mediaFile: { id: mediaFileId } }));
      form.append('file', file, file.name || 'documento');
      return fetch(resolveUploadUrl(session.server), { method: 'POST', body: form, credentials: 'include' }).then(function (response) {
        return response.text().then(function (text) {
          var result = null;
          try { result = text ? JSON.parse(text) : null; } catch (ignore) { result = null; }
          if (!response.ok) throw new Error((result && result.error && result.error.message) || text || ('Error HTTP ' + response.status));
          if (result && result.error) throw new Error(result.error.message || 'Geotab rechazó la carga del archivo.');
          if (!result || !Object.prototype.hasOwnProperty.call(result, 'result')) {
            throw new Error('Geotab no confirmó la carga del archivo. Respuesta recibida: ' + (text || 'vacía'));
          }
          return result;
        });
      });
    });
  }
  function makeMediaName(record) {
    var ext = record.file.type === 'application/pdf' ? '.pdf' : (record.file.type === 'image/png' ? '.png' : record.file.type === 'image/webp' ? '.webp' : '.jpeg');
    var slug = (record.provider || record.type || 'documento').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 35) || 'documento';
    return ('mantenimiento-' + record.localId.replace(/[^a-z0-9]/gi, '').slice(0, 12) + '-' + slug + ext).toLowerCase().slice(0, 127);
  }
  function uploadRecord(record) {
    if (!state.api || !navigator.onLine) return Promise.reject(new Error('Sin conexión con Geotab.'));
    if (!record.file) return Promise.reject(new Error('El registro no contiene archivo.'));
    var makeEntity = function () {
      if (!hasAssociationId(record)) throw new Error('Falta el vehículo o conductor para asociar el documento.');
      var entity = {
        name: makeMediaName(record), solutionId: SOLUTION_ID,
        fromDate: new Date(record.date + 'T00:00:00').toISOString(),
        toDate: new Date(record.date + 'T23:59:59').toISOString(),
        metaData: JSON.stringify({ documentType: record.type, date: record.date, cost: record.cost, provider: record.provider, notes: record.notes, association: record.association })
      };
      if (record.association === 'vehicle') entity.device = { id: record.vehicleId };
      else entity.driver = { id: record.driverId };
      return apiCall(state.api, 'Add', { typeName: 'MediaFile', entity: entity });
    };
    var createPromise = record.mediaFileId ? Promise.resolve(record.mediaFileId) : makeEntity();
    return createPromise.then(function (id) {
      if (!id) throw new Error('Geotab no devolvió el ID del registro MediaFile.');
      record.mediaFileId = id; record.status = 'syncing';
      return putDocument(record).then(function () { return uploadBinary(state.api, id, record.file); });
    }).then(function () {
      record.status = 'uploaded'; record.lastError = '';
      return putDocument(record);
    }).catch(function (error) {
      record.status = 'error'; record.lastError = error.message || String(error);
      return putDocument(record).then(function () { throw error; });
    });
  }
  function syncQueue(showResult) {
    if (state.syncing || !state.api || !navigator.onLine) return Promise.resolve();
    state.syncing = true;
    return getDocuments().then(function (docs) {
      var waitingForAssociation = docs.some(function (doc) { return doc.status !== 'uploaded' && !hasAssociationId(doc); });
      var pending = docs.filter(function (doc) { return doc.status !== 'uploaded' && hasAssociationId(doc); });
      if (!pending.length) {
        state.syncing = false;
        if (showResult && waitingForAssociation) showNotice('Documento guardado en este dispositivo. Drive aún no ha comunicado el vehículo o conductor para asociarlo; se intentará de nuevo al recibir ese dato.');
        return;
      }
      var chain = Promise.resolve();
      pending.forEach(function (doc) {
        chain = chain.then(function () {
          doc.status = 'syncing'; return putDocument(doc).then(renderQueue).then(function () { return uploadRecord(doc); });
        });
      });
      return chain.then(function () {
        if (showResult) showNotice(waitingForAssociation
          ? 'Documento(s) sincronizado(s). Hay otros en espera del vehículo o conductor de Drive.'
          : 'Documento(s) sincronizado(s) con Geotab.');
      }).catch(function (error) {
        if (showResult) showNotice('No se pudo sincronizar: ' + (error.message || error), true);
      }).finally(function () { state.syncing = false; renderQueue(); });
    }).catch(function (error) {
      state.syncing = false;
      if (showResult) showNotice(error.message || 'No se pudo leer la cola local.', true);
    });
  }
  function fileFromCamera(media) {
    var value = media && (media.data || media.base64 || media.image || media) || '';
    var mime = media && (media.mimeType || media.type || media.contentType) || 'image/png';
    if (typeof value !== 'string' || !value) throw new Error('Drive no devolvió una imagen de la cámara.');
    var dataUrl = value.indexOf('data:') === 0 ? value : 'data:' + mime + ';base64,' + value;
    var match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
    if (!match) throw new Error('El formato devuelto por la cámara de Drive no es válido.');
    var binary = atob(match[2]); var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    var extension = match[1] === 'image/jpeg' ? 'jpg' : match[1] === 'image/webp' ? 'webp' : 'png';
    return new File([bytes], 'foto-drive.' + extension, { type: match[1] });
  }
  function fileToPreview(file) {
    selectedFile = file;
    byId('file-prompt').textContent = file ? file.name : 'Hacer foto o elegir archivo';
    byId('preview-wrap').hidden = !file;
    var preview = byId('preview');
    preview.onload = null;
    preview.onerror = null;
    if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
    if (file) {
      if (file.type.indexOf('image/') === 0) {
        preview.hidden = true;
        readFileAsDataUrl(file).then(function (dataUrl) {
          if (selectedFile !== file) return;
          var source = 'data';
          preview.onload = function () {
            preview.hidden = false;
            byId('preview-wrap').removeAttribute('data-filetype');
          };
          preview.onerror = function () {
            if (source === 'data' && window.URL && URL.createObjectURL) {
              try {
                source = 'blob';
                previewObjectUrl = URL.createObjectURL(file);
                preview.src = previewObjectUrl;
                return;
              } catch (ignore) { source = 'blocked'; }
            }
            preview.removeAttribute('src');
            preview.hidden = true;
            byId('preview-wrap').setAttribute('data-filetype', 'Foto seleccionada');
            showNotice('La foto está seleccionada y se puede guardar, pero Drive no permite mostrar su vista previa en esta pantalla.', true);
          };
          preview.src = dataUrl;
        }).catch(function (error) {
          preview.removeAttribute('src');
          preview.hidden = true;
          byId('preview-wrap').setAttribute('data-filetype', 'Foto seleccionada');
          showNotice('No se pudo leer la foto seleccionada: ' + error.message, true);
        });
      } else {
        preview.removeAttribute('src'); preview.hidden = true;
        byId('preview-wrap').setAttribute('data-filetype', 'PDF');
      }
    } else { preview.removeAttribute('src'); preview.hidden = true; byId('preview-wrap').removeAttribute('data-filetype'); }
  }
  function bindUi() {
    var form = byId('document-form');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    byId('doc-date').value = localDateValue();
    setOnline(navigator.onLine);
    byId('doc-file').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0]; if (!file) return;
      var allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (allowed.indexOf(file.type) === -1) { showNotice('Selecciona JPG, PNG, WebP o PDF.', true); event.target.value = ''; return; }
      if (file.size > MAX_FILE_BYTES) { showNotice('El archivo supera el máximo de 10 MB.', true); event.target.value = ''; return; }
      fileToPreview(file);
      showNotice('Archivo seleccionado: ' + file.name + '. Pulsa “Guardar documento” para añadirlo.', false);
    });
    byId('btn-drive-camera').addEventListener('click', function () {
      if (!state.api || !state.api.mobile || !state.api.mobile.camera || typeof state.api.mobile.camera.takePicture !== 'function') {
        showNotice('La cámara nativa requiere Geotab Drive en el móvil. En este navegador, usa “Hacer foto o elegir archivo”.', true); return;
      }
      state.api.mobile.camera.takePicture().then(function (media) {
        var file = fileFromCamera(media);
        if (file.size > MAX_FILE_BYTES) throw new Error('La imagen devuelta supera el máximo de 10 MB.');
        fileToPreview(file); showNotice('Foto lista para adjuntar.');
      }).catch(function (error) { showNotice(error.message || 'No se pudo abrir la cámara de Drive.', true); });
    });
    byId('remove-file').addEventListener('click', function () { byId('doc-file').value = ''; fileToPreview(null); });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!selectedFile) { showNotice('Haz una foto o selecciona el documento.', true); return; }
      var target = document.querySelector('input[name="association"]:checked').value;
      var entity = target === 'vehicle' ? state.device : state.driver;
      var record = {
        localId: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
        type: byId('doc-type').value, date: byId('doc-date').value || localDateValue(), cost: byId('doc-cost').value || '',
        provider: byId('doc-provider').value.trim(), notes: byId('doc-notes').value.trim(), association: target,
        entityId: entity && entity.id || '', vehicleId: state.device && state.device.id || '', driverId: state.driver && state.driver.id || '',
        vehicleName: state.device && state.device.name || '', driverName: state.driver && state.driver.name || '',
        file: selectedFile, createdAt: new Date().toISOString(), status: 'pending'
      };
      byId('save-button').disabled = true;
      putDocument(record).then(function () {
        form.reset(); byId('doc-date').value = localDateValue(); fileToPreview(null); renderQueue();
        if (!navigator.onLine) showNotice('Guardado en este dispositivo. Se enviará al recuperar la conexión.');
        else if (!state.api) showNotice('Guardado en este dispositivo. Drive aún no ha entregado la sesión API para sincronizar.');
        else if (!entity || !entity.id) showNotice('Guardado en este dispositivo. Drive aún no ha comunicado el ' + (target === 'vehicle' ? 'vehículo' : 'conductor') + '; se asociará cuando esté disponible.');
        else { showNotice('Enviando documento a Geotab…'); return syncQueue(true); }
      }).catch(function (error) { showNotice(error.message || 'No se pudo guardar el documento.', true); })
        .finally(function () { byId('save-button').disabled = false; });
    });
    byId('btn-sync-pending').addEventListener('click', function () { syncQueue(true); });
    window.addEventListener('online', function () { setOnline(true); });
    window.addEventListener('offline', function () { setOnline(false); });
    renderQueue();
    if (state.api) resolveDriveContext(state.api, state.driveState).catch(function (error) {
      showNotice('No se pudo conectar con la sesión de Drive: ' + error.message, true);
    });
  }
  function registerAddin() {
    if (!window.geotab) window.geotab = {};
    if (!window.geotab.addin) window.geotab.addin = {};
    window.geotab.addin.DriveAppLink = function () {
      return {
        initialize: function (api, driveState, callback) {
          state.api = api; state.driveState = driveState || {};
          // Finish the Drive lifecycle handshake before optional context lookups.
          // A slow mobile/API lookup must not leave Drive waiting to install this add-in.
          if (typeof callback === 'function') callback();
          window.setTimeout(function () {
            Promise.resolve().then(function () { return resolveDriveContext(api, state.driveState); })
              .catch(function (error) { showNotice('No se pudo leer el contexto de Drive: ' + (error.message || error), true); });
          }, 0);
        },
        focus: function (api, driveState) {
          state.api = api; state.driveState = driveState || state.driveState;
          resolveDriveContext(api, state.driveState).catch(function (error) { showNotice('No se pudo leer el contexto de Drive: ' + error.message, true); });
        },
        blur: function () {}
      };
    };
  }
  registerAddin();
  markRuntimeVersion();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi);
  else bindUi();
}());
