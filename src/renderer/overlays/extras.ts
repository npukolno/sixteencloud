import { getToastScript } from './toast';
import { getAmbientScript } from './ambient';
import { getStatusHubScript } from './status-hub';
import { getHotButtonsScript } from './hot-buttons';

// Page scripts for the smaller in-page features. main.ts injects this list
// after the player core (they rely on window.__scPlayer and the visualizer's
// artwork finder), so a new feature only has to be added here.
export function getExtrasScripts(): Array<readonly [string, string]> {
  return [
    ['toast', getToastScript()],
    ['status hub', getStatusHubScript()],
    ['ambient', getAmbientScript()],
    ['hot buttons', getHotButtonsScript()],
  ];
}
