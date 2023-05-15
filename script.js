
mixin('put-link-here', `
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
    padding: 60px 16px;
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
    height: 60px;
    padding: 8px 16px;
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

mixin('put-link-here', function() {
  // checks if script has already been run
  if (Object.hasOwn(HTMLElement.prototype, '$')) return;
  const $ = (q) => document.querySelector(q);
  Object.defineProperty(HTMLElement.prototype, '$', {
    value: function(q) {
      return this.querySelector(q)
    }
  });

  function createElem(q, t, a) {
    const e = document.createElement(q);
    if (t) {
      const c = document.createTextNode(t);
      e.append(c);
    }
    if (a) {
      for (const [k, v] of Object.entries(a)) {
        e[k] = v;
      }
    }
    return e;
  }

  function observeMut(q, fn, attrs) {
    const o = new MutationObserver(fn);
    o.observe($(q), attrs || {
      childList: true
    });
  }

  function observeMutOnce(q, fn, attrs) {
    const o = new MutationObserver((m, o) => {
      fn(m, o);
      o.disconnect();
    });
    o.observe($(q), attrs || {
      childList: true
    });
  }

  const onPageChange = (mList) => {
    const m = mList[0];
    if (m.target.firstChild.classList.contains('MuiGrid-root')) {
      initPageOne();
    } else if (m.target.firstChild.classList.contains('MuiPaper-root')) {
      initPageTwo();
    } else if (m.target.firstChild.tagName === 'FORM') {
      initPageThree();
    }
  };
  const pageObserver = new MutationObserver(onPageChange);
  observeMut('#root', (m) => {
    if ($('#root > .MuiContainer-root')) {
      pageObserver.observe($('.MuiContainer-root'), {
        childList: true
      });
      onPageChange([{
        target: $('.MuiContainer-root')
      }]);
    }
  });

  function initPageOne() {
    const TTInput = $('.MuiGrid-root').children[1].$('[role=button]');
    const IDInput = $('.MuiGrid-root').children[5].$('input');
    const SubmitBn = $('.MuiGrid-root').lastChild.$('button');
    IDInput.addEventListener('input', (e) => {
      if (e.target.value.trim().length == 8 && !isNaN(+e.target.value)) {
        setTimeout(() => SubmitBn.click(), 100);
      }
    })
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
  }

  function initPageTwo() {
    const ViewBn = $('.MuiPaper-root tbody button');
    pageState = 2;
    ViewBn.click();
  }

  function addCopyBn(elem) {
    elem.style.position = 'relative';
    const copyText = elem.$('p').textContent.trim();
    const bn = createElem('button', 'Copy', {
      type: 'button',
      className: 'css-17kvgbn',
      style: 'position:absolute;top:16px;right:16px;padding:0.5rem 1.2rem',
      onclick: function() {
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
        scale -= e.deltaY / 500;
        elem.firstElementChild.style.scale = scale;
      },
      onmousedown: (e) => {
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
    const Overlay = createElem('div', 0, {
      className: 'custom-overlay',
    });
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
            ImgDiv.firstElementChild.style.scale = 0.75;
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
    pageState = 3;
    buildUI();
  }

  function goBackToPageOne() {
   if ($('body .custom-overlay')) {
      $('body .custom-overlay').remove();
    }
    if ($('#root > .MuiSnackbar-root')) {
      $('#root > .MuiSnackbar-root button').click();
    }
    $('.MuiButtonBase-root').click();
    $('.MuiButtonBase-root').click();
  }

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Escape' || e.key === '`') {
      goBackToPageOne();
    }
  });
});

mixin('https://service2.mom.gov.sg', function() {
  // checks if script has already been run
  if (Object.hasOwn(HTMLElement.prototype, '$')) return;
  const $ = (q) => document.querySelector(q);
  Object.defineProperty(HTMLElement.prototype, '$', {
    value: function(q) {
      return this.querySelector(q)
    }
  });

  // {"id":"G1234567K","name":"John Doe","dob":"01 Jan 1997"}
  let workPass;

  function isWorkPassEqual(a, b) {
    return a != null && a.id === b.id && a.dob === b.dob;
  }
  async function getWorkPassInfo() {
    if (!document.hasFocus()) return;
    const cbText = await navigator.clipboard.readText();
    try {
      if (cbText.length < 10) throw new Error();
      const newWorkPass = JSON.parse(cbText);
      if (!isWorkPassEqual(workPass, newWorkPass)) {
        workPass = newWorkPass;
        formSubmitted = false;
        if (location.href.endsWith('search') && $('main').firstElementChild) {
          inputFormValues();
        } else if (location.href.endsWith('summary')) {
          $('[data-qa=summary_check_another_btn]').click();
        }
      }
    } catch (_) {
      // console.warn('Copied string is not of correct format!');
    }
  }
  window.addEventListener('focus', getWorkPassInfo);
  getWorkPassInfo();

  let formHasValues = false,
    formSubmitted = false;

  function getFINInput() {
    return new Promise((resolve) => {
      if ($('#search_fin_input')) resolve($('#search_fin_input'));
      const o = new MutationObserver((l) => {
        for (const m of l) {
          if (m.addedNodes.length) {
            o.disconnect();
            resolve($('#search_fin_input'));
          }
        }
      });
      o.observe($('.MomCard__Body'), {
        childList: true
      });
      $('input[type=radio]').click();
    });
  }
  const recaptchaObserver = new MutationObserver((l) => {
    for (const m of l) {
      if (!m.addedNodes.length) continue;
      if (workPass && !formSubmitted) {
        clickRecaptcha();
      }
    }
  });

  function clickRecaptcha() {
    const f = $('#recaptcha iframe');
    if (f) {
      const CaptchaRes = $('#recaptcha textarea');
      if (!CaptchaRes || !CaptchaRes.value) {
        f.contentWindow.postMessage('clickRecaptcha', '*');
      }
      tryToSubmitForm();
    }
  }

  function tryToSubmitForm() {
    const CaptchaRes = $('#recaptcha textarea');
    if (!CaptchaRes || !formHasValues) return;
    if (!CaptchaRes.value) {
      if (!Object.hasOwn(CaptchaRes, 'value')) {
        CaptchaRes._value = CaptchaRes.value;
        Object.defineProperty(CaptchaRes, 'value', {
          get: function() {
            return this._value;
          },
          set: function(v) {
            this._value = v;
            tryToSubmitForm();
          }
        });
      }
      return;
    }
    $('[data-qa=search_submit_btn]').click();
    formSubmitted = true;
  }
  async function inputFormValues() {
    if (formSubmitted) return;
    const DOBInput = $('#search_date_of_birth_input');
    const FINInput = await getFINInput();
    DOBInput.value = workPass.dob;
    DOBInput.dispatchEvent(new Event('blur'));
    FINInput.value = workPass.id;
    FINInput.dispatchEvent(new Event('input'));
    formHasValues = true;
    clickRecaptcha();
  }

  function checkWorkPassName() {
    try {
      const raw = $('.MomPageHeader__StickyBarWrapper strong').textContent.trim();
      const words = raw.split(' ').map((w) => w.replace(/\*/g, ''));
      const isValid = workPass.name.split(' ').map((w, i) => w.startsWith(words[i])).reduce((a, b) => a && b);
      if (!isValid) throw new Error('Workpass name does not match!');
    } catch(e) {
      alert(e);
    }
  }

  function onPageChange(page) {
    const url = location.href;
    formHasValues = false;
    if (url.endsWith('prelanding')) {
      page.$('button').click();
      page.$('.MomCard__Body').lastChild.$('button').click();
    } else if (url.endsWith('landing')) {
      page.$('button').click();
    } else if (url.endsWith('search')) {
      if (workPass) {
        inputFormValues();
        recaptchaObserver.observe($('#recaptcha'), {
          childList: true
        });
      }
    } else if (url.endsWith('summary')) {
      checkWorkPassName();
    }
  }
  const mainObserver = new MutationObserver((l) => {
    for (const m of l) {
      if (!m.addedNodes.length || m.addedNodes[0].nodeType !== 1) continue;
      onPageChange(m.addedNodes[0]);
    }
  });
  // if children were added before mutation observer was even connected
  if ($('main').children.length) {
    onPageChange($('main').firstElementChild);
  }
  mainObserver.observe($('main'), {
    childList: true
  });
});