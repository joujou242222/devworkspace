const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dgram = require('node:dgram');
const [output, secret, unrelated, readonly, profile, port, udpPort] = process.argv.slice(2);
const results = { environment: Object.keys(process.env).sort(), files: {}, network: {} };
function denied(name, action) {
  try {
    action();
    results.files[name] = 'UNEXPECTED_ACCESS';
  } catch (error) {
    results.files[name] = error.code;
  }
}
denied('projectSecret', () => fs.readFileSync(secret));
denied('unrelatedRead', () => fs.readFileSync(unrelated));
denied('unrelatedWrite', () => fs.appendFileSync(unrelated, 'unauthorized'));
denied('toolWrite', () => fs.appendFileSync(readonly, 'unauthorized'));
denied('workRootWrite', () =>
  fs.mkdirSync(path.join(path.dirname(process.cwd()), 'escape-' + process.pid)),
);
denied('jobDirectoryDelete', () => {
  const job = process.cwd();
  process.chdir(path.dirname(readonly));
  try {
    fs.rmdirSync(job);
  } finally {
    process.chdir(job);
  }
});
denied('profileRootWrite', () =>
  fs.writeFileSync(path.join(path.dirname(profile), 'phase4-root-probe.txt'), 'unauthorized'),
);
denied('profileWrite', () =>
  fs.writeFileSync(path.join(profile, 'phase4-negative-probe.txt'), 'unauthorized'),
);
fs.writeFileSync(output, JSON.stringify(results));
async function tcp(name, host, target) {
  await new Promise((resolve) => {
    const socket = net.createConnection({ host, port: target });
    const timer = setTimeout(() => {
      results.network[name] = 'TIMEOUT_NOT_PROOF';
      socket.destroy();
      resolve();
    }, 3000);
    socket.on('connect', () => {
      results.network[name] = 'UNEXPECTED_CONNECTION';
      clearTimeout(timer);
      socket.destroy();
      resolve();
    });
    socket.on('error', (error) => {
      results.network[name] = error.code;
      clearTimeout(timer);
      resolve();
    });
  });
}
(async () => {
  await Promise.all([
    tcp('loopback', '127.0.0.1', Number(port)),
    tcp('internet', '1.1.1.1', 443),
    tcp('privateNetwork', '192.168.1.1', 443),
  ]);
  fs.writeFileSync(output, JSON.stringify(results));
  await new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      results.network.udp = 'TIMEOUT_NOT_PROOF';
      socket.close();
      resolve();
    }, 3000);
    socket.on('error', (error) => {
      results.network.udp = error.code;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {}
      resolve();
    });
    socket.send(Buffer.from('isolated'), Number(udpPort ?? port), '127.0.0.1', (error) => {
      results.network.udp = error?.code ?? 'SEND_ACCEPTED';
      clearTimeout(timer);
      socket.close();
      resolve();
    });
  });
  fs.writeFileSync(output, JSON.stringify(results));
  process.exit(0);
})();
