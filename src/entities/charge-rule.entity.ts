import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Regla de COBRO por (carrier, código de estatus), agnóstica al transportista.
 * Reemplaza a las columnas fijas `subsidiary.chargeDex03/07/08/chargeDelivered`
 * y extiende el mismo modelo a DHL (y a cualquier carrier/código futuro).
 *
 *  - `carrier`      = valor de ShipmentType ('fedex' | 'dhl' | 'other').
 *  - `code`         = 'DELIVERED' (pseudo-código para entregado) o el código de
 *                     no-entrega tal como se guarda en `income.nonDeliveryStatus`
 *                     (FedEx: '03'/'07'/'08'…; DHL: 'NH'/'BA'/'RD'/'CM'…).
 *  - `chargeable`   = ¿ese estatus CUENTA como ingreso?
 *  - `subsidiaryId` = NULL → default GLOBAL (editable en Configuración).
 *                     con valor → override para esa sucursal (gana sobre el global).
 *
 * Resolución (en lectura): override de sucursal → default global → fallback `true`
 * (mismo comportamiento histórico del `ELSE 1` del espejo SQL).
 */
@Entity('charge_rule')
@Unique(['carrier', 'code', 'subsidiaryId'])
export class ChargeRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  carrier: string;

  @Column()
  code: string;

  @Column({ default: true })
  chargeable: boolean;

  /** NULL = default global; con valor = override por sucursal. */
  @Index()
  @Column({ type: 'char', length: 36, nullable: true })
  subsidiaryId: string | null;

  @Column({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
