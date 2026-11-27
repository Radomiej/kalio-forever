import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createDevinCliMetadataConfig } from './devin-cli-config';
import { suppressInheritedDevinMcp } from './devin-cli-mcp-catalog';
import { createNdjsonFrameGuard, DevinCliAcpLifecycle } from './devin-cli-acp.lifecycle';
import { devinAcpChildEnv, expandDevinModelVariants, readDevinSelectableModels } from './devin-cli-acp.model-selection';

/** Read session metadata without a prompt, tools, or access to the user's project. */
export async function readDevinAcpModelCatalog(executable: string): Promise<string[]> {
  const lifecycle = new DevinCliAcpLifecycle();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const config = await createDevinCliMetadataConfig(handle => { lifecycle.config = handle; });
    await suppressInheritedDevinMcp(executable, config, []);
    const child = spawn(executable, ['acp'], {
      cwd: config.cwd, env: devinAcpChildEnv(process.env),
      shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    lifecycle.adoptChild(child, (_reason, error) => lifecycle.fail(error));
    // Drain diagnostics without retaining or logging potentially private content.
    child.stderr.resume();
    const stdout = child.stdout.pipe(createNdjsonFrameGuard());
    stdout.once('error', error => lifecycle.fail(error));
    const connection = client({ name: 'kalio-model-catalog' })
      .onRequest(methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' } }))
      .connect(ndJsonStream(
        Writable.toWeb(child.stdin) as unknown as WritableStream<Uint8Array>,
        Readable.toWeb(stdout) as unknown as ReadableStream<Uint8Array>,
      ));
    lifecycle.connection = connection;
    void connection.closed.then(
      () => lifecycle.fail(new Error('Devin ACP catalog connection closed.')),
      () => lifecycle.fail(new Error('Devin ACP catalog connection failed.')),
    );
    timeout = setTimeout(() => lifecycle.fail(new Error('Devin ACP catalog metadata timed out.')), 20_000);
    await lifecycle.initialize(connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
      clientInfo: { name: 'kalio-model-catalog', version: '1.0.0' },
    }));
    const response = await lifecycle.initialize(connection.agent.request(methods.agent.session.new, {
      cwd: config.cwd, mcpServers: [],
    }));
    const models = readDevinSelectableModels(response.configOptions);
    const selector = response.configOptions?.find(option => option.category === 'model' || option.id === 'model');
    // ACP lists one model per family; the other reasoning levels only appear as thought_level after selecting it.
    const levelsByModel = new Map<string, string[]>();
    for (const model of models) {
      if (model.startsWith('fusion-') || !/-(?:low|medium|high|xhigh|max)$/.test(model) || !selector) continue;
      const probed = await lifecycle.initialize(connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId: response.sessionId, configId: selector.id, value: model,
      }));
      const thought = probed.configOptions?.find(option => option.id === 'thought_level' || option.category === 'thought_level');
      if (thought?.type === 'select') {
        levelsByModel.set(model, thought.options.flatMap(option => 'group' in option ? option.options : [option]).map(option => option.value));
      }
    }
    return expandDevinModelVariants(models, levelsByModel);
  } finally {
    clearTimeout(timeout);
    await lifecycle.dispose();
  }
}
