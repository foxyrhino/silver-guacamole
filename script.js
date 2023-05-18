mixin('link', async () => {
  // checks if script has already been run
  if (Object.hasOwn(HTMLElement.prototype, '$')) return;

  await import(chrome.runtime.getURL('modules/idb-keyval.js'));

  // useful utils
  const $ = (q) => document.querySelector(q);
  const $$ = (q) => document.querySelectorAll(q);
  Object.defineProperty(HTMLElement.prototype, '$', { value: function (q) { return this.querySelector(q) } });
  Object.defineProperty(HTMLElement.prototype, '$$', { value: function (q) { return this.querySelectorAll(q) } });
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

  // build all new UI elements first and attach to DOM
  let CustomOverlay, UploadBn;
  // construct custom overlay
  (function () {
    CustomOverlay = createElem('div', null, { className: 'custom-overlay' });
    CustomOverlay.innerHTML = `
      <div class="custom-dialog">
        <div class="image-column">
          <div class="image-wrapper"><img alt="" src="" draggable="false"></div>
          <div class="image-wrapper"><img alt="" src="" draggable="false"></div>
        </div>
        <div class="info-column"></div>
        <div class="dialog-footer">
          <button class="btn-edit css-17kvgbn">EDIT</button>
          <button class="btn-close css-17kvgbn">CLOSE</button>
        </div>
        <button class="btn-back css-17kvgbn">BACK</button>
      </div>
    `;
    CustomOverlay.$('.btn-back').onclick = goBackToPageOne;
    CustomOverlay.$('.btn-edit').onclick = () => {
      CustomOverlay.hide();
      window.scrollTo(0, $('.MuiGrid-root').children[14].offsetTop);
      $('.MuiGrid-root').children[25].$('button').click();
    };
    CustomOverlay.$('.btn-close').onclick = () => CustomOverlay.hide();
    CustomOverlay.$$('.image-wrapper').forEach((elem) => {
      let isMouseDown = false, isDragging = false;
      let x = 0, y = 0, prevX = 0, prevY = 0;
      let tX = 0, tY = 0, scale = 1, rotate = 0;
      Object.defineProperty(elem, 'reset', {value: function () {
        tX = 0, tY = 0, scale = 1, rotate = 0;
        this.firstElementChild.style = '';
        this.firstElementChild.src = '';
      }});
      elem.oncontextmenu = (e) => e.preventDefault();
      elem.onmousemove = (e) => {
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
      };
      elem.onmousewheel = (e) => {
        e.preventDefault();
        scale *= e.deltaY > 0 ? 0.8 : 1.25;
        if (scale < 0.512) scale = 0.512;
        elem.firstElementChild.style.scale = scale;
      };
      elem.onmousedown = (e) => { e.preventDefault(); isMouseDown = true; };
      elem.onmouseup = (e) => {
        isMouseDown = false;
        if (isDragging) {
          isDragging = false;
          return;
        }
        if (e.which == 2) {
          elem.reset();
          return;
        } else if (e.which == 1) {
          rotate -= 1; if (rotate == -1) rotate = 3;
        } else if (e.which == 3) {
          rotate += 1; if (rotate == 4) rotate = 0;
        }
        elem.firstElementChild.style.rotate = `${rotate * 90}deg`;
      };
      elem.onmouseleave = (e) => { isDragging = false; isMouseDown = false; };
    });
    Object.defineProperty(CustomOverlay, 'reset', {value: function () {
      this.$('.info-column').innerHTML = '';
      this.$$('.image-wrapper').forEach((i) => i.reset());
    }});
    Object.defineProperty(CustomOverlay, 'updateImage', {value: function (position, src) {
      this.$$('.image-wrapper>img')[position].src = src;
    }});
    Object.defineProperty(CustomOverlay, 'updateInfo', {value: function (info) {
      this.$('.info-column').innerHTML = Object.entries(info).map((x) => {
        return `<div class="info-row"><b>${x[0]}</b><p>${x[1]}</p></div>`;
      }).join('');
    }});
    Object.defineProperty(CustomOverlay, 'show', { value: function () { this.classList.add('show'); } });
    Object.defineProperty(CustomOverlay, 'hide', { value: function () { this.classList.remove('show'); this.reset(); } });
    $('body').append(CustomOverlay);
  })();

  // handle reading of excel file and saving it in idb
  function onUpload() {
  
  }

  // get mobile number from clipboard automatically
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

  // automatically submit form if there is a new number from clipboard
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

  // Handle page changes
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
  // on first load, the main container isn't inserted yet, so we need to wait for the elem to be inserted
  const pageObserver = new MutationObserver((l) => onPageChange(l[0].target.firstElementChild));
  observeMut('#root', (m) => {
    if ($('#root > .MuiContainer-root')) {
      pageObserver.observe($('.MuiContainer-root'), { childList: true });
      onPageChange($('.MuiContainer-root').firstElementChild);
    }
  });

  function initPageOne() {
    showUploadBn();
    const TTInput = $('.MuiGrid-root').children[1].$('[role=button]');
    const IDInput = $('.MuiGrid-root').children[5].$('input');
    const SubmitBn = $('.MuiGrid-root').lastChild.$('button');
    IDInput.addEventListener('input', (e) => {
      if (e.target.value.trim().length == 8 && !isNaN(+e.target.value)) setTimeout(() => SubmitBn.click(), 60);
    });
    pageState = 1;
    if (TTInput.nextSibling.value !== 'REGPORT,REG,CHGOWN') {
      TTInput.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      observeMutOnce('.MuiPopover-root ul', (m) => {
        const DList = m[0].target;
        if (DList.children.length) {
          DList.$$('[aria-selected=true]').forEach((e) => e.click());
          DList.$$('[data-value=REGPORT], [data-value=REG], [data-value=CHGOWN]').forEach((e) => e.click());
          $('.MuiPopover-root > .MuiBackdrop-root').click();
        }
      });
    }
    inputNewMobile();
  }

  function initPageTwo() {
    if (pageState === 1) {
      hideUploadBn();
      const ViewBn = $('.MuiPaper-root tbody button');
      ViewBn.click();
    }
    pageState = 2;
  }

  function initPageThree() {
    pageState = 3;
    getInfo();
  }

  function goBackToPageOne() {
    CustomOverlay.hide();
    if ($('#root > .MuiSnackbar-root')) {
      $('#root > .MuiSnackbar-root button').click();
    }
    $('.MuiButtonBase-root').click();
    if (pageState === 3) $('.MuiButtonBase-root').click();
  }

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Escape' || e.key === '`') goBackToPageOne();
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
        // edits => for example [1,1,0,0], with the order being name, id, dob and nationality
        // rejectReason => a string for reason of rejection
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

  function showUploadBn() {
    if (UploadBn) {
      
      return;
    }
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

  // TODO: Account for Transfer for Ownership (has both old and new customer details), Number Port Request (extra row of port in numbers), and special case of corporate account
  const dataStrings = ['Time', 'ID', 'Name', 'DOB', 'Nationality', 'Local Count', 'Retrieved From MyInfo'];
  const dataIndexes = [1, 14, 15, 16, 17, 21, 22];
  const getDataFromPage = (i) => $('.MuiGrid-root').children[i].$('p').textContent.trim();

  let transactionInfo = []; // date, transaction type, account type
  let customerInfo = []; // id, name, dob, nationality, local count, retrieved from myInfo
  let customerIdType = ''; // 'NRIC No.', 'PASSPORT No.' or 'WORKP No.'
  let imageSrcs = [];

  const getInfoFromCell = (e) => e.$('p').textContent.trim();
  const getHeadingFromCell = (e) => e.$('label').textContent.trim();
  function getInfo() {
    if (pageState !== 3) return;
    const cells = $('.MuiGrid-root').children;
    const info = {};
    info['Transaction Date Time'] = getInfoFromCell(cells[1]);
    let i = cells.length - 1, imgPos = 1;
    while (imgPos >= 0 && cells[i].$('img')) {
      const img = cells[i].$('img');
      if (img.src.startsWith('data:image') {
        CustomOverlay.updateImage(imgPos, img.src);
      } else {
        observeMut(img, (l, o) => {
          for (const m of l) {
            if (m.target.src.startsWith('data:image') {
              CustomOverlay.updateImage(imgPos, m.target.src);
              o.disconnect();
            }
          }
        }, { attributeFilter: ['src'] });
      }
      imgPos--;
      i--;
    }
    transactionInfo = { date: getInfoFromCell(1), transType: getInfoFromCell(2), accountType = getInfoFromCell(3) };
    CustomOverlay.show();
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
}, { runAsContentScript: true });

mixin('link', `
  .btn-upload, .custom-overlay {
    display: none;
  }
  .btn-upload.show {
    display: inline-flex;
  }
  .custom-overlay {
    height: 100%;
    position: fixed;
    inset: 0;
    padding: 16px;
    background: rgba(0, 0, 0, .5);
  }
  .custom-overlay.show {
    display: block;
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
  .image-column>.image-wrapper {
    flex: 1;
    background: #DDD;
    overflow: hidden;
    display: none;
  }
  /* This is big brain time */
  .image-column>.image-wrapper:has(img[src^="data:image"]) {
    display: block;
  }
  .image-wrapper>img {
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

mixin("https://service2.mom.gov.sg",(function(){if(Object.hasOwn(HTMLElement.prototype,"$"))return;const t=t=>document.querySelector(t);let e;async function n(){if(!document.hasFocus())return;const n=await navigator.clipboard.readText();try{if(n.length<10)throw new Error;const r=JSON.parse(n);if(!r.id||!r.name||!r.dob)throw new Error;i=r,(null==(a=e)||a.id!==i.id||a.dob!==i.dob)&&(e=r,o=!1,location.href.endsWith("search")&&t("main").firstElementChild?s():location.href.endsWith("summary")&&t("[data-qa=summary_check_another_btn]").click())}catch(t){}var a,i}Object.defineProperty(HTMLElement.prototype,"$",{value:function(t){return this.querySelector(t)}}),window.addEventListener("focus",n),n();let a=!1,o=!1;const i=new MutationObserver((t=>{for(const n of t)n.addedNodes.length&&e&&!o&&r()}));function r(){const e=t("#recaptcha iframe");if(e){const n=t("#recaptcha textarea");n&&n.value||e.contentWindow.postMessage("clickRecaptcha","*"),c()}}function c(){const e=t("#recaptcha textarea");e&&a&&(e.value?(t("[data-qa=search_submit_btn]").click(),o=!0):Object.hasOwn(e,"value")||(e._value=e.value,Object.defineProperty(e,"value",{get:function(){return this._value},set:function(t){this._value=t,c()}})))}async function s(){if(o)return;const n=t("#search_date_of_birth_input"),i=await new Promise((e=>{t("#search_fin_input")&&e(t("#search_fin_input"));const n=new MutationObserver((a=>{for(const o of a)o.addedNodes.length&&(n.disconnect(),e(t("#search_fin_input")))}));n.observe(t(".MomCard__Body"),{childList:!0}),t("input[type=radio]").click()}));n.value=e.dob,n.dispatchEvent(new Event("blur")),i.value=e.id,i.dispatchEvent(new Event("input")),a=!0,r()}function d(n){const o=location.href;a=!1,o.endsWith("prelanding")?(n.$("button").click(),n.$(".MomCard__Body").lastChild.$("button").click()):o.endsWith("landing")?n.$("button").click():o.endsWith("search")?e&&(s(),i.observe(t("#recaptcha"),{childList:!0})):o.endsWith("summary")&&function(){try{const n=t(".MomPageHeader__StickyBarWrapper strong").textContent.trim().split(" ").map((t=>t.replace(/\*/g,"")));if(!e.name.split(" ").map(((t,e)=>t.startsWith(n[e]))).reduce(((t,e)=>t&&e)))throw new Error("Workpass name does not match!")}catch(t){alert(t)}}()}const h=new MutationObserver((t=>{for(const e of t)e.addedNodes.length&&1===e.addedNodes[0].nodeType&&d(e.addedNodes[0])}));t("main").children.length&&d(t("main").firstElementChild),h.observe(t("main"),{childList:!0})}));