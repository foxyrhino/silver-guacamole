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
  function observeMut(q, fn, attrs = { childList: true }) {
    const o = new MutationObserver(fn);
    o.observe(typeof q === 'string' ? $(q) : q, attrs);
  }
  function observeMutOnce(q, fn, attrs = { childList: true }) {
    const o = new MutationObserver((m, o) => { fn(m, o); o.disconnect(); });
    o.observe(typeof q === 'string' ? $(q) : q, attrs);
  }

  // All of data handling is in this class
  class Database {
    #hasData = true;
    #stats;

    // Get countryOrder, activeIndex and totalCount
    async getStats() {
      if (this.#stats) return this.#stats;
      if (!this.#hasData) return null;
      const v = await idbKeyval.getMany(['countryOrder', 'activeIndex', 'totalCount']);
      if (v[0] == null) {
        this.#hasData = false;
        return null;
      }
      this.#stats = { countryOrder: v[0], activeIndex: v[1], totalCount: v[2] };
      return this.#stats;
    }

    // Uploads excel rows into idb keyval store
    async uploadData(rows) {
      let headerSize = 0;
      while (!(rows[headerSize][0] instanceof Date)) {
        headerSize++;
      }
      rows.splice(0, headerSize);
      const rowsToSet = Array(rows.length); // setMany will use this as its first param
      const rowsToUpdate = []; // array of [index, updateFn];
      const mobileMap = new Map(); // key: mobile number, value: idbkey
      const idAndNameMap = new Map(); // key: ID+Name, value: idbkey
      const countryOrder = Array(rows.length); // array of [country, index], ordered like this to make sort easier
      for (let i = 0; i < rows.length; i++) {
        const id = rows[i][7];
        const val = {
          date: rows[i][0], // TODO: ensure date is in correct time zone, or convert to string
          mobile: rows[i][2],
          id,
          // additional fields:
          // extraMobilesIndexes => Array of idb indexes of extra mobile numbers of the same customer
          // extraIdsMap => Map of idb indexes (k) and extra IDs (v) of the customer, for the same mobile number
          // duplicate => this field is set during runtime, after user has chosen which ID is the correct one
          // verified => whether user has verified this number and customer
          // edits => for example [1,1,0,0], with the order being name, id, dob and nationality
          // rejectReason => a string for reason of rejection
        };
        if (rows[i][13] === 'YES') val.verified = true; // Auto verified if retrieved from myinfo
        if (mobileMap.has(val.mobile)) {
          const indexOfOriginal = mobileMap.get(val.mobile);
          rowsToUpdate.push([indexOfOriginal, (v) => {
            v.extraIdsMap ??= new Map();
            v.extraIdsMap.set(i, id);
            return v;
          }]);
        } else {
          mobileMap.set(val.mobile, i);
        }
        const idAndName = `${id}+${rows[i][8]}`;
        if (idAndNameMap.has(idAndName)) {
          const indexOfOriginal = idAndNameMap.get(idAndName);
          rowsToUpdate.push([indexOfOriginal, (v) => {
            v.extraMobilesIndexes ??= [];
            v.extraMobilesIndexes.push(i);
            return v;
          }]);
        } else {
          idAndNameMap.set(idAndName, i);
        }
        rowsToSet[i] = [i, val];
        countryOrder[i] = [rows[i][10], i];
        // idbKeyval.set(i, val);
      }
      await idbKeyval.setMany(rowsToSet);
      const promises = rowsToUpdate.map((args) => idbKeyval.update(...args));
      countryOrder.sort().forEach((e, i, arr) => arr[i] = e[1]);
      promises.push(idbKeyval.setMany([['countryOrder', countryOrder], ['activeIndex', 0], ['totalCount', rows.length]]));
      await Promise.all(promises);
      this.#hasData = true;
      this.#stats = { countryOrder, activeIndex: 0, totalCount: rows.length };
      return true;
    }

    // Downloads existing data in idb into a text file, which can be copied and pasted into excel
    // Only the last few columns are downloaded, those being edits, reject reasons and remarks
    async downloadData() {
      const { state } = await this.getNextEntry();
      if (state === 'NO DATA') return;
      if (state !== 'COMPLETED') alert('Not all rows have been checked! Unverified rows will be labelled UNVERIFIED in the Remarks column.');
      const indexes = Array.from({ length: this.#stats.totalCount }, (_, i) => i);
      const values = await idbKeyval.getMany(indexes);
      let text = '';
      for (const v of values) {
        if (!v.verified) {
          text += '\t'.repeat(6) + 'UNVERIFIED' + '\n';
          continue;
        }
        let rowText = '';
        rowText += v.edits ? v.edits.join('\t') + '\t' : '\t'.repeat(4);
        rowText += v.rejectReason ? `YES\t${v.rejectReason}\t` : '\t\t';
        if (v.duplicate) rowText += 'DUPLICATE';
        rowText = rowText.trimEnd();
        text += rowText + '\n';
      }
      text = text.trimEnd();
      const a = createElem('a', null, {
        download: 'data.txt',
        href: URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
      });
      a.click();
      URL.revokeObjectURL(a.href);
    }

    // returns an object containing the next custumer entry and state: { index, value, state }
    // state cound be either 'NO DATA' (when db is empty), or 'COMPLETED' (when all rows have been verified)
    async getNextEntry() {
      const stats = await this.getStats();
      if (!stats) return { state: 'NO DATA' };
      let i = stats.countryOrder[stats.activeIndex];
      let v = await idbKeyval.get(i);
      const activeIndexChanged = v.verified;
      while (v.verified) {
        if (stats.activeIndex >= stats.totalCount - 1) {
          await idbKeyval.set('activeIndex', stats.activeIndex);
          return { state: 'COMPLETED' };
        }
        i = stats.countryOrder[++stats.activeIndex];
        v = await idbKeyval.get(i);
      }
      if (activeIndexChanged) idbKeyval.set('activeIndex', stats.activeIndex);
      return { index: i, value: v, state: 'NORMAL' };
    }

    // Marks row with index i as verified, with params being edits, correctId or rejectReason
    // This will also check if there are any linked rows with same mobiles or ids, and verify them accordingly
    async markAsVerified(i, params = {}) {
      const v = await idbKeyval.get(i);
      if (v.verified) return;
      if (v.extraIdsMap && params.correctId == null) throw new Error('Please provide a correct ID!');
      const promises = [];
      if (v.extraIdsMap) {
        let correctIdFound = params.correctId === v.id;
        for (const [i, id] of v.extraIdsMap) {
          if (!correctIdFound && id === params.correctId) {
            promises.push(this.markAsVerified(i, { ...params, doNotChangeActiveIndex: true }));
            correctIdFound = true;
          } else promises.push(this.markAsDuplicate(i));
        }
        if (params.correctId !== v.id) {
          delete params.edits;
          v.duplicate = true;
        }
      }
      v.verified = true;
      if (params.rejectReason && !v.duplicate) v.rejectReason = params.rejectReason;
      if (params.edits) v.edits = params.edits;
      delete params.edits;
      promises.push(idbKeyval.update(i, (prev) => {
        if (prev.verified) return prev;
        return v;
      }));
      if (v.extraMobilesIndexes) for (const e of v.extraMobilesIndexes) promises.push(this.markAsVerified(e, { ...params, doNotChangeActiveIndex: true }));
      await Promise.all(promises);
      if (!params.doNotChangeActiveIndex) {
        await idbKeyval.set('activeIndex', ++this.#stats.activeIndex);
      }
      return true;
    }

    // Marks row with index i as verified and duplicate
    // This will also check if there are any linked rows with same mobiles
    async markAsDuplicate(i) {
      const v = await idbKeyval.get(i);
      if (v.verified) return;
      const promises = [idbKeyval.update(i, (v) => {
        v.duplicate = true;
        v.verified = true;
        return v;
      })];
      if (v.extraMobilesIndexes) for (const e of v.extraMobilesIndexes) promises.push(this.markAsDuplicate(e));
      await Promise.all(promises);
      return true;
    }
  }

  const db = new Database();

  // build all new UI elements first and attach to DOM
  let CustomOverlay, ShowCustomOverlayBn, UploadBn;
  // construct custom overlay and customOverlayBn
  (function () {
    let actualEditBn, actualIdCell;
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
      window.scrollTo(0, actualIdCell ? actualIdCell.offsetTop : 500);
      if (actualEditBn) actualEditBn.click();
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
      actualEditBn = null; actualIdCell = null;
    }});
    Object.defineProperty(CustomOverlay, 'setElementLocations', {value: function (edit, id) {
      actualEditBn = edit; actualIdCell = id;
    }});
    Object.defineProperty(CustomOverlay, 'updateImage', {value: function (position, src) {
      this.$$('.image-wrapper>img')[position].src = src;
    }});
    Object.defineProperty(CustomOverlay, 'updateInfo', {value: function (info) {
      this.$('.info-column').innerHTML = Object.entries(info).map((x) => {
        const row = `<div class="info-row"><b>${x[0]}</b><p>${x[1]}</p>${
          x[0].startsWith('WORKP')?'<button class="btn-wp-check css-17kvgbn">CHECK WORKPASS</button>':''
        }</div>`;
        return row;
      }).join('');
      const checkWpBn = this.$('.info-column .btn-wp-check');
      if (checkWpBn) checkWpBn.onclick = copyWorkPassInfo;
    }});
    Object.defineProperty(CustomOverlay, 'show', { value: function () { this.classList.add('show'); ShowCustomOverlayBn.hide(); }  });
    Object.defineProperty(CustomOverlay, 'hide', { value: function () { this.classList.remove('show'); ShowCustomOverlayBn.show(); } });
    ShowCustomOverlayBn = createElem('button', 'OPEN OVERLAY', { className: 'btn-open-overlay css-17kvgbn', onclick: () => CustomOverlay.show() });
    Object.defineProperty(ShowCustomOverlayBn, 'show', { value: function () { this.classList.add('show') } });
    Object.defineProperty(ShowCustomOverlayBn, 'hide', { value: function () { this.classList.remove('show'); } });
    $('body').append(CustomOverlay);
    $('body').append(ShowCustomOverlayBn);
  })();
  // construct upload button
  (function () {
    UploadBn = createElem('label', 'UPLOAD', { className: 'btn-upload css-17kvgbn' });
    const Input = createElem('input', null, {
      type: 'file',
      accept: '.xlsx',
      style: 'display:none',
      onchange: async (e) => {
        try {
          if (await idbKeyval.get(0)) {
            const result = confirm('This will delete any old data remaining. Proceed?');
            if (!result) return;
            await idbKeyval.clear();
          }
          if (!window.hasOwnProperty('readXlsxFile')) await import(chrome.runtime.getURL('modules/read-excel-file.js'));
          const rows = await readXlsxFile(e.target.files[0]);
          await db.uploadData(rows);
        } catch (e) { alert(e) };
      },
    });
    UploadBn.append(Input);
    Object.defineProperty(UploadBn, 'show', { value: function () { this.classList.add('show') } });
    Object.defineProperty(UploadBn, 'hide', { value: function () { this.classList.remove('show') } });
    $('body').append(UploadBn);
  })();

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
      pageOne();
    } else if (c.classList.contains('MuiPaper-root')) {
      pageTwo();
    } else if (c.tagName === 'FORM') {
      pageThree();
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

  function pageOne() {
    ShowCustomOverlayBn.hide();
    UploadBn.show();
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
  function pageTwo() {
    if (pageState === 1) {
      UploadBn.hide();
      const ViewBn = $('.MuiPaper-root tbody button');
      // TODO: once idb functionality is done, check date before clicking view
      ViewBn.click();
    }
    ShowCustomOverlayBn.hide();
    pageState = 2;
  }
  function pageThree() {
    pageState = 3;
    updateAndShowCustomOverlay();
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

  let wpInfo;
  // Retrieves information on page 3 for use in the custom overlay
  const getInfoFromCell = (e) => e.$('p').textContent.trim();
  const getHeadingFromCell = (e) => e.$('label').textContent.trim();
  function updateAndShowCustomOverlay() {
    if (pageState !== 3) return;
    CustomOverlay.reset();
    const cells = $('.MuiGrid-root').children;
    const info = {};
    info['Transaction Date Time'] = getInfoFromCell(cells[1]);
    let i = cells.length - 1, imgPos = 1;
    // get images
    while (imgPos >= 0 && cells[i].$('img')) {
      const img = cells[i].$('img');
      if (img.src.startsWith('data:image')) {
        CustomOverlay.updateImage(imgPos, img.src);
      } else {
        const currentImgPos = imgPos;
        observeMut(img, (l, o) => {
          for (const m of l) {
            if (m.target.src.startsWith('data:image')) {
              CustomOverlay.updateImage(currentImgPos, m.target.src);
              o.disconnect();
            }
          }
        }, { attributeFilter: ['src'] });
      }
      imgPos--;
      i--;
    }
    i -= imgPos === 1 ? 3 : 4;
    let idType, idCell;
    // Special case for corporate account
    if (getInfoFromCell(cells[3]) === 'Corporate') {
      info['Company Name'] = getInfoFromCell(cells[i-10]);
      idCell = cells[i-7];
      idType = getHeadingFromCell(idCell);
      info[idType] = getInfoFromCell(idCell);
      info['Customer Name'] = getInfoFromCell(cells[i-6]);
      info['DOB'] = getInfoFromCell(cells[i-5]);
      info['Nationality'] = getInfoFromCell(cells[i-4]);
    } else {
      idCell = cells[i-8];
      idType = getHeadingFromCell(idCell);
      info[idType] = getInfoFromCell(idCell);
      info['Name'] = getInfoFromCell(cells[i-7]);
      info['DOB'] = getInfoFromCell(cells[i-6]);
      info['Nationality'] = getInfoFromCell(cells[i-5]);
      info['Local Count'] = getInfoFromCell(cells[i-1]);
    }
    info['Retrieved from MyInfo'] = getInfoFromCell(cells[i]);
    wpInfo = null;
    if (idType.startsWith('WORKP')) {
      wpInfo = { id: info[idType], name: info.Name, dob: info.DOB };
    }
    CustomOverlay.setElementLocations(cells[i+3].$('button'), idCell);
    CustomOverlay.updateInfo(info);
    CustomOverlay.show();
  }

  let momWindow;
  async function copyWorkPassInfo() {
    if (!wpInfo) return;
    await navigator.clipboard.writeText(JSON.stringify(wpInfo));
    if (momWindow && !momWindow.closed) {
      window.open('', 'mom-workpass-check');
    } else {
      momWindow = window.open('https://service2.mom.gov.sg/workpass/enquiry/search', 'mom-workpass-check');
    }
  }
}, { runAsContentScript: true });

mixin('link', `
  .btn-upload, .btn-open-overlay, .custom-overlay {
    display: none;
  }
  .btn-upload, .btn-open-overlay {
    position: fixed;
    right: 16px;
    bottom: 16px;
  }
  .btn-upload.show, .btn-open-overlay.show {
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
    margin: 8px 0;
  }
  .info-row>b {
    font-size: 14px;
  }
  .info-row>p {
    margin: 1px 0;
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