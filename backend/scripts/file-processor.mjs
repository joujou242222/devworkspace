// This program is executed only as the restricted AppContainer child.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { getDocument, version as pdfVersion } from 'pdfjs-dist/legacy/build/pdf.mjs';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const directory = process.cwd();
const output = join(directory, 'result.json');
class Rejected extends Error {}
try {
  sharp.cache(false);
  sharp.concurrency(1);
  const intent = JSON.parse(await readFile(join(directory, 'input.json'), 'utf8'));
  const bytes = await readFile(join(directory, 'input.bin'));
  if (bytes.length !== intent.size || hash(bytes) !== intent.digest)
    throw new Rejected('INTEGRITY_MISMATCH');
  const previews = [];
  let width, height, pages;
  const preview = async (data, page, w, h) => {
    if (data.length > 16 * 1024 * 1024) throw new Rejected('PREVIEW_LIMIT');
    const filename = 'page-' + page + '.png';
    await writeFile(join(directory, filename), data);
    previews.push({ filename, page, width: w, height: h, digest: hash(data), size: data.length });
  };
  if (intent.mime === 'application/pdf') {
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Rejected('INVALID_TYPE');
    const base = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url));
    const task = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      stopAtErrors: true,
      maxImageSize: 40000000,
      standardFontDataUrl: join(base, 'standard_fonts').replaceAll('\\', '/') + '/',
      wasmUrl: join(base, 'wasm').replaceAll('\\', '/') + '/',
    });
    const pdf = await task.promise;
    try {
      if (pdf.numPages < 1 || pdf.numPages > 100) throw new Rejected('PDF_PAGE_LIMIT');
      if ((await pdf.getJSActions()) || (await pdf.getAttachments()) || pdf.isPureXfa)
        throw new Rejected('ACTIVE_PDF');
      pages = pdf.numPages;
      for (let index = 1; index <= pages; index++) {
        const page = await pdf.getPage(index);
        if (await page.getJSActions()) throw new Rejected('ACTIVE_PDF');
        const unit = page.getViewport({ scale: 1 });
        if (
          !Number.isFinite(unit.width * unit.height) ||
          unit.width <= 0 ||
          unit.height <= 0 ||
          unit.width * unit.height > 40000000
        )
          throw new Rejected('PDF_GEOMETRY_LIMIT');
        const viewport = page.getViewport({
          scale: Math.min(2, 1600 / Math.max(unit.width, unit.height)),
        });
        const factory = pdf.canvasFactory;
        const target = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        try {
          await page.render({ canvasContext: target.context, viewport }).promise;
          await preview(
            target.canvas.toBuffer('image/png'),
            index,
            target.canvas.width,
            target.canvas.height,
          );
        } finally {
          factory.destroy(target);
          page.cleanup();
        }
      }
    } finally {
      await task.destroy();
    }
  } else {
    const image = sharp(bytes, {
      limitInputPixels: intent.media ? 10000000 : 40000000,
      failOn: 'warning',
      animated: false,
    });
    const meta = await image.metadata();
    if (
      (intent.mime === 'image/png' && meta.format !== 'png') ||
      (intent.mime === 'image/jpeg' && meta.format !== 'jpeg') ||
      !meta.width ||
      !meta.height ||
      (meta.pages ?? 1) > 1
    )
      throw new Rejected('INVALID_IMAGE');
    width = meta.width;
    height = meta.height;
    const normalized = await image
      .rotate()
      .resize({
        width: intent.media ? 512 : 1600,
        height: intent.media ? 512 : 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    await preview(normalized.data, 1, normalized.info.width, normalized.info.height);
  }
  if (previews.reduce((n, p) => n + p.size, 0) > 100 * 1024 * 1024)
    throw new Rejected('PREVIEW_TOTAL_LIMIT');
  await writeFile(
    output,
    JSON.stringify({
      status: 'READY',
      digest: hash(bytes),
      size: bytes.length,
      mime: intent.mime,
      width,
      height,
      pages,
      tool_version: 'sharp-0.35.5/pdfjs-' + pdfVersion,
      previews,
    }),
  );
} catch (error) {
  await writeFile(
    output,
    JSON.stringify({
      status: error instanceof Rejected ? 'REJECTED' : 'FAILED',
      error_code: error instanceof Rejected ? error.message : 'PROCESSOR_FAILED',
    }),
  );
  process.exitCode = 1;
}
