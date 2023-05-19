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
      if (!newWorkPass.id || !newWorkPass.name || !newWorkPass.dob) {
        throw new Error();
      }
      if (!isWorkPassEqual(workPass, newWorkPass)) {
        workPass = newWorkPass;
        formSubmitted = false;
        if (location.href.endsWith('search') && $('main').firstElementChild) {
          inputFormValues();
        } else if (location.href.endsWith('summary')) {
          $('[data-qa=summary_check_another_btn]').click();
        }
      }
    } catch (_) {}
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