import { DateTime } from "luxon";
import { PARTNERS, DESTINATIONS, type EventSource } from "./config";
import { msTimestamp, pickEventSource } from "./keys";
import type { FtvEvent } from "./types";

function withSource(event: Omit<FtvEvent, "EVENT_SOURCE_NAME" | "EVENT_SOURCE_URL" | "EVENT_SOURCE_TYPE">, source: EventSource): FtvEvent {
  return {
    ...event,
    EVENT_SOURCE_NAME: source.EVENT_SOURCE_NAME,
    EVENT_SOURCE_URL: source.EVENT_SOURCE_URL,
    EVENT_SOURCE_TYPE: source.EVENT_SOURCE_TYPE,
  } as FtvEvent;
}

export function buildStartTransfer(
  partnerKey: string,
  dt: DateTime,
  arrivedKey: string,
  filename: string,
  fileSize: number,
  status = "SUCCESS",
  source?: EventSource
): FtvEvent {
  const p = PARTNERS[partnerKey];
  const src = source ?? pickEventSource();
  return withSource(
    {
      STAGE: "ARRIVED_FILE",
      Event: "StartTransfer",
      TIME: msTimestamp(dt),
      ARRIVEDFILE_KEY: arrivedKey,
      EVENT_KEY: arrivedKey,
      ProducerUserId: p.user_id,
      ProducerPath: `/${p.user_id}/Outbound`,
      ProducerFileSize: String(fileSize),
      ProducerFilename: filename,
      ProducerOperation: "Put",
      ProducerRemoteHost: p.remote_host,
      ProducerPort: p.port,
      ProducerProtocol: p.protocol,
      ProducerPattern: p.pattern,
      Direction: p.direction,
      Status: status,
    },
    src
  );
}

export function buildProcessDetails(
  dt: DateTime,
  arrivedKey: string,
  layerType: string,
  layerFilename: string,
  source?: EventSource
): FtvEvent {
  const src = source ?? pickEventSource();
  return withSource(
    {
      STAGE: "ARRIVED_FILE",
      Event: "ProcessDetails",
      TIME: msTimestamp(dt),
      EVENT_KEY: arrivedKey,
      ARRIVEDFILE_KEY: arrivedKey,
      LayerType: layerType,
      LayerFilename: layerFilename,
    },
    src
  );
}

export function buildProcessing(
  dt: DateTime,
  arrivedKey: string,
  layerType: string,
  layerFilename: string,
  status = "Success",
  message = "",
  source?: EventSource
): FtvEvent {
  const src = source ?? pickEventSource();
  return withSource(
    {
      STAGE: "PROCESSING",
      Event: "PROCESSING",
      ARRIVEDFILE_KEY: arrivedKey,
      TIME: msTimestamp(dt),
      EVENT_KEY: arrivedKey,
      LayerType: layerType,
      LayerFilename: layerFilename,
      LayerStatus: status,
      LayerMessage: message,
    },
    src
  );
}

export function buildStartedDelivery(
  dt: DateTime,
  arrivedKey: string,
  deliveryKey: string,
  partnerKey: string,
  filename: string,
  fileSize: number,
  destKey?: string,
  source?: EventSource
): FtvEvent {
  const p = PARTNERS[partnerKey];
  const dk = destKey ?? p.destination;
  const d = DESTINATIONS[dk];
  const src = source ?? pickEventSource();
  return withSource(
    {
      STAGE: "DELIVERY",
      Event: "StartedDelivery",
      ARRIVEDFILE_KEY: arrivedKey,
      EVENT_KEY: deliveryKey,
      TIME: msTimestamp(dt),
      ConsumerName: d.name,
      ConsumerFilename: filename,
      ConsumerFileSize: String(fileSize),
      ConsumerOperation: "Put",
      ConsumerPattern: "PUSH",
      ConsumerRemoteHost: d.host,
      ConsumerProtocol: d.protocol,
      ConsumerUserId: d.user_id,
      ConsumerPort: d.port,
      ConsumerPath: d.path,
    },
    src
  );
}

export function buildCompleteDelivery(
  dt: DateTime,
  arrivedKey: string,
  deliveryKey: string,
  partnerKey: string,
  filename: string,
  destKey?: string,
  source?: EventSource
): FtvEvent {
  const p = PARTNERS[partnerKey];
  const dk = destKey ?? p.destination;
  const d = DESTINATIONS[dk];
  const src = source ?? pickEventSource();
  return withSource(
    {
      STAGE: "DELIVERY",
      Event: "CompleteDelivery",
      ARRIVEDFILE_KEY: arrivedKey,
      EVENT_KEY: deliveryKey,
      TIME: msTimestamp(dt),
      ConsumerFilename: filename,
      ConsumerOperation: "Put",
      ConsumerRemoteHost: d.host,
      ConsumerProtocol: d.protocol,
      ConsumerUserId: d.user_id,
      ConsumerPort: d.port,
      ConsumerPath: d.path,
      Direction: "outbound",
    },
    src
  );
}

export function buildFailedDelivery(
  dt: DateTime,
  arrivedKey: string,
  deliveryKey: string,
  partnerKey: string,
  filename: string,
  errorMessage: string,
  destKey?: string,
  source?: EventSource
): FtvEvent {
  const p = PARTNERS[partnerKey];
  const dk = destKey ?? p.destination;
  const d = DESTINATIONS[dk];
  const src = source ?? pickEventSource();
  return withSource(
    {
      STAGE: "DELIVERY",
      Event: "FailedDelivery",
      ARRIVEDFILE_KEY: arrivedKey,
      EVENT_KEY: deliveryKey,
      TIME: msTimestamp(dt),
      ConsumerFilename: filename,
      ErrorMessage: errorMessage,
      ConsumerOperation: "Put",
      ConsumerRemoteHost: d.host,
      ConsumerProtocol: d.protocol,
      ConsumerUserId: d.user_id,
      ConsumerPort: d.port,
      ConsumerPath: d.path,
      Direction: "outbound",
    },
    src
  );
}

export function buildCompleteTransfer(
  dt: DateTime,
  arrivedKey: string,
  message = "Transfer Successful",
  source?: EventSource
): FtvEvent {
  const src = source ?? pickEventSource();
  return withSource(
    {
      STAGE: "ARRIVED_FILE",
      Event: "CompleteTransfer",
      TIME: msTimestamp(dt),
      ARRIVEDFILE_KEY: arrivedKey,
      EVENT_KEY: arrivedKey,
      MESSAGE: message,
    },
    src
  );
}

export function buildFailTransfer(
  dt: DateTime,
  arrivedKey: string,
  errorMessage: string,
  source?: EventSource
): FtvEvent {
  const src = source ?? pickEventSource();
  return withSource(
    {
      STAGE: "ARRIVED_FILE",
      Event: "FailTransfer",
      TIME: msTimestamp(dt),
      ARRIVEDFILE_KEY: arrivedKey,
      EVENT_KEY: arrivedKey,
      ERROR_MESSAGE: errorMessage,
    },
    src
  );
}
