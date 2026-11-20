// Overlay UI for the SoundCloud page: the left rail, the overlay window with
// its panels, the first-launch tour. Built as HTML/JS strings and injected on
// every page load (see injectPage in main.ts).
import { navIconSvg, type NavIconName } from '../shared/icons';
import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { setLanguage, t } from '../shared/i18n';
import { getStore } from './ipc';
import { logInfo, logWarn } from './logger';
import { runInPage } from './page';
import { injectAdBlockCSS } from './adblocker';
import { getAdblockerOverlayHTML, getAdblockerOverlayScript } from '../renderer/overlays/adblocker';
import { getAuthTokenOverlayHTML, getAuthTokenOverlayScript } from '../renderer/overlays/auth-token';
import { getGeoBypassOverlayHTML, getGeoBypassOverlayScript } from '../renderer/overlays/geo-bypass';
import { getDownloaderOverlayHTML, getDownloaderOverlayScript } from '../renderer/overlays/downloader';
import { getDiscordRpOverlayHTML, getDiscordRpOverlayScript } from '../renderer/overlays/discord-rp';
import { getSettingsOverlayHTML, getSettingsOverlayScript } from '../renderer/overlays/settings';
import { getHistoryOverlayHTML, getHistoryOverlayScript } from '../renderer/overlays/history';
import { getLyricsOverlayHTML, getLyricsOverlayScript } from '../renderer/overlays/lyrics';
import { getThemesOverlayHTML, getThemesOverlayScript } from '../renderer/overlays/themes';
import { getCustomCssOverlayHTML, getCustomCssOverlayScript } from '../renderer/overlays/custom-css';
import { getSidebarOverlayHTML, getSidebarOverlayScript } from '../renderer/overlays/sidebar';
import { getOfflineOverlayHTML, getOfflineOverlayScript } from '../renderer/overlays/offline';
import { getEqualizerOverlayHTML, getEqualizerOverlayScript } from '../renderer/overlays/equalizer';
import { getVisualizerScript } from '../renderer/overlays/visualizer';
import { getPlayerCoreScript } from '../renderer/overlays/player-core';
import { getDynamicAccentScript } from '../renderer/overlays/dynamic-accent';
import { getSearchPlusScript } from '../renderer/overlays/search-plus';
import { getExtrasScripts } from '../renderer/overlays/extras';
import { getPlayerToolsOverlayHTML, getPlayerToolsOverlayScript } from '../renderer/overlays/player-tools';

export function injectOverlaySystem(win: BrowserWindow): void {
  // Initialize language from store before generating any overlay HTML
  const store = getStore();
  if (store) {
    const lang = store.get('language') as 'en' | 'ru' | undefined;
    if (lang) setLanguage(lang);
  }

  // Inject overlay CSS via insertCSS
  const cssPath = path.join(__dirname, '../../assets/overlay.css');
  try {
    const css = fs.readFileSync(cssPath, 'utf-8');
    win.webContents.insertCSS(css);
  } catch (e: any) {
    logWarn('Could not load overlay CSS:', e?.message);
  }

  // Bundled Google Sans (inlined as base64 so it works from the https page).
  const fontsPath = path.join(__dirname, '../../assets/fonts.css');
  try {
    const fontsCss = fs.readFileSync(fontsPath, 'utf-8');
    win.webContents.insertCSS(fontsCss);
  } catch (e: any) {
    logWarn('Could not load bundled fonts:', e?.message);
  }

  // Inject ad-block CSS
  injectAdBlockCSS(win);

  // Inject overlay container and toggle logic
  const initScript = getOverlayInitScript();
  runInPage(win, initScript).catch((e: any) => logWarn('executeJS error:', e?.message));

  // Inject overlay panel contents
  injectOverlayPanels(win);

  // Welcome screen on first launch
  injectWelcomeScreen(win);
}


function injectWelcomeScreen(win: BrowserWindow): void {
  const store = getStore();
  if (!store) return;
  const isFirst = store.get('firstLaunch');
  logInfo('[Tour] firstLaunch value:', isFirst);
  if (isFirst === false) {
    logInfo('[Tour] Not first launch, skipping tour');
    return;
  }
  logInfo('[Tour] Showing welcome tour');

  const tourIcon = (pathData: string) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${pathData}"/></svg>`;

  // Brand mark in the user's accent colour; the "16" is knocked out with a mask
  // so it reads correctly on the blurred backplate instead of a hard-coded fill.
  const tourLogo = (() => {
    try {
      const svg = fs.readFileSync(path.join(__dirname, '../../assets/logo-mark.svg'), 'utf-8');
      return svg.replace('<svg ', '<svg class="sc-tour-logo" aria-hidden="true" focusable="false" ');
    } catch (err) {
      logWarn('[Tour] logo asset missing, using fallback icon:', err);
      return tourIcon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z');
    }
  })();

  // Static illustration of the left rail: expands on hover like the real one.
  const tourRailDemo = `
    <div class="sc-tour-demo">
      <div class="sc-tour-demo-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M17.5 2.5 5.5 14.5"/><path d="M5.5 8v6.5H12"/></svg>
      </div>
      <div class="sc-tour-demo-frame">
        <div class="sc-tour-demo-rail">
          <div class="sc-tour-demo-item is-active"><i></i><b></b></div>
          <div class="sc-tour-demo-item"><i></i><b></b></div>
          <div class="sc-tour-demo-item"><i></i><b></b></div>
          <div class="sc-tour-demo-item"><i></i><b></b></div>
          <div class="sc-tour-demo-item"><i></i><b></b></div>
        </div>
        <div class="sc-tour-demo-body">
          <div class="sc-tour-demo-line" style="width: 56%"></div>
          <div class="sc-tour-demo-line" style="width: 82%"></div>
          <div class="sc-tour-demo-line" style="width: 44%"></div>
          <div class="sc-tour-demo-line" style="width: 68%"></div>
        </div>
      </div>
      <div class="sc-tour-demo-hint">${t('tour.step2_hint')}</div>
    </div>
  `;

  const tourSteps = [
    {
      icon: tourLogo,
      title: t('tour.step1_title'),
      desc: t('tour.step1_desc'),
    },
    {
      icon: tourRailDemo,
      title: t('tour.step2_title'),
      desc: t('tour.step2_desc'),
    },
    {
      icon: tourIcon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 5.6l12.8 12.8'),
      title: t('tour.step3_title'),
      desc: t('tour.step3_desc'),
    },
    {
      icon: tourIcon('M12 3v11M7 10l5 5 5-5M5 20h14'),
      title: t('tour.step4_title'),
      desc: t('tour.step4_desc'),
    },
    {
      icon: tourIcon('M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.3-3.1 1.8 1.8 0 0 1 1.3-3.1H18a3 3 0 0 0 3-3A8.9 8.9 0 0 0 12 3ZM7 11h.01M8.5 7.5h.01M13 6h.01M17 9h.01'),
      title: t('tour.step5_title'),
      desc: t('tour.step5_desc'),
    },
    {
      icon: tourIcon('m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z'),
      title: t('tour.step6_title'),
      desc: t('tour.step6_desc'),
    },
  ];

  const tourHTML = `
    <div id="sc-welcome-overlay">
      <div class="sc-welcome-card">
        <div class="sc-welcome-progress"><span id="sc-tour-step">1</span>/6</div>
        <div class="sc-welcome-icon" id="sc-tour-icon">${tourSteps[0].icon}</div>
        <h2 class="sc-welcome-title" id="sc-tour-title">${tourSteps[0].title}</h2>
        <p class="sc-welcome-desc" id="sc-tour-desc">${tourSteps[0].desc}</p>
        <div class="sc-welcome-actions">
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-tour-skip">${t('tour.skip')}</button>
          <div style="display: flex; gap: 8px;">
            <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-tour-prev" style="display: none;">${t('tour.back')}</button>
            <button class="sc-overlay-btn sc-overlay-btn-primary" id="sc-tour-next">${t('tour.next')}</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const escaped = tourHTML.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  const stepsJson = JSON.stringify(tourSteps);

  runInPage(win, `
    (function() {
      if (document.getElementById('sc-welcome-overlay')) return;
      var steps = ${stepsJson};
      var currentStep = 0;

      var d = document.createElement('div');
      d.innerHTML = \`${escaped}\`;
      var overlay = d.firstElementChild;
      document.body.appendChild(overlay);

      var stepEl = document.getElementById('sc-tour-step');
      var iconEl = document.getElementById('sc-tour-icon');
      var titleEl = document.getElementById('sc-tour-title');
      var descEl = document.getElementById('sc-tour-desc');
      var nextBtn = document.getElementById('sc-tour-next');
      var prevBtn = document.getElementById('sc-tour-prev');
      var skipBtn = document.getElementById('sc-tour-skip');

      function updateStep() {
        stepEl.textContent = currentStep + 1;
        iconEl.innerHTML = steps[currentStep].icon;
        titleEl.textContent = steps[currentStep].title;
        descEl.textContent = steps[currentStep].desc;
        prevBtn.style.display = currentStep > 0 ? 'block' : 'none';
        nextBtn.textContent = currentStep === steps.length - 1 ? '${t('tour.get_started')}' : '${t('tour.next')}';
      }

      function finish() {
        overlay.style.animation = 'sc-welcome-fadeout 300ms ease-out forwards';
        setTimeout(function() { overlay.remove(); }, 300);
        if (window.sixteenCloud) {
          window.sixteenCloud.storeSet('firstLaunch', false);
        }
      }

      nextBtn.addEventListener('click', function() {
        if (currentStep < steps.length - 1) {
          currentStep++;
          updateStep();
        } else {
          finish();
        }
      });

      prevBtn.addEventListener('click', function() {
        if (currentStep > 0) {
          currentStep--;
          updateStep();
        }
      });

      skipBtn.addEventListener('click', finish);
    })();
  `).catch((e: any) => logWarn('executeJS error:', e?.message));
}

function getOverlayInitScript(): string {
  const icon = (name: NavIconName) => navIconSvg(name);

  // Grouped by purpose; a thin separator is drawn between groups.
  const NAV_ITEMS = [
    { id: 'player', group: 'player', icon: icon('player'), label: t('nav.player') },
    { id: 'lyrics', group: 'player', icon: icon('lyrics'), label: t('nav.lyrics') },
    { id: 'lyricsync', group: 'player', badge: 'BETA', icon: icon('lyricsync'), label: t('nav.lyricsync') },
    { id: 'equalizer', group: 'player', icon: icon('equalizer'), label: t('nav.equalizer') },
    { id: 'downloader', group: 'tools', icon: icon('downloader'), label: t('nav.downloader') },
    { id: 'offline-cache', group: 'tools', icon: icon('offline'), label: t('nav.offline') },
    { id: 'history', group: 'tools', icon: icon('history'), label: t('nav.history') },
    { id: 'geo-bypass', group: 'integrations', icon: icon('geo'), label: t('nav.geo_bypass') },
    { id: 'discord-rp', group: 'integrations', icon: icon('discord'), label: t('nav.discord_rp') },
    { id: 'adblocker', group: 'integrations', icon: icon('adblock'), label: t('nav.adblocker') },
    { id: 'auth-token', group: 'integrations', icon: icon('key'), label: t('nav.auth_token') },
    { id: 'themes', group: 'appearance', icon: icon('themes'), label: t('nav.themes') },
    { id: 'custom-css', group: 'appearance', icon: icon('css'), label: t('nav.custom_css') },
    { id: 'settings', group: 'settings', icon: icon('settings'), label: t('nav.settings') },
  ];

  const navHTML = NAV_ITEMS.map((n, i) =>
    (i > 0 && NAV_ITEMS[i - 1].group !== n.group ? '<div class="sc-nav-sep" role="separator" aria-hidden="true"></div>' : '') +
    `<div class="sc-nav-item" data-target="${n.id}" data-group="${n.group}" role="button" tabindex="0" aria-pressed="false" aria-controls="sc-panel-${n.id}"><span class="sc-nav-icon">${n.icon}${'badge' in n ? '<span class="sc-nav-beta-mark" aria-hidden="true">β</span>' : ''}</span><span class="sc-nav-label">${n.label}</span>${'badge' in n ? `<span class="sc-nav-beta">${n.badge}</span>` : ''}</div>`
  ).join('');

  const panelsHTML = NAV_ITEMS.map(n =>
    `<div class="sc-overlay-panel" id="sc-panel-${n.id}" data-overlay="${n.id}"></div>`
  ).join('');

  return `
    (function() {
      if (document.getElementById('sc-overlay-container')) return;

      // ---- Accent colour (single source of truth, used app-wide) ----
      // Derives the rgb triplet, hover shade and a WCAG-contrast foreground so
      // text on accent surfaces (badges, primary buttons) never vanishes.
      window.scApplyAccent = function(hex) {
        var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return;
        var raw = m[1];
        if (raw.length === 3) raw = raw[0]+raw[0]+raw[1]+raw[1]+raw[2]+raw[2];
        var r = parseInt(raw.slice(0,2), 16);
        var g = parseInt(raw.slice(2,4), 16);
        var b = parseInt(raw.slice(4,6), 16);
        var full = '#' + raw.toLowerCase();
        var lin = function(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        var lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        var mix = function(c, t) { return Math.round(c + (255 - c) * t); };
        var hover = '#' + [mix(r, 0.12), mix(g, 0.12), mix(b, 0.12)]
          .map(function(v) { return ('0' + v.toString(16)).slice(-2); }).join('');
        var st = document.documentElement.style;
        st.setProperty('--sc-accent', full);
        st.setProperty('--sc-accent-rgb', r + ', ' + g + ', ' + b);
        st.setProperty('--sc-accent-hover', hover);
        st.setProperty('--sc-focus', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.3)');
        st.setProperty('--sc-accent-foreground', lum > 0.55 ? '#0b0c0e' : '#ffffff');
        window.__scAccentColor = full;
      };

      // Re-apply the stored accent on every page load (not only when the
      // settings panel happens to be open).
      if (window.sixteenCloud && typeof window.sixteenCloud.storeGet === 'function') {
        window.sixteenCloud.storeGet('settings').then(function(s) {
          if (s && s.accentColor) window.scApplyAccent(s.accentColor);
        }).catch(function() {});
      }

      window.__scEscapeHtml = function(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, function(ch) {
          return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];
        });
      };

      // Replace native <select> widgets with the custom dropdown used in the
      // settings panel. The original <select> stays in the DOM (hidden) as the
      // source of truth, so existing value reads, change listeners and
      // programmatic value writes keep working untouched.
      window.__scEnhanceSelects = function(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var selects = scope.querySelectorAll('select');
        for (var i = 0; i < selects.length; i++) {
          (function(select) {
            if (select.dataset.scEnhanced) return;
            if (select.closest && select.closest('.sc-custom-dropdown')) return;
            select.dataset.scEnhanced = 'true';

            var wrap = document.createElement('div');
            wrap.className = 'sc-custom-dropdown';

            var trigger = document.createElement('div');
            trigger.className = 'sc-custom-dropdown-trigger';
            trigger.setAttribute('tabindex', '0');
            trigger.setAttribute('role', 'button');
            trigger.setAttribute('aria-haspopup', 'listbox');

            var label = document.createElement('span');
            label.className = 'sc-custom-dropdown-label';

            var arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            arrow.setAttribute('class', 'sc-custom-dropdown-arrow');
            arrow.setAttribute('width', '12');
            arrow.setAttribute('height', '12');
            arrow.setAttribute('viewBox', '0 0 12 12');
            var arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            arrowPath.setAttribute('fill', 'currentColor');
            arrowPath.setAttribute('d', 'M6 8L1 3h10z');
            arrow.appendChild(arrowPath);

            trigger.appendChild(label);
            trigger.appendChild(arrow);

            var menu = document.createElement('div');
            menu.className = 'sc-custom-dropdown-menu';
            menu.setAttribute('role', 'listbox');

            function sync() {
              var opts = select.options;
              var current = null;
              while (menu.firstChild) menu.removeChild(menu.firstChild);
              for (var o = 0; o < opts.length; o++) {
                (function(opt, index) {
                  var item = document.createElement('div');
                  item.className = 'sc-custom-dropdown-item';
                  item.setAttribute('data-value', opt.value);
                  item.setAttribute('role', 'option');
                  item.textContent = opt.textContent;
                  if (opt.selected) { current = opt; item.classList.add('selected'); }
                  item.addEventListener('click', function() {
                    select.value = opt.value;
                    close();
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                  });
                  menu.appendChild(item);
                })(opts[o], o);
              }
              label.textContent = current ? current.textContent : '';
              trigger.classList.toggle('sc-custom-dropdown-disabled', !!select.disabled);
              trigger.setAttribute('aria-expanded', wrap.classList.contains('open') ? 'true' : 'false');
            }

            function close() {
              wrap.classList.remove('open');
              trigger.setAttribute('aria-expanded', 'false');
            }
            function toggle() {
              if (select.disabled) return;
              var wasOpen = wrap.classList.contains('open');
              var open = document.querySelectorAll('.sc-custom-dropdown.open');
              for (var k = 0; k < open.length; k++) open[k].classList.remove('open');
              if (!wasOpen) {
                wrap.classList.add('open');
                trigger.setAttribute('aria-expanded', 'true');
                var sel = menu.querySelector('.sc-custom-dropdown-item.selected');
                if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
              }
            }

            trigger.addEventListener('click', function(e) { e.stopPropagation(); toggle(); });
            trigger.addEventListener('keydown', function(e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
              else if (e.key === 'Escape') close();
            });
            document.addEventListener('click', function(e) { if (!wrap.contains(e.target)) close(); });
            document.addEventListener('keydown', function(e) { if (e.key === 'Escape') close(); });

            // Keep the custom UI in sync with programmatic value/disabled writes.
            var proto = HTMLSelectElement.prototype;
            var valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
            var disabledDesc = Object.getOwnPropertyDescriptor(proto, 'disabled');
            if (valueDesc && valueDesc.set) {
              Object.defineProperty(select, 'value', {
                configurable: true,
                get: function() { return valueDesc.get.call(this); },
                set: function(v) { valueDesc.set.call(this, v); sync(); }
              });
            }
            if (disabledDesc && disabledDesc.set) {
              Object.defineProperty(select, 'disabled', {
                configurable: true,
                get: function() { return disabledDesc.get.call(this); },
                set: function(v) { disabledDesc.set.call(this, v); sync(); }
              });
            }
            select.addEventListener('change', sync);
            select.style.display = 'none';
            sync();

            if (select.parentNode) select.parentNode.insertBefore(wrap, select.nextSibling);
            wrap.appendChild(trigger);
            wrap.appendChild(menu);
          })(selects[i]);
        }
      };
      (function() {
        window.__scEnhanceSelects(document);
        if (window.MutationObserver) {
          var pending = false;
          var observer = new MutationObserver(function(mutations) {
            var hit = false;
            for (var i = 0; i < mutations.length && !hit; i++) {
              var added = mutations[i].addedNodes;
              for (var j = 0; j < added.length; j++) {
                var node = added[j];
                if (node.nodeType === 1 && (node.tagName === 'SELECT' || (node.querySelector && node.querySelector('select')))) {
                  hit = true;
                  break;
                }
              }
            }
            if (hit && !pending) {
              pending = true;
              setTimeout(function() {
                pending = false;
                window.__scEnhanceSelects(document);
              }, 100);
            }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
      })();
      window.__scIsTrustedSoundCloudUrl = function(value) {
        try {
          var u = new URL(String(value || ''));
          var h = u.hostname.toLowerCase().replace(/\\.$/, '');
          return u.protocol === 'https:' && (h === 'soundcloud.com' || h.endsWith('.soundcloud.com'));
        } catch (e) { return false; }
      };

      // Router-aware navigation. A hard location change reloads the whole
      // SoundCloud document, which stops playback and re-runs Cloudflare's
      // check; pushing the route keeps the running app intact. If the SPA
      // router ignores the route we fall back to a real navigation, so a
      // bookmark always ends up somewhere.
      window.__scNavigate = function(url) {
        try {
          if (!window.__scIsTrustedSoundCloudUrl(url)) return false;
          var target = new URL(String(url));
          // Close the drawer even when the target is the page we are already
          // on, so the click always feels acknowledged.
          if (typeof window.__scCloseSidebar === 'function') window.__scCloseSidebar();
          if (target.href === window.location.href) return true;
          if (target.origin !== window.location.origin) {
            window.location.assign(target.href);
            return true;
          }
          var beforeHref = window.location.href;
          var beforeTitle = document.title;
          try {
            window.history.pushState({}, '', target.pathname + target.search + target.hash);
            window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
          } catch (e) {
            window.location.assign(target.href);
            return true;
          }
          var attempts = 0;
          var verify = function() {
            // The router acknowledged the route by changing the URL or the
            // document title. Silence means it ignored us -> hard navigate.
            if (window.location.href !== beforeHref || document.title !== beforeTitle) return;
            if (++attempts >= 12) {
              window.location.assign(target.href);
              return;
            }
            setTimeout(verify, 100);
          };
          setTimeout(verify, 100);
          return true;
        } catch (e) {
          return false;
        }
      };

      // SoundCloud's sliders are div[role=slider] nodes that only react to
      // real pointer drags; there is no input[type=range] to nudge. One shared
      // synthetic press/move/release drives volume and timeline alike.
      window.__scSliderDrag = function(target, x, y) {
        var base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
        target.dispatchEvent(new MouseEvent('mousedown', Object.assign({ buttons: 1 }, base)));
        document.dispatchEvent(new MouseEvent('mousemove', Object.assign({ buttons: 1 }, base)));
        document.dispatchEvent(new MouseEvent('mouseup', Object.assign({ buttons: 0 }, base)));
      };

      window.__scVolumeStep = function(delta) {
        try {
          var wrapper = document.querySelector('.volume__sliderWrapper');
          if (!wrapper) return false;
          var current = parseFloat(wrapper.getAttribute('aria-valuenow'));
          if (!isFinite(current)) current = 0.4;
          return window.__scPlayerSetVolume(current + (Number(delta) || 0));
        } catch (e) {
          return false;
        }
      };

      window.__scPlayerSetVolume = function(fraction) {
        try {
          var wrapper = document.querySelector('.volume__sliderWrapper');
          if (!wrapper) return false;
          // The wrapper collapses to 0px until hover, but the slider track
          // keeps its layout box; drive the drag against the track.
          var track = wrapper.querySelector('.volume__sliderBackground') || wrapper;
          var rect = track.getBoundingClientRect();
          if (!rect.height) return false;
          var next = Math.max(0, Math.min(1, Number(fraction) || 0));
          // The pointer->value mapping is offset ~4px from the painted track
          // (measured against SoundCloud's progress bar); keep that constant.
          window.__scSliderDrag(
            wrapper,
            rect.left + rect.width / 2,
            rect.bottom + 4 - next * rect.height
          );
          return true;
        } catch (e) {
          return false;
        }
      };

      window.__scPlayerAction = function(action) {
        var bySelector = function(selector) {
          var el = document.querySelector(selector);
          if (!el) return false;
          el.click();
          return true;
        };
        if (action === 'play-pause') return bySelector('.playControl');
        if (action === 'next') return bySelector('.playControls__next') || bySelector('.skipControl__next');
        if (action === 'prev') return bySelector('.playControls__prev') || bySelector('.skipControl__previous');
        if (action === 'mute') return bySelector('.volume__button');
        return false;
      };

      window.__scPlayerSeek = function(fraction) {
        try {
          var wrapper = document.querySelector('.playbackTimeline__progressWrapper');
          if (!wrapper) return false;
          var rect = wrapper.getBoundingClientRect();
          if (!rect.width) return false;
          var next = Math.max(0, Math.min(1, Number(fraction) || 0));
          window.__scSliderDrag(
            wrapper,
            rect.left + rect.width * next,
            rect.top + rect.height / 2
          );
          return true;
        } catch (e) {
          return false;
        }
      };

      window.__scPlayerSeekBy = function(deltaSeconds) {
        try {
          var wrapper = document.querySelector('.playbackTimeline__progressWrapper');
          if (!wrapper) return false;
          var current = parseFloat(wrapper.getAttribute('aria-valuenow'));
          var total = parseFloat(wrapper.getAttribute('aria-valuemax'));
          if (!isFinite(current) || !isFinite(total) || total <= 0) return false;
          return window.__scPlayerSeek((current + (Number(deltaSeconds) || 0)) / total);
        } catch (e) {
          return false;
        }
      };

      // One snapshot for every surface that mirrors playback state (mini
      // player, media session, integrations). Keeps selector churn in one place.
      window.__scPlayerState = function() {
        try {
          var titleEl = document.querySelector('.playbackSoundBadge__titleLink');
          var title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';
          title = title.replace(/^Current track:\\s*/i, '');
          var artistEl = document.querySelector('.playbackSoundBadge__lightLink');
          var artist = artistEl
            ? (artistEl.getAttribute('title') || artistEl.textContent || '').trim()
            : '';
          var artEl = document.querySelector('.playbackSoundBadge__avatar .image__full, .playbackSoundBadge__avatar span[style*="background-image"]');
          var artworkUrl = '';
          if (artEl) {
            var style = artEl.getAttribute('style') || '';
            var match = style.match(/url\\("?([^"\\)]+)"?\\)/);
            if (match) artworkUrl = match[1];
          }
          var playControl = document.querySelector('.playControl');
          var isPlaying = playControl ? playControl.classList.contains('playing') : false;
          var progress = document.querySelector('.playbackTimeline__progressWrapper');
          var position = progress ? parseFloat(progress.getAttribute('aria-valuenow')) : 0;
          var duration = progress ? parseFloat(progress.getAttribute('aria-valuemax')) : 0;
          var volumeEl = document.querySelector('.volume__sliderWrapper');
          var volume = volumeEl ? parseFloat(volumeEl.getAttribute('aria-valuenow')) : 1;
          if (!isFinite(position) || position < 0) position = 0;
          if (!isFinite(duration) || duration < 0) duration = 0;
          if (!isFinite(volume)) volume = 1;
          return {
            title: title,
            artist: artist,
            artworkUrl: artworkUrl,
            isPlaying: isPlaying,
            position: position,
            duration: duration,
            volume: Math.max(0, Math.min(1, volume)),
            trackUrl: titleEl ? (titleEl.href || '') : ''
          };
        } catch (e) {
          return null;
        }
      };

      // Akar Icons (MIT), used for all dynamic controls as well as navigation.
      window.__scIcon = function(name) {
        var paths = {
          x: '<path d="m6 6 12 12M18 6 6 18"/>',
          play: '<path d="M8.5 5.6v12.8a1 1 0 0 0 1.53.85l9.2-6.4a1 1 0 0 0 0-1.7L10.03 4.75A1 1 0 0 0 8.5 5.6Z"/>',
          pause: '<path d="M9.6 5.5v13M14.4 5.5v13"/>',
          up: '<path d="m6 15 6-6 6 6"/>',
          down: '<path d="m6 9 6 6 6-6"/>',
          music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
          list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
          user: '<circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/>',
        };
        return '<svg class="sc-akar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (paths[name] || paths.x) + '</svg>';
      };
      window.__scIconify = function(root) {
        root = root || document;
        root.querySelectorAll('[data-sc-icon]').forEach(function(el) {
          if (el.dataset.scIconReady === 'true') return;
          el.innerHTML = window.__scIcon(el.getAttribute('data-sc-icon'));
          el.dataset.scIconReady = 'true';
        });
        root.querySelectorAll('.sc-overlay-btn-icon').forEach(function(btn) {
          if (btn.dataset.scIconReady === 'true') return;
          var value = (btn.textContent || '').trim();
          if (value === '×' || value === '✕' || value === '✖' || value === '') {
            btn.innerHTML = window.__scIcon('x');
            btn.dataset.scIconReady = 'true';
          }
        });
      };

      var container = document.createElement('div');
      container.id = 'sc-overlay-container';
      container.innerHTML = '<div class="sc-overlay-backdrop"></div>' +
        '<div class="sc-overlay-window">' +
          '<div class="sc-window-titlebar">' +
            '<div class="sc-traffic-lights">' +
              '<span class="sc-tl sc-tl-close" id="sc-window-close" role="button" tabindex="0" aria-label="${t('common.close')}"></span>' +
              '<span class="sc-tl sc-tl-min"></span>' +
              '<span class="sc-tl sc-tl-max"></span>' +
            '</div>' +
            '<div class="sc-window-title" id="sc-window-title"></div>' +
          '</div>' +
          '<div class="sc-overlay-content">${panelsHTML.replace(/'/g, "\\'")}</div>' +
        '</div>';
      document.body.appendChild(container);
      window.__scIconify(container);
      new MutationObserver(function() { window.__scIconify(container); }).observe(container, { childList: true, subtree: true });

      // Persistent left rail — always visible, expands on hover.
      var rail = document.createElement('div');
      rail.id = 'sc-overlay-rail';
      rail.innerHTML = '${navHTML.replace(/'/g, "\\'")}';
      document.body.appendChild(rail);
      window.__scIconify(rail);
      new MutationObserver(function() { window.__scIconify(rail); }).observe(rail, { childList: true, subtree: true });

      // Keep SoundCloud's content out from under the rail. SoundCloud lays its
      // pages out at fixed widths (1240/1080/960) picked by viewport media
      // queries, so the page cannot simply be narrowed. When the centred
      // content would sit under the rail, shift it right just enough; when even
      // that does not fit (narrow windows, Windows at 125-150% scaling), tuck
      // the rail behind a slim handle at the edge so the content stays usable.
      var railHandle = document.createElement('div');
      railHandle.id = 'sc-rail-handle';
      railHandle.setAttribute('aria-hidden', 'true');
      document.body.appendChild(railHandle);

      var railPeekTimer = null;
      function setRailPeek(on) {
        if (railPeekTimer) { clearTimeout(railPeekTimer); railPeekTimer = null; }
        rail.classList.toggle('sc-rail-peek', on);
      }
      railHandle.addEventListener('mouseenter', function() { setRailPeek(true); });
      // :hover lags behind a rail that slides in under a still pointer (Chromium
      // refreshes it after the next mouse move or a delayed fake one, longer on
      // a busy GPU), so asking the rail whether it is hovered right after the
      // slide retracted it, and the highlight dropped and came back on the
      // next move. Track the pointer ourselves and judge by where it is.
      var pointerX = -1, pointerY = -1;
      document.addEventListener('mousemove', function(e) { pointerX = e.clientX; pointerY = e.clientY; }, { passive: true, capture: true });
      function pointerOverRail() {
        if (rail.matches(':hover')) return true;
        var r = rail.getBoundingClientRect();
        var edge = Math.max(r.right, 14 + (parseFloat(getComputedStyle(rail).width) || 0));
        return pointerX >= 0 && pointerX <= edge && pointerY >= r.top && pointerY <= r.bottom;
      }
      function armPeekTimer() {
        railPeekTimer = setTimeout(function() {
          railPeekTimer = null;
          if (pointerOverRail()) armPeekTimer(); else setRailPeek(false);
        }, 300);
      }
      railHandle.addEventListener('mouseleave', function() {
        // Give the pointer time to travel from the handle onto the rail.
        armPeekTimer();
      });
      rail.addEventListener('mouseleave', function() { setRailPeek(false); });

      // Battery saver, driven by setupBatterySaver() in the main process.
      window.__scSetPowerSaver = function(active) {
        active = active === true;
        window.__scPowerSaverActive = active;
        document.documentElement.classList.toggle('sc-power-saver', active);
        if (typeof window.__scVizSetPowerSaver === 'function') window.__scVizSetPowerSaver(active);
      };

      var railHidden = ${getStore()?.get('settings.railHidden') === true};
      window.__scSetRailHidden = function(hidden) {
        railHidden = !!hidden;
        setRailPeek(false);
        layoutRail();
      };

      var railLayoutQueued = false;
      function layoutRail() {
        railLayoutQueued = false;
        var root = document.documentElement;
        var content = document.querySelector('#app > .l-content') || document.querySelector('.l-content');
        var railStyle = getComputedStyle(rail);
        // Collapsed rail's right edge plus breathing room.
        var gutter = (parseFloat(railStyle.left) || 0) + (parseFloat(railStyle.getPropertyValue('--sc-rail-w')) || 62) + 12;
        var spare = root.clientWidth - (content ? content.offsetWidth : 0);
        var shift = 0;
        // Hidden by the user (rail keybind): same as no room, the handle stays.
        var compact = railHidden;
        if (!railHidden && content && spare / 2 < gutter) {
          // Padding P moves the centred content's left edge to (P + spare) / 2.
          if (spare >= gutter) shift = Math.ceil(2 * gutter - spare);
          else compact = true;
        }
        var shiftValue = shift + 'px';
        if (root.style.getPropertyValue('--sc-page-shift') !== shiftValue) root.style.setProperty('--sc-page-shift', shiftValue);
        if (root.classList.contains('sc-page-shifted') !== shift > 0) root.classList.toggle('sc-page-shifted', shift > 0);
        if (root.classList.contains('sc-rail-compact') !== compact) {
          root.classList.toggle('sc-rail-compact', compact);
          if (!compact) setRailPeek(false);
        }
      }
      function queueRailLayout() {
        if (railLayoutQueued) return;
        railLayoutQueued = true;
        // Not requestAnimationFrame: it stalls while the window is hidden, and
        // a window restored from the tray at a new size must lay out at once.
        setTimeout(layoutRail, 30);
      }
      window.addEventListener('resize', queueRailLayout);
      // Body size changes when SoundCloud renders or swaps a page, which is
      // also when .l-content appears or changes.
      if (window.ResizeObserver) new ResizeObserver(queueRailLayout).observe(document.body);
      queueRailLayout();

      var currentSection = null;
      var navItems = rail.querySelectorAll('.sc-nav-item');
      var panels = container.querySelectorAll('.sc-overlay-panel');
      var windowTitle = container.querySelector('#sc-window-title');

      function sectionLabel(id) {
        var found = '';
        navItems.forEach(function(n) {
          if (n.getAttribute('data-target') === id) {
            var lbl = n.querySelector('.sc-nav-label');
            found = lbl ? lbl.textContent.trim() : '';
          }
        });
        return found;
      }

      function activateSection(id) {
        navItems.forEach(function(n) {
          var selected = n.getAttribute('data-target') === id;
          n.classList.toggle('active', selected);
          n.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        panels.forEach(function(p) {
          p.classList.toggle('active', p.getAttribute('data-overlay') === id);
        });
        var label = sectionLabel(id);
        if (windowTitle && label) windowTitle.textContent = label;
        currentSection = id;
      }

      navItems.forEach(function(item) {
        function activateFromItem() {
          activateSection(item.getAttribute('data-target'));
          window.__scOpenOverlay();
          // Drop focus so the rail is not pinned open by :focus-within after a click.
          if (item.blur) item.blur();
        }
        item.addEventListener('click', activateFromItem);
        item.addEventListener('keydown', function(event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateFromItem();
          }
        });
      });

      window.__scOpenOverlay = function() {
        container.classList.add('open');
        document.body.classList.add('sc-overlay-open');
      };

      window.__scCloseOverlay = function() {
        container.classList.remove('open');
        document.body.classList.remove('sc-overlay-open');
        // Clear the rail selection so nothing stays highlighted after closing.
        navItems.forEach(function(n) {
          n.classList.remove('active');
          n.setAttribute('aria-pressed', 'false');
        });
        currentSection = null;
      };

      window.__scToggleOverlay = function() {
        if (container.classList.contains('open')) {
          window.__scCloseOverlay();
        } else {
          window.__scOpenOverlay();
          if (!currentSection) activateSection('geo-bypass');
        }
      };

      // Red traffic light closes the sheet, like macOS.
      var windowCloseBtn = container.querySelector('#sc-window-close');
      if (windowCloseBtn) {
        windowCloseBtn.addEventListener('click', function() { window.__scCloseOverlay(); });
        windowCloseBtn.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.__scCloseOverlay(); }
        });
      }

      // Click backdrop to close
      container.querySelector('.sc-overlay-backdrop').addEventListener('click', function() {
        window.__scCloseOverlay();
      });

      // Escape to close
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && container.classList.contains('open')) {
          window.__scCloseOverlay();
        }
      });

      // Sidebar container (left side, separate)
      if (!document.getElementById('sc-sidebar-container')) {
        var sidebar = document.createElement('div');
        sidebar.id = 'sc-sidebar-container';
        sidebar.innerHTML = '<div class="sc-sidebar-panel"></div>';
        document.body.appendChild(sidebar);

        var sidebarOpen = false;
        window.__scToggleSidebar = function() {
          sidebarOpen = !sidebarOpen;
          sidebar.classList.toggle('open', sidebarOpen);
        };
        window.__scCloseSidebar = function() {
          sidebarOpen = false;
          sidebar.classList.remove('open');
        };

        if (window.sixteenCloud) {
          window.sixteenCloud.onSidebarToggle(function() {
            window.__scToggleSidebar();
          });
        }
      }
    })();
  `;
}

function injectOverlayPanels(win: BrowserWindow): void {
  const panels: Record<string, { html: string; script: string }> = {
    'geo-bypass': { html: getGeoBypassOverlayHTML(), script: getGeoBypassOverlayScript() },
    'discord-rp': { html: getDiscordRpOverlayHTML(), script: getDiscordRpOverlayScript() },
    'adblocker': { html: getAdblockerOverlayHTML(), script: getAdblockerOverlayScript() },
    'auth-token': { html: getAuthTokenOverlayHTML(), script: getAuthTokenOverlayScript() },
    'downloader': { html: getDownloaderOverlayHTML(), script: getDownloaderOverlayScript() },
    'settings': { html: getSettingsOverlayHTML(), script: getSettingsOverlayScript() },
    'history': { html: getHistoryOverlayHTML(), script: getHistoryOverlayScript() },
    'lyrics': { html: getLyricsOverlayHTML(), script: getLyricsOverlayScript() },
    // Filled by the lyricsync page script (src/renderer/page/lyricsync.ts).
    'lyricsync': { html: '', script: '' },
    'equalizer': { html: getEqualizerOverlayHTML(), script: getEqualizerOverlayScript() },
    'player': { html: getPlayerToolsOverlayHTML(), script: getPlayerToolsOverlayScript() },
    'themes': { html: getThemesOverlayHTML(), script: getThemesOverlayScript() },
    'custom-css': { html: getCustomCssOverlayHTML(), script: getCustomCssOverlayScript() },
    'offline-cache': { html: getOfflineOverlayHTML(), script: getOfflineOverlayScript() },
  };

  // Fill all panels and initialize their scripts in one renderer roundtrip.
  // Keep the explicit order: sidebar first, then panels as listed above.
  const panelEntries = [
    {
      selector: '#sc-sidebar-container .sc-sidebar-panel',
      html: getSidebarOverlayHTML(),
      script: getSidebarOverlayScript(),
    },
    ...Object.entries(panels).map(([id, panel]) => ({
      selector: `[data-overlay="${id}"]`,
      html: panel.html,
      script: panel.script,
    })),
  ];

  const htmlInjection = panelEntries.map(({ selector, html }) => `
    (function() {
      var panel = document.querySelector(${JSON.stringify(selector)});
      if (panel && !panel.dataset.filled) {
        panel.innerHTML = ${JSON.stringify(html)};
        panel.dataset.filled = 'true';
      }
    })();
  `).join('\n');

  // Each overlay script is already an IIFE. Keep try/catch around each one so
  // a panel-specific runtime error cannot prevent later panels from starting.
  const scriptInjection = panelEntries.map(({ script }, index) => `
    try { ${script} } catch (e) {
      console.warn('[SixteenCloud] overlay panel ${index} initialization failed', e);
    }
  `).join('\n');

  runInPage(win, `
    (function() {
      ${htmlInjection}
      ${scriptInjection}
    })();
  `).catch((e: any) => logWarn('executeJS error:', e?.message));

  runInPage(win, getVisualizerScript())
    .catch((e: any) => logWarn('visualizer inject error:', e?.message));

  // Player features that depend on the visualizer's artwork finder.
  for (const [name, script] of [
    ['player core', getPlayerCoreScript()],
    ['dynamic accent', getDynamicAccentScript()],
    ['search plus', getSearchPlusScript()],
    ...getExtrasScripts(),
  ]) {
    runInPage(win, script)
      .catch((e: any) => logWarn(`${name} inject error:`, e?.message));
  }
}
