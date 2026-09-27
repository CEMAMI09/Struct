export type OrgRole = 'owner' | 'admin' | 'viewer'
export type SubscriptionTier = 'free' | 'flexible' | 'pro' | 'scale'

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          new_data: Json | null
          organization_id: string
          previous_data: Json | null
          record_id: string
          table_name: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_data?: Json | null
          organization_id: string
          previous_data?: Json | null
          record_id: string
          table_name: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_data?: Json | null
          organization_id?: string
          previous_data?: Json | null
          record_id?: string
          table_name?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bulk_device_imports: {
        Row: {
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          created_device_ids: string[]
          currency: string | null
          current_device_count: number
          devices: Json
          error_message: string | null
          estimated_proration_amount: number | null
          expires_at: string
          id: string
          organization_id: string
          payload_hash: string
          previous_stripe_quantity: number
          projected_device_count: number
          quoted_at: string
          status: Database["public"]["Enums"]["bulk_import_status"]
          stripe_idempotency_key: string
          target_stripe_quantity: number
          user_id: string
        }
        Insert: {
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_device_ids?: string[]
          currency?: string | null
          current_device_count: number
          devices: Json
          error_message?: string | null
          estimated_proration_amount?: number | null
          expires_at: string
          id?: string
          organization_id: string
          payload_hash: string
          previous_stripe_quantity: number
          projected_device_count: number
          quoted_at?: string
          status?: Database["public"]["Enums"]["bulk_import_status"]
          stripe_idempotency_key: string
          target_stripe_quantity: number
          user_id: string
        }
        Update: {
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_device_ids?: string[]
          currency?: string | null
          current_device_count?: number
          devices?: Json
          error_message?: string | null
          estimated_proration_amount?: number | null
          expires_at?: string
          id?: string
          organization_id?: string
          payload_hash?: string
          previous_stripe_quantity?: number
          projected_device_count?: number
          quoted_at?: string
          status?: Database["public"]["Enums"]["bulk_import_status"]
          stripe_idempotency_key?: string
          target_stripe_quantity?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_device_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      destinations: {
        Row: {
          created_at: string
          device_id: string | null
          enabled: boolean
          event_types: string[]
          id: string
          name: string
          organization_id: string | null
          routing_rule: Json | null
          signing_secret: string
          url: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          enabled?: boolean
          event_types?: string[]
          id?: string
          name: string
          organization_id?: string | null
          routing_rule?: Json | null
          signing_secret?: string
          url: string
          user_id?: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          enabled?: boolean
          event_types?: string[]
          id?: string
          name?: string
          organization_id?: string | null
          routing_rule?: Json | null
          signing_secret?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "destinations_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "destinations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      device_event_ids: {
        Row: {
          device_id: string
          digest: string
          event_id: string
        }
        Insert: {
          device_id: string
          digest: string
          event_id: string
        }
        Update: {
          device_id?: string
          digest?: string
          event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_event_ids_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      device_profiles: {
        Row: {
          created_at: string
          device_model: string
          firmware_version: string
          fleet_key_id: string
          fleet_secret_encrypted: string
          fleet_secret_preview: string | null
          id: string
          identity_field: string
          name: string
          organization_id: string
          schema_definition: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_model?: string
          firmware_version?: string
          fleet_key_id: string
          fleet_secret_encrypted: string
          fleet_secret_preview?: string | null
          id?: string
          identity_field?: string
          name: string
          organization_id: string
          schema_definition?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_model?: string
          firmware_version?: string
          fleet_key_id?: string
          fleet_secret_encrypted?: string
          fleet_secret_preview?: string | null
          id?: string
          identity_field?: string
          name?: string
          organization_id?: string
          schema_definition?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      device_replay_nonces: {
        Row: {
          device_id: string
          expires_at: string
          first_seen_at: string
          frame_digest: string | null
          frame_timestamp: string
          nonce: string
        }
        Insert: {
          device_id: string
          expires_at: string
          first_seen_at?: string
          frame_digest?: string | null
          frame_timestamp: string
          nonce: string
        }
        Update: {
          device_id?: string
          expires_at?: string
          first_seen_at?: string
          frame_digest?: string | null
          frame_timestamp?: string
          nonce?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_replay_nonces_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          api_key: string
          api_secret_encrypted: string | null
          api_secret_preview: string | null
          created_at: string
          debug_trace_until: string | null
          encryption_enabled: boolean
          encryption_key: string | null
          hardware_id: string | null
          id: string
          key_id: string
          last_seen: string | null
          mac_address: string | null
          name: string
          organization_id: string | null
          profile_id: string | null
          protocol_version: number
          tags: Json
          user_id: string
        }
        Insert: {
          api_key: string
          api_secret_encrypted?: string | null
          api_secret_preview?: string | null
          created_at?: string
          debug_trace_until?: string | null
          encryption_enabled?: boolean
          encryption_key?: string | null
          hardware_id?: string | null
          id?: string
          key_id: string
          last_seen?: string | null
          mac_address?: string | null
          name: string
          organization_id?: string | null
          profile_id?: string | null
          protocol_version?: number
          tags?: Json
          user_id?: string
        }
        Update: {
          api_key?: string
          api_secret_encrypted?: string | null
          api_secret_preview?: string | null
          created_at?: string
          debug_trace_until?: string | null
          encryption_enabled?: boolean
          encryption_key?: string | null
          hardware_id?: string | null
          id?: string
          key_id?: string
          last_seen?: string | null
          mac_address?: string | null
          name?: string
          organization_id?: string | null
          profile_id?: string | null
          protocol_version?: number
          tags?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "device_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_device_usage_periods: {
        Row: {
          created_at: string
          id: string
          included_paid_quantity: number
          organization_id: string
          peak_device_count: number
          peak_paid_quantity: number
          status: Database["public"]["Enums"]["usage_period_status"]
          stripe_period_end: string
          stripe_period_start: string
          stripe_subscription_id: string | null
          tier: string
          true_up_amount_cents: number | null
          true_up_invoice_item_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          included_paid_quantity?: number
          organization_id: string
          peak_device_count?: number
          peak_paid_quantity?: number
          status?: Database["public"]["Enums"]["usage_period_status"]
          stripe_period_end: string
          stripe_period_start: string
          stripe_subscription_id?: string | null
          tier: string
          true_up_amount_cents?: number | null
          true_up_invoice_item_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          included_paid_quantity?: number
          organization_id?: string
          peak_device_count?: number
          peak_paid_quantity?: number
          status?: Database["public"]["Enums"]["usage_period_status"]
          stripe_period_end?: string
          stripe_period_start?: string
          stripe_subscription_id?: string | null
          tier?: string
          true_up_amount_cents?: number | null
          true_up_invoice_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_device_usage_periods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          stripe_customer_id: string | null
          stripe_item_id: string | null
          stripe_quantity: number
          stripe_subscription_id: string | null
          subscription_tier: Database["public"]["Enums"]["subscription_tier_enum"]
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          stripe_customer_id?: string | null
          stripe_item_id?: string | null
          stripe_quantity?: number
          stripe_subscription_id?: string | null
          subscription_tier?: Database["public"]["Enums"]["subscription_tier_enum"]
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          stripe_customer_id?: string | null
          stripe_item_id?: string | null
          stripe_quantity?: number
          stripe_subscription_id?: string | null
          subscription_tier?: Database["public"]["Enums"]["subscription_tier_enum"]
        }
        Relationships: []
      }
      packet_traces: {
        Row: {
          created_at: string
          device_id: string
          id: string
          organization_id: string
          trace: Json
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          organization_id: string
          trace: Json
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          organization_id?: string
          trace?: Json
        }
        Relationships: [
          {
            foreignKeyName: "packet_traces_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packet_traces_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_commands: {
        Row: {
          acknowledged_at: string | null
          attempt_count: number
          claimed_by: string | null
          command_id: string
          command_type: string
          created_at: string
          delivered_at: string | null
          device_id: string
          device_result: string | null
          expires_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          next_attempt_at: string
          packed_hex: string
          payload: Json
          sent_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          attempt_count?: number
          claimed_by?: string | null
          command_id?: string
          command_type?: string
          created_at?: string
          delivered_at?: string | null
          device_id: string
          device_result?: string | null
          expires_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          packed_hex: string
          payload?: Json
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Update: {
          acknowledged_at?: string | null
          attempt_count?: number
          claimed_by?: string | null
          command_id?: string
          command_type?: string
          created_at?: string
          delivered_at?: string | null
          device_id?: string
          device_result?: string | null
          expires_at?: string
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          packed_hex?: string
          payload?: Json
          sent_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_commands_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_versions: {
        Row: {
          created_at: string
          device_id: string
          id: string
          schema_definition: Json
          version: number
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          schema_definition?: Json
          version: number
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          schema_definition?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "schema_versions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      schemas: {
        Row: {
          device_id: string
          id: string
          organization_id: string | null
          schema_definition: Json
          updated_at: string
          version: number
        }
        Insert: {
          device_id: string
          id?: string
          organization_id?: string | null
          schema_definition?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          device_id?: string
          id?: string
          organization_id?: string | null
          schema_definition?: Json
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "schemas_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schemas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      telemetry: {
        Row: {
          device_id: string
          id: string
          parsed_json: Json
          timestamp: string
        }
        Insert: {
          device_id: string
          id?: string
          parsed_json: Json
          timestamp?: string
        }
        Update: {
          device_id?: string
          id?: string
          parsed_json?: Json
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "telemetry_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      trace_event_links: {
        Row: {
          device_id: string
          event_id: string
          event_key: string
        }
        Insert: {
          device_id: string
          event_id: string
          event_key: string
        }
        Update: {
          device_id?: string
          event_id?: string
          event_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "trace_event_links_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trace_event_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "telemetry"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_attempts: {
        Row: {
          attempted_at: string
          delivery_id: string
          detail: string | null
          id: number
          outcome: string
        }
        Insert: {
          attempted_at?: string
          delivery_id: string
          detail?: string | null
          id?: never
          outcome: string
        }
        Update: {
          attempted_at?: string
          delivery_id?: string
          detail?: string | null
          id?: never
          outcome?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_attempts_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "webhook_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          body: Json
          created_at: string
          delivered_at: string | null
          destination_id: string | null
          destination_url: string
          event_id: string
          id: string
          last_error: string | null
          lease_token: string | null
          lease_until: string | null
          next_attempt_at: string
          organization_id: string
          replay_count: number
          routing_rule: Json | null
          status: string
        }
        Insert: {
          attempts?: number
          body: Json
          created_at?: string
          delivered_at?: string | null
          destination_id?: string | null
          destination_url: string
          event_id: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          organization_id: string
          replay_count?: number
          routing_rule?: Json | null
          status?: string
        }
        Update: {
          attempts?: number
          body?: Json
          created_at?: string
          delivered_at?: string | null
          destination_id?: string | null
          destination_url?: string
          event_id?: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          lease_until?: string | null
          next_attempt_at?: string
          organization_id?: string
          replay_count?: number
          routing_rule?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      // Pending migrations 026/027; regenerate from Supabase after rollout.
      configure_device_encryption: {
        Args: { p_device_id: string; p_enabled: boolean; p_rotate?: boolean }
        Returns: string | null
      }
      create_device_with_usage: {
        Args: {
          p_org_id: string
          p_user_id: string
          p_name: string
          p_key_id: string
          p_api_secret_encrypted: string
          p_api_secret_preview: string
          p_mac_address: string | null
          p_expected_current_count: number
        }
        Returns: Database["public"]["Tables"]["devices"]["Row"]
      }
      get_destination_signing_secret: { Args: { p_destination_id: string }; Returns: string }
      get_destination_url: { Args: { p_destination_id: string }; Returns: string }
      get_device_encryption_key: { Args: { p_device_id: string }; Returns: string | null }
      get_webhook_delivery_destination_url: { Args: { p_delivery_id: string }; Returns: string }
      acknowledge_pending_command: {
        Args: {
          p_command_id: string
          p_device_id: string
          p_result_code?: number
        }
        Returns: boolean
      }
      add_org_member_by_email: {
        Args: {
          p_email: string
          p_org_id: string
          p_role?: Database["public"]["Enums"]["org_role"]
        }
        Returns: string
      }
      bulk_insert_devices: {
        Args: {
          p_devices: Json
          p_expected_current_count: number
          p_org_id: string
          p_user_id: string
        }
        Returns: {
          api_key: string
          api_secret_encrypted: string | null
          api_secret_preview: string | null
          created_at: string
          debug_trace_until: string | null
          encryption_enabled: boolean
          encryption_key: string | null
          hardware_id: string | null
          id: string
          key_id: string
          last_seen: string | null
          mac_address: string | null
          name: string
          organization_id: string | null
          profile_id: string | null
          protocol_version: number
          tags: Json
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "devices"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      bulk_provision_profile_devices: {
        Args: {
          p_devices: Json
          p_expected_current_count: number
          p_org_id: string
          p_profile_id: string
          p_user_id: string
        }
        Returns: {
          api_key: string
          api_secret_encrypted: string | null
          api_secret_preview: string | null
          created_at: string
          debug_trace_until: string | null
          encryption_enabled: boolean
          encryption_key: string | null
          hardware_id: string | null
          id: string
          key_id: string
          last_seen: string | null
          mac_address: string | null
          name: string
          organization_id: string | null
          profile_id: string | null
          protocol_version: number
          tags: Json
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "devices"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pending_downlinks: {
        Args: { p_device_id: string; p_gateway_id: string; p_limit?: number }
        Returns: {
          acknowledged_at: string | null
          attempt_count: number
          claimed_by: string | null
          command_id: string
          command_type: string
          created_at: string
          delivered_at: string | null
          device_id: string
          device_result: string | null
          expires_at: string
          id: string
          last_error: string | null
          lease_expires_at: string | null
          next_attempt_at: string
          packed_hex: string
          payload: Json
          sent_at: string | null
          status: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pending_commands"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_webhook_deliveries: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          body: Json
          created_at: string
          delivered_at: string | null
          destination_id: string | null
          destination_url: string
          event_id: string
          id: string
          last_error: string | null
          lease_token: string | null
          lease_until: string | null
          next_attempt_at: string
          organization_id: string
          replay_count: number
          routing_rule: Json | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "webhook_deliveries"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_organization: {
        Args: { p_name: string }
        Returns: {
          created_at: string
          id: string
          name: string
          stripe_customer_id: string | null
          stripe_item_id: string | null
          stripe_quantity: number
          stripe_subscription_id: string | null
          subscription_tier: Database["public"]["Enums"]["subscription_tier_enum"]
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      enable_packet_tracing: {
        Args: { p_device_id: string }
        Returns: undefined
      }
      expire_pending_commands: { Args: never; Returns: undefined }
      finish_webhook_delivery: {
        Args: {
          p_detail?: string
          p_id: string
          p_outcome: string
          p_token: string
        }
        Returns: boolean
      }
      generate_device_api_key: { Args: never; Returns: string }
      get_org_device_limit: { Args: { p_org_id: string }; Returns: number }
      ingest_device_telemetry: {
        Args: {
          p_device_id: string
          p_frame_digest: string
          p_frame_timestamp: string
          p_nonce: string
          p_parsed_json: Json
          p_skew_seconds?: number
        }
        Returns: boolean
      }
      ingest_queued_telemetry: {
        Args: {
          p_device_id: string
          p_event_digest: string
          p_event_id: string
          p_frame_digest: string
          p_frame_timestamp: string
          p_nonce: string
          p_parsed_json: Json
          p_skew_seconds?: number
        }
        Returns: boolean
      }
      ingest_traced_telemetry: {
        Args: {
          p_device_id: string
          p_event_digest?: string
          p_event_id?: string
          p_frame_digest: string
          p_frame_timestamp: string
          p_nonce: string
          p_parsed_json: Json
          p_skew_seconds?: number
        }
        Returns: Json
      }
      is_org_member: { Args: { p_org_id: string }; Returns: boolean }
      is_org_owner: { Args: { p_org_id: string }; Returns: boolean }
      is_org_writer: { Args: { p_org_id: string }; Returns: boolean }
      list_org_members: {
        Args: { p_org_id: string }
        Returns: {
          created_at: string
          email: string
          id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }[]
      }
      org_has_entitlement: {
        Args: { p_entitlement: string; p_org_id: string }
        Returns: boolean
      }
      publish_device_schema: {
        Args: {
          p_definition: Json
          p_device_id: string
          p_expected_version: number
        }
        Returns: {
          device_id: string
          id: string
          organization_id: string | null
          schema_definition: Json
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "schemas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      purge_expired_telemetry: { Args: never; Returns: number }
      record_org_device_peak: {
        Args: { p_active_device_count: number; p_org_id: string }
        Returns: {
          created_at: string
          id: string
          included_paid_quantity: number
          organization_id: string
          peak_device_count: number
          peak_paid_quantity: number
          status: Database["public"]["Enums"]["usage_period_status"]
          stripe_period_end: string
          stripe_period_start: string
          stripe_subscription_id: string | null
          tier: string
          true_up_amount_cents: number | null
          true_up_invoice_item_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "organization_device_usage_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_packet_trace: {
        Args: { p_device_id: string; p_trace: Json }
        Returns: undefined
      }
      remove_org_member: { Args: { p_member_id: string }; Returns: undefined }
      replay_webhook_delivery: { Args: { p_id: string }; Returns: undefined }
      reserve_device_nonce: {
        Args: {
          p_device_id: string
          p_frame_timestamp: string
          p_nonce: string
          p_skew_seconds?: number
        }
        Returns: boolean
      }
      subscription_tier_rank: { Args: { p_tier: string }; Returns: number }
      telemetry_retention_days: { Args: { p_org_id: string }; Returns: number }
      update_org_member_role: {
        Args: {
          p_member_id: string
          p_role: Database["public"]["Enums"]["org_role"]
        }
        Returns: undefined
      }
      zero_touch_register_device: {
        Args: {
          p_api_secret_encrypted?: string
          p_api_secret_preview?: string
          p_hardware_id: string
          p_key_id?: string
          p_name?: string
          p_profile_id: string
        }
        Returns: {
          api_key: string
          api_secret_encrypted: string | null
          api_secret_preview: string | null
          created_at: string
          debug_trace_until: string | null
          encryption_enabled: boolean
          encryption_key: string | null
          hardware_id: string | null
          id: string
          key_id: string
          last_seen: string | null
          mac_address: string | null
          name: string
          organization_id: string | null
          profile_id: string | null
          protocol_version: number
          tags: Json
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "devices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      bulk_import_status:
        | "quoted"
        | "processing"
        | "completed"
        | "failed"
        | "expired"
      org_role: "owner" | "admin" | "viewer"
      subscription_tier_enum: "free" | "flexible" | "pro" | "scale"
      usage_period_status: "open" | "invoiced" | "void"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      bulk_import_status: [
        "quoted",
        "processing",
        "completed",
        "failed",
        "expired",
      ],
      org_role: ["owner", "admin", "viewer"],
      subscription_tier_enum: ["free", "flexible", "pro", "scale"],
      usage_period_status: ["open", "invoiced", "void"],
    },
  },
} as const
