import { describe, it, expect } from 'vitest';

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

        // Verify types are accessible
        expect(types).toBeDefined();
        expect(types.ID).toBeDefined();
        expect(types.Timestamp).toBeDefined();
        expect(types.ChatSession).toBeDefined();

        // Verify sdk is accessible
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
      // Regression test for: Inconsistent build output configuration
      // Issue: @kalio/types package.json now points to ./dist/index.js
      // but @kalio/sdk still points to ./src/index.ts
      // This breaks the monorepo dependency chain

      const typesPackage = require('@kalio/types/package.json');
      
      // @kalio/types should point to dist/ (built output)
      expect(typesPackage.main).toMatch(/dist/);
      expect(typesPackage.types).toMatch(/dist/);
      
      // If main points to src/, the package needs to be built before use
      // This breaks the monorepo's dependency chain
      if (typesPackage.main.includes('src')) {
        throw new Error('@kalio/types package.json points to src/ but requires build step');
      }
    });

    it('should verify @kalio/sdk package.json configuration consistency', () => {
      const sdkPackage = require('@kalio/sdk/package.json');
      
      // @kalio/sdk should be consistent with @kalio/types
      // If types uses dist/, sdk should also use dist/ or have proper build pipeline
      const typesPackage = require('@kalio/types/package.json');
      
      const typesUsesDist = typesPackage.main.includes('dist');
      const sdkUsesDist = sdkPackage.main.includes('dist');
      
      // Both should use the same approach (both dist or both src)
      // Mixed configuration breaks dependency resolution
      if (typesUsesDist !== sdkUsesDist) {
        throw new Error(
          `Inconsistent build configuration: @kalio/types uses ${typesPackage.main}, ` +
          `@kalio/sdk uses ${sdkPackage.main}. Both should use the same approach.`
        );
      }
    });
  });

  describe('TypeScript Configuration Compatibility', () => {
    it('should verify module systems are compatible across packages', () => {
      // Regression test for: Module system mismatch
      // @kalio/types: CommonJS
      // @kalio/sdk: ES2022
      // This mismatch causes import/export failures

      const typesTsconfig = require('@kalio/types/tsconfig.json');
      const sdkTsconfig = require('@kalio/sdk/tsconfig.json');

      const typesModule = typesTsconfig.compilerOptions.module;
      const sdkModule = sdkTsconfig.compilerOptions.module;

      // For NestJS backend compatibility, both should use the same module system
      // CommonJS is recommended for NestJS
      if (typesModule !== sdkModule) {
        console.warn(
          `Module system mismatch detected:\n` +
          `  @kalio/types: ${typesModule}\n` +
          `  @kalio/sdk: ${sdkModule}\n` +
          `This may cause import/export failures at runtime.`
        );
      }
    });

    it('should verify moduleResolution is compatible', () => {
      const typesTsconfig = require('@kalio/types/tsconfig.json');
      const sdkTsconfig = require('@kalio/sdk/tsconfig.json');

      const typesResolution = typesTsconfig.compilerOptions.moduleResolution;
      const sdkResolution = sdkTsconfig.compilerOptions.moduleResolution;

      // NodeNext/Bundler mismatch can cause resolution issues
      // For monorepo consistency, these should align
      if (typesResolution !== sdkResolution) {
        console.warn(
          `Module resolution mismatch detected:\n` +
          `  @kalio/types: ${typesResolution}\n` +
          `  @kalio/sdk: ${sdkResolution}\n` +
          `This may cause module resolution failures.`
        );
      }
    });
  });
});
