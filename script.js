mixin('https://www.google.com/recaptcha/api2', function () {
    // document.documentElement.dispatchEvent(new MouseEvent('click'));
    $("#recaptcha-anchor div.recaptcha-checkbox-checkmark").click();
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
                if (location.href.endsWith('search') && $('main').firstElementChild) {
                    inputFormValues();
                }
            }
        } catch (_) {
            console.warn('Copied string is not of correct format!');
        }
    }
    window.addEventListener('focus', getWorkPassInfo);
    getWorkPassInfo();

    function waitForElemRender() {
        return new Promise((resolve) => {
            $('#mom-component--1').click();
            const isRendered = [false, true];
            const o = new MutationObserver((l) => {
                for (const m of l) {
                    if (m.addedNodes.length) {
                        if (m.target.classList.contains('MomCard__Body')) {
                            isRendered[0] = true;
                        } else if (m.target.id === 'recaptcha') {
                            isRendered[1] = true;
                        }
                    }
                }
                if (isRendered[0] && isRendered[1]) {
                    o.disconnect();
                    resolve();
                }
            });
            o.observe($('.MomCard__Body'), { childList: true });
            if (!$('#recaptcha iframe')) {
                isRendered[1] = false;
                o.observe($('#recaptcha'), { childList: true });
            }
        });
    }
    async function inputFormValues() {
        await waitForElemRender();
        const DOBInput = $('#search_date_of_birth_input');
        const FINInput = $('#search_fin_input');
        DOBInput.value = workPass.dob;
        DOBInput.dispatchEvent(new Event('blur'));
        FINInput.value = workPass.id;
        FINInput.dispatchEvent(new Event('input'));
        const CaptchaRes = $('#g-recaptcha-response');
        CaptchaRes._value = CaptchaRes.value;
        Object.defineProperty(CaptchaRes, 'value', {
            get: function () { return this._value; },
            set: function (v) {
                this._value = v;
                $('[data-qa=search_submit_btn]').click();
            }
        })
    }

    function onPageChange(page) {
        const url = location.href;
        if (url.endsWith('prelanding')) {
            page.$('button').click();
            page.$('.MomCard__Body').lastChild.$('button').click();
        } else if (url.endsWith('landing')) {
            page.$('button').click();
        } else if (url.endsWith('search')) {
            if (workPass) inputFormValues();
        } // TODO: implement after search
    }
    const mainObserver = new MutationObserver((m) => {
        if (!m[0].target.firstElementChild) return;
        onPageChange(m[0].target.firstElementChild);
    });
    // if children were added before mutation observer was even connected
    if ($('main').children.length) {
        onPageChange($('main').children[0]);
    }
    mainObserver.observe($('main'), { childList: true });
});