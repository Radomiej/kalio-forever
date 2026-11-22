import { copyFile } from 'node:fs/promises';

for (const name of ['MainActivity.java', 'RemoteVaultPlugin.java']) {
  await copyFile(new URL(name, import.meta.url), new URL(`../android/app/src/main/java/dev/kalio/remote/${name}`, import.meta.url));
}
