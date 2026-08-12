import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrige la FECHA de los ingresos de traslado (tyco/aeropuerto/traslado especial) que
 * quedaron anclados a medianoche UTC (00:00Z) en vez de medianoche de Hermosillo (07:00Z).
 *
 * Contexto: `TransferService.create` guardaba `income.date = transferDate` tal cual, y
 * `transferDate` llega como un "día flotante" = medianoche UTC. Como todo el sistema
 * (dashboard, KPIs y tabla de ingresos) ancla el día a las 07:00Z, esos ingresos caían
 * en el bucket del día ANTERIOR y "desaparecían" del día del traslado.
 *
 * Este backfill suma 7 horas SOLO a las filas afectadas (traslados con hora exacta
 * 00:00:00). Es idempotente: tras correr, la hora pasa a 07:00:00 y ya no vuelve a
 * moverse. Los ingresos nuevos ya se guardan correctos (helper `hermosilloDayStartUtc`).
 */
export class FixTransferIncomeDates1786000000046 implements MigrationInterface {
  name = 'FixTransferIncomeDates1786000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`income\`
         SET \`date\` = DATE_ADD(\`date\`, INTERVAL 7 HOUR)
       WHERE \`sourceType\` IN ('tyco', 'aeropuerto', 'special_transfer')
         AND TIME(\`date\`) = '00:00:00'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible: regresa las 7 horas SOLO a los traslados anclados a 07:00:00.
    await queryRunner.query(
      `UPDATE \`income\`
         SET \`date\` = DATE_SUB(\`date\`, INTERVAL 7 HOUR)
       WHERE \`sourceType\` IN ('tyco', 'aeropuerto', 'special_transfer')
         AND TIME(\`date\`) = '07:00:00'`,
    );
  }
}
