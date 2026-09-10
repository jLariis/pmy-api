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

describe('BackupService.parseTableMarker', () => {
  it('reconoce el marcador de datos de mysqldump', () => {
    expect(BackupService.parseTableMarker('-- Dumping data for table `shipment`')).toBe('shipment');
  });
  it('acepta nombres con guion bajo y dígitos', () => {
    expect(BackupService.parseTableMarker('-- Dumping data for table `package_dispatch_history`')).toBe(
      'package_dispatch_history',
    );
  });
  it('ignora otras líneas del dump', () => {
    expect(BackupService.parseTableMarker('INSERT INTO `shipment` VALUES (1),(2);')).toBeNull();
    expect(BackupService.parseTableMarker('-- Table structure for table `shipment`')).toBeNull();
    expect(BackupService.parseTableMarker('')).toBeNull();
  });
});

describe('BackupService.summarizeTimings', () => {
  it('calcula duración de cada fase hasta la siguiente marca', () => {
    const marks = { connect: 0, download: 100, prepare: 700, restore: 750 };
    expect(BackupService.summarizeTimings(marks, 2000)).toEqual({
      connect: 100,
      download: 600,
      prepare: 50,
      restore: 1250,
    });
  });
  it('omite fases sin marca', () => {
    const marks = { connect: 0, restore: 500 };
    expect(BackupService.summarizeTimings(marks, 900)).toEqual({ connect: 500, restore: 400 });
  });
});

describe('BackupService.buildDumpArgs', () => {
  const db = { host: 'h', port: 3306, username: 'u', password: 'p', database: 'pmy-db' } as any;

  it('pasada 1: ignora tablas de historial, incluye rutinas, sin --where', () => {
    const args = BackupService.buildDumpArgs(db, { routines: true, ignoreTables: ['shipment_status'] });
    expect(args).toContain('--single-transaction');
    expect(args).toContain('--no-autocommit');
    expect(args).toContain('--routines');
    expect(args).toContain('--ignore-table=pmy-db.shipment_status');
    expect(args.some((a) => a.startsWith('--where'))).toBe(false);
    expect(args[args.length - 1]).toBe('pmy-db'); // la BD va al final (sin onlyTable)
  });

  it('pasada 2: solo la tabla, con --where y sin rutinas', () => {
    const args = BackupService.buildDumpArgs(db, {
      routines: false,
      onlyTable: 'shipment_status',
      whereClause: 'createdAt >= NOW() - INTERVAL 7 DAY',
    });
    expect(args).toContain('--where=createdAt >= NOW() - INTERVAL 7 DAY');
    expect(args).toContain('--skip-triggers');
    expect(args).not.toContain('--routines');
    expect(args[args.length - 2]).toBe('pmy-db'); // BD
    expect(args[args.length - 1]).toBe('shipment_status'); // tabla posicional
  });
});
