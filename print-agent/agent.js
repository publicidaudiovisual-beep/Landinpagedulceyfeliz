const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs/promises');
const { createReceipt, archiveBlocks, billingData } = require('./receipt');

const endpoint = process.env.PRINT_AGENT_URL;
const token = process.env.PRINT_AGENT_TOKEN;
const printer = process.env.PRINT_AGENT_PRINTER;
const archiveDir = process.env.PRINT_AGENT_ARCHIVE_DIR;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function validateConfig() {
  const url = new URL(endpoint);
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password) {
    throw new Error('PRINT_AGENT_URL debe usar HTTPS (HTTP solo se admite para pruebas locales).');
  }
  if (!token || token.length < 32) throw new Error('PRINT_AGENT_TOKEN debe tener al menos 32 caracteres.');
  if (!printer || !printer.trim()) throw new Error('Falta PRINT_AGENT_PRINTER.');
  if (!archiveDir || !path.isAbsolute(archiveDir)) throw new Error('Falta una ruta absoluta en PRINT_AGENT_ARCHIVE_DIR.');
}

async function request(body) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error || `Error HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function printerCommand(lines, printerName = printer, archivePath = '') {
  return new Promise((resolve, reject) => {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'print-receipt.ps1'), '-PrinterName', printerName];
    if (!lines) args.push('-CheckOnly');
    if (archivePath) args.push('-ArchivePath', archivePath);
    const child = spawn('powershell.exe', args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 2048); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `Error de impresora (${code}).`)));
    child.stdin.on('error', reject);
    child.stdin.end(lines ? JSON.stringify(lines) : '');
  });
}

async function verifyPdf(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    const signature = Buffer.alloc(5);
    await handle.read(signature, 0, signature.length, 0);
    if (stat.size < 512 || signature.toString() !== '%PDF-') throw new Error('El PDF generado no es válido.');
  } finally {
    await handle.close();
  }
}

async function savePdf(blocks, finalPath, claimId) {
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  try {
    await verifyPdf(finalPath);
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const tempPath = `${finalPath}.${claimId}.tmp.pdf`;
  try {
    await printerCommand(blocks, 'Microsoft Print to PDF', tempPath);
    await verifyPdf(tempPath);
    try {
      await fs.link(tempPath, finalPath);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await verifyPdf(finalPath);
    }
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

async function saveArchive(job) {
  const filename = `DF-${String(job.order.orderNumber).padStart(6, '0')}-${job.id}.pdf`;
  await savePdf(archiveBlocks(job.order), path.join(archiveDir, filename), job.claimId);
  if (job.order.paymentMethod === 'Sistema Nave de Galicia / MODO'
    && job.order.paymentStatus === 'APPROVED' && job.paymentId) {
    const billing = billingData(job);
    await savePdf(billing.blocks, path.join(archiveDir, 'Datos para facturar - no fiscal', billing.month, filename), job.claimId);
  }
}

async function run() {
  validateConfig();
  console.log('Servicio de impresión iniciado. No se mostrarán datos de clientes en el registro.');
  while (true) {
    try {
      await printerCommand(null, 'Microsoft Print to PDF');
      const result = await request({ action: 'claim' });
      if (!Object.prototype.hasOwnProperty.call(result, 'job')) throw new Error('La cola devolvió una respuesta inválida.');
      const { job } = result;
      if (!job) { await wait(10000); continue; }
      if (!/^[0-9a-f-]{36}$/i.test(job.id) || !/^[0-9a-f-]{36}$/i.test(job.claimId)
        || !job.order || typeof job.order !== 'object') {
        throw new Error('La reserva de impresión es inválida; revisá la cola en el panel.');
      }
      console.log(`Trabajo ${job.id} reservado. Enviando a la impresora.`);
      try {
        await saveArchive(job);
        while (true) {
          try {
            await printerCommand(null);
            break;
          } catch (error) {
            console.error(`Impresora no disponible; el PDF del trabajo ${job.id} está guardado. Se reintentará: ${error.message}`);
            await wait(10000);
          }
        }
        const receipt = createReceipt(job.order);
        const items = [{ type: 'logo' }, ...receipt.blocks,
          ...receipt.codes.map(code => ({ type: 'qr', label: code.label, matrix: code.matrix }))];
        await printerCommand(items);
      } catch (error) {
        console.error(`No se pudo enviar el trabajo ${job.id}: ${error.message}. Revisá el panel antes de reintentar.`);
        process.exitCode = 1;
        return;
      }
      while (true) {
        try {
          const confirmation = await request({ action: 'finish', id: job.id, claimId: job.claimId });
          if (confirmation.sent !== true) throw new Error('La cola no confirmó el trabajo.');
          console.log(`Trabajo ${job.id} enviado a la cola de Windows.`);
          break;
        } catch (error) {
          if (error.status === 401 || error.status === 409) throw error;
          console.error(`No se pudo confirmar el envío del trabajo ${job.id}. Se reintentará: ${error.message}`);
          await wait(10000);
        }
      }
    } catch (error) {
      if (error.status === 401 || error.status === 409) throw error;
      console.error(`Servicio de impresión: ${error.message}`);
      await wait(10000);
    }
  }
}

run().catch(error => {
  console.error(`Servicio de impresión detenido: ${error.message}`);
  process.exitCode = 1;
});
