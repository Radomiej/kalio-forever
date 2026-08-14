import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const outputPath = resolve(process.argv[2] ?? '.tmp/tauri-updater.conf.json');
const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim();
const endpoint = process.env.TAURI_UPDATER_ENDPOINT?.trim()
  || 'https://github.com/Radomiej/kalio-forever/releases/latest/download/latest.json';
const targets = process.env.TAURI_BUNDLE_TARGETS
  ?.split(',')
  .map((target) => target.trim())
  .filter(Boolean);
const nodeResourceName = process.env.TAURI_NODE_RESOURCE_NAME?.trim();

if (!publicKey) {
  throw new Error('TAURI_UPDATER_PUBLIC_KEY is required to create a signed updater configuration');
}

const config = {
  bundle: {
    createUpdaterArtifacts: true,
    ...(targets && targets.length > 0 ? { targets } : {}),
    ...(nodeResourceName
      ? { resources: { [`resources/${nodeResourceName}`]: nodeResourceName } }
      : {}),
  },
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints: [endpoint],
      windows: {
        installMode: 'passive',
      },
    },
  },
};

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
console.log(`[desktop] wrote updater config to ${outputPath}`);
