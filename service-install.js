const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
  name: 'AI Site Generator',
  description: 'AI Site Generator Dashboard - webgen.interon.co.za',
  script: path.join(__dirname, 'src', 'server.ts'),
  nodeOptions: ['--import', 'tsx/esm'],
  env: [{
    name: 'NODE_ENV',
    value: 'production'
  }],
  workingDirectory: __dirname,
});

svc.on('install', () => {
  console.log('Service installed successfully.');
  console.log('Starting service...');
  svc.start();
});

svc.on('start', () => {
  console.log('Service started.');
});

svc.on('error', (err) => {
  console.error('Error:', err);
});

svc.install();
