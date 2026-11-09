import { contextBridge } from 'electron';
import { installFirefoxIdentity } from './firefox-identity';

// Minimal preload for third-party sign-in windows (Google, Apple, Facebook...).
// It deliberately exposes no SixteenCloud API: the page is not ours. Its only
// job is to make the JS-visible browser identity match the Firefox identity the
// request headers claim (see FIREFOX_UA), which is what Google's "this browser
// or app may not be secure" check compares.
try {
  contextBridge.executeInMainWorld({ func: installFirefoxIdentity });
} catch (e) {
  console.warn('[SixteenCloud] auth identity injection failed:', e);
}
