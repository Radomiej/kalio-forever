import { Injectable } from '@nestjs/common';
import { Tool } from '../../../common/decorators/tool.decorator';
import type { ToolCallRequest } from '@kalio/types';
import { RelayService } from '../../relay/relay.service';

@Injectable()
@Tool({
  name: 'escalate',
  description:
    'Report a critical event to the user immediately. The event is logged in the audit trail and, if Telegram is connected, a message is sent to the user. Use this when something important requires human attention — unexpected errors, blocked progress, or decisions that need human input.',
  parameters: {
    type: 'object',
    required: ['message'],
    properties: {
      message: {
        type: 'string',
        description: 'Clear description of the critical event to report to the user.',
      },
    },
  },
  requiresConfirmation: false,
})
export class EscalateTool {
  constructor(private readonly relay: RelayService) {}

  async execute(request: ToolCallRequest): Promise<{ sent: boolean; message: string }> {
    const message = request.args['message'] as string;
    if (!message || typeof message !== 'string') {
      throw new Error('INVALID_ARGS: message is required and must be a string');
    }
    const text = `🔴 KALIO ESCALATION\n\n${message}\n\nSession: ${request.sessionId}`;
    const sent = await this.relay.broadcast(text);
    return { sent, message };
  }
}
