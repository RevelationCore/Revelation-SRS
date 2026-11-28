// OpenTelemetry starts before anything else is imported (ADR-035): main.ts imports this first.
import { startTelemetry } from '@revelation-srs/telemetry';

export const telemetry = startTelemetry({ serviceName: `${process.env['BFF_CLIENT_ID'] ?? 'srs-admin'}-bff` });
