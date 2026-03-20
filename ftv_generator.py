#!/usr/bin/env python3
"""
Syncrofy FTV Data Generator — Pinnacle National Bank dogfooding data.

Generates realistic file transfer event JSON payloads for the Syncrofy FTV
platform. Produces one JSON file per transfer (array of events sharing an
ARRIVEDFILE_KEY), ready for HTTPS POST.

Usage:
    # Generate a full day of realistic traffic
    python ftv_generator.py --date 2026-03-20 --output-dir ./output

    # Generate a specific scenario
    python ftv_generator.py --date 2026-03-20 --scenario 1 --output-dir ./output

    # Generate 5 days of data
    python ftv_generator.py --date 2026-03-16 --days 5 --output-dir ./output

    # Adjust volume (0.5 = half, 2.0 = double)
    python ftv_generator.py --date 2026-03-20 --volume-scale 1.5 --output-dir ./output
"""

import argparse
import json
import os
import random
import math
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
UTC = ZoneInfo("UTC")

# ============================================================
# Configuration
# ============================================================

EVENT_SOURCES = [
    {
        "EVENT_SOURCE_NAME": "Pinnacle SFG Prod Node 1",
        "EVENT_SOURCE_URL": "http://sfg-prod-01.pinnaclenb.com",
        "EVENT_SOURCE_TYPE": "SFG",
    },
    {
        "EVENT_SOURCE_NAME": "Pinnacle SFG Prod Node 2",
        "EVENT_SOURCE_URL": "http://sfg-prod-02.pinnaclenb.com",
        "EVENT_SOURCE_TYPE": "SFG",
    },
]

PARTNERS = {
    "meridian": {
        "name": "Meridian Capital Group",
        "protocol": "SFTP",
        "pattern": "PUSH",
        "direction": "inbound",
        "remote_host": "10.42.88.15",
        "port": "22",
        "user_id": "meridian_sftp",
        "volume_range": (150, 200),
        "pgp": True,
        "file_types": [
            ("settlement_{date}_{seq:03d}.dat", (100_000, 5_000_000)),
            ("position_{date}.dat", (50_000, 2_000_000)),
        ],
        "file_type_weights": [0.7, 0.3],
        "destination": "treasury",
    },
    "lakeshore": {
        "name": "Lakeshore Clearing",
        "protocol": "CD",
        "pattern": "PUSH",
        "direction": "inbound",
        "remote_host": "10.55.12.100",
        "port": "1364",
        "user_id": "lakeshore_cd",
        "volume_range": (20, 40),
        "pgp": False,
        "file_types": [
            ("margin_call_{date}_{seq:03d}.dat", (10_000, 500_000)),
            ("collateral_{date}.dat", (50_000, 1_000_000)),
        ],
        "file_type_weights": [0.6, 0.4],
        "destination": "treasury",
    },
    "fedline": {
        "name": "Federal Reserve (FedLine)",
        "protocol": "FTPS",
        "pattern": "PUSH",
        "direction": "outbound",
        "remote_host": "reg-reporting.pinnaclenb.com",  # internal origin for outbound
        "port": "22",
        "user_id": "pinnacle_reg_svc",
        "volume_range": (5, 15),
        "pgp": False,
        "file_types": [
            ("reg_call_report_{date}.dat", (100_000, 10_000_000)),
            ("reg_fr2900_{date}.dat", (100_000, 10_000_000)),
            ("reg_ffiec009_{date}.dat", (100_000, 10_000_000)),
        ],
        "file_type_weights": [0.33, 0.34, 0.33],
        "destination": "fedline",
    },
    "evergreen": {
        "name": "Evergreen Insurance Co.",
        "protocol": "HTTP",
        "pattern": "PUSH",
        "direction": "inbound",
        "remote_host": "10.88.33.22",
        "port": "443",
        "user_id": "evergreen_api",
        "volume_range": (60, 80),
        "pgp": False,
        "file_types": [
            ("claims_{batch}_{date}.json", (5_000, 200_000)),
        ],
        "file_type_weights": [1.0],
        "destination": "claims",
    },
    "atlas": {
        "name": "Atlas Payroll Services",
        "protocol": "SFTP",
        "pattern": "PULL",
        "direction": "inbound",
        "remote_host": "10.66.200.8",
        "port": "22",
        "user_id": "atlas_payroll",
        "volume_range": (30, 50),
        "pgp": False,
        "file_types": [
            ("payroll_batch_{date}.csv", (50_000, 3_000_000)),
        ],
        "file_type_weights": [1.0],
        "destination": "payroll",
    },
    "jdeere": {
        "name": "John Deere Financial",
        "protocol": "SFTP",
        "pattern": "PUSH",
        "direction": "inbound",
        "remote_host": "10.77.44.30",
        "port": "22",
        "user_id": "jdeere_loan_ops",
        "volume_range": (10, 20),
        "pgp": True,
        "file_types": [
            ("loan_pkg_{id}.zip.pgp", (1_000_000, 50_000_000)),
        ],
        "file_type_weights": [1.0],
        "destination": "lending",
    },
}

DESTINATIONS = {
    "treasury": {
        "name": "Pinnacle Treasury App",
        "protocol": "SFTP",
        "host": "sftp-treasury.pinnaclenb.com",
        "port": "22",
        "user_id": "treasury_svc",
        "path": "/Treasury/Inbox",
    },
    "operations": {
        "name": "Pinnacle Operations",
        "protocol": "SFTP",
        "host": "sftp-ops.pinnaclenb.com",
        "port": "22",
        "user_id": "ops_svc",
        "path": "/Operations/Inbox",
    },
    "lending": {
        "name": "Pinnacle Lending System",
        "protocol": "SFTP",
        "host": "sftp-lending.pinnaclenb.com",
        "port": "22",
        "user_id": "lending_svc",
        "path": "/Lending/Inbox",
    },
    "claims": {
        "name": "Pinnacle Claims Processing",
        "protocol": "HTTP",
        "host": "claims-api.pinnaclenb.com",
        "port": "443",
        "user_id": "claims_svc",
        "path": "/api/claims/ingest",
    },
    "payroll": {
        "name": "Pinnacle Payroll System",
        "protocol": "SFTP",
        "host": "sftp-payroll.pinnaclenb.com",
        "port": "22",
        "user_id": "payroll_svc",
        "path": "/Payroll/Inbox",
    },
    "fedline": {
        "name": "FedLine Submission",
        "protocol": "FTPS",
        "host": "fedline-submit.frb.gov",
        "port": "990",
        "user_id": "pinnacle_fed",
        "path": "/Submissions/Inbox",
    },
}

# Hourly weights for time distribution (hours 0-23 in ET).
# Peaks at market open (9-10), midday (12-13), EOD settlement (15:30-17).
HOUR_WEIGHTS = {
    6: 3, 7: 5, 8: 8, 9: 15, 10: 12, 11: 10,
    12: 13, 13: 10, 14: 8, 15: 10, 16: 12, 17: 8,
    18: 4, 19: 2, 20: 1,
}


# ============================================================
# Counters and key generation
# ============================================================

_key_counter = 0


def reset_key_counter():
    global _key_counter
    _key_counter = 0


def generate_key(dt):
    """Generate an ARRIVEDFILE_KEY from a datetime: YYYYMMDDHHMMSSFFFFFFNNN."""
    global _key_counter
    _key_counter += 1
    frac = random.randint(100000, 999999)
    seq = _key_counter % 1000
    return dt.strftime(f"%Y%m%d%H%M%S{frac:06d}{seq:03d}")


def ms_timestamp(dt):
    """Convert datetime to Unix ms timestamp string."""
    return str(int(dt.timestamp() * 1000))


def pick_event_source():
    """Randomly pick one of the two SFG prod nodes."""
    return random.choice(EVENT_SOURCES).copy()


def pick_event_source_sticky():
    """Pick a source node and return it for reuse across one transfer."""
    return random.choice(EVENT_SOURCES).copy()


# ============================================================
# Filename generation
# ============================================================

_batch_counter = 0
_loan_id_counter = 4400


def generate_filename(partner_key, date, seq=None, override_name=None):
    """Generate a realistic filename for a partner transfer."""
    global _batch_counter, _loan_id_counter

    if override_name:
        return override_name

    partner = PARTNERS[partner_key]
    ft_idx = random.choices(range(len(partner["file_types"])),
                            weights=partner["file_type_weights"], k=1)[0]
    template, _ = partner["file_types"][ft_idx]
    date_str = date.strftime("%Y%m%d")

    if seq is None:
        seq = random.randint(1, 999)

    result = template.replace("{date}", date_str)
    result = result.replace("{seq:03d}", f"{seq:03d}")

    if "{batch}" in result:
        _batch_counter += 1
        result = result.replace("{batch}", f"{_batch_counter:04d}")

    if "{id}" in result:
        _loan_id_counter += 1
        result = result.replace("{id}", str(_loan_id_counter))

    return result, ft_idx


def file_size_for(partner_key, ft_idx=0):
    """Generate a random file size within the partner's range for a file type."""
    lo, hi = PARTNERS[partner_key]["file_types"][ft_idx][1]
    return str(random.randint(lo, hi))


# ============================================================
# Time distribution
# ============================================================

def random_business_time(date, start_hour=6, end_hour=20, weights=None):
    """Pick a random time on `date` within business hours (ET), weighted."""
    if weights is None:
        weights = HOUR_WEIGHTS

    valid_hours = [h for h in range(start_hour, end_hour + 1) if h in weights]
    hour_wts = [weights.get(h, 1) for h in valid_hours]

    hour = random.choices(valid_hours, weights=hour_wts, k=1)[0]
    minute = random.randint(0, 59)
    second = random.randint(0, 59)
    micro = random.randint(0, 999999)

    return datetime(date.year, date.month, date.day,
                    hour, minute, second, micro, tzinfo=ET)


def generate_sorted_times(date, count, start_hour=6, end_hour=20, weights=None):
    """Generate `count` sorted random times within the business window."""
    times = [random_business_time(date, start_hour, end_hour, weights)
             for _ in range(count)]
    times.sort()
    return times


def advance_time(dt, min_sec=1, max_sec=3):
    """Advance time by a random interval (seconds)."""
    ms = random.randint(min_sec * 1000, max_sec * 1000)
    return dt + timedelta(milliseconds=ms)


# ============================================================
# Event builders
# ============================================================

def build_start_transfer(partner_key, dt, arrived_key, filename, file_size,
                         status="SUCCESS", source=None):
    p = PARTNERS[partner_key]
    src = source or pick_event_source()
    event = {
        "STAGE": "ARRIVED_FILE",
        "Event": "StartTransfer",
        "TIME": ms_timestamp(dt),
        "ARRIVEDFILE_KEY": arrived_key,
        "EVENT_KEY": arrived_key,
        "ProducerUserId": p["user_id"],
        "ProducerPath": f"/{p['user_id']}/Outbound",
        "ProducerFileSize": file_size,
        "ProducerFilename": filename,
        "ProducerOperation": "Put",
        "ProducerRemoteHost": p["remote_host"],
        "ProducerPort": p["port"],
        "ProducerProtocol": p["protocol"],
        "ProducerPattern": p["pattern"],
        "Direction": p["direction"],
        "Status": status,
    }
    event.update(src)
    return event


def build_process_details(dt, arrived_key, layer_type, layer_filename, source=None):
    src = source or pick_event_source()
    event = {
        "STAGE": "ARRIVED_FILE",
        "Event": "ProcessDetails",
        "TIME": ms_timestamp(dt),
        "EVENT_KEY": arrived_key,
        "ARRIVEDFILE_KEY": arrived_key,
        "LayerType": layer_type,
        "LayerFilename": layer_filename,
    }
    event.update(src)
    return event


def build_processing(dt, arrived_key, layer_type, layer_filename,
                     status="Success", message="", source=None):
    src = source or pick_event_source()
    event = {
        "STAGE": "PROCESSING",
        "Event": "PROCESSING",
        "ARRIVEDFILE_KEY": arrived_key,
        "TIME": ms_timestamp(dt),
        "EVENT_KEY": arrived_key,
        "LayerType": layer_type,
        "LayerFilename": layer_filename,
        "LayerStatus": status,
        "LayerMessage": message,
    }
    event.update(src)
    return event


def build_started_delivery(dt, arrived_key, delivery_key, partner_key,
                           filename, file_size, dest_key=None, source=None):
    p = PARTNERS[partner_key]
    dk = dest_key or p["destination"]
    d = DESTINATIONS[dk]
    src = source or pick_event_source()
    event = {
        "STAGE": "DELIVERY",
        "Event": "StartedDelivery",
        "ARRIVEDFILE_KEY": arrived_key,
        "EVENT_KEY": delivery_key,
        "TIME": ms_timestamp(dt),
        "ConsumerName": d["name"],
        "ConsumerFilename": filename,
        "ConsumerFileSize": file_size,
        "ConsumerOperation": "Put",
        "ConsumerPattern": "PUSH",
        "ConsumerRemoteHost": d["host"],
        "ConsumerProtocol": d["protocol"],
        "ConsumerUserId": d["user_id"],
        "ConsumerPort": d["port"],
        "ConsumerPath": d["path"],
    }
    event.update(src)
    return event


def build_complete_delivery(dt, arrived_key, delivery_key, partner_key,
                            filename, dest_key=None, source=None):
    p = PARTNERS[partner_key]
    dk = dest_key or p["destination"]
    d = DESTINATIONS[dk]
    src = source or pick_event_source()
    event = {
        "STAGE": "DELIVERY",
        "Event": "CompleteDelivery",
        "ARRIVEDFILE_KEY": arrived_key,
        "EVENT_KEY": delivery_key,
        "TIME": ms_timestamp(dt),
        "ConsumerFilename": filename,
        "ConsumerOperation": "Put",
        "ConsumerRemoteHost": d["host"],
        "ConsumerProtocol": d["protocol"],
        "ConsumerUserId": d["user_id"],
        "ConsumerPort": d["port"],
        "ConsumerPath": d["path"],
        "Direction": "outbound",
    }
    event.update(src)
    return event


def build_failed_delivery(dt, arrived_key, delivery_key, partner_key,
                          filename, error_message, dest_key=None, source=None):
    p = PARTNERS[partner_key]
    dk = dest_key or p["destination"]
    d = DESTINATIONS[dk]
    src = source or pick_event_source()
    event = {
        "STAGE": "DELIVERY",
        "Event": "FailedDelivery",
        "ARRIVEDFILE_KEY": arrived_key,
        "EVENT_KEY": delivery_key,
        "TIME": ms_timestamp(dt),
        "ConsumerFilename": filename,
        "ErrorMessage": error_message,
        "ConsumerOperation": "Put",
        "ConsumerRemoteHost": d["host"],
        "ConsumerProtocol": d["protocol"],
        "ConsumerUserId": d["user_id"],
        "ConsumerPort": d["port"],
        "ConsumerPath": d["path"],
        "Direction": "outbound",
    }
    event.update(src)
    return event


def build_complete_transfer(dt, arrived_key, message="Transfer Successful",
                            source=None):
    src = source or pick_event_source()
    event = {
        "STAGE": "ARRIVED_FILE",
        "Event": "CompleteTransfer",
        "TIME": ms_timestamp(dt),
        "ARRIVEDFILE_KEY": arrived_key,
        "EVENT_KEY": arrived_key,
        "MESSAGE": message,
    }
    event.update(src)
    return event


def build_fail_transfer(dt, arrived_key, error_message, source=None):
    src = source or pick_event_source()
    event = {
        "STAGE": "ARRIVED_FILE",
        "Event": "FailTransfer",
        "TIME": ms_timestamp(dt),
        "ARRIVEDFILE_KEY": arrived_key,
        "EVENT_KEY": arrived_key,
        "ERROR_MESSAGE": error_message,
    }
    event.update(src)
    return event


# ============================================================
# Processing step helpers
# ============================================================

def random_processing_steps(partner_key, filename, base_name=None):
    """Generate a realistic set of processing steps for a transfer.
    Returns list of (layer_type, layer_filename, message) tuples."""
    p = PARTNERS[partner_key]
    if base_name is None:
        base_name = filename.replace(".pgp", "").replace(".zip", "")

    steps = []

    # PGP-encrypted partners get PGP decrypt step
    if p["pgp"] and filename.endswith(".pgp"):
        inner = filename.replace(".pgp", "")
        steps.append(("PGP", inner, "PGP decrypt successful"))
        # If also zipped
        if inner.endswith(".zip"):
            steps.append(("ZIP", inner.replace(".zip", ""), "Unzip successful"))

    # ZIP files without PGP
    elif filename.endswith(".zip"):
        steps.append(("ZIP", filename.replace(".zip", ""), "Unzip successful"))

    # Add a random subset of processing steps
    possible = [
        ("Normalize Data", base_name, "Message data is ready"),
        ("Generate Checksum", base_name, f"Checksum: {random.randbytes(16).hex()}"),
        ("Validate Checksum", base_name, "Checksum is valid"),
        ("Store Checksum", base_name, "Checksum storage was successful"),
        ("Virus Scan", base_name, "No threats detected"),
        ("Add to Archive", base_name, "Payload added to archive"),
        ("Validate Archive", base_name, "Archive valid"),
    ]

    # Pick 2-5 random processing steps
    count = random.randint(2, min(5, len(possible)))
    selected = random.sample(possible, count)
    # Keep them in a logical order (roughly: normalize, checksum gen, checksum validate, etc.)
    order = ["Normalize Data", "Generate Checksum", "Validate Checksum",
             "Store Checksum", "Virus Scan", "Add to Archive", "Validate Archive"]
    selected.sort(key=lambda x: order.index(x[0]) if x[0] in order else 99)

    steps.extend(selected)
    return steps


# ============================================================
# Transfer pattern generators
#
# Each returns (arrivedfile_key, [events])
# ============================================================

def pattern_happy_path(partner_key, start_time, filename=None, file_size=None,
                       dest_key=None, override_steps=None):
    """Pattern 1: Full success — ~85% of transfers."""
    p = PARTNERS[partner_key]
    date = start_time.date()
    if filename is None:
        filename, ft_idx = generate_filename(partner_key, date)
    else:
        ft_idx = 0
    if file_size is None:
        file_size = file_size_for(partner_key, ft_idx)

    source = pick_event_source_sticky()
    arrived_key = generate_key(start_time)
    events = []
    t = start_time

    # StartTransfer
    events.append(build_start_transfer(partner_key, t, arrived_key, filename,
                                       file_size, "SUCCESS", source))

    # Processing steps (ARRIVED_FILE stage ProcessDetails + PROCESSING stage)
    proc_steps = override_steps or random_processing_steps(partner_key, filename)

    for i, (layer_type, layer_fn, msg) in enumerate(proc_steps):
        t = advance_time(t, 1, 3)
        if i < 2 and layer_type in ("ZIP", "PGP"):
            # First 1-2 steps are ProcessDetails at ARRIVED_FILE stage
            events.append(build_process_details(t, arrived_key, layer_type,
                                                layer_fn, source))
        else:
            events.append(build_processing(t, arrived_key, layer_type, layer_fn,
                                           "Success", msg, source))

    # Delivery
    t = advance_time(t, 2, 5)
    delivery_key = generate_key(t)
    events.append(build_started_delivery(t, arrived_key, delivery_key,
                                         partner_key, filename, file_size,
                                         dest_key, source))

    t = advance_time(t, 5, 30)
    events.append(build_complete_delivery(t, arrived_key, delivery_key,
                                          partner_key, filename, dest_key, source))

    # CompleteTransfer
    t = advance_time(t, 1, 3)
    events.append(build_complete_transfer(t, arrived_key, source=source))

    return arrived_key, events


def pattern_retry_success(partner_key, start_time, filename=None, file_size=None,
                          dest_key=None):
    """Pattern 2: Retry then success — ~5% of transfers."""
    p = PARTNERS[partner_key]
    date = start_time.date()
    if filename is None:
        filename, ft_idx = generate_filename(partner_key, date)
    else:
        ft_idx = 0
    if file_size is None:
        file_size = file_size_for(partner_key, ft_idx)

    source = pick_event_source_sticky()
    arrived_key = generate_key(start_time)
    events = []
    t = start_time

    # StartTransfer with Retry status
    events.append(build_start_transfer(partner_key, t, arrived_key, filename,
                                       file_size, "Retry", source))

    # Processing steps
    for layer_type, layer_fn, msg in random_processing_steps(partner_key, filename):
        t = advance_time(t, 1, 3)
        if layer_type in ("ZIP", "PGP"):
            events.append(build_process_details(t, arrived_key, layer_type,
                                                layer_fn, source))
        else:
            events.append(build_processing(t, arrived_key, layer_type, layer_fn,
                                           "Success", msg, source))

    # First delivery attempt — fails
    t = advance_time(t, 2, 5)
    delivery_key_1 = generate_key(t)
    events.append(build_started_delivery(t, arrived_key, delivery_key_1,
                                         partner_key, filename, file_size,
                                         dest_key, source))

    t = advance_time(t, 5, 30)
    error_msg = random.choice([
        "Connection timeout",
        "Connection refused",
        "Remote host not responding",
    ])
    events.append(build_failed_delivery(t, arrived_key, delivery_key_1,
                                        partner_key, filename, error_msg,
                                        dest_key, source))

    # Retry after 60-300 seconds
    t = advance_time(t, 60, 300)
    delivery_key_2 = generate_key(t)
    events.append(build_started_delivery(t, arrived_key, delivery_key_2,
                                         partner_key, filename, file_size,
                                         dest_key, source))

    t = advance_time(t, 5, 30)
    events.append(build_complete_delivery(t, arrived_key, delivery_key_2,
                                          partner_key, filename, dest_key, source))

    t = advance_time(t, 1, 3)
    events.append(build_complete_transfer(t, arrived_key, source=source))

    return arrived_key, events


def pattern_pgp_failure(partner_key, start_time, filename=None, file_size=None,
                        error_variant="invalid key"):
    """Pattern 3: PGP decrypt failure."""
    p = PARTNERS[partner_key]
    date = start_time.date()
    if filename is None:
        filename, ft_idx = generate_filename(partner_key, date)
    else:
        ft_idx = 0
    if file_size is None:
        file_size = file_size_for(partner_key, ft_idx)

    source = pick_event_source_sticky()
    arrived_key = generate_key(start_time)
    events = []
    t = start_time

    events.append(build_start_transfer(partner_key, t, arrived_key, filename,
                                       file_size, "SUCCESS", source))

    # ZIP step if applicable
    if filename.endswith(".zip.pgp") or filename.endswith(".zip"):
        t = advance_time(t, 1, 3)
        events.append(build_process_details(t, arrived_key, "ZIP",
                                            filename.replace(".pgp", ""), source))

    # PGP decrypt fails
    t = advance_time(t, 1, 3)
    events.append(build_processing(t, arrived_key, "PGP",
                                   filename.replace(".pgp", "").replace(".zip", ""),
                                   "Failed",
                                   f"Decrypt failed: {error_variant}", source))

    t = advance_time(t, 1, 2)
    events.append(build_fail_transfer(t, arrived_key,
                                      "Processing failure: PGP decrypt", source))

    return arrived_key, events


def pattern_staging_failure(partner_key, start_time, filename=None, file_size=None,
                            staging_path=None):
    """Pattern 4: Staging/delivery failure."""
    p = PARTNERS[partner_key]
    date = start_time.date()
    if filename is None:
        filename, ft_idx = generate_filename(partner_key, date)
    else:
        ft_idx = 0
    if file_size is None:
        file_size = file_size_for(partner_key, ft_idx)

    if staging_path is None:
        staging_path = f"/staging/{partner_key}/outbound"

    source = pick_event_source_sticky()
    arrived_key = generate_key(start_time)
    events = []
    t = start_time

    events.append(build_start_transfer(partner_key, t, arrived_key, filename,
                                       file_size, "SUCCESS", source))

    for layer_type, layer_fn, msg in random_processing_steps(partner_key, filename):
        t = advance_time(t, 1, 3)
        if layer_type in ("ZIP", "PGP"):
            events.append(build_process_details(t, arrived_key, layer_type,
                                                layer_fn, source))
        else:
            events.append(build_processing(t, arrived_key, layer_type, layer_fn,
                                           "Success", msg, source))

    t = advance_time(t, 2, 5)
    delivery_key = generate_key(t)
    events.append(build_started_delivery(t, arrived_key, delivery_key,
                                         partner_key, filename, file_size,
                                         source=source))

    t = advance_time(t, 5, 15)
    error_msg = f"Staging area full: {staging_path} — disk space exceeded"
    events.append(build_failed_delivery(t, arrived_key, delivery_key,
                                        partner_key, filename, error_msg,
                                        source=source))

    t = advance_time(t, 1, 3)
    events.append(build_fail_transfer(t, arrived_key,
                                      "Delivery failed: staging error", source))

    return arrived_key, events


def pattern_partial_file(partner_key, start_time, filename=None,
                         expected_size=None, received_size=None):
    """Pattern 5: Partial file received."""
    date = start_time.date()
    if filename is None:
        filename, ft_idx = generate_filename(partner_key, date)
    else:
        ft_idx = 0
    if expected_size is None:
        expected_size = random.randint(200_000, 5_000_000)
    if received_size is None:
        received_size = random.randint(expected_size // 5, expected_size // 2)

    source = pick_event_source_sticky()
    arrived_key = generate_key(start_time)
    events = []
    t = start_time

    events.append(build_start_transfer(partner_key, t, arrived_key, filename,
                                       str(expected_size), "SUCCESS", source))

    t = advance_time(t, 1, 3)
    events.append(build_process_details(
        t, arrived_key, "Validate Checksum", filename, source))

    t = advance_time(t, 1, 2)
    events.append(build_fail_transfer(
        t, arrived_key,
        f"Partial file received: expected {expected_size} bytes, received {received_size} bytes",
        source))

    return arrived_key, events


def pattern_virus_scan_failure(partner_key, start_time, filename=None,
                               file_size=None):
    """Pattern 6: Virus scan failure."""
    p = PARTNERS[partner_key]
    date = start_time.date()
    if filename is None:
        filename, ft_idx = generate_filename(partner_key, date)
    else:
        ft_idx = 0
    if file_size is None:
        file_size = file_size_for(partner_key, ft_idx)

    source = pick_event_source_sticky()
    arrived_key = generate_key(start_time)
    events = []
    t = start_time

    events.append(build_start_transfer(partner_key, t, arrived_key, filename,
                                       file_size, "SUCCESS", source))

    # ZIP + PGP if applicable
    if p["pgp"] and filename.endswith(".pgp"):
        t = advance_time(t, 1, 3)
        events.append(build_process_details(t, arrived_key, "ZIP",
                                            filename.replace(".pgp", ""), source))
        t = advance_time(t, 1, 3)
        events.append(build_process_details(t, arrived_key, "PGP",
                                            filename.replace(".zip.pgp", ""), source))

    # Virus scan fails
    t = advance_time(t, 1, 3)
    events.append(build_processing(t, arrived_key, "Virus Scan", filename,
                                   "Failed", "Threat detected: Trojan.GenericKD",
                                   source))

    t = advance_time(t, 1, 2)
    events.append(build_fail_transfer(t, arrived_key,
                                      "File quarantined — virus scan failure",
                                      source))

    return arrived_key, events


def pattern_stalled(partner_key, start_time, filename=None, file_size=None):
    """Pattern 7: Stalled transfer — no events after ProcessDetails."""
    date = start_time.date()
    if filename is None:
        filename, ft_idx = generate_filename(partner_key, date)
    else:
        ft_idx = 0
    if file_size is None:
        file_size = file_size_for(partner_key, ft_idx)

    source = pick_event_source_sticky()
    arrived_key = generate_key(start_time)
    events = []
    t = start_time

    events.append(build_start_transfer(partner_key, t, arrived_key, filename,
                                       file_size, "InProgress", source))

    t = advance_time(t, 1, 3)
    layer = "ZIP" if filename.endswith(".zip") or filename.endswith(".zip.pgp") else "Normalize Data"
    events.append(build_process_details(t, arrived_key, layer, filename, source))

    # No further events — transfer appears stalled
    return arrived_key, events


def pattern_slow_delivery(partner_key, start_time, filename=None, file_size=None,
                          delay_minutes=45, dest_key=None):
    """Pattern 8: Slow delivery — delivery takes much longer than normal."""
    date = start_time.date()
    if filename is None:
        filename, ft_idx = generate_filename(partner_key, date)
    else:
        ft_idx = 0
    if file_size is None:
        file_size = file_size_for(partner_key, ft_idx)

    source = pick_event_source_sticky()
    arrived_key = generate_key(start_time)
    events = []
    t = start_time

    events.append(build_start_transfer(partner_key, t, arrived_key, filename,
                                       file_size, "SUCCESS", source))

    for layer_type, layer_fn, msg in random_processing_steps(partner_key, filename):
        t = advance_time(t, 1, 3)
        if layer_type in ("ZIP", "PGP"):
            events.append(build_process_details(t, arrived_key, layer_type,
                                                layer_fn, source))
        else:
            events.append(build_processing(t, arrived_key, layer_type, layer_fn,
                                           "Success", msg, source))

    t = advance_time(t, 2, 5)
    delivery_key = generate_key(t)
    events.append(build_started_delivery(t, arrived_key, delivery_key,
                                         partner_key, filename, file_size,
                                         dest_key, source))

    # Long delay
    t = t + timedelta(minutes=delay_minutes)
    events.append(build_complete_delivery(t, arrived_key, delivery_key,
                                          partner_key, filename, dest_key, source))

    t = advance_time(t, 1, 3)
    events.append(build_complete_transfer(t, arrived_key, source=source))

    return arrived_key, events


# ============================================================
# Day generator — full realistic day of traffic
# ============================================================

def generate_day(date, volume_scale=1.0, is_weekend=False):
    """Generate a full day of transfer data with realistic distribution.

    Returns list of (arrivedfile_key, [events]).
    """
    reset_key_counter()
    transfers = []

    weekend_factor = 0.4 if is_weekend else 1.0
    scale = volume_scale * weekend_factor

    for partner_key, partner in PARTNERS.items():
        lo, hi = partner["volume_range"]
        count = int(random.randint(lo, hi) * scale)
        if count < 1:
            count = 1

        times = generate_sorted_times(date, count)

        # Distribute patterns
        n_happy = int(count * 0.85)
        n_retry = int(count * 0.05)
        n_fail = int(count * 0.05)
        n_slow = int(count * 0.03)
        n_stalled = count - n_happy - n_retry - n_fail - n_slow

        patterns = (["happy"] * n_happy +
                    ["retry"] * n_retry +
                    ["fail"] * max(0, n_fail) +
                    ["slow"] * max(0, n_slow) +
                    ["stalled"] * max(0, n_stalled))

        # Pad or trim to match count
        while len(patterns) < count:
            patterns.append("happy")
        patterns = patterns[:count]
        random.shuffle(patterns)

        fail_types = ["pgp_failure", "staging_failure", "partial_file", "virus_scan"]

        for i, t in enumerate(times):
            pat = patterns[i]

            if pat == "happy":
                transfers.append(pattern_happy_path(partner_key, t))
            elif pat == "retry":
                transfers.append(pattern_retry_success(partner_key, t))
            elif pat == "slow":
                transfers.append(pattern_slow_delivery(partner_key, t))
            elif pat == "stalled":
                transfers.append(pattern_stalled(partner_key, t))
            elif pat == "fail":
                ft = random.choice(fail_types)
                if ft == "pgp_failure" and partner["pgp"]:
                    transfers.append(pattern_pgp_failure(partner_key, t))
                elif ft == "staging_failure":
                    transfers.append(pattern_staging_failure(partner_key, t))
                elif ft == "partial_file":
                    transfers.append(pattern_partial_file(partner_key, t))
                elif ft == "virus_scan":
                    transfers.append(pattern_virus_scan_failure(partner_key, t))
                else:
                    # Fallback: staging failure for non-PGP partners
                    transfers.append(pattern_staging_failure(partner_key, t))

    return transfers


# ============================================================
# Scenario generators
# ============================================================

def scenario_1(base_date):
    """Scenario 1: Monday Morning Triage — 2 days of weekend data (Sat + Sun).

    ~400 total transfers, ~350 success, ~25 retry, 3-5 stuck failures,
    1 stalled from Atlas Payroll.
    """
    saturday = base_date - timedelta(days=2)
    sunday = base_date - timedelta(days=1)

    transfers = []
    reset_key_counter()

    for day in [saturday, sunday]:
        # Generate base weekend traffic (~200 per day)
        day_transfers = generate_day(day, volume_scale=1.0, is_weekend=True)
        transfers.extend(day_transfers)

    # Inject specific failures
    # 1 staging fail from Lakeshore
    t = random_business_time(saturday, 10, 16)
    transfers.append(pattern_staging_failure(
        "lakeshore", t,
        staging_path="/staging/lakeshore/outbound"))

    # 1 partial file from Meridian
    t = random_business_time(sunday, 9, 14)
    transfers.append(pattern_partial_file("meridian", t))

    # 1 delivery fail to Evergreen
    t = random_business_time(sunday, 11, 17)
    fn, _ = generate_filename("evergreen", sunday.date() if hasattr(sunday, 'date') else sunday)
    transfers.append(pattern_staging_failure("evergreen", t, filename=fn))

    # 1 stalled from Atlas Payroll (2+ hours old)
    stall_time = random_business_time(sunday, 8, 14)
    transfers.append(pattern_stalled("atlas", stall_time))

    return transfers


def scenario_2(date):
    """Scenario 2: PGP Key Rotation Fallout — Friday morning 6 AM–12 PM.

    Normal traffic + 8-12 PGP failures from Meridian + 4-6 from John Deere.
    One Meridian failure has 'corrupted input data' variant.
    """
    reset_key_counter()
    transfers = []

    morning_weights = {h: w for h, w in HOUR_WEIGHTS.items() if 6 <= h <= 12}

    # Normal background traffic (half day, all partners)
    for partner_key, partner in PARTNERS.items():
        lo, hi = partner["volume_range"]
        count = random.randint(lo // 3, hi // 3)  # ~1/3 of daily for half day
        times = generate_sorted_times(date, count, 6, 12, morning_weights)
        for t in times:
            transfers.append(pattern_happy_path(partner_key, t))

    # PGP failures from Meridian (8-12)
    meridian_fail_count = random.randint(8, 12)
    meridian_fail_times = generate_sorted_times(date, meridian_fail_count, 6, 12,
                                                morning_weights)
    for i, t in enumerate(meridian_fail_times):
        if i == 0:
            # One with different error variant
            transfers.append(pattern_pgp_failure("meridian", t,
                                                 error_variant="corrupted input data"))
        else:
            transfers.append(pattern_pgp_failure("meridian", t,
                                                 error_variant="invalid key"))

    # PGP failures from John Deere (4-6)
    jdeere_fail_count = random.randint(4, 6)
    jdeere_fail_times = generate_sorted_times(date, jdeere_fail_count, 6, 12,
                                              morning_weights)
    for t in jdeere_fail_times:
        transfers.append(pattern_pgp_failure("jdeere", t,
                                             error_variant="invalid key"))

    return transfers


def scenario_3(date):
    """Scenario 3: New Partner Onboarding — 1 day focused on Lakeshore.

    8-10 Lakeshore transfers (all CD protocol), 6-7 success,
    1 misroute, 1 slow delivery. Normal background from others.
    """
    reset_key_counter()
    transfers = []

    # Normal background from all partners except Lakeshore
    for partner_key in PARTNERS:
        if partner_key == "lakeshore":
            continue
        p = PARTNERS[partner_key]
        lo, hi = p["volume_range"]
        count = random.randint(lo, hi)
        times = generate_sorted_times(date, count)
        for t in times:
            transfers.append(pattern_happy_path(partner_key, t))

    # Lakeshore: 8-10 transfers
    lakeshore_count = random.randint(8, 10)
    lakeshore_times = generate_sorted_times(date, lakeshore_count)

    for i, t in enumerate(lakeshore_times):
        if i == lakeshore_count - 2:
            # Misroute: delivers to Operations instead of Treasury
            transfers.append(pattern_happy_path("lakeshore", t,
                                                dest_key="operations"))
        elif i == lakeshore_count - 1:
            # Slow delivery
            transfers.append(pattern_slow_delivery("lakeshore", t,
                                                   delay_minutes=45))
        else:
            transfers.append(pattern_happy_path("lakeshore", t))

    return transfers


def scenario_4(date):
    """Scenario 4: Where's the Settlement File? — 1 afternoon (12–5 PM).

    4 successful Meridian settlement files + 1 that fails at staging.
    Normal traffic from other partners.
    """
    reset_key_counter()
    transfers = []

    afternoon_weights = {h: w for h, w in HOUR_WEIGHTS.items() if 12 <= h <= 17}

    # Normal background traffic (afternoon only)
    for partner_key in PARTNERS:
        if partner_key == "meridian":
            continue
        p = PARTNERS[partner_key]
        lo, hi = p["volume_range"]
        count = random.randint(lo // 3, hi // 3)
        times = generate_sorted_times(date, count, 12, 17, afternoon_weights)
        for t in times:
            transfers.append(pattern_happy_path(partner_key, t))

    # 5 Meridian settlement files
    date_str = date.strftime("%Y%m%d")
    settlement_times = generate_sorted_times(date, 5, 12, 17, afternoon_weights)

    for i, t in enumerate(settlement_times):
        fn = f"settlement_{date_str}_{i+1:03d}.dat"
        if i < 4:
            transfers.append(pattern_happy_path("meridian", t, filename=fn))
        else:
            # 5th file fails at staging
            transfers.append(pattern_staging_failure(
                "meridian", t, filename=fn,
                staging_path="/staging/meridian/outbound"))

    return transfers


def scenario_5(date):
    """Scenario 5: End-of-Quarter Regulatory Batch — 1 PM–5 PM.

    12 regulatory files to FedLine. 9 succeed, 1 retry-then-success,
    1 permanent failure, 1 late (starts at 4:15 PM).
    """
    reset_key_counter()
    transfers = []

    afternoon_weights = {h: w for h, w in HOUR_WEIGHTS.items() if 13 <= h <= 17}

    # Normal background traffic
    for partner_key in PARTNERS:
        if partner_key == "fedline":
            continue
        p = PARTNERS[partner_key]
        lo, hi = p["volume_range"]
        count = random.randint(lo // 4, hi // 4)
        times = generate_sorted_times(date, count, 13, 17, afternoon_weights)
        for t in times:
            transfers.append(pattern_happy_path(partner_key, t))

    # 12 regulatory files
    date_str = date.strftime("%Y%m%d")
    reg_files = []
    for rtype in ["call_report", "fr2900", "ffiec009"]:
        for seq in range(1, 5):
            reg_files.append(f"reg_{rtype}_{date_str}.dat")

    # Generate times: 11 between 1-4 PM, 1 at 4:15 PM
    reg_times = generate_sorted_times(date, 11, 13, 16, afternoon_weights)
    late_time = datetime(date.year, date.month, date.day, 16, 15,
                         random.randint(0, 59), tzinfo=ET)

    # Assign outcomes
    # Index 0: retry then success
    # Index 1: permanent failure
    # Index 11: late file (appended)
    random.shuffle(reg_files)

    for i, fn in enumerate(reg_files):
        if i == 0:
            t = reg_times[i]
            transfers.append(pattern_retry_success("fedline", t, filename=fn))
        elif i == 1:
            # Permanent failure
            t = reg_times[i]
            source = pick_event_source_sticky()
            arrived_key = generate_key(t)
            evts = []
            file_size = file_size_for("fedline")

            evts.append(build_start_transfer("fedline", t, arrived_key, fn,
                                             file_size, "SUCCESS", source))

            for lt, lfn, msg in random_processing_steps("fedline", fn):
                t = advance_time(t, 1, 3)
                evts.append(build_processing(t, arrived_key, lt, lfn,
                                             "Success", msg, source))

            t = advance_time(t, 2, 5)
            dk = generate_key(t)
            evts.append(build_started_delivery(t, arrived_key, dk, "fedline",
                                               fn, file_size, source=source))
            t = advance_time(t, 10, 30)
            evts.append(build_failed_delivery(
                t, arrived_key, dk, "fedline", fn,
                "Remote endpoint rejected: invalid submission format",
                source=source))
            t = advance_time(t, 1, 3)
            evts.append(build_fail_transfer(
                t, arrived_key,
                "Delivery failed: endpoint rejected submission", source))
            transfers.append((arrived_key, evts))

        elif i == 11:
            # Late file at 4:15 PM
            transfers.append(pattern_happy_path("fedline", late_time, filename=fn))
        else:
            if i < len(reg_times):
                t = reg_times[i]
            else:
                t = reg_times[-1]
            transfers.append(pattern_happy_path("fedline", t, filename=fn))

    return transfers


def scenario_6(date):
    """Scenario 6: Did You Receive Our File? — John Deere confirmation.

    loan_pkg_4471.zip.pgp at 9:15 AM, fully successful.
    2-3 other John Deere transfers (also successful).
    Normal background traffic.
    """
    global _loan_id_counter
    reset_key_counter()
    transfers = []

    # Normal background traffic (full day, all partners except jdeere)
    for partner_key in PARTNERS:
        if partner_key == "jdeere":
            continue
        p = PARTNERS[partner_key]
        lo, hi = p["volume_range"]
        count = random.randint(lo, hi)
        times = generate_sorted_times(date, count)
        for t in times:
            transfers.append(pattern_happy_path(partner_key, t))

    # The specific John Deere transfer at 9:15 AM
    target_time = datetime(date.year, date.month, date.day, 9, 15, 0, tzinfo=ET)
    transfers.append(pattern_happy_path("jdeere", target_time,
                                        filename="loan_pkg_4471.zip.pgp"))

    # 2-3 other successful John Deere transfers
    other_count = random.randint(2, 3)
    other_times = generate_sorted_times(date, other_count, 8, 16)
    for t in other_times:
        transfers.append(pattern_happy_path("jdeere", t))

    return transfers


def scenario_7(date):
    """Scenario 7: Why Was My File Rejected? — John Deere virus scan failure.

    8-10 successful John Deere transfers + 1 virus scan failure
    (loan_pkg_4502.zip.pgp).
    """
    global _loan_id_counter
    reset_key_counter()
    transfers = []

    # Normal background (all partners except jdeere)
    for partner_key in PARTNERS:
        if partner_key == "jdeere":
            continue
        p = PARTNERS[partner_key]
        lo, hi = p["volume_range"]
        count = random.randint(lo, hi)
        times = generate_sorted_times(date, count)
        for t in times:
            transfers.append(pattern_happy_path(partner_key, t))

    # John Deere: 8-10 successful
    jd_count = random.randint(8, 10)
    jd_times = generate_sorted_times(date, jd_count + 1)  # +1 for the failure

    for i, t in enumerate(jd_times):
        if i == jd_count // 2:
            # Virus scan failure mid-day
            transfers.append(pattern_virus_scan_failure(
                "jdeere", t, filename="loan_pkg_4502.zip.pgp"))
        else:
            transfers.append(pattern_happy_path("jdeere", t))

    return transfers


def scenario_8(date):
    """Scenario 8: The Same Failure, Three Perspectives — partial file.

    loan_pkg_4488.zip.pgp from John Deere, partial file failure.
    Mixed with normal full-day traffic from all partners.
    """
    global _loan_id_counter
    reset_key_counter()
    transfers = []

    # Full day of normal traffic
    transfers.extend(generate_day(date))

    # Inject the specific partial file failure
    fail_time = random_business_time(date, 10, 14)
    transfers.append(pattern_partial_file(
        "jdeere", fail_time,
        filename="loan_pkg_4488.zip.pgp",
        expected_size=245000,
        received_size=112000))

    return transfers


SCENARIOS = {
    1: ("Monday Morning Triage", scenario_1),
    2: ("PGP Key Rotation Fallout", scenario_2),
    3: ("New Partner Onboarding", scenario_3),
    4: ("Where's the Settlement File?", scenario_4),
    5: ("End-of-Quarter Regulatory Batch", scenario_5),
    6: ("Did You Receive Our File?", scenario_6),
    7: ("Why Was My File Rejected?", scenario_7),
    8: ("The Same Failure, Three Perspectives", scenario_8),
}


# ============================================================
# Output
# ============================================================

def write_transfers(transfers, output_dir):
    """Write each transfer as a separate JSON file: {arrivedfile_key}.json"""
    os.makedirs(output_dir, exist_ok=True)

    written = 0
    for arrived_key, events in transfers:
        filepath = os.path.join(output_dir, f"{arrived_key}.json")
        with open(filepath, "w") as f:
            json.dump(events, f, indent=2)
        written += 1

    return written


def summarize_transfers(transfers):
    """Print a summary of generated transfers."""
    total = len(transfers)
    by_partner = {}
    by_outcome = {"success": 0, "failed": 0, "stalled": 0, "retry": 0, "slow": 0}

    for key, events in transfers:
        # Identify partner from first event
        first = events[0]
        producer = first.get("ProducerUserId", "unknown")
        by_partner[producer] = by_partner.get(producer, 0) + 1

        # Identify outcome from last event
        last_event = events[-1]["Event"]
        if last_event == "CompleteTransfer":
            # Check if there was a failed delivery (retry)
            has_fail = any(e["Event"] == "FailedDelivery" for e in events)
            has_slow = False
            # Check for slow delivery (>10 min gap between StartedDelivery and CompleteDelivery)
            for i in range(len(events) - 1):
                if events[i]["Event"] == "StartedDelivery" and events[i+1]["Event"] == "CompleteDelivery":
                    gap = int(events[i+1]["TIME"]) - int(events[i]["TIME"])
                    if gap > 600_000:  # 10 minutes in ms
                        has_slow = True

            if has_fail:
                by_outcome["retry"] += 1
            elif has_slow:
                by_outcome["slow"] += 1
            else:
                by_outcome["success"] += 1
        elif last_event == "FailTransfer":
            by_outcome["failed"] += 1
        else:
            by_outcome["stalled"] += 1

    print(f"\n{'='*60}")
    print(f"Generated {total} transfers")
    print(f"{'='*60}")
    print(f"\nBy partner:")
    for partner, count in sorted(by_partner.items()):
        print(f"  {partner:25s} {count:>5d}")
    print(f"\nBy outcome:")
    for outcome, count in sorted(by_outcome.items()):
        print(f"  {outcome:25s} {count:>5d}")
    print()


# ============================================================
# CLI
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Syncrofy FTV Data Generator — Pinnacle National Bank",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --date 2026-03-20
  %(prog)s --date 2026-03-20 --scenario 2
  %(prog)s --date 2026-03-16 --days 5
  %(prog)s --date 2026-03-20 --volume-scale 0.5 --seed 42
        """)

    parser.add_argument("--date", required=True,
                        help="Target date (YYYY-MM-DD). For multi-day, this is the start date.")
    parser.add_argument("--days", type=int, default=1,
                        help="Number of days to generate (default: 1)")
    parser.add_argument("--scenario", type=int, choices=range(1, 9), default=None,
                        help="Generate data for a specific scenario (1-8). "
                             "If omitted, generates a normal full day.")
    parser.add_argument("--output-dir", default="./output",
                        help="Output directory (default: ./output)")
    parser.add_argument("--volume-scale", type=float, default=1.0,
                        help="Volume multiplier (default: 1.0)")
    parser.add_argument("--seed", type=int, default=None,
                        help="Random seed for reproducibility")

    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    target_date = datetime.strptime(args.date, "%Y-%m-%d").date()

    if args.scenario is not None:
        name, gen_func = SCENARIOS[args.scenario]
        print(f"Generating Scenario {args.scenario}: {name}")
        print(f"Date: {target_date}")

        transfers = gen_func(target_date)

        sub_dir = os.path.join(args.output_dir,
                               f"scenario_{args.scenario}_{target_date.isoformat()}")
        count = write_transfers(transfers, sub_dir)
        summarize_transfers(transfers)
        print(f"Wrote {count} transfer files to {sub_dir}")

    else:
        for day_offset in range(args.days):
            current_date = target_date + timedelta(days=day_offset)
            is_weekend = current_date.weekday() >= 5
            day_label = "weekend" if is_weekend else "weekday"

            print(f"Generating {day_label} traffic for {current_date}")

            transfers = generate_day(current_date, args.volume_scale, is_weekend)

            sub_dir = os.path.join(args.output_dir, current_date.isoformat())
            count = write_transfers(transfers, sub_dir)
            summarize_transfers(transfers)
            print(f"Wrote {count} transfer files to {sub_dir}")


if __name__ == "__main__":
    main()
