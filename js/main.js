import { loadJSON } from './engine/loader.js';
import { I18n } from './engine/i18n.js';
import { Display } from './engine/display.js';
import { Assets } from './engine/assets.js';
import { AudioManager } from './engine/audio.js';
import { Input } from './engine/input.js';
import { Game } from './game/game.js';
import { Weapons } from './game/weapons.js';
import { GrenadeTypes } from './game/grenades.js';

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

    const [assetsCfg, level, effectsCfg, weaponsCfg] = await Promise.all([
      loadJSON(config.assets),
      loadJSON(config.startLevel),
      loadJSON(config.effects),
      loadJSON(config.weapons),
    ]);
    const weapons = new Weapons(weaponsCfg);
    const grenadeTypes = new GrenadeTypes(weaponsCfg);

    const display = new Display($('game'), $('ui'), config.display);
    const assets = new Assets();
    await assets.load(assetsCfg);

    const audio = new AudioManager(assetsCfg.sounds, config.audio);
    await audio.load();

    // ?debug=1 nell'URL: mostra i pulsanti touch di debug (es. togli/ridai vita)
    const urlDebug = new URLSearchParams(location.search).get('debug') === '1';
    const input = new Input(display, config.input, { debug: urlDebug });
    const game = new Game({ config, assets, audio, display, input, level, effectsCfg, weapons, grenadeTypes, i18n });
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

    // Game over: la scena si desatura e compare la schermata; clic/tocco (o Invio) per ricominciare
    const gameOverOverlay = $('overlay-gameover');
    game.onGameOver = () => {
      document.body.classList.add('game-over');
      gameOverOverlay.classList.remove('hidden');
    };
    game.onRestart = () => {
      document.body.classList.remove('game-over');
      gameOverOverlay.classList.add('hidden');
    };
    gameOverOverlay.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation(); // il clic per ricominciare non deve sparare
      game.restart(); // ignorato finché non è trascorso gameOver.restartDelay
    });

    window.BAF2D = game; // comodo per il debug da console
  } catch (e) {
    console.error(e);
    // Se i file lingua non sono disponibili si usa il testo inglese di riserva dell'errore
    showMessage(i18nReady ? i18n.error(e) : e.message);
  }
}

boot();
