(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RaleksizActChanges = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  function text(value) {
    return value == null ? '' : String(value);
  }

  function normalizeLineBreaks(value) {
    return text(value).replace(/\r\n?/g, '\n');
  }

  function normalizeInlineText(value) {
    return normalizeLineBreaks(value).replace(/\s+/g, ' ').trim();
  }

  function normalizeMultilineText(value) {
    return normalizeLineBreaks(value)
      .split('\n')
      .map(function (line) { return line.replace(/[\t ]+/g, ' ').trim(); })
      .join('\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function normalizeBulletedText(value) {
    return normalizeLineBreaks(value)
      .split('\n')
      .map(function (line) { return line.replace(/[\t ]+/g, ' ').trim(); })
      .filter(Boolean)
      .join('\n');
  }

  function normalizeNumber(value) {
    if (value == null || value === '') return 0;
    var compact = typeof value === 'string'
      ? value.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
      : value;
    var number = Number(compact);
    return Number.isFinite(number) ? number : 0;
  }

  function customFieldValue(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return { value: text(raw.value), public: !!raw.public };
    }
    return { value: text(raw), public: false };
  }

  function normalizedCustomText(field, raw) {
    var value = customFieldValue(raw);
    if (!value.public || !value.value.trim()) return '';
    if (field && field.type === 'bulleted') return normalizeBulletedText(value.value);
    if (field && field.type === 'longtext') return normalizeMultilineText(value.value);
    return normalizeInlineText(value.value);
  }

  function stableSortById(list) {
    return list.slice().sort(function (a, b) {
      return text(a && a.id).localeCompare(text(b && b.id));
    });
  }

  function uniqueStrings(values) {
    var seen = Object.create(null);
    return values.filter(function (value) {
      value = text(value);
      if (!value || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function makeMap(list) {
    var map = new Map();
    (list || []).forEach(function (item) {
      if (item && item.id) map.set(item.id, item);
    });
    return map;
  }

  function normalizeApplied(values) {
    return (Array.isArray(values) ? values : [])
      .map(normalizeInlineText)
      .filter(Boolean);
  }

  function buildSnapshot(options) {
    options = options || {};
    var client = options.client || {};
    var fields = Array.isArray(options.customFields) ? options.customFields : [];
    var isProvided = typeof options.isProvided === 'function'
      ? options.isProvided : function () { return true; };
    var servicePresentation = typeof options.servicePresentation === 'function'
      ? options.servicePresentation : function () { return {}; };
    var contractPresentation = typeof options.contractPresentation === 'function'
      ? options.contractPresentation : function () { return {}; };
    var today = text(options.today);
    var issues = [];

    var publicContracts = (Array.isArray(client.contracts) ? client.contracts : [])
      .filter(function (contract) { return contract && contract.showInAct !== false; });
    var contractIds = Object.create(null);
    var contracts = [];
    publicContracts.forEach(function (contract) {
      var id = normalizeInlineText(contract.id);
      if (!id) {
        issues.push({ type: 'missing-contract-id' });
        return;
      }
      if (contractIds[id]) {
        issues.push({ type: 'duplicate-contract-id', id: id });
        return;
      }
      contractIds[id] = true;
      var shown = contractPresentation(contract) || {};
      contracts.push({
        id: id,
        sortCreatedAt: text(contract.createdAt),
        label: normalizeInlineText(shown.label),
        basis: normalizeInlineText(shown.basis),
        actMode: contract.actMode === 'monthly' ? 'monthly' : 'general'
      });
    });

    var customFieldDefinitions = fields.map(function (field) {
      return {
        id: normalizeInlineText(field && field.id),
        name: normalizeInlineText(field && field.name),
        type: normalizeInlineText(field && field.type) || 'text'
      };
    }).filter(function (field) {
      if (field.id) return true;
      issues.push({ type: 'missing-custom-field-id' });
      return false;
    });
    customFieldDefinitions = stableSortById(customFieldDefinitions);
    var fieldById = makeMap(customFieldDefinitions);

    var serviceIds = Object.create(null);
    var services = [];
    (Array.isArray(client.services) ? client.services : []).forEach(function (service) {
      if (!service || !contractIds[text(service.contractId)] || !isProvided(service, today)) return;
      var id = normalizeInlineText(service.id);
      if (!id) {
        issues.push({ type: 'missing-service-id', contractId: text(service.contractId) });
        return;
      }
      if (serviceIds[id]) {
        issues.push({ type: 'duplicate-service-id', id: id });
        return;
      }
      serviceIds[id] = true;
      var contractId = text(service.contractId);
      var contract = publicContracts.find(function (item) { return text(item && item.id) === contractId; });
      var shown = servicePresentation(service, contract) || {};
      var publicCustomValues = {};
      Object.keys(service.custom || {}).forEach(function (fieldId) {
        var field = fieldById.get(fieldId);
        if (!field) return;
        var value = normalizedCustomText(field, service.custom[fieldId]);
        if (!value) return;
        publicCustomValues[fieldId] = {
          name: field.name,
          type: field.type,
          value: value
        };
      });
      services.push({
        id: id,
        contractId: contractId,
        sort: {
          date: text(service.date).slice(0, 10),
          createdAt: text(service.createdAt)
        },
        fields: {
          date: normalizeInlineText(shown.date),
          code: normalizeInlineText(shown.code),
          desc: normalizeInlineText(shown.desc)
        },
        presentation: {
          priceVisible: shown.priceVisible !== false,
          price: normalizeNumber(shown.price),
          paidVisible: shown.paidVisible !== false,
          paid: normalizeNumber(shown.paid),
          paymentStatus: normalizeInlineText(shown.paymentStatus),
          prepay: !!shown.prepay,
          appliedVisible: shown.appliedVisible !== false,
          applied: normalizeApplied(shown.applied)
        },
        publicCustomValues: publicCustomValues
      });
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      capturedAt: text(options.capturedAt) || new Date().toISOString(),
      contracts: stableSortById(contracts),
      services: stableSortById(services),
      customFieldDefinitions: customFieldDefinitions,
      hasServices: services.length > 0,
      issues: issues
    };
  }

  function compareCustomFields(previous, current, changed) {
    var oldValues = previous.publicCustomValues || {};
    var newValues = current.publicCustomValues || {};
    var ids = uniqueStrings(Object.keys(oldValues).concat(Object.keys(newValues))).sort();
    ids.forEach(function (id) {
      var before = oldValues[id];
      var after = newValues[id];
      if (before && !after) {
        // The old value must never be restored in the current act. Highlight
        // the current description area to show that its composition changed.
        changed.push('desc');
        return;
      }
      if (!before && after) {
        changed.push('custom:' + id);
        return;
      }
      if (!same(before, after)) changed.push('custom:' + id);
    });
  }

  function compareService(previous, current) {
    var changed = [];
    if (previous.fields.date !== current.fields.date) changed.push('date');
    if (previous.fields.code !== current.fields.code) changed.push('code');
    if (previous.fields.desc !== current.fields.desc) changed.push('desc');

    var oldPresentation = previous.presentation || {};
    var newPresentation = current.presentation || {};
    if (oldPresentation.priceVisible && newPresentation.priceVisible &&
        oldPresentation.price !== newPresentation.price) changed.push('price');
    if (oldPresentation.paidVisible && newPresentation.paidVisible &&
        oldPresentation.paid !== newPresentation.paid) changed.push('paid');
    if (oldPresentation.paymentStatus !== newPresentation.paymentStatus ||
        oldPresentation.prepay !== newPresentation.prepay) changed.push('status');
    if (oldPresentation.appliedVisible && newPresentation.appliedVisible &&
        !same(oldPresentation.applied || [], newPresentation.applied || [])) {
      changed.push((newPresentation.applied || []).length ? 'applied' : 'desc');
    }

    compareCustomFields(previous, current, changed);
    return uniqueStrings(changed);
  }

  function emptyDiff(reason) {
    return {
      compatible: true,
      reason: reason || '',
      hasChanges: false,
      newServiceIds: [],
      changedFieldsByServiceId: {},
      deletedServices: []
    };
  }

  function compareSnapshots(previous, current) {
    if (!current || current.schemaVersion !== SCHEMA_VERSION) {
      var invalid = emptyDiff('invalid-current-snapshot');
      invalid.compatible = false;
      return invalid;
    }
    if (!previous) return emptyDiff('first-view');
    if (previous.schemaVersion !== current.schemaVersion) {
      var mismatch = emptyDiff('schema-version-mismatch');
      mismatch.compatible = false;
      return mismatch;
    }

    var oldServices = makeMap(previous.services);
    var newServices = makeMap(current.services);
    var result = emptyDiff('compared');

    newServices.forEach(function (service, id) {
      var oldService = oldServices.get(id);
      if (!oldService) {
        result.newServiceIds.push(id);
        return;
      }
      var fields = compareService(oldService, service);
      if (fields.length) result.changedFieldsByServiceId[id] = fields;
    });
    oldServices.forEach(function (service, id) {
      if (!newServices.has(id)) result.deletedServices.push(service);
    });

    result.newServiceIds.sort();
    result.deletedServices.sort(function (a, b) { return text(a.id).localeCompare(text(b.id)); });
    result.hasChanges = result.newServiceIds.length > 0 ||
      Object.keys(result.changedFieldsByServiceId).length > 0 ||
      result.deletedServices.length > 0;
    return result;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    buildSnapshot: buildSnapshot,
    compareSnapshots: compareSnapshots,
    normalizeInlineText: normalizeInlineText,
    normalizeMultilineText: normalizeMultilineText,
    normalizeBulletedText: normalizeBulletedText,
    normalizeNumber: normalizeNumber,
    customFieldValue: customFieldValue
  };
});
