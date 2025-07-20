/*     private async fetchShipments(trackingNumbers: string[]): Promise<{
      shipments: Shipment[];
      notFoundTracking: string[];
    }> {
      const shipments = await this.shipmentRepository.find({
        where: trackingNumbers.map(tn => ({ trackingNumber: tn })),
        relations: ['subsidiary', 'payment', 'statusHistory'],
      });

      const foundTrackingNumbers = shipments.map(s => s.trackingNumber);
      const notFoundTracking = trackingNumbers.filter(tn => !foundTrackingNumbers.includes(tn));

      return { shipments, notFoundTracking };
    }

    private processFedexResponse(fedexData: FedExTrackingResponseDto): {
      latestStatus: FedExStatusDetailDto;
      scanEvents: FedExScanEventDto[];
    } {
      if (!fedexData?.output?.completeTrackResults?.[0]?.trackResults?.length) {
        throw new Error('Respuesta de FedEx inválida');
      }

      const trackResults = fedexData.output.completeTrackResults[0].trackResults;
      
      // Encontrar el último estado "DL" (delivered) o el más reciente
      const latestTrackResult = trackResults.find(r => r.latestStatusDetail?.derivedCode === 'DL') 
        || trackResults.sort((a, b) => {
          const dateA = a.scanEvents[0]?.date ? new Date(a.scanEvents[0].date).getTime() : 0;
          const dateB = b.scanEvents[0]?.date ? new Date(b.scanEvents[0].date).getTime() : 0;
          return dateB - dateA;
        })[0];

      return {
        latestStatus: latestTrackResult.latestStatusDetail,
        scanEvents: trackResults.flatMap(result => result.scanEvents || [])
      };
    }

    private validateStatus(
      trackingNumber: string,
      mappedStatus: ShipmentStatusType,
      latestStatus: FedExStatusDetailDto,
      scanEvents: FedExScanEventDto[],
      rules: SubsidiaryRules,
      subsidiaryId: string
    ): { isValid: boolean; reason?: string } {
      const exceptionCode = latestStatus.ancillaryDetails?.[0]?.reason 
        || scanEvents[0]?.exceptionCode;

      // Validación básica de códigos
      const codeValidation = this.validateExceptionCodes(
        exceptionCode, 
        subsidiaryId, 
        rules
      );
      if (!codeValidation.isValid) return codeValidation;

      // Validación de estado mapeado
      if (!rules.allowedStatuses.includes(mappedStatus)) {
        return {
          isValid: false,
          reason: `Estatus ${mappedStatus} no permitido para sucursal ${subsidiaryId}`
        };
      }

      // Validación de eventos
      const eventValidation = this.validateScanEvents(
        scanEvents, 
        rules.allowedEventTypes
      );
      if (!eventValidation.isValid) return eventValidation;

      // Validación de fechas
      const dateValidation = this.validateEventDates(
        scanEvents, 
        rules.maxEventAgeDays
      );
      if (!dateValidation.isValid) return dateValidation;

      return { isValid: true };
    }

    private validateExceptionCodes(
      exceptionCode: string | undefined,
      subsidiaryId: string,
      rules: SubsidiaryRules
    ): { isValid: boolean; reason?: string } {
      if (!exceptionCode) return { isValid: true };

      // Validar códigos permitidos
      if (!rules.allowedExceptionCodes.includes(exceptionCode)) {
        return {
          isValid: false,
          reason: `exceptionCode=${exceptionCode} no permitido para sucursal ${subsidiaryId}`
        };
      }

      // Validar reglas especiales
      if (exceptionCode === '03' && !rules.allowException03) {
        return { isValid: false, reason: 'exceptionCode=03 no permitido' };
      }

      if (exceptionCode === '16' && !rules.allowException16) {
        return { isValid: false, reason: 'exceptionCode=16 no permitido' };
      }

      if (exceptionCode === 'OD' && !rules.allowExceptionOD) {
        return { isValid: false, reason: 'exceptionCode=OD no permitido' };
      }

      return { isValid: true };
    }

    private async processShipmentUpdate(
      shipment: Shipment,
      newStatus: ShipmentStatusType,
      latestStatus: FedExStatusDetailDto,
      scanEvents: FedExScanEventDto[],
      shouldPersist: boolean
    ): Promise<{
      updated: boolean;
      details?: {
        trackingNumber: string;
        fromStatus: string;
        toStatus: string;
        eventDate: string;
      };
      unusualCode?: {
        trackingNumber: string;
        derivedCode: string;
        exceptionCode?: string;
        eventDate: string;
        statusByLocale?: string;
      };
    }> {
      if (shipment.status === newStatus) {
        return { updated: false };
      }

      const event = this.findRelevantEvent(scanEvents, newStatus);
      if (!event) {
        return {
          updated: false,
          unusualCode: {
            trackingNumber: shipment.trackingNumber,
            derivedCode: latestStatus.derivedCode || 'N/A',
            exceptionCode: latestStatus.ancillaryDetails?.[0]?.reason,
            eventDate: scanEvents[0]?.date || 'N/A',
            statusByLocale: latestStatus.statusByLocale || 'N/A'
          }
        };
      }

      const eventDate = parseISO(event.date);
      const updateDetails = {
        trackingNumber: shipment.trackingNumber,
        fromStatus: shipment.status,
        toStatus: newStatus,
        eventDate: eventDate.toISOString()
      };

      if (shouldPersist) {
        await this.persistShipmentUpdate(shipment, newStatus, event, eventDate, latestStatus);
      }

      return { updated: true, details: updateDetails };
    }

    private async persistShipmentUpdate(
      shipment: Shipment,
      newStatus: ShipmentStatusType,
      event: FedExScanEventDto,
      eventDate: Date,
      latestStatus: FedExStatusDetailDto
    ): Promise<void> {
      const newShipmentStatus = new ShipmentStatus();
      newShipmentStatus.status = newStatus;
      newShipmentStatus.timestamp = eventDate;
      newShipmentStatus.notes = this.generateStatusNotes(latestStatus, event);
      newShipmentStatus.exceptionCode = latestStatus.ancillaryDetails?.[0]?.reason || event.exceptionCode;
      newShipmentStatus.shipment = shipment;

      shipment.status = newStatus;
      shipment.statusHistory = [...(shipment.statusHistory || []), newShipmentStatus];
      shipment.receivedByName = latestStatus.deliveryDetails?.receivedByName || shipment.receivedByName;

      if (shipment.payment) {
        shipment.payment.status = newStatus === ShipmentStatusType.ENTREGADO 
          ? PaymentStatus.PAID 
          : PaymentStatus.PENDING;
      }

      await this.shipmentRepository.manager.transaction(async (em) => {
        await em.save(ShipmentStatus, newShipmentStatus);
        await em.update(
          Shipment, 
          { id: shipment.id },
          { 
            status: newStatus,
            receivedByName: shipment.receivedByName,
            ...(shipment.payment && { payment: shipment.payment })
          }
        );
      });
    }

    private findRelevantEvent(scanEvents: FedExScanEventDto[], status: ShipmentStatusType): FedExScanEventDto | undefined {
      return scanEvents.find(e => 
        e.eventType === 'DL' ||
        e.derivedStatusCode === 'DL' ||
        (status === ShipmentStatusType.NO_ENTREGADO && ['DE', 'DU', 'RF'].includes(e.eventType)) ||
        (status === ShipmentStatusType.PENDIENTE && ['TA', 'TD', 'HL'].includes(e.eventType)) ||
        (status === ShipmentStatusType.EN_RUTA && ['OC', 'IT', 'AR', 'AF', 'CP', 'CC'].includes(e.eventType)) ||
        (status === ShipmentStatusType.RECOLECCION && ['PU'].includes(e.eventType))
      ) || scanEvents.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    }

    private generateStatusNotes(latestStatus: FedExStatusDetailDto, event: FedExScanEventDto): string {
      if (latestStatus.ancillaryDetails?.[0]) {
        return `${latestStatus.ancillaryDetails[0].reason} - ${latestStatus.ancillaryDetails[0].actionDescription}`;
      }
      return `${event.eventType} - ${event.eventDescription}`;
    }

    private validateScanEvents(scanEvents: FedExScanEventDto[], allowedEventTypes?: string[]): {
      isValid: boolean;
      reason?: string;
    } {
      if (!scanEvents.length) {
        return { isValid: false, reason: 'No hay eventos de escaneo válidos' };
      }

      if (allowedEventTypes) {
        const invalidEvents = scanEvents.filter(e => !allowedEventTypes.includes(e.eventType));
        if (invalidEvents.length) {
          return { 
            isValid: false, 
            reason: `Tipos de evento no permitidos: ${invalidEvents.map(e => e.eventType).join(', ')}` 
          };
        }
      }

      return { isValid: true };
    }

    private validateEventDates(scanEvents: FedExScanEventDto[], maxAgeDays = 30): {
      isValid: boolean;
      reason?: string;
    } {
      const maxAgeDate = new Date();
      maxAgeDate.setDate(maxAgeDate.getDate() - maxAgeDays);

      for (const event of scanEvents) {
        try {
          const eventDate = parseISO(event.date);
          if (isNaN(eventDate.getTime())) {
            return { isValid: false, reason: `Fecha inválida: ${event.date}` };
          }
          if (eventDate < maxAgeDate) {
            return { 
              isValid: false, 
              reason: `Evento demasiado antiguo: ${eventDate.toISOString()} (límite: ${maxAgeDate.toISOString()})` 
            };
          }
        } catch (err) {
          return { isValid: false, reason: `Error al parsear fecha: ${err.message}` };
        }
      }

      return { isValid: true };
    }
 */