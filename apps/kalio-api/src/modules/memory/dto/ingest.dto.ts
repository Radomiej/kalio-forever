export interface IngestDto {
  text: string;
  personaId: string;
  metadata?: Record<string, string>;
}

export interface IngestConversationDto {
  messages: Array<{ role: string; content: string }>;
  personaId: string;
}
