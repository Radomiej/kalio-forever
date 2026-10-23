export function createRuntimeDependencies(dependencies, installedVersions, runtime) {
  return Object.fromEntries(Object.keys(dependencies).filter((name) => (
    name !== '@kalio/types' && (runtime !== 'bun' || name !== 'better-sqlite3')
  )).map((name) => {
    const version = installedVersions[name];
    if (typeof version !== 'string' || !version) throw new Error(`Installed runtime dependency version is missing: ${name}`);
    return [name, version];
  }));
}
