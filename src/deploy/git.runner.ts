import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';

/** git de solo lectura (fetch/log/show/diff/status). El despliegue real lo hace el script. */
@Injectable()
export class GitRunner {
  git(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        { cwd, timeout: 60_000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        (err, stdout, stderr) => {
          if (err) reject(new Error((stderr || err.message).toString().trim()));
          else resolve(stdout.toString());
        },
      );
    });
  }
}
