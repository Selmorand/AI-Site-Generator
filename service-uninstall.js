const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
  name: 'AI Site Generator',
  script: path.join(__dirname, 'src', 'server.ts'),
});

svc.on('uninstall', () => {
  console.log('Service uninstalled.');
});

svc.uninstall();
