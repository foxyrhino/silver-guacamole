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

  class Cell {
    constructor(cellElem, editable) {
      this.cellElem = cellElem;
      this.editable = editable;
      this.heading = cellElem.$('label').textContent.trim();
      this.text = cellElem.$('p').textContent.trim();
    }
  }

  // build all new UI elements first and attach to DOM
  let CustomOverlay, ShowCustomOverlayBn, UploadBn;
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
  // construct custom overlay and customOverlayBn
  (function () {
    let momWindow, actualEditBn, cellList;
    async function copyWorkPassInfo() {
      if (!cellList) return;
      const wpInfo = {};
      for (const cell of cellList) {
        if (cell.heading === 'Name') wpInfo.name = cell.text;
        else if (cell.heading.startsWith('WORKP')) wpInfo.id = cell.text;
        else if (cell.heading === 'DOB') wpInfo.dob = cell.text;
      }
      await navigator.clipboard.writeText(JSON.stringify(wpInfo));
      if (momWindow && !momWindow.closed) {
        window.open('', 'mom-workpass-check');
      } else {
        momWindow = window.open('https://service2.mom.gov.sg/workpass/enquiry/search', 'mom-workpass-check');
      }
    }
    CustomOverlay = createElem('div', null, { className: 'custom-overlay' });
    CustomOverlay.innerHTML = `
      <div class="custom-dialog">
        <div class="image-column">
          <div class="image-wrapper"><img alt="" src="" draggable="false"></div>
          <div class="image-wrapper"><img alt="" src="" draggable="false"></div>
        </div>
        <div class="info-column"></div>
        <div class="dialog-footer">
          <button class="btn-edit css-17kvgbn"></button>
          <button class="btn-secondary css-17kvgbn"></button>
          <button class="btn-primary css-17kvgbn"></button>
        </div>
        <button class="btn-close">
          <svg viewBox="0 96 960 960">
            <path d="M480 664 300 844q-18 18-44 18t-44-18q-18-18-18-44t18-44l180-180-180-180q-18-18-18-44t18-44q18-18 44-18t44 18l180 180 180-180q18-18 44-18t44 18q18 18 18 44t-18 44L568 576l180 180q18 18 18 44t-18 44q-18 18-44 18t-44-18L480 664Z"/>
          </svg>
        </button>
      </div>
    `;
    CustomOverlay.$('.btn-close').onclick = () => CustomOverlay.hide();
    CustomOverlay.$('.btn-edit').onclick = () => {
      // CustomOverlay.startEdits();
      CustomOverlay.hide();
      window.scrollTo(0, cellList[1].cellElem.offsetTop);
      actualEditBn.click();
    }
    CustomOverlay.$('.btn-primary').onclick = () => {
      if (CustomOverlay.classList.contains('edit')) return CustomOverlay.finishEdits(true);
    };
    CustomOverlay.$('.btn-secondary').onclick = () => {
      if (CustomOverlay.classList.contains('edit')) return CustomOverlay.finishEdits(false);
    };
    CustomOverlay.$$('.image-wrapper').forEach((elem) => {
      let isMouseDown = false, isDragging = false;
      let x = 0, y = 0, prevX = 0, prevY = 0;
      let tX = 0, tY = 0, scale = 1, rotate = 0;
      Object.defineProperty(elem, 'reset', {
        value: function (removeSrc = true) {
          tX = 0, tY = 0, scale = 1, rotate = 0;
          this.firstElementChild.style = '';
          if (removeSrc) this.firstElementChild.src = '';
        }
      });
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
          elem.reset(false);
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
    Object.defineProperty(CustomOverlay, 'reset', {
      value: function () {
        this.classList.remove('edit');
        this.$('.info-column').innerHTML = '';
        this.$$('.image-wrapper').forEach((i) => i.reset());
        actualEditBn = null; cellList = null;
      }
    });
    const COUNTRIES = ["China","Malaysia","Philippines","Singapore","Afghanistan","Aland Islands","Albania","Algeria","American Samoa","Andorra","Angola","Anguilla","Antarctica","Antigua And Barbuda","Argentina","Armenia","Aruba","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bermuda","Bhutan","Bolivia","Bonaire, St. Eustatius, and Saba","Bosnia And Herzegowina","Botswana","Bouvet Island","Brazil","British Indian Ocean Territory","Brunei Darussalam","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde","Cayman Islands","Central African Republic","Chad","Chile","Christmas Island","Cocos (Keeling) Islands","Colombia","Comoros","Congo","Congo, The Democratic Republic Of The","Cook Islands","Costa Rica","Cote D'ivoire","Croatia (Local Name: Hrvatska)","Cuba","Curacao","Cyprus","Czech Republic","Denmark","Djibouti","Dominica","Dominican Republic","East Timor","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Ethiopia","Falkland Islands (Malvinas)","Faroe Islands","Fiji","Finland","France","France, Metropolitan","French Guiana","French Polynesia","French Southern Territories","Gabon","Gambia","Georgia","Germany","Ghana","Gibraltar","Greece","Greenland","Grenada","Guadeloupe","Guam","Guatemala","Guernsey","Guinea","Guinea-bissau","Guyana","Haiti","Heard And Mc Donald Islands","Holy See (Vatican City State)","Honduras","Hong Kong","Hungary","Iceland","India","Indonesia","Iran (Islamic Republic Of)","Iraq","Ireland","Isle Of Man","Israel","Italy","Jamaica","Japan","Jersey","Jordan","Kazakhstan","Kenya","Kiribati","Korea, Democratic People's Republic Of","Korea, Republic Of","Kosovo","Kuwait","Kyrgyzstan","Lao People's Democratic Republic","Latvia","Lebanon","Lesotho","Liberia","Libyan Arab Jamahiriya","Liechtenstein","Lithuania","Luxembourg","Macau","Macedonia, The Former Yugoslav Republic Of","Madagascar","Malawi","Maldives","Mali","Malta","Marshall Islands","Martinique","Mauritania","Mauritius","Mayotte","Mexico","Micronesia, Federated States Of","Moldova, Republic Of","Monaco","Mongolia","Montenegro","Montserrat","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","Netherlands Antilles","New Caledonia","New Zealand","Nicaragua","Niger","Nigeria","Niue","Norfolk Island","Northern Mariana Islands","Norway","Oman","Pakistan","Palau","Palestinian Terrorities","Panama","Papua New Guinea","Paraguay","Peru","Pitcairn","Poland","Portugal","Puerto Rico","Qatar","Reunion","Romania","Romania (ROU)","Russian Federation","Rwanda","Saint Barthelemy","Saint Kitts And Nevis","Saint Lucia","Saint Martin","Saint Vincent And The Grenadines","Samoa","San Marino","Sao Tome And Principe","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Sint Maarten","Slovakia (Slovak Republic)","Slovenia","Solomon Islands","Somalia","South Africa","South Georgia And The South Sandwich Islands","South Sudan","Spain","Sri Lanka","St. Helena","St. Pierre And Miquelon","Sudan","Suriname","Svalbard And Jan Mayen Islands","Swaziland","Sweden","Switzerland","Syrian Arab Republic","Taiwan, Province Of China","Tajikistan","Tanzania, United Republic Of","Thailand","Timor-Leste","Togo","Tokelau","Tonga","Trinidad And Tobago","Tunisia","Turkey","Turkmenistan","Turks And Caicos Islands","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United Nations","United States","United States Minor Outlying Islands","Uruguay","Uzbekistan","Vanuatu","Venezuela","Viet Nam","Virgin Islands (British)","Virgin Islands (U.S.)","Wallis And Futuna Islands","Western Sahara","Yemen","Yugoslavia","Zambia","Zimbabwe"];
    const countryIsValid = (v) => COUNTRIES.includes(v);
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const dateIsValid = (d) => {
      const [day, month, year] = d.split(' ');
      if (+day < 1 || +day > 31 || !months.includes(month.toLowerCase()) || +year < 1900 || + year > new Date().getFullYear()) return false;
      const monthDigit = months.indexOf(month.toLowerCase());
      const date = new Date(Date.parse(d));
      return +day === date.getDate() && monthDigit === date.getMonth() && +year === date.getFullYear();
    }
    Object.defineProperty(CustomOverlay, 'startEdits', {
      value: function () {
        this.classList.add('edit');
        const infoRows = this.$('.info-column').children;
        for (const i in cellList) {
          if (cellList[i].editable) infoRows[i].$('p').setAttribute('contenteditable', '');
        }
      }
    });
    Object.defineProperty(CustomOverlay, 'finishEdits', {
      value: function (saveChanges) {
        this.classList.remove('edit');
        if (!saveChanges) return this.updateCells(cellList, actualEditBn);
        this.$$('.info-row>p').forEach((p) => p.removeAttribute('contenteditable'));
      }
    });
    Object.defineProperty(CustomOverlay, 'updateImage', {
      value: function (position, src) {
        this.$$('.image-wrapper>img')[position].src = src;
      }
    });
    Object.defineProperty(CustomOverlay, 'updateCells', {
      value: function (cL, eB) {
        cellList = cL;
        actualEditBn = eB;
        this.$('.info-column').innerHTML = cL.map((c) => {
          return `<div class="info-row"><b>${c.heading}</b><p>${c.text}</p>${
            c.heading.startsWith('WORKP') ? '<button class="btn-wp-check css-17kvgbn">CHECK WORKPASS</button>' : ''
          }</div>`;
        }).join('');
        const wpCheckBn = this.$('.info-column .btn-wp-check');
        if (wpCheckBn) wpCheckBn.onclick = copyWorkPassInfo;
      }
    });
    Object.defineProperty(CustomOverlay, 'show', { value: function () { this.classList.add('show'); ShowCustomOverlayBn.hide(); } });
    Object.defineProperty(CustomOverlay, 'hide', { value: function () { this.classList.remove('show'); ShowCustomOverlayBn.show(); } });
    ShowCustomOverlayBn = createElem('button', 'OPEN OVERLAY', { className: 'btn-open-overlay css-17kvgbn', onclick: () => CustomOverlay.show() });
    Object.defineProperty(ShowCustomOverlayBn, 'show', { value: function () { this.classList.add('show') } });
    Object.defineProperty(ShowCustomOverlayBn, 'hide', { value: function () { this.classList.remove('show'); } });
    $('body').append(CustomOverlay);
    $('body').append(ShowCustomOverlayBn);
  })();

  function updateAndShowCustomOverlay() {
    if (pageState !== 3) return;
    CustomOverlay.reset();
    const cells = $('.MuiGrid-root').children;
    // const info = {};
    // info['Transaction Date Time'] = getInfoFromCell(cells[1]);
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
    const cellIndexes = [1, i-8, i-7, i-6, i-5, i-1, i];
    const cellEditable = [false, true, true, true, true, false, false];
    const accountTypeCell = new Cell(cells[3], false);
    // Special case for corporate account
    if (accountTypeCell.text === 'Corporate') {
      for (let a = 1; a < 5; a++) cellIndexes[a]++;
      cellIndexes.splice(1, 0, i-10);
      cellEditable.splice(1, 0, true);
    }
    const editBn = cells[i+3].$('button');
    CustomOverlay.updateCells(cellIndexes.map((v, i) => new Cell(cells[v], cellEditable[i])), editBn);
    CustomOverlay.show();
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
}, { runAsContentScript: true });

mixin('link', `
  .btn-upload, .btn-open-overlay, .custom-overlay {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1), opacity .1s, visibility .1s;
  }
  .btn-upload, .btn-open-overlay {
    display: inline-flex;
    position: fixed;
    right: 16px;
    top: 18px;
  }
  .btn-open-overlay {
    top: auto;
    bottom: 16px;
  }
  .custom-overlay {
    height: 100%;
    position: fixed;
    inset: 0;
    padding: 16px;
    background: rgba(0, 0, 0, .5);
    z-index: 100;
  }
  .custom-overlay.show, .btn-upload.show, .btn-open-overlay.show {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
  }
  .custom-dialog {
    position: relative;
    display: flex;
    height: 100%;
    border-radius: 12px;
    background: #EEE;
    overflow: hidden;
    transform: scale(.99);
    transition: transform .1s;
  }
  .custom-overlay.show .custom-dialog {
    transform: none;
  }
  .btn-close {
    all: unset;
    position: absolute;
    display: inline-block;
    top: 0px;
    right: 0px;
    padding: 8px;
    cursor: pointer;
  }
  .btn-close>svg {
    height: 28px;
    fill: rgba(0, 0, 0, .38);
    transition: .2s fill;
  }
  .btn-close:hover>svg {
    fill: rgba(0, 0, 0, .7);
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
    display: block;
    font-size: 14px;
  }
  .info-row>p {
    width: 100%;
    margin: 1px 0;
    padding: 0;
    font-size: 18px;
    font-family: system-ui;
  }
  .info-row>p[contenteditable] {
    border: 2px solid rgba(0,0,0,.12);
    border-radius: 4px;
    margin: 0 -4px;
    padding: 2px 4px;
    background: white;
  }
  .info-row>.btn-wp-check {
    position: absolute;
    top: 6px;
    left: 120px;
    margin: 0;
    padding: 0.5em 1em;
  }
  .edit .info-row>.btn-wp-check {
    display: none;
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
    transition: box-shadow .2s;
  }
  .dialog-footer .btn-primary {
    background-color: #4CAF50;
  }
  .dialog-footer .btn-primary::after {
    content: 'APPROVE';
  }
  .dialog-footer .btn-secondary {
    background-color: #F44336;
  }
  .dialog-footer .btn-secondary::after {
    content: 'REJECT';
  }
  .dialog-footer .btn-edit {
    background-color: rgb(255, 158, 27);
  }
  .dialog-footer .btn-edit::after {
    content: 'EDIT';
  }
  .edit .btn-edit {
    display: none;
  }
  .edit .dialog-footer .btn-primary {
    background-color: rgb(255, 158, 27);
  }
  .edit .dialog-footer .btn-primary::after {
    content: 'SAVE';
  }
  .edit .dialog-footer .btn-secondary {
    background-color: #FFF;
    color: rgb(255, 158, 27);
  }
  .edit .dialog-footer .btn-secondary::after {
    content: 'CANCEL';
  }
  .MuiSnackbar-root {
    height: 112px;
    background-color: transparent;
    pointer-events: none;
  }
  .MuiSnackbar-root>.MuiPaper-root {
    pointer-events: auto;
  }
`);

mixin("https://service2.mom.gov.sg",(function(){if(Object.hasOwn(HTMLElement.prototype,"$"))return;const t=t=>document.querySelector(t);let e;async function n(){if(!document.hasFocus())return;const n=await navigator.clipboard.readText();try{if(n.length<10)throw new Error;const r=JSON.parse(n);if(!r.id||!r.name||!r.dob)throw new Error;i=r,(null==(a=e)||a.id!==i.id||a.dob!==i.dob)&&(e=r,o=!1,location.href.endsWith("search")&&t("main").firstElementChild?s():location.href.endsWith("summary")&&t("[data-qa=summary_check_another_btn]").click())}catch(t){}var a,i}Object.defineProperty(HTMLElement.prototype,"$",{value:function(t){return this.querySelector(t)}}),window.addEventListener("focus",n),n();let a=!1,o=!1;const i=new MutationObserver((t=>{for(const n of t)n.addedNodes.length&&e&&!o&&r()}));function r(){const e=t("#recaptcha iframe");if(e){const n=t("#recaptcha textarea");n&&n.value||e.contentWindow.postMessage("clickRecaptcha","*"),c()}}function c(){const e=t("#recaptcha textarea");e&&a&&(e.value?(t("[data-qa=search_submit_btn]").click(),o=!0):Object.hasOwn(e,"value")||(e._value=e.value,Object.defineProperty(e,"value",{get:function(){return this._value},set:function(t){this._value=t,c()}})))}async function s(){if(o)return;const n=t("#search_date_of_birth_input"),i=await new Promise((e=>{t("#search_fin_input")&&e(t("#search_fin_input"));const n=new MutationObserver((a=>{for(const o of a)o.addedNodes.length&&(n.disconnect(),e(t("#search_fin_input")))}));n.observe(t(".MomCard__Body"),{childList:!0}),t("input[type=radio]").click()}));n.value=e.dob,n.dispatchEvent(new Event("blur")),i.value=e.id,i.dispatchEvent(new Event("input")),a=!0,r()}function d(n){const o=location.href;a=!1,o.endsWith("prelanding")?(n.$("button").click(),n.$(".MomCard__Body").lastChild.$("button").click()):o.endsWith("landing")?n.$("button").click():o.endsWith("search")?e&&(s(),i.observe(t("#recaptcha"),{childList:!0})):o.endsWith("summary")&&function(){try{const n=t(".MomPageHeader__StickyBarWrapper strong").textContent.trim().split(" ").map((t=>t.replace(/\*/g,"")));if(!e.name.split(" ").map(((t,e)=>t.startsWith(n[e]))).reduce(((t,e)=>t&&e)))throw new Error("Workpass name does not match!")}catch(t){alert(t)}}()}const h=new MutationObserver((t=>{for(const e of t)e.addedNodes.length&&1===e.addedNodes[0].nodeType&&d(e.addedNodes[0])}));t("main").children.length&&d(t("main").firstElementChild),h.observe(t("main"),{childList:!0})}));