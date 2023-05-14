window.addEventListener('message', function (e) {
    if (e.origin === 'https://service2.mom.gov.sg' && e.data === 'clickRecaptcha') {
        document.querySelector(".recaptcha-checkbox-checkmark").click();
    }
});