export interface FedexTrackingResponse {
  transactionId: string;
  customerTransactionId: string;
  output: {
    completeTrackResults: CompleteTrackResult[];
    alerts: string;
  };
}

export interface CompleteTrackResult {
  trackingNumber: string;
  trackResults: TrackResult[];
}

export interface TrackResult {
  trackingNumberInfo: {
    trackingNumber: string;
    carrierCode: string;
    trackingNumberUniqueId: string;
  };
  additionalTrackingInfo: {
    hasAssociatedShipments: boolean;
    nickname: string;
    packageIdentifiers: {
      type: string;
      value: string;
      trackingNumberUniqueId: string;
    }[];
    shipmentNotes: string;
  };
  distanceToDestination: {
    units: string;
    value: number;
  };
  consolidationDetail: {
    timeStamp: string;
    consolidationID: string;
    reasonDetail: {
      description: string;
      type: string;
    };
    packageCount: number;
    eventType: string;
  }[];
  meterNumber: string;
  returnDetail: {
    authorizationName: string;
    reasonDetail: {
      description: string;
      type: string;
    }[];
  };
  serviceDetail: {
    description: string;
    shortDescription: string;
    type: string;
  };
  destinationLocation: {
    locationId: string;
    locationContactAndAddress: {
      address: Address;
    };
    locationType: string;
  };
  latestStatusDetail: {
    scanLocation: Address;
    code: string;
    derivedCode: string;
    ancillaryDetails: {
      reason: string;
      reasonDescription: string;
      action: string;
      actionDescription: string;
    }[];
    statusByLocale: string;
    description: string;
    delayDetail: {
      type: string;
      subType: string;
      status: string;
    };
  };
  serviceCommitMessage: {
    message: string;
    type: string;
  };
  informationNotes: {
    code: string;
    description: string;
  }[];
  error: {
    code: string;
    parameterList: {
      value: string;
      key: string;
    }[];
    message: string;
  };
  specialHandlings: {
    description: string;
    type: string;
    paymentType: string;
  }[];
  availableImages: {
    size: string;
    type: string;
  }[];
  deliveryDetails: {
    receivedByName: string;
    destinationServiceArea: string;
    destinationServiceAreaDescription: string;
    locationDescription: string;
    actualDeliveryAddress: Address;
    deliveryToday: boolean;
    locationType: string;
    signedByName: string;
    officeOrderDeliveryMethod: string;
    deliveryAttempts: string;
    deliveryOptionEligibilityDetails: {
      option: string;
      eligibility: string;
    }[];
  };
  scanEvents: {
    date: string;
    derivedStatus: string;
    scanLocation: Address;
    locationId: string;
    locationType: string;
    exceptionDescription: string;
    eventDescription: string;
    eventType: string;
    derivedStatusCode: string;
    exceptionCode: string;
    delayDetail: {
      type: string;
      subType: string;
      status: string;
    };
  }[];
  dateAndTimes: {
    dateTime: string;
    type: string;
  }[];
  packageDetails: {
    physicalPackagingType: string;
    sequenceNumber: string;
    undeliveredCount: string;
    packagingDescription: {
      description: string;
      type: string;
    };
    count: string;
    weightAndDimensions: {
      weight: { unit: string; value: string }[];
      dimensions: { length: number; width: number; height: number; units: string }[];
    };
    packageContent: string[];
    contentPieceCount: string;
    declaredValue: {
      currency: string;
      value: number;
    };
  };
  goodsClassificationCode: string;
  holdAtLocation: {
    locationId: string;
    locationContactAndAddress: {
      address: Address;
    };
    locationType: string;
  };
  customDeliveryOptions: {
    requestedAppointmentDetail: {
      date: string;
      window: {
        description: string;
        window: { begins: string; ends: string };
        type: string;
      }[];
    };
    description: string;
    type: string;
    status: string;
  }[];
  estimatedDeliveryTimeWindow: {
    description: string;
    window: { begins: string; ends: string };
    type: string;
  };
  pieceCounts: {
    count: string;
    description: string;
    type: string;
  }[];
  originLocation: {
    locationId: string;
    locationContactAndAddress: {
      address: Address;
    };
  };
  recipientInformation: {
    address: Address;
  };
  standardTransitTimeWindow: {
    description: string;
    window: { begins: string; ends: string };
    type: string;
  };
  shipmentDetails: {
    contents: {
      itemNumber: string;
      receivedQuantity: string;
      description: string;
      partNumber: string;
    }[];
    beforePossessionStatus: boolean;
    weight: { unit: string; value: string }[];
    contentPieceCount: string;
    splitShipments: {
      pieceCount: string;
      statusDescription: string;
      timestamp: string;
      statusCode: string;
    }[];
  };
  reasonDetail: {
    description: string;
    type: string;
  };
  availableNotifications: string[];
  shipperInformation: {
    address: Address;
  };
  lastUpdatedDestinationAddress: Address;
}

export interface Address {
  addressClassification: string;
  residential: boolean;
  streetLines: string[];
  city: string;
  stateOrProvinceCode: string;
  postalCode: string;
  countryCode: string;
  countryName: string;
}
