import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';

/**
 * Lanza el script de despliegue DESPRENDIDO de este proceso: `setsid -f` hace un doble
 * fork y el script queda colgado de init, así el `pm2 restart` (que mata el árbol de
 * procesos de la API) no lo interrumpe.
 */
@Injectable()
export class DeployRunner {
  launch(script: string, args: string[]): void {
    const child = spawn('setsid', ['-f', 'bash', script, ...args], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
  }
}
