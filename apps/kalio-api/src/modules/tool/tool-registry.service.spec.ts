import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ToolRegistryService } from './tool-registry.service';
import { Reflector } from '@nestjs/core';
import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSService } from '../vfs/vfs.service';
import { ConfigService } from '@nestjs/config';

describe('ToolRegistryService', () => {
  let service: ToolRegistryService;
  let vfsWriteTool: VFSWriteTool;
  let vfsService: VFSService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ToolRegistryService,
        VFSWriteTool,
        Reflector,
        {
          provide: VFSService,
          useValue: {
            writeFile: vi.fn(),
            readFile: vi.fn(),
            listFiles: vi.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn().mockReturnValue('./test-workspace'),
          },
        },
      ],
    }).compile();

    service = moduleRef.get<ToolRegistryService>(ToolRegistryService);
    vfsWriteTool = moduleRef.get<VFSWriteTool>(VFSWriteTool);
    vfsService = moduleRef.get<VFSService>(VFSService);
  });

  describe('getToolsForSkills', () => {
    it('should return all tools when skills array is empty', () => {
      // Arrange
      const skills: string[] = [];

      // Act
      const result = service.getToolsForSkills(skills);

      // Assert
      expect(result.length).toBeGreaterThan(0);
      // Should return vfs_write tool
      expect(result.some((t) => t.name === 'vfs_write')).toBe(true);
    });

    it('should filter tools by available skills', () => {
      // Arrange
      const skills = ['vfs_write'];

      // Act
      const result = service.getToolsForSkills(skills);

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('vfs_write');
    });

    it('should return empty array when no skills match', () => {
      // Arrange
      const skills = ['non_existent_tool', 'another_missing_tool'];

      // Act
      const result = service.getToolsForSkills(skills);

      // Assert
      expect(result).toHaveLength(0);
    });

    it('should only include tools that are in available skills', () => {
      // Arrange - request only specific tool
      const skills = ['vfs_write'];

      // Act
      const result = service.getToolsForSkills(skills);

      // Assert
      expect(result.every((t) => skills.includes(t.name))).toBe(true);
    });
  });

  describe('getMeta', () => {
    it('should return metadata for registered tool', () => {
      // Act
      const meta = service.getMeta('vfs_write');

      // Assert
      expect(meta).toBeDefined();
      expect(meta?.name).toBe('vfs_write');
      expect(meta?.description).toBeDefined();
      expect(meta?.parameters).toBeDefined();
    });

    it('should return undefined for unknown tool', () => {
      // Act
      const meta = service.getMeta('unknown_tool');

      // Assert
      expect(meta).toBeUndefined();
    });
  });

  describe('getAllTools', () => {
    it('should return array of all registered tools', () => {
      // Act
      const result = service.getAllTools();

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should include vfs_write in all tools', () => {
      // Act
      const result = service.getAllTools();

      // Assert
      expect(result.some((t) => t.name === 'vfs_write')).toBe(true);
    });
  });
});
