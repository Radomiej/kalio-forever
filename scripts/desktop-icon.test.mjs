import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const installPs1 = readFileSync(resolve('scripts/install.ps1'), 'utf8');
const uninstallPs1 = readFileSync(resolve('scripts/uninstall.ps1'), 'utf8');
const installSh = readFileSync(resolve('scripts/install.sh'), 'utf8');
const kalioCli = readFileSync(resolve('scripts/kalio-cli.mjs'), 'utf8');
const packageBuild = readFileSync(resolve('scripts/build-runtime-package.mjs'), 'utf8');
const tauriConf = JSON.parse(readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8'));

test('script installer registers a desktop shortcut that runs kalio start', () => {
  assert.match(installPs1, /\[switch\]\$NoDesktopIcon/);
  assert.match(installPs1, /function Register-DesktopShortcut/);
  assert.match(installPs1, /'Kalio\.lnk'/);
  assert.match(installPs1, /-File "\{0\}" start'/);
  assert.match(installPs1, /kalio\.ico/);
});

test('uninstaller removes the desktop shortcut', () => {
  assert.match(uninstallPs1, /function Remove-DesktopShortcut/);
  assert.match(uninstallPs1, /Remove-DesktopShortcut[\r\n]/);
});

test('NSIS installer always creates a desktop shortcut', () => {
  assert.equal(tauriConf.bundle.windows.nsis.createDesktopShortcut, 'always');
});

test('runtime package ships an icon per platform', () => {
  assert.match(packageBuild, /kalio\.ico/);
  assert.match(packageBuild, /kalio\.png/);
});

test('linux installer writes a freedesktop entry and honors --no-desktop-icon', () => {
  assert.match(installSh, /--no-desktop-icon/);
  assert.match(installSh, /kalio\.desktop/);
  assert.match(installSh, /Exec="\$install_root\/bin\/kalio" start/);
});

test('kalio uninstall cleans up desktop artifacts on every platform', () => {
  assert.match(kalioCli, /Kalio\.lnk/);
  assert.match(kalioCli, /kalio\.desktop/);
});
