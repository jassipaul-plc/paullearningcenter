/* ============================================================================
 * marketing-kit.js — host-independent marketing & attribution kit
 *
 * Project-agnostic: all per-site settings live in window.MARKETING_CONFIG
 * (see marketing.config.js). No database, no server required — GA4/Meta
 * dashboards are the data store; attribution lives in first-party storage.
 *
 * Capabilities:
 *   1. Consent banner + Google Consent Mode v2 (opt-in or opt-out mode)
 *   2. Tag loading: GTM container, or direct GA4 (gtag.js) + Meta Pixel
 *   3. Attribution capture: utm_*, gclid, fbclid, referrer, landing page,
 *      first/last touch, anonymous visitor id — stored in localStorage
 *   4. Outbound conversion tracking: clicks to configured domains fire a
 *      conversion event with attribution attached, and the outbound URL is
 *      decorated (utm + ref + ref_vid) for downstream/closed-loop matching
 *   5. Lead tracking: forms marked data-mk-lead fire generate_lead;
 *      the thank-you page fires lead_complete
 *
 * Public API: window.MarketingKit =
 *   { getAttribution, track, consentStatus, resetConsent }
 * ==========================================================================*/
(function () {
  'use strict';

  var cfg = window.MARKETING_CONFIG || {};
  var CONSENT_KEY = 'mk_consent';
  var ATTR_KEY = 'mk_attribution';

  /* ---------- small helpers ---------- */

  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ }
  }
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  /* ---------- 3. attribution capture ---------- */

  function captureAttribution() {
    var attr = read(ATTR_KEY) || { visitor_id: uuid(), first_touch: null, last_touch: null };
    var p = new URLSearchParams(location.search);
    var touch = {
      utm_source: p.get('utm_source') || undefined,
      utm_medium: p.get('utm_medium') || undefined,
      utm_campaign: p.get('utm_campaign') || undefined,
      utm_content: p.get('utm_content') || undefined,
      utm_term: p.get('utm_term') || undefined,
      gclid: p.get('gclid') || undefined,
      fbclid: p.get('fbclid') || undefined,
      referrer: document.referrer || undefined,
      landing_page: location.pathname,
      ts: new Date().toISOString(),
    };
    var hasSignal = touch.utm_source || touch.gclid || touch.fbclid ||
      (touch.referrer && touch.referrer.indexOf(location.hostname) === -1);
    if (hasSignal) {
      attr.last_touch = touch;
      if (!attr.first_touch) attr.first_touch = touch;
      store(ATTR_KEY, attr);
    } else if (!read(ATTR_KEY)) {
      store(ATTR_KEY, attr); // persist visitor_id even on direct visits
    }
    return attr;
  }

  function flatAttribution() {
    var attr = read(ATTR_KEY) || {};
    var lt = attr.last_touch || {};
    return {
      visitor_id: attr.visitor_id,
      utm_source: lt.utm_source,
      utm_medium: lt.utm_medium,
      utm_campaign: lt.utm_campaign,
      gclid: lt.gclid,
      fbclid: lt.fbclid,
      landing_page: lt.landing_page,
    };
  }

  /* ---------- 1. consent (Google Consent Mode v2) ---------- */

  function consentStatus() {
    var saved = read(CONSENT_KEY);
    if (saved === 'granted' || saved === 'denied') return saved;
    return (cfg.consent && cfg.consent.mode === 'opt-in') ? 'pending' : 'default-granted';
  }

  function applyConsentDefaults() {
    var granted = consentStatus() === 'granted' || consentStatus() === 'default-granted';
    gtag('consent', 'default', {
      ad_storage: granted ? 'granted' : 'denied',
      ad_user_data: granted ? 'granted' : 'denied',
      ad_personalization: granted ? 'granted' : 'denied',
      analytics_storage: granted ? 'granted' : 'denied',
      wait_for_update: 500,
    });
  }

  function updateConsent(granted) {
    store(CONSENT_KEY, granted ? 'granted' : 'denied');
    var v = granted ? 'granted' : 'denied';
    gtag('consent', 'update', {
      ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v,
    });
    /* Meta doesn't read Google Consent Mode — tell the pixel directly, so a
       decline stops it even when it was loaded outside the kit. */
    if (window.fbq) window.fbq('consent', granted ? 'grant' : 'revoke');
    if (granted) loadTags();
    removeBanner();
  }

  function removeBanner() {
    var el = document.getElementById('mk-consent');
    if (el) el.remove();
  }

  function renderBanner() {
    var c = cfg.consent || {};
    if (!c.banner) return;
    if (read(CONSENT_KEY)) return; // already chose
    var wrap = document.createElement('div');
    wrap.id = 'mk-consent';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Cookie consent');
    wrap.innerHTML =
      '<style>' +
      '#mk-consent{position:fixed;bottom:1rem;left:1rem;right:1rem;max-width:26rem;margin:0 auto 0 0;' +
      'background:#fff;color:#1b2a28;border:1px solid #d8e4e1;border-radius:12px;' +
      'box-shadow:0 8px 30px rgba(27,42,40,.18);padding:1rem 1.1rem;z-index:9999;' +
      'font:0.9rem/1.5 "Nunito Sans","Segoe UI",system-ui,sans-serif}' +
      '#mk-consent p{margin:0 0 .8rem}' +
      '#mk-consent a{color:#0e7c6d}' +
      '#mk-consent .mk-row{display:flex;gap:.6rem}' +
      '#mk-consent button{border:0;border-radius:999px;cursor:pointer;font-weight:700;padding:.55rem 1.2rem}' +
      '#mk-consent .mk-accept{background:#14a08d;color:#fff}' +
      '#mk-consent .mk-decline{background:#edf4f2;color:#1b2a28}' +
      '</style>' +
      '<p>' + (c.message || 'We use cookies to understand site usage and measure advertising.') +
      (c.policyUrl ? ' <a href="' + c.policyUrl + '">Learn more</a>' : '') + '</p>' +
      '<div class="mk-row">' +
      '<button type="button" class="mk-accept">' + (c.acceptLabel || 'OK') + '</button>' +
      '<button type="button" class="mk-decline">' + (c.declineLabel || 'Decline') + '</button>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.querySelector('.mk-accept').addEventListener('click', function () { updateConsent(true); });
    wrap.querySelector('.mk-decline').addEventListener('click', function () { updateConsent(false); });
  }

  /* ---------- 2. tag loading ---------- */

  var tagsLoaded = false;

  function loadScript(src) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }

  function loadTags() {
    if (tagsLoaded) return;
    var status = consentStatus();
    if (status === 'denied' || status === 'pending') return;
    tagsLoaded = true;

    if (cfg.gtmId) {
      window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
      loadScript('https://www.googletagmanager.com/gtm.js?id=' + cfg.gtmId);
    } else {
      if (cfg.ga4Id) {
        loadScript('https://www.googletagmanager.com/gtag/js?id=' + cfg.ga4Id);
        gtag('js', new Date());
        gtag('config', cfg.ga4Id);
      }
      if (cfg.metaPixelId && !window.fbq) {
        /* Meta Pixel bootstrap (standard snippet, minified) */
        !(function (f, b, e, v, n, t, s) {
          if (f.fbq) return; n = f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
          };
          if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
          n.queue = []; t = b.createElement(e); t.async = !0; t.src = v;
          s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
        })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
        window.fbq('init', cfg.metaPixelId);
        window.fbq('track', 'PageView');
      }
    }
  }

  /* ---------- shared event API ---------- */

  /* Meta's standard events must go through fbq('track', …); anything else is
     a custom event. Sending a standard name via trackCustom would register it
     as a look-alike custom event that Meta can't optimise against. */
  var META_STANDARD = [
    'PageView', 'ViewContent', 'Search', 'AddToCart', 'AddToWishlist',
    'InitiateCheckout', 'AddPaymentInfo', 'Purchase', 'Lead',
    'CompleteRegistration', 'Contact', 'CustomizeProduct', 'Donate',
    'FindLocation', 'Schedule', 'StartTrial', 'SubmitApplication', 'Subscribe',
  ];

  function track(eventName, params) {
    var payload = Object.assign({ event: eventName }, flatAttribution(), params || {});
    window.dataLayer.push(payload);                       // GTM / GA4 route
    if (window.fbq) {                                     // direct Meta route
      var std = META_STANDARD.indexOf(eventName) !== -1;
      window.fbq(std ? 'track' : 'trackCustom', eventName, payload);
    }
  }

  /* ---------- 4. outbound conversion tracking ---------- */

  function matchConversionDomain(host) {
    var list = cfg.conversionDomains || [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i].domain;
      if (host === d || host.slice(-(d.length + 1)) === '.' + d) return list[i];
    }
    return null;
  }

  function decorateUrl(href) {
    try {
      var url = new URL(href);
      var dec = cfg.decorate || {};
      Object.keys(dec).forEach(function (k) {
        if (dec[k] && !url.searchParams.has(k)) url.searchParams.set(k, dec[k]);
      });
      var attr = read(ATTR_KEY);
      if (attr && attr.visitor_id && !url.searchParams.has('ref_vid')) {
        url.searchParams.set('ref_vid', attr.visitor_id);
      }
      return url.href;
    } catch (e) {
      return href;
    }
  }

  function initOutbound() {
    document.addEventListener(
      'click',
      function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!a) return;
        var url;
        try { url = new URL(a.href, location.href); } catch (e) { return; }

        /* same-site links: fire an event when the destination path matches */
        if (url.hostname === location.hostname) {
          var paths = cfg.internalClicks || [];
          for (var i = 0; i < paths.length; i++) {
            if (url.pathname.indexOf(paths[i].match) === 0) {
              track(paths[i].event, {
                link_path: url.pathname,
                link_page: location.pathname,
              });
              break;
            }
          }
          return;
        }

        var match = matchConversionDomain(url.hostname);
        if (!match) return;
        a.href = decorateUrl(a.href);
        /* a domain may map to several events — e.g. a granular click event
           for reporting plus a conversion event for ad optimisation */
        var names = [].concat(match.event || 'outbound_click');
        names.forEach(function (name) {
          track(name, { link_url: a.href, link_page: location.pathname });
        });
      },
      true // capture phase: runs before navigation starts
    );
  }

  /* ---------- 5. lead / form tracking ---------- */

  function initLeadTracking() {
    document.addEventListener('submit', function (ev) {
      var form = ev.target;
      if (form && form.matches && form.matches('form[data-mk-lead]')) {
        track('generate_lead', { form_id: form.id || form.getAttribute('name') || 'form' });
      }
    });
    if (cfg.thankYouPath && location.pathname === cfg.thankYouPath) {
      track('lead_complete', { page: location.pathname });
    }
  }

  /* ---------- boot ---------- */

  function boot() {
    captureAttribution();
    applyConsentDefaults();
    loadTags();
    renderBanner();
    initOutbound();
    initLeadTracking();
  }

  /* Clear a previous choice and show the banner again, so a visitor who
     declined can change their mind. Without this the decision is final and
     invisible — the tags simply never load and nothing explains why. */
  function resetConsent() {
    try { localStorage.removeItem(CONSENT_KEY); } catch (e) { /* private mode */ }
    var granted = consentStatus() === 'default-granted';
    if (window.fbq) window.fbq('consent', granted ? 'grant' : 'revoke');
    gtag('consent', 'update', {
      ad_storage: granted ? 'granted' : 'denied',
      ad_user_data: granted ? 'granted' : 'denied',
      ad_personalization: granted ? 'granted' : 'denied',
      analytics_storage: granted ? 'granted' : 'denied',
    });
    if (granted) loadTags();
    removeBanner();
    renderBanner();
  }

  window.MarketingKit = {
    getAttribution: function () { return read(ATTR_KEY); },
    track: track,
    consentStatus: consentStatus,
    resetConsent: resetConsent,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
