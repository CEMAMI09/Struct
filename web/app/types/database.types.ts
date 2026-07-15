export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type OrgRole = 'owner' | 'admin' | 'viewer'
export type SubscriptionTier = 'free' | 'flexible' | 'pro' | 'scale'

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          stripe_item_id: string | null
          stripe_quantity: number
          subscription_tier: SubscriptionTier
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          stripe_item_id?: string | null
          stripe_quantity?: number
          subscription_tier?: SubscriptionTier
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          stripe_item_id?: string | null
          stripe_quantity?: number
          subscription_tier?: SubscriptionTier
          created_at?: string
        }
      }
      organization_members: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role: OrgRole
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          role?: OrgRole
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          role?: OrgRole
          created_at?: string
        }
      }
      audit_logs: {
        Row: {
          id: string
          organization_id: string
          user_id: string | null
          action: 'INSERT' | 'UPDATE' | 'DELETE'
          table_name: string
          record_id: string
          previous_data: Json | null
          new_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id?: string | null
          action: 'INSERT' | 'UPDATE' | 'DELETE'
          table_name: string
          record_id: string
          previous_data?: Json | null
          new_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string | null
          action?: 'INSERT' | 'UPDATE' | 'DELETE'
          table_name?: string
          record_id?: string
          previous_data?: Json | null
          new_data?: Json | null
          created_at?: string
        }
      }
      devices: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          name: string
          api_key: string
          mac_address: string | null
          last_seen: string | null
          created_at: string
          tags: Json
          encryption_enabled: boolean
          encryption_key: string | null
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          name: string
          api_key: string
          mac_address?: string | null
          last_seen?: string | null
          created_at?: string
          tags?: Json
          encryption_enabled?: boolean
          encryption_key?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string
          name?: string
          api_key?: string
          mac_address?: string | null
          last_seen?: string | null
          created_at?: string
          tags?: Json
          encryption_enabled?: boolean
          encryption_key?: string | null
        }
      }
      bulk_device_imports: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          payload_hash: string
          devices: Json
          status: 'quoted' | 'processing' | 'completed' | 'failed' | 'expired'
          current_device_count: number
          projected_device_count: number
          previous_stripe_quantity: number
          target_stripe_quantity: number
          estimated_proration_amount: number | null
          currency: string | null
          stripe_idempotency_key: string
          error_message: string | null
          created_device_ids: string[]
          quoted_at: string
          expires_at: string
          claimed_at: string | null
          completed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          payload_hash: string
          devices: Json
          status?: 'quoted' | 'processing' | 'completed' | 'failed' | 'expired'
          current_device_count: number
          projected_device_count: number
          previous_stripe_quantity: number
          target_stripe_quantity: number
          estimated_proration_amount?: number | null
          currency?: string | null
          stripe_idempotency_key: string
          error_message?: string | null
          created_device_ids?: string[]
          quoted_at?: string
          expires_at: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          payload_hash?: string
          devices?: Json
          status?: 'quoted' | 'processing' | 'completed' | 'failed' | 'expired'
          current_device_count?: number
          projected_device_count?: number
          previous_stripe_quantity?: number
          target_stripe_quantity?: number
          estimated_proration_amount?: number | null
          currency?: string | null
          stripe_idempotency_key?: string
          error_message?: string | null
          created_device_ids?: string[]
          quoted_at?: string
          expires_at?: string
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
        }
      }
      schemas: {
        Row: {
          id: string
          device_id: string
          organization_id: string
          schema_definition: Json
          version: number
          updated_at: string
        }
        Insert: {
          id?: string
          device_id: string
          organization_id: string
          schema_definition?: Json
          version?: number
          updated_at?: string
        }
        Update: {
          id?: string
          device_id?: string
          organization_id?: string
          schema_definition?: Json
          version?: number
          updated_at?: string
        }
      }
      schema_versions: {
        Row: {
          id: string
          device_id: string
          version: number
          schema_definition: Json
          created_at: string
        }
        Insert: {
          id?: string
          device_id: string
          version: number
          schema_definition?: Json
          created_at?: string
        }
        Update: {
          id?: string
          device_id?: string
          version?: number
          schema_definition?: Json
          created_at?: string
        }
      }
      telemetry: {
        Row: {
          id: string
          device_id: string
          parsed_json: Json
          timestamp: string
        }
        Insert: {
          id?: string
          device_id: string
          parsed_json: Json
          timestamp?: string
        }
        Update: {
          id?: string
          device_id?: string
          parsed_json?: Json
          timestamp?: string
        }
      }
      destinations: {
        Row: {
          id: string
          user_id: string
          organization_id: string
          name: string
          url: string
          device_id: string | null
          routing_rule: Json | null
          event_types: string[]
          signing_secret: string
          enabled: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          organization_id: string
          name: string
          url: string
          device_id?: string | null
          routing_rule?: Json | null
          event_types?: string[]
          signing_secret?: string
          enabled?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          organization_id?: string
          name?: string
          url?: string
          device_id?: string | null
          routing_rule?: Json | null
          event_types?: string[]
          signing_secret?: string
          enabled?: boolean
          created_at?: string
        }
      }
      pending_commands: {
        Row: {
          id: string
          device_id: string
          user_id: string
          command_type: string
          payload: Json
          packed_hex: string
          status: string
          created_at: string
          delivered_at: string | null
        }
        Insert: {
          id?: string
          device_id: string
          user_id: string
          command_type?: string
          payload?: Json
          packed_hex: string
          status?: string
          created_at?: string
          delivered_at?: string | null
        }
        Update: {
          id?: string
          device_id?: string
          user_id?: string
          command_type?: string
          payload?: Json
          packed_hex?: string
          status?: string
          created_at?: string
          delivered_at?: string | null
        }
      }
    }
    Enums: {
      org_role: OrgRole
      subscription_tier_enum: SubscriptionTier
    }
    Functions: {
      get_org_device_limit: {
        Args: { p_org_id: string }
        Returns: number
      }
      telemetry_retention_days: {
        Args: { p_org_id: string }
        Returns: number
      }
      org_has_entitlement: {
        Args: { p_org_id: string; p_entitlement: string }
        Returns: boolean
      }
      create_organization: {
        Args: { p_name: string }
        Returns: Database['public']['Tables']['organizations']['Row']
      }
      bulk_insert_devices: {
        Args: {
          p_org_id: string
          p_user_id: string
          p_devices: Json
          p_expected_current_count: number
        }
        Returns: Database['public']['Tables']['devices']['Row'][]
      }
    }
  }
}
