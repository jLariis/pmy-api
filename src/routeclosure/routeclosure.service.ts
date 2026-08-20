import { Injectable, Logger, BadRequestException, InternalServerErrorException  } from '@nestjs/common';
import { CreateRouteclosureDto } from './dto/create-routeclosure.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { RouteClosure } from 'src/entities/route-closure.entity';
import { DataSource, Repository } from 'typeorm';
import { ValidateTrackingsForClosureDto } from './dto/validate-trackings-for-closure';
import { PackageDispatch } from 'src/entities/package-dispatch.entity';
import { ValidatedPackageDispatchDto } from 'src/package-dispatch/dto/validated-package-dispatch.dto';
import { ShipmentStatusType } from 'src/common/enums/shipment-status-type.enum';
import { DhlStatusType } from 'src/common/enums/dhl-status-type.enum';
import { mapDhlCodeToInternal } from 'src/utils/dhl.utils';
import { ShipmentStatus, Collection, Shipment, Income, ChargeShipment, ShipmentNotInFiles } from 'src/entities';
import { DispatchStatus } from 'src/common/enums/dispatch-enum';
import { MailService } from 'src/mail/mail.service';
import { fromZonedTime } from 'date-fns-tz';
import { hermosilloDayStartFromInstant, toHermosilloDateString } from 'src/common/utils';
import { ShipmentType } from 'src/common/enums/shipment-type.enum';
import { IncomeStatus } from 'src/common/enums/income-status.enum';
import { IncomeSourceType } from 'src/common/enums/income-source-type.enum';
import { FedexService } from 'src/shipments/fedex.service';
import { TemplateService } from 'src/documents/template.service';
import { buildRouteClosureData, RouteClosureInput, RouteClosurePackage, RouteClosureNoVanPackage } from 'src/documents/data/route-closure.mapper';
import { noVanIncomeDecision, NoVanFedexOutcome } from './novan-income.util';
import { TrackingCompareService } from 'src/tracking-sync/tracking-compare.service';
import { ApplyActor } from 'src/tracking-sync/sinks/persistent-sync.sink';
import { TrackableKind } from 'src/tracking-sync/tracking-sync.types';
import { ApplyOutcome } from 'src/tracking-sync/compare.types';
import { reconcileShipmentIncomeAction, ExistingShipmentIncome } from './income-reconcile.util';

@Injectable()
export class RouteclosureService {
  private readonly logger = new Logger(RouteclosureService.name);

  constructor(
    @InjectRepository(RouteClosure)
    private readonly routeClouseRepository: Repository<RouteClosure>,
    @InjectRepository(PackageDispatch)
    private readonly packageDispatchRepository: Repository<PackageDispatch>,
    private readonly mailService: MailService,
    private readonly fedexService: FedexService,
    private readonly dataSource: DataSource,
    private readonly templateService: TemplateService,
    private readonly trackingCompare: TrackingCompareService,
  ) {}

  /**
   * AL ABRIR el cierre a ruta: reconcilia contra FedEx el último estatus de TODAS las guías
   * de la salida (shipments normales Y F2/charge), y PERSISTE el estatus correcto (historial
   * + status) vía tracking-sync (selección de generación + candado de terminal + idempotente
   * + auditado). Así el `EN_RUTA` interno recién puesto ya no le gana al estatus real de FedEx
   * del mismo día (bug histórico del cierre).
   *
   * Regla 31.5: si la ruta es `is315` (todo F2), NO se revalidan los shipments normales, solo
   * los F2. Nunca lanza por FedEx (cada guía resuelve su outcome), para no romper la apertura.
   */
  async reconcileRouteWithFedex(packageDispatchId: string, actor: ApplyActor) {
    const dispatch = await this.packageDispatchRepository.findOne({
      where: { id: packageDispatchId },
      relations: ['subsidiary'],
    });
    if (!dispatch) {
      throw new BadRequestException(`El despacho con ID ${packageDispatchId} no existe.`);
    }

    const kinds: TrackableKind[] = dispatch.is315 ? ['charge'] : ['shipment', 'charge'];
    this.logger.log(
      `🔄 [RouteClosure] Reconciliando ruta ${packageDispatchId} con FedEx (is315=${!!dispatch.is315}, kinds=${kinds.join(',')})...`,
    );

    const outcomes = await this.trackingCompare.applyByRoute(packageDispatchId, actor, { kinds });
    const updated = outcomes.filter((o) => o.applied).length;
    this.logger.log(
      `✅ [RouteClosure] Reconciliación de ruta ${packageDispatchId}: ${updated}/${outcomes.length} guías actualizadas.`,
    );

    // Reconciliación de INGRESOS (solo shipments; is315 no toca nada; ENTREGADO > DEX mismo día).
    const income = await this.reconcileRouteIncome(dispatch, outcomes, actor.userId);

    return {
      packageDispatchId,
      is315: !!dispatch.is315,
      total: outcomes.length,
      updated,
      incomeCreated: income.incomeCreated,
      incomeSuperseded: income.incomeSuperseded,
      outcomes,
    };
  }

  /**
   * Estatus "no entregado" que SÍ cobran (espejo de generateIncomes en shipments.service):
   * el resto de desenlaces no-entregados (03, 17, 84, operativos, etc.) no generan ingreso aquí.
   */
  private static readonly CHARGEABLE_NON_DELIVERY: ShipmentStatusType[] = [
    ShipmentStatusType.RECHAZADO,
    ShipmentStatusType.CLIENTE_NO_DISPONIBLE,
    ShipmentStatusType.DEVUELTO_A_FEDEX,
    ShipmentStatusType.NO_ENTREGADO,
  ];

  /** Deriva el outcome FedEx (para noVanIncomeDecision) desde el estatus reconciliado. */
  private buildOutcomeForIncome(o: ApplyOutcome): NoVanFedexOutcome {
    const status = o.toStatus;
    const delivered = status === ShipmentStatusType.ENTREGADO;
    const isChargeableDex =
      !delivered && !!status && RouteclosureService.CHARGEABLE_NON_DELIVERY.includes(status);
    return {
      trackingNumber: o.trackingNumber,
      delivered,
      dexCode: isChargeableDex ? (o.exceptionCode || null) : null,
      resolved: !!status,
    };
  }

  /**
   * Reconcilia los INGRESOS de la ruta tras persistir estatus. Solo shipments (los charge/F2 no
   * cobran); `is315` no toca nada. Backfill de faltantes + precedencia ENTREGADO>DEX del mismo
   * día (actualiza la fila DEX en su lugar). Idempotente. Nunca lanza por guía.
   */
  private async reconcileRouteIncome(
    dispatch: PackageDispatch,
    outcomes: ApplyOutcome[],
    userId?: string,
  ): Promise<{ incomeCreated: number; incomeSuperseded: number }> {
    if (dispatch.is315) {
      this.logger.log('🟡 [RouteClosure] Ruta 31.5: no se reconcilian ingresos.');
      return { incomeCreated: 0, incomeSuperseded: 0 };
    }

    const shipmentOutcomes = outcomes.filter((o) => o.kind !== 'charge');
    const cost = dispatch.subsidiary?.fedexCostPackage ?? 0;
    const incomeRepo = this.dataSource.getRepository(Income);
    let incomeCreated = 0;
    let incomeSuperseded = 0;

    for (const o of shipmentOutcomes) {
      try {
        const decision = noVanIncomeDecision(this.buildOutcomeForIncome(o));
        if (!decision) continue;

        const instant = o.eventAt
          ? new Date(o.eventAt)
          : (dispatch.routeDate ?? dispatch.createdAt ?? new Date());
        const deliveryDay = toHermosilloDateString(instant);
        const incomeDate = hermosilloDayStartFromInstant(instant);

        const existingRows = await incomeRepo.find({
          where: { trackingNumber: o.trackingNumber, sourceType: IncomeSourceType.SHIPMENT },
        });
        const existing: ExistingShipmentIncome = {
          entregado: existingRows.some((r) => r.incomeType === IncomeStatus.ENTREGADO),
          dex: (() => {
            const dexRow = existingRows.find((r) => r.incomeType === IncomeStatus.NO_ENTREGADO);
            return dexRow ? { id: dexRow.id, day: toHermosilloDateString(dexRow.date) } : undefined;
          })(),
        };

        const action = reconcileShipmentIncomeAction({ decision, deliveryDay, existing });
        if (action.type === 'none') continue;

        if (cost <= 0) {
          this.logger.error(
            `❌ FINANCE_ERROR: La sucursal "${dispatch.subsidiary?.name ?? dispatch.subsidiary?.id}" tiene fedexCostPackage=0; ` +
            `el ingreso de la guía ${o.trackingNumber} se registró en $0. Revisa la configuración de costo FedEx.`,
          );
        }

        if (action.type === 'create') {
          await incomeRepo.save(
            incomeRepo.create({
              trackingNumber: o.trackingNumber,
              subsidiary: dispatch.subsidiary,
              shipmentType: ShipmentType.FEDEX,
              cost,
              incomeType: action.incomeType,
              nonDeliveryStatus: action.nonDeliveryStatus,
              isGrouped: false,
              sourceType: IncomeSourceType.SHIPMENT,
              shipment: { id: o.shipmentId } as Shipment,
              date: incomeDate,
              createdById: userId ?? null,
            }),
          );
          incomeCreated++;
        } else if (action.type === 'supersede') {
          await incomeRepo.update(action.incomeId, {
            incomeType: IncomeStatus.ENTREGADO,
            nonDeliveryStatus: null,
            date: incomeDate,
          });
          incomeSuperseded++;
        }
      } catch (err: any) {
        this.logger.warn(`⚠️ [RouteClosure] No se pudo reconciliar el ingreso de ${o.trackingNumber}: ${err?.message}`);
      }
    }

    this.logger.log(
      `💰 [RouteClosure] Ingresos reconciliados en ${dispatch.id}: ${incomeCreated} creados, ${incomeSuperseded} reemplazados.`,
    );
    return { incomeCreated, incomeSuperseded };
  }

  async create(createRouteclosureDto: CreateRouteclosureDto, userId?: string) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      this.logger.log('🟡 [RouteClosure] Iniciando proceso de cierre de ruta...');

      // 1. Validar el Despacho
      const packageDispatch = await queryRunner.manager.findOne(PackageDispatch, {
        where: { id: createRouteclosureDto.packageDispatch.id },
        relations: ['subsidiary'],
      });

      if (!packageDispatch) {
        throw new BadRequestException(`El despacho con ID ${createRouteclosureDto.packageDispatch.id} no existe.`);
      }

      // 2. Actualizar estado del Despacho
      packageDispatch.status = DispatchStatus.COMPLETADA;
      packageDispatch.closedAt = new Date();
      await queryRunner.manager.save(PackageDispatch, packageDispatch);

      // 3. Preparar datos para RouteClosure
      const trackingNumbers = createRouteclosureDto.collections.map(item => 
        typeof item === 'string' ? item : (item as any).trackingNumber
      );

      // Filtramos los arreglos usando la propiedad isCharge para evitar errores de FK
      // 1. Filtramos los POD: Solo dejamos lo que NO es Charge y NO es No VAN
      const validPodShipments = createRouteclosureDto.podPackages
        .filter(pkg => {
          const isCharge = (pkg as any).isCharge;
          const isNoVan = typeof (pkg as any).id === 'string' && (pkg as any).id.startsWith('novan-');
          // SOLO permitimos los que existen en la tabla 'shipment'
          return !isCharge && !isNoVan;
        })
        .map(pkg => ({ id: typeof pkg === 'string' ? pkg : (pkg as any).id }));

      const validReturnedShipments = createRouteclosureDto.returnedPackages
        .filter(pkg => {
          const isCharge = (pkg as any).isCharge;
          const isNoVan = typeof (pkg as any).id === 'string' && (pkg as any).id.startsWith('novan-');
          return !isCharge && !isNoVan;
        })
        .map(pkg => ({ id: typeof pkg === 'string' ? pkg : (pkg as any).id }));

      const newRouteClosure = queryRunner.manager.create(RouteClosure, {
        ...createRouteclosureDto,
        podPackages: validPodShipments,
        returnedPackages: validReturnedShipments,
        collections: trackingNumbers,
        subsidiary: packageDispatch.subsidiary,
        createdById: userId ?? null,
      });

      const savedClosure = await queryRunner.manager.save(RouteClosure, newRouteClosure);

      // El ingreso del cierre (DHL, recolecciones y No VAN) pertenece al DÍA DE LA RUTA,
      // ahora fijado explícitamente al crear la salida a ruta (packageDispatch.routeDate).
      // Fallback a createdAt para rutas viejas sin la prop; last-resort hoy. Anclamos al
      // inicio de día Hermosillo (07:00Z) para caer en el bucket correcto del dashboard.
      const routeIncomeDate = hermosilloDayStartFromInstant(
        packageDispatch.routeDate ?? packageDispatch.createdAt ?? new Date(),
      );

      // Pre-resolución FedEx de los No VAN: solo si la ruta NO es 31.5 (si es 31.5 no cobran).
      // Las llamadas FedEx son de solo lectura, acotadas al # de No VAN de la ruta. Si FedEx
      // falla, el outcome sale resolved=false y esa guía simplemente no cobra (el cierre no
      // se rompe). Se resuelve aquí, antes de generar los ingresos.
      const noVanInputs = (createRouteclosureDto.noVanPackages ?? []).map(pkg =>
        typeof pkg === 'string' ? { trackingNumber: pkg } : pkg,
      );
      let noVanOutcomes: NoVanFedexOutcome[] = [];
      if (!packageDispatch.is315 && noVanInputs.length > 0) {
        noVanOutcomes = await Promise.all(
          noVanInputs.map(n => this.resolveNoVanOutcome(n.trackingNumber)),
        );
      }

      // =====================================================================
      // 🛡️ GUARDAR PAQUETES NO VAN (ShipmentNotInFiles)
      // =====================================================================
      if (createRouteclosureDto.noVanPackages && createRouteclosureDto.noVanPackages.length > 0) {
        this.logger.log(`🟡 [RouteClosure] Registrando ${createRouteclosureDto.noVanPackages.length} paquetes No VAN...`);
        
        const noVanEntities = createRouteclosureDto.noVanPackages.map(pkg => {
          // Extraemos el tracking independientemente de si pkg viene como objeto o string (por seguridad)
          const tNumber = typeof pkg === 'string' ? pkg : (pkg as any).trackingNumber;

          return queryRunner.manager.create(ShipmentNotInFiles, {
            trackingNumber: tNumber,
            subsidiary: packageDispatch.subsidiary,
            subsidiaryId: packageDispatch.subsidiary.id,
            dispatchId: packageDispatch.id,
            routeClosureId: savedClosure.id,
          });
        });

        await queryRunner.manager.save(ShipmentNotInFiles, noVanEntities);
        this.logger.log(`🟢 [RouteClosure] ${noVanEntities.length} registros insertados en shipment_not_in_files.`);

        // Ingreso de No VAN — espejo del patrón DHL: se guarda SIEMPRE el costo completo +
        // código; qué CUENTA lo decide charge_rule en lectura. Solo si la ruta NO es 31.5.
        if (packageDispatch.is315) {
          this.logger.log('🟡 [RouteClosure] Ruta 31.5: los No VAN NO generan ingreso.');
        } else {
          const noVanCost = packageDispatch.subsidiary?.fedexCostPackage ?? 0;
          const noVanIncomes = [];
          for (const outcome of noVanOutcomes) {
            // Decisión pura (probada en novan-income.util.spec): null ⇒ no se genera ingreso
            // (sin validación FedEx, o en tránsito sin entregar ni DEX).
            const decision = noVanIncomeDecision(outcome);
            if (!decision) {
              if (!outcome.resolved) {
                this.logger.warn(`⚠️ [RouteClosure] No VAN ${outcome.trackingNumber} sin estatus FedEx; no se cobra.`);
              }
              continue;
            }

            const existingIncome = await queryRunner.manager.findOne(Income, {
              where: {
                trackingNumber: outcome.trackingNumber,
                sourceType: IncomeSourceType.SHIPMENT,
              },
            });
            if (existingIncome) {
              this.logger.warn(`⚠️ [RouteClosure] Ya existe ingreso (shipment) para No VAN ${outcome.trackingNumber}. Omitiendo.`);
              continue;
            }

            // Alerta de configuración: si debe cobrar pero la sucursal tiene costo 0,
            // el ingreso se registra en $0 (consistente con el FINANCE_ERROR de DHL/FedEx).
            if (noVanCost <= 0) {
              this.logger.error(
                `❌ FINANCE_ERROR: La sucursal "${packageDispatch.subsidiary?.name ?? packageDispatch.subsidiary?.id}" tiene fedexCostPackage=0; ` +
                `el ingreso No VAN de la guía ${outcome.trackingNumber} se registró en $0. Revisa la configuración de costo FedEx.`,
              );
            }

            noVanIncomes.push(queryRunner.manager.create(Income, {
              trackingNumber: outcome.trackingNumber,
              subsidiary: packageDispatch.subsidiary,
              shipmentType: ShipmentType.FEDEX,
              cost: noVanCost,
              incomeType: decision.incomeType,
              nonDeliveryStatus: decision.nonDeliveryStatus,
              isGrouped: false,
              sourceType: IncomeSourceType.SHIPMENT,
              date: routeIncomeDate, // día de la RUTA, no del cierre
              createdById: userId ?? null,
            }));
          }

          if (noVanIncomes.length > 0) {
            await queryRunner.manager.save(Income, noVanIncomes);
            this.logger.log(`🟢 [RouteClosure] Se crearon ${noVanIncomes.length} ingresos de No VAN.`);
          }
        }
      }

      // 4. Crear registros independientes en la tabla 'Collection' + su INGRESO.
      if (trackingNumbers.length > 0) {
        const now = new Date();
        const utcDate = fromZonedTime(now, 'America/Hermosillo');
        const collectionsToInsert = trackingNumbers.map(tn => {
          return queryRunner.manager.create(Collection, {
            trackingNumber: tn,
            subsidiary: packageDispatch.subsidiary,
            status: 'COLECTADO_EN_CIERRE',
            isPickUp: true,
            createdAt: utcDate,
            createdById: userId ?? null,
          });
        });

        const savedCollections = await queryRunner.manager.save(Collection, collectionsToInsert);
        this.logger.log(`🟢 [RouteClosure] Se insertaron ${savedCollections.length} registros en la tabla Collection.`);

        // 4.1 Ingreso por recolección — MISMA REGLA que el flujo directo
        // (collections.service): sourceType=collection, costo = fedexCostPackage de la
        // sucursal. Antes las recolecciones del cierre NO generaban ingreso (solo se
        // insertaba la Collection), por eso no aparecían en finanzas › ingresos. Se ancla
        // al DÍA DE LA RUTA (routeIncomeDate) igual que el ingreso DHL. Guard por
        // (trackingNumber, sourceType=collection) para no duplicar si la guía ya tenía
        // ingreso de recolección.
        //
        // REGLA 31.5: si la ruta es `is315`, las recolecciones se SIGUEN registrando
        // (arriba) pero NO generan ingreso — espejo del criterio de los No VAN, donde la
        // ruta 31.5 tampoco cobra. Fuera de 31.5 el cobro es el de siempre.
        if (packageDispatch.is315) {
          this.logger.log('🟡 [RouteClosure] Ruta 31.5: las recolecciones NO generan ingreso.');
        } else {
          const collectionCost = packageDispatch.subsidiary?.fedexCostPackage ?? 0;

          // Alerta de configuración: si la sucursal tiene costo 0, los ingresos de
          // recolección se registran en $0 (consistente con el FINANCE_ERROR de DHL/FedEx).
          if (collectionCost <= 0) {
            this.logger.error(
              `❌ FINANCE_ERROR: La sucursal "${packageDispatch.subsidiary?.name ?? packageDispatch.subsidiary?.id}" tiene fedexCostPackage=0; ` +
              `los ingresos de recolección del cierre se registraron en $0. Revisa la configuración de costo FedEx.`,
            );
          }

          const collectionIncomes = [];
          for (const collection of savedCollections) {
            const existingIncome = await queryRunner.manager.findOne(Income, {
              where: {
                trackingNumber: collection.trackingNumber,
                sourceType: IncomeSourceType.COLLECTION,
              },
            });

            if (existingIncome) {
              this.logger.warn(`⚠️ [RouteClosure] Ya existe ingreso de recolección para ${collection.trackingNumber}. Omitiendo cobro.`);
              continue;
            }

            collectionIncomes.push(queryRunner.manager.create(Income, {
              trackingNumber: collection.trackingNumber,
              subsidiary: packageDispatch.subsidiary,
              shipmentType: ShipmentType.FEDEX,
              cost: collectionCost,
              incomeType: IncomeStatus.ENTREGADO,
              isGrouped: false,
              sourceType: IncomeSourceType.COLLECTION,
              collection: { id: collection.id },
              date: routeIncomeDate, // día de la RUTA, no del cierre
              createdById: userId ?? null,
            }));
          }

          if (collectionIncomes.length > 0) {
            await queryRunner.manager.save(Income, collectionIncomes);
            this.logger.log(`🟢 [RouteClosure] Se crearon ${collectionIncomes.length} ingresos de recolección.`);
          }
        }
      }

      // ==========================================
      // 5. PROCESAR PAQUETES DHL (Cobros y Estatus)
      // ==========================================
      this.logger.log('🟡 [RouteClosure] Evaluando paquetes DHL para actualización e ingresos...');

      // `code` = código propio de DHL (OK/NH/BA/RD/CM). `isCharge` = la pieza es un
      // ChargeShipment (carga), NO significa "cobrar". `isDelivered` = de qué lista vino
      // (pod = entregado), se usa como RESPALDO seguro si el frontend aún no manda `code`:
      // pod sin código → OK; returned sin código → no entregado, sin cobro (nunca "todos OK").
      const packagesToProcess = [
        ...createRouteclosureDto.podPackages.map(pkg => ({
          id: typeof pkg === 'string' ? pkg : (pkg as any).id,
          code: (pkg as any).code as DhlStatusType | undefined,
          isCharge: (pkg as any).isCharge,
          isDelivered: true,
        })),
        ...createRouteclosureDto.returnedPackages.map(pkg => ({
          id: typeof pkg === 'string' ? pkg : (pkg as any).id,
          code: (pkg as any).code as DhlStatusType | undefined,
          isCharge: (pkg as any).isCharge,
          isDelivered: false,
        }))
      ];

      let processedDhlCount = 0;

      for (const item of packagesToProcess) {
        if (!item.id) continue;

        let pPackage = null;

        if (item.isCharge) {
          pPackage = await queryRunner.manager.findOne(ChargeShipment, {
            where: { id: item.id },
            relations: ['subsidiary']
          });
        } else {
          pPackage = await queryRunner.manager.findOne(Shipment, {
            where: { id: item.id },
            relations: ['subsidiary']
          });
        }

        if (pPackage && pPackage.shipmentType === ShipmentType.DHL) {
          processedDhlCount++;

          // Traductor DHL → capa canónica interna. Respaldo si no viene `code`:
          // pod → OK; returned → no entregado (sin código).
          const dhlCode = item.code ?? (item.isDelivered ? DhlStatusType.OK : null);
          const { internalStatus } = dhlCode
            ? mapDhlCodeToInternal(dhlCode)
            : { internalStatus: ShipmentStatusType.NO_ENTREGADO };
          const isDeliveredDhl = internalStatus === ShipmentStatusType.ENTREGADO;

          // REGLA DE NEGOCIO: las CARGAS (ChargeShipment) NO generan ingreso por paquete.
          // El ingreso solo se crea para envíos (Shipment). Las cargas solo actualizan
          // su estatus/historial más abajo.
          if (!item.isCharge) {
            const existingIncome = await queryRunner.manager.findOne(Income, {
              where: {
                trackingNumber: pPackage.trackingNumber,
                sourceType: IncomeSourceType.SHIPMENT
              }
            });

            if (existingIncome) {
              this.logger.warn(`⚠️ [RouteClosure] El ingreso para el tracking DHL ${pPackage.trackingNumber} ya existe. Omitiendo cobro.`);
            } else {
              // CONSISTENTE CON FEDEX: se guarda SIEMPRE el costo completo (con código);
              // qué CUENTA como ingreso lo decide `charge_rule` en lectura (isCountableIncome
              // / espejo SQL en kpi.service). Así se puede prender el cobro de un no-entregado
              // DHL desde Configuración sin tocar código. `nonDeliveryStatus` guarda el CÓDIGO
              // DHL (RD/NH/BA/CM), alfabético → nunca choca con los DEX numéricos de FedEx.
              // Sin código (returned sin `code`) → costo 0 (no facturable, no hay regla que aplicar).
              const calculatedCost = dhlCode ? (pPackage.subsidiary?.dhlCostPackage ?? 0) : 0;

              // Alerta de configuración: si el paquete DEBERÍA cobrar (tiene código DHL)
              // pero la sucursal tiene costo 0, se genera un ingreso en $0 silencioso.
              // Consistente con el FINANCE_ERROR del flujo FedEx (shipments.service).
              if (dhlCode && calculatedCost <= 0) {
                this.logger.error(
                  `❌ FINANCE_ERROR: La sucursal "${pPackage.subsidiary?.name ?? pPackage.subsidiary?.id}" tiene dhlCostPackage=0; ` +
                  `el ingreso DHL de la guía ${pPackage.trackingNumber} se registró en $0. Revisa la configuración de costo DHL.`,
                );
              }

              const newIncome = queryRunner.manager.create(Income, {
                trackingNumber: pPackage.trackingNumber,
                subsidiary: pPackage.subsidiary,
                shipmentType: pPackage.shipmentType,
                cost: calculatedCost,
                incomeType: isDeliveredDhl ? IncomeStatus.ENTREGADO : IncomeStatus.NO_ENTREGADO,
                nonDeliveryStatus: isDeliveredDhl ? null : dhlCode,
                isGrouped: false,
                sourceType: IncomeSourceType.SHIPMENT,
                shipment: pPackage as Shipment,
                date: routeIncomeDate, // día de la RUTA, no del cierre
                createdById: userId ?? null,
              });

              await queryRunner.manager.save(Income, newIncome);
            }
          }

          // Historial: fila shipment_status con el código DHL en `exceptionCode` (trazabilidad).
          const history = new ShipmentStatus();
          history.status = internalStatus;
          history.exceptionCode = dhlCode ?? '';
          history.timestamp = new Date();
          if (item.isCharge) history.chargeShipment = pPackage as ChargeShipment;
          else history.shipment = pPackage as Shipment;
          await queryRunner.manager.save(ShipmentStatus, history);

          // Estatus canónico interno en la entidad (agnóstico al carrier).
          if (item.isCharge) {
            await queryRunner.manager.update(ChargeShipment, { id: item.id }, { status: internalStatus });
          } else {
            await queryRunner.manager.update(Shipment, { id: item.id }, { status: internalStatus });
          }
        }
      }

      this.logger.log(`🟢 [RouteClosure] Se procesaron ${processedDhlCount} paquetes de DHL.`);

      // 6. Finalizar transacción
      await queryRunner.commitTransaction();
      this.logger.log(`✅ [RouteClosure] Cierre de ruta completado con éxito: ${savedClosure.id}`);

      return savedClosure;

    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`🔴 [RouteClosure] Error crítico procesando el cierre: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Error al procesar el cierre: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(subsidiaryId: string) {
    return await this.routeClouseRepository.find({
      where: {
        subsidiary: {
          id: subsidiaryId
        }
      }
    });
  }

  async findOne(id: string) {
    return await this.routeClouseRepository.findOne({
      where: {
        id
      }
    });
  }

  async validateTrackingNumbersForClosure(
    validateTrackingForClosure: ValidateTrackingsForClosureDto
  ) {
    const validatedPackages: ValidatedPackageDispatchDto[] = [];
    const podPackages: ValidatedPackageDispatchDto[] = [];

    const packageDispatch = await this.packageDispatchRepository.findOne({
      where: { id: validateTrackingForClosure.packageDispatchId },
      relations: [
        'shipments', 
        'shipments.statusHistory', 
        'shipments.payment',
        'chargeShipments', 
        'chargeShipments.statusHistory',
        'chargeShipments.payment'
      ],
    });

    // Primero validamos los trackings enviados
    for (const tracking of validateTrackingForClosure.trackingNumbers) {
      let isValid = true;
      let reason = '';
      let lastHistory: ShipmentStatus;

      const foundTracking = packageDispatch.shipments.find(
        (s) => s.trackingNumber === tracking
      );

      if (!foundTracking) {
        isValid = false;
        reason = 'no encontró el número de guía en la salida a ruta';
      } else if (foundTracking.status === ShipmentStatusType.ENTREGADO) {
        isValid = false;
        reason = 'el número de guía ya fue entregado';
      } else if (foundTracking.status === ShipmentStatusType.NO_ENTREGADO) {
        const orderedHistory = foundTracking.statusHistory.sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        lastHistory = orderedHistory[0];

        const hasValidDex =
          lastHistory &&
          lastHistory.status === ShipmentStatusType.NO_ENTREGADO &&
          ['03', '07', '08'].includes(lastHistory.exceptionCode);

        if (!hasValidDex) {
          isValid = false;
          reason = 'el paquete no tiene un DEX válido en su última historia (03, 07 o 08)';
        }
      }

      validatedPackages.push({
        id: foundTracking?.id,
        trackingNumber: foundTracking?.trackingNumber ?? tracking,
        jd: (foundTracking as any)?.dhlUniqueId || undefined,
        commitDateTime: foundTracking?.commitDateTime,
        consNumber: foundTracking?.consNumber,
        isHighValue: foundTracking?.isHighValue,
        priority: foundTracking?.priority,
        recipientAddress: foundTracking?.recipientAddress,
        recipientCity: foundTracking?.recipientCity,
        recipientName: foundTracking?.recipientName,
        recipientPhone: foundTracking?.recipientPhone,
        recipientZip: foundTracking?.recipientZip,
        shipmentType: foundTracking?.shipmentType,
        subsidiary: foundTracking?.subsidiary,
        status: foundTracking?.status,
        isValid,
        reason,
        payment: foundTracking?.payment,
        lastHistory,
      });
    }

    // Ahora agregamos a podPackages los que NO fueron enviados pero ya están entregados.
    // Recorremos ENVÍOS **y CARGAS** (antes solo shipments) para que los ENTREGADOS se
    // cuenten completos aún cuando sean DHL o cargas. Es agnóstico al carrier.
    const userTrackingsSet = new Set(validateTrackingForClosure.trackingNumbers);
    const deliveredCandidates: any[] = [
      ...(packageDispatch.shipments ?? []),
      ...((packageDispatch as any).chargeShipments ?? []),
    ];

    for (const s of deliveredCandidates) {
      if (!userTrackingsSet.has(s.trackingNumber) && s.status === ShipmentStatusType.ENTREGADO) {
        podPackages.push({
          id: s.id,
          trackingNumber: s.trackingNumber,
          jd: s.dhlUniqueId || undefined,
          commitDateTime: s.commitDateTime,
          consNumber: s.consNumber,
          isHighValue: s.isHighValue,
          priority: s.priority,
          recipientAddress: s.recipientAddress,
          recipientCity: s.recipientCity,
          recipientName: s.recipientName,
          recipientPhone: s.recipientPhone,
          recipientZip: s.recipientZip,
          shipmentType: s.shipmentType,
          subsidiary: s.subsidiary,
          status: s.status,
          isValid: true,
          reason: 'Paquete ya entregado',
          payment: s.payment,
        });
      }
    }

    return { validatedPackages, podPackages };
  }

  async validateTrackingNumbersNoVan(noVanTrackingNumbers: string[]) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      return await Promise.all(
        noVanTrackingNumbers.map(async (tn) => {
          // 1. Obtener el mejor estatus de FedEx con arbitraje Header vs Scans
          const fedexStatus = await this.getBestFedexStatus(tn);
          
          // 2. Buscar en BD local para metadata (isCharge)
          const dbInfo = await this.findPackageInLocalDB(queryRunner, tn);

          const isValid = !!fedexStatus || !!dbInfo;

          // 3. Normalización de estatus (Traducción a "entregado")
          let rawStatus = (fedexStatus || dbInfo?.status || 'NOT_FOUND').toLowerCase();
          
          if (rawStatus.includes('delivered') || rawStatus.includes('delivery')) {
            rawStatus = 'Entregado';
          }

          return {
            trackingNumber: tn,
            isValid,
            status: rawStatus,
            isCharge: dbInfo?.isCharge || false,
            reason: isValid ? null : 'Guía no encontrada en FedEx ni en Sistema'
          };
        })
      );
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Devuelve el trackResult "ganador" de FedEx (mejor generación, con reintento label-only)
   * o null. Arbitraje compartido por `getBestFedexStatus` (string para UI) y
   * `resolveNoVanOutcome` (códigos para ingreso).
   */
  private async getWinningTrackResult(trackingNumber: string): Promise<any | null> {
    let response = await this.fedexService.trackPackage(trackingNumber);
    let results = response?.output?.completeTrackResults?.[0]?.trackResults || [];

    // 1. Manejo de reintentos (label-only: solo OC con <=1 scan)
    const isLabelOnly = results.some(r => r.latestStatusDetail?.code === 'OC' && (r.scanEvents?.length || 0) <= 1);
    if (results.length === 0 || isLabelOnly) {
      const retry = await this.fedexService.trackPackage(trackingNumber, undefined);
      results = retry?.output?.completeTrackResults?.[0]?.trackResults || results;
    }

    if (results.length === 0) return null;

    // 2. Selección de la generación (UniqueID): la secuencia más alta = generación más reciente.
    if (results.length > 1) {
      results.sort((a, b) => {
        const seqA = parseInt(a.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
        const seqB = parseInt(b.trackingNumberInfo?.trackingNumberUniqueId?.split('~')[0] || '0');
        return seqB - seqA;
      });
    }

    return results[0];
  }

  /**
   * Resuelve el estatus FedEx AUTORITATIVO de una guía "No VAN" para decidir el ingreso.
   * Trabaja sobre los CÓDIGOS de FedEx (no el string lossy de `getBestFedexStatus`):
   *  - Entregado: header/scan 'DL' ⇒ delivered=true.
   *  - Excepción de entrega (DEX): header/scan 'DE' ⇒ dexCode = código específico (03/07/08…).
   *  - Otro estatus (tránsito, etc.): resolved=true, sin cobro por código.
   *  - No encontrado / error: resolved=false ⇒ no se cobra.
   */
  private async resolveNoVanOutcome(trackingNumber: string): Promise<NoVanFedexOutcome> {
    try {
      const winner = await this.getWinningTrackResult(trackingNumber);
      if (!winner) {
        return { trackingNumber, delivered: false, dexCode: null, resolved: false };
      }

      const headerCode = winner.latestStatusDetail?.code; // p.ej. 'DL' (entregado), 'DE' (excepción)
      const scans = winner.scanEvents || [];
      const latestScan = [...scans].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      )[0];

      // Entregado.
      if (headerCode === 'DL' || latestScan?.eventType === 'DL') {
        return { trackingNumber, delivered: true, dexCode: null, resolved: true };
      }

      // Excepción de entrega (DEX): extraer el código específico.
      if (headerCode === 'DE' || latestScan?.eventType === 'DE') {
        const specificCode = latestScan?.exceptionCode
          || winner.latestStatusDetail?.ancillaryDetails?.[0]?.reason
          || null;
        return { trackingNumber, delivered: false, dexCode: specificCode, resolved: true };
      }

      // Otro estatus: resuelto pero sin código que aplicar.
      return { trackingNumber, delivered: false, dexCode: null, resolved: true };
    } catch (error) {
      this.logger.error(`[NoVan:${trackingNumber}] resolveNoVanOutcome error: ${error.message}`);
      return { trackingNumber, delivered: false, dexCode: null, resolved: false };
    }
  }

  private async getBestFedexStatus(trackingNumber: string): Promise<string | null> {
    try {
      const winner = await this.getWinningTrackResult(trackingNumber);
      if (!winner) return null;

      // =================================================================================
      // 🛡️ EXTRACCIÓN DE ESTATUS Y CÓDIGOS DE EXCEPCIÓN
      // =================================================================================
      
      // Obtenemos los scans ordenados para tener la "verdad" del terreno
      const scans = winner.scanEvents || [];
      const sortedScans = [...scans].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      const latestScan = sortedScans[0];

      // Datos del Header
      const headerCode = winner.latestStatusDetail?.code; // Ej: "DE"
      const headerDesc = (winner.latestStatusDetail?.description || '').trim();

      // Si es una excepción ("DE" - Delivery Exception), buscamos el código específico (07, 03, etc.)
      if (headerCode === 'DE' || latestScan?.eventType === 'DE') {
        // Prioridad 1: Código en el Scan más reciente
        // Prioridad 2: Motivo en Ancillary Details del Header
        const specificCode = latestScan?.exceptionCode || winner.latestStatusDetail?.ancillaryDetails?.[0]?.reason;
        
        if (specificCode) {
          this.logger.log(`[NoVan:${trackingNumber}] Excepción detectada. Código: ${specificCode}`);
          return `DEX ${specificCode}`; // Retornamos "DEX 07", "DEX 03", etc.
        }
      }

      // --- ARBITRAJE ESTÁNDAR SI NO ES EXCEPCIÓN ---
      const headerStatus = (winner.latestStatusDetail?.statusByLocale || winner.latestStatusDetail?.description || '').trim();
      const scanStatus = (latestScan?.derivedStatus || latestScan?.eventDescription || '').trim();

      if (scanStatus && headerStatus.toLowerCase() !== scanStatus.toLowerCase()) {
        return scanStatus;
      }

      return headerStatus || scanStatus || 'UNKNOWN';

    } catch (error) {
      this.logger.error(`[NoVan:${trackingNumber}] Error en arbitraje: ${error.message}`);
      return null;
    }
  }

  private async findPackageInLocalDB(queryRunner: any, tn: string) {
    const tables = ['shipment', 'charge_shipment'];
    for (const table of tables) {
      const res = await queryRunner.query(
        `SELECT status FROM ${table} WHERE trackingNumber = ? ORDER BY createdAt DESC LIMIT 1`,
        [tn]
      );
      if (res.length > 0) return { status: res[0].status, isCharge: table === 'charge_shipment' };
    }
    return null;
}

  async sendByEmail(pdfFile: Express.Multer.File, excelFile: Express.Multer.File, routeClosureId: string){
    const routeClosure = await this.routeClouseRepository.findOne(
      {
        where: {
          id: routeClosureId
        },
        relations: ['subsidiary', 'packageDispatch', 'packageDispatch.drivers']
      });

    // Unificación "Cierre de Ruta": detrás de flag, el backend genera PDF/Excel por el
    // Motor de Plantillas (plantilla canónica única). Si algo falla, se conservan los
    // archivos subidos por el frontend (respaldo). Flag OFF => comportamiento actual intacto.
    if (process.env.DOC_ENGINE_ROUTE_CLOSURE === 'true') {
      try {
        const input = await this.loadRouteClosureInput(routeClosureId);
        const gen = await this.renderRouteClosureDocuments(input);
        if (gen.pdf) pdfFile = { ...pdfFile, buffer: gen.pdf };
        if (gen.excel) excelFile = { ...excelFile, buffer: gen.excel };
      } catch (e: any) {
        this.logger.warn(`Motor route_closure falló; uso archivos subidos: ${e?.message}`);
      }
    }

    return await this.mailService.sendHighPriorityRouteClosureEmail(pdfFile, excelFile, routeClosure);
  }

  /** Genera PDF+Excel de "Cierre de Ruta" por el motor. Si un formato no entrega buffer, queda undefined (respaldo). */
  async renderRouteClosureDocuments(input: RouteClosureInput): Promise<{ pdf?: Buffer; excel?: Buffer }> {
    const data = buildRouteClosureData(input);
    const [pdf, excel] = await Promise.all([
      this.templateService.render('route_closure_pdf', data).then((r) => r.buffer).catch(() => undefined),
      this.templateService.render('route_closure_excel', data).then((r) => r.buffer).catch(() => undefined),
    ]);
    return { pdf, excel };
  }

  /**
   * Carga el RouteClosure + su despacho y arma el RouteClosureInput (espejo backend de
   * RouteClosurePDF/generateRouteClosureExcel). `payment` incluido en las relations de
   * shipments/chargeShipments/returnedPackages/podPackages (cobros del data-provider).
   *
   * Gaps conocidos (no rompen: flag OFF por defecto):
   * - `ShipmentNotInFiles` (paquetes "No VAN") no persiste `status` (solo transitorio en el
   *   flujo de validación FedEx del frontend) → se manda vacío ('N/A').
   * - Los ChargeShipment devueltos/entregados NO están en `returnedPackages`/`podPackages`
   *   (limitación existente de esas relaciones M2M, ver comentario en `create()`); sí cuentan
   *   en `allPackages` (para conteos totales/cobros).
   */
  private async loadRouteClosureInput(routeClosureId: string): Promise<RouteClosureInput> {
    const closure = await this.routeClouseRepository.findOne({
      where: { id: routeClosureId },
      relations: [
        'subsidiary',
        'packageDispatch', 'packageDispatch.drivers', 'packageDispatch.routes', 'packageDispatch.vehicle', 'packageDispatch.subsidiary',
        'packageDispatch.shipments', 'packageDispatch.shipments.payment',
        'packageDispatch.chargeShipments', 'packageDispatch.chargeShipments.payment',
        'returnedPackages', 'returnedPackages.payment', 'returnedPackages.statusHistory',
        'podPackages', 'podPackages.payment',
      ],
    });

    const lastExceptionCode = (s: any): string | undefined => {
      const history = (s.statusHistory ?? []).slice().sort(
        (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      return history[0]?.exceptionCode || undefined;
    };
    const mapPkg = (s: any): RouteClosurePackage => ({
      trackingNumber: s.trackingNumber,
      jd: s.dhlUniqueId || undefined, // JD (pieza DHL): principal para DHL
      recipientName: s.recipientName,
      recipientAddress: s.recipientAddress,
      recipientPhone: s.recipientPhone,
      commitDateTime: s.commitDateTime ? new Date(s.commitDateTime).toISOString() : undefined,
      shipmentType: s.shipmentType,
      status: s.status,
      exceptionCode: lastExceptionCode(s),
      payment: s.payment ? { amount: s.payment.amount, type: s.payment.type } : null,
    });

    const dispatch = closure?.packageDispatch;
    const allPackages: RouteClosurePackage[] = [
      ...((dispatch as any)?.shipments ?? []).map(mapPkg),
      ...((dispatch as any)?.chargeShipments ?? []).map(mapPkg),
    ];

    // POD/Entregados del segundo step. `closure.podPackages` (M2M) solo guarda ENVÍOS
    // (las cargas se excluyen al crear por la limitación de FK). Para que los ENTREGADOS
    // se cuenten completos —incluidas las CARGAS y DHL— sumamos las cargas del despacho
    // con estatus ENTREGADO. Dedup por tracking para no contar doble.
    const deliveredCharges: RouteClosurePackage[] = ((dispatch as any)?.chargeShipments ?? [])
      .filter((c: any) => c.status === ShipmentStatusType.ENTREGADO)
      .map(mapPkg);
    const podFromClosure: RouteClosurePackage[] = (closure?.podPackages ?? []).map(mapPkg);
    const podSeen = new Set(podFromClosure.map((p) => p.trackingNumber));
    const podPackages: RouteClosurePackage[] = [
      ...podFromClosure,
      ...deliveredCharges.filter((p) => !podSeen.has(p.trackingNumber)),
    ];

    // "No VAN" (ShipmentNotInFiles): no es relation de RouteClosure, se consulta aparte por routeClosureId.
    let noVanPackages: RouteClosureNoVanPackage[] = [];
    try {
      const noVanRows = await this.dataSource.getRepository(ShipmentNotInFiles).find({ where: { routeClosureId } });
      noVanPackages = noVanRows.map((r) => ({ trackingNumber: r.trackingNumber, status: 'N/A' }));
    } catch (e: any) {
      this.logger.warn(`No se pudieron cargar paquetes No VAN para ${routeClosureId}: ${e?.message}`);
    }

    return {
      subsidiaryName: closure?.subsidiary?.name ?? dispatch?.subsidiary?.name ?? 'N/A',
      vehicleName: dispatch?.vehicle?.name,
      drivers: (dispatch?.drivers ?? []).map((d: any) => ({ name: d.name })),
      routes: (dispatch?.routes ?? []).map((r: any) => ({ name: r.name })),
      trackingNumber: dispatch?.trackingNumber ?? '',
      kmsInitial: dispatch?.kms,
      kmsFinal: closure?.actualKms,
      dispatchCreatedAt: dispatch?.createdAt,
      allPackages,
      returnedPackages: (closure?.returnedPackages ?? []).map(mapPkg),
      podPackages,
      noVanPackages,
      collections: closure?.collections ?? [],
    };
  }

  async remove(id: string) {
    return await this.routeClouseRepository.delete(id);
  }
}
