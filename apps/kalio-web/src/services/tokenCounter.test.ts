import { describe, it, expect } from 'vitest';
import {
  estimateTextTokens,
  estimateJsonTokens,
  estimateImageTokens,
  countTokens,
  formatTokenCount,
} from './tokenCounter';

describe('tokenCounter', () => {
  describe('estimateTextTokens', () => {
    it('should estimate tokens for text', () => {
      expect(estimateTextTokens('hello world')).toBeGreaterThan(0);
      expect(estimateTextTokens('')).toBe(0);
    });

    it('should use ~4 chars per token heuristic', () => {
      const text = 'a'.repeat(40);
      expect(estimateTextTokens(text)).toBe(10);
    });
  });

  describe('estimateJsonTokens', () => {
    it('should estimate tokens for JSON', () => {
      const json = '{"key": "value"}';
      expect(estimateJsonTokens(json)).toBeGreaterThan(0);
    });

    it('should use ~3 chars per token for JSON', () => {
      const json = 'a'.repeat(30);
      expect(estimateJsonTokens(json)).toBe(10);
    });
  });

  describe('estimateImageTokens', () => {
    it('should estimate tokens for low detail images', () => {
      expect(estimateImageTokens(1024, 1024, 'low')).toBe(85);
    });

    it('should estimate tokens for auto/high detail images', () => {
      const tokens = estimateImageTokens(1024, 1024, 'auto');
      expect(tokens).toBeGreaterThan(85);
    });

    it('should calculate tile-based tokens for large images', () => {
      const tokens = estimateImageTokens(1024, 1024, 'high');
      // 2x2 tiles = 4 tiles * 85 + 85 base = 425
      expect(tokens).toBe(425);
    });
  });

  describe('countTokens', () => {
    it('should count total tokens across all categories', () => {
      const result = countTokens({
        systemPromptText: 'system prompt',
        skillsText: '',
        toolsText: 'tool description',
        historyTexts: ['user message', 'assistant message'],
        imageCount: 1,
        contextLimit: 32000,
      });

      expect(result.total).toBeGreaterThan(0);
      expect(result.breakdown.systemPrompt).toBeGreaterThan(0);
      expect(result.breakdown.tools).toBeGreaterThan(0);
      expect(result.breakdown.history).toBeGreaterThan(0);
      expect(result.breakdown.images).toBeGreaterThan(0);
    });

    it('should calculate cacheable tokens', () => {
      const result = countTokens({
        systemPromptText: 'system prompt',
        skillsText: '',
        toolsText: 'tool description',
        historyTexts: ['user message'],
        imageCount: 0,
        contextLimit: 32000,
      });

      expect(result.cacheable).toBe(result.breakdown.systemPrompt + result.breakdown.tools + result.breakdown.skills);
    });

    it('should calculate usage percentage', () => {
      const result = countTokens({
        systemPromptText: 'a'.repeat(1000),
        skillsText: '',
        toolsText: '',
        historyTexts: [],
        imageCount: 0,
        contextLimit: 2000,
      });

      expect(result.usagePercent).toBeGreaterThan(0);
      expect(result.usagePercent).toBeLessThanOrEqual(100);
    });
  });

  describe('formatTokenCount', () => {
    it('should format small numbers as-is', () => {
      expect(formatTokenCount(100)).toBe('100');
      expect(formatTokenCount(999)).toBe('999');
    });

    it('should format thousands with k suffix', () => {
      expect(formatTokenCount(1000)).toBe('1.0k');
      expect(formatTokenCount(1500)).toBe('1.5k');
      expect(formatTokenCount(10000)).toBe('10k');
    });
  });
});
