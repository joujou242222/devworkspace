import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export const sharp = createRequire(resolve('packages/server/package.json'))('sharp');
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const marker = 'DevWorkspacePhase4HarmlessScannerFixture7D217C1F';
export async function image(format = 'png', color = '#336699', width = 8, height = 6) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    [format]()
    .toBuffer();
}
export function pdf(pages = 1, active = false, width = 200, height = 200) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R' +
      (active ? ' /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >>' : '') +
      ' >>',
    '',
  ];
  const kids = [];
  for (let n = 0; n < pages; n++) {
    kids.push(objects.length + 1 + ' 0 R');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents ` +
        (pages + 3) +
        ' 0 R >>',
    );
  }
  objects[1] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages + ' >>';
  const content = '1 0 0 rg 10 10 80 80 re f\n';
  objects.push(
    '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + 'endstream',
  );
  let source = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source));
    source += index + 1 + ' 0 obj\n' + object + '\nendobj\n';
  });
  const start = Buffer.byteLength(source);
  source +=
    'xref\n0 ' +
    (objects.length + 1) +
    '\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    'trailer\n<< /Size ' +
    (objects.length + 1) +
    ' /Root 1 0 R >>\nstartxref\n' +
    start +
    '\n%%EOF';
  return Buffer.from(source);
}
