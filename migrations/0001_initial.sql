PRAGMA foreign_keys = ON;

CREATE TABLE scans (
  id TEXT PRIMARY KEY,
  repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  repository_full_name TEXT NOT NULL,
  repository_cache_key TEXT NOT NULL,
  repository_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'fetching', 'checking', 'complete', 'partial', 'failed')),
  status_message TEXT NOT NULL,
  package_count INTEGER NOT NULL DEFAULT 0 CHECK (package_count >= 0),
  vulnerable_package_count INTEGER NOT NULL DEFAULT 0 CHECK (vulnerable_package_count >= 0),
  finding_count INTEGER NOT NULL DEFAULT 0 CHECK (finding_count >= 0),
  critical_count INTEGER NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
  high_count INTEGER NOT NULL DEFAULT 0 CHECK (high_count >= 0),
  medium_count INTEGER NOT NULL DEFAULT 0 CHECK (medium_count >= 0),
  low_count INTEGER NOT NULL DEFAULT 0 CHECK (low_count >= 0),
  unknown_count INTEGER NOT NULL DEFAULT 0 CHECK (unknown_count >= 0),
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  kev_count INTEGER NOT NULL DEFAULT 0 CHECK (kev_count >= 0),
  partial INTEGER NOT NULL DEFAULT 0 CHECK (partial IN (0, 1)),
  partial_reason TEXT,
  osv_chunks_total INTEGER NOT NULL DEFAULT 0 CHECK (osv_chunks_total >= 0),
  osv_chunks_done INTEGER NOT NULL DEFAULT 0 CHECK (osv_chunks_done >= 0),
  error_code TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX scans_recent_repository_idx
  ON scans (repository_cache_key, completed_at DESC);
CREATE INDEX scans_expiry_idx ON scans (expires_at);
CREATE INDEX scans_status_idx ON scans (status, updated_at);

CREATE TABLE packages (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL,
  spdx_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT,
  ecosystem TEXT NOT NULL,
  purl TEXT NOT NULL,
  direct INTEGER NOT NULL DEFAULT 0 CHECK (direct IN (0, 1)),
  vulnerability_count INTEGER NOT NULL DEFAULT 0 CHECK (vulnerability_count >= 0),
  UNIQUE (scan_id, spdx_id),
  FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE CASCADE
) STRICT;

CREATE INDEX packages_scan_idx ON packages (scan_id, name);

CREATE TABLE dependency_edges (
  scan_id TEXT NOT NULL,
  source_spdx_id TEXT NOT NULL,
  target_spdx_id TEXT NOT NULL,
  relationship TEXT NOT NULL,
  PRIMARY KEY (scan_id, source_spdx_id, target_spdx_id, relationship),
  FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE CASCADE
) STRICT;

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  osv_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'unknown')),
  summary TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  fixed_versions_json TEXT NOT NULL DEFAULT '[]',
  evidence_urls_json TEXT NOT NULL DEFAULT '[]',
  is_kev INTEGER NOT NULL DEFAULT 0 CHECK (is_kev IN (0, 1)),
  kev_due_date TEXT,
  known_ransomware_use INTEGER CHECK (known_ransomware_use IN (0, 1) OR known_ransomware_use IS NULL),
  created_at TEXT NOT NULL,
  UNIQUE (scan_id, package_id, osv_id),
  FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE CASCADE,
  FOREIGN KEY (package_id) REFERENCES packages (id) ON DELETE CASCADE
) STRICT;

CREATE INDEX findings_scan_severity_idx ON findings (scan_id, severity);
CREATE INDEX findings_scan_kev_idx ON findings (scan_id, is_kev);

CREATE TABLE scan_chunks (
  scan_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scan_id, chunk_index),
  FOREIGN KEY (scan_id) REFERENCES scans (id) ON DELETE CASCADE
) STRICT;

CREATE TABLE usage_limits (
  bucket TEXT NOT NULL,
  client_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (bucket, client_key)
) STRICT;

CREATE INDEX usage_limits_expiry_idx ON usage_limits (expires_at);

