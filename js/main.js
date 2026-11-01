import { loadJSON } from './engine/loader.js';
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
  showMessage('Caricamento...');
  try {
    const config = await loadJSON('config/game.json');
    document.title = config.title || document.title;

    const [assetsCfg, level] = await Promise.all([loadJSON(config.assets), loadJSON(config.startLevel)]);

    const display = new Display($('game'), $('ui'), config.display);
    const assets = new Assets();
    await assets.load(assetsCfg);

    const audio = new AudioManager(assetsCfg.sounds, config.audio);
    await audio.load();

    const input = new Input(display, config.input);
    const game = new Game({ config, assets, audio, display, input, level });
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
    showMessage(e.message);
  }
}

boot();
