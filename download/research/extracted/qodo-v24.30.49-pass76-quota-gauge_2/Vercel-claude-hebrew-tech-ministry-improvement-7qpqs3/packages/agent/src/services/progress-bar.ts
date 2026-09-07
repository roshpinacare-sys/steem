/**
 * Progress Bar — simple terminal progress indicator for pipeline phases.
 * Works in any TTY; degrades gracefully in CI (no ANSI codes when not TTY).
 */

const isTTY = process.stdout.isTTY ?? false;

export interface ProgressBar {
  update(current: number, label?: string): void;
  complete(label?: string): void;
  fail(label?: string): void;
}

export function createProgressBar(total: number, title = 'Progress'): ProgressBar {
  let lastLength = 0;

  function render(current: number, label: string, symbol: string): void {
    const pct = Math.min(1, current / total);
    const filled = Math.round(pct * 30);
    const bar = '█'.repeat(filled) + '░'.repeat(30 - filled);
    const line = `${symbol} ${title} [${bar}] ${(pct * 100).toFixed(0).padStart(3)}% ${label}`;

    if (isTTY) {
      process.stdout.write('\r' + ' '.repeat(lastLength) + '\r');
      process.stdout.write(line);
      lastLength = line.length;
    } else {
      // CI-friendly: print only significant steps
      if (current === 0 || current === total || current % Math.ceil(total / 5) === 0) {
        process.stdout.write(line + '\n');
      }
    }
  }

  return {
    update(current, label = '') {
      render(current, label, '⟳');
    },
    complete(label = 'Done') {
      render(total, label, '✓');
      if (isTTY) process.stdout.write('\n');
    },
    fail(label = 'Failed') {
      render(total, label, '✗');
      if (isTTY) process.stdout.write('\n');
    },
  };
}
