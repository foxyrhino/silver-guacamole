mixin('https://example.com', function () {
    let w;
    async function copyWorkPassInfo() {
        console.log(w);
        const info = {
            id: `G${Math.floor(Math.random() * 9999999)}L`,
            name: 'John',
            dob: '11 Jan 1979'
        }
        await navigator.clipboard.writeText(JSON.stringify(info));
        this.textContent = 'Copied!';
        if (w && !w.closed) {
            window.open('', 'mom-workpass-check');
        } else {
            w = window.open('https://service2.mom.gov.sg/workpass/enquiry/search', 'mom-workpass-check');
        }
    }

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

    const bn = createElem('button', 'Copy Workpass', {
        onclick: copyWorkPassInfo,
    });
    document.querySelector('body').append(bn);
});

mixin('https://service2.mom.gov.sg', function () {
    // checks if script has already been run
    if (Object.hasOwn(HTMLElement.prototype, '$')) return;
    const $ = (q) => document.querySelector(q);
    Object.defineProperty(HTMLElement.prototype, '$', {
        value: function (q) { return this.querySelector(q) }
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
            const newWorkPass = JSON.parse(cbText);
            if (!isWorkPassEqual(workPass, newWorkPass)) {
                workPass = newWorkPass;
                formSubmitted = false;
                if (location.href.endsWith('search') && $('main').firstElementChild) {
                    inputFormValues();
                }
            }
        } catch (_) {
            // console.warn('Copied string is not of correct format!');
        }
    }
    window.addEventListener('focus', getWorkPassInfo);
    getWorkPassInfo();

    let formHasValues = false, formSubmitted = false;
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
            o.observe($('.MomCard__Body'), { childList: true });
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
            const CaptchaRes = $('#g-recaptcha-response');
            if (!CaptchaRes || !CaptchaRes.value) {
                f.contentWindow.postMessage('clickRecaptcha', '*');
            }
            tryToSubmitForm();
        }
    }
    function tryToSubmitForm() {
        const CaptchaRes = $('#g-recaptcha-response');
        if (!CaptchaRes || !formHasValues) return;
        if (!CaptchaRes.value) {
            if (!Object.hasOwn(CaptchaRes, 'value')) {
                CaptchaRes._value = CaptchaRes.value;
                Object.defineProperty(CaptchaRes, 'value', {
                    get: function () { return this._value; },
                    set: function (v) {
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
                recaptchaObserver.observe($('#recaptcha'), { childList: true });
            }
        } // TODO: implement after search
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
    mainObserver.observe($('main'), { childList: true });
});
