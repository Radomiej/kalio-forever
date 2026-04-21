import { describe, it, expect } from 'vitest';
import { createLLMProvider, type ProviderConfig } from './provider-factory';
import { MockLLMProvider } from './mock.provider';
import { OpenAIProvider } from './openai.provider';
import { OpenRouterProvider } from './openrouter.provider';
import { CometAPIProvider } from './cometapi.provider';
import { XiaomiMiMoProvider } from './xiaomimimo.provider';
import { OllamaProvider } from './ollama.provider';

// Regression test for: Provider factory silent fallback to OpenAI for unknown providers
// Issue: Unknown provider types silently default to OpenAI instead of throwing an error
// This masks configuration mistakes and could lead to unexpected behavior

describe('createLLMProvider', () => {
  describe('Unknown provider handling (REGRESSION TEST)', () => {
    it('should throw error for unknown provider type', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'unknown-provider',
        apiKey: 'test-key',
        model: 'test-model',
        baseUrl: 'https://example.com',
      };

      // Act & Assert
      // BUG: Current implementation silently returns OpenAIProvider for unknown providers
      // Expected: Should throw an error with message indicating valid provider types
      expect(() => createLLMProvider(config)).toThrow(/Unknown LLM provider/);
    });

    it('should throw error for empty provider string', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: '',
        apiKey: 'test-key',
        model: 'test-model',
        baseUrl: 'https://example.com',
      };

      // Act & Assert
      expect(() => createLLMProvider(config)).toThrow(/Unknown LLM provider/);
    });

    it('should throw error for truly unknown provider', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'unknown-provider-xyz',
        apiKey: 'test-key',
        model: 'test-model',
        baseUrl: 'https://custom-api.com',
      };

      // Act & Assert
      // FIXED: Unknown providers now throw instead of silently falling through to OpenAI
      expect(() => createLLMProvider(config)).toThrow(/Unknown LLM provider/);
    });

    it('custom provider requires baseUrl', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'custom',
        apiKey: 'test-key',
        model: 'test-model',
        // no baseUrl
      };

      // Act & Assert
      expect(() => createLLMProvider(config)).toThrow(/Unknown LLM provider/);
    });
  });

  describe('Mock provider handling', () => {
    it('should return MockLLMProvider when provider is mock', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'mock',
        apiKey: 'any-key',
        model: 'any-model',
        baseUrl: 'any-url',
      };

      // Act
      const provider = createLLMProvider(config);

      // Assert
      expect(provider).toBeInstanceOf(MockLLMProvider);
    });

    it('should return MockLLMProvider when apiKey is mock', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'openai',
        apiKey: 'mock',
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com',
      };

      // Act
      const provider = createLLMProvider(config);

      // Assert
      expect(provider).toBeInstanceOf(MockLLMProvider);
    });

    it('should return MockLLMProvider when baseUrl is mock', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'openai',
        apiKey: 'sk-test',
        model: 'gpt-4',
        baseUrl: 'mock',
      };

      // Act
      const provider = createLLMProvider(config);

      // Assert
      expect(provider).toBeInstanceOf(MockLLMProvider);
    });
  });

  describe('Known provider types', () => {
    it('should return OpenRouterProvider for openrouter', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'openrouter',
        apiKey: 'test-key',
        model: 'openai/gpt-4',
      };

      // Act
      const provider = createLLMProvider(config);

      // Assert
      expect(provider).toBeInstanceOf(OpenRouterProvider);
    });

    it('should return CometAPIProvider for cometapi', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'cometapi',
        apiKey: 'test-key',
        model: 'gpt-4',
      };

      // Act
      const provider = createLLMProvider(config);

      // Assert
      expect(provider).toBeInstanceOf(CometAPIProvider);
    });

    it('should return XiaomiMiMoProvider for xiaomimimo', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'xiaomimimo',
        apiKey: 'test-key',
        model: 'mimo-v2-omni',
      };

      // Act
      const provider = createLLMProvider(config);

      // Assert
      expect(provider).toBeInstanceOf(XiaomiMiMoProvider);
    });

    it('should return OpenAIProvider for openai', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'openai',
        apiKey: 'test-key',
        model: 'gpt-4',
      };

      // Act
      const provider = createLLMProvider(config);

      // Assert
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });

    it('should return OllamaProvider for ollama', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'ollama',
        apiKey: 'ollama',
        model: 'llama3.2',
      };

      // Act
      const provider = createLLMProvider(config);

      // Assert
      expect(provider).toBeInstanceOf(OllamaProvider);
    });

    it('should handle provider names case-insensitively', () => {
      // Arrange
      const config: ProviderConfig = {
        provider: 'OPENAI',
        apiKey: 'test-key',
        model: 'gpt-4',
      };

      // Act
      const provider = createLLMProvider(config);

      // Assert
      expect(provider).toBeInstanceOf(OpenAIProvider);
    });
  });
});
