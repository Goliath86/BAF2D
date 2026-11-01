import { loadJSON } from './engine/loader.js';
import { I18n } from './engine/i18n.js';
import { Display } from './engine/display.js';
import { Assets } from './engine/assets.js';
import { AudioManager } from './engine/audio.js';
import { Input } from './engine/input.js';
import { Game } from './game/game.js';

const $ = (id) => document.getElementById(id);

function showMessage(text) {
  $('message-text').textContent = text;
  $('overlay-message').classList.remove('hidden');
}

function hideMessage() {
  $('overlay-message').classList.add('hidden');
}

async function enterFullscreenLandscape(mobileCfg) {
  if (!mobileCfg?.requestFullscreen) return;
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    }
    if (mobileCfg.lockLandscape && screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch (e) {
    // Non supportato (es. iOS Safari): l'overlay "ruota il dispositivo" fa da fallback
  }
}

async function boot() {
  const i18n = new I18n();
  let i18nReady = false;
  try {
    const config = await loadJSON('config/game.json');
    document.title = config.title || document.title;

    await i18n.load(config.i18n);
    i18nReady = true;
    i18n.applyToDOM();
    showMessage(i18n.t('loading'));

    const [assetsCfg, level, effectsCfg] = await Promise.all([
      loadJSON(config.assets),
      loadJSON(config.startLevel),
      loadJSON(config.effects),
    ]);

    const display = new Display($('game'), $('ui'), config.display);
    const assets = new Assets();
    await assets.load(assetsCfg);

    const audio = new AudioManager(assetsCfg.sounds, config.audio);
    await audio.load();

    const input = new Input(display, config.input);
    const game = new Game({ config, assets, audio, display, input, level, effectsCfg, i18n });
    game.start();

    hideMessage();
    const startOverlay = $('overlay-start');
    startOverlay.classList.remove('hidden');
    startOverlay.addEventListener(
      'pointerdown',
      async (e) => {
        e.preventDefault();
        e.stopPropagation(); // evita che il click di avvio spari subito
        audio.unlock();
        startOverlay.classList.add('hidden');
        if (e.pointerType === 'touch') await enterFullscreenLandscape(config.mobile);
        input.enabled = true;
        game.running = true;
      },
      { once: true }
    );

    window.BAF2D = game; // comodo per il debug da console
  } catch (e) {
    console.error(e);
    // Se i file lingua non sono disponibili si usa il testo inglese di riserva dell'errore
    showMessage(i18nReady ? i18n.error(e) : e.message);
  }
}

boot();
