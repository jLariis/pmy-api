import { ConfigService } from '@nestjs/config';
import { BackupService } from './backup.service';

/** ConfigService falso: devuelve lo que haya en el mapa, si no cae a undefined. */
const makeConfig = (values: Record<string, any> = {}): ConfigService =>
  ({ get: (k: string) => values[k] }) as unknown as ConfigService;

describe('BackupService.computePercent (barra de progreso por fases)', () => {
  it('cada fase arranca en la suma de los pesos previos', () => {
    expect(BackupService.computePercent('connect', 0)).toBe(0);
    expect(BackupService.computePercent('download', 0)).toBe(5);
    expect(BackupService.computePercent('prepare', 0)).toBe(60);
    expect(BackupService.computePercent('restore', 0)).toBe(65);
  });

  it('la última fase completa llega a 100', () => {
    expect(BackupService.computePercent('restore', 1)).toBe(100);
  });

  it('interpola dentro de la fase según la fracción', () => {
    expect(BackupService.computePercent('download', 0.5)).toBe(33); // 5 + 55*0.5 = 32.5 → 33
    expect(BackupService.computePercent('restore', 0.5)).toBe(83); // 65 + 35*0.5 = 82.5 → 83
  });

  it('acota la fracción fuera de rango a [0,1]', () => {
    expect(BackupService.computePercent('download', -1)).toBe(5);
    expect(BackupService.computePercent('restore', 5)).toBe(100);
  });
});

describe('BackupService.isRestoreAllowed (candado dev-only)', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('permite restore fuera de producción con el flag en 1', () => {
    const svc = new BackupService(makeConfig({ NODE_ENV: 'development', BACKUP_ALLOW_RESTORE: '1' }));
    expect(svc.isRestoreAllowed()).toBe(true);
  });

  it('rechaza si NODE_ENV es production aunque esté el flag', () => {
    const svc = new BackupService(makeConfig({ NODE_ENV: 'production', BACKUP_ALLOW_RESTORE: '1' }));
    expect(svc.isRestoreAllowed()).toBe(false);
  });

  it('rechaza si falta el flag', () => {
    const svc = new BackupService(makeConfig({ NODE_ENV: 'development' }));
    expect(svc.isRestoreAllowed()).toBe(false);
  });

  it('rechaza en producción por defecto (sin config)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.BACKUP_ALLOW_RESTORE;
    const svc = new BackupService(makeConfig());
    expect(svc.isRestoreAllowed()).toBe(false);
  });
});
