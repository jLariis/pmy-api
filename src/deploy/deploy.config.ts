import { tmpdir } from 'os';
import { join } from 'path';

/** Configuración del despliegue (todo por .env, con defaults sensatos). */
export function deployConfig() {
  const apiDir = process.env.DEPLOY_API_DIR || process.cwd();
  const port = process.env.PORT || 3001;
  return {
    enabled: process.env.DEPLOY_ENABLED === '1',
    apiDir,
    webDir: process.env.DEPLOY_WEB_REPO_DIR || null,
    pm2Name: process.env.DEPLOY_PM2_NAME || 'pmy-api',
    logDir:
      process.env.DEPLOY_LOG_DIR || (process.platform === 'win32' ? join(tmpdir(), 'pmy-deploy') : '/var/lib/pmy-deploy'),
    healthUrl: process.env.DEPLOY_HEALTH_URL || `http://127.0.0.1:${port}/api/system/release/current`,
    script: process.env.DEPLOY_SCRIPT || join(apiDir, 'deploy', 'pmy-deploy.sh'),
  };
}
