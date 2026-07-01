import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Geolocalización de sucursales (antes hardcodeada en el mapa del dashboard,
 * `components/dashboard/interactive-map.tsx`). Agrega `state`, `latitude` y
 * `longitude` a `subsidiary` y siembra los valores conocidos por nombre. A
 * partir de ahora el mapa lee estas coordenadas de la BD; las sucursales nuevas
 * se geolocalizan desde el módulo de Sucursales.
 */
export class AddSubsidiaryGeolocation1786000000018 implements MigrationInterface {
  name = 'AddSubsidiaryGeolocation1786000000018';

  private readonly columns: { name: string; ddl: string }[] = [
    { name: 'state', ddl: "ADD COLUMN `state` varchar(255) NULL DEFAULT ''" },
    { name: 'latitude', ddl: 'ADD COLUMN `latitude` decimal(10,7) NULL' },
    { name: 'longitude', ddl: 'ADD COLUMN `longitude` decimal(10,7) NULL' },
  ];

  // Coordenadas/estado conocidos, indexados por nombre de sucursal (case-insensitive).
  private readonly seed: { name: string; state: string; lat: number; lng: number }[] = [
    { name: 'Huatabampo', state: 'Sonora', lat: 26.7897, lng: -109.6456 },
    { name: 'Hermosillo', state: 'Sonora', lat: 29.0729, lng: -110.9559 },
    { name: 'Constitucion', state: 'Baja California Sur', lat: 25.0321, lng: -111.6626 },
    { name: 'Loreto', state: 'Baja California Sur', lat: 26.0109, lng: -111.3486 },
    { name: 'Cuidad Obregon', state: 'Sonora', lat: 27.4863, lng: -109.9305 },
    { name: 'Cabo San Lucas', state: 'Baja California Sur', lat: 22.8905, lng: -109.9167 },
    { name: 'Guaymas', state: 'Sonora', lat: 27.9202, lng: -110.9031 },
    { name: 'Navojoa', state: 'Sonora', lat: 27.0739, lng: -109.4444 },
    { name: 'Puerto Peñasco', state: 'Sonora', lat: 31.314, lng: -113.5339 },
    { name: 'Vicam', state: 'Sonora', lat: 27.64354, lng: -110.29351 },
    { name: 'Villa Juarez', state: 'Sonora', lat: 27.12851, lng: -109.83921 },
    { name: 'Pueblo Yaqui', state: 'Sonora', lat: 27.35521, lng: -110.03444 },
    { name: 'Alamos', state: 'Sonora', lat: 27.02326, lng: -108.9344 },
    { name: 'Nogales', state: 'Sonora', lat: 31.3086, lng: -110.9422 },
    { name: 'La Paz', state: 'Baja California Sur', lat: 24.1444, lng: -110.3005 },
    { name: 'Caborca', state: 'Sonora', lat: 30.7167, lng: -112.1583 },
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const col of this.columns) {
      await q.query(`ALTER TABLE \`subsidiary\` ${col.ddl}`).catch((e: any) => {
        // Idempotente: ignora si la columna ya existe en algún entorno.
        if (/Duplicate column name|already exists/i.test(e?.message || '')) return undefined;
        throw e;
      });
    }

    for (const s of this.seed) {
      await q.query(
        'UPDATE `subsidiary` SET `state` = ?, `latitude` = ?, `longitude` = ? WHERE LOWER(`name`) = LOWER(?)',
        [s.state, s.lat, s.lng, s.name],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const col of ['state', 'latitude', 'longitude']) {
      await q.query(`ALTER TABLE \`subsidiary\` DROP COLUMN \`${col}\``).catch(() => undefined);
    }
  }
}
