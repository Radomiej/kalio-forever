import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { PersonaService } from './persona.service';
import { DrizzleService } from '../../database/drizzle.service';

function makeDb() {
  return {
    select: vi.fn(),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
  };
}

describe('PersonaService bootstrap default persona regression', () => {
  let service: PersonaService;
  let mockDb: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    mockDb = makeDb();

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        PersonaService,
        {
          provide: DrizzleService,
          useValue: { db: mockDb },
        },
      ],
    }).compile();

    service = moduleRef.get<PersonaService>(PersonaService);
  });

  it('does not insert the default persona when it already exists', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'default' }]),
      }),
    });

    await service.onApplicationBootstrap();

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('surfaces database failures from the existence check', async () => {
    mockDb.select.mockImplementation(() => {
      throw new Error('Database connection lost');
    });

    await expect(service.onApplicationBootstrap()).rejects.toThrow('Database connection lost');
  });
});
