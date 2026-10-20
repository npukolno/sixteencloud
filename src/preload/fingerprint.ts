// UA-Client-Hints alignment — устанавливается из preload в main world ДО
// скриптов страницы (contextBridge.executeInMainWorld). Функция должна быть
// полностью самодостаточной: она сериализуется и выполняется уже в мире страницы.
//
// Зачем: Electron собирает `Sec-CH-UA` из собственного brand-листа
// (Chromium без "Google Chrome"), поэтому UA, заголовки и JS расходятся —
// версия, бренд и платформа говорят разное. Для SoundCloud и Cloudflare это
// ровно тот сигнал, по которому запросы помечаются как не-браузерные.
// Здесь JS-видимая часть (`navigator.userAgentData`) приводится к тому же
// виду, что и UA и заголовки, которые main-процесс уже подменил.
//
// Патчим ПРОТОТИПЫ, а не экземпляр: в Electron `navigator.userAgentData`
// возвращает новый объект-обёртку на каждый доступ, поэтому правка
// отдельного экземпляра не видна следующему обращению. Заодно кэшируем сам
// объект на Navigator.prototype — в настоящем Chrome он тоже стабилен, а
// нестабильная идентичность сама по себе является отпечатком.
//
// Патч делается только если UA действительно выглядит как Chrome — иначе
// ничего не трогаем, чтобы не сломать окружение.

export function installFingerprintAlignment(): void {
  'use strict';
  const w = window as unknown as Record<string, any>;
  const n = w.navigator;
  if (!n || !n.userAgentData || w.__scUachAligned) return;

  try {
    const ua: string = String(n.userAgent || '');
    const match = ua.match(/Chrome\/(\d+)(?:\.(\d+))?\.(\d+)\.(\d+)/);
    if (!match) return;

    const major = match[1];
    const full = `${match[1]}.${match[2]}.${match[3]}.${match[4]}`;
    const platform = /Windows NT/i.test(ua)
      ? 'Windows'
      : /Macintosh/i.test(ua)
        ? 'macOS'
        : /Linux/i.test(ua)
          ? 'Linux'
          : String(n.userAgentData.platform || 'Linux');

    // Same order as the Sec-CH-UA header built in shared/user-agent.ts.
    const brands = [
      { brand: 'Chromium', version: major },
      { brand: 'Not=A?Brand', version: '24' },
      { brand: 'Google Chrome', version: major },
    ];
    const fullVersionList = brands.map((b: { brand: string; version: string }) => ({
      brand: b.brand,
      version: b.brand === 'Not=A?Brand' ? '24.0.0.0' : full,
    }));

    const ctor = w.NavigatorUAData;
    const proto = ctor && ctor.prototype;
    if (!proto) return;

    w.__scUachAligned = true;

    const define = (key: string, descriptor: PropertyDescriptor): void => {
      try {
        Object.defineProperty(proto, key, descriptor);
      } catch (e) { /* keep the native member */ }
    };

    define('brands', { get: () => brands, configurable: true });
    define('mobile', { get: () => false, configurable: true });
    define('platform', { get: () => platform, configurable: true });

    // High-entropy hints are the ones a challenge actually asks for, so they
    // have to answer with the same brands / full version list.
    const originalHighEntropy =
      typeof proto.getHighEntropyValues === 'function' ? proto.getHighEntropyValues : null;
    if (originalHighEntropy) {
      define('getHighEntropyValues', {
        configurable: true,
        writable: true,
        value: function getHighEntropyValues(hints: string[]): Promise<any> {
          return originalHighEntropy.call(this, hints).then((values: any) => {
            if (!values || typeof values !== 'object') return values;
            values.brands = brands;
            values.fullVersionList = fullVersionList;
            if (values.platform !== platform) values.platform = platform;
            return values;
          });
        },
      });
    }

    // Real Chrome hands out one stable object per Navigator; Electron rebuilds
    // it on every access. Cache the first wrapper so identity checks match.
    const navigatorProto = w.Navigator && w.Navigator.prototype;
    const descriptor = navigatorProto && Object.getOwnPropertyDescriptor(navigatorProto, 'userAgentData');
    if (descriptor && descriptor.get) {
      const nativeGet = descriptor.get;
      const cache = new WeakMap();
      try {
        Object.defineProperty(navigatorProto, 'userAgentData', {
          configurable: true,
          get: function userAgentData(this: any) {
            let value = cache.get(this);
            if (!value) {
              value = nativeGet.call(this);
              cache.set(this, value);
            }
            return value;
          },
        });
      } catch (e) { /* identity caching is best-effort */ }
    }
  } catch (e) { /* never break the page for a fingerprint tweak */ }
}
