import { cp, mkdir } from 'node:fs/promises';
await mkdir('public', { recursive: true });
await cp('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdf.worker.min.mjs');
await cp('node_modules/pdfjs-dist/cmaps', 'public/pdf-cmaps', { recursive: true });
await cp('node_modules/pdfjs-dist/standard_fonts', 'public/pdf-fonts', { recursive: true });
