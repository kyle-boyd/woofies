// Direct port of Python configuration constants

export interface EventSource {
  EVENT_SOURCE_NAME: string;
  EVENT_SOURCE_URL: string;
  EVENT_SOURCE_TYPE: string;
}

export interface PartnerConfig {
  name: string;
  protocol: string;
  pattern: "PUSH" | "PULL";
  direction: "inbound" | "outbound";
  remote_host: string;
  port: string;
  user_id: string;
  volume_range: [number, number];
  pgp: boolean;
  file_types: [string, [number, number]][];
  file_type_weights: number[];
  destination: string;
}

export interface DestinationConfig {
  name: string;
  protocol: string;
  host: string;
  port: string;
  user_id: string;
  path: string;
}

export const EVENT_SOURCES: EventSource[] = [
  {
    EVENT_SOURCE_NAME: "Pinnacle SFG Prod Node 1",
    EVENT_SOURCE_URL: "http://sfg-prod-01.pinnaclenb.com",
    EVENT_SOURCE_TYPE: "SFG",
  },
  {
    EVENT_SOURCE_NAME: "Pinnacle SFG Prod Node 2",
    EVENT_SOURCE_URL: "http://sfg-prod-02.pinnaclenb.com",
    EVENT_SOURCE_TYPE: "SFG",
  },
];

export const PARTNERS: Record<string, PartnerConfig> = {
  meridian: {
    name: "Meridian Capital Group",
    protocol: "SFTP",
    pattern: "PUSH",
    direction: "inbound",
    remote_host: "10.42.88.15",
    port: "22",
    user_id: "meridian_sftp",
    volume_range: [150, 200],
    pgp: true,
    file_types: [
      ["settlement_{date}_{seq}.dat", [100_000, 5_000_000]],
      ["position_{date}.dat", [50_000, 2_000_000]],
    ],
    file_type_weights: [0.7, 0.3],
    destination: "treasury",
  },
  lakeshore: {
    name: "Lakeshore Clearing",
    protocol: "CD",
    pattern: "PUSH",
    direction: "inbound",
    remote_host: "10.55.12.100",
    port: "1364",
    user_id: "lakeshore_cd",
    volume_range: [20, 40],
    pgp: false,
    file_types: [
      ["margin_call_{date}_{seq}.dat", [10_000, 500_000]],
      ["collateral_{date}.dat", [50_000, 1_000_000]],
    ],
    file_type_weights: [0.6, 0.4],
    destination: "treasury",
  },
  fedline: {
    name: "Federal Reserve (FedLine)",
    protocol: "FTPS",
    pattern: "PUSH",
    direction: "outbound",
    remote_host: "reg-reporting.pinnaclenb.com",
    port: "22",
    user_id: "pinnacle_reg_svc",
    volume_range: [5, 15],
    pgp: false,
    file_types: [
      ["reg_call_report_{date}.dat", [100_000, 10_000_000]],
      ["reg_fr2900_{date}.dat", [100_000, 10_000_000]],
      ["reg_ffiec009_{date}.dat", [100_000, 10_000_000]],
    ],
    file_type_weights: [0.33, 0.34, 0.33],
    destination: "fedline",
  },
  evergreen: {
    name: "Evergreen Insurance Co.",
    protocol: "HTTP",
    pattern: "PUSH",
    direction: "inbound",
    remote_host: "10.88.33.22",
    port: "443",
    user_id: "evergreen_api",
    volume_range: [60, 80],
    pgp: false,
    file_types: [["claims_{batch}_{date}.json", [5_000, 200_000]]],
    file_type_weights: [1.0],
    destination: "claims",
  },
  atlas: {
    name: "Atlas Payroll Services",
    protocol: "SFTP",
    pattern: "PULL",
    direction: "inbound",
    remote_host: "10.66.200.8",
    port: "22",
    user_id: "atlas_payroll",
    volume_range: [30, 50],
    pgp: false,
    file_types: [["payroll_batch_{date}.csv", [50_000, 3_000_000]]],
    file_type_weights: [1.0],
    destination: "payroll",
  },
  jdeere: {
    name: "John Deere Financial",
    protocol: "SFTP",
    pattern: "PUSH",
    direction: "inbound",
    remote_host: "10.77.44.30",
    port: "22",
    user_id: "jdeere_loan_ops",
    volume_range: [10, 20],
    pgp: true,
    file_types: [["loan_pkg_{id}.zip.pgp", [1_000_000, 50_000_000]]],
    file_type_weights: [1.0],
    destination: "lending",
  },
};

export const DESTINATIONS: Record<string, DestinationConfig> = {
  treasury: {
    name: "Pinnacle Treasury App",
    protocol: "SFTP",
    host: "sftp-treasury.pinnaclenb.com",
    port: "22",
    user_id: "treasury_svc",
    path: "/Treasury/Inbox",
  },
  operations: {
    name: "Pinnacle Operations",
    protocol: "SFTP",
    host: "sftp-ops.pinnaclenb.com",
    port: "22",
    user_id: "ops_svc",
    path: "/Operations/Inbox",
  },
  lending: {
    name: "Pinnacle Lending System",
    protocol: "SFTP",
    host: "sftp-lending.pinnaclenb.com",
    port: "22",
    user_id: "lending_svc",
    path: "/Lending/Inbox",
  },
  claims: {
    name: "Pinnacle Claims Processing",
    protocol: "HTTP",
    host: "claims-api.pinnaclenb.com",
    port: "443",
    user_id: "claims_svc",
    path: "/api/claims/ingest",
  },
  payroll: {
    name: "Pinnacle Payroll System",
    protocol: "SFTP",
    host: "sftp-payroll.pinnaclenb.com",
    port: "22",
    user_id: "payroll_svc",
    path: "/Payroll/Inbox",
  },
  fedline: {
    name: "FedLine Submission",
    protocol: "FTPS",
    host: "fedline-submit.frb.gov",
    port: "990",
    user_id: "pinnacle_fed",
    path: "/Submissions/Inbox",
  },
};

// Hour weights for business-hour time distribution (ET)
// Index = hour (0-23), value = relative weight
export const HOUR_WEIGHTS: number[] = [
  0.2, 0.1, 0.1, 0.1, 0.1, 0.2, // 0-5 AM: very low
  0.8, 1.2, 1.5, 3.0, 2.5, 1.5,  // 6-11 AM: ramp up, market open peak at 9-10
  2.0, 2.5, 1.5, 1.0, 1.5, 2.0,  // 12-5 PM: midday peak 12-1, EOD peak 3:30-5
  2.5, 2.0, 1.0, 0.5, 0.3, 0.2,  // 6-11 PM: tapering
];
