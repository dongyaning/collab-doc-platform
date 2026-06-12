import { createServer } from 'node:http';
import { PROJECT_NAME } from '@collab/shared';

const PORT = Number(process.env.PORT ?? 3000);

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ project: PROJECT_NAME, milestone: 'M0', ok: true }));
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
