// The native messaging host. Chrome starts it when Shizue connects and closes its stdin when the
// connection ends. It passes requests from the socket to Shizue and answers back to whoever asked.
// stdout belongs to Chrome, so anything else goes to stderr.
import { rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { bridgeSocket, encodeFrame, frameDecoder, lineDecoder, MAX_MESSAGE_TO_CHROME } from './protocol.mjs';

const path = bridgeSocket();

// A host that is running answers; one that crashed left a dead socket behind.
const anotherHostRuns = () =>
  new Promise((resolve) => {
    const probe = createConnection(path);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });

if (await anotherHostRuns()) {
  console.error(`Another browser is already connected at ${path}.`);
  process.exit(1);
}
rmSync(path, { force: true });

const askers = new Map();

const server = createServer((client) => {
  const reply = (response) => client.write(`${JSON.stringify(response)}\n`);
  client.on(
    'data',
    lineDecoder((request) => {
      const frame = encodeFrame(request);
      if (frame.length > MAX_MESSAGE_TO_CHROME) {
        reply({ id: request.id, error: 'This request is too large for Chrome to take.' });
        return;
      }
      askers.set(request.id, client);
      process.stdout.write(frame);
    })
  );
  client.on('error', () => {});
  client.on('close', () => {
    for (const [id, asker] of askers) if (asker === client) askers.delete(id);
  });
});
server.listen(path);

process.stdin.on(
  'data',
  frameDecoder((response) => {
    askers.get(response.id)?.write(`${JSON.stringify(response)}\n`);
    askers.delete(response.id);
  })
);
process.stdin.on('end', () => {
  rmSync(path, { force: true });
  process.exit(0);
});
