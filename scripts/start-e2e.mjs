process.env.VITE_ALLOW_ANONYMOUS = 'true';
process.env.SSO_REQUIRED = '0';
process.env.PORT = process.env.PORT || '4173';

await import('../dist-server/server/index.js');