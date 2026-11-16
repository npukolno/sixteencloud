// Windows taskbar integration logic: the thumbnail toolbar (previous / play-pause
// / next under the window preview) and the track progress on the taskbar button.
// Kept free of Electron imports so it can be unit-tested with a fake window;
// windows-taskbar.ts wires it to the real BrowserWindow.

export type ProgressMode = 'none' | 'normal' | 'indeterminate' | 'error' | 'paused';

export interface ThumbarButtonLike<I> {
  icon: I;
  click: () => void;
  tooltip?: string;
  flags?: string[];
}

export interface TaskbarWindow<I> {
  isDestroyed(): boolean;
  setThumbarButtons(buttons: ThumbarButtonLike<I>[]): boolean;
  setProgressBar(progress: number, options?: { mode: ProgressMode }): void;
}

export interface TaskbarIcons<I> {
  prev: I;
  play: I;
  pause: I;
  next: I;
}

export interface TaskbarActions {
  previous(): void;
  playPause(): void;
  next(): void;
}

export interface PlaybackSnapshot {
  hasTrack: boolean;
  isPlaying: boolean;
  /** Seconds. */
  currentTime: number;
  /** Seconds; 0 when unknown. */
  duration: number;
}

type Label = 'taskbar.previous' | 'taskbar.play' | 'taskbar.pause' | 'taskbar.next';

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Normalises a track-info payload from the page into a snapshot. */
export function toSnapshot(info: unknown): PlaybackSnapshot {
  const raw = (info && typeof info === 'object' ? info : {}) as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const duration = Math.max(0, Math.min(86400, finiteOr(raw.duration, 0)));
  const currentTime = Math.max(0, Math.min(duration || 86400, finiteOr(raw.currentTime, 0)));
  return { hasTrack: title.length > 0, isPlaying: raw.isPlaying === true, currentTime, duration };
}

export class TaskbarController<I> {
  private state: PlaybackSnapshot = { hasTrack: false, isPlaying: false, currentTime: 0, duration: 0 };
  /** When state.currentTime was observed, for interpolating between updates. */
  private stampMs = 0;
  private lastButtons = '';
  private lastProgress = '';

  constructor(
    private readonly win: TaskbarWindow<I>,
    private readonly icons: TaskbarIcons<I> | null,
    private readonly actions: TaskbarActions,
    private readonly label: (key: Label) => string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** New playback state from the page. */
  update(snapshot: PlaybackSnapshot): void {
    this.state = { ...snapshot };
    this.stampMs = this.now();
    this.renderButtons(false);
    this.renderProgress();
  }

  /** Called every second: moves the progress along between page updates. */
  tick(): void {
    this.renderProgress();
  }

  /**
   * Re-applies the toolbar. Windows drops it when a hidden window is shown
   * again (tray), so the caller forces it on every "show".
   */
  refreshButtons(): void {
    this.renderButtons(true);
  }

  /** Position in seconds, extrapolated while playing. */
  position(): number {
    const { isPlaying, currentTime, duration } = this.state;
    const elapsed = isPlaying ? Math.max(0, this.now() - this.stampMs) / 1000 : 0;
    const pos = currentTime + elapsed;
    return duration > 0 ? Math.min(duration, pos) : pos;
  }

  private renderButtons(force: boolean): void {
    if (!this.icons || this.win.isDestroyed()) return;
    const { hasTrack, isPlaying } = this.state;
    const prevLabel = this.label('taskbar.previous');
    const toggleLabel = this.label(isPlaying ? 'taskbar.pause' : 'taskbar.play');
    const nextLabel = this.label('taskbar.next');
    const key = [hasTrack, isPlaying, prevLabel, toggleLabel, nextLabel].join('|');
    if (!force && key === this.lastButtons) return;

    const flags = hasTrack ? [] : ['disabled'];
    const buttons: ThumbarButtonLike<I>[] = [
      { icon: this.icons.prev, tooltip: prevLabel, flags, click: () => this.actions.previous() },
      {
        icon: isPlaying ? this.icons.pause : this.icons.play,
        tooltip: toggleLabel,
        flags,
        click: () => {
          this.actions.playPause();
          // Show the new state right away; the page confirms it a moment later.
          this.state = { ...this.state, currentTime: this.position(), isPlaying: !this.state.isPlaying };
          this.stampMs = this.now();
          this.renderButtons(false);
          this.renderProgress();
        },
      },
      { icon: this.icons.next, tooltip: nextLabel, flags, click: () => this.actions.next() },
    ];
    let applied = false;
    try {
      applied = this.win.setThumbarButtons(buttons) !== false;
    } catch {
      applied = false;
    }
    // Remember only what Windows accepted, so a refused call is retried.
    this.lastButtons = applied ? key : '';
  }

  private renderProgress(): void {
    if (this.win.isDestroyed()) return;
    const { hasTrack, isPlaying, duration } = this.state;
    let value = -1;
    let mode: ProgressMode = 'none';
    if (hasTrack && duration > 0) {
      value = Math.round((this.position() / duration) * 1000) / 1000;
      mode = isPlaying ? 'normal' : 'paused';
    }
    const key = `${value}|${mode}`;
    if (key === this.lastProgress) return;
    this.lastProgress = key;
    try {
      this.win.setProgressBar(value, { mode });
    } catch {
      this.lastProgress = '';
    }
  }
}
