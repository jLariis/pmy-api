import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Habilita `allowSameDayPreRegistrationFedexEvents` (persistencia FedEx del mismo día) en las
 * sucursales que operan DESDE la bodega de FedEx y capturan la salida a ruta TARDE.
 *
 * Sin el flag, el Time Shield conserva el EN_RUTA de captura tardía aunque FedEx ya reportó el
 * desenlace real del MISMO día operativo. Caso 383562128973 (Bodega Hermosillo): FedEx marcó
 * `rechazado` (07) a las 18:47 local, y 27 min después la salida a ruta puso `en_ruta` (19:14);
 * el paquete quedaba pegado en EN_RUTA en el cierre y su ingreso de rechazado no nacía.
 *
 * La migración 052 solo prendió el flag para "Hermosillo" (y EXCLUYÓ "Bodega Hermosillo" con
 * guard `isWarehouse = 0`). Por decisión de negocio se extiende a: Bodega Hermosillo, Caborca,
 * Puerto Peñasco, Santa Ana y Sonoyta. OJO: "Bodega Hermosillo" es `isWarehouse = 1`, así que NO
 * se filtra por isWarehouse; se targetea por nombre exacto (sin nombres duplicados en la tabla).
 *
 * "Hermosillo" se incluye por idempotencia (ya viene en 1 desde la 052). La columna ya existe
 * (la creó la 052), por eso aquí solo se hace el UPDATE de datos.
 */
export class EnablePersistenceForFedexBodegaSubsidiaries1786000000071 implements MigrationInterface {
  name = 'EnablePersistenceForFedexBodegaSubsidiaries1786000000071'

  /** Adicionales a "Hermosillo" (que ya la trae de la 052). */
  private static readonly NAMES = [
    'Bodega Hermosillo', 'Caborca', 'Puerto Peñasco', 'Santa Ana', 'Sonoyta',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`allowSameDayPreRegistrationFedexEvents\` = 1
       WHERE \`name\` IN (?, ?, ?, ?, ?)`,
      EnablePersistenceForFedexBodegaSubsidiaries1786000000071.NAMES,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revierte SOLO las que esta migración prendió; "Hermosillo" lo gestiona la 052.
    await queryRunner.query(
      `UPDATE \`subsidiary\` SET \`allowSameDayPreRegistrationFedexEvents\` = 0
       WHERE \`name\` IN (?, ?, ?, ?, ?)`,
      EnablePersistenceForFedexBodegaSubsidiaries1786000000071.NAMES,
    );
  }
}
