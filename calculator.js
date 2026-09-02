/*
 * RALEKSIZ HOUSE — единый расчётный модуль (этап 1: тариф/остаток, этап 2: надбавки).
 * Экспорт: window.Calculator (acts.html), window.RaleksizCalculator (index.html).
 */
(function (global) {
  'use strict';

  function n(value) { return Number(value) || 0; }
  function text(value) { return String(value == null ? '' : value); }
  function dateKey(value) { return text(value).slice(0, 10); }
  function monthKey(value) { return dateKey(value).slice(0, 7); }
  function createdKey(service) { return text(service && service.createdAt); }
  function idKey(service) { return text(service && service.id); }
  function round(value) { return Math.round((n(value) + Number.EPSILON) * 100) / 100; }
  function clamp01(value) { return Math.min(1, Math.max(0, n(value))); }

  var tariffs = [
    { name: 'Base', from: 0, to: 24999, dmin: 0, dmax: 0 },
    { name: 'Easy', from: 25000, to: 49999, dmin: 0.10, dmax: 0.15 },
    { name: 'Must have', from: 50000, to: 69999, dmin: 0.1501, dmax: 0.20 },
    { name: 'Power', from: 70000, to: 100000, dmin: 0.2001, dmax: 0.25 }
  ];

  var tariffParams = {
    minTerm: 3,
    maxTerm: 12,
    weightBudget: 0.29,
    weightPrepay: 0.34,
    weightTerm: 0.37,
    minPrepayShare: 0.49,
    maxPrepayShare: 1.0
  };

  function tariffIndex(budget) {
    budget = n(budget);
    if (budget >= 70000) return 3;
    if (budget >= 50000) return 2;
    if (budget >= 25000) return 1;
    return 0;
  }

  function calcDiscount(budget, prepay, term) {
    budget = Math.max(0, n(budget));
    prepay = Math.max(0, n(prepay));
    term = Math.max(0, n(term));

    var tier = tariffs[tariffIndex(budget)];
    if (tier.name === 'Base') return { tariff: tier.name, discount: 0 };

    var prepayShare = budget > 0 ? prepay / budget : 0;
    var factorPrepay = prepayShare < tariffParams.minPrepayShare
      ? 0
      : clamp01((prepayShare - tariffParams.minPrepayShare) /
          (tariffParams.maxPrepayShare - tariffParams.minPrepayShare));
    var factorBudget = clamp01((budget - tier.from) / (tier.to - tier.from));
    var factorTerm = clamp01((term - tariffParams.minTerm) /
      (tariffParams.maxTerm - tariffParams.minTerm));
    var weighted = factorPrepay * tariffParams.weightPrepay +
      factorBudget * tariffParams.weightBudget +
      factorTerm * tariffParams.weightTerm;
    var discount = tier.dmin + (tier.dmax - tier.dmin) * weighted;

    return { tariff: tier.name, discount: discount };
  }

  function getContractTariff(budget, prepay, term) {
    var result = calcDiscount(budget, prepay, term);
    var isAbonement = n(term) >= tariffParams.minTerm && n(budget) > 0;
    if (!isAbonement) return { tariff: 'Base', discount: 0, status: 'Разовая услуга' };
    return {
      tariff: result.tariff,
      discount: result.discount,
      status: 'Абонемент'
    };
  }

  function compareServices(a, b) {
    var byDate = dateKey(a.date).localeCompare(dateKey(b.date));
    if (byDate) return byDate;
    var byPrice = n(b.price) - n(a.price);
    if (byPrice) return byPrice;
    var byCreated = createdKey(a).localeCompare(createdKey(b));
    if (byCreated) return byCreated;
    return idKey(a).localeCompare(idKey(b));
  }

  function sortMonthServices(services) {
    return (services || []).slice().sort(compareServices);
  }

  function getMonthBudget(contract, month) {
    if (contract && contract.contractPriceSnapshots && contract.contractPriceSnapshots[month] != null) {
      return Math.max(0, n(contract.contractPriceSnapshots[month]));
    }
    return Math.max(0, n(contract && contract.contractPrice));
  }

  function getMonthPrepay(contract, month) {
    if (contract && contract.prepaySnapshots && contract.prepaySnapshots[month] != null) {
      return Math.max(0, n(contract.prepaySnapshots[month]));
    }
    return Math.max(0, n(contract && contract.prepay));
  }

  function isOfferCategory(offerCats, catKey) {
    var categories = offerCats || [];
    return categories.indexOf(catKey) !== -1;
  }

  function normalizeDiscountPercent(discount) {
    var value = n(discount);
    if (value > 0 && value <= 1) return value * 100;
    return value;
  }

  /*
   * Этап 1: тарифная скидка.
   * contractRemainder — неизрасходованный остаток цены договора (только для «Абонемент»).
   */
  function getStage1Price(params) {
    params = params || {};
    var basePrice = round(n(params.basePrice));
    var discountPct = normalizeDiscountPercent(params.discount);
    var tariff = text(params.tariff || 'Base');
    var status = text(params.status || 'Разовая услуга');
    var catKey = text(params.catKey);
    var offerCats = params.offerCats || [];
    var budget = Math.max(0, n(params.contractPrice));
    var remainder = params.contractRemainder;
    if (remainder == null) remainder = params.prepayBalance;
    remainder = n(remainder);

    var discountedPrice = round(basePrice * (1 - discountPct / 100));
    var result = {
      tariff: tariff,
      discount: discountPct,
      basePrice: basePrice,
      discountedPrice: discountedPrice,
      stage1Price: basePrice,
      eligible: false,
      applied: false,
      reason: ''
    };

    if (!discountPct || tariff === 'Base') {
      result.reason = 'Тарифная скидка отсутствует';
      return result;
    }

    if (status === 'Абонемент') {
      result.eligible = true;
      if (basePrice > budget) {
        result.reason = 'Базовая цена превышает бюджет договора';
        return result;
      }
    } else if (tariff === 'Offer' && isOfferCategory(offerCats, catKey)) {
      result.eligible = true;
      result.stage1Price = discountedPrice;
      result.applied = true;
      result.reason = 'Применена скидка по персональному предложению';
      return result;
    } else {
      result.reason = 'Скидка не применяется к этой категории разовой услуги';
      return result;
    }

    if (remainder < discountedPrice / 2) {
      result.reason = 'Остаток цены договора меньше половины цены со скидкой';
      return result;
    }

    result.applied = true;
    result.stage1Price = discountedPrice;
    result.reason = 'Применена тарифная скидка';
    return result;
  }

  function getDiscountDecision(contract, basePrice, catKey, contractRemainder) {
    return getStage1Price({
      basePrice: basePrice,
      discount: contract && contract.discount,
      tariff: contract && contract.tariff,
      status: contract && contract.status,
      catKey: catKey,
      offerCats: (contract && (contract.offerCats || contract.offerCategories || contract.categories)) || [],
      contractPrice: contract && contract.contractPrice,
      contractRemainder: contractRemainder
    });
  }

  function normalizeSelected(selected) {
    if (!selected) return [];
    if (Array.isArray(selected)) return selected;
    return Object.keys(selected).map(function (key) {
      var value = selected[key];
      if (value && typeof value === 'object') {
        var copy = {};
        Object.keys(value).forEach(function (name) { copy[name] = value[name]; });
        if (copy.id == null) copy.id = key;
        return copy;
      }
      return { id: key, count: value === true ? 1 : n(value) || 1 };
    });
  }

  function surchargeName(item) {
    return text(item && (item.name || item.title || item.label || item.id));
  }

  function pluralRu(count, one, few, many) {
    var abs = Math.abs(n(count)) % 100;
    var last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  function formatAppliedComment(item) {
    // "Скидка по тарифу" в акте выводится без комментария (только название).
    var nameForRule = text(item && item.name).trim().toLowerCase();
    if (/скидка по тарифу/i.test(nameForRule)) return '';

    var comment = text(item && item.comment).trim();
    if (comment) return comment;
    var count = Math.max(1, n(item && item.count));
    var name = text(item && item.name).toLowerCase();
    if (/встреча для обсуждения/i.test(name)) {
      return count + ' ' + pluralRu(count, 'встреча', 'встречи', 'встреч');
    }
    if (/уведомление банков/i.test(name)) {
      return count + ' ' + pluralRu(count, 'уведомление', 'уведомления', 'уведомлений');
    }
    return '';
  }

  function formatAppliedLabel(item) {
    var name = text(item && item.name).trim();
    if (!name) return '';
    // Для "Скидка по тарифу" показываем только название.
    if (/скидка по тарифу/i.test(name)) return name;

    var comment = formatAppliedComment(item);
    if (comment) return name + ' (' + comment + ')';

    // Если комментарий не сформирован (например, для "Доверитель — ЮЛ/ИП"),
    // в скобках показываем рассчитанную сумму (как в PDF/таблице).
    var amount = n(item && item.amount);
    if (amount) {
      var displayAmount = (/зач[её]т/i.test(name)) ? Math.abs(Math.round(amount)) : Math.round(amount);
      return name + ' (' + displayAmount.toLocaleString('ru-RU') + ')';
    }
    return name;
  }

  function formatAppliedList(applied) {
    return (applied || []).map(formatAppliedLabel).filter(Boolean);
  }

  function findSurcharge(definitions, selected) {
    var selectedName = surchargeName(selected);
    return (definitions || []).filter(function (item) {
      return surchargeName(item) === selectedName;
    })[0] || null;
  }

  function selectedCount(selected, definition) {
    // Количество берётся только из count / defaultCount.
    // selected.value — это ставка надбавки (₽ или доля), а не количество.
    if (selected && selected.count != null && selected.count !== '') {
      return Math.max(1, n(selected.count));
    }
    if (definition && definition.defaultCount != null) return Math.max(1, n(definition.defaultCount));
    return 1;
  }

  function needsBaseContractPrice(definition) {
    var name = text(definition && definition.name).toLowerCase();
    return /50%.*базов/i.test(name) && !/за сторон/i.test(name);
  }

  function applySurcharges(startPrice, definitions, selectedSurcharges) {
    var price = round(startPrice);
    var notes = [];
    var applied = [];
    var selected = normalizeSelected(selectedSurcharges);
    var resolved = selected.map(function (entry, index) {
      var found = findSurcharge(definitions, entry);
      var definition = found ? Object.assign({}, found, {
        count: entry.count,
        extraAmount: entry.extraAmount,
        comment: entry.comment,
        basePrice: entry.basePrice
      }) : entry;
      return {
        entry: entry,
        definition: definition,
        index: index,
        name: surchargeName(definition) || surchargeName(entry),
        order: found && found.order != null ? n(found.order) : (definition.order != null ? n(definition.order) : index + 1000),
        count: selectedCount(entry, found || definition),
        extraAmount: Math.max(0, n(entry.extraAmount))
      };
    });

    var cheapest = resolved.filter(function (item) {
      return item.definition && item.definition.group === 'cheapest_realestate';
    });
    if (cheapest.length > 1) {
      cheapest.sort(function (a, b) {
        return Math.abs(n(a.definition.value)) - Math.abs(n(b.definition.value));
      });
      var keep = cheapest[0];
      var overflow = cheapest.slice(1).length;
      resolved = resolved.filter(function (item) {
        return !item.definition || item.definition.group !== 'cheapest_realestate' || item === keep;
      });
      var target = resolved.filter(function (item) {
        return item.definition && (
          item.definition.groupOverflowTarget === 'нестандартность' ||
          /нестандартност/i.test(item.name)
        );
      })[0];
      if (target) target.count += overflow;
    }

    resolved.sort(function (a, b) { return a.order - b.order || a.index - b.index; });

    resolved.forEach(function (item) {
      var def = item.definition || {};
      var before = price;
      var kind = text(def.type || def.kind || 'fix');
      var value = n(def.value);
      if (!value && def.amount) {
        var amountText = text(def.amount).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        value = n(String(amountText).replace(/[^\d,.\-]/g, '').replace(',', '.').replace(/−/g, '-'));
      }
      var amount = 0;
      var delta = 0;

      if (kind === 'pct') {
        var pctBase = price;
        if (needsBaseContractPrice(def) && item.entry.basePrice != null) {
          pctBase = Math.max(0, n(item.entry.basePrice));
        }
        amount = round(item.count * value * pctBase);
        price = round(price + amount);
        delta = amount;
      } else if (kind === 'mult') {
        price = round(price * value);
        delta = round(price - before);
        amount = delta;
      } else if (kind === 'manual') {
        if (item.extraAmount) {
          amount = -round(Math.abs(item.extraAmount));
          price = round(price + amount);
          delta = amount;
        }
        if (item.entry.comment) notes.push(text(item.entry.comment));
      } else {
        amount = round(item.count * value + item.extraAmount);
        price = round(price + amount);
        delta = amount;
      }

      if (kind !== 'manual' || item.extraAmount || item.entry.comment) {
        var appliedComment = '';
        try {
          appliedComment = text(item.entry.comment || formatAppliedComment({
            name: item.name,
            count: item.count,
            comment: item.entry.comment
          }));
        } catch (e) {
          appliedComment = text(item.entry.comment);
        }
        applied.push({
          id: item.name,
          name: item.name,
          count: item.count,
          type: kind,
          value: value,
          extraAmount: item.extraAmount,
          amount: amount,
          delta: delta,
          comment: appliedComment,
          priceBefore: before,
          priceAfter: price
        });
      }
    });

    return { price: round(price), applied: applied, manualNotes: notes };
  }

  function basePriceFromItem(priceItem, side) {
    if (!priceItem) return 0;
    if (priceItem.dual && n(side) === 2 && priceItem.price2 != null) return n(priceItem.price2);
    return n(priceItem.price);
  }

  function buildAppliedTariff(stage1) {
    if (!stage1.applied) return [];
    return [{
      id: 'tariff_discount',
      name: 'Скидка по тарифу',
      count: 1,
      type: 'discount',
      value: stage1.discount,
      amount: round(stage1.stage1Price - stage1.basePrice),
      delta: round(stage1.stage1Price - stage1.basePrice),
      comment: stage1.reason,
      priceBefore: stage1.basePrice,
      priceAfter: stage1.stage1Price
    }];
  }

  function calculateInput(input) {
    input = input || {};
    var priceItem = input.priceItem || {};
    var catKey = text(priceItem.cat || input.catKey);
    var definitions = (input.surchargesMap && input.surchargesMap[catKey]) ||
      input.surchargeDefinitions || [];
    var base = round(basePriceFromItem(priceItem, input.side));
    var stage1 = getStage1Price({
      basePrice: base,
      discount: input.contractDiscount,
      tariff: input.contractTariff,
      status: input.contractStatus,
      catKey: catKey,
      offerCats: input.offerCats || [],
      contractPrice: input.contractPrice,
      contractRemainder: input.contractRemainder != null ? input.contractRemainder : input.prepayBalance
    });
    var surcharges = applySurcharges(stage1.stage1Price, definitions, input.selectedSurcharges || []);
    var applied = buildAppliedTariff(stage1).concat(surcharges.applied);

    return {
      final: surcharges.price,
      base: base,
      priceWithDiscount: stage1.stage1Price,
      stage1: stage1,
      applied: applied,
      discountApplied: stage1.applied,
      discountReason: stage1.reason,
      manualNotes: surcharges.manualNotes
    };
  }

  function serviceFinalPrice(service, priceGuess) {
    if (priceGuess != null) return round(priceGuess);
    if (service && (service.priceManual || service.locked)) return round(service.price);
    return round(service && service.price);
  }

  function monthServicesList(services, contract, month, currentServiceId, currentDate) {
    return (services || []).filter(function (service) {
      if (!service || !service.date) return false;
      if (contract && service.contractId !== contract.id) return false;
      if (monthKey(service.date) !== month) return false;
      if (currentServiceId && service.id === currentServiceId) return false;
      return true;
    });
  }

  function compareMonthEntries(a, b) {
    return compareServices(a, b);
  }

  function buildMonthEntries(services, contract, month, options) {
    options = options || {};
    var currentId = options.currentServiceId;
    var currentDate = options.currentDate;
    var currentPrice = options.currentPrice;
    var currentCreatedAt = options.currentCreatedAt || new Date().toISOString();

    var entries = monthServicesList(services, contract, month, currentId, currentDate).map(function (service) {
      return {
        id: service.id,
        date: service.date,
        createdAt: service.createdAt,
        price: serviceFinalPrice(service),
        service: service,
        isCurrent: false
      };
    });

    if (currentDate && monthKey(currentDate) === month) {
      entries.push({
        id: currentId || '__current__',
        date: currentDate,
        createdAt: currentCreatedAt,
        price: round(currentPrice),
        service: null,
        isCurrent: true
      });
    }

    return entries.sort(compareMonthEntries);
  }

  function contractRemainderBefore(services, contract, date, priceGuess, options) {
    options = options || {};
    var month = monthKey(date);
    var budget = getMonthBudget(contract, month);
    var entries = buildMonthEntries(services, contract, month, {
      currentServiceId: options.currentServiceId,
      currentDate: date,
      currentPrice: priceGuess,
      currentCreatedAt: options.currentCreatedAt
    });
    var currentId = options.currentServiceId || '__current__';
    var sumBefore = 0;
    var found = false;

    entries.forEach(function (entry) {
      if (found) return;
      if (entry.isCurrent || entry.id === currentId) {
        found = true;
        return;
      }
      sumBefore += n(entry.price);
    });

    return Math.max(0, round(budget - sumBefore));
  }

  function getContractPriceBalance(contract, services, date, priceGuess, options) {
    return contractRemainderBefore(services, contract, date, priceGuess, options || {});
  }

  function calculateService(service, contract, definitions, contractRemainder) {
    service = service || {};
    var basePrice = n(service.basePrice != null ? service.basePrice : service.price);
    var stage1 = getStage1Price({
      basePrice: basePrice,
      discount: contract && contract.discount,
      tariff: contract && contract.tariff,
      status: contract && contract.status,
      catKey: service.catKey,
      offerCats: (contract && (contract.offerCats || contract.offerCategories || contract.categories)) || [],
      contractPrice: contract && contract.contractPrice,
      contractRemainder: contractRemainder
    });
    var surcharges = applySurcharges(stage1.stage1Price, definitions, service.surcharges);
    var applied = buildAppliedTariff(stage1).concat(surcharges.applied);

    return {
      price: surcharges.price,
      basePrice: stage1.basePrice,
      discountPrice: stage1.stage1Price,
      contractRemainder: Math.max(0, n(contractRemainder)),
      discount: stage1,
      applied: applied,
      manualNotes: surcharges.manualNotes
    };
  }

  function getMonthStartBalance(contract) {
    if (contract && text(contract.status) === 'Абонемент') {
      return function (month) { return getMonthBudget(contract, month); };
    }
    return function (month) { return getMonthPrepay(contract, month); };
  }

  function calculateMonthHistory(services, contract, priceFn) {
    var list = (services || []).filter(function (service) { return service && service.date; });
    if (!list.length) return { services: [], changed: [], startIndex: 0 };

    var month = monthKey(list[0].date);
    var startBalance = getMonthStartBalance(contract)(month);
    var MAX_ITER = 24;

    for (var iter = 0; iter < MAX_ITER; iter++) {
      var ordered = list.slice().sort(function (a, b) {
        return compareMonthEntries(
          { date: a.date, price: a._calcPrice != null ? a._calcPrice : serviceFinalPrice(a), createdAt: a.createdAt, id: a.id },
          { date: b.date, price: b._calcPrice != null ? b._calcPrice : serviceFinalPrice(b), createdAt: b.createdAt, id: b.id }
        );
      });

      var balance = startBalance;
      var calculated = [];
      var changedOrder = false;

      ordered.forEach(function (service, index) {
        var before = Math.max(0, balance);
        var result = typeof priceFn === 'function'
          ? priceFn(service, before, { index: index, month: month, contract: contract })
          : { price: serviceFinalPrice(service) };
        var price = round(result && result.price);
        service._calcPrice = price;
        calculated.push({ service: service, contractRemainder: before, price: price, result: result || {}, monthOrder: index + 1 });
        balance = Math.max(0, round(balance - price));
      });

      var next = list.slice().sort(function (a, b) {
        var ca = calculated.find(function (x) { return x.service === a; });
        var cb = calculated.find(function (x) { return x.service === b; });
        return compareMonthEntries(
          { date: a.date, price: ca ? ca.price : serviceFinalPrice(a), createdAt: a.createdAt, id: a.id },
          { date: b.date, price: cb ? cb.price : serviceFinalPrice(b), createdAt: b.createdAt, id: b.id }
        );
      });

      changedOrder = next.some(function (service, index) { return service !== ordered[index]; });
      list = next;

      if (!changedOrder) {
        calculated.forEach(function (entry, index) {
          entry.monthOrder = index + 1;
        });
        list.forEach(function (service) { delete service._calcPrice; });
        return {
          services: calculated,
          changed: calculated.map(function (entry) { return entry.service; }),
          startIndex: 0
        };
      }
    }

    list.forEach(function (service) { delete service._calcPrice; });
    var balance = startBalance;
    return {
      services: list.map(function (service, index) {
        var before = Math.max(0, balance);
        var result = typeof priceFn === 'function'
          ? priceFn(service, before, { index: index, month: month, contract: contract })
          : { price: serviceFinalPrice(service) };
        var price = round(result && result.price);
        balance = Math.max(0, round(balance - price));
        return { service: service, contractRemainder: before, price: price, result: result || {}, monthOrder: index + 1 };
      }),
      changed: list.slice(),
      startIndex: 0
    };
  }

  function rebuildMonthFrom(services, contract, priceFn, fromDate) {
    var result = calculateMonthHistory(services, contract, priceFn);
    var cutoff = dateKey(fromDate);
    result.services.forEach(function (entry) {
      var service = entry.service;
      if (!cutoff || dateKey(service.date) >= cutoff) {
        service.contractRemainder = round(entry.contractRemainder);
        service.prepayBalance = round(entry.contractRemainder);
        service.monthOrder = entry.monthOrder;
        service.contractRemainderUpdatedAt = new Date().toISOString();
        if (!service.locked) {
          var beforePrice = round(service.price);
          var beforeApplied = JSON.stringify(service.applied || []);
          service.price = round(entry.price);
          service.applied = entry.result.applied || [];
          service.basePrice = entry.result.basePrice != null ? entry.result.basePrice : service.basePrice;
          service.discountPrice = entry.result.discountPrice != null ? entry.result.discountPrice : service.discountPrice;
          if (beforePrice !== service.price || beforeApplied !== JSON.stringify(service.applied)) {
            service.updatedAt = new Date().toISOString();
          }
        }
      }
    });
    return result;
  }

  function recalculateContractMonth(services, contract, priceFn, month, fromDate) {
    var monthServices = (services || []).filter(function (service) {
      return monthKey(service.date) === month;
    });
    return rebuildMonthFrom(monthServices, contract, priceFn, fromDate);
  }

  function getFrozenContractRemainder(service) {
    if (service && service.contractRemainder != null) return n(service.contractRemainder);
    return service && service.prepayBalance != null ? n(service.prepayBalance) : null;
  }

  var Calculator = {
    calculate: calculateInput,
    getStage1Price: getStage1Price,
    applySurcharges: applySurcharges,
    getContractPriceBalance: getContractPriceBalance,
    compareServices: compareServices,
    sortMonthServices: sortMonthServices,
    calculateMonthHistory: calculateMonthHistory,
    rebuildMonthFrom: rebuildMonthFrom,
    recalculateContractMonth: recalculateContractMonth,
    monthKey: monthKey,
    round: round,
    formatAppliedComment: formatAppliedComment,
    formatAppliedLabel: formatAppliedLabel,
    formatAppliedList: formatAppliedList
  };

  global.Calculator = Calculator;
  global.RaleksizCalculator = {
    tariffs: tariffs,
    tariffParams: tariffParams,
    tariffIndex: tariffIndex,
    calcDiscount: calcDiscount,
    getContractTariff: getContractTariff,
    compareServices: compareServices,
    sortMonthServices: sortMonthServices,
    getMonthPrepay: getMonthPrepay,
    getMonthBudget: getMonthBudget,
    getDiscountDecision: getDiscountDecision,
    getStage1Price: getStage1Price,
    applySurcharges: applySurcharges,
    calculate: calculateInput,
    calculateService: calculateService,
    calculateMonthHistory: calculateMonthHistory,
    rebuildMonthFrom: rebuildMonthFrom,
    recalculateContractMonth: recalculateContractMonth,
    getContractPriceBalance: getContractPriceBalance,
    getFrozenContractRemainder: getFrozenContractRemainder,
    monthKey: monthKey,
    round: round,
    formatAppliedComment: formatAppliedComment,
    formatAppliedLabel: formatAppliedLabel,
    formatAppliedList: formatAppliedList
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Calculator: Calculator, RaleksizCalculator: global.RaleksizCalculator };
  }
}(typeof window !== 'undefined' ? window : globalThis));
