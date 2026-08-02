import type { Locator, Page } from '@playwright/test';

import { pause, TIMING } from './timing.js';

// Adds a visible-but-unobtrusive synthetic cursor dot, click ripples, and
// focus-ring highlighting to every page the recording visits. This is
// purely cosmetic DOM/CSS injected at recording time via addInitScript —
// it never touches application source and has no effect outside this
// automation.
export async function installVisualPolish(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `
      #tutorial-cursor {
        position: fixed;
        top: 0; left: 0;
        width: 18px; height: 18px;
        margin-left: -9px; margin-top: -9px;
        border-radius: 50%;
        background: rgba(79, 70, 229, 0.85);
        border: 2px solid rgba(255, 255, 255, 0.9);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
        pointer-events: none;
        z-index: 2147483647;
        transition: transform 80ms ease-out;
      }
      .tutorial-ripple {
        position: fixed;
        width: 12px; height: 12px;
        margin-left: -6px; margin-top: -6px;
        border-radius: 50%;
        border: 2px solid rgba(79, 70, 229, 0.9);
        pointer-events: none;
        z-index: 2147483646;
        animation: tutorial-ripple-anim 550ms ease-out forwards;
      }
      @keyframes tutorial-ripple-anim {
        from { width: 12px; height: 12px; margin-left: -6px; margin-top: -6px; opacity: 0.9; }
        to   { width: 48px; height: 48px; margin-left: -24px; margin-top: -24px; opacity: 0; }
      }
      .tutorial-focus-highlight {
        outline: 3px solid rgba(79, 70, 229, 0.85) !important;
        outline-offset: 2px !important;
        border-radius: 4px;
      }
    `;
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
    if (document.head) document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = 'tutorial-cursor';
    const attach = () => document.body?.appendChild(cursor);
    document.addEventListener('DOMContentLoaded', attach);
    attach();

    window.addEventListener('mousemove', (e) => {
      cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    });

    window.addEventListener('mousedown', (e) => {
      const ripple = document.createElement('div');
      ripple.className = 'tutorial-ripple';
      ripple.style.left = `${e.clientX}px`;
      ripple.style.top = `${e.clientY}px`;
      document.body?.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });

    let lastFocused: HTMLElement | null = null;
    document.addEventListener(
      'focus',
      (e) => {
        lastFocused?.classList.remove('tutorial-focus-highlight');
        const target = e.target;
        if (target instanceof HTMLElement) {
          target.classList.add('tutorial-focus-highlight');
          lastFocused = target;
        }
      },
      true,
    );
  });
}

export async function smoothScrollIntoView(locator: Locator): Promise<void> {
  await locator.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  const page = locator.page();
  await pause(page, TIMING.shortPause);
}
