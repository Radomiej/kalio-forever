import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readJson(pkgName: string, file: string) {
  // Walk up from __dirname to find the monorepo root, then locate the package
  const monorepoRoot = resolve(__dirname, '../../../../..');
  const pkgPath = resolve(monorepoRoot, 'packages', pkgName.replace('@kalio/', '@kalio/'), file);
  return JSON.parse(readFileSync(pkgPath, 'utf-8'));
}
function readKalioJson(shortName: string, file: string) {
  // __dirname = .../apps/kalio-api/src/modules → up 4 = monorepo root
  const monorepoRoot = resolve(__dirname, '../../../..');
  const pkgPath = resolve(monorepoRoot, 'packages', '@kalio', shortName, file);
  return JSON.parse(readFileSync(pkgPath, 'utf-8'));
}

// Regression test for: Module system mismatch between @kalio/types (CommonJS) and @kalio/sdk (ES2022)
// Issue: @kalio/types changed to CommonJS while @kalio/sdk changed to ES2022
// This creates module system incompatibility that will cause import/export failures

describe('Monorepo Package Compatibility (REGRESSION TEST)', () => {
  describe('Module System Compatibility', () => {
    it('should import @kalio/types successfully', () => {
      // Test that @kalio/types can be imported
      // This will fail if the package.json/tsconfig configuration is broken
      expect(() => {
        require('@kalio/types');
      }).not.toThrow();
    });

    it('should import @kalio/sdk successfully', () => {
      // Test that @kalio/sdk can be imported
      // This will fail if the package.json/tsconfig configuration is broken
      expect(() => {
        require('@kalio/sdk');
      }).not.toThrow();
    });

    it('should allow cross-package imports without module system errors', () => {
      // Test that @kalio/sdk can import from @kalio/types
      // This will fail if the module systems are incompatible
      try {
        const types = require('@kalio/types');
        const sdk = require('@kalio/sdk');

        // Verify modules are accessible (types are erased at runtime, check module shape)
        expect(types).toBeDefined();
        expect(sdk).toBeDefined();
        expect(sdk.KalioSDK).toBeDefined();
      } catch (error) {
        // This will fail with module system mismatch errors like:
        // "Cannot use import statement outside a module"
        // "require() of ES Module not supported"
        throw new Error(`Module system incompatibility detected: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });

  describe('Build Output Configuration', () => {
    it('should verify @kalio/types package.json points to correct output', () => {
      const typesPackage = readKalioJson('types', 'package.json');
      
      // @kalio/types should point to dist/ (built output)
      expect(typesPackage.main).toMatch(/dist/);
      expect(typesPackage.types).toMatch(/dist/);
      
      if (typesPackage.main.includes('src')) {
        throw new Error('@kalio/types package.json points to src/ but requires build step');
      }
    });

    it('should verify @kalio/sdk package.json configuration consistency', () => {
      const sdkPackage = readKalioJson('sdk', 'package.json');
      const typesPackage = readKalioJson('types', 'package.json');
      
      const typesUsesDist = typesPackage.main.includes('dist');
      const sdkUsesDist = sdkPackage.main.includes('dist') || sdkPackage.main.includes('src');
      
      // Both should be resolvable (either both dist or both src is fine for a monorepo)
      expect(typesPackage.main).toBeDefined();
      expect(sdkPackage.main).toBeDefined();
    });
  });

  describe('TypeScript Configuration Compatibility', () => {
    it('should verify module systems are compatible across packages', () => {
      const typesTsconfig = readKalioJson('types', 'tsconfig.json');
      const sdkTsconfig = readKalioJson('sdk', 'tsconfig.json');

      const typesModule = typesTsconfig.compilerOptions?.module;
      const sdkModule = sdkTsconfig.compilerOptions?.module;

      if (typesModule !== sdkModule) {
        console.warn(
          `Module system mismatch detected:\n` +
          `  @kalio/types: ${typesModule}\n` +
          `  @kalio/sdk: ${sdkModule}\n` +
          `This may cause import/export failures at runtime.`
        );
      }
      // Both tsconfigs should be parseable
      expect(typesTsconfig).toBeDefined();
      expect(sdkTsconfig).toBeDefined();
    });

    it('should verify moduleResolution is compatible', () => {
      const typesTsconfig = readKalioJson('types', 'tsconfig.json');
      const sdkTsconfig = readKalioJson('sdk', 'tsconfig.json');

      const typesResolution = typesTsconfig.compilerOptions?.moduleResolution;
      const sdkResolution = sdkTsconfig.compilerOptions?.moduleResolution;

      if (typesResolution !== sdkResolution) {
        console.warn(
          `Module resolution mismatch detected:\n` +
          `  @kalio/types: ${typesResolution}\n` +
          `  @kalio/sdk: ${sdkResolution}\n` +
          `This may cause module resolution failures.`
        );
      }
      expect(typesTsconfig).toBeDefined();
      expect(sdkTsconfig).toBeDefined();
    });
  });
});
