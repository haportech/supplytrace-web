import type { ScanStatus, Severity } from '../../shared/contracts'

export type ScanRow = {
  id: string
  repository_owner: string
  repository_name: string
  repository_full_name: string
  repository_cache_key: string
  repository_url: string
  status: ScanStatus
  status_message: string
  package_count: number
  vulnerable_package_count: number
  finding_count: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  unknown_count: number
  risk_score: number
  kev_count: number
  partial: number
  partial_reason: string | null
  osv_chunks_total: number
  osv_chunks_done: number
  error_code: string | null
  schema_version: number
  created_at: string
  updated_at: string
  completed_at: string | null
  expires_at: string
}

export type PackageRow = {
  id: string
  scan_id: string
  spdx_id: string
  name: string
  version: string | null
  ecosystem: string
  purl: string
  direct: number
  vulnerability_count: number
}

export type EdgeRow = {
  scan_id: string
  source_spdx_id: string
  target_spdx_id: string
  relationship: string
}

export type FindingRow = {
  id: string
  scan_id: string
  package_id: string
  osv_id: string
  severity: Severity
  summary: string
  aliases_json: string
  fixed_versions_json: string
  evidence_urls_json: string
  is_kev: number
  kev_due_date: string | null
  known_ransomware_use: number | null
  created_at: string
}

