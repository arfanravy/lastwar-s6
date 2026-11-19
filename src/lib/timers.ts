const pad = (n: number) => String(n).padStart(2, '0');

function formatRemaining(ms: number, dayUnit: string) {
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d}${dayUnit} ${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * [data-countdown="ISO"] data-day-unit="h" data-ended="Selesai"
 * [data-clock="server" data-offset="-2"] | [data-clock="local"]
 */
export function startTimers() {
  const countdowns = [...document.querySelectorAll<HTMLElement>('[data-countdown]')];
  const clocks = [...document.querySelectorAll<HTMLElement>('[data-clock]')];

  const tick = () => {
    const now = Date.now();
    for (const el of countdowns) {
      const target = Date.parse(el.dataset.countdown ?? '');
      const left = target - now;
      el.textContent = left > 0 ? formatRemaining(left, el.dataset.dayUnit ?? 'd') : (el.dataset.ended ?? '—');
    }
    for (const el of clocks) {
      if (el.dataset.clock === 'server') {
        const offset = Number(el.dataset.offset ?? 0);
        const d = new Date(now + offset * 3600_000);
        el.textContent = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
      } else {
        const d = new Date(now);
        el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
    }
  };

  tick();
  if (countdowns.length || clocks.length) setInterval(tick, 1000);
}
