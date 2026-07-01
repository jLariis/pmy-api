import { Injectable } from '@nestjs/common';
import * as os from 'os';
import { promises as fsp } from 'fs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CpuSnap { idle: number; total: number }

function cpuSnap(): CpuSnap {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const t of Object.values(c.times)) total += t as number;
    idle += c.times.idle;
  }
  return { idle, total };
}

/** Bytes rx/tx acumulados (Linux /proc/net/dev). Null en SO sin ese archivo (ej. Windows dev). */
async function readNet(): Promise<{ rx: number; tx: number } | null> {
  try {
    const data = await fsp.readFile('/proc/net/dev', 'utf8');
    let rx = 0;
    let tx = 0;
    for (const line of data.split('\n')) {
      const m = line.match(/^\s*([^:]+):\s*(.*)$/);
      if (!m) continue;
      const iface = m[1].trim();
      if (iface === 'lo') continue; // ignora loopback
      const cols = m[2].trim().split(/\s+/).map(Number);
      rx += cols[0] || 0; // bytes recibidos
      tx += cols[8] || 0; // bytes transmitidos
    }
    return { rx, tx };
  } catch {
    return null;
  }
}

async function diskUsage(): Promise<{ total: number; used: number; free: number; pct: number } | null> {
  try {
    const path = process.platform === 'win32' ? 'C:\\' : '/';
    const s: any = await (fsp as any).statfs(path);
    const total = s.blocks * s.bsize;
    const free = s.bfree * s.bsize;
    const used = total - free;
    return { total, used, free, pct: total ? (used / total) * 100 : 0 };
  } catch {
    return null;
  }
}

@Injectable()
export class ServerStatsService {
  /** Toma una muestra "instantánea" (ventana de 300ms) de uso del servidor. */
  async snapshot() {
    const cpu1 = cpuSnap();
    const net1 = await readNet();
    const t1 = Date.now();

    await sleep(300);

    const cpu2 = cpuSnap();
    const net2 = await readNet();
    const dt = (Date.now() - t1) / 1000;

    const idleD = cpu2.idle - cpu1.idle;
    const totalD = cpu2.total - cpu1.total;
    const cpuPct = totalD > 0 ? Math.max(0, Math.min(100, (1 - idleD / totalD) * 100)) : 0;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    let network: { rxBytesPerSec: number; txBytesPerSec: number; rxTotal: number; txTotal: number } | null = null;
    if (net1 && net2 && dt > 0) {
      network = {
        rxBytesPerSec: Math.max(0, (net2.rx - net1.rx) / dt),
        txBytesPerSec: Math.max(0, (net2.tx - net1.tx) / dt),
        rxTotal: net2.rx,
        txTotal: net2.tx,
      };
    }

    const disk = await diskUsage();
    const load = os.loadavg();
    const cpus = os.cpus();

    return {
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      platform: process.platform,
      uptimeSec: Math.round(os.uptime()),
      cpu: {
        usagePct: cpuPct,
        cores: cpus.length,
        model: cpus[0]?.model?.trim() ?? '',
        loadAvg: { '1m': load[0], '5m': load[1], '15m': load[2] },
      },
      memory: { total: totalMem, used: usedMem, free: freeMem, pct: totalMem ? (usedMem / totalMem) * 100 : 0 },
      disk,
      network,
    };
  }
}
