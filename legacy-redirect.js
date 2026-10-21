(function () {
  'use strict';

  var PUBLIC_ORIGIN = 'https://raleksiz.com';
  var current = new URL(window.location.href);
  var mode = document.documentElement.dataset.legacyRoute || 'auto';
  var relativePath = current.pathname.replace(/^\/price(?=\/|$)/, '') || '/';

  function publicUrl(pathname) {
    return new URL(pathname, PUBLIC_ORIGIN);
  }

  function copyRemainingQuery(target, omittedNames) {
    var omitted = new Set(omittedNames || []);
    current.searchParams.forEach(function (value, name) {
      if (!omitted.has(name)) target.searchParams.append(name, value);
    });
  }

  function migrateLegacyCategoryHash(hash) {
    var match = hash.match(/^#cat-([\d,]+)$/);
    if (!match) return hash;

    var migrated = match[1]
      .split(',')
      .map(function (value) { return String(Number(value) + 1); })
      .join(',');
    return '#cat-' + migrated;
  }

  function reportUrl(token, omittedNames) {
    var target = publicUrl('/report/' + encodeURIComponent(token));
    copyRemainingQuery(target, omittedNames);
    return target;
  }

  function invoiceUrl(token, omittedNames) {
    var target = publicUrl('/invoice/' + encodeURIComponent(token));
    copyRemainingQuery(target, omittedNames);
    return target;
  }

  function resolveTarget() {
    var token;

    if (mode === 'report') {
      token = current.searchParams.get('c') || current.searchParams.get('token');
      return token ? reportUrl(token, ['c', 'token']) : publicUrl('/price/');
    }

    if (mode === 'invoice') {
      token = current.searchParams.get('i') || current.searchParams.get('token');
      return token ? invoiceUrl(token, ['i', 'token']) : publicUrl('/price/');
    }

    if (mode === 'internal') return publicUrl('/price/');

    if (mode === 'price') {
      var price = publicUrl('/price/');
      copyRemainingQuery(price, ['crm']);
      price.hash = migrateLegacyCategoryHash(current.hash);
      return price;
    }

    var cleanReport = relativePath.match(/^\/(?:report|acts|service-acts|act_of_services)\/([^/]+)\/?$/);
    if (cleanReport) return reportUrl(decodeURIComponent(cleanReport[1]));

    var cleanInvoice = relativePath.match(/^\/invoice\/([^/]+)\/?$/);
    if (cleanInvoice) return invoiceUrl(decodeURIComponent(cleanInvoice[1]));

    if (/^\/act-view\.html$/.test(relativePath)) {
      token = current.searchParams.get('c') || current.searchParams.get('token');
      if (token) return reportUrl(token, ['c', 'token']);
    }

    if (/^\/invoice-view\.html$/.test(relativePath)) {
      token = current.searchParams.get('i') || current.searchParams.get('token');
      if (token) return invoiceUrl(token, ['i', 'token']);
    }

    if (relativePath === '/' || relativePath === '/index.html') {
      var fallbackPrice = publicUrl('/price/');
      copyRemainingQuery(fallbackPrice, ['crm']);
      fallbackPrice.hash = migrateLegacyCategoryHash(current.hash);
      return fallbackPrice;
    }

    return publicUrl('/price/');
  }

  var target = resolveTarget();
  if (target.href !== current.href) window.location.replace(target.href);
})();
