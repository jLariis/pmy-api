import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import { dirname } from 'path';

const DESIRED_PATH = process.env.POWER_DESIRED_PATH || '/var/lib/pmy-power/desired.json';
const APPLY_BIN = process.env.POWER_APPLY_BIN || '/usr/local/sbin/pmy-power-apply';
const SUSPEND_NOW_BIN = process.env.POWER_SUSPEND_NOW_BIN || '/usr/local/sbin/pmy-power-suspend-now';

@Injectable()
export class PowerApplyRunner {
  async writeDesired(desired: object): Promise<void> {
    await fsp.mkdir(dirname(DESIRED_PATH), { recursive: true }).catch(() => undefined);
    await fsp.writeFile(DESIRED_PATH, JSON.stringify(desired, null, 2), 'utf8');
  }

  apply(): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
    return this.run('sudo', ['-n', APPLY_BIN]);
  }

  /** Suspende YA (arma RTC al próximo wake e ignora el flag enabled). */
  suspendNow(): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
    return this.run('sudo', ['-n', SUSPEND_NOW_BIN]);
  }

  async isTimerActive(): Promise<boolean> {
    const r = await this.run('systemctl', ['is-active', 'pmy-power-suspend.timer']);
    return r.stdout.trim() === 'active';
  }

  private run(
    cmd: string,
    args: string[],
  ): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      const child = spawn(cmd, args);
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', (e) =>
        resolve({ ok: false, stdout, stderr: stderr + String(e), code: -1 }),
      );
      child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr, code: code ?? -1 }));
    });
  }
}
