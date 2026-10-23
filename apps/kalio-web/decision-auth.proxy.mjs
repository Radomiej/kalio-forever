export const decisionProtectedRoute = '^/api/(?:decision/(?:auth|config)|hitl/config|runtime/default-profile|memory/project-context/settings|memory/project-resources/[^/]+/(?:status|index|search))/?(?:\\?.*)?$';

export function decisionProtectedProxy(target) {
  return {
    [decisionProtectedRoute]: {
      target, changeOrigin: false,
      bypass(req, res) {
        const peer = req.socket.remoteAddress;
        const port = req.socket.localPort;
        const hosts = ['localhost', '127.0.0.1', '[::1]'].map((host) => `${host}:${port}`);
        const origin = req.headers.origin;
        let originMatches = origin === undefined;
        if (typeof origin === 'string') {
          originMatches = [`http://${req.headers.host}`, `https://${req.headers.host}`].includes(origin);
        }
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
          || !port || !hosts.includes(req.headers.host) || !originMatches) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ code: 'DECISION_ORIGIN_DENIED' }));
          // Vite's string bypass checks writableEnded; false would overwrite 403 with 404.
          return req.url ?? '/';
        }
        return undefined;
      },
    },
  };
}
