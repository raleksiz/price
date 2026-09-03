(function (global) {
  'use strict';

  var SCHEMA_VERSION = 4;
  var PAY_TYPES = ['none', 'full', 'part', 'full_prepay', 'part_prepay'];
  var OFFER_CATEGORIES = [
    'consult', 'contracts', 'realestate', 'corporate',
    'pretrial', 'litigation_single', 'full_repr', 'operations'
  ];

  function n(value) { return Number(value) || 0; }
  function text(value) { return String(value == null ? '' : value); }
  function round(value) { return Math.round((n(value) + Number.EPSILON) * 100) / 100; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function isoNow() { return new Date().toISOString(); }
  function timestamp(value) {
    var parsed = Date.parse(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function latestIso(a, b) {
    var ms = Math.max(timestamp(a), timestamp(b));
    return new Date(ms || 0).toISOString();
  }
  function monthKey(value) { return text(value).slice(0, 7); }
  function calendarISO(value) {
    var raw = text(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    var date = value ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) date = new Date();
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }
  function monthLastISO(month) {
    month = monthKey(month);
    var year = Number(month.slice(0, 4));
    var monthNum = Number(month.slice(5, 7));
    var last = new Date(year, monthNum, 0).getDate();
    return month + '-' + String(last).padStart(2, '0');
  }
  function monthEndStamp(month) {
    return monthLastISO(month) + 'T23:59:59.000';
  }
  function ensureSnapshotMaps(contract) {
    if (!contract) return contract;
    contract.prepaySnapshots = contract.prepaySnapshots && typeof contract.prepaySnapshots === 'object'
      ? contract.prepaySnapshots : {};
    contract.contractPriceSnapshots = contract.contractPriceSnapshots &&
      typeof contract.contractPriceSnapshots === 'object' ? contract.contractPriceSnapshots : {};
    contract.prepaySnapshotUpdatedAt = contract.prepaySnapshotUpdatedAt &&
      typeof contract.prepaySnapshotUpdatedAt === 'object' ? contract.prepaySnapshotUpdatedAt : {};
    contract.contractPriceSnapshotUpdatedAt = contract.contractPriceSnapshotUpdatedAt &&
      typeof contract.contractPriceSnapshotUpdatedAt === 'object' ? contract.contractPriceSnapshotUpdatedAt : {};
    return contract;
  }
  function syncContractMonthSnapshots(contract, options) {
    if (!contract) return contract;
    options = options || {};
    ensureSnapshotMaps(contract);
    var currentMonth = monthKey(calendarISO(options.today));
    var stamp = monthEndStamp(currentMonth);
    contract.prepaySnapshots[currentMonth] = Math.max(0, n(contract.prepay));
    contract.prepaySnapshotUpdatedAt[currentMonth] = stamp;
    contract.contractPriceSnapshots[currentMonth] = Math.max(0, n(contract.contractPrice));
    contract.contractPriceSnapshotUpdatedAt[currentMonth] = stamp;
    return contract;
  }
  function seedCurrentMonthSnapshot(contract, options) {
    if (!contract) return contract;
    options = options || {};
    ensureSnapshotMaps(contract);
    var currentMonth = monthKey(calendarISO(options.today));
    if (contract.prepaySnapshots[currentMonth] == null) {
      contract.prepaySnapshots[currentMonth] = Math.max(0, n(contract.prepay));
      contract.prepaySnapshotUpdatedAt[currentMonth] = monthEndStamp(currentMonth);
    }
    if (contract.contractPriceSnapshots[currentMonth] == null) {
      contract.contractPriceSnapshots[currentMonth] = Math.max(0, n(contract.contractPrice));
      contract.contractPriceSnapshotUpdatedAt[currentMonth] = monthEndStamp(currentMonth);
    }
    return contract;
  }
  function entityTimestamp(entity, fallback) {
    return timestamp(entity && (entity.updatedAt || entity.createdAt)) || timestamp(fallback);
  }
  function compareServices(a, b) {
    var byDate = text(a && a.date).slice(0, 10).localeCompare(text(b && b.date).slice(0, 10));
    if (byDate) return byDate;
    var byPrice = n(b && b.price) - n(a && a.price);
    if (byPrice) return byPrice;
    var byCreated = text(a && a.createdAt).localeCompare(text(b && b.createdAt));
    if (byCreated) return byCreated;
    return text(a && a.id).localeCompare(text(b && b.id));
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function safeHttpUrl(value) {
    var raw = text(value).trim();
    if (!/^https?:\/\//i.test(raw)) return '';
    try {
      var url = new URL(raw);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (error) {
      return '';
    }
  }

  function parseDateParts(value) {
    var raw = text(value).trim();
    var match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    var year;
    var month;
    var day;
    if (match) {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
    } else {
      match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return null;
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
    }
    var date = new Date(year, month - 1, day);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) return null;
    return {
      date: date,
      iso: String(year).padStart(4, '0') + '-' +
        String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
    };
  }

  function offerPayload(raw, options) {
    options = options || {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var discount = Number(raw.disc);
    if (!Number.isFinite(discount) || discount < 0.5 || discount > 50) return null;
    var parsed = parseDateParts(raw.exp);
    if (!parsed) return null;
    var expiryEnd = new Date(
      parsed.date.getFullYear(), parsed.date.getMonth(), parsed.date.getDate(),
      23, 59, 59, 999
    );
    var now = options.now instanceof Date ? options.now : new Date();
    if (!options.allowExpired && expiryEnd < now) return null;
    var name = text(raw.for).trim().slice(0, 160);
    var categories = Array.isArray(raw.cats) ? raw.cats.filter(function (key) {
      return OFFER_CATEGORIES.indexOf(key) !== -1;
    }) : [];
    categories = Array.from(new Set(categories));
    if (!categories.length) return null;
    return {
      disc: discount,
      exp: parsed.iso,
      for: name,
      cats: categories,
      expiryEnd: expiryEnd
    };
  }

  function decodeOfferToken(token, options) {
    try {
      var base64 = decodeURIComponent(text(token));
      return offerPayload(JSON.parse(decodeURIComponent(atob(base64))), options);
    } catch (error) {
      return null;
    }
  }

  function offerRecordTimestamp(record) {
    var direct = timestamp(record && (record.updatedAt || record.deletedAt));
    if (direct) return direct;
    var idTime = Number(record && record.id);
    return Number.isFinite(idTime) && idTime > 1000000000000 ? idTime : 0;
  }

  function normalizeOfferRecord(record) {
    var out = clone(record || {});
    if (Number.isFinite(Number(out.disc))) out.disc = Number(out.disc);
    if (!out.updatedAt) {
      var ms = offerRecordTimestamp(out);
      if (ms) out.updatedAt = new Date(ms).toISOString();
    }
    return out;
  }

  function mergeOffers(local, remote, options) {
    options = options || {};
    var records = new Map();
    (remote || []).concat(local || []).forEach(function (record) {
      if (!record || record.id == null) return;
      var normalized = normalizeOfferRecord(record);
      var key = text(normalized.id);
      var previous = records.get(key);
      if (!previous || offerRecordTimestamp(normalized) >= offerRecordTimestamp(previous)) {
        records.set(key, normalized);
      }
    });
    var result = Array.from(records.values()).sort(function (a, b) {
      return offerRecordTimestamp(b) - offerRecordTimestamp(a);
    });
    return options.includeDeleted ? result : result.filter(function (record) { return !record.deletedAt; });
  }

  function requestedPaid(service) {
    if (!service) return 0;
    var price = Math.max(0, n(service.price));
    if (service.pay === 'full' || service.pay === 'full_prepay') return price;
    if (service.pay === 'part' || service.pay === 'part_prepay') {
      return Math.max(0, Math.min(n(service.payAmount), price));
    }
    return 0;
  }

  function paidOf(service) {
    return requestedPaid(service);
  }

  function remainingOf(service) {
    return Math.max(0, round(n(service && service.price) - paidOf(service)));
  }

  function paidForList(services) {
    return (services || []).reduce(function (sum, service) {
      return round(sum + paidOf(service));
    }, 0);
  }

  function remainingForList(services) {
    return (services || []).reduce(function (sum, service) {
      return round(sum + remainingOf(service));
    }, 0);
  }

  function prepayOf(service) {
    if (!service || (service.pay !== 'full_prepay' && service.pay !== 'part_prepay')) return 0;
    if (service.prepayAmount != null) {
      return Math.max(0, Math.min(n(service.prepayAmount), requestedPaid(service)));
    }
    return requestedPaid(service);
  }

  function cashPaidOf(service) {
    if (!service) return 0;
    if (service.pay === 'full' || service.pay === 'part') return requestedPaid(service);
    if (service.pay === 'full_prepay' || service.pay === 'part_prepay') {
      if (service.cashAmount != null) return Math.max(0, n(service.cashAmount));
      return Math.max(0, requestedPaid(service) - prepayOf(service));
    }
    return 0;
  }

  function groupActualPrepay(services) {
    return (services || []).reduce(function (best, service) {
      if (!service || (service.pay !== 'full_prepay' && service.pay !== 'part_prepay')) return best;
      return Math.max(best, Math.max(0, n(service.actualPrepay)));
    }, 0);
  }

  function allocatePaymentGroup(services) {
    var ordered = (services || []).slice().sort(compareServices);
    var remaining = groupActualPrepay(ordered);
    ordered.forEach(function (service) {
      var requested = requestedPaid(service);
      if (service.pay === 'full' || service.pay === 'part') {
        service.prepayAmount = 0;
        service.cashAmount = requested;
        return;
      }
      if (service.pay === 'full_prepay' || service.pay === 'part_prepay') {
        var prepay = Math.min(requested, remaining);
        service.prepayAmount = round(prepay);
        service.cashAmount = round(requested - prepay);
        remaining = round(remaining - prepay);
        return;
      }
      service.prepayAmount = 0;
      service.cashAmount = 0;
    });
    return ordered;
  }

  function recalculateContractPayments(services, contract) {
    var list = (services || []).filter(function (service) {
      return service && (!contract || service.contractId === contract.id);
    });
    if (contract && contract.status === 'Абонемент') {
      var byMonth = {};
      list.forEach(function (service) {
        var key = monthKey(service.date);
        if (!key) return;
        (byMonth[key] || (byMonth[key] = [])).push(service);
      });
      Object.keys(byMonth).forEach(function (key) { allocatePaymentGroup(byMonth[key]); });
    } else {
      allocatePaymentGroup(list);
    }
    return list;
  }

  function actualPrepayForMonth(services, month) {
    return groupActualPrepay((services || []).filter(function (service) {
      return monthKey(service && service.date) === month;
    }));
  }

  function paidForAbonementMonth(services, month) {
    var list = (services || []).filter(function (service) {
      return monthKey(service && service.date) === month;
    });
    return round(actualPrepayForMonth(list, month) + list.reduce(function (sum, service) {
      return sum + cashPaidOf(service);
    }, 0));
  }

  function ensureSyncMeta(db) {
    db._sync = db._sync && typeof db._sync === 'object' ? db._sync : {};
    db._sync.deleted = db._sync.deleted && typeof db._sync.deleted === 'object' ? db._sync.deleted : {};
    ['clients', 'contracts', 'services', 'customFields', 'priceList'].forEach(function (key) {
      db._sync.deleted[key] = db._sync.deleted[key] && typeof db._sync.deleted[key] === 'object'
        ? db._sync.deleted[key] : {};
    });
    db._sync.sections = db._sync.sections && typeof db._sync.sections === 'object' ? db._sync.sections : {};
    return db._sync;
  }

  function tombstoneKey(clientId, entityId) {
    return text(clientId) + '/' + text(entityId);
  }

  function markDeleted(db, type, clientId, entityId, when) {
    var sync = ensureSyncMeta(db);
    var key = (type === 'clients' || type === 'customFields' || type === 'priceList')
      ? text(entityId) : tombstoneKey(clientId, entityId);
    sync.deleted[type][key] = when || isoNow();
  }

  function migrateDB(input) {
    var db = input && typeof input === 'object' ? input : {};
    var fallback = db.updated || isoNow();
    db.version = Math.max(SCHEMA_VERSION, n(db.version));
    db.clients = Array.isArray(db.clients) ? db.clients : [];
    db.customFields = Array.isArray(db.customFields) ? db.customFields : [];
    db.priceList = Array.isArray(db.priceList) ? db.priceList : [];
    db.surcharges = db.surcharges && typeof db.surcharges === 'object' ? db.surcharges : {};
    var sync = ensureSyncMeta(db);
    ['priceList', 'surcharges', 'customFields', 'catTitles', 'catShort'].forEach(function (section) {
      if (!sync.sections[section]) sync.sections[section] = fallback;
    });
    db.priceList.forEach(function (item) {
      if (item && !item.updatedAt) item.updatedAt = sync.sections.priceList;
    });
    db.customFields.forEach(function (item) {
      if (item && !item.updatedAt) item.updatedAt = sync.sections.customFields;
    });
    Object.keys(db.surcharges).forEach(function (category) {
      if (!Array.isArray(db.surcharges[category])) return;
      db.surcharges[category].forEach(function (item) {
        if (item && !item.updatedAt) item.updatedAt = sync.sections.surcharges;
      });
    });
    db.clients.forEach(function (client) {
      client.services = Array.isArray(client.services) ? client.services : [];
      client.contracts = Array.isArray(client.contracts) ? client.contracts : [];
      if (!client.updatedAt) client.updatedAt = client.createdAt || fallback;
      client.contracts.forEach(function (contract) {
        if (!contract.updatedAt) contract.updatedAt = contract.createdAt || client.updatedAt || fallback;
        contract.prepaySnapshots = contract.prepaySnapshots && typeof contract.prepaySnapshots === 'object'
          ? contract.prepaySnapshots : {};
        contract.contractPriceSnapshots = contract.contractPriceSnapshots &&
          typeof contract.contractPriceSnapshots === 'object' ? contract.contractPriceSnapshots : {};
        contract.prepaySnapshotUpdatedAt = contract.prepaySnapshotUpdatedAt &&
          typeof contract.prepaySnapshotUpdatedAt === 'object' ? contract.prepaySnapshotUpdatedAt : {};
        contract.contractPriceSnapshotUpdatedAt = contract.contractPriceSnapshotUpdatedAt &&
          typeof contract.contractPriceSnapshotUpdatedAt === 'object' ? contract.contractPriceSnapshotUpdatedAt : {};
        Object.keys(contract.prepaySnapshots).forEach(function (month) {
          if (!contract.prepaySnapshotUpdatedAt[month]) contract.prepaySnapshotUpdatedAt[month] = contract.updatedAt;
        });
        Object.keys(contract.contractPriceSnapshots).forEach(function (month) {
          if (!contract.contractPriceSnapshotUpdatedAt[month]) {
            contract.contractPriceSnapshotUpdatedAt[month] = contract.updatedAt;
          }
        });
      });
      client.services.forEach(function (service) {
        if (!service.updatedAt) service.updatedAt = service.createdAt || client.updatedAt || fallback;
        if (PAY_TYPES.indexOf(service.pay) === -1) service.pay = 'none';
        service.price = Math.max(0, n(service.price));
        if (service.pay === 'full' || service.pay === 'full_prepay') service.payAmount = service.price;
        else service.payAmount = Math.max(0, Math.min(n(service.payAmount), service.price));
        if (service.actualPrepay != null) service.actualPrepay = Math.max(0, n(service.actualPrepay));
      });
      client.contracts.forEach(function (contract) {
        recalculateContractPayments(client.services, contract);
      });
    });
    return db;
  }

  function mergeTimestampMaps(aValues, bValues, aTimes, bTimes, aFallback, bFallback) {
    var values = {};
    var times = {};
    var keys = new Set(Object.keys(aValues || {}).concat(Object.keys(bValues || {})));
    keys.forEach(function (key) {
      var aTime = timestamp(aTimes && aTimes[key]) || timestamp(aFallback);
      var bTime = timestamp(bTimes && bTimes[key]) || timestamp(bFallback);
      if (aTime >= bTime) {
        if (aValues && Object.prototype.hasOwnProperty.call(aValues, key)) values[key] = aValues[key];
        times[key] = (aTimes && aTimes[key]) || aFallback;
      } else {
        if (bValues && Object.prototype.hasOwnProperty.call(bValues, key)) values[key] = bValues[key];
        times[key] = (bTimes && bTimes[key]) || bFallback;
      }
    });
    return { values: values, times: times };
  }

  function newerEntity(a, b, aFallback, bFallback) {
    if (!a) return clone(b);
    if (!b) return clone(a);
    return clone(entityTimestamp(a, aFallback) >= entityTimestamp(b, bFallback) ? a : b);
  }

  function mergeArraySection(local, remote, keyName, localFallback, remoteFallback) {
    var items = new Map();
    (remote || []).forEach(function (item) {
      items.set(text(item && item[keyName]), clone(item));
    });
    (local || []).forEach(function (item) {
      var key = text(item && item[keyName]);
      items.set(key, newerEntity(item, items.get(key), localFallback, remoteFallback));
    });
    return Array.from(items.values());
  }

  function mergeObjectSection(local, remote, preferLocal) {
    var out = {};
    var keys = new Set(Object.keys(local || {}).concat(Object.keys(remote || {})));
    keys.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(preferLocal ? local || {} : remote || {}, key)) {
        out[key] = clone((preferLocal ? local : remote)[key]);
      } else {
        out[key] = clone((preferLocal ? remote : local)[key]);
      }
    });
    return out;
  }

  function mergeContract(a, b, aFallback, bFallback) {
    var out = newerEntity(a, b, aFallback, bFallback);
    var prepay = mergeTimestampMaps(
      a.prepaySnapshots, b.prepaySnapshots,
      a.prepaySnapshotUpdatedAt, b.prepaySnapshotUpdatedAt,
      a.updatedAt || aFallback, b.updatedAt || bFallback
    );
    var price = mergeTimestampMaps(
      a.contractPriceSnapshots, b.contractPriceSnapshots,
      a.contractPriceSnapshotUpdatedAt, b.contractPriceSnapshotUpdatedAt,
      a.updatedAt || aFallback, b.updatedAt || bFallback
    );
    out.prepaySnapshots = prepay.values;
    out.prepaySnapshotUpdatedAt = prepay.times;
    out.contractPriceSnapshots = price.values;
    out.contractPriceSnapshotUpdatedAt = price.times;
    return out;
  }

  function mergeDeleted(a, b) {
    var out = {};
    var keys = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
    keys.forEach(function (key) {
      out[key] = timestamp(a && a[key]) >= timestamp(b && b[key]) ? a[key] : b[key];
    });
    return out;
  }

  function mergeClient(local, remote, localDbTime, remoteDbTime, deleted) {
    var out = newerEntity(local, remote, localDbTime, remoteDbTime);
    var contracts = new Map();
    (remote.contracts || []).forEach(function (item) { contracts.set(item.id, clone(item)); });
    (local.contracts || []).forEach(function (item) {
      var previous = contracts.get(item.id);
      contracts.set(item.id, previous ? mergeContract(item, previous, localDbTime, remoteDbTime) : clone(item));
    });
    out.contracts = Array.from(contracts.values()).filter(function (contract) {
      var removed = deleted.contracts[tombstoneKey(out.id, contract.id)];
      return !removed || timestamp(removed) < entityTimestamp(contract, 0);
    });
    var validContracts = new Set(out.contracts.map(function (contract) { return contract.id; }));
    var services = new Map();
    (remote.services || []).forEach(function (item) { services.set(item.id, clone(item)); });
    (local.services || []).forEach(function (item) {
      services.set(item.id, newerEntity(item, services.get(item.id), localDbTime, remoteDbTime));
    });
    out.services = Array.from(services.values()).filter(function (service) {
      var removed = deleted.services[tombstoneKey(out.id, service.id)];
      return (!removed || timestamp(removed) < entityTimestamp(service, 0)) &&
        (!service.contractId || validContracts.has(service.contractId));
    });
    out.sentDates = Array.from(new Set((local.sentDates || []).concat(remote.sentDates || []))).sort();
    out.contracts.forEach(function (contract) { recalculateContractPayments(out.services, contract); });
    return out;
  }

  function mergeDB(localInput, remoteInput) {
    var local = migrateDB(clone(localInput || {}));
    var remote = migrateDB(clone(remoteInput || {}));
    var localTime = local.updated || 0;
    var remoteTime = remote.updated || 0;
    var localSync = ensureSyncMeta(local);
    var remoteSync = ensureSyncMeta(remote);
    var deleted = {
      clients: mergeDeleted(localSync.deleted.clients, remoteSync.deleted.clients),
      contracts: mergeDeleted(localSync.deleted.contracts, remoteSync.deleted.contracts),
      services: mergeDeleted(localSync.deleted.services, remoteSync.deleted.services),
      customFields: mergeDeleted(localSync.deleted.customFields, remoteSync.deleted.customFields),
      priceList: mergeDeleted(localSync.deleted.priceList, remoteSync.deleted.priceList)
    };
    var newer = timestamp(localTime) >= timestamp(remoteTime) ? local : remote;
    var out = clone(newer);
    out.version = SCHEMA_VERSION;
    out.updated = latestIso(localTime, remoteTime);
    ensureSyncMeta(out);
    out._sync.deleted = deleted;
    var sections = new Set(Object.keys(localSync.sections).concat(Object.keys(remoteSync.sections)));
    sections.forEach(function (section) {
      var useLocal = timestamp(localSync.sections[section]) >= timestamp(remoteSync.sections[section]);
      if (section === 'priceList') {
        out[section] = mergeArraySection(
          local[section], remote[section], 'code',
          localSync.sections[section], remoteSync.sections[section]
        ).filter(function (item) {
          var removed = deleted.priceList[text(item && item.code)];
          return !removed || timestamp(removed) < entityTimestamp(item, 0);
        });
      } else if (section === 'customFields') {
        out[section] = mergeArraySection(
          local[section], remote[section], 'id',
          localSync.sections[section], remoteSync.sections[section]
        ).filter(function (item) {
          var removed = deleted.customFields[text(item && item.id)];
          return !removed || timestamp(removed) < entityTimestamp(item, 0);
        });
      } else if (
        local[section] && remote[section] &&
        typeof local[section] === 'object' && typeof remote[section] === 'object' &&
        !Array.isArray(local[section]) && !Array.isArray(remote[section])
      ) {
        out[section] = mergeObjectSection(local[section], remote[section], useLocal);
      } else if (Object.prototype.hasOwnProperty.call(useLocal ? local : remote, section)) {
        out[section] = clone((useLocal ? local : remote)[section]);
      }
      out._sync.sections[section] = useLocal ? localSync.sections[section] : remoteSync.sections[section];
    });
    var clients = new Map();
    (remote.clients || []).forEach(function (client) { clients.set(client.id, clone(client)); });
    (local.clients || []).forEach(function (client) {
      var previous = clients.get(client.id);
      clients.set(client.id, previous
        ? mergeClient(client, previous, localTime, remoteTime, deleted)
        : clone(client));
    });
    out.clients = Array.from(clients.values()).filter(function (client) {
      var removed = deleted.clients[client.id];
      return !removed || timestamp(removed) < entityTimestamp(client, 0);
    }).map(function (client) {
      var localClient = (local.clients || []).find(function (item) { return item.id === client.id; });
      var remoteClient = (remote.clients || []).find(function (item) { return item.id === client.id; });
      return localClient && remoteClient
        ? mergeClient(localClient, remoteClient, localTime, remoteTime, deleted)
        : client;
    });
    return migrateDB(out);
  }

  function touchSection(db, section, when) {
    ensureSyncMeta(db).sections[section] = when || isoNow();
  }

  var api = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    OFFER_CATEGORIES: OFFER_CATEGORIES.slice(),
    clone: clone,
    escapeHtml: escapeHtml,
    safeHttpUrl: safeHttpUrl,
    parseDateParts: parseDateParts,
    offerPayload: offerPayload,
    decodeOfferToken: decodeOfferToken,
    mergeOffers: mergeOffers,
    compareServices: compareServices,
    requestedPaid: requestedPaid,
    paidOf: paidOf,
    remainingOf: remainingOf,
    paidForList: paidForList,
    remainingForList: remainingForList,
    prepayOf: prepayOf,
    cashPaidOf: cashPaidOf,
    groupActualPrepay: groupActualPrepay,
    actualPrepayForMonth: actualPrepayForMonth,
    paidForAbonementMonth: paidForAbonementMonth,
    recalculateContractPayments: recalculateContractPayments,
    monthLastISO: monthLastISO,
    syncContractMonthSnapshots: syncContractMonthSnapshots,
    seedCurrentMonthSnapshot: seedCurrentMonthSnapshot,
    ensureSyncMeta: ensureSyncMeta,
    markDeleted: markDeleted,
    migrateDB: migrateDB,
    mergeDB: mergeDB,
    touchSection: touchSection,
    tombstoneKey: tombstoneKey
  };

  global.RaleksizCRMCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
