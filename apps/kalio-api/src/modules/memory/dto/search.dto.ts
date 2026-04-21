export interface SearchDto {
  query: string;
  personaId: string;
  limit?: number;
  mode?: 'vector' | 'fts' | 'hybrid';
}
