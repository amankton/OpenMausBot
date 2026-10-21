// Trusted stdio transport: the member credential remains in the lifecycle vault.
import readline from 'node:readline';
import { ChiefPairingRuntime, PairingError } from './chief-pairing.ts';
import { hulyToolDefinitions } from './huly-tools.ts';

const directory = process.env.CHIEF_HULY_DIRECTORY, origin = process.env.CHIEF_HULY_ORIGIN, botId = process.env.CHIEF_HULY_BOT;
if (!directory || !origin || !botId) throw new Error('Huly member connection is not configured');
const runtime = new ChiefPairingRuntime({ directory, origin, hasBot: id => id === botId });
const send = (id: unknown, result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
async function handle(message: Record<string, unknown>) {
  if (message.id === undefined) return;
  const params = message.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
  if (message.method === 'initialize') return send(message.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'chief-huly', version: '1.0.0' } });
  if (message.method === 'tools/list') return send(message.id, { tools: hulyToolDefinitions });
  if (message.method === 'ping') return send(message.id, {});
  if (message.method !== 'tools/call') return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported method' } }) + '\n');
  try {
    if (!params?.name || !hulyToolDefinitions.some(tool => tool.name === params.name)) throw new Error();
    const args = params.arguments ?? {};
    let result: unknown;
    if (params.name === 'connections') {
      if (Object.keys(args).length) throw new Error();
      result = { connections: runtime.list().filter(c => c.state === 'active' && c.bots.includes(botId!) && c.scopes.includes('tracker:read') && Date.parse(c.expiresAt) > Date.now()).map(c => ({ connectionId: c.id, workspace: c.workspace, scopes: c.scopes, expiresAt: c.expiresAt })) };
    } else {
      const { connectionId, ...input } = args;
      if (typeof connectionId !== 'string') throw new Error();
      result = await runtime.tracker(connectionId, botId!, params.name, input);
    }
    send(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }], isError: false });
  } catch (error) {
    send(message.id, { content: [{ type: 'text', text: error instanceof PairingError ? error.message : 'Huly tool unavailable or invalid; inspect the saved task before retrying writes.' }], isError: true });
  }
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  if (Buffer.byteLength(line) > 32768) return;
  try { void handle(JSON.parse(line)).catch(() => {}); } catch { /* Invalid frames cannot execute a tool. */ }
});
