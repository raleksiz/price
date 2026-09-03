(function (global) {
  'use strict';

  const RECIPIENT = {
    name: 'ИП Рузлев Алексей Иванович', inn: '332301104501', ogrnip: '326330000056115',
    bank: 'ООО «Банк Точка»', bik: '044525104', corr: '30101810745374525104',
    account: '40802810620001141166', email: 'raleksiz.law@gmail.com', telegram: 'https://t.me/aruzlev'
  };
  const API = 'https://invoices.raleksiz-law.workers.dev';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
  const date = iso => { const p=String(iso||'').split('-'); return p.length===3 ? p[2]+'.'+p[1]+'.'+p[0] : ''; };
  const b64url = text => btoa(unescape(encodeURIComponent(text))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const unb64url = text => decodeURIComponent(escape(atob(String(text||'').replace(/-/g,'+').replace(/_/g,'/') + '==='.slice((String(text||'').length+3)%4))));
  const paymentString = d => ['ST00012','Name='+RECIPIENT.name,'PersonalAcc='+RECIPIENT.account,'BankName='+RECIPIENT.bank,'BIC='+RECIPIENT.bik,'CorrespAcc='+RECIPIENT.corr,'PayeeINN='+RECIPIENT.inn,'Purpose='+String(d.purpose||'')].join('|');
  function serviceBasis(basis) {
    return String(basis||'')
      .replace(/^Договор\b/, 'Договору')
      .replace(/^Дополнительное соглашение\b/, 'Дополнительному соглашению')
      .replace(/^Персональное предложение\b/, 'Персональному предложению')
      .replace(/^Обращение\b/, 'Обращению')
      .replace(/ к Договор\b/g, ' к Договору');
  }

  function documentHtml(d) {
    const payerInn = d.payerInn ? esc(d.payerInn) : '—';
    return `<article class="invoice-sheet">
      <header class="invoice-head">
        <img class="invoice-logo" src="${API}/logo.png" alt="RALEKSIZ HOUSE">
        <div class="invoice-issuer"><b>${RECIPIENT.name}</b><br>ИНН ${RECIPIENT.inn} · ОГРНИП ${RECIPIENT.ogrnip}<br>${RECIPIENT.email} · ${RECIPIENT.telegram}</div>
      </header>
      <section class="invoice-title"><div><h1>СЧЁТ НА ОПЛАТУ № ${esc(d.number)}</h1><p>от ${date(d.date)}</p></div></section>
      <section class="invoice-payment"><div class="invoice-qr" data-qr="${esc(paymentString(d))}"></div><div class="invoice-bank-grid">
        <div><span>Банк получателя</span><b>${RECIPIENT.bank}</b></div><div><span>БИК</span><b>${RECIPIENT.bik}</b></div>
        <div><span>Получатель</span><b>${RECIPIENT.name}</b></div><div><span>к/с</span><b>${RECIPIENT.corr}</b></div>
        <div><span>ИНН</span><b>${RECIPIENT.inn}</b></div><div><span>р/с</span><b>${RECIPIENT.account}</b></div>
      </div></section>
      <section class="invoice-parties"><div><span>Плательщик</span><b>${esc(d.payer)}</b><small>ИНН ${payerInn}</small></div><div><span>Основание</span><b>${esc(d.basis)}</b></div></section>
      <table class="invoice-items"><thead><tr><th>№</th><th>Наименование услуг</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr></thead><tbody><tr><td>1</td><td>Юридические услуги по ${esc(serviceBasis(d.basis))}</td><td>1</td><td>усл.</td><td>${money(d.amount)}</td><td>${money(d.amount)}</td></tr></tbody><tfoot><tr><td colspan="5">Итого к оплате</td><td>${money(d.amount)}</td></tr></tfoot></table>
      <div class="invoice-purpose"><span>Назначение платежа</span><b>${esc(d.purpose)}</b></div>
      <footer class="invoice-footer"><span>НДС не облагается</span><span>Счёт действителен без подписи и печати.</span></footer>
    </article>`;
  }
  function drawQrs(root) {
    root.querySelectorAll('[data-qr]').forEach(el => {
      el.innerHTML='';
      if (global.QRCode) new global.QRCode(el, {text:el.dataset.qr, width:132, height:132, correctLevel:global.QRCode.CorrectLevel.M});
      else el.textContent='Не удалось загрузить QR-код';
    });
  }
  function readToken() { return new URLSearchParams(location.search).get('i') || ''; }
  function token(d) { return b64url(JSON.stringify([1,d.number,d.date,Number(d.amount)||0,d.payer,d.payerInn||'',d.purpose,d.basis])); }
  global.RaleksizInvoice = {API, RECIPIENT, documentHtml, drawQrs, paymentString, token, readToken, money, date};
})(window);
