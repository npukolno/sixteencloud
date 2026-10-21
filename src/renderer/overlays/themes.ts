import { t, getScriptTranslations } from '../../shared/i18n';

export function getThemesOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('themes.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('themes.choose')}</span>
        <div class="sc-themes-grid" id="sc-themes-grid"></div>
      </div>

      <div class="sc-overlay-group" style="margin-top:20px;">
        <span class="sc-overlay-label">${t('themes.custom')}</span>
        <div id="sc-custom-themes-grid"></div>
        <button class="sc-overlay-btn sc-overlay-btn-primary sc-overlay-btn-full" id="sc-theme-create" style="margin-top:8px;">${t('themes.create')}</button>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-theme-import" style="flex:1;">${t('themes.import')}</button>
          <input type="file" id="sc-theme-import-file" accept=".json" style="display:none;">
        </div>
      </div>

      <div id="sc-theme-editor" style="display:none;margin-top:16px;padding:16px;background:#1a1a1a;border-radius:8px;border:1px solid #333;">
        <span class="sc-overlay-label">${t('themes.editor')}</span>
        <div class="sc-overlay-group" style="margin-top:8px;">
          <input type="text" id="sc-theme-name" class="sc-overlay-input" placeholder="${t('themes.name_placeholder')}" style="margin-bottom:8px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="font-size:11px;color:#888;">${t('themes.color_bg')}</label>
              <input type="color" id="sc-theme-c-bg" value="#1a1a2e" style="width:100%;height:32px;border:1px solid #444;border-radius:4px;background:#222;cursor:pointer;">
            </div>
            <div>
              <label style="font-size:11px;color:#888;">${t('themes.color_surface')}</label>
              <input type="color" id="sc-theme-c-surface" value="#16213e" style="width:100%;height:32px;border:1px solid #444;border-radius:4px;background:#222;cursor:pointer;">
            </div>
            <div>
              <label style="font-size:11px;color:#888;">${t('themes.color_accent')}</label>
              <input type="color" id="sc-theme-c-accent" value="#e94560" style="width:100%;height:32px;border:1px solid #444;border-radius:4px;background:#222;cursor:pointer;">
            </div>
            <div>
              <label style="font-size:11px;color:#888;">${t('themes.color_text')}</label>
              <input type="color" id="sc-theme-c-text" value="#eaeaea" style="width:100%;height:32px;border:1px solid #444;border-radius:4px;background:#222;cursor:pointer;">
            </div>
            <div>
              <label style="font-size:11px;color:#888;">${t('themes.color_border')}</label>
              <input type="color" id="sc-theme-c-border" value="#2a2a4a" style="width:100%;height:32px;border:1px solid #444;border-radius:4px;background:#222;cursor:pointer;">
            </div>
            <div>
              <label style="font-size:11px;color:#888;">${t('themes.color_secondary')}</label>
              <input type="color" id="sc-theme-c-secondary" value="#888888" style="width:100%;height:32px;border:1px solid #444;border-radius:4px;background:#222;cursor:pointer;">
            </div>
          </div>
        </div>
        <div style="margin-top:12px;">
          <span style="font-size:11px;color:#888;">${t('themes.preview')}</span>
          <div id="sc-theme-preview" style="margin-top:4px;padding:12px;border-radius:6px;border:1px solid #333;">
            <div id="sc-tp-header" style="padding:8px 12px;border-radius:4px 4px 0 0;font-size:12px;font-weight:600;">SoundCloud</div>
            <div id="sc-tp-body" style="padding:12px;">
              <div id="sc-tp-title" style="font-size:13px;font-weight:600;margin-bottom:4px;">Track Title</div>
              <div id="sc-tp-artist" style="font-size:11px;margin-bottom:8px;">by Artist Name</div>
              <div id="sc-tp-bar" style="height:4px;border-radius:2px;overflow:hidden;">
                <div id="sc-tp-bar-fill" style="width:40%;height:100%;border-radius:2px;"></div>
              </div>
            </div>
            <div id="sc-tp-player" style="padding:8px 12px;border-radius:0 0 4px 4px;font-size:11px;"><span data-sc-icon="play"></span> Now Playing</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="sc-overlay-btn sc-overlay-btn-primary" id="sc-theme-save" style="flex:1;">${t('themes.save')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-theme-cancel">${t('themes.cancel')}</button>
        </div>
      </div>
    </div>
  `;
}

export function getThemesOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'themes.export', 'themes.delete', 'themes.delete_confirm', 'themes.saved',
    'themes.imported', 'themes.import_error', 'themes.name_required', 'themes.drop_here',
  ]));
  return `
    (function() {
      var panel = document.querySelector('[data-overlay="themes"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }

      var api = window.sixteenCloud;
      if (!api) return;

      var grid = panel.querySelector('#sc-themes-grid');
      var customGrid = panel.querySelector('#sc-custom-themes-grid');

      function normalizeColor(value, fallback) {
        var candidate = String(value || '').trim();
        if (!/^#[0-9a-f]{3,8}$/i.test(candidate)) return fallback;
        if (candidate.length === 4) {
          return '#' + candidate.slice(1).split('').map(function(ch) { return ch + ch; }).join('');
        }
        return candidate;
      }

      // Generate full CSS from the theme's surface palette. The accent is
      // deliberately NOT emitted here: settings.accentColor owns --sc-accent
      // app-wide, so themes and the accent picker never fight each other.
      function genCSS(bg, surface, _accent, text, border, secondary) {
        bg = normalizeColor(bg, '#101114');
        surface = normalizeColor(surface, '#17191e');
        text = normalizeColor(text, '#f4f5f7');
        border = normalizeColor(border, '#343840');
        secondary = normalizeColor(secondary, '#a0a5af');
        var bgValue = parseInt(bg.slice(1, 7), 16);
        var bgR = (bgValue >> 16) & 255, bgG = (bgValue >> 8) & 255, bgB = bgValue & 255;
        var isDark = (bgR * 299 + bgG * 587 + bgB * 114) < 140000;
        return [
          ':root{--sc-bg:'+bg+';--sc-surface:'+surface+';--sc-surface-raised:'+surface+';--sc-border:'+border+';--sc-border-strong:'+border+';--sc-text:'+text+';--sc-text-muted:'+secondary+';--sc-text-subtle:'+secondary+';} ',
          '#sc-overlay-container .sc-overlay-window,#sc-sidebar-container .sc-sidebar-panel{background:'+bg+' !important;color:'+text+' !important;border-color:'+border+' !important;}',
          '#sc-overlay-container .sc-overlay-nav{background:'+surface+' !important;border-color:'+border+' !important;}',
          '#sc-overlay-container .sc-overlay-content,#sc-overlay-container .sc-overlay-panel{background:'+bg+' !important;color:'+text+' !important;}',
          '#sc-overlay-container .sc-overlay-header{border-color:'+border+' !important;}',
          '#sc-overlay-container .sc-overlay-input,#sc-overlay-container .sc-overlay-select,#sc-overlay-container .sc-custom-dropdown-trigger{background:'+surface+' !important;color:'+text+' !important;border-color:'+border+' !important;}',
          '#sc-overlay-container .sc-overlay-toggle{border-color:'+border+' !important;}',
          '#sc-overlay-container .sc-overlay-toggle-label,#sc-overlay-container .sc-overlay-list-item-title{color:'+text+' !important;}',
          '#sc-overlay-container .sc-overlay-label,#sc-overlay-container .sc-overlay-hint,#sc-overlay-container .sc-overlay-list-item-sub{color:'+secondary+' !important;}',
          '#sc-overlay-container .sc-overlay-btn-secondary{background:'+surface+' !important;color:'+text+' !important;border:1px solid '+border+' !important;}',
          '#sc-overlay-container .sc-overlay-btn-primary{background:var(--sc-accent) !important;border-color:var(--sc-accent) !important;}',
          '#sc-overlay-container .sc-overlay-switch input:checked + .sc-overlay-switch-slider{background:var(--sc-accent) !important;}',
          '#sc-overlay-container .sc-overlay-badge{background:rgba(var(--sc-accent-rgb), 0.2) !important;color:var(--sc-accent) !important;}',
          '#sc-overlay-container .sc-overlay-progress-bar{background:var(--sc-accent) !important;}',
          '#sc-overlay-container .sc-overlay-user-card,#sc-overlay-container .sc-overlay-status,#sc-overlay-container .sc-eq-bands,#sc-overlay-container .sc-theme-card,#sc-overlay-container #sc-theme-editor{background:'+surface+' !important;color:'+text+' !important;border-color:'+border+' !important;}',
          '#sc-overlay-container .sc-theme-card.active{border-color:var(--sc-accent) !important;}',
          '#sc-overlay-container .sc-overlay-user-name,#sc-overlay-container .sc-overlay-download-title,#sc-overlay-container .sc-overlay-list-item-title,#sc-overlay-container #sc-discord-preview-app,#sc-overlay-container #sc-discord-preview-title{color:'+text+' !important;}',
          '#sc-overlay-container .sc-overlay-user-id,#sc-overlay-container .sc-overlay-download-artist,#sc-overlay-container .sc-overlay-list-item-sub,#sc-overlay-container #sc-discord-preview-artist,#sc-overlay-container #sc-discord-preview-time{color:'+secondary+' !important;}',
          '#sc-overlay-container .sc-overlay-download-item,#sc-overlay-container .sc-overlay-list-item,#sc-overlay-container .sc-overlay-section{border-color:'+border+' !important;}',
          'body,.l-container,.l-top-bar,.header,.l-fluid-fixed,.l-main,.stream,',
          '.sound__body,.listenDetails,.fullHero,.fullListenHero,',
          '.profileHeaderBackground,.userInfoBar,',
          '.l-fixed-top-bar,.l-top-bar .header__inner,',
          '.playControls,.playControls__inner,',
          '.soundList,.trackList,.trackItem,.soundBadge,.soundBadgeList__item,',
          '.userStreamItem,.userStreamItem__content,',
          '.listenArtworkWrapper,.listenContent,',
          '.profileTabs,.g-tabs,.g-tabs-link,',
          '.commentsList,.commentItem,.commentForm,',
          '.paging-eof,.compactTrackList,.compactTrackList__item,',
          '.searchList,.searchList__item,',
          '.modal,.modal__modal,.dialog,.dialog__content,',
          '.dropdownMenu,.headerMenu,.moreActions,',
          '.queue,.queue__panel,.queue__itemWrapper,',
          '.l-sidebar-right,.sidebarModule,',
          '.web-auth,.web-auth__loginForm,',
          '.infoStats,.infoStats__stat,.infoStats__statLink,',
          '.grids,.audibleRow,.audibleTile,',
          '.collection,.systemPlaylistTrackList,',
          '.mixedSelectionModule,.selectionCard,',
          '.trendingModule,.chartTracks,',
          '.commentPopover,.reportContent,',
          '.sc-classic .l-container,.sc-classic .stream,.sc-classic header,',
          '.g-modal-section,.g-form,.textfield,',
          '.listenEngagement,.listenEngagement__footer,',
          '.truncatedUserDescription,.truncatedAudioInfo,',
          '.tabs,.tabs__headingContainer,.tabs__tabs,',
          '.userNetwork,.userNetworkList,',
          '.relatedSounds,.soundRelated,',
          '.historicalPlays,.listenLogin,',
          '.moreButton,.sc-button-dropdown,',
          '.announcements,.upsellBanner,',
          '.headerSearch,.headerSearch__input,',
          '.sound__header,.soundTitle,',
          '.playbackSoundBadge,',
          '.fullHero .fullHero__content,',
          '.queueFallback,.queueItemView,.queue__hide,',
          '.playbackSoundBadge__showQueue,',
          '.volume,.volumeSlider,.volumeSlider__wrapper,',
          '.moreActions__group,.moreActions__button,',
          '.sc-selection-list,.sc-selection-list__inner{',
          '  background-color:'+bg+' !important;',
          '}',
          '.l-top-bar,.header,.l-fixed-top-bar{',
          '  background-color:'+surface+' !important;',
          '  background:'+surface+' !important;',
          '  border-bottom:1px solid '+border+' !important;',
          '}',
          '.playControls{',
          '  background:'+surface+' !important;',
          '  border-top:1px solid '+border+' !important;',
          '}',
          // Link / title colors
          '.sc-link-primary,a.soundTitle__title span,',
          '.soundTitle__title,.trackItem__trackTitle,.chartTrack__title,',
          'a.soundTitle__title,a.trackItem__trackTitle,',
          '.compactTrackListItem__trackTitle,',
          '.audibleTile__mainHeading a,',
          '.selectionCard__title a,',
          '.sc-link-primary:visited{',
          '  color:var(--sc-accent) !important;',
          '}',
          // Primary text
          '.sc-type-medium,.sc-type-small,.sc-font-body,',
          '.soundTitle__usernameText,.trackItem__username,',
          '.chartTrack__username,.userBadge__username,',
          '.audibleTile__username,.selectionCard__subtitle,',
          '.playbackSoundBadge__titleLink,.playbackSoundBadge__lightLink,',
          '.headerSearch__input,',
          '.commentItem__body,.commentForm textarea,',
          '.sc-type-h1,.sc-type-h2,.sc-type-h3,',
          '.profileHeaderInfo__userName,',
          '.sound__header a,.listenDetails__trackTitle,',
          '.truncatedUserDescription,.truncatedAudioInfo__description,',
          '.sc-ministats-item,.compactTrackList__number,',
          '.queue__dragHandle,.queue__itemDetails,',
          '.dialog__content,.modal__title,',
          '.g-tabs-link,.tabs__headingContainer h2,',
          '.l-sidebar-right .sidebarHeader__title,',
          '.sidebarHeader__actualTitle,',
          '.commentItem__username a,',
          '.audibleTile__mainHeading,',
          '.selectionCard__title{',
          '  color:'+text+' !important;',
          '}',
          // Secondary text
          '.sc-text-secondary,.sc-type-light,',
          '.relativeTime,.soundStats,.sc-ministats,',
          '.audibleTile__plays,.soundTitle__secondary,',
          '.listenEngagement__stats,.infoStats__statLink,',
          '.historicalPlays__stat,.userBadge__info,',
          '.tabs__tabs a{',
          '  color:'+secondary+' !important;',
          '}',
          // Borders
          '.sc-border-light-bottom,.sc-border-light-top,.sc-border-light,',
          '.sc-border-light-right,.sc-border-light-left{',
          '  border-color:'+border+' !important;',
          '}',
          '.compactTrackList__item,.trackItem{',
          '  border-bottom-color:'+border+' !important;',
          '}',
          '.g-tabs-link{border-bottom-color:transparent !important;}',
          '.g-tabs-link.active{border-bottom-color:var(--sc-accent) !important;}',
          // Buttons
          '.sc-button,.sc-button-medium,.sc-button-small,.sc-button-responsive{',
          '  background-color:'+surface+' !important;',
          '  border-color:'+border+' !important;',
          '  color:'+text+' !important;',
          '}',
          '.sc-button-cta{',
          '  background-color:var(--sc-accent) !important;',
          '  border-color:var(--sc-accent) !important;',
          '  color:var(--sc-accent-foreground, #fff) !important;',
          '}',
          // Inputs
          'input,textarea,select,.textfield__input{',
          '  background-color:'+surface+' !important;',
          '  border-color:'+border+' !important;',
          '  color:'+text+' !important;',
          '}',
          // Player controls
          '.playControl,.skipControl__next,.skipControl__previous{',
          '  filter:'+(isDark?'brightness(2)':'none')+' !important;',
          '}',
          '.playbackTimeline__progressBackground{',
          '  background-color:'+border+' !important;',
          '}',
          '.playbackTimeline__progressWrapper .sc-ir{',
          '  background-color:var(--sc-accent) !important;',
          '}',
          // Queue/Next Up popup
          '.queueFallback,.queue__panel,.queue__itemWrapper,.queue__itemDetails,',
          '.queue__dragHandle,.queue__hide,.queueItemView{',
          '  background:'+surface+' !important;',
          '  color:'+text+' !important;',
          '}',
          '.queue__panel{border:1px solid '+border+' !important;}',
          // Preserve onboarding/spotlight overlays
          '.spotlight__overlay,.callToAction,.onboarding,.tooltipBubble,',
          '.spotlight,.coachmark,.educationalOverlay,.callout{',
          '  background:unset !important;',
          '  color:unset !important;',
          '}',
          // Ensure spotlight backdrop is visible
          '.spotlight__overlay{',
          '  background:rgba(0,0,0,0.7) !important;',
          '}',
        ].join('\\n');
      }

      var BUILTIN_THEMES = {
        'default': {
          name: '${t('themes.default')}',
          colors: ['#333','#181818','#f50','#fff','#111'],
          css: ''
        },
        'amoled': {
          name: 'AMOLED Black',
          colors: ['#000','#000','#f50','#fff','#000'],
          get css() { return genCSS('#000000','#000000','#ff5500','#ffffff','#111111','#888888'); }
        },
        'light': {
          name: 'Light',
          colors: ['#fff','#f2f2f2','#f50','#222','#fff'],
          get css() { return genCSS('#f8f8f8','#ffffff','#ff5500','#222222','#e5e5e5','#666666'); }
        },
        'nord': {
          name: 'Nord',
          colors: ['#2e3440','#3b4252','#88c0d0','#eceff4','#2e3440'],
          get css() { return genCSS('#2e3440','#3b4252','#88c0d0','#eceff4','#434c5e','#a0a8b8'); }
        },
        'catppuccin': {
          name: 'Catppuccin Mocha',
          colors: ['#1e1e2e','#313244','#cba6f7','#cdd6f4','#1e1e2e'],
          get css() { return genCSS('#1e1e2e','#313244','#cba6f7','#cdd6f4','#45475a','#a6adc8'); }
        },
        'dracula': {
          name: 'Dracula',
          colors: ['#282a36','#44475a','#bd93f9','#f8f8f2','#282a36'],
          get css() { return genCSS('#282a36','#44475a','#bd93f9','#f8f8f2','#6272a4','#bfbfbf'); }
        },
        'gruvbox': {
          name: 'Gruvbox Dark',
          colors: ['#282828','#3c3836','#fe8019','#ebdbb2','#282828'],
          get css() { return genCSS('#282828','#3c3836','#fe8019','#ebdbb2','#504945','#a89984'); }
        },
        'solarized': {
          name: 'Solarized Dark',
          colors: ['#002b36','#073642','#268bd2','#93a1a1','#002b36'],
          get css() { return genCSS('#002b36','#073642','#268bd2','#93a1a1','#586e75','#839496'); }
        },
        'rosepine': {
          name: 'Rosé Pine',
          colors: ['#191724','#1f1d2e','#ebbcba','#e0def4','#191724'],
          get css() { return genCSS('#191724','#1f1d2e','#ebbcba','#e0def4','#26233a','#908caa'); }
        },
        'tokyonight': {
          name: 'Tokyo Night',
          colors: ['#1a1b26','#24283b','#7aa2f7','#c0caf5','#1a1b26'],
          get css() { return genCSS('#1a1b26','#24283b','#7aa2f7','#c0caf5','#3b4261','#a9b1d6'); }
        },
        'onedark': {
          name: 'One Dark',
          colors: ['#282c34','#2c313a','#61afef','#abb2bf','#282c34'],
          get css() { return genCSS('#282c34','#2c313a','#61afef','#abb2bf','#3e4452','#7f848e'); }
        },
        'monokai': {
          name: 'Monokai',
          colors: ['#272822','#3e3d32','#f92672','#f8f8f2','#272822'],
          get css() { return genCSS('#272822','#3e3d32','#f92672','#f8f8f2','#49483e','#a59f85'); }
        },
        'cyberpunk': {
          name: 'Cyberpunk',
          colors: ['#0a0a1a','#12122a','#ff2975','#00fff5','#0a0a1a'],
          get css() { return genCSS('#0a0a1a','#12122a','#ff2975','#00fff5','#1a1a3e','#8888aa'); }
        },
        'forest': {
          name: 'Forest',
          colors: ['#1b2420','#243028','#4ade80','#d1fae5','#1b2420'],
          get css() { return genCSS('#1b2420','#243028','#4ade80','#d1fae5','#2d3f35','#7aa88e'); }
        },
        'everforest': {
          name: 'Everforest',
          colors: ['#2d353b','#343f44','#a7c080','#d3c6aa','#2d353b'],
          get css() { return genCSS('#2d353b','#343f44','#a7c080','#d3c6aa','#475258','#859289'); }
        },
        'kanagawa': {
          name: 'Kanagawa',
          colors: ['#1f1f28','#2a2a37','#7e9cd8','#dcd7ba','#1f1f28'],
          get css() { return genCSS('#1f1f28','#2a2a37','#7e9cd8','#dcd7ba','#363646','#727169'); }
        },
        'synthwave': {
          name: "Synthwave '84",
          colors: ['#262335','#34294f','#ff7edb','#f0e4fc','#262335'],
          get css() { return genCSS('#262335','#34294f','#ff7edb','#f0e4fc','#495495','#848bbd'); }
        },
        'material-ocean': {
          name: 'Material Ocean',
          colors: ['#0f111a','#1a1c25','#84ffff','#a6accd','#0f111a'],
          get css() { return genCSS('#0f111a','#1a1c25','#84ffff','#a6accd','#1f2233','#717cb4'); }
        },
        'palenight': {
          name: 'Palenight',
          colors: ['#292d3e','#34384c','#c792ea','#a6accd','#292d3e'],
          get css() { return genCSS('#292d3e','#34384c','#c792ea','#a6accd','#3e4452','#676e95'); }
        },
        'horizon': {
          name: 'Horizon',
          colors: ['#1c1e26','#232530','#e95678','#d5d8da','#1c1e26'],
          get css() { return genCSS('#1c1e26','#232530','#e95678','#d5d8da','#2e303e','#6c6f93'); }
        }
      };

      var activeTheme = 'default';
      var customThemes = Object.create(null);
      var editingThemeId = null;

      // Theme editor elements
      var editor = panel.querySelector('#sc-theme-editor');
      var nameInput = panel.querySelector('#sc-theme-name');
      var cBg = panel.querySelector('#sc-theme-c-bg');
      var cSurface = panel.querySelector('#sc-theme-c-surface');
      var cAccent = panel.querySelector('#sc-theme-c-accent');
      var cText = panel.querySelector('#sc-theme-c-text');
      var cBorder = panel.querySelector('#sc-theme-c-border');
      var cSecondary = panel.querySelector('#sc-theme-c-secondary');
      var saveBtn = panel.querySelector('#sc-theme-save');
      var cancelBtn = panel.querySelector('#sc-theme-cancel');
      var createBtn = panel.querySelector('#sc-theme-create');
      var importBtn = panel.querySelector('#sc-theme-import');
      var importFile = panel.querySelector('#sc-theme-import-file');

      function updatePreview() {
        var bg = cBg.value, sf = cSurface.value, ac = cAccent.value;
        var tx = cText.value, bd = cBorder.value, sc = cSecondary.value;
        var h = panel.querySelector('#sc-tp-header');
        var b = panel.querySelector('#sc-tp-body');
        var p = panel.querySelector('#sc-tp-player');
        var tt = panel.querySelector('#sc-tp-title');
        var ta = panel.querySelector('#sc-tp-artist');
        var bar = panel.querySelector('#sc-tp-bar');
        var bf = panel.querySelector('#sc-tp-bar-fill');
        var pw = panel.querySelector('#sc-theme-preview');
        pw.style.background = bg; pw.style.borderColor = bd;
        h.style.background = sf; h.style.color = tx;
        b.style.background = bg;
        tt.style.color = ac; ta.style.color = sc;
        bar.style.background = bd; bf.style.background = ac;
        p.style.background = sf; p.style.color = tx; p.style.borderTop = '1px solid ' + bd;
      }

      [cBg,cSurface,cAccent,cText,cBorder,cSecondary].forEach(function(el) {
        el.addEventListener('input', updatePreview);
      });

      function applyTheme(id) {
        var allThemes = Object.assign({}, BUILTIN_THEMES, customThemes);
        var theme = allThemes[id];
        if (!theme) return;
        activeTheme = id;

        var existing = document.getElementById('sc-theme');
        if (existing) existing.remove();

        var css = theme.css;
        if (typeof css === 'string' && css) {
          var style = document.createElement('style');
          style.id = 'sc-theme';
          style.textContent = css;
          // Keep user Custom CSS as the last cascade layer.
          var customStyle = document.getElementById('sc-custom-css');
          if (customStyle) document.head.insertBefore(style, customStyle);
          else document.head.appendChild(style);
        }

        api.storeSet('themes.active', id);
        renderGrids();
      }

      function renderGrids() {
        renderBuiltinGrid();
        renderCustomGrid();
      }

      function safeColor(value) { return normalizeColor(value, '#333333'); }

      function renderBuiltinGrid() {
        grid.innerHTML = Object.keys(BUILTIN_THEMES).map(function(id) {
          var th = BUILTIN_THEMES[id];
          var isActive = id === activeTheme;
          return '<div class="sc-theme-card' + (isActive ? ' active' : '') + '" data-theme="' + id + '" style="cursor:pointer;padding:12px;background:#1a1a1a;border-radius:8px;border:2px solid ' + (isActive ? '#f50' : '#333') + ';margin-bottom:8px;">' +
            '<div style="font-size:14px;font-weight:600;color:#fff;margin-bottom:8px;">' + window.__scEscapeHtml(th.name) + '</div>' +
            '<div style="display:flex;gap:4px;">' +
            th.colors.map(function(c) {
              return '<div style="width:24px;height:24px;border-radius:50%;background:' + safeColor(c) + ';border:1px solid #555;"></div>';
            }).join('') +
            '</div></div>';
        }).join('');

        grid.querySelectorAll('.sc-theme-card').forEach(function(card) {
          card.addEventListener('click', function() {
            applyTheme(card.getAttribute('data-theme'));
          });
        });
      }

      function renderCustomGrid() {
        var ids = Object.keys(customThemes);
        if (!ids.length) {
          customGrid.innerHTML = '<div style="color:#666;font-size:12px;padding:8px 0;">' + '—' + '</div>';
          return;
        }
        customGrid.innerHTML = ids.map(function(id) {
          var th = customThemes[id];
          var isActive = id === activeTheme;
          return '<div class="sc-theme-card' + (isActive ? ' active' : '') + '" data-theme="' + window.__scEscapeHtml(id) + '" style="cursor:pointer;padding:12px;background:#1a1a1a;border-radius:8px;border:2px solid ' + (isActive ? '#f50' : '#333') + ';margin-bottom:8px;position:relative;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<div style="font-size:14px;font-weight:600;color:#fff;">' + window.__scEscapeHtml(th.name) + '</div>' +
              '<div style="display:flex;gap:4px;">' +
                '<button class="sc-ct-export" data-id="' + window.__scEscapeHtml(id) + '" style="background:none;border:1px solid #555;color:#aaa;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;">' + _t('themes.export') + '</button>' +
                '<button class="sc-ct-delete" data-id="' + window.__scEscapeHtml(id) + '" style="background:none;border:1px solid #e74c3c;color:#e74c3c;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;">' + _t('themes.delete') + '</button>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:4px;">' +
            th.colors.map(function(c) {
              return '<div style="width:24px;height:24px;border-radius:50%;background:' + safeColor(c) + ';border:1px solid #555;"></div>';
            }).join('') +
            '</div></div>';
        }).join('');

        customGrid.querySelectorAll('.sc-theme-card').forEach(function(card) {
          card.addEventListener('click', function(e) {
            if (e.target.classList.contains('sc-ct-export') || e.target.classList.contains('sc-ct-delete')) return;
            applyTheme(card.getAttribute('data-theme'));
          });
        });

        customGrid.querySelectorAll('.sc-ct-export').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = btn.getAttribute('data-id');
            var th = customThemes[id];
            if (!th) return;
            var data = JSON.stringify({ name: th.name, palette: th.palette }, null, 2);
            var blob = new Blob([data], { type: 'application/json' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = (th.name || 'theme') + '.sctheme.json';
            a.click();
          });
        });

        customGrid.querySelectorAll('.sc-ct-delete').forEach(function(btn) {
          btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var id = btn.getAttribute('data-id');
            btn.textContent = '?';
            btn.style.background = '#e74c3c'; btn.style.color = '#fff';
            var timer = setTimeout(function() { btn.textContent = _t('themes.delete'); btn.style.background = ''; btn.style.color = '#e74c3c'; }, 3000);
            btn.onclick = function(e2) {
              e2.stopPropagation();
              clearTimeout(timer);
              delete customThemes[id];
              if (activeTheme === id) applyTheme('default');
              saveCustomThemes();
              renderGrids();
            };
          });
        });
      }

      function saveCustomThemes() {
        var data = {};
        Object.keys(customThemes).forEach(function(id) {
          var th = customThemes[id];
          data[id] = { name: th.name, palette: th.palette };
        });
        api.storeSet('themes.custom', data);
      }

      function loadCustomTheme(id, data) {
        if (typeof id !== 'string' || !/^custom_[a-zA-Z0-9_-]{1,80}$/.test(id)) return false;
        if (!data || typeof data !== 'object' || !data.palette || typeof data.palette !== 'object') return false;
        var p = data.palette;
        var normalized = {
          bg: normalizeColor(p.bg, '#101114'),
          surface: normalizeColor(p.surface, '#17191e'),
          accent: normalizeColor(p.accent, '#ff5500'),
          text: normalizeColor(p.text, '#f4f5f7'),
          border: normalizeColor(p.border, '#343840'),
          secondary: normalizeColor(p.secondary, '#a0a5af'),
        };
        var safeName = typeof data.name === 'string' ? data.name.trim().slice(0, 80) : '';
        if (!safeName) return false;
        customThemes[id] = {
          name: safeName,
          palette: normalized,
          colors: [normalized.bg, normalized.surface, normalized.accent, normalized.text, normalized.border],
          css: genCSS(normalized.bg, normalized.surface, normalized.accent, normalized.text, normalized.border, normalized.secondary)
        };
        return true;
      }

      // Create button
      createBtn.addEventListener('click', function() {
        editingThemeId = null;
        nameInput.value = '';
        cBg.value = '#1a1a2e'; cSurface.value = '#16213e';
        cAccent.value = '#e94560'; cText.value = '#eaeaea';
        cBorder.value = '#2a2a4a'; cSecondary.value = '#888888';
        updatePreview();
        editor.style.display = 'block';
      });

      cancelBtn.addEventListener('click', function() {
        editor.style.display = 'none';
      });

      saveBtn.addEventListener('click', function() {
        var name = nameInput.value.trim();
        if (!name) { nameInput.style.borderColor = '#e74c3c'; nameInput.placeholder = _t('themes.name_required'); return; }
        var id = editingThemeId || 'custom_' + Date.now();
        var palette = {
          bg: cBg.value, surface: cSurface.value, accent: cAccent.value,
          text: cText.value, border: cBorder.value, secondary: cSecondary.value
        };
        loadCustomTheme(id, { name: name, palette: palette });
        saveCustomThemes();
        editor.style.display = 'none';
        applyTheme(id);
      });

      // Import
      importBtn.addEventListener('click', function() { importFile.click(); });
      importFile.addEventListener('change', function() {
        var file = importFile.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function() {
          try {
            var data = JSON.parse(reader.result);
            if (!data.name || !data.palette) throw new Error('Invalid');
            var id = 'custom_' + Date.now();
            if (!loadCustomTheme(id, data)) throw new Error('Invalid');
            saveCustomThemes();
            renderGrids();
          } catch(e) {
            importBtn.textContent = _t('themes.import_error'); importBtn.style.color = '#e74c3c'; setTimeout(function() { importBtn.textContent = _t('themes.import'); importBtn.style.color = ''; }, 2000);
          }
        };
        reader.readAsText(file);
        importFile.value = '';
      });

      // Drag & Drop import
      var overlayBody = panel.querySelector('.sc-overlay-body');
      overlayBody.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        overlayBody.style.border = '2px dashed #f50';
        overlayBody.style.borderRadius = '8px';
      });
      overlayBody.addEventListener('dragleave', function(e) {
        e.preventDefault();
        e.stopPropagation();
        overlayBody.style.border = '';
      });
      overlayBody.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        overlayBody.style.border = '';
        var files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        for (var fi = 0; fi < files.length; fi++) {
          var file = files[fi];
          if (!file.name.endsWith('.json')) continue;
          (function(f, index) {
            var reader = new FileReader();
            reader.onload = function() {
              try {
                var data = JSON.parse(reader.result);
                if (!data.name || !data.palette) throw new Error('Invalid');
                var id = 'custom_' + Date.now() + '_' + index;
                if (!loadCustomTheme(id, data)) throw new Error('Invalid');
                saveCustomThemes();
                renderGrids();
              } catch(e) {
                importBtn.textContent = _t('themes.import_error'); importBtn.style.color = '#e74c3c'; setTimeout(function() { importBtn.textContent = _t('themes.import'); importBtn.style.color = ''; }, 2000);
              }
            };
            reader.readAsText(f);
          })(file, fi);
        }
      });

      // Load saved custom themes then render
      api.storeGet('themes.custom').then(function(data) {
        if (data && typeof data === 'object') {
          Object.keys(data).forEach(function(id) {
            loadCustomTheme(id, data[id]);
          });
        }
        return api.storeGet('themes.active');
      }).then(function(id) {
        var allThemes = Object.assign({}, BUILTIN_THEMES, customThemes);
        if (id && allThemes[id]) {
          applyTheme(id);
        } else {
          renderGrids();
        }
      });
    })();
  `;
}
