import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('is constructible', () => {
    expect(new AppModule()).toBeInstanceOf(AppModule);
  });
});