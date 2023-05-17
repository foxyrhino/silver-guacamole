

mixin('link', async () => {
  // checks if script has already been run
  if (Object.hasOwn(HTMLElement.prototype, '$')) return;

  await import(chrome.runtime.getURL('modules/idb-keyval.js'));

  const $ = (q) => document.querySelector(q);
  Object.defineProperty(HTMLElement.prototype, '$', {
    value: function (q) { return this.querySelector(q) }
  });
  function createElem(q, t, a) {
    const e = document.createElement(q);
    if (t) e.append(document.createTextNode(t));
    for (const [k, v] of Object.entries(a ?? 0)) e[k] = v;
    return e;
  }
  function observeMut(q, fn, attrs) {
    const o = new MutationObserver(fn);
    o.observe($(q), attrs ?? { childList: true });
  }
  function observeMutOnce(q, fn, attrs) {
    const o = new MutationObserver((m, o) => { fn(m, o); o.disconnect(); });
    o.observe($(q), attrs ?? { childList: true });
  }

  let currentMobile, clipboardMobile;
  async function getMobile() {
    if (!document.hasFocus()) return;
    const cbText = (await navigator.clipboard.readText()).trim();
    if (isNaN(+cbText) || cbText.length !== 8) return;
    clipboardMobile = cbText;
    inputNewMobile();
  }
  getMobile();
  window.addEventListener('focus', getMobile);

  function inputNewMobile() {
    if (currentMobile === clipboardMobile) return;
    if (pageState !== 1) {
      if (pageState > 1) goBackToPageOne();
      return;
    }
    const IDInput = $('.MuiGrid-root').children[5].$('input');
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inputSetter.call(IDInput, clipboardMobile);
    IDInput.dispatchEvent(new Event('input', { bubbles: true }));
    currentMobile = clipboardMobile;
  }

  let pageState = 0;
  const onPageChange = (c) => {
    if (c.classList.contains('MuiGrid-root')) {
      initPageOne();
    } else if (c.classList.contains('MuiPaper-root')) {
      initPageTwo();
    } else if (c.tagName === 'FORM') {
      initPageThree();
    }
  };
  const pageObserver = new MutationObserver((l) => onPageChange(l[0].target.firstElementChild));
  observeMut('#root', (m) => {
    if ($('#root > .MuiContainer-root')) {
      pageObserver.observe($('.MuiContainer-root'), { childList: true });
      onPageChange($('.MuiContainer-root').firstElementChild);
    }
  });

  let UploadBn;
  async function onUpload(e) {
    await idbKeyval.clear();
    const dbEntries = await idbKeyval.keys();
    if (dbEntries.length) {
      alert('Cannot upload new file as there are still old records that have not yet been verified!');
      return;
    }
    if (!readXlsxFile) await import(chrome.runtime.getURL('modules/read-excel-file.js'));
    const rows = await readXlsxFile(e.target.files[0]);
    let headerSize = 0;
    while (!rows[headerSize][0] instanceof Date) {
      headerSize++;
    }
    const mobileMap = new Map(); // key: mobile number, value: idbkey
    const idAndNamesMap = new Map(); // key: ID+Name, value: idbkey
    for (let i = 2; i < rows.length; i++) {
      const key = i - 2;
      const val = {
        date: rows[i][0],
        mobile: rows[i][2],
        id: rows[i][7],
        name: rows[i][8]
        // additional fields:
        // usesMyInfo => whether info was retrieved from myinfo, no checking is required if true
        // isExtraMobile => whether a previous number already has the same customer, no checking is required if true
        // keysOfExtraMobiles => Array of idbkeys of extra mobile numbers of the same customer
        // isExtraId => whether is it an extra different ID of the same mobile number, no checking is required if true, as all will be handled when the original is checked
        // extraIds => Map of idbkeys (k) and extra IDs (v) of the customer, for the same mobile number
        // isIncorrectId => this field is set during runtime, after user has chosen which ID is the correct one
        // verified => whether user has verified this number and customer
      };
      if (rows[i][13] === 'YES') val.usesMyInfo = true;
      if (mobileMap.has(val.mobile)) {
        const keyOfOriginal = mobileMap.get(val.mobile);
        idbKeyval.update(keyOfOriginal, (v) => {
          v.extraIds ??= {};
          v.extraIds[key] = val.id;
          return v;
        });
        val.isExtraId = true;
      } else {
        mobileMap.set(val.mobile, key);
      }
      const idAndName = `${val.id}+${val.name}`;
      if (idAndNameMap.has(idAndName)) {
        const keyOfOriginal = idAndNameMap.get(idAndName);
        idbKeyval.update(keyOfOriginal, (v) => {
          v.keysOfExtraMobiles ??= [];
          v.keysOfExtraMobiles.push(val.mobile);
          return v;
        });
        val.isExtraMobile = true;
      } else {
        idAndNameMap.set(idAndName, key);
      }
      idbKeyval.set(key, val);
    }
    for (const [k, v] of await idbKeyval.entries()) {
      console.log(k, v);
    }
    idbKeyval.clear();
  }

  function createUploadBn() {
    if (UploadBn) return;
    UploadBn = createElem('label', 'UPLOAD', {
      className: 'css-17kvgbn',
      style: 'position:fixed;right:16px;bottom:16px',
    });
    const Input = createElem('input', null, {
      type: 'file',
      accept: '.xlsx',
      style: 'display:none',
      onchange: onUpload,
    });
    UploadBn.append(Input);
    $('body').append(UploadBn);
  }

  function initPageOne() {
    createUploadBn();
    const TTInput = $('.MuiGrid-root').children[1].$('[role=button]');
    const IDInput = $('.MuiGrid-root').children[5].$('input');
    const SubmitBn = $('.MuiGrid-root').lastChild.$('button');
    IDInput.addEventListener('input', (e) => {
      if (e.target.value.trim().length == 8 && !isNaN(+e.target.value)) {
        setTimeout(() => SubmitBn.click(), 100);
      }
    });
    pageState = 1;
    if (TTInput.nextSibling.value !== 'REGPORT,REG,CHGOWN') {
      TTInput.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true
      }));
      observeMutOnce('.MuiPopover-root ul', (m) => {
        const DList = m[0].target;
        if (DList.children.length) {
          const values = ['REGPORT', 'REG', 'CHGOWN'];
          for (const DItem of DList.children) {
            if (values.includes(DItem.getAttribute('data-value')) !==
              (DItem.getAttribute('aria-selected') === 'true')) {
              DItem.click();
            }
          }
          $('.MuiPopover-root > .MuiBackdrop-root').click();
        }
      });
    }
    inputNewMobile();
  }

  function initPageTwo() {
    if (pageState === 1) {
      UploadBn.remove();
      UploadBn = null;
      const ViewBn = $('.MuiPaper-root tbody button');
      ViewBn.click();
    }
    pageState = 2;
  }

  function addCopyBn(elem) {
    elem.style.position = 'relative';
    const copyText = elem.$('p').textContent.trim();
    const bn = createElem('button', 'Copy', {
      type: 'button',
      className: 'css-17kvgbn',
      style: 'position:absolute;top:16px;right:16px;padding:0.5rem 1.2rem',
      onclick: function () {
        navigator.clipboard.writeText(copyText).then(() => {
          this.textContent = 'COPIED!';
        })
      }
    });
    elem.append(bn);
  }

  const dataStrings = ['Time', 'ID', 'Name', 'DOB', 'Nationality', 'Local Count', 'Retrieved From MyInfo'];
  const dataIndexes = [1, 14, 15, 16, 17, 21, 22];
  const getDataFromPage = (i) => $('.MuiGrid-root').children[i].$('p').textContent.trim();

  function getImageDiv(imgSrc) {
    if (!imgSrc) return null;
    let isMouseDown = false, isDragging = false;
    let x = 0, y = 0, prevX = 0, prevY = 0;
    let tX = 0, tY = 0, scale = 1, rotate = 0;
    const elem = createElem('div', null, {
      className: 'img-wrapper',
      oncontextmenu: (e) => e.preventDefault(),
      onmousemove: (e) => {
        const rect = elem.getBoundingClientRect();
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
        if (isMouseDown) {
          isDragging = true;
          tX += x - prevX;
          tY += y - prevY;
          elem.firstElementChild.style.translate = `${tX}px ${tY}px`;
        }
        prevX = x;
        prevY = y;
      },
      onmousewheel: (e) => {
        e.preventDefault();
        scale *= e.deltaY > 0 ? 0.8 : 1.25;
        if (scale < 0.512) scale = 0.512;
        elem.firstElementChild.style.scale = scale;
      },
      onmousedown: (e) => {
        e.preventDefault();
        isMouseDown = true;
      },
      onmouseup: (e) => {
        isMouseDown = false;
        if (isDragging) {
          isDragging = false;
        } else {
          if (e.which == 2) {
            tX = 0, tY = 0, scale = 1, rotate = 0;
            elem.firstElementChild.style = '';
            return;
          } else if (e.which == 1) {
            rotate -= 1;
            if (rotate == -1) rotate = 3;
          } else if (e.which == 3) {
            rotate += 1;
            if (rotate == 4) rotate = 0;
          }
          elem.firstElementChild.style.rotate = `${rotate * 90}deg`;
        }
      }
    });
    const img = createElem('img', null, {
      alt: '',
      src: imgSrc,
      draggable: false
    });
    elem.append(img);
    return elem;
  }

  function buildUI() {
    if ($('body .custom-overlay')) return;
    const Overlay = createElem('div', 0, { className: 'custom-overlay' });
    const BackBn = createElem('button', 'BACK', {
      className: 'btn-back css-17kvgbn',
      onclick: goBackToPageOne,
    });
    const EditBn = createElem('button', 'EDIT', {
      className: 'btn-edit css-17kvgbn',
      onclick: () => {
        Overlay.remove();
        window.scrollTo(0, $('.MuiGrid-root').children[14].offsetTop);
        $('.MuiGrid-root').children[25].$('button').click();
      }
    });
    const CloseBn = createElem('button', 'CLOSE', {
      className: 'css-17kvgbn',
      onclick: () => {
        Overlay.remove();
      }
    });
    dataStrings[1] = $('.MuiGrid-root').children[14].$('label').textContent.trim();
    const Dialog = `
      <div class="custom-overlay">
        <div class="custom-dialog">
          <div class="image-column">
          </div>
          <div class="info-column">
            ${dataIndexes.map((d, i) => `
              <div class="info-row">
                <b>${dataStrings[i]}</b>
                <p>${getDataFromPage(d)}</p>
              </div>
            `).join('')}
          </div>
          <div class="dialog-footer"></div>
        </div>
      </div>
    `;
    Overlay.insertAdjacentHTML('beforeend', Dialog);
    Overlay.$('.custom-dialog').append(BackBn);
    Overlay.$('.dialog-footer').append(EditBn);
    Overlay.$('.dialog-footer').append(CloseBn);
    if (dataStrings[1] === 'WORKP No.') {
      const CopyBn = createElem('button', 'CHECK WORKPASS', {
        className: 'btn-wp-check css-17kvgbn',
        onclick: copyWorkPassInfo
      });
      Overlay.$('.info-column').children[1].append(CopyBn);
    }
    if ($('.MuiGrid-root').children[27]) {
      observeMut('.MuiGrid-root :nth-child(28) img', (m, o) => {
        if (m[0].target.src.startsWith('data:image')) {
          const ImgDiv = getImageDiv(m[0].target.src);
          if (!$('.MuiGrid-root').children[28]) {
            ImgDiv.firstElementChild.style.scale = 0.8;
          }
          Overlay.$('.image-column').prepend(ImgDiv);
        }
      }, { attributeFilter: ['src'] })
      if ($('.MuiGrid-root').children[28]) {
        observeMut('.MuiGrid-root :nth-child(29) img', (m, o) => {
          if (m[0].target.src.startsWith('data:image')) {
            Overlay.$('.image-column').append(getImageDiv(m[0].target.src));
          }
        }, { attributeFilter: ['src'] })
      }
    }
    $('body').append(Overlay);
  }

  let w;
  async function copyWorkPassInfo() {
    const info = {
      id: getDataFromPage(14),
      name: getDataFromPage(15),
      dob: getDataFromPage(16)
    }
    await navigator.clipboard.writeText(JSON.stringify(info));
    if (w && !w.closed) {
      window.open('', 'mom-workpass-check');
    } else {
      w = window.open('https://service2.mom.gov.sg/workpass/enquiry/search', 'mom-workpass-check');
    }
  }

  function initPageThree() {
    buildUI();
    pageState = 3;
  }

  function goBackToPageOne() {
    if ($('body .custom-overlay')) {
      $('body .custom-overlay').remove();
    }
    if ($('#root > .MuiSnackbar-root')) {
      $('#root > .MuiSnackbar-root button').click();
    }
    $('.MuiButtonBase-root').click();
    if (pageState === 3) $('.MuiButtonBase-root').click();
  }

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Escape' || e.key === '`') {
      goBackToPageOne();
    }
  });
}, { runAsContentScript: true });

mixin('link', `
  .custom-overlay {
    height: 100%;
    position: fixed;
    inset: 0;
    padding: 16px;
    background: rgba(0, 0, 0, .5);
  }
  .custom-dialog {
    position: relative;
    display: flex;
    height: 100%;
    border-radius: 12px;
    background: #EEE;
    overflow: hidden;
  }
  .btn-back {
    position: absolute;
    top: 16px;
    left: 16px;
    margin: 0;
  }
  .image-column {
    flex: 2;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    background: #BBB;
    gap: 1px;
  }
  .image-column>.img-wrapper {
    flex: 1;
    background: #DDD;
    overflow: hidden;
  }
  .image-column img {
    height: 0;
    min-height: 100%;
    width: 100%;
    object-fit: contain;
    image-orientation: from-image;
  }
  .info-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 24px;
  }
  .info-row {
    position: relative;
    margin: 10px 0;
  }
  .info-row>b {
    font-size: 14px;
  }
  .info-row>p {
    margin: 2px 0;
    font-size: 18px;
    font-family: system-ui;
  }
  .info-row>.btn-wp-check {
    position: absolute;
    top: 6px;
    left: 120px;
    margin: 0;
    padding: 0.5em 1em;
  }
  .dialog-footer {
    display: flex;
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 76px;
    padding: 16px;
    justify-content: flex-end;
    gap: 8px;
  }
  .dialog-footer>button {
    margin: 0;
  }
  .dialog-footer>button.btn-edit, .custom-dialog>.btn-back {
    color: rgb(255, 158, 27);
    background-color: #FFF;
  }
  .MuiSnackbar-root {
    height: 112px;
    background-color: transparent;
    pointer-events: none;
  }
  .MuiSnackbar-root > .MuiPaper-root {
    pointer-events: auto;
  }
`);

mixin("https://service2.mom.gov.sg", function () { if (Object.hasOwn(HTMLElement.prototype, "$")) return; const r = t => document.querySelector(t); Object.defineProperty(HTMLElement.prototype, "t", { value: function (t) { return this.querySelector(t) } }); let i; function e(t, n) { return t != null && t.id === n.id && t.i === n.i } async function t() { if (!document.hasFocus()) return; const t = await navigator.clipboard.readText(); try { if (t.length < 10) throw new Error; const n = JSON.parse(t); if (!n.id || !n.name || !n.i) { throw new Error } if (!e(i, n)) { i = n; c = false; if (location.href.endsWith("search") && r("main").firstElementChild) { h() } else if (location.href.endsWith("summary")) { r("[data-qa=summary_check_another_btn]").click() } } } catch (t) { } } window.addEventListener("focus", t); t(); let o = false, c = false; function a() { return new Promise(e => { if (r("#search_fin_input")) e(r("#search_fin_input")); const i = new MutationObserver(t => { for (const n of t) { if (n.addedNodes.length) { i.disconnect(); e(r("#search_fin_input")) } } }); i.observe(r(".MomCard__Body"), { childList: true }); r("input[type=radio]").click() }) } const s = new MutationObserver(t => { for (const n of t) { if (!n.addedNodes.length) continue; if (i && !c) { f() } } }); function f() { const t = r("#recaptcha iframe"); if (t) { const n = r("#recaptcha textarea"); if (!n || !n.value) { t.contentWindow.postMessage("clickRecaptcha", "*") } u() } } function u() { const t = r("#recaptcha textarea"); if (!t || !o) return; if (!t.value) { if (!Object.hasOwn(t, "value")) { t.o = t.value; Object.defineProperty(t, "value", { get: function () { return this.o }, set: function (t) { this.o = t; u() } }) } return } r("[data-qa=search_submit_btn]").click(); c = true } async function h() { if (c) return; const t = r("#search_date_of_birth_input"); const n = await a(); t.value = i.i; t.dispatchEvent(new Event("blur")); n.value = i.id; n.dispatchEvent(new Event("input")); o = true; f() } function l() { try { const t = r(".MomPageHeader__StickyBarWrapper strong").textContent.trim(); const e = t.split(" ").map(t => t.replace(/\*/g, "")); const n = i.name.split(" ").map((t, n) => t.startsWith(e[n])).reduce((t, n) => t && n); if (!n) throw new Error("Workpass name does not match!") } catch (t) { alert(t) } } function m(t) { const n = location.href; o = false; if (n.endsWith("prelanding")) { t.t("button").click(); t.t(".MomCard__Body").lastChild.t("button").click() } else if (n.endsWith("landing")) { t.t("button").click() } else if (n.endsWith("search")) { if (i) { h(); s.observe(r("#recaptcha"), { childList: true }) } } else if (n.endsWith("summary")) { l() } } const n = new MutationObserver(t => { for (const n of t) { if (!n.addedNodes.length || n.addedNodes[0].nodeType !== 1) continue; m(n.addedNodes[0]) } }); if (r("main").children.length) { m(r("main").firstElementChild) } n.observe(r("main"), { childList: true }) });
