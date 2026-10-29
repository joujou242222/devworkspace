import net from 'node:net';
/** Bounded local development SMTP adapter. Never logs recipient or body. */
export async function sendLocalMail(
  mail: { to: string; subject: string; text: string },
  port = 1025,
) {
  if (!/^[^\s<>\r\n]+@[^\s<>\r\n]+$/.test(mail.to) || /[\r\n]/.test(mail.subject))
    throw new Error('Invalid mail envelope');
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.setTimeout(10000, () => socket.destroy(new Error('SMTP timeout')));
  let buffer = '';
  let failure: Error | undefined;
  const queued: number[] = [];
  let pending: { resolve: (code: number) => void; reject: (error: Error) => void } | undefined;
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (/^\d{3} /.test(line)) {
        const code = Number(line.slice(0, 3));
        if (pending) {
          pending.resolve(code);
          pending = undefined;
        } else queued.push(code);
      }
    }
  });
  socket.on('error', (error) => {
    failure = error;
    pending?.reject(error);
    pending = undefined;
  });
  socket.on('close', () => {
    if (pending) {
      pending.reject(new Error('SMTP closed'));
      pending = undefined;
    }
  });
  const reply = () =>
    failure
      ? Promise.reject(failure)
      : queued.length
        ? Promise.resolve(queued.shift()!)
        : new Promise<number>((resolve, reject) => {
            pending = { resolve, reject };
          });
  const expect = async (code: number) => {
    if ((await reply()) !== code) throw new Error('SMTP rejected delivery');
  };
  try {
    await expect(220);
    for (const [line, code] of [
      ['EHLO localhost', 250],
      ['MAIL FROM:<noreply@devworkspace.test>', 250],
      [`RCPT TO:<${mail.to}>`, 250],
      ['DATA', 354],
    ] as const) {
      socket.write(line + '\r\n');
      await expect(code);
    }
    const text = mail.text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    socket.write(
      `From: DevWorkspace <noreply@devworkspace.test>\r\nTo: <${mail.to}>\r\nSubject: ${mail.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${text}\r\n.\r\n`,
    );
    await expect(250);
    socket.write('QUIT\r\n');
    await expect(221);
  } finally {
    socket.destroy();
  }
}
