/** The status line and the language switch, in plain DOM. */

import { getLanguage, setLanguage, t } from '../shared/i18n.ts';
import type { RenderBackend } from '../shared/types.ts';
import { loadLanguage, saveLanguage } from './language.ts';

export interface Hud {
  setTurn(turn: number): void;
  setBackend(backend: RenderBackend): void;
  /** Shows that the renderer could not start. */
  setRendererError(message: string): void;
}

/** Applies the stored language, then builds the HUD inside `root`. */
export function createHud(root: HTMLElement): Hud {
  setLanguage(loadLanguage());

  let turn = 1;
  let backend: RenderBackend | null = null;
  let error: string | null = null;

  const status = document.createElement('span');
  status.id = 'status';
  const languageButton = document.createElement('button');
  languageButton.id = 'language';
  languageButton.type = 'button';
  root.append(status, languageButton);

  const render = (): void => {
    document.documentElement.lang = getLanguage() === 'zh' ? 'zh-CN' : 'en';
    document.title = t('app.title');
    const parts = [t('hud.turn', { turn })];
    if (error !== null) parts.push(t('error.renderer', { message: error }));
    else if (backend !== null) parts.push(t('hud.backend', { backend: t(`backend.${backend}`) }));
    status.textContent = parts.join(' · ');
    languageButton.textContent = t('language.switch');
  };

  languageButton.addEventListener('click', () => {
    const next = getLanguage() === 'zh' ? 'en' : 'zh';
    setLanguage(next);
    saveLanguage(next);
    render();
  });

  render();
  return {
    setTurn(value) {
      turn = value;
      render();
    },
    setBackend(value) {
      backend = value;
      render();
    },
    setRendererError(message) {
      error = message;
      render();
    },
  };
}
